import { describe, expect, it } from 'vitest';
import {
  applyProposedEdits,
  findAll,
  lineOf,
  matchEdits,
  nearestCandidates,
} from '../../src/edits/matcher';

const BASE = [
  'export function alpha() {',
  '  return 1;',
  '}',
  '',
  'export function beta() {',
  '  return 2;',
  '}',
  '',
].join('\n');

describe('edit matcher', () => {
  it('matches a unique oldText exactly', () => {
    const res = matchEdits(BASE, [{ oldText: '  return 1;', newText: '  return 11;' }]);
    expect(res.ok).toBe(true);
    expect(res.matches.length).toBe(1);
    expect(res.matches[0]?.line).toBe(2);
  });

  it('reports zero matches with the nearest candidate lines', () => {
    const res = matchEdits(BASE, [{ oldText: '  return 42;', newText: 'x' }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('no_match');
    expect(res.errors[0]?.candidates?.length).toBeGreaterThan(0);
    // The candidate lines point at the two return statements.
    expect(res.errors[0]?.candidates?.map((c) => c.line)).toContain(2);
  });

  it('reports multiple matches with the candidate lines', () => {
    const res = matchEdits(BASE, [{ oldText: '  return', newText: '  give' }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('multiple_matches');
    expect(res.errors[0]?.candidates?.map((c) => c.line).sort()).toEqual([2, 6]);
  });

  it('refuses overlapping edits', () => {
    const res = matchEdits(BASE, [
      { oldText: 'export function alpha() {', newText: 'x' },
      { oldText: 'export function alpha() {\n  return 1;', newText: 'y' },
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'overlapping_edits')).toBe(true);
  });

  it('refuses an empty oldText', () => {
    const res = matchEdits(BASE, [{ oldText: '', newText: 'x' }]);
    expect(res.ok).toBe(false);
    expect(res.errors[0]?.code).toBe('empty_old_text');
  });

  it('applies the matched edits to the base text', () => {
    const edits = [
      { oldText: '  return 1;', newText: '  return 11;' },
      { oldText: '  return 2;', newText: '  return 22;' },
    ];
    const res = matchEdits(BASE, edits);
    const out = applyProposedEdits(BASE, res.matches, edits);
    expect(out).toContain('  return 11;');
    expect(out).toContain('  return 22;');
    expect(out).not.toContain('  return 1;');
  });
});

describe('matcher helpers', () => {
  it('finds every occurrence, including overlapping ones', () => {
    expect(findAll('aaa', 'aa')).toEqual([0, 1]);
    expect(findAll('abc', 'z')).toEqual([]);
  });

  it('reports 1-based line numbers', () => {
    expect(lineOf('a\nb\nc', 0)).toBe(1);
    expect(lineOf('a\nb\nc', 2)).toBe(2);
    expect(lineOf('a\nb\nc', 4)).toBe(3);
  });

  it('ranks the closest candidate lines first', () => {
    const candidates = nearestCandidates(BASE, 'export function alpha() {');
    expect(candidates[0]?.line).toBe(1);
  });
});
