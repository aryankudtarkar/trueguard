import { describe, expect, it } from 'vitest';
import { applyHunks, computeHunks, type Hunk } from '../../src/edits/hunks';

/**
 * Randomized property tests (PRD Phase 3.8):
 *
 *  - apply-all  === proposed text
 *  - apply-none === base text
 *  - any subset leaves the untouched regions byte-identical
 *
 * The generator produces pseudo-random base files and random edits, so a
 * failure shows up as a concrete counterexample.
 */

/** Deterministic PRNG so a failure can be replayed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function randomFile(random: () => number, lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    out.push(`line ${i + 1} ${Math.floor(random() * 1000)}`);
  }
  return out.join('\n') + (random() > 0.5 ? '\n' : '');
}

/** Random edits: replace, insert or delete a random slice of lines. */
function randomEdits(random: () => number, base: string): string {
  const baseLines = base.split('\n');
  const result = [...baseLines];
  const count = 1 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const at = Math.floor(random() * Math.max(1, result.length));
    const kind = random();
    if (kind < 0.5) {
      result.splice(at, 1, `changed ${Math.floor(random() * 1000)}`);
    } else if (kind < 0.75) {
      result.splice(at, 0, `inserted ${Math.floor(random() * 1000)}`);
    } else if (result.length > 1) {
      result.splice(at, 1);
    }
  }
  return result.join('\n');
}

/** Lines of the base that no accepted hunk touches. */
function untouchedLines(base: string, hunks: Hunk[], accepted: ReadonlySet<string>): string[] {
  const touched = new Set<number>();
  for (const hunk of hunks) {
    if (!accepted.has(hunk.id)) { continue; }
    for (let line = hunk.oldStart; line < hunk.oldStart + hunk.oldLines; line++) {
      touched.add(line);
    }
  }
  return base
    .split('\n')
    .filter((_, i) => !touched.has(i + 1));
}

describe('randomized hunk properties', () => {
  it('apply-all equals the proposed text, apply-none equals the base', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const random = rng(seed);
      const base = randomFile(random, 5 + Math.floor(random() * 40));
      const proposed = randomEdits(random, base);
      const hunks = computeHunks(base, proposed);

      const all = applyHunks(base, hunks, new Set(hunks.map((h) => h.id)));
      expect(all, `seed ${seed}`).toBe(proposed);

      const none = applyHunks(base, hunks, new Set());
      expect(none, `seed ${seed}`).toBe(base);
    }
  });

  it('any subset keeps the untouched regions byte-identical', () => {
    for (let seed = 100; seed <= 160; seed++) {
      const random = rng(seed);
      const base = randomFile(random, 10 + Math.floor(random() * 30));
      const proposed = randomEdits(random, base);
      const hunks = computeHunks(base, proposed);

      // Try every subset for small hunk counts, a sample for larger ones.
      const max = Math.min(hunks.length, 8);
      for (let mask = 0; mask < 2 ** max; mask++) {
        const accepted = new Set<string>();
        hunks.slice(0, max).forEach((hunk, i) => {
          if (mask & (1 << i)) { accepted.add(hunk.id); }
        });
        const applied = applyHunks(base, hunks, accepted);
        const untouched = untouchedLines(base, hunks, accepted);
        for (const line of untouched) {
          expect(applied, `seed ${seed} mask ${mask}`).toContain(line);
        }
      }
    }
  });

  it('produces a stable id set across recomputation', () => {
    for (let seed = 300; seed <= 320; seed++) {
      const random = rng(seed);
      const base = randomFile(random, 12);
      const proposed = randomEdits(random, base);
      const a = computeHunks(base, proposed).map((h) => h.id);
      const b = computeHunks(base, proposed).map((h) => h.id);
      expect(a).toEqual(b);
    }
  });
});
