import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTEXT_BUDGET_BYTES,
  describeContext,
  formatBytes,
  formatContext,
  keywords,
  retrieveContext,
  scoreFile,
  type ContextCandidate,
} from '../../src/context/retriever';

/**
 * Context assembly (FR-12): the right files, within a visible budget.
 */

const CANDIDATES: ContextCandidate[] = [
  {
    path: 'src/auth/login.ts',
    content: ['export function login(user) {', '  return authenticate(user);', '}'].join('\n'),
  },
  {
    path: 'src/format/date.ts',
    content: ['export function formatDate(date) {', '  return date.toISOString();', '}'].join('\n'),
  },
  {
    path: 'docs/readme.md',
    content: '# The project\nA coding agent in the editor.\n',
  },
];

describe('context retrieval', () => {
  it('picks the file that matches the message', () => {
    const context = retrieveContext('fix the login function', CANDIDATES);
    expect(context.files.length).toBeGreaterThan(0);
    expect(context.files[0]?.path).toBe('src/auth/login.ts');
  });

  it('does not pick an unrelated file', () => {
    const context = retrieveContext('formatDate toISOString', CANDIDATES);
    expect(context.files.map((f) => f.path)).toContain('src/format/date.ts');
    expect(context.files.map((f) => f.path)).not.toContain('src/auth/login.ts');
  });

  it('ignores the words that say nothing', () => {
    expect(keywords('please fix the login bug')).toEqual(['login', 'bug']);
    expect(keywords('the and of')).toEqual([]);
  });

  it('stays inside the budget', () => {
    const many: ContextCandidate[] = Array.from({ length: 20 }, (_, i) => ({
      path: `src/file${i}.ts`,
      content: Array.from({ length: 50 }, (_, l) => `export const shared${l} = ${l};`).join('\n'),
    }));
    const context = retrieveContext('shared export const', many, 2048, 8);
    expect(context.bytes).toBeLessThanOrEqual(2048);
    expect(context.files.length).toBeLessThanOrEqual(8);
    expect(context.truncated).toBe(true);
  });

  it('reports the budget it used', () => {
    const context = retrieveContext('login authenticate', CANDIDATES);
    expect(context.limit).toBe(DEFAULT_CONTEXT_BUDGET_BYTES);
    expect(context.bytes).toBeGreaterThan(0);
  });

  it('finds nothing when nothing matches', () => {
    const context = retrieveContext('zzzz qqqq', CANDIDATES);
    expect(context.files.length).toBe(0);
    expect(context.bytes).toBe(0);
  });

  it('scores a file by path and by content', () => {
    const scored = scoreFile('src/auth/login.ts', 'authenticate the user', ['authenticate']);
    expect(scored.score).toBeGreaterThan(0);
    expect(scored.excerpt).toContain('authenticate');
  });

  it('formats the context for the agent', () => {
    const context = retrieveContext('login function', CANDIDATES);
    const text = formatContext(context);
    expect(text).toContain('src/auth/login.ts');
    expect(text).toContain('Context from the workspace');
  });

  it('tells the user which files were chosen', () => {
    const context = retrieveContext('login function', CANDIDATES);
    const summary = describeContext(context, ['docs/readme.md']);
    expect(summary).toContain('src/auth/login.ts');
    expect(summary).toContain('docs/readme.md');
    expect(summary).toContain('of 16 KB');
    // No context, no row: an empty line is noise.
    expect(describeContext(retrieveContext('zzzz qqqq', CANDIDATES))).toBe('');
  });

  it('formats sizes readably', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(2200)).toBe('2.1 KB');
    expect(formatBytes(16_384)).toBe('16 KB');
  });

  it('says nothing when there is no context', () => {
    const context = retrieveContext('zzzz qqqq', CANDIDATES);
    expect(describeContext(context)).toBe('');
    expect(formatContext(context)).toBe('');
  });
});
