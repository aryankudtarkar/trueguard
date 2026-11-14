import { describe, expect, it } from 'vitest';
import { findSymbolsInText, rankSymbols, scoreSymbol, symbolLabel } from '../../src/context/symbols';

describe('the symbol index', () => {
  it('finds Python functions and classes', () => {
    const symbols = findSymbolsInText('app.py', 'def login(user):\n    pass\n\nclass User:\n    pass\n');
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ['login', 'function'],
      ['User', 'class'],
    ]);
  });

  it('finds TypeScript functions, classes and types', () => {
    const source = [
      'export function greet(name: string) {',
      '}',
      'export class Widget {',
      '}',
      'export interface Options {',
      '}',
      'export const VERSION = "1";',
    ].join('\n');
    const symbols = findSymbolsInText('a.ts', source);
    const names = symbols.map((s) => s.name);
    expect(names).toContain('greet');
    expect(names).toContain('Widget');
    expect(names).toContain('Options');
    expect(names).toContain('VERSION');
  });

  it('finds Go and Rust functions', () => {
    expect(findSymbolsInText('a.go', 'func Handle(w http.ResponseWriter) {')[0]?.name).toBe('Handle');
    expect(findSymbolsInText('a.rs', 'pub fn parse(input: &str) -> bool {')[0]?.name).toBe('parse');
  });

  it('does not mistake a control-flow statement for a method', () => {
    const symbols = findSymbolsInText('a.ts', 'if (x) {\n  return 1;\n}\nwhile (y) {\n}\n');
    expect(symbols.length).toBe(0);
  });

  it('finds a method', () => {
    const symbols = findSymbolsInText('a.ts', 'class A {\n  async load() {\n  }\n}');
    expect(symbols.map((s) => s.kind)).toContain('method');
  });

  it('records the line and the signature', () => {
    const symbols = findSymbolsInText('a.py', '\n\ndef go():\n    pass\n');
    expect(symbols[0]?.line).toBe(3);
    expect(symbols[0]?.signature).toBe('def go():');
  });

  it('scores an exact name highest', () => {
    const symbols = findSymbolsInText('a.py', 'def login():\n    pass\ndef login_user():\n    pass\n');
    const ranked = rankSymbols(symbols, 'login');
    expect(ranked[0]?.name).toBe('login');
  });

  it('scores a prefix above a substring', () => {
    const exact = { name: 'login', kind: 'function' as const, path: 'a.py', line: 1, signature: '' };
    const partial = { name: 'login_user', kind: 'function' as const, path: 'b.py', line: 1, signature: '' };
    expect(scoreSymbol(exact, 'login')).toBeGreaterThan(scoreSymbol(partial, 'login'));
  });

  it('returns nothing for an unrelated query', () => {
    const symbols = findSymbolsInText('a.py', 'def login():\n    pass\n');
    expect(rankSymbols(symbols, 'zzz')).toEqual([]);
  });

  it('labels a symbol for the picker', () => {
    const symbols = findSymbolsInText('src/auth.py', 'def login():\n    pass\n');
    expect(symbolLabel(symbols[0]!)).toBe('login · function · src/auth.py:1');
  });
});
