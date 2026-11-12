import { describe, expect, it } from 'vitest';
import { continuationMessage } from '../../src/trueforge/sessionManager';
import { FailoverManager, type ModelProfile } from '../../src/failover/manager';

/**
 * The resume semantics (Phase 6 follow-up).
 *
 * cline/cline#713: "the retry button doesn't continue the task, but it
 * starts again. So it generates an infinite loop and money consuming."
 * Our answer: the retry sends a CONTINUATION, never the original request.
 */

describe('the continuation message', () => {
  it('continues instead of repeating the request', () => {
    const message = continuationMessage('429 rate limit exceeded');
    expect(message).toContain('429 rate limit exceeded');
    expect(message).toContain('Continue where you left off');
    expect(message).toContain('Do not repeat the work');
  });

  it('names the tools that already ran', () => {
    const message = continuationMessage('timeout', ['read_file', 'search_text']);
    expect(message).toContain('read_file, search_text');
    expect(message).toContain('Do not run them again');
  });

  it('says nothing about tools when none ran', () => {
    expect(continuationMessage('timeout')).not.toContain('already ran');
  });
});

describe('the failover settings', () => {
  const MODELS: ModelProfile[] = [
    { id: 'a', label: 'Model A', ref: 'a/model' },
    { id: 'b', label: 'Model B', ref: 'b/model' },
  ];

  it('can be turned off', async () => {
    const manager = new FailoverManager(MODELS, { now: () => 1_000, sleep: async () => undefined });
    manager.setPolicy({ enabled: false });
    expect(manager.isEnabled).toBe(false);
    const decision = await manager.handleFailure({ status: 429 });
    expect(decision.action).toBe('giveup');
  });

  it('can be turned back on', async () => {
    const manager = new FailoverManager(MODELS, { now: () => 1_000, sleep: async () => undefined });
    manager.setPolicy({ enabled: false });
    manager.setPolicy({ enabled: true });
    expect(manager.isEnabled).toBe(true);
    expect((await manager.handleFailure({ status: 429 })).action).toBe('retry');
  });

  it('lets the user tune the breaker cooldown', async () => {
    const now = { value: 1_000 };
    const manager = new FailoverManager(MODELS, { now: () => now.value, sleep: async () => undefined });
    manager.setPolicy({ cooldownMs: 5_000 });
    await manager.handleFailure({ status: 429 });
    expect(manager.isHealthy('a')).toBe(false);
    now.value += 6_000;
    expect(manager.isHealthy('a')).toBe(true);
  });
});
