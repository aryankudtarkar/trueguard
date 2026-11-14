/**
 * Error classifier (Phase 6.1).
 *
 * Table-driven, because the classification decides whether a user's turn is
 * retried on another model or failed outright. A wrong classification either
 * wastes a turn or gives up too early.
 *
 * Verified error shapes (docs/TRUEFORGE_NOTES.md): the turn stream stays HTTP
 * 200 and the failure arrives as `turn.done {state: {status: 'error', message}}`.
 * HTTP status codes matter for the calls around it (create session, patch).
 */

export type ErrorClass =
  /** Retry on another model: rate limit, server error, timeout, reset. */
  | 'transient'
  /** The provider will not serve this model at all: 401, 403, quota. */
  | 'provider_fatal'
  /** The request itself is wrong: 400, context length exceeded. */
  | 'request_fatal'
  /** Not recognized. Treated as transient, once. */
  | 'unknown';

export interface ClassifiedError {
  class: ErrorClass;
  /** The HTTP status, when there was one. */
  status?: number;
  /** How long to wait before retrying (never longer than the cap). */
  retryAfterMs?: number;
  /** Plain-language reason, shown to the user. */
  reason: string;
  /** Two or three words for the notice: "rate-limited", "unavailable". */
  short: string;
}

/** The longest we ever wait for a Retry-After header (FR-7). */
export const RETRY_AFTER_CAP_MS = 5_000;

/** How long a model stays unhealthy after a failure (FR-7). */
export const BREAKER_COOLDOWN_MS = 60_000;

interface Rule {
  test: RegExp;
  class: ErrorClass;
  reason: string;
  /** Two or three words, for the notice. */
  short: string;
}

/** Message patterns, checked in order. */
const MESSAGE_RULES: Rule[] = [
  { test: /\b(429|too many requests|rate[ -]?limit)\b/i, class: 'transient', reason: 'the provider is rate-limiting', short: 'rate-limited' },
  { test: /\b(quota|insufficient_quota|billing|out of credit)\b/i, class: 'provider_fatal', reason: 'the provider quota is exhausted', short: 'out of quota' },
  { test: /\b(401|403|unauthorized|forbidden|invalid api key|authentication)\b/i, class: 'provider_fatal', reason: 'the provider refused the credentials', short: 'not usable' },
  { test: /\b(400|bad request)\b/i, class: 'request_fatal', reason: 'the request was rejected', short: 'not usable' },
  { test: /context length|maximum context|too many tokens|prompt is too long/i, class: 'request_fatal', reason: 'the request does not fit the model context', short: 'too big for the model' },
  { test: /\b(500|502|503|504)\b|internal server error|bad gateway|service unavailable|gateway timeout/i, class: 'transient', reason: 'the provider had a server error', short: 'unavailable' },
  { test: /timeout|timed out|etimedout|deadline exceeded/i, class: 'transient', reason: 'the provider did not answer in time', short: 'unresponsive' },
  { test: /connection reset|econnreset|epipe|socket hang up|stream (stall|closed|ended)/i, class: 'transient', reason: 'the connection to the provider broke', short: 'unreachable' },
  { test: /cannot connect|connection refused|econnrefused|network error|dns/i, class: 'transient', reason: 'the provider could not be reached', short: 'unreachable' },
];

/** HTTP statuses, checked before the message rules. */
const STATUS_RULES: Array<{ status: number; class: ErrorClass; reason: string; short: string }> = [
  { status: 429, class: 'transient', reason: 'the provider is rate-limiting', short: 'rate-limited' },
  { status: 500, class: 'transient', reason: 'the provider had a server error', short: 'unavailable' },
  { status: 502, class: 'transient', reason: 'the provider had a server error', short: 'unavailable' },
  { status: 503, class: 'transient', reason: 'the provider had a server error', short: 'unavailable' },
  { status: 504, class: 'transient', reason: 'the provider did not answer in time', short: 'unresponsive' },
  { status: 401, class: 'provider_fatal', reason: 'the provider refused the credentials', short: 'not usable' },
  { status: 403, class: 'provider_fatal', reason: 'the provider refused the request', short: 'not usable' },
  { status: 402, class: 'provider_fatal', reason: 'the provider quota is exhausted', short: 'out of quota' },
  { status: 400, class: 'request_fatal', reason: 'the request was rejected', short: 'not usable' },
];

/** Parse a `Retry-After` value (seconds or an HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | undefined | null, now = Date.now()): number | undefined {
  if (!value) { return undefined; }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) { return Math.max(0, seconds * 1000); }
  const date = Date.parse(value);
  if (Number.isNaN(date)) { return undefined; }
  return Math.max(0, date - now);
}

export interface ErrorInput {
  /** The HTTP status, when the failure was an HTTP call. */
  status?: number;
  /** The error message (turn.done error message or an exception text). */
  message?: string;
  /** A `Retry-After` header value. */
  retryAfter?: string | null;
  /** The raw body, when there was one. */
  body?: unknown;
  /** Injected clock for the tests. */
  now?: number;
}

/** Classify a failure. */
export function classifyError(input: ErrorInput): ClassifiedError {
  const now = input.now ?? Date.now();
  const message = input.message ?? messageFromBody(input.body) ?? '';

  if (input.status !== undefined) {
    const rule = STATUS_RULES.find((r) => r.status === input.status);
    if (rule) {
      return {
        class: rule.class,
        status: input.status,
        reason: rule.reason,
        short: rule.short,
        ...(rule.class === 'transient'
          ? { retryAfterMs: Math.min(parseRetryAfter(input.retryAfter, now) ?? 0, RETRY_AFTER_CAP_MS) }
          : {}),
      };
    }
  }

  for (const rule of MESSAGE_RULES) {
    if (rule.test.test(message)) {
      return {
        class: rule.class,
        ...(input.status !== undefined ? { status: input.status } : {}),
        reason: rule.reason,
        short: rule.short,
        ...(rule.class === 'transient'
          ? { retryAfterMs: Math.min(parseRetryAfter(input.retryAfter, now) ?? 0, RETRY_AFTER_CAP_MS) }
          : {}),
      };
    }
  }

  // Unknown failures are treated as transient, but only once per turn.
  return {
    class: 'unknown',
    ...(input.status !== undefined ? { status: input.status } : {}),
    reason: message ? 'the provider failed in an unexpected way' : 'the provider failed',
    short: 'unavailable',
    retryAfterMs: 0,
  };
}

/** Pull a message out of an error body (`{error: {message}}`). */
export function messageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') { return undefined; }
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') { return error; }
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

/** Is this class worth failing over? */
export function shouldFailover(classified: ClassifiedError): boolean {
  return classified.class === 'transient' || classified.class === 'unknown';
}
