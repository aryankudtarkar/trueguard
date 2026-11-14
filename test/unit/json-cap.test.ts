import { describe, expect, it } from 'vitest';
import { capJson, elideString } from '../../src/util/jsonCap';

describe('capJson', () => {
  it('leaves a small payload untouched', () => {
    const res = capJson({ a: 1, b: 'two' }, 1024);
    expect(res.truncated).toBe(false);
    expect(JSON.parse(res.text)).toEqual({ a: 1, b: 'two' });
  });

  it('keeps the payload valid JSON when it has to elide', () => {
    const big = { path: 'a.ts', totalLines: 10, lines: 'x'.repeat(50_000) };
    const res = capJson(big, 1024);
    expect(res.truncated).toBe(true);
    const parsed = JSON.parse(res.text) as { path: string; totalLines: number; lines: string };
    expect(parsed.path).toBe('a.ts');
    expect(parsed.totalLines).toBe(10);
    expect(parsed.lines.length).toBeLessThan(50_000);
    expect(Buffer.byteLength(res.text)).toBeLessThanOrEqual(1024);
  });

  it('halves arrays of results when the strings are already small', () => {
    const value = { matches: Array.from({ length: 500 }, (_, i) => ({ path: `f${i}.ts`, line: i })) };
    const res = capJson(value, 2048);
    const parsed = JSON.parse(res.text) as { matches: unknown[] };
    expect(res.truncated).toBe(true);
    expect(parsed.matches.length).toBeLessThan(500);
    expect(parsed.matches.length).toBeGreaterThan(0);
  });

  it('never returns invalid JSON, even for a value that cannot shrink', () => {
    const res = capJson({ huge: 'a'.repeat(100_000) }, 64);
    expect(() => JSON.parse(res.text)).not.toThrow();
  });
});

describe('elideString', () => {
  it('keeps the head and the tail and marks the gap', () => {
    const out = elideString('a'.repeat(100) + 'END', 40);
    expect(out).toContain('END');
    expect(out).toContain('chars elided');
    expect(out.length).toBeLessThan(100);
  });
});
