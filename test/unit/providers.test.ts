import { describe, expect, it } from 'vitest';
import {
  MODES,
  PROVIDER_PRESETS,
  defaultModelsFor,
  manifestFor,
  modeById,
} from '../../src/providers/presets';
import { configureProviders } from '../../src/providers/setup';

/**
 * The two modes and their providers.
 *
 * TrueGuard never calls a provider itself: it registers the provider in
 * TrueForge and refers to the model by its TrueForge name.
 */

describe('the modes', () => {
  it('has a Fast and a Thinking mode', () => {
    expect(MODES.map((m) => m.id)).toEqual(['fast', 'thinking']);
    expect(modeById('fast')?.label).toBe('Fast');
    expect(modeById('thinking')?.label).toBe('Thinking');
    expect(modeById('nope')).toBeUndefined();
  });

  it('points Fast at Groq and Thinking at NVIDIA NIM', () => {
    expect(modeById('fast')?.defaultModel).toBe('groq/gpt-oss-120b');
    expect(modeById('thinking')?.defaultModel).toBe('nvidia/deepseek-ai/deepseek-v4.1-flash');
  });

  it('sends a reasoning effort with the thinking mode only', () => {
    expect(modeById('fast')?.reasoningEffort).toBeUndefined();
    expect(modeById('thinking')?.reasoningEffort).toBe('medium');
  });

  it('builds a default chain per mode', () => {
    const fast = defaultModelsFor(modeById('fast')!);
    expect(fast.length).toBe(1);
    expect(fast[0]?.ref).toBe('groq/gpt-oss-120b');
    expect(fast[0]?.label).toContain('Fast');
    const thinking = defaultModelsFor(modeById('thinking')!);
    expect(thinking[0]?.ref).toBe('nvidia/deepseek-ai/deepseek-v4.1-flash');
  });
});

describe('the provider manifests', () => {
  it('registers Groq as an OpenAI-compatible custom provider', () => {
    const manifest = manifestFor(PROVIDER_PRESETS[0]!, 'gsk_test');
    expect(manifest.type).toBe('custom');
    expect(manifest.name).toBe('groq');
    expect(manifest.base_url).toBe('https://api.groq.com/openai/v1');
    expect((manifest.auth as { api_key: string }).api_key).toBe('gsk_test');
    const models = manifest.models as Array<{ model_id: string; properties: Record<string, unknown> }>;
    expect(models[0]?.model_id).toBe('gpt-oss-120b');
    expect(models[0]?.properties.context_length).toBe(131072);
  });

  it('registers NVIDIA NIM with the DeepSeek model', () => {
    const manifest = manifestFor(PROVIDER_PRESETS[1]!, 'nvapi_test');
    expect(manifest.name).toBe('nvidia');
    expect(manifest.base_url).toBe('https://integrate.api.nvidia.com/v1');
    const models = manifest.models as Array<{ model_id: string }>;
    expect(models[0]?.model_id).toBe('deepseek-ai/deepseek-v4.1-flash');
  });
});

describe('the provider onboarding', () => {
  /** A secret storage stub. */
  function fakeSecrets(initial: Record<string, string> = {}): {
    get(key: string): Promise<string | undefined>;
    store(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    keys: Map<string, string>;
  } {
    const keys = new Map(Object.entries(initial));
    return {
      keys,
      async get(key) { return keys.get(key); },
      async store(key, value) { keys.set(key, value); },
      async delete(key) { keys.delete(key); },
    };
  }

  it('asks for a missing key, stores it and registers the provider', async () => {
    const secrets = fakeSecrets();
    const registered: Array<{ name: string; key: string }> = [];
    const client = {
      upsertModelProvider: async (manifest: Record<string, unknown>) => {
        registered.push({
          name: String(manifest.name),
          key: (manifest.auth as { api_key: string }).api_key,
        });
      },
    };
    const asked: string[] = [];
    const result = await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async (preset) => {
        asked.push(preset.id);
        return `key-for-${preset.id}`;
      },
    });
    expect(asked).toEqual(['groq', 'nvidia']);
    expect(result.registered).toEqual(['groq', 'nvidia']);
    expect(result.failed).toEqual([]);
    // The keys are in the secret storage, not in the settings.
    expect(secrets.keys.get('trueguard.provider.groq.apiKey')).toBe('key-for-groq');
    expect(registered[0]?.key).toBe('key-for-groq');
  });

  it('does not ask again for a key that is already stored', async () => {
    const secrets = fakeSecrets({ 'trueguard.provider.groq.apiKey': 'gsk_existing' });
    const asked: string[] = [];
    const client = { upsertModelProvider: async () => undefined };
    await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async (preset) => {
        asked.push(preset.id);
        return 'never';
      },
    });
    expect(asked).toEqual(['nvidia']);
  });

  it('skips a provider when the user gives no key', async () => {
    const secrets = fakeSecrets();
    const client = { upsertModelProvider: async () => undefined };
    const result = await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => undefined,
    });
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual(['groq', 'nvidia']);
  });

  it('reports a provider that fails to register, and keeps going', async () => {
    const secrets = fakeSecrets();
    const client = {
      upsertModelProvider: async (manifest: Record<string, unknown>) => {
        if (manifest.name === 'groq') { throw new Error('401 unauthorized'); }
      },
    };
    const result = await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => 'key',
    });
    expect(result.failed).toEqual(['groq']);
    expect(result.registered).toEqual(['nvidia']);
  });

  it('never writes a key into the log or the result', async () => {
    const secrets = fakeSecrets();
    const client = { upsertModelProvider: async () => undefined };
    const result = await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => 'super-secret-key',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-key');
  });
});
