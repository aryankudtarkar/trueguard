/**
 * Text normalization (Phase 3.1).
 *
 * Every edit is computed on LF-normalized text so that diffs and hashes are
 * stable, but the file on disk keeps its own conventions: BOM, EOL style and
 * trailing newline are restored when the result is written back.
 */

/** EOL styles we can preserve. */
export type EolStyle = '\n' | '\r\n' | '\r';

export interface TextProfile {
  /** The file starts with a UTF-8 BOM. */
  bom: boolean;
  /** The dominant EOL style of the file. */
  eol: EolStyle;
  /** The file mixes several EOL styles. */
  mixed: boolean;
  /** The file ends with a line break. */
  trailingNewline: boolean;
}

export const BOM = '﻿';

export function hasBom(text: string): boolean {
  return text.startsWith(BOM);
}

/** Remove a leading BOM, if any. */
export function stripBom(text: string): string {
  return hasBom(text) ? text.slice(BOM.length) : text;
}

/** Convert every EOL style to LF. */
export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** The EOL style used first in the text (LF when there is none). */
export function detectEol(text: string): { eol: EolStyle; mixed: boolean } {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  const matches = text.match(/\r\n|\r|\n/g);
  for (const m of matches ?? []) {
    if (m === '\r\n') { crlf++; } else if (m === '\r') { cr++; } else { lf++; }
  }
  const distinct = [crlf, lf, cr].filter((n) => n > 0).length;
  const eol: EolStyle = crlf > 0 && crlf >= lf && crlf >= cr ? '\r\n' : cr > 0 && cr > lf ? '\r' : '\n';
  return { eol, mixed: distinct > 1 };
}

/** Describe the conventions of a file so they can be restored later. */
export function profileText(raw: string): TextProfile {
  const body = stripBom(raw);
  const { eol, mixed } = detectEol(body);
  return {
    bom: hasBom(raw),
    eol,
    mixed,
    // Any line break counts: a CR-only file ends with a line break too.
    trailingNewline: /(?:\r\n|\r|\n)$/.test(body),
  };
}

/**
 * Turn LF text back into the file's own conventions: BOM, EOL style and the
 * original trailing-newline state.
 */
export function materialize(lfText: string, profile: TextProfile): string {
  let body = lfText;
  // Restore the trailing-newline convention of the original file.
  if (profile.trailingNewline && !body.endsWith('\n')) {
    body += '\n';
  } else if (!profile.trailingNewline && body.endsWith('\n')) {
    body = body.replace(/\n$/, '');
  }
  if (profile.eol !== '\n') {
    body = body.replace(/\n/g, profile.eol);
  }
  return profile.bom ? BOM + body : body;
}

/**
 * The text an agent edits: BOM stripped, LF normalized. The profile is kept
 * separately so the result can be materialized again.
 */
export function toEditableText(raw: string): { text: string; profile: TextProfile } {
  return { text: toLf(stripBom(raw)), profile: profileText(raw) };
}
