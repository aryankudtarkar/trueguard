import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Session event log (FR-8).
 *
 * Every turn is appended to a redacted JSON-lines file in the extension's
 * global storage. It survives a window reload, it can be opened after the
 * fact, and it never contains a key or a token.
 *
 * Why it matters: when an agent does something surprising, the question is
 * always "what did it actually see and do?". The log answers it.
 */

/** Keys whose values are never written to the log. */
const SECRET_KEYS = /(api[_-]?key|authorization|bearer|token|secret|password|cookie)/i;

/** Replace anything that looks like a secret with a marker. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) { return '[deep]'; }
  if (typeof value === 'string') {
    // A bearer token or an api key inside free text.
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
      .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, '[redacted]');
  }
  if (Array.isArray(value)) { return value.map((v) => redactValue(v, depth + 1)); }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEYS.test(key) ? '[redacted]' : redactValue(child, depth + 1);
    }
    return out;
  }
  return value;
}

export interface SessionLogEntry {
  /** ISO timestamp. */
  at: string;
  /** The session id. */
  session: string;
  /** The event type (turn.created, tool.response, …). */
  type: string;
  /** The event payload, redacted. */
  data?: unknown;
}

export class SessionLog {
  private readonly written = new Map<string, number>();

  constructor(private readonly directory: string) {}

  /** The file of a session. */
  fileFor(sessionId: string): string {
    const safe = sessionId.replace(/[^\w.-]/g, '_');
    return path.join(this.directory, `${safe}.jsonl`);
  }

  /** The most recent log file (for "Show Session Log"). */
  async latestFile(): Promise<string | undefined> {
    try {
      const entries = await fs.readdir(this.directory);
      const files = entries.filter((f) => f.endsWith('.jsonl'));
      if (!files.length) { return undefined; }
      const stats = await Promise.all(
        files.map(async (f) => {
          const full = path.join(this.directory, f);
          const stat = await fs.stat(full).catch(() => undefined);
          return { full, at: stat?.mtimeMs ?? 0 };
        }),
      );
      stats.sort((a, b) => b.at - a.at);
      return stats[0]?.full;
    } catch {
      return undefined;
    }
  }

  /** Append one entry. Failures are swallowed: logging never breaks a turn. */
  async append(sessionId: string, type: string, data?: unknown): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const file = this.fileFor(sessionId);
      const entry: SessionLogEntry = {
        at: new Date().toISOString(),
        session: sessionId,
        type,
        ...(data !== undefined ? { data: redactValue(data) } : {}),
      };
      await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
      this.written.set(sessionId, (this.written.get(sessionId) ?? 0) + 1);
    } catch {
      // A log that cannot be written must never break the agent.
    }
  }

  /** How many entries were written for a session. */
  countFor(sessionId: string): number {
    return this.written.get(sessionId) ?? 0;
  }
}

/** A short, stable id for a payload (for the log's index). */
export function payloadId(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data ?? null)).digest('hex').slice(0, 12);
}
