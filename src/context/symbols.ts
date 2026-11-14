/**
 * Symbol index (FR-12 — the "@symbol" mentions the brief asks for).
 *
 * A lightweight, language-agnostic scan for definitions: functions, classes,
 * methods, constants and types. No language server, no embeddings — just a
 * line scanner, so it works for any file the workspace contains.
 *
 * The user types "@login" and gets the function `login` in `src/auth.ts`.
 */

export type SymbolKind = 'function' | 'class' | 'method' | 'constant' | 'type';

export interface SymbolDef {
  name: string;
  kind: SymbolKind;
  /** Workspace-relative path. */
  path: string;
  /** 1-based line of the definition. */
  line: number;
  /** The definition line, trimmed. */
  signature: string;
}

interface Rule {
  kind: SymbolKind;
  pattern: RegExp;
}

/** The definition shapes we recognise. */
const RULES: Rule[] = [
  // JavaScript / TypeScript
  { kind: 'function', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: 'class', pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', pattern: /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'constant', pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/ },
  // Python
  { kind: 'function', pattern: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
  { kind: 'class', pattern: /^\s*class\s+([A-Za-z_][\w]*)/ },
  // Go
  { kind: 'function', pattern: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/ },
  { kind: 'type', pattern: /^\s*(?:type)\s+([A-Za-z_][\w]*)/ },
  // Rust
  { kind: 'function', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][\w]*)/ },
  { kind: 'type', pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/ },
  // Java / C# / Kotlin
  { kind: 'class', pattern: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|open|data|sealed)\s+)*(?:class|interface|object)\s+([A-Za-z_][\w]*)/ },
  { kind: 'function', pattern: /^\s*(?:(?:public|private|protected|internal|static|final|suspend|override)\s+)+fun\s+([A-Za-z_][\w]*)/ },
];

/** A method: `name(args) {` — but never a keyword. */
const METHOD_RE = /^\s*(?:(?:public|private|protected|static|async|override|get|set|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/;

/** Words that look like a method call but are not definitions. */
const NOT_A_METHOD = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'do', 'else',
  'try', 'with', 'match', 'case', 'when', 'foreach', 'unless', 'elif',
]);

/** The definitions in one file. */
export function findSymbolsInText(path: string, content: string): SymbolDef[] {
  const out: SymbolDef[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > 400) { continue; }
    for (const rule of RULES) {
      const match = rule.pattern.exec(line);
      if (!match) { continue; }
      const name = match[1];
      if (!name) { continue; }
      out.push({ name, kind: rule.kind, path, line: i + 1, signature: line.trim().slice(0, 160) });
      break; // one definition per line
    }
    if (out.length && out.at(-1)?.line === i + 1) { continue; }
    const method = METHOD_RE.exec(line);
    if (method) {
      const name = method[1];
      if (name && !NOT_A_METHOD.has(name)) {
        out.push({ name, kind: 'method', path, line: i + 1, signature: line.trim().slice(0, 160) });
      }
    }
  }
  return out;
}

/**
 * Score a symbol against the query: an exact name beats a prefix, which beats
 * a substring.
 */
export function scoreSymbol(symbol: SymbolDef, query: string): number {
  if (!query) { return 1; }
  const needle = query.toLowerCase();
  const name = symbol.name.toLowerCase();
  if (name === needle) { return 100; }
  if (name.startsWith(needle)) { return 70; }
  if (name.includes(needle)) { return 40; }
  if (symbol.path.toLowerCase().includes(needle)) { return 20; }
  return 0;
}

/** The symbols that match a query, best first. */
export function rankSymbols(symbols: readonly SymbolDef[], query: string, limit = 20): SymbolDef[] {
  return symbols
    .map((symbol) => ({ symbol, score: scoreSymbol(symbol, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.path.localeCompare(b.symbol.path) || a.symbol.line - b.symbol.line)
    .slice(0, limit)
    .map((s) => s.symbol);
}

/** A readable label for the picker: "login · function · src/auth.ts:12". */
export function symbolLabel(symbol: SymbolDef): string {
  return `${symbol.name} · ${symbol.kind} · ${symbol.path}:${symbol.line}`;
}
