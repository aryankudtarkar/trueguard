import { describe, expect, it } from 'vitest';
import { TrueForgeClient } from '../../src/trueforge/client';
import type { StreamingEvent } from '../../src/trueforge/schemas';

// Phase 1 exit gate smoke: real TrueForge + fake OpenAI provider (spikes/fake-openai.mjs).
// Skipped at runtime when the server is not running (use `npm run trueforge`).

async function probe(): Promise<boolean> {
  return fetch('http://localhost:8790/api/v1/users', { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
}

describe('phase 1 exit gate: real TrueForge', () => {
  const client = new TrueForgeClient('http://localhost:8790');

  it('streams a real answer through the verified client path', async (ctx) => {
    if (!(await probe())) { ctx.skip(); }
    const session = await client.createSession({ model: { name: 'fake-provider/test-model' } });
    const events: StreamingEvent[] = [];
    await client.sendTurn(
      session.id,
      [{ type: 'user.message', content: 'Say hello.' }],
      { onEvent: (e) => events.push(e), onEnd: () => undefined },
    );
    const types = events.map((e) => e.type);
    expect(types).toContain('model.message.delta');
    expect(types.at(-1)).toBe('turn.done');
    const text = events
      .filter((e): e is Extract<StreamingEvent, { type: 'model.message.delta' }> => e.type === 'model.message.delta')
      .map((e) => e.content ?? '')
      .join('');
    // The development provider answers from what it was given: the answer
    // refers to the question, it is not a canned string.
    expect(text).toContain('Say hello');
  });

  it('cancels a stall mid-turn within 1 s via abort + cancel', async (ctx) => {
    if (!(await probe())) { ctx.skip(); }
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
