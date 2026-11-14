/**
 * Automatic context retrieval (FR-12, brief B1).
 *
 * When the user sends a message, the extension picks the files that matter
 * for it and attaches them — within a visible budget. The user can always see
 * which files were chosen and how much of the budget they use.
 *
 * The scoring is deliberately simple and explainable: the words of the
 * message are matched against the file path and its lines. The best matches
 * win, until the budget is used up.
 */

export interface ContextCandidate {
  path: string;
  /** The file's text (already read). */
  content: string;
}

export interface ContextFile {
  path: string;
  /** How well the file matched the message. */
  score: number;
  /** The lines that matched, with their numbers. */
  excerpt: string;
  /** The size of the excerpt in bytes. */
  bytes: number;
}

export interface ContextBudget {
  files: ContextFile[];
  /** The bytes used. */
  bytes: number;
  /** The budget. */
  limit: number;
  /** True when something was left out because the budget ran out. */
  truncated: boolean;
}

/** The default budget: 16 KB of context per message. */
export const DEFAULT_CONTEXT_BUDGET_BYTES = 16_384;

/** Words that say nothing about the code. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'for', 'with', 'as',
  'at', 'by', 'from', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'please',
  'can', 'could', 'should', 'would', 'make', 'change', 'code', 'file', 'files', 'add',
  'remove', 'update', 'fix', 'write', 'implement', 'refactor', 'do', 'not', 'no', 'so',
]);

/** The meaningful words of a message. */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** Score a file against the message keywords. */
export function scoreFile(path: string, content: string, words: readonly string[]): { score: number; excerpt: string } {
  if (!words.length) { return { score: 0, excerpt: '' }; }
  const lowerPath = path.toLowerCase();
  let score = 0;
  const matchedLines: Array<{ line: number; text: string }> = [];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lower = (lines[i] ?? '').toLowerCase();
    let lineScore = 0;
    for (const word of words) {
      if (lowerPath.includes(word)) { lineScore += 2; }
      if (lower.includes(word)) { lineScore += 1; }
    }
    if (lineScore > 0) {
      score += lineScore;
      matchedLines.push({ line: i + 1, text: lines[i] ?? '' });
    }
  }
  if (score === 0) { return { score: 0, excerpt: '' }; }
  // Keep the best lines, in file order.
  const best = matchedLines.slice(0, 12);
  const excerpt = best.map((l) => `${l.line}| ${l.text}`).join('\n');
  return { score, excerpt };
}

/**
 * Choose the files that matter for the message, within the budget.
 */
export function retrieveContext(
  message: string,
  candidates: readonly ContextCandidate[],
  limitBytes = DEFAULT_CONTEXT_BUDGET_BYTES,
  maxFiles = 8,
): ContextBudget {
  const words = keywords(message);
  const scored = candidates
    .map((candidate) => {
      const { score, excerpt } = scoreFile(candidate.path, candidate.content, words);
      return { path: candidate.path, score, excerpt, bytes: Buffer.byteLength(excerpt, 'utf8') };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const files: ContextFile[] = [];
  let bytes = 0;
  let truncated = false;
  for (const candidate of scored) {
    if (files.length >= maxFiles) { truncated = true; break; }
    if (bytes + candidate.bytes > limitBytes) {
      truncated = true;
      continue;
    }
    files.push({ path: candidate.path, score: candidate.score, excerpt: candidate.excerpt, bytes: candidate.bytes });
    bytes += candidate.bytes;
  }
  return { files, bytes, limit: limitBytes, truncated };
}

/** The context block that is sent with the message. */
export function formatContext(context: ContextBudget, files: readonly string[] = []): string {
  const parts: string[] = [];
  for (const file of context.files) {
    parts.push(`--- ${file.path} ---\n${file.excerpt}`);
  }
  for (const path of files) {
    if (context.files.some((f) => f.path === path)) { continue; }
    parts.push(`--- ${path} (mentioned) ---`);
  }
  if (!parts.length) { return ''; }
  return ['Context from the workspace:', ...parts].join('\n\n');
}

/** A readable size: "820 B", "2.1 KB", "16 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/**
 * The row the user sees: which files were chosen and how much budget they
 * use. Nothing at all when there is no context — an empty row is noise.
 */
export function describeContext(context: ContextBudget, mentioned: readonly string[] = []): string {
  const names = [
    ...context.files.map((f) => f.path),
    ...mentioned.filter((p) => !context.files.some((f) => f.path === p)),
  ];
  if (!names.length || context.bytes === 0) { return ''; }
  return `Context: ${names.join(', ')} — ${formatBytes(context.bytes)} of ${formatBytes(context.limit)}`;
}
