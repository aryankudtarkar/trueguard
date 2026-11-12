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
  tool_calls: z.array(z.unknown()).optional(),
  model: modelSchema.optional(),
});

export const modelMessageDeltaEventSchema = z.object({
  type: z.literal('model.message.delta'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
  content: z.string().nullable().optional(),
  finish_reason: z.string().nullable().optional(),
});

export const toolResponseEventSchema = z.object({
  type: z.literal('tool.response'),
  id: z.string(),
  thread_id: z.string(),
  created_at: z.string().optional(),
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
