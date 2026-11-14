import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { configureProviders } from '../../src/providers/setup';
import { PROVIDER_PRESETS } from '../../src/providers/presets';

/**
 * The key handling (audit of 2026-11-14).
 *
 * An API key is a secret: it may travel to TrueForge's settings API and
 * nowhere else. Not into the settings file, not into a log, not into the
 * repository, not into the chat.
 */

const SECRET = 'gsk_super_secret_value_1234567890';

describe('the API key handling', () => {
  it('never reaches the settings file', async () => {
    const secrets = {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    };
    const client = { upsertModelProvider: async () => undefined };
    await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => SECRET,
    });
    // Nothing in the source tree may contain the key.
    const roots = ['src', 'webview', 'docs', 'examples', 'scripts'];
    for (const root of roots) {
      const files = await collect(path.join(process.cwd(), root));
      for (const file of files) {
        const text = await readFile(file, 'utf8');
        expect(text.includes(SECRET), `${file} contains the key`).toBe(false);
      }
    }
  });

  it('is stored in the secret storage, not in the settings', async () => {
    const stored = new Map<string, string>();
    const secrets = {
      get: async (key: string) => stored.get(key),
      store: async (key: string, value: string) => { stored.set(key, value); },
      delete: async (key: string) => { stored.delete(key); },
    };
    const client = { upsertModelProvider: async () => undefined };
    await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => SECRET,
    });
    expect(stored.get('trueguard.provider.groq.apiKey')).toBe(SECRET);
    expect(stored.get('trueguard.provider.nvidia.apiKey')).toBe(SECRET);
    // The settings never saw it.
    const config = vscode.workspace.getConfiguration('trueguard');
    expect(config.get('apiKey')).toBeUndefined();
  });

  it('is sent to TrueForge and nowhere else', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const secrets = {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    };
    const client = {
      upsertModelProvider: async (manifest: Record<string, unknown>) => { seen.push(manifest); },
    };
    await configureProviders({
      client: client as never,
      secrets: secrets as never,
      askForKey: async () => SECRET,
    });
    expect(seen.length).toBe(2);
    for (const manifest of seen) {
      expect((manifest.auth as { api_key: string }).api_key).toBe(SECRET);
      // The manifest only carries the provider's own details.
      expect(Object.keys(manifest).sort()).toEqual(['auth', 'base_url', 'models', 'name', 'type']);
    }
  });

  it('the provider presets carry no key, only a hint of its shape', () => {
    for (const preset of PROVIDER_PRESETS) {
      // A hint ("gsk_…") is fine; a real key is not.
      expect(JSON.stringify(preset)).not.toMatch(/gsk_[A-Za-z0-9]{10,}/);
      expect(JSON.stringify(preset)).not.toMatch(/nvapi-[A-Za-z0-9]{10,}/);
    }
  });
});

/** Every file under a directory. */
async function collect(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...(await collect(full))); } else { out.push(full); }
  }
  return out;
}
