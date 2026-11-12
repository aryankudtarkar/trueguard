import { z } from 'zod';

/**
 * Zod schemas for the verified TrueForge HTTP API shapes.
 * Source of truth: docs/TRUEFORGE_NOTES.md + docs/reference/trueforge-openapi-0.183.2.json
 * All external input (events, HTTP responses) is validated here.
 */

export const modelSchema = z.object({
  name: z.string().min(1),
  params: z.record(z.unknown()).optional(),
});

export const toolCallRefSchema = z.object({
  id: z.string().min(1),
  source_event_id: z.string().min(1),
});

// --- Streaming event union (verified TurnStreamingEvent oneOf) ---

export const modelMessageEventSchema = z.object({
  type: z.literal('model.message'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
  content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
  name: z.string().optional(),
  // Kept permissive on purpose: an unfamiliar tool-call shape must never
  // invalidate the whole event (the turn would be lost). The parts we use are
  // validated separately by extractToolCalls().
  tool_calls: z.array(z.unknown()).optional(),
  model: modelSchema.optional(),
});

/** Verified shape of one tool call (docs/reference/trueforge-openapi-*.json). */
export const toolCallSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.string().optional(),
  function: z
    .object({ name: z.string().min(1), arguments: z.string().optional() })
    .passthrough(),
});

/** One streamed tool-call fragment: the name and the arguments arrive apart. */
export const toolCallDeltaSchema = z.object({
  index: z.number().int().min(0).optional(),
  id: z.string().min(1).optional(),
  type: z.string().optional(),
  function: z
    .object({ name: z.string().optional(), arguments: z.string().optional() })
    .passthrough()
    .optional(),
});

export interface ExtractedToolCall {
  id: string | undefined;
  name: string;
  arguments: string | undefined;
}

/**
 * Pull the tool calls out of a model.message event. Unknown shapes are
 * skipped, never thrown: a malformed call must not break the stream.
 */
export function extractToolCalls(event: { tool_calls?: unknown }): ExtractedToolCall[] {
  if (!Array.isArray(event.tool_calls)) { return []; }
  const out: ExtractedToolCall[] = [];
  for (const raw of event.tool_calls) {
    const parsed = toolCallSchema.safeParse(raw);
    if (!parsed.success) { continue; }
    out.push({
      id: parsed.data.id,
      name: parsed.data.function.name,
      arguments: parsed.data.function.arguments,
    });
  }
  return out;
}

/**
 * Accumulates streamed tool-call fragments into complete calls.
 *
 * The model streams the tool name in one delta and the JSON arguments in the
 * next, keyed by `index` (verified transcript). Without merging, the chat
 * would show empty tool rows.
 */
export class ToolCallBuffer {
  private readonly pending = new Map<number, { id?: string; name: string; args: string }>();

  /** Merge one delta's tool-call fragments. Unknown shapes are ignored. */
  add(rawCalls: unknown): void {
    if (!Array.isArray(rawCalls)) { return; }
    for (const raw of rawCalls) {
      const parsed = toolCallDeltaSchema.safeParse(raw);
      if (!parsed.success) { continue; }
      const index = parsed.data.index ?? this.pending.size;
      const current = this.pending.get(index) ?? { id: undefined, name: '', args: '' };
      if (parsed.data.id) { current.id = parsed.data.id; }
      if (parsed.data.function?.name) { current.name = parsed.data.function.name; }
      if (parsed.data.function?.arguments) { current.args += parsed.data.function.arguments; }
      this.pending.set(index, current);
    }
  }

  /** Complete calls seen so far (a call with no name is still pending). */
  complete(): ExtractedToolCall[] {
    const out: ExtractedToolCall[] = [];
    for (const call of this.pending.values()) {
      if (!call.name) { continue; }
      out.push({ id: call.id, name: call.name, arguments: call.args || undefined });
    }
    return out;
  }

  /** Return the complete calls and forget them (one turn = one batch). */
  drain(): ExtractedToolCall[] {
    const out = this.complete();
    this.pending.clear();
    return out;
  }

  get size(): number {
    return this.pending.size;
  }
}

export const modelMessageDeltaEventSchema = z.object({
  type: z.literal('model.message.delta'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
  content: z.string().nullable().optional(),
  finish_reason: z.string().nullable().optional(),
  // Tool calls are streamed as deltas: the name arrives in one delta and the
  // arguments in the next (verified in docs/spikes/approval-allow-transcript.md).
  tool_calls: z.array(z.unknown()).optional(),
});

export const toolResponseEventSchema = z.object({
  type: z.literal('tool.response'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
  /** Id of the tool call this responds to (verified event shape). */
  tool_call_id: z.string().optional(),
  content: z.unknown().optional(),
});

export const threadEventSchema = z.object({
  type: z.enum([
    'thread.created',
    'thread.done',
    'thread.context_compaction.started',
    'thread.context_compaction.finished',
    'mcp.initialize',
    'sandbox.created',
  ]),
  id: z.string(),
  thread_id: z.string().nullable().optional(),
});

export const toolApprovalRequiredEventSchema = z.object({
  type: z.literal('tool.approval_required'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
  tool_calls: z.array(toolCallRefSchema),
});

export const toolResponseRequiredEventSchema = z.object({
  type: z.literal('tool.response_required'),
  id: z.string(),
  thread_id: z.string(),
});

export const turnCreatedEventSchema = z.object({
  type: z.literal('turn.created'),
  id: z.string(),
  turn_id: z.string(),
  previous_turn_id: z.string().nullable().optional(),
  thread_id: z.string().nullable().optional(),
});

export const turnDoneEventSchema = z.object({
  type: z.literal('turn.done'),
  id: z.string(),
  turn_id: z.string().optional(),
  thread_id: z.string().nullable().optional(),
  state: z.object({
    status: z.enum(['done', 'error', 'running', 'cancelled', 'pending']),
    message: z.string().nullable().optional(),
    output: z.unknown().optional(),
    required_actions: z.array(z.unknown()).nullable().optional(),
    metrics: z.record(z.unknown()).optional(),
  }),
});

// Approval events echoed back on the decision turn
export const userDecisionEventSchema = z.object({
  type: z.enum(['user.tool_approval', 'user.tool_response', 'user.tool_approval_policy', 'user.mcp_auth_continue']),
  id: z.string(),
  thread_id: z.string().nullable().optional(),
});

const mcpAuthRequiredShape = { type: z.literal('mcp.auth_required'), id: z.string(), thread_id: z.string().nullable().optional() };

export const streamingEventSchema = z.union([
  modelMessageEventSchema,
  modelMessageDeltaEventSchema,
  toolResponseEventSchema,
  threadEventSchema,
  toolApprovalRequiredEventSchema,
  toolResponseRequiredEventSchema,
  turnCreatedEventSchema,
  turnDoneEventSchema,
  userDecisionEventSchema,
  z.object(mcpAuthRequiredShape),
]);

export type StreamingEvent = z.infer<typeof streamingEventSchema>;
export type ToolApprovalRequiredEvent = z.infer<typeof toolApprovalRequiredEventSchema>;
export type TurnDoneEvent = z.infer<typeof turnDoneEventSchema>;
export type ModelMessageDeltaEvent = z.infer<typeof modelMessageDeltaEventSchema>;

// --- Sessions ---

export const sessionDtoSchema = z.object({
  id: z.string(),
  agent: z.unknown(),
  title: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  last_turn_details: z.unknown().nullable().optional(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const apiEnvelopeSchema = z.object({ data: z.unknown() });
