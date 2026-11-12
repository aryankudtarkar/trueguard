import { z } from 'zod';
import { proposeEditSchema, type EditService } from '../review/editService';
import { runTool, type ToolRegistrar, type ToolResult } from './tools';

/**
 * The propose_edit tool (FR-4).
 *
 * The tool NEVER writes on its own: it applies exactly the hunks the user
 * accepted in the review, and returns a truthful result. When the review is
 * missing or the proposal is invalid, it writes nothing and says so.
 */

export const PROPOSE_EDIT_DESCRIPTION =
  'Propose edits to files in the workspace. Every change is reviewed hunk by hunk; ' +
  'nothing is written until the user accepts. Use exact-match edits: oldText must appear ' +
  'exactly once in the file. kind is modify (existing file), create (new file, with content) ' +
  'or delete.';

export interface EditToolDeps {
  service: EditService;
}

export function registerEditTools(server: ToolRegistrar, deps: EditToolDeps): void {
  server.registerTool(
    'propose_edit',
    {
      description: PROPOSE_EDIT_DESCRIPTION,
      inputSchema: proposeEditSchema.shape as unknown as Record<string, z.ZodType>,
    },
    async (raw: unknown, extra?: { requestId?: string | number }) => {
      return runTool(async (): Promise<ToolResult> => {
        const parsed = proposeEditSchema.safeParse(raw);
        if (!parsed.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'invalid',
                  message: parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '),
                }),
              },
            ],
            isError: true,
          };
        }
        const result = await deps.service.applyApproved(extra?.requestId);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 1) }],
        };
      });
    },
  );
}
