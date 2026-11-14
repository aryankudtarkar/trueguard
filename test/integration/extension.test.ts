import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

// Integration: the extension activates in a real VS Code (via @vscode/test-electron
// runner, see scripts/test-integration.mjs) and contributes views and commands.
describe('extension activation', () => {
  it('activates and contributes the settings schema', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    expect(ext !== undefined).toBe(true);
    await ext?.activate();
    expect(ext?.isActive ?? false).toBe(true);
    const cfg = vscode.workspace.getConfiguration('trueguard');
    expect(cfg.get('trueforge.baseUrl')).toBe('http://localhost:8790');
    expect(cfg.has('models')).toBe(true);
    expect(cfg.has('dev.enableFaultInjection')).toBe(true);
  });

  it('ships the webview assets the chat needs', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const root = ext?.extensionUri.fsPath ?? '';
    // The chat loads its script AND its stylesheet from out/webview: a
    // packaged extension without them renders unstyled.
    for (const asset of ['main.js', 'styles.css']) {
      let exists = false;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(`${root}/out/webview/${asset}`));
        exists = true;
      } catch {
        exists = false;
      }
      expect(exists, `missing out/webview/${asset}`).toBe(true);
    }
  });

  it('registers all TrueGuard commands', async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of [
      'trueguard.startTrueForge',
      'trueguard.stopTrueForge',
      'trueguard.newChat',
      'trueguard.stopTurn',
      'trueguard.switchModel',
      'trueguard.showSessionLog',
    ]) {
      expect(cmds, `missing command ${c}`).toContain(c);
    }
  });
});
