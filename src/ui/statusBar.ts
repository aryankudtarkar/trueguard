import * as vscode from 'vscode';
import { ServerState, type ServerManager } from '../trueforge/serverManager';
import { type SessionManager } from '../trueforge/sessionManager';

/**
 * The single ForgeGuard status bar item (left side).
 * Idle: $(shield) ForgeGuard · Working: $(loading~spin) Working ·
 * Pending: $(eye) N to review · Failover: $(warning) Model · Offline: $(error) TrueForge offline
 */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private pending = 0;
  private failoverLabel: string | undefined;
  private lastState: ServerState = ServerState.Stopped;

  constructor(server: ServerManager, sessions: SessionManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    server.onStateChange((state) => {
      this.lastState = state;
      this.render();
    });
    sessions.onTurnEnded(() => this.render());
    this.render();
    this.item.show();
  }

  setPending(count: number): void {
    this.pending = count;
    this.render();
  }

  setFailover(label: string | undefined): void {
    this.failoverLabel = label;
    this.render();
  }

  private render(): void {
    const s = this.lastState;
    if (s === ServerState.Failed || s === ServerState.Stopped) {
      this.item.text = '$(error) TrueForge offline';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.item.tooltip = 'ForgeGuard can not reach TrueForge. Click to start it.';
      this.item.command = 'forgeguard.startTrueForge';
    } else if (s === ServerState.Starting) {
      this.item.text = '$(loading~spin) Starting TrueForge';
      this.item.backgroundColor = undefined;
      this.item.tooltip = 'TrueForge is starting…';
      this.item.command = undefined;
    } else if (this.failoverLabel) {
      this.item.text = `$(warning) ${this.failoverLabel}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.item.tooltip = `The primary model failed; turns now use ${this.failoverLabel}. Click to switch models.`;
      this.item.command = 'forgeguard.switchModel';
    } else if (this.pending > 0) {
      this.item.text = `$(eye) ${this.pending} to review`;
      this.item.backgroundColor = undefined;
      this.item.tooltip = 'ForgeGuard has changes waiting for your review. Click to review.';
      this.item.command = 'forgeguard.reviewNextChange';
    } else {
      this.item.text = '$(shield) ForgeGuard';
      this.item.backgroundColor = undefined;
      this.item.tooltip = 'ForgeGuard is ready. Nothing is written without your review.';
      this.item.command = 'forgeguard.chat.focus';
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
