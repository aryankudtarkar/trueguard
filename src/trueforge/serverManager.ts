import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import { logger, redact } from '../util/logger';
import { TrueForgeClient } from './client';

export enum ServerState {
  Stopped = 'stopped',
  Starting = 'starting',
  Ready = 'ready',
  Failed = 'failed',
}

export const SERVER_STATE_KEY = 'serverState';

/**
 * Owns the TrueForge server lifecycle: start (child process), health check,
 * stop. Kills only the process it spawned.
 */
export class ServerManager implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<ServerState>();
  readonly onStateChange = this.stateEmitter.event;

  private state: ServerState = ServerState.Stopped;
  private child: ChildProcess | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private disposed = false;
  private readonly log = logger();

  readonly client: TrueForgeClient;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.client = new TrueForgeClient(ServerManager.baseUrl());
    void this.checkHealth();
  }

  static baseUrl(): string {
    const cfg = vscode.workspace.getConfiguration('trueguard.trueforge');
    return String(cfg.get('baseUrl', 'http://localhost:8790'));
  }

  getState(): ServerState {
    return this.state;
  }

  private setState(next: ServerState): void {
    if (this.state === next) { return; }
    this.state = next;
    this.log.info(`TrueForge state: ${next}`);
    void this.context.workspaceState.update(SERVER_STATE_KEY, next);
    this.stateEmitter.fire(next);
    if (next === ServerState.Ready) {
      this.clearPoll();
    } else if (next === ServerState.Stopped || next === ServerState.Failed) {
      this.scheduleReconnect();
    }
  }

  /**
   * Reconnect with capped exponential backoff: while offline (and not disposed
   * or starting), probe health until TrueForge answers, then flip to Ready.
   * Keeps the UI from being stuck Offline after an external server restart
   * (FR-2 AC: a TrueForge restart is survived).
   */
  private scheduleReconnect(): void {
    if (this.disposed || this.pollTimer) { return; }
    let delay = 1000;
    const attempt = async (): Promise<void> => {
      this.pollTimer = undefined;
      if (this.disposed || this.state !== ServerState.Stopped) { return; }
      if (await this.client.health(2000)) {
        this.setState(ServerState.Ready);
        return;
      }
      delay = Math.min(delay * 2, 10_000);
      this.pollTimer = setTimeout(() => void attempt(), delay);
      this.pollTimer.unref?.();
    };
    this.pollTimer = setTimeout(() => void attempt(), delay);
    this.pollTimer.unref?.();
  }

  private clearPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /** One-shot health probe at activation; does not spawn. */
  private async checkHealth(): Promise<void> {
    const ok = await this.client.health();
    if (ok) {
      this.setState(ServerState.Ready);
    } else {
      // setState no-ops Stopped→Stopped, so schedule the reconnect poll here
      this.setState(ServerState.Stopped);
      this.scheduleReconnect();
    }
  }

  /** Spawn `npx @truefoundry/trueforge@latest` as a child process. */
  async start(): Promise<void> {
    if (this.state === ServerState.Ready || this.state === ServerState.Starting) { return; }
    this.setState(ServerState.Starting);
    try {
      const baseUrl = ServerManager.baseUrl();
      const port = new URL(baseUrl).port || '80';
      this.child = spawn('npx', ['@truefoundry/trueforge@latest'], {
        env: {
          ...process.env,
          PORT: port,
          // Allow the extension's MCP server on loopback while keeping the guard on
          OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify(['localhost', '127.0.0.1']),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.child.stdout?.on('data', (d: Buffer) => this.log.info(redact(d.toString())));
      this.child.stderr?.on('data', (d: Buffer) => this.log.warn(redact(d.toString())));
      this.child.on('exit', (code) => {
        this.log.warn(`TrueForge process exited (code ${String(code)})`);
        this.child = undefined;
        this.setState(ServerState.Stopped);
      });
      await this.waitUntilReady(60_000);
    } catch (e) {
      this.log.error(redact(`start failed: ${String(e)}`));
      this.setState(ServerState.Failed);
      throw e;
    }
  }

  private async waitUntilReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.client.health(2000)) {
        this.setState(ServerState.Ready);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    this.setState(ServerState.Failed);
    throw new Error('TrueForge did not become ready in time');
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.setState(ServerState.Stopped);
      return;
    }
    const c = this.child;
    this.child = undefined;
    c.kill('SIGTERM');
    this.setState(ServerState.Stopped);
  }

  dispose(): void {
    this.disposed = true;
    this.clearPoll();
    void this.stop();
    this.stateEmitter.dispose();
  }
}
