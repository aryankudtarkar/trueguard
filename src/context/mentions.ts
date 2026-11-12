/**
 * Mentions (FR-12, brief B1).
 *
 * The user can pull a file into the conversation with @path/to/file.ts.
 * The composer offers the workspace files; the mention becomes a context chip
 * that is sent with the message.
 */

/** A mention found in the user's message. */
export interface Mention {
  /** The text as typed, e.g. "@src/app.ts". */
  raw: string;
  kind: 'file' | 'symbol';
  /** The value without the "@". */
  value: string;
}

// The "@" must start a word: an email address is not a mention.
const MENTION_RE = /(?<![\w.@])@([\w./\\-]+(?:\.\w+)?)/g;

/** Find the mentions in a message. */
export function parseMentions(text: string): Mention[] {
  const found: Mention[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const raw = match[0];
    const value = match[1] ?? '';
    if (!value) { continue; }
    // "@" alone, an email address or a decorator is not a mention.
    if (/^@$/.test(raw)) { continue; }
    found.push({
      raw,
      kind: value.includes('.') || value.includes('/') ? 'file' : 'symbol',
      value,
    });
  }
  return found;
}

/** Remove the mentions from the text (they travel as chips instead). */
export function stripMentions(text: string): string {
  return text.replace(MENTION_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * The workspace files that match a mention query, best first.
 * A path prefix matches more strongly than a bare name.
 */
export function findFilesForMention(files: readonly string[], query: string, limit = 10): string[] {
  const needle = query.toLowerCase();
  if (!needle) { return files.slice(0, limit); }
  const scored = files
    .map((path) => {
      const lower = path.toLowerCase();
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      let score = 0;
      if (lower === needle) { score = 100; }
      else if (lower.endsWith(`/${needle}`)) { score = 90; }
      else if (lower.startsWith(needle)) { score = 80; }
      else if (base === needle) { score = 70; }
      else if (base.startsWith(needle)) { score = 50; }
      else if (lower.includes(needle)) { score = 30; }
      else if (base.includes(needle)) { score = 20; }
      return { path, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}

/**
 * Resolve the mentions of a message to workspace files.
 * A mention that matches nothing is left alone (it may be a symbol).
 */
export function resolveMentions(files: readonly string[], mentions: readonly Mention[]): string[] {
  const resolved: string[] = [];
  for (const mention of mentions) {
    const matches = findFilesForMention(files, mention.value, 1);
    if (matches[0]) { resolved.push(matches[0]); }
  }
  return [...new Set(resolved)];
}
