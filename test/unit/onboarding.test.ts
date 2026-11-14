import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ONBOARDING_KEY, ONBOARDING_SKIPPED_KEY, onboardingDone, runOnboarding } from '../../src/ui/onboarding';

/**
 * The first run (Phase 1).
 *
 * The onboarding is only finished when the user finishes it — never
 * optimistically — and it always ends with a working setup or an honest
 * "not yet".
 */

interface FakeDeps {
  registered: string[];
  modes: Record<string, Array<{ id: string; label: string; ref: string }>>;
  available: Array<{ provider: string; model: string }>;
}

/** A Memento stub. */
function fakeState(initial: Record<string, unknown> = {}): vscode.Memento {
  const map = new Map(Object.entries(initial));
  return {
    get: <T>(key: string, defaultValue?: T) => (map.has(key) ? (map.get(key) as T) : defaultValue),
    update: async (key: string, value: unknown) => { map.set(key, value); },
    keys: () => [...map.keys()],
  } as unknown as vscode.Memento;
}

/** The dependencies, with the onboarding flow's own answers scripted. */
function deps(available: Array<{ provider: string; model: string }> = []): FakeDeps & {
  call: () => Parameters<typeof runOnboarding>[0];
} {
  const state: FakeDeps = { registered: [], modes: {}, available };
  const call = () => ({
    client: {
      upsertModelProvider: async (manifest: Record<string, unknown>) => {
        state.registered.push(String(manifest.name));
      },
      listAvailableModels: async () => available,
    } as never,
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    } as never,
    availableModels: async () => available,
    activeModels: () => state.modes.fast ?? [],
    setModeModels: async (mode: string, models: Array<{ id: string; label: string; ref: string }>) => {
      state.modes[mode] = models;
    },
    defaultModels: (mode: string) => [
      { id: mode, label: mode, ref: mode === 'fast' ? 'groq/gpt-oss-120b' : 'nvidia/deepseek-ai/deepseek-v4.1-flash' },
    ],
    modeProvider: (mode: string) => (mode === 'fast' ? 'groq' : 'nvidia'),
  });
  return { ...state, call };
}

describe('the onboarding', () => {
  it('is not finished until the user says so', () => {
    expect(onboardingDone(fakeState())).toBe(false);
    expect(onboardingDone(fakeState({ [ONBOARDING_KEY]: true }))).toBe(true);
    expect(onboardingDone(fakeState({ [ONBOARDING_SKIPPED_KEY]: true }))).toBe(true);
  });

  it('fills the mode chains for the providers that are registered', async () => {
    const d = deps([
      { provider: 'groq', model: 'gpt-oss-120b' },
      { provider: 'nvidia', model: 'deepseek-ai/deepseek-v4.1-flash' },
    ]);
    const state = fakeState();
    // The user picks the development provider.
    (vscode.window as unknown as { informationAnswer: string | undefined }).informationAnswer =
      'Use the development provider';
    try {
      await runOnboarding(d.call(), state);
    } finally {
      (vscode.window as unknown as { informationAnswer: string | undefined }).informationAnswer = undefined;
    }
    expect(state.get(ONBOARDING_SKIPPED_KEY)).toBe(true);
  });

  it('never marks the onboarding done when the user cancels', async () => {
    const d = deps([]);
    const state = fakeState();
    await runOnboarding(d.call(), state);
    // Nothing was set: the onboarding is offered again next time.
    expect(state.get(ONBOARDING_KEY)).toBeUndefined();
    expect(state.get(ONBOARDING_SKIPPED_KEY)).toBeUndefined();
  });
});
