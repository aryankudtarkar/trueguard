import { describe, expect, it } from 'vitest';
import {
  BREAKER_COOLDOWN_MS,
  RETRY_AFTER_CAP_MS,
  classifyError,
  messageFromBody,
  parseRetryAfter,
  shouldFailover,
} from '../../src/failover/classifier';

/**
 * The classifier decides whether a user's turn is retried on another model or
 * failed outright. The table below is the contract (FR-7).
 */
describe('error classifier', () => {
  it('treats 429 as transient', () => {
    expect(classifyError({ status: 429 }).class).toBe('transient');
  });

  it('treats 5xx as transient', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyError({ status }).class, `status ${status}`).toBe('transient');
    }
  });

  it('treats timeouts and resets as transient', () => {
    expect(classifyError({ message: 'Request timeout' }).class).toBe('transient');
    expect(classifyError({ message: 'ECONNRESET' }).class).toBe('transient');
    expect(classifyError({ message: 'socket hang up' }).class).toBe('transient');
  });

  it('treats 401 and 403 as provider-fatal', () => {
    expect(classifyError({ status: 401 }).class).toBe('provider_fatal');
    expect(classifyError({ status: 403 }).class).toBe('provider_fatal');
    expect(classifyError({ message: 'Invalid API key' }).class).toBe('provider_fatal');
  });

  it('treats an exhausted quota as provider-fatal', () => {
    expect(classifyError({ message: 'You exceeded your current quota' }).class).toBe('provider_fatal');
  });

  it('treats 400 and context-length errors as request-fatal', () => {
    expect(classifyError({ status: 400 }).class).toBe('request_fatal');
    expect(classifyError({ message: 'maximum context length exceeded' }).class).toBe('request_fatal');
  });

  it('treats an unknown error as unknown, which fails over once', () => {
    const classified = classifyError({ message: 'something odd happened' });
    expect(classified.class).toBe('unknown');
    expect(shouldFailover(classified)).toBe(true);
  });

  it('does not fail over a request-fatal error', () => {
    expect(shouldFailover(classifyError({ status: 400 }))).toBe(false);
    expect(shouldFailover(classifyError({ status: 401 }))).toBe(false);
  });

  it('honours Retry-After, capped at 5 seconds', () => {
    expect(classifyError({ status: 429, retryAfter: '2' }).retryAfterMs).toBe(2000);
    expect(classifyError({ status: 429, retryAfter: '3600' }).retryAfterMs).toBe(RETRY_AFTER_CAP_MS);
    expect(classifyError({ status: 429 }).retryAfterMs).toBe(0);
  });

  it('parses a Retry-After date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:03 GMT', now)).toBe(3000);
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });

  it('reads the message out of an error body', () => {
    expect(messageFromBody({ error: { message: 'boom' } })).toBe('boom');
    expect(messageFromBody({ error: 'plain' })).toBe('plain');
    expect(messageFromBody({})).toBeUndefined();
  });

  it('classifies a turn.done error message (HTTP stays 200)', () => {
    const classified = classifyError({
      message: '[Model Error] Cannot connect to API: bad port',
    });
    expect(classified.class).toBe('transient');
    expect(classified.reason).toContain('could not be reached');
  });

  it('exposes the breaker cooldown', () => {
    expect(BREAKER_COOLDOWN_MS).toBe(60_000);
  });
});
