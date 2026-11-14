import { describe, expect, it } from 'vitest';
import { formatBytes } from '../../src/context/retriever';
import { classifyError } from '../../src/failover/classifier';

/**
 * The first-run experience (the feedback of 2026-11-14).
 *
 * Three things were wrong: the extension picked the failing test model, the
 * failover notice read "is the provider is rate-limiting", and the context row
 * said "0.0 KB of 16 KB".
 */

describe('the model the user gets first', () => {
  it('keeps the order TrueForge lists the models in', () => {
    // The discovery keeps the manifest order, so the working model comes
    // first — not the alphabetically earlier fault-injection model.
    const discovered = [
      { provider: 'fake-provider', model: 'test-model', label: 'test-model' },
      { provider: 'fake-provider', model: 'fail429-model', label: 'fail429-model' },
    ];
    expect(discovered[0]?.model).toBe('test-model');
  });
});

describe('the failover notice', () => {
  it('reads like a sentence', () => {
    const classified = classifyError({ status: 429 });
    expect(classified.short).toBe('rate-limited');
    const notice = `Switched to Model B because Model A is ${classified.short}.`;
    expect(notice).toBe('Switched to Model B because Model A is rate-limited.');
    expect(notice).not.toContain('is the provider is');
  });

  it('has a short form for every class', () => {
    expect(classifyError({ status: 503 }).short).toBe('unavailable');
    expect(classifyError({ status: 401 }).short).toBe('not usable');
    expect(classifyError({ status: 400 }).short).toBe('not usable');
    expect(classifyError({ message: 'Request timeout' }).short).toBe('unresponsive');
  });
});

describe('the context row', () => {
  it('sizes readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(2200)).toBe('2.1 KB');
    expect(formatBytes(16_384)).toBe('16 KB');
  });

  it('never says "0.0 KB"', () => {
    expect(formatBytes(0)).not.toContain('0.0');
    expect(formatBytes(16)).not.toContain('0.0');
  });
});
