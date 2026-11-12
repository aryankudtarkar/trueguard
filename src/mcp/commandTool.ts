import { z } from 'zod';
import { describeRisky, findRiskyPatterns } from '../exec/risky';
import { runCommand, type RunResult } from '../exec/runner';
import { runTool, type ToolRegistrar, type ToolResult } from './tools';

/**
 * The run_command tool (FR-6).
 *
 * The command NEVER runs without an approval: the extension only runs it after
 * the user accepted the exact command in the approval card. The result the
 * agent sees is the exit code, the duration and the tail of the output.
 */

export const runCommandSchema = z.object({
  command: z.string().min(1).describe('The exact command to run, e.g. "npm test"'),
  cwd: z.string().min(1).optional().describe('Working directory (must be inside the workspace)'),
  timeoutSec: z.number().int().min(1).max(3600).optional().describe('Timeout in seconds (default 120)'),
});

export type RunCommandInput = z.infer<typeof runCommandSchema>;

export const RUN_COMMAND_DESCRIPTION =
  'Run a shell command in the workspace. The user approves the exact command before it runs. ' +
  'Returns the exit code, the duration and the tail of the output.';

export interface CommandRunnerDeps {
  /** Resolve a working directory: returns undefined when it is not allowed. */
  resolveCwd(cwd: string | undefined): Promise<string | undefined>;
  /** Default timeout in seconds. */
  defaultTimeoutSec(): number;
  /** Called with the output chunks (the Commands output channel). */
  onOutput?: (chunk: string) => void;
  /** Called before the command runs, with the resolved command. */
  onStart?: (command: string, cwd: string, risky: string[]) => void;
}

export interface CommandApproval {
  command: string;
  cwd: string;
  timeoutSec?: number;
}

export function registerCommandTools(
  server: ToolRegistrar,
  deps: CommandRunnerDeps & { approval: () => Promise<CommandApproval | undefined> },
): void {
  server.registerTool(
    'run_command',
    {
      description: RUN_COMMAND_DESCRIPTION,
      inputSchema: runCommandSchema.shape as unknown as Record<string, z.ZodType>,
    },
    async (raw: unknown) => {
      return runTool(async (): Promise<ToolResult> => {
        const parsed = runCommandSchema.safeParse(raw);
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
        const approval = await deps.approval();
        if (!approval) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'rejected',
                  note: 'The command was not approved, so it was not run.',
                }),
              },
            ],
          };
        }
        const cwd = await deps.resolveCwd(approval.cwd);
        if (!cwd) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'invalid',
                  note: 'The working directory is outside the workspace.',
                }),
              },
            ],
            isError: true,
          };
        }
        const risky = findRiskyPatterns(approval.command);
        deps.onStart?.(approval.command, cwd, risky.map((r) => r.label));
        const result = await runCommand({
          command: approval.command,
          cwd,
          timeoutMs: (approval.timeoutSec ?? deps.defaultTimeoutSec()) * 1000,
        }, { onOutput: deps.onOutput });
        return { content: [{ type: 'text', text: JSON.stringify(toAgentResult(result), null, 1) }] };
      });
    },
  );
}

/** The truthful result the agent receives. */
export function toAgentResult(result: RunResult): Record<string, unknown> {
  return {
    status: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'ok' : 'failed',
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    truncated: result.truncated,
    output: result.output,
  };
}

/** Human summary of a risky command, for the approval card. */
export function riskyNote(command: string): string {
  return describeRisky(findRiskyPatterns(command));
}
