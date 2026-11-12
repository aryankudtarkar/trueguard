import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

// Integration: the extension activates in a real VS Code (via @vscode/test-electron
// runner, see scripts/test-integration.mjs) and contributes views and commands.
describe('extension activation', () => {
  it('activates and contributes the settings schema', async () => {
    const ext = vscode.extensions.getExtension('forgeguard-dev.forgeguard');
    expect(ext !== undefined).toBe(true);
    await ext?.activate();
    expect(ext?.isActive ?? false).toBe(true);
    const cfg = vscode.workspace.getConfiguration('forgeguard');
    expect(cfg.get('trueforge.baseUrl')).toBe('http://localhost:8790');
    expect(cfg.has('models')).toBe(true);
    expect(cfg.has('dev.enableFaultInjection')).toBe(true);
  });

  it('registers all ForgeGuard commands', async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of [
      'forgeguard.startTrueForge',
      'forgeguard.stopTrueForge',
      'forgeguard.newChat',
      'forgeguard.stopTurn',
      'forgeguard.switchModel',
      'forgeguard.showSessionLog',
    ]) {
      expect(cmds, `missing command ${c}`).toContain(c);
    }
  });
});
