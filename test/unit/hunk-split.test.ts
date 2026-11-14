import { describe, expect, it } from 'vitest';
import { applyHunks, computeHunks } from '../../src/edits/hunks';

/**
 * Splitting adjacent changes (Phase 9 follow-up).
 *
 * A block that replaces as many lines as it removes is split into one hunk
 * per line, so the user can accept one change and reject its neighbour
 * instead of getting an all-or-nothing blob.
 */

const BASE = ['one', 'two', 'three', 'four', 'five'].join('\n');

describe('splitting adjacent hunks', () => {
  it('splits two adjacent replacements into two hunks', () => {
    const proposed = ['one', 'TWO', 'THREE', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    expect(hunks.length).toBe(2);
    expect(hunks[0]?.oldStart).toBe(2);
    expect(hunks[0]?.newLines).toEqual(['TWO']);
    expect(hunks[1]?.oldStart).toBe(3);
    expect(hunks[1]?.newLines).toEqual(['THREE']);
  });

  it('keeps a pure insertion as one hunk', () => {
    const proposed = ['one', 'inserted', 'two', 'three', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.oldLines).toBe(0);
  });

  it('keeps a pure deletion as one hunk', () => {
    const proposed = ['one', 'three', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    expect(hunks.length).toBe(1);
    expect(hunks[0]?.oldLines).toBe(1);
  });

  it('applies all split hunks to the proposed text', () => {
    const proposed = ['one', 'TWO', 'THREE', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    const applied = applyHunks(BASE, hunks, new Set(hunks.map((h) => h.id)));
    expect(applied).toBe(proposed);
  });

  it('applies only one of the split hunks and leaves the other line alone', () => {
    const proposed = ['one', 'TWO', 'THREE', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    const applied = applyHunks(BASE, hunks, new Set([hunks[0]!.id]));
    expect(applied).toContain('TWO');
    expect(applied).toContain('three');
    expect(applied).not.toContain('THREE');
  });

  it('gives the split hunks distinct ids', () => {
    const proposed = ['one', 'TWO', 'THREE', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    expect(hunks[0]?.id).not.toBe(hunks[1]?.id);
  });

  it('does not split a block that adds and removes different amounts', () => {
    const proposed = ['one', 'added', 'three', 'four', 'five'].join('\n');
    const hunks = computeHunks(BASE, proposed);
    expect(hunks.length).toBe(1);
  });
});
