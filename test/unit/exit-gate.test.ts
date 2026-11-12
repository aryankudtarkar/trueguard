import { beforeAll, describe, expect, it } from 'vitest';
import { TrueForgeClient } from '../../src/trueforge/client';

// Phase 1 exit gate smoke: real TrueForge + fake OpenAI provider (spikes/fake-openai.mjs).
// Skipped automatically when the server is not running (use `npm run trueforge`).
let live = false;

describe.skipIf(!live)('phase 1 exit gate: real TrueForge', () => {
  const client = new TrueForgeClient('http://localhost:8790');

  beforeAll(async () => {
    live = await fetch('http://localhost:8790/api/v1/users', { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false);
  }, 5000);

  it('streams a real answer through the verified client path', async () => {
    const session = await client.createSession({ model: { name: 'fake-provider/test-model' } });
    const events: unknown[] = [];
    await client.sendTurn(
      session.id,
      [{ type: 'user.message', content: 'Say hello.' }],
      { onEvent: (e) => events.push(e), onEnd: () => undefined },
    );
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('model.message.delta');
    expect(types.at(-1)).toBe('turn.done');
    const text = events
      .filter((e) => (e as { type: string }).type === 'model.message.delta')
      .map((e) => (e as { content?: string }).content ?? '')
      .join('');
    expect(text).toContain('Hello from the fake model');
  });

  it('cancels a stall mid-turn within 1 s via abort + cancel', async () => {
    await fetch('http://127.0.0.1:8799/set-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'stall' }) });
    try {
      const session = await client.createSession({ model: { name: 'fake-provider/test-model' } });
      const controller = new AbortController();
      const started = Date.now();
      setTimeout(() => controller.abort(), 100);
      const stoppedAt = await client.sendTurn(session.id, [{ type: 'user.message', content: 'hi' }], {
        onEvent: () => undefined,
        onEnd: () => undefined,
      }, controller.signal).then(() => Date.now());
      await client.cancelSession(session.id);
      expect(stoppedAt - started).toBeLessThan(1100);
    } finally {
      await fetch('http://127.0.0.1:8799/set-mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'echo' }) });
    }
  });
});
