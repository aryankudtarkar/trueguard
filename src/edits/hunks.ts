/**
 * Hunk engine (Phase 3.3).
 *
 * The extension computes the diff itself — never the model. Hunks come from a
 * zero-context diff of base text vs proposed text, so every hunk is
 * independent: the user can accept any subset and the result is always the
 * base text plus exactly those hunks.
 */

import { createHash } from 'node:crypto';
import { diffArrays } from 'diff';

export interface Hunk {
  /** Stable id: the same hunk keeps its id for the life of the proposal. */
  id: string;
  /** 1-based line in the base text where the hunk starts. */
  oldStart: number;
  /** Number of base lines the hunk replaces. */
  oldLines: number;
  /** The replacement lines (LF text, without EOL). */
  newLines: string[];
}

export interface DisplayHunk extends Hunk {
  /** Base lines before the change (for context). */
  contextBefore: string[];
  /** Base lines after the change (for context). */
  contextAfter: string[];
  /** The base lines the hunk removes. */
  removedLines: string[];
  added: number;
  removed: number;
}

/**
 * Stable hunk id: derived from the position and the content it touches, so
 * re-computing the same diff yields the same ids.
 */
export function hunkId(oldStart: number, removed: readonly string[], added: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update(`${oldStart}\n${removed.join('\n')}\n--\n${added.join('\n')}`);
  return `h${hash.digest('hex').slice(0, 12)}`;
}

interface DiffPart {
  lines: string[];
  added: boolean;
  removed: boolean;
}

/**
 * Split a text into lines.
 *
 * The trailing empty element is KEPT: it is the file's trailing newline, and
 * dropping it would make "apply everything" unable to reproduce a text whose
 * trailing newline changed.
 */
export function toLines(text: string): string[] {
  if (text === '') { return []; }
  return text.split('\n');
}

/**
 * Compute zero-context hunks between base and proposed text.
 * Uses a Myers diff (jsdiff) over lines.
 */
export function computeHunks(baseText: string, proposedText: string): Hunk[] {
  const baseLines = toLines(baseText);
  const proposedLines = toLines(proposedText);
  const parts = diffLines(baseLines, proposedLines);

  const hunks: Hunk[] = [];
  let oldLine = 1; // next base line number
  let index = 0;

  while (index < parts.length) {
    const part = parts[index]!;
    if (!part.added && !part.removed) {
      oldLine += part.lines.length;
      index++;
      continue;
    }
    // Collect the whole change block (consecutive removed/added parts).
    const removed: string[] = [];
    const added: string[] = [];
    let oldCount = 0;
    while (index < parts.length) {
      const p = parts[index]!;
      if (p.removed) {
        removed.push(...p.lines);
        oldCount += p.lines.length;
        index++;
        continue;
      }
      if (p.added) {
        added.push(...p.lines);
        index++;
        continue;
      }
      break;
    }

    // A block that replaces as many lines as it removes can be split into one
    // hunk per line: accepting one and rejecting the other then leaves a
    // sensible intermediate state, instead of an all-or-nothing blob.
    if (removed.length > 1 && removed.length === added.length) {
      removed.forEach((oldLineText, i) => {
        hunks.push({
          id: hunkId(oldLine + i, [oldLineText], [added[i]!]),
          oldStart: oldLine + i,
          oldLines: 1,
          newLines: [added[i]!],
        });
      });
    } else {
      hunks.push({
        id: hunkId(oldLine, removed, added),
        oldStart: oldLine,
        oldLines: oldCount,
        newLines: added,
      });
    }
    oldLine += oldCount;
  }

  return hunks;
}

/**
 * Apply a subset of hunks to the base text.
 * The hunks must be given in ascending oldStart order.
 */
export function applyHunks(baseText: string, hunks: readonly Hunk[], acceptedIds: ReadonlySet<string>): string {
  const accepted = hunks.filter((h) => acceptedIds.has(h.id)).sort((a, b) => a.oldStart - b.oldStart);
  if (accepted.length === 0) { return baseText; }
  const baseLines = toLines(baseText);
  const out: string[] = [];
  let cursor = 0; // 0-based index into baseLines
  for (const hunk of accepted) {
    const start = hunk.oldStart - 1;
    out.push(...baseLines.slice(cursor, start));
    out.push(...hunk.newLines);
    cursor = start + hunk.oldLines;
  }
  out.push(...baseLines.slice(cursor));
  return out.join('\n');
}

/** Group hunks with a few context lines for display in the review UI. */
export function toDisplayHunks(baseText: string, hunks: readonly Hunk[], context = 3): DisplayHunk[] {
  const baseLines = toLines(baseText);
  return hunks.map((hunk) => {
    const start = hunk.oldStart - 1;
    const removed = baseLines.slice(start, start + hunk.oldLines);
    return {
      ...hunk,
      contextBefore: baseLines.slice(Math.max(0, start - context), start),
      contextAfter: baseLines.slice(start + hunk.oldLines, start + hunk.oldLines + context),
      removedLines: removed,
      added: hunk.newLines.length,
      removed: removed.length,
    };
  });
}

/**
 * A Myers diff over arrays of lines.
 *
 * jsdiff does the heavy lifting; this wrapper keeps the dependency behind one
 * function so the algorithm can be swapped or tested in isolation.
 */
export function diffLines(baseLines: string[], proposedLines: string[]): DiffPart[] {
  const changes = diffArrays(baseLines, proposedLines);
  return changes.map((c) => ({
    lines: c.value,
    added: Boolean(c.added),
    removed: Boolean(c.removed),
  }));
}
