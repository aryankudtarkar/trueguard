import * as vscode from 'vscode';
import { ServerState, type ServerManager } from './serverManager';
import {
  ToolCallBuffer,
  streamingEventSchema,
  type ExtractedToolCall,
  type StreamingEvent,
  type ToolApprovalRequiredEvent,
} from './schemas';
import { logger } from '../util/logger';

export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
}

/** A tool call the model made, with the arguments it sent. */
export interface RecordedToolCall {
  id: string;
  name: string;
  arguments: string;
}

const MAX_STORED_SESSIONS = 20;
const SESSIONS_KEY = 'sessions';

/**
 * Owns the active TrueForge session: creation, turn streaming into a callback,
 * stop, and persistence of the last 20 sessions in workspaceState.
 */
export class SessionManager implements vscode.Disposable {
  private readonly log = logger();
  private activeSessionId: string | undefined;
  private turnAbort: AbortController | undefined;
  private readonly turnEndedEmitter = new vscode.EventEmitter<void>();
  readonly onTurnEnded = this.turnEndedEmitter.event;
  private readonly turnStartedEmitter = new vscode.EventEmitter<void>();
  readonly onTurnStarted = this.turnStartedEmitter.event;
  private readonly toolCallEmitter = new vscode.EventEmitter<RecordedToolCall>();
  readonly onToolCall = this.toolCallEmitter.event;
  private readonly approvalEmitter = new vscode.EventEmitter<ToolApprovalRequiredEvent>();
  readonly onApprovalRequired = this.approvalEmitter.event;
  /** Tool calls of the current turn, by id (the approval correlation key). */
  private readonly toolCalls = new Map<string, RecordedToolCall>();
  private readonly toolCallBuffer = new ToolCallBuffer();

  constructor(
    private readonly server: ServerManager,
    private readonly context: vscode.ExtensionContext,
    private readonly mcpServers?: () => Array<Record<string, unknown>>,
  ) {}

  private stored(): StoredSession[] {
    return this.context.workspaceState.get<StoredSession[]>(SESSIONS_KEY) ?? [];
  }

  listSessions(): StoredSession[] {
    return this.stored();
  }

  getActiveSessionId(): string | undefined {
    return this.activeSessionId;
  }

  setActive(sessionId: string | undefined): void {
    this.activeSessionId = sessionId;
  }

  async ensureSession(modelName: string): Promise<string> {
    if (this.activeSessionId) { return this.activeSessionId; }
    const mcpServers = this.mcpServers?.() ?? [];
    const session = await this.server.client.createSession({
      model: { name: modelName },
      instructions: 'You are ForgeGuard, a careful coding agent inside VS Code.',
      ...(mcpServers.length ? { mcp_servers: mcpServers } : {}),
    });
    this.activeSessionId = session.id;
    this.persist(session.id, `Session ${new Date().toLocaleString()}`);
    return session.id;
  }

  private persist(id: string, title: string): void {
    const next = [{ id, title, createdAt: new Date().toISOString() }, ...this.stored().filter((s) => s.id !== id)]
      .slice(0, MAX_STORED_SESSIONS);
    void this.context.workspaceState.update(SESSIONS_KEY, next);
  }

  isTurnRunning(): boolean {
    return this.turnAbort !== undefined;
  }

  /** The tool call with this id, recorded during the current turn. */
  getToolCall(id: string): RecordedToolCall | undefined {
    return this.toolCalls.get(id);
  }

  /** Every tool call recorded in the current turn. */
  getToolCalls(): RecordedToolCall[] {
    return [...this.toolCalls.values()];
  }

  /**
   * Send the approval decision as a new turn on the same session
   * (verified: docs/TRUEFORGE_NOTES.md — the decision is a `user.tool_approval`
   * input item keyed by tool_call_id).
   */
  async sendApproval(
    threadId: string,
    toolCallId: string,
    status: 'allow' | 'deny',
    reason?: string,
  ): Promise<void> {
    const sessionId = await this.ensureSession(this.lastModelName ?? 'openai/gpt-4o-mini');
    const input = [
      {
        type: 'user.tool_approval',
        thread_id: threadId,
        tool_call_id: toolCallId,
        approval: status === 'allow' ? { status: 'allow' } : { status: 'deny', reason: reason ?? 'The user rejected this change.' },
      },
    ];
    await this.server.client.sendTurn(sessionId, input, { onEvent: () => undefined, onEnd: () => undefined });
  }

  /** The model used for the last turn (needed to create the session). */
  private lastModelName: string | undefined;

  /**
   * Send a turn and stream validated events to `onEvent`. One active turn per
   * session (concurrency rule); rejects if a turn is already running.
   */
  async sendTurn(
    input: unknown[],
    onEvent: (event: StreamingEvent) => void,
    modelName: string,
  ): Promise<void> {
    if (this.turnAbort) { throw new Error('a turn is already running'); }
    if (this.server.getState() !== ServerState.Ready) { throw new Error('TrueForge is not running'); }

    // Claim the slot synchronously (before any await) so two concurrent calls
    // cannot both pass the one-turn guard.
    const controller = new AbortController();
    this.turnAbort = controller;
    this.turnStartedEmitter.fire();
    this.lastModelName = modelName;
    this.toolCalls.clear();
    this.toolCallBuffer.drain();
    let cancelled = false;
    try {
      const sessionId = await this.ensureSession(modelName);
      await this.server.client.sendTurn(sessionId, input, {
        onEvent: (raw) => {
          const event = streamingEventSchema.parse(raw); // already validated; belt-and-braces
          this.recordEvent(event);
          onEvent(event);
        },
        onEnd: () => undefined,
      }, controller.signal);
    } catch (e) {
      if (controller.signal.aborted) {
        cancelled = true;
      } else {
        throw e;
      }
    } finally {
      this.turnAbort = undefined;
      if (cancelled && this.activeSessionId) {
        // Stop means the server turn is cancelled too (FR-2: within 1s)
        void this.server.client.cancelSession(this.activeSessionId);
      }
      this.turnEndedEmitter.fire();
    }
  }

  /** Record tool calls and surface the approval gate. */
  private recordEvent(event: StreamingEvent): void {
    if (event.type === 'model.message.delta' || event.type === 'model.message') {
      this.toolCallBuffer.add(event.tool_calls);
      // A call is complete when its arguments are valid JSON. The server may
      // never send `finish_reason: tool_calls`, so we do not depend on it.
      const ready = this.toolCallBuffer.completeReady();
      const forced = event.type === 'model.message.delta' && event.finish_reason === 'tool_calls';
      const calls = forced ? [...ready, ...this.toolCallBuffer.drain()] : ready;
      this.emitToolCalls(calls);
      return;
    }
    if (event.type === 'turn.done') {
      // The turn is over: whatever is left in the buffer is what the model
      // asked for (a tool call without arguments, for instance).
      this.emitToolCalls(this.toolCallBuffer.drain());
      return;
    }
    if (event.type === 'tool.approval_required') {
      this.approvalEmitter.fire(event);
    }
  }

  private emitToolCalls(calls: ExtractedToolCall[]): void {
    for (const call of calls) {
      if (!call.id || this.toolCalls.has(call.id)) { continue; }
      const recorded: RecordedToolCall = { id: call.id, name: call.name, arguments: call.arguments ?? '{}' };
      this.toolCalls.set(call.id, recorded);
      this.toolCallEmitter.fire(recorded);
    }
  }

  async stopTurn(): Promise<void> {
    this.turnAbort?.abort();
    // cancelSession is invoked on stream teardown; call directly as well for speed
    if (this.activeSessionId) {
      void this.server.client.cancelSession(this.activeSessionId);
    }
  }

  /** New chat: clears the active session pointer (history stays in workspaceState). */
  newChat(): void {
    this.activeSessionId = undefined;
    this.log.info('new chat');
  }

  dispose(): void {
    this.turnAbort?.abort();
    this.turnEndedEmitter.dispose();
    this.turnStartedEmitter.dispose();
    this.toolCallEmitter.dispose();
    this.approvalEmitter.dispose();
  }
}
