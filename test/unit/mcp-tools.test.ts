import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PathGuard } from '../../src/mcp/pathGuard';
import {
  readFile,
  listFiles,
  searchText,
  getDiagnostics,
  getEditorContext,
  runTool,
  type EditorToolDeps,
  type ToolContext,
} from '../../src/mcp/tools';

/**
 * Tool-level tests (PRD 2.6): success, bad input, path escape, symlink escape
 * and cap behavior for every read-only editor tool.
 */

let root: string;
let outside: string;
let deps: EditorToolDeps;
let allowSecrets = false;
let capBytes = 16_384;

beforeAll(async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'trueguard-tools-'));
  root = path.join(base, 'ws');
  outside = path.join(base, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(path.join(root, 'src/app.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(path.join(root, 'src/other.ts'), 'export const a = 1;\nconst c = 3;\n');
  await writeFile(
    path.join(root, 'src/big.ts'),
    Array.from({ length: 2500 }, (_, i) => `export const line${i + 1} = ${i + 1};`).join('\n') + '\n',
  );
  await writeFile(path.join(root, '.env'), 'SECRET=1\n');
  await writeFile(path.join(root, 'key.pem'), '-----BEGIN KEY-----\n');
  await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
  await symlink(outside, path.join(root, 'link-out'));

  deps = {
    workspaceRoots: async () => [root],
    readText: async (abs) => {
      const content = await (await import('node:fs/promises')).readFile(abs, 'utf8');
      const lines = content.split('\n');
      return { content, totalLines: lines.at(-1) === '' ? lines.length - 1 : lines.length };
    },
    listFiles: async () => ['src/app.ts', 'src/other.ts', 'src/big.ts', '.env', 'key.pem'],
    getDiagnostics: async () => [],
    getEditorContext: async () => ({ activeFile: 'src/app.ts' }),
    allowSecretReads: () => allowSecrets,
    outputCapBytes: () => capBytes,
  };
});

afterAll(async () => {
  await rm(path.dirname(root), { recursive: true, force: true });
});

function ctx(): ToolContext {
  return { deps, guard: new PathGuard({ roots: [root], allowSecrets }) };
}

function parse(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

describe('read_file', () => {
  it('returns numbered lines, totalLines and a content hash', async () => {
    const res = await readFile({ path: 'src/app.ts' }, ctx());
    const out = parse(res);
    expect(out.totalLines).toBe(2);
    expect(String(out.lines)).toContain('1| export const a = 1;');
    expect(String(out.contentHash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects endLine before startLine', async () => {
    const res = await readFile({ path: 'src/app.ts', startLine: 10, endLine: 2 }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('invalid');
  });

  it('rejects a startLine past the end of the file', async () => {
    const res = await readFile({ path: 'src/app.ts', startLine: 99 }, ctx());
    expect(res.isError).toBe(true);
    expect(String(parse(res).message)).toContain('beyond end of file');
  });

  it('refuses a path outside the workspace', async () => {
    const res = await readFile({ path: '../outside/secret.txt' }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('outside_workspace');
  });

  it('refuses a symlink that escapes the workspace', async () => {
    const res = await readFile({ path: 'link-out/secret.txt' }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('outside_workspace');
  });

  it('refuses .git paths', async () => {
    const res = await readFile({ path: '.git/config' }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('denied');
  });

  it('refuses secret files unless the user opted in', async () => {
    const res = await readFile({ path: '.env' }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('secret');
    allowSecrets = true;
    try {
      const allowed = await readFile({ path: '.env' }, ctx());
      expect(allowed.isError).toBeUndefined();
    } finally {
      allowSecrets = false;
    }
  });

  it('caps the returned range at 400 lines by default', async () => {
    const out = parse(await readFile({ path: 'src/big.ts' }, ctx()));
    expect(out.endLine).toBe(400);
    expect(out.totalLines).toBe(2500);
    expect(out.truncated).toBe(true);
  });

  it('never returns more than the hard line cap', async () => {
    const out = parse(await readFile({ path: 'src/big.ts', startLine: 1, endLine: 5000 }, ctx()));
    expect(out.endLine).toBe(2000);
  });
});

describe('list_files', () => {
  it('lists workspace files', async () => {
    const out = parse(await listFiles({}, ctx()));
    expect(Array.isArray(out.files)).toBe(true);
    expect((out.files as string[]).length).toBe(5);
  });

  it('caps at maxResults and flags the truncation', async () => {
    const out = parse(await listFiles({ maxResults: 2 }, ctx()));
    expect((out.files as string[]).length).toBe(2);
    expect(out.truncated).toBe(true);
    expect(out.count).toBe(2);
  });
});

describe('search_text', () => {
  it('finds matches with path, line and snippet', async () => {
    const out = parse(await searchText({ pattern: 'const a' }, ctx()));
    const matches = out.matches as Array<{ path: string; line: number; snippet: string }>;
    expect(matches.length).toBe(2);
    expect(matches[0]?.path).toBe('src/app.ts');
    expect(matches[0]?.line).toBe(1);
  });

  it('honors maxResults', async () => {
    const out = parse(await searchText({ pattern: 'const a', maxResults: 1 }, ctx()));
    expect((out.matches as unknown[]).length).toBe(1);
    expect(out.truncated).toBe(true);
  });

  it('returns a structured error for a broken regular expression', async () => {
    const res = await searchText({ pattern: '([', isRegex: true }, ctx());
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('invalid');
  });

  it('never leaks a path that escapes the workspace', async () => {
    const out = parse(await searchText({ pattern: 'secret' }, ctx()));
    const matches = out.matches as Array<{ path: string }>;
    expect(matches.some((m) => m.path.includes('link-out'))).toBe(false);
  });
});

describe('diagnostics and editor context', () => {
  it('returns diagnostics and editor context', async () => {
    const d = parse(await getDiagnostics({}, ctx()));
    expect(d.count).toBe(0);
    const c = parse(await getEditorContext({}, ctx()));
    expect((c.context as { activeFile: string }).activeFile).toBe('src/app.ts');
  });
});

describe('runTool wrapper', () => {
  it('turns an unexpected error into a structured error, never a throw', async () => {
    const broken: ToolContext = {
      deps: { ...deps, readText: async () => { throw new Error('boom'); } },
      guard: new PathGuard({ roots: [root] }),
    };
    const res = await runTool(() => readFile({ path: 'src/app.ts' }, broken));
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('internal');
  });
});

describe('large files', () => {
  it('refuses a file over the size limit and asks for a range', async () => {
    const bigDeps: EditorToolDeps = { ...deps, sizeOf: async () => 5_000_000 };
    const res = await readFile({ path: 'src/app.ts' }, { deps: bigDeps, guard: new PathGuard({ roots: [root] }) });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toBe('too_large');
    expect(String(parse(res).message)).toContain('startLine');
  });

  it('skips oversized files while searching', async () => {
    const bigDeps: EditorToolDeps = { ...deps, sizeOf: async () => 5_000_000 };
    const out = parse(await searchText({ pattern: 'const a' }, { deps: bigDeps, guard: new PathGuard({ roots: [root] }) }));
    expect((out.matches as unknown[]).length).toBe(0);
  });
});

describe('output cap', () => {  it('elides an over-cap result and keeps the marker', async () => {
    capBytes = 1024;
    try {
      const res = await readFile({ path: 'src/big.ts' }, ctx());
      expect(res.isError).toBeUndefined();
      // The payload stays valid JSON, with the bulky body elided head/tail.
      expect(res.content[0]?.text).toContain('chars elided');
      expect(() => JSON.parse(res.content[0]?.text ?? '')).not.toThrow();
      expect(res.content[0]?.text.length).toBeLessThan(2048);
      // The structure survives: the agent still knows the file and its size.
      const out = parse(res);
      expect(out.path).toBe('src/big.ts');
      expect(out.totalLines).toBe(2500);
    } finally {
      capBytes = 16_384;
    }
  });
});
