import * as vscode from 'vscode';
import { ServerState, type ServerManager } from './serverManager';
import { streamingEventSchema, type StreamingEvent } from './schemas';
import { logger } from '../util/logger';

export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
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

  constructor(private readonly server: ServerManager, private readonly context: vscode.ExtensionContext) {}

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
    const session = await this.server.client.createSession({
      model: { name: modelName },
      instructions: 'You are ForgeGuard, a careful coding agent inside VS Code.',
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

    const sessionId = await this.ensureSession(modelName);
    const controller = new AbortController();
    this.turnAbort = controller;
    let cancelled = false;
    try {
      await this.server.client.sendTurn(sessionId, input, {
        onEvent: (raw) => {
          const event = streamingEventSchema.parse(raw); // already validated; belt-and-braces
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
      if (cancelled) {
        // Stop means the server turn is cancelled too (FR-2: within 1s)
        void this.server.client.cancelSession(sessionId);
      }
      this.turnEndedEmitter.fire();
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
  }
}
