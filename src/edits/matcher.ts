/**
 * Edit matcher (Phase 3.2).
 *
 * The agent proposes exact-match edits. Every `oldText` must match exactly
 * once in the current text. Zero matches and several matches are reported as
 * structured errors — with the nearest candidate line numbers — BEFORE any UI
 * appears, so the agent can correct itself without wasting a turn.
 */

export interface ProposedEdit {
  oldText: string;
  newText: string;
}

export type EditErrorCode =
  | 'no_match'
  | 'multiple_matches'
  | 'overlapping_edits'
  | 'empty_old_text'
  | 'invalid';

export interface EditError {
  code: EditErrorCode;
  message: string;
  /** Index of the offending edit in the proposals array. */
  editIndex?: number;
  /** Lines that look like the intended target (nearest candidates). */
  candidates?: Array<{ line: number; text: string }>;
}

export interface EditMatch {
  editIndex: number;
  /** Character offset of the match in the base text. */
  start: number;
  /** Character offset just past the match. */
  end: number;
  /** 1-based line number of the match start. */
  line: number;
}

export interface MatchResult {
  ok: boolean;
  matches: EditMatch[];
  errors: EditError[];
}

/** 1-based line number of a character offset. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') { line++; }
  }
  return line;
}

/** All offsets where `needle` occurs in `haystack`. */
export function findAll(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) { return out; }
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) { break; }
    out.push(at);
    from = at + 1; // overlapping occurrences count too
  }
  return out;
}

/**
 * Nearest candidate lines for a failed match: lines that share the most
 * content with `oldText` (normalized whitespace, case-insensitive).
 */
export function nearestCandidates(text: string, oldText: string, limit = 5): Array<{ line: number; text: string }> {
  const lines = text.split('\n');
  const needle = normalizeForCompare(oldText);
  const scored = lines.map((line, i) => ({ line: i + 1, text: line, score: similarity(line, needle) }));
  return scored
    .filter((s) => s.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ line, text: content }) => ({ line, text: content.slice(0, 200) }));
}

function normalizeForCompare(text: string): string {
  return text.replace(/\r\n/g, '\n').trim().toLowerCase();
}

/** Cheap token-overlap score between two strings. */
function similarity(a: string, b: string): number {
  const left = new Set(normalizeForCompare(a).split(/\W+/).filter(Boolean));
  const right = new Set(normalizeForCompare(b).split(/\W+/).filter(Boolean));
  if (left.size === 0 || right.size === 0) { return 0; }
  let shared = 0;
  for (const token of left) { if (right.has(token)) { shared++; } }
  return shared / Math.max(left.size, right.size);
}

/**
 * Match every proposed edit against the base text.
 * All edits must match exactly once, and they must not overlap.
 */
export function matchEdits(baseText: string, edits: readonly ProposedEdit[]): MatchResult {
  const errors: EditError[] = [];
  const matches: EditMatch[] = [];

  edits.forEach((edit, editIndex) => {
    if (edit.oldText === '') {
      errors.push({
        code: 'empty_old_text',
        editIndex,
        message: 'oldText must not be empty. Use create for new files instead.',
      });
      return;
    }
    const offsets = findAll(baseText, edit.oldText);
    if (offsets.length === 0) {
      errors.push({
        code: 'no_match',
        editIndex,
        message: `oldText does not appear in the file. Copy it exactly from the file, including indentation.`,
        candidates: nearestCandidates(baseText, edit.oldText),
      });
      return;
    }
    if (offsets.length > 1) {
      errors.push({
        code: 'multiple_matches',
        editIndex,
        message: `oldText appears ${offsets.length} times in the file. Make it unique by including more context.`,
        candidates: offsets.slice(0, 5).map((offset) => ({
          line: lineOf(baseText, offset),
          text: baseText.slice(offset, offset + 120).split('\n')[0] ?? '',
        })),
      });
      return;
    }
    const start = offsets[0]!;
    matches.push({ editIndex, start, end: start + edit.oldText.length, line: lineOf(baseText, start) });
  });

  // Overlap check (only between edits that matched).
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) {
      errors.push({
        code: 'overlapping_edits',
        editIndex: cur.editIndex,
        message: `edit ${cur.editIndex} overlaps edit ${prev.editIndex}. Apply them one at a time.`,
      });
    }
  }

  return { ok: errors.length === 0, matches, errors };
}

/** Apply the matched edits to the base text (all of them, in order). */
export function applyProposedEdits(baseText: string, matches: readonly EditMatch[], edits: readonly ProposedEdit[]): string {
  const ordered = [...matches].sort((a, b) => b.start - a.start);
  let out = baseText;
  for (const m of ordered) {
    const edit = edits[m.editIndex];
    if (!edit) { continue; }
    out = out.slice(0, m.start) + edit.newText + out.slice(m.end);
  }
  return out;
}
