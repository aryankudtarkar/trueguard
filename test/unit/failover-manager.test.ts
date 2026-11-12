import { describe, expect, it } from 'vitest';
import { FailoverManager, type ModelProfile } from '../../src/failover/manager';

/**
 * The failover policy (FR-7): ordered models, one attempt per model per turn,
 * a circuit breaker with a 60 s cooldown, and one calm notice.
 */

const MODELS: ModelProfile[] = [
  { id: 'a', label: 'Model A', ref: 'openai/gpt-a' },
  { id: 'b', label: 'Model B', ref: 'openai/gpt-b' },
  { id: 'c', label: 'Model C', ref: 'openai/gpt-c' },
];

function manager(now = { value: 1_000 }): FailoverManager {
  return new FailoverManager(MODELS, {
    now: () => now.value,
    sleep: async () => undefined,
  });
}

describe('failover manager', () => {
  it('starts on the primary model', () => {
    const m = manager();
    expect(m.active?.id).toBe('a');
    expect(m.index).toBe(0);
  });

  it('switches to the next model after a transient failure', async () => {
    const m = manager();
    const decision = await m.handleFailure({ status: 429 });
    expect(decision.action).toBe('retry');
    expect(decision.model?.id).toBe('b');
    expect(m.active?.id).toBe('b');
    expect(decision.notice).toContain('Model B');
    expect(decision.notice).toContain('Model A');
  });

  it('gives up on a request-fatal error', async () => {
    const m = manager();
    const decision = await m.handleFailure({ status: 400 });
    expect(decision.action).toBe('giveup');
    expect(m.active?.id).toBe('a');
  });

  it('gives up on a provider-fatal error', async () => {
    const m = manager();
    const decision = await m.handleFailure({ status: 401 });
    expect(decision.action).toBe('giveup');
    expect(m.active?.id).toBe('a');
  });

  it('tries each model at most once per turn', async () => {
    const m = manager();
    await m.handleFailure({ status: 503 });
    await m.handleFailure({ status: 503 });
    const third = await m.handleFailure({ status: 503 });
    expect(third.action).toBe('giveup');
    expect(third.notice).toContain('No model is available');
  });

  it('allows a model again once the breaker has cooled down', async () => {
    const now = { value: 1_000 };
    const m = manager(now);
    await m.handleFailure({ status: 503 });
    await m.handleFailure({ status: 503 });
    expect((await m.handleFailure({ status: 503 })).action).toBe('giveup');
    // The breaker still cools down: the failed models stay out for 60 s.
    m.onTurnStart();
    expect((await m.handleFailure({ status: 503 })).action).toBe('giveup');
    now.value += 61_000;
    const decision = await m.handleFailure({ status: 503 });
    expect(decision.action).toBe('retry');
  });

  it('resets the attempt budget on a new turn', async () => {
    const now = { value: 1_000 };
    const m = manager(now);
    await m.handleFailure({ status: 503 }); // a → b
    now.value += 61_000; // the breaker lets a back in
    m.onTurnStart();
    const decision = await m.handleFailure({ status: 503 });
    // The order is a → b → c → a: from b the next healthy model is c.
    expect(decision.action).toBe('retry');
    expect(decision.model?.id).toBe('c');
  });

  it('marks a failed model unhealthy for 60 seconds', async () => {
    const now = { value: 1_000 };
    const m = manager(now);
    await m.handleFailure({ status: 429 });
    expect(m.unhealthy.map((x) => x.id)).toContain('a');
    expect(m.isHealthy('a')).toBe(false);
    now.value += 59_000;
    expect(m.isHealthy('a')).toBe(false);
    now.value += 2_000;
    expect(m.isHealthy('a')).toBe(true);
  });

  it('does not switch back to a model that is still unhealthy', async () => {
    const now = { value: 1_000 };
    const m = manager(now);
    await m.handleFailure({ status: 429 }); // a is unhealthy, active is b
    await m.handleFailure({ status: 429 }); // b is unhealthy, active is c
    const decision = await m.handleFailure({ status: 429 });
    // a and b are both cooling down: nothing left this turn.
    expect(decision.action).toBe('giveup');
    expect(m.active?.id).toBe('c');
  });

  it('returns traffic to the primary after the cooldown', async () => {
    const now = { value: 1_000 };
    const m = manager(now);
    await m.handleFailure({ status: 429 }); // a unhealthy → b
    now.value += 61_000; // a is healthy again
    m.noteSuccess('b');
    expect(m.active?.id).toBe('a');
  });

  it('waits for Retry-After before switching', async () => {
    const waits: number[] = [];
    const m = new FailoverManager(MODELS, {
      now: () => 1_000,
      sleep: async (ms) => { waits.push(ms); },
    });
    await m.handleFailure({ status: 429, retryAfter: '3' });
    expect(waits).toEqual([3000]);
  });

  it('never waits longer than 5 seconds', async () => {
    const waits: number[] = [];
    const m = new FailoverManager(MODELS, {
      now: () => 1_000,
      sleep: async (ms) => { waits.push(ms); },
    });
    await m.handleFailure({ status: 429, retryAfter: '600' });
    expect(waits[0]).toBe(5_000);
  });

  it('lets the user switch models explicitly', () => {
    const m = manager();
    m.useModel(2);
    expect(m.active?.id).toBe('c');
    m.useModel(99); // out of range: ignored
    expect(m.active?.id).toBe('c');
  });

  it('falls back to the primary when the model list shrinks', () => {
    const m = manager();
    m.useModel(2);
    m.setModels([MODELS[0]!]);
    expect(m.active?.id).toBe('a');
  });

  it('gives up cleanly when there are no models at all', async () => {
    const m = new FailoverManager([], { now: () => 1_000, sleep: async () => undefined });
    const decision = await m.handleFailure({ status: 429 });
    expect(decision.action).toBe('giveup');
  });
});
