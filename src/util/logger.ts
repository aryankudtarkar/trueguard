import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/** The shared TrueGuard log channel (created on first use). */
export function logger(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('TrueGuard', { log: true });
  }
  return channel;
}

/** Redact anything that looks like a key or token before logging. */
export function redact(text: string): string {
  return text
    .replace(/(authorization|api[_-]?key|token|secret|password)"?\s*[:=]\s*"?\S+/gi, '$1=<redacted>')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-<redacted>');
}
