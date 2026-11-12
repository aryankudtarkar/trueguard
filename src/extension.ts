import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  // Phase 0 skeleton: wiring and feature modules land in Phases 1+.
  const channel = vscode.window.createOutputChannel('ForgeGuard');
  context.subscriptions.push(channel);
  channel.appendLine('ForgeGuard activated (Phase 0 skeleton)');
}

export function deactivate(): void {
  // Nothing to clean up yet.
}
