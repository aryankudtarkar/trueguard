#!/usr/bin/env node
/**
 * Register the model providers TrueForge needs.
 *
 *  - the DEVELOPMENT provider: the fake OpenAI-compatible server
 *    (spikes/fake-openai.mjs) with two models — one that works and one that
 *    always fails, so the failover can be demonstrated without a real rate
 *    limit;
 *  - the REAL providers: read from .env, never printed, never committed.
 *
 * Usage: npm run setup
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE_URL = process.env.TRUEFORGE_BASE_URL ?? 'http://localhost:8790';
const FAKE_LLM_URL = process.env.FAKE_LLM_URL ?? 'http://127.0.0.1:8799';

/**
 * The two providers TrueGuard's modes use.
 * Both are OpenAI-compatible, so they are registered as 'custom' providers.
 */
const PROVIDERS = [
  {
    name: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    models: [{ modelId: 'gpt-oss-120b', contextLength: 131072, maxOutputTokens: 32768 }],
  },
  {
    name: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envKey: 'NVIDIA_API_KEY',
    models: [
      { modelId: 'deepseek-ai/deepseek-v4.1-flash', contextLength: 131072, maxOutputTokens: 32768 },
    ],
  },
];

/** Register (or update) a model provider. */
async function putProvider(name, manifest) {
  const existing = await getProviders();
  const method = existing.includes(name) ? 'PUT' : 'POST';
  const res = await fetch(`${BASE_URL}/api/v1/settings/model-providers`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ manifest }),
  });
  if (!res.ok) {
    throw new Error(`${method} ${name} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`provider ${name} registered (${method})`);
}

async function getProviders() {
  const res = await fetch(`${BASE_URL}/api/v1/settings/model-providers`);
  if (!res.ok) { return []; }
  const body = await res.json();
  return (body?.data ?? []).map((p) => p.name);
}

/** The development provider: the fake OpenAI-compatible server. */
async function registerFakeProvider() {
  await putProvider('fake-provider', {
    type: 'custom',
    name: 'fake-provider',
    base_url: FAKE_LLM_URL,
    auth: { api_key: 'sk-fake-provider-key' },
    models: [
      {
        model_id: 'test-model',
        name: 'test-model',
        properties: { context_length: 128000, max_output_tokens: 4096 },
      },
      {
        // Any model whose name contains "failNNN" fails that way: the
        // failover demo uses it as the primary.
        model_id: 'fail429-model',
        name: 'fail429-model',
        properties: { context_length: 128000, max_output_tokens: 4096 },
      },
    ],
  });
}

/** The real providers from .env: GROQ_API_KEY, NVIDIA_API_KEY, ... */
async function registerRealProviders() {
  if (!existsSync('.env')) {
    console.log('no .env found: only the development provider was registered');
    return;
  }
  const env = await readFile('.env', 'utf8');
  const values = new Map();
  for (const line of env.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$/.exec(line);
    if (match) { values.set(match[1], match[2].replace(/^["']|["']$/g, '')); }
  }

  for (const provider of PROVIDERS) {
    const key = values.get(provider.envKey);
    if (!key) {
      console.log(`${provider.label}: no ${provider.envKey} in .env, skipped`);
      continue;
    }
    await putProvider(provider.name, {
      type: 'custom',
      name: provider.name,
      base_url: provider.baseUrl,
      auth: { api_key: key },
      models: provider.models.map((m) => ({
        model_id: m.modelId,
        name: m.modelId,
        properties: {
          context_length: m.contextLength,
          max_output_tokens: m.maxOutputTokens,
          reasoning_efforts: ['none', 'low', 'medium', 'high'],
        },
      })),
    });
  }

  // Any other provider the user put in .env (OPENAI_API_KEY, …).
  const providers = [
    { key: 'OPENAI_API_KEY', name: 'openai', models: ['gpt-4o-mini'] },
    { key: 'ANTHROPIC_API_KEY', name: 'anthropic', models: ['claude-3-5-haiku-latest'] },
    { key: 'GEMINI_API_KEY', name: 'google-gemini', models: ['gemini-2.0-flash'] },
  ];
  for (const provider of providers) {
    const key = values.get(provider.key);
    if (!key) { continue; }
    await putProvider(provider.name, {
      type: provider.name,
      name: provider.name,
      auth: { api_key: key },
      models: provider.models.map((m) => ({
        model_id: m,
        name: m,
        properties: { context_length: 128000, max_output_tokens: 4096 },
      })),
    });
  }
}

async function main() {
  const res = await fetch(`${BASE_URL}/api/v1/users`).catch(() => null);
  if (!res?.ok) {
    console.error(`TrueForge is not answering at ${BASE_URL}. Start it with: npm run trueforge`);
    process.exit(1);
  }
  await registerFakeProvider();
  await registerRealProviders();
  console.log('done. The models are listed in Settings (TrueGuard: Models).');
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
