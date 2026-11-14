import { z } from 'zod';

/**
 * Zod schemas for the chat webview message protocol (webview/protocol.ts).
 * The webview is untrusted script execution context: every message arriving
 * from it is validated here before the host acts on it (PRD rule: zod-validate
 * all external input). Unknown shapes are dropped, not thrown.
 */

export const contextChipSchema = z.object({
  path: z.string().min(1),
  selection: z
    .object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) })
    .refine((s) => s.endLine >= s.startLine, { message: 'endLine must be >= startLine' })
    .optional(),
  symbol: z
    .object({
      name: z.string().min(1),
      kind: z.string().min(1),
      line: z.number().int().min(1),
    })
    .optional(),
});
export type ContextChipValidated = z.infer<typeof contextChipSchema>;

export const webviewToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('send'), text: z.string().max(32_000), chips: z.array(contextChipSchema).max(8) }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('newChat') }),
  z.object({ type: z.literal('updateChip'), chip: contextChipSchema.nullable() }),
  z.object({ type: z.literal('copyText'), text: z.string().max(32_000) }),
  z.object({ type: z.literal('switchModel') }),
  z.object({ type: z.literal('toggleTool'), messageId: z.string().min(1) }),
  z.object({ type: z.literal('openReview') }),
  z.object({ type: z.literal('approveCommand'), toolCallId: z.string().min(1) }),
  z.object({ type: z.literal('denyCommand'), toolCallId: z.string().min(1) }),
  z.object({ type: z.literal('revertChange'), changeSetId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('mentionFiles'), query: z.string().max(200) }),
  z.object({
    type: z.literal('mention'),
    path: z.string().min(1).max(400),
    symbol: z
      .object({ name: z.string().min(1).max(200), kind: z.string().min(1).max(40), line: z.number().int().min(1) })
      .optional(),
  }),
]);

export type WebviewToHostParsed = z.infer<typeof webviewToHostMessageSchema>;
