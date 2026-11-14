import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

/**
 * Model discovery: a fresh install must work without the user typing a
 * single model name — TrueForge is the source of truth for what exists.
 */

interface Api {
  sessions: {
    refreshModels(): Promise<void>;
    configuredModels(): Array<{ id: string; label: string; ref: string }>;
    activeModel(): string;
  };
}

describe('model discovery', () => {
  it('finds the models TrueForge knows about', async () => {
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const api = (await ext?.activate()) as unknown as Api;
    await api.sessions.refreshModels();
    const models = api.sessions.configuredModels();
    // The running TrueForge has the development provider registered.
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.ref.includes('test-model'))).toBe(true);
    // The names are TrueForge names, not local guesses.
    expect(models.every((m) => m.ref.includes('/'))).toBe(true);
    expect(api.sessions.activeModel()).toBe(models[0]?.ref);
  });
});
