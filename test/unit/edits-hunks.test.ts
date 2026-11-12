import { describe, expect, it } from 'vitest';
import { applyHunks, computeHunks, hunkId, toDisplayHunks, toLines } from '../../src/edits/hunks';

const BASE = [
  'line one',
  'line two',
  'line three',
  'line four',
  'line five',
].join('\n');

describe('hunk engine', () => {
  it('produces one hunk for one changed line', () => {
    const hunks = computeHunks(BASE, BASE.replace('line three', 'line THREE'));
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.oldStart).toBe(3);
    expect(hunks[0]?.oldLines).toBe(1);
    expect(hunks[0]?.newLines).toEqual(['line THREE']);
  });

  it('produces one hunk for an insertion', () => {
    const hunks = computeHunks(BASE, BASE.replace('line two', 'line two\ninserted'));
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.oldLines).toBe(0);
    expect(hunks[0]?.newLines).toEqual(['inserted']);
  });

  it('produces one hunk for a deletion', () => {
    const hunks = computeHunks(BASE, BASE.replace('line three\n', ''));
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.oldLines).toBe(1);
    expect(hunks[0]?.newLines).toEqual([]);
  });

  it('gives hunks stable ids', () => {
    const a = computeHunks(BASE, BASE.replace('line three', 'x'));
    const b = computeHunks(BASE, BASE.replace('line three', 'x'));
    expect(a[0]?.id).toBe(b[0]?.id);
    const c = computeHunks(BASE, BASE.replace('line three', 'y'));
    expect(a[0]?.id).not.toBe(c[0]?.id);
  });

  it('derives the id from position and content', () => {
    expect(hunkId(3, ['a'], ['b'])).toBe(hunkId(3, ['a'], ['b']));
    expect(hunkId(3, ['a'], ['b'])).not.toBe(hunkId(4, ['a'], ['b']));
  });

  it('applies all hunks to reach the proposed text', () => {
    const proposed = 'line one\nCHANGED\nline three\nline four\nline five';
    const hunks = computeHunks(BASE, proposed);
    const applied = applyHunks(BASE, hunks, new Set(hunks.map((h) => h.id)));
    expect(applied).toBe(proposed);
  });

  it('applies no hunk to leave the base text untouched', () => {
    const hunks = computeHunks(BASE, 'completely different');
    expect(applyHunks(BASE, hunks, new Set())).toBe(BASE);
  });

  it('keeps the trailing newline of the base text', () => {
    const base = 'a\nb\n';
    const hunks = computeHunks(base, 'a\nB\n');
    const applied = applyHunks(base, hunks, new Set(hunks.map((h) => h.id)));
    expect(applied).toBe('a\nB\n');
  });

  it('adds context lines for the review view', () => {
    const hunks = computeHunks(BASE, BASE.replace('line three', 'X'));
    const display = toDisplayHunks(BASE, hunks, 2);
    expect(display[0]?.contextBefore).toEqual(['line one', 'line two']);
    expect(display[0]?.contextAfter).toEqual(['line four', 'line five']);
    expect(display[0]?.removed).toBe(1);
    expect(display[0]?.added).toBe(1);
  });

  it('keeps the trailing newline as an explicit line', () => {
    // The trailing empty element IS the trailing newline: dropping it would
    // make "apply everything" unable to reproduce the proposed text.
    expect(toLines('a\nb\n')).toEqual(['a', 'b', '']);
    expect(toLines('a\nb')).toEqual(['a', 'b']);
    expect(toLines('')).toEqual([]);
  });
});
