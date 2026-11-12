import { logger, redact } from '../util/logger';
import { SseParser } from '../util/sse';
import {
  apiEnvelopeSchema,
  sessionDtoSchema,
  streamingEventSchema,
  type SessionDto,
  type StreamingEvent,
} from './schemas';

/**
 * Typed client over the verified TrueForge HTTP API (no SDK exists; see
 * docs/TRUEFORGE_NOTES.md). All responses and SSE events are zod-validated.
 */
export interface TurnStreamCallbacks {
  onEvent(event: StreamingEvent): void;
  /** Resolves when the stream ends (done, cancelled or connection lost). */
  onEnd(): void;
}

export class TrueForgeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class TrueForgeClient {
  constructor(private readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, '')}/api/v1${path}`;
  }

  /** Health check: any 200 on a cheap authenticated-less endpoint. */
  async health(timeoutMs = 3000): Promise<boolean> {
    try {
      const res = await fetch(this.url('/users'), { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createSession(agentSpec: unknown): Promise<SessionDto> {
    const res = await fetch(this.url('/sessions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { spec: agentSpec } }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await this.assertOk(res);
    return sessionDtoSchema.parse(body.data);
  }

  async updateSessionModel(sessionId: string, model: { name: string }): Promise<void> {
    // PATCH with an inline agent spec updates the model on inline sessions
    // (verified: docs/TRUEFORGE_NOTES.md, Spike 4). The rest of the spec is
    // preserved server-side for inline sessions; we send only the model change.
    const res = await fetch(this.url(`/sessions/${sessionId}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { spec: { model } } }),
      signal: AbortSignal.timeout(10_000),
    });
    await this.assertOk(res);
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await fetch(this.url(`/sessions/${sessionId}/cancel`), { method: 'POST', signal: AbortSignal.timeout(5000) });
    } catch (e) {
      logger().warn(redact(`cancel failed: ${String(e)}`));
    }
  }

  /**
   * Send a turn and consume the SSE stream, invoking callbacks per validated
   * event. Resolves when the stream ends. Aborting the signal closes the
   * connection (Stop button).
   */
  async sendTurn(
    sessionId: string,
    input: unknown[],
    callbacks: TurnStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.url(`/sessions/${sessionId}/turns`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, stream: true }),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) { return; } // user-initiated stop
      throw new TrueForgeError(0, `connection failed: ${String(e)}`);
    }
    if (!res.ok || !res.body) {
      throw new TrueForgeError(res.status, await safeErrorBody(res));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { break; }
        for (const sse of parser.push(decoder.decode(value, { stream: true }))) {
          let event: StreamingEvent;
          try {
            event = streamingEventSchema.parse(JSON.parse(sse.data));
          } catch (parseError) {
            // Unknown event shape: log, never crash the stream (forward compat)
            logger().debug(`unparseable event skipped: ${String(parseError).slice(0, 200)}`);
            continue;
          }
          callbacks.onEvent(event);
        }
      }
    } catch (e) {
      // A user-initiated stop is not an error: the stream was cancelled on purpose.
      if (!signal?.aborted) { throw e; }
    } finally {
      reader.releaseLock();
      callbacks.onEnd();
    }
  }

  private async assertOk(res: Response): Promise<{ data: unknown }> {
    if (!res.ok) {
      throw new TrueForgeError(res.status, await safeErrorBody(res));
    }
    const parsed: { data?: unknown } = apiEnvelopeSchema.parse(await res.json());
    return { data: parsed.data };
  }
}

async function safeErrorBody(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
