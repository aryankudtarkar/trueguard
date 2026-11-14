import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

/**
 * The modes in the running extension (audit of 2026-11-14).
 *
 * The mode decides which model chain a turn uses, and the Thinking mode
 * sends a reasoning effort with its model.
 */

interface Api {
  sessions: {
    mode(): string;
    activeModel(): string;
    reasoningEffort(): string | undefined;
    configuredModels(): Array<{ id: string; label: string; ref: string }>;
  };
}

describe('the modes in the running extension', () => {
  it('starts in Fast mode with the configured chain', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const api = (await ext?.activate()) as unknown as Api;
    expect(api.sessions.mode()).toBe('fast');
    // The chain is empty until a provider is registered — the extension must
    // not invent a model the user cannot use.
    expect(Array.isArray(api.sessions.configuredModels())).toBe(true);
  });

  it('reads the mode from the settings', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const api = (await ext?.activate()) as unknown as Api;
    const config = vscode.workspace.getConfiguration('trueguard');
    const previous = config.get<string>('mode', 'fast');
    try {
      await config.update('mode', 'thinking', vscode.ConfigurationTarget.Global);
      expect(api.sessions.mode()).toBe('thinking');
      // The Thinking mode asks for a deeper effort.
      expect(api.sessions.reasoningEffort()).toBe('medium');
      await config.update('mode', 'fast', vscode.ConfigurationTarget.Global);
      expect(api.sessions.mode()).toBe('fast');
      expect(api.sessions.reasoningEffort()).toBeUndefined();
    } finally {
      await config.update('mode', previous, vscode.ConfigurationTarget.Global);
    }
  });

  it('uses the chain of the active mode when it has one', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const api = (await ext?.activate()) as unknown as Api;
    const config = vscode.workspace.getConfiguration('trueguard');
    const key = 'modes.thinking.models';
    const previous = config.get<Array<{ id: string; label: string; ref: string }>>(key, []);
    const previousMode = config.get<string>('mode', 'fast');
    try {
      await config.update('mode', 'thinking', vscode.ConfigurationTarget.Global);
      await config.update(
        key,
        [{ id: 'x', label: 'Test model', ref: 'fake-provider/test-model' }],
        vscode.ConfigurationTarget.Global,
      );
      expect(api.sessions.configuredModels()[0]?.ref).toBe('fake-provider/test-model');
      expect(api.sessions.activeModel()).toBe('fake-provider/test-model');
    } finally {
      await config.update(key, previous, vscode.ConfigurationTarget.Global);
      await config.update('mode', previousMode, vscode.ConfigurationTarget.Global);
    }
  });

  it('registers the provider command and the mode command', async () => {
    const cmds = await vscode.commands.getCommands(true);
    expect(cmds).toContain('trueguard.configureProviders');
    expect(cmds).toContain('trueguard.switchMode');
  });
});
