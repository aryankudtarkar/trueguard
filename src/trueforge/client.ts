import { logger, redact } from '../util/logger';
import { SseParser } from '../util/sse';
import {
  apiEnvelopeSchema,
  sessionDtoSchema,
  streamingEventSchema,
  type SessionDto,
  type StreamingEvent,
} from './schemas';
import { z } from 'zod';

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

  async updateSessionModel(sessionId: string, model: { name: string; params?: Record<string, unknown> }): Promise<void> {
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
   * Register (or update) a model provider in TrueForge.
   *
   * The extension never calls the provider itself: it only tells TrueForge
   * which provider and models exist, so the agent loop stays inside
   * TrueForge (the brief's eligibility rule).
   */
  async upsertModelProvider(manifest: Record<string, unknown>): Promise<void> {
    const names = await this.listModelProviders().catch(() => [] as string[]);
    const name = String(manifest.name ?? '');
    const method = names.includes(name) ? 'PUT' : 'POST';
    const res = await fetch(this.url('/settings/model-providers'), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { throw new TrueForgeError(res.status, await safeErrorBody(res)); }
  }

  /** The registered provider names. */
  async listModelProviders(): Promise<string[]> {
    const res = await fetch(this.url('/settings/model-providers'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { throw new TrueForgeError(res.status, await safeErrorBody(res)); }
    const parsed = apiEnvelopeSchema.parse(await res.json());
    const items = z.array(z.object({ name: z.string().min(1) }).passthrough()).safeParse(parsed.data);
    return items.success ? items.data.map((i) => i.name) : [];
  }

  /**
   * The models TrueForge knows about, as `provider/model` names.
   *
   * This is how the extension finds its models without the user typing FQNs
   * into the settings: TrueForge is the source of truth for what exists.
   */
  async listAvailableModels(): Promise<Array<{ provider: string; model: string; label: string }>> {
    const res = await fetch(this.url('/settings/model-providers'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { throw new TrueForgeError(res.status, await safeErrorBody(res)); }
    const parsed = apiEnvelopeSchema.parse(await res.json());
    return z
      .array(
        z
          .object({
            name: z.string().min(1),
            manifest: z
              .object({
                models: z
                  .array(z.object({ model_id: z.string().min(1), name: z.string().min(1) }).passthrough())
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .catch([])
      .transform((providers) =>
        providers.flatMap((provider) =>
          (provider.manifest?.models ?? []).map((model) => ({
            provider: provider.name,
            model: model.model_id,
            label: model.name,
          })),
        ),
      )
      .parse(parsed.data);
  }

  /** List registered MCP server names (cheap idempotency check for the connector). */
  async listMcpServers(): Promise<string[]> {
    const res = await fetch(this.url('/settings/mcp-servers'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { throw new TrueForgeError(res.status, await safeErrorBody(res)); }
    const parsed = apiEnvelopeSchema.parse(await res.json());
    const items = z.array(z.object({ name: z.string().min(1) }).passthrough()).safeParse(parsed.data);
    return items.success ? items.data.map((i) => i.name) : [];
  }

  /**
   * Register (or update) the editor MCP connector with TrueForge so sessions
   * can reference it by name. PUT when it exists, POST otherwise.
   */
  async upsertMcpServer(manifest: {
    type: 'remote';
    name: string;
    url: string;
    description?: string;
    auth?: { type: 'header'; headers: Record<string, string> };
  }): Promise<void> {
    const names = await this.listMcpServers().catch(() => [] as string[]);
    const method = names.includes(manifest.name) ? 'PUT' : 'POST';
    const res = await fetch(this.url('/settings/mcp-servers'), {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ manifest }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { throw new TrueForgeError(res.status, await safeErrorBody(res)); }
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
