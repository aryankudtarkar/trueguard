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
import { FailoverManager, type ModelProfile } from '../failover/manager';
import { SessionLog } from '../util/sessionLog';

export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
}

/**
 * The message that continues a failed turn on another model.
 *
 * It continues, it does not repeat: re-sending the original request would
 * make the model start the task over (cline/cline#713 reports exactly this
 * complaint). The tools that already ran are named, and the idempotency
 * guard makes sure they cannot run twice.
 */
export function continuationMessage(error: string, completedTools: readonly string[] = []): string {
  const lines = [
    `The previous attempt failed: ${error}.`,
    'Continue where you left off. Do not repeat the work that already succeeded.',
  ];
  if (completedTools.length) {
    lines.push(`These tools already ran successfully: ${completedTools.join(', ')}. Do not run them again.`);
  }
  return lines.join(' ');
}

/** A tool call the model made, with the arguments it sent. */
export interface RecordedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The user-visible failover notice (FR-7: once, calmly). */
export interface FailoverNotice {
  /** The sentence shown in the chat. */
  notice: string;
  /** The model the turn continues on. */
  model: string;
  /** The model that failed. */
  from?: string;
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
  private readonly failover = new FailoverManager([], {
    enabled: true,
    cooldownMs: 60_000,
  });
  private readonly failoverEmitter = new vscode.EventEmitter<FailoverNotice>();
  readonly onFailover = this.failoverEmitter.event;
  /** The error of the last turn, if it failed. */
  private turnError: string | undefined;
  /** The tools that already returned a result in this turn. */
  private readonly completedTools = new Set<string>();

  constructor(
    private readonly server: ServerManager,
    private readonly context: vscode.ExtensionContext,
    private readonly mcpServers?: () => Array<Record<string, unknown>>,
    /** The redacted per-session event log (FR-8). */
    private readonly sessionLog?: SessionLog,
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
   *
   * When the provider fails transiently, the turn continues on the next model
   * (G3): the session's model is patched and the turn is sent again. At most
   * one attempt per model per turn.
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
    this.completedTools.clear();
    this.failover.setModels(this.configuredModels());
    this.applyFailoverSettings();
    this.failover.onTurnStart();
    let cancelled = false;
    try {
      const sessionId = await this.ensureSession(modelName);
      let attemptModel = modelName;
      // The first attempt sends the user's request. A retry sends a
      // CONTINUATION, never the request again: re-sending it would make the
      // model start the task over (this is exactly the trap Cline users
      // report in cline/cline#713).
      let attemptInput = input;
      for (;;) {
        this.turnError = undefined;
        await this.server.client.sendTurn(sessionId, attemptInput, {
          onEvent: (raw) => {
            const event = streamingEventSchema.parse(raw); // already validated; belt-and-braces
            if (event.type === 'turn.done' && event.state.status === 'error') {
              this.turnError = event.state.message ?? 'the provider failed';
            }
            this.recordEvent(event);
            void this.logEvent(sessionId, event);
            onEvent(event);
          },
          onEnd: () => undefined,
        }, controller.signal);

        if (!this.turnError) {
          this.failover.noteSuccess(attemptModel);
          return;
        }
        if (controller.signal.aborted) { return; }

        // The provider failed: try another model (G3).
        const decision = await this.failover.handleFailure({ message: this.turnError });
        if (decision.action === 'giveup' || !decision.model) {
          throw new Error(this.turnError);
        }
        const from = this.failover.profiles.find((p) => p.ref === attemptModel)?.label;
        this.log.warn(`failover: ${this.turnError} → ${decision.model.label}`);
        await this.server.client.updateSessionModel(sessionId, { name: decision.model.ref });
        this.failoverEmitter.fire({
          notice: decision.notice ?? `Switched to ${decision.model.label}.`,
          model: decision.model.label,
          ...(from ? { from } : {}),
        });
        attemptModel = decision.model.ref;
        attemptInput = [{ type: 'user.message', content: this.continuationMessage(this.turnError) }];
      }
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

  /**
   * The message that continues a failed turn on another model.
   *
   * It continues, it does not repeat: the tools that already ran are named so
   * the model does not do them again (and the idempotency guard makes sure
   * they cannot run twice).
   */
  private continuationMessage(error: string): string {
    return continuationMessage(error, [...this.completedTools]);
  }


  /** Append one event to the session log (never blocks the turn). */
  private async logEvent(sessionId: string, event: StreamingEvent): Promise<void> {
    if (!this.sessionLog) { return; }
    // Only the interesting events are logged: the deltas would drown it.
    if (event.type === 'model.message.delta') { return; }
    await this.sessionLog.append(sessionId, event.type, event);
  }

  /** The configured model profiles (forgeguard.models). */
  configuredModels(): ModelProfile[] {
    const models = vscode.workspace.getConfiguration('forgeguard').get<ModelProfile[]>('models', []);
    return models.filter((m) => typeof m?.ref === 'string' && m.ref.length > 0);
  }

  /** The failover settings (visible and tunable, unlike a hard-coded retry). */
  private applyFailoverSettings(): void {
    const cfg = vscode.workspace.getConfiguration('forgeguard.failover');
    this.failover.setPolicy({
      enabled: cfg.get<boolean>('enabled', true),
      cooldownMs: Math.max(5, cfg.get<number>('breakerCooldownSec', 60)) * 1000,
    });
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
    if (event.type === 'tool.response') {
      const call = this.toolCalls.get(event.tool_call_id ?? '');
      if (call) { this.completedTools.add(call.name); }
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
    this.failoverEmitter.dispose();
  }
}
