import { createHash } from 'node:crypto';
import type { ToolResult } from '../mcp/tools';

/**
 * Idempotency guard (FR-7).
 *
 * When a turn fails on the provider and continues on another model, the same
 * tool call can arrive again. A tool that already ran must NOT run twice: the
 * second time would apply the same edit or run the same command again.
 *
 * The guard remembers the result of every (tool, arguments) pair of the turn
 * and replays it instead of executing again.
 */
export class ToolCallGuard {
  private readonly cache = new Map<string, ToolResult>();

  /** Forget everything (a new user turn). */
  reset(): void {
    this.cache.clear();
  }

  /** The key of a call: the tool name and its arguments. */
  static key(toolName: string, args: unknown): string {
    const hash = createHash('sha256');
    hash.update(toolName);
    hash.update(JSON.stringify(args ?? null));
    return `${toolName}:${hash.digest('hex').slice(0, 16)}`;
  }

  /** Run a tool once: a repeat replays the first result. */
  async run(key: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
    const cached = this.cache.get(key);
    if (cached) { return cached; }
    const result = await fn();
    this.cache.set(key, result);
    return result;
  }

  /** Was this call already executed in this turn? */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  get size(): number {
    return this.cache.size;
  }
}
