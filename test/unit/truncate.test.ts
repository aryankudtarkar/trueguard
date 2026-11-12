import { describe, expect, it } from 'vitest';
import { truncateMiddle } from '../../src/util/truncate';

describe('truncateMiddle (FR-9 cap)', () => {
  it('returns short text untouched', () => {
    const r = truncateMiddle('hello', 100);
    expect(r).toEqual({ text: 'hello', truncated: false });
  });

  it('elides the middle with a helpful marker over the cap', () => {
    const text = 'x'.repeat(50_000);
    const r = truncateMiddle(text, 1000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(1400);
    expect(r.text.startsWith('x')).toBe(true);
    expect(r.text.endsWith('x')).toBe(true);
    expect(r.text).toContain('output truncated');
    expect(r.text).toContain('Narrow the request');
  });
});
