import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, readdir, stat, realpath } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EditorMcpServer, type McpEndpoint } from '../../src/mcp/editorServer';
import { type EditorToolDeps } from '../../src/mcp/tools';

let root: string;
let endpoint: McpEndpoint;
let server: EditorMcpServer;
let deps: EditorToolDeps;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'trueguard-mcp-'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, 'src/app.ts'), 'export const a = 1;\nexport const b = 2;\n');
  await writeFile(path.join(root, '.git/config'), '[core]\n');
  await writeFile(path.join(root, '.env'), 'SECRET=1\n');
  // 500-line file for cap behavior
  await writeFile(path.join(root, 'src/big.ts'), Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  deps = {
    workspaceRoots: async () => [root],
    readText: async (abs) => {
      const content = await (await import('node:fs/promises')).readFile(abs, 'utf8');
      const lines = content.split('\n');
      return { content, totalLines: lines.at(-1) === '' ? lines.length - 1 : lines.length };
    },
    listFiles: async () => {
      const out: string[] = [];
      const walk = async (dir: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.name === '.git') { continue; } // gitignore-respecting stand-in
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          const st = await stat(path.join(dir, entry.name));
          if (st.isDirectory()) { await walk(path.join(dir, entry.name), rel); }
          else { out.push(rel); }
        }
      };
      await walk(root, '');
      return out.sort();
    },
    getDiagnostics: async () => [{ path: 'src/app.ts', severity: 'error', line: 1, message: 'test diagnostic' }],
    getEditorContext: async () => ({ activeFile: 'src/app.ts', openTabs: ['src/app.ts'] }),
    allowSecretReads: () => false,
    outputCapBytes: () => 16_384,
  };
  server = new EditorMcpServer(deps, 45899);
  endpoint = await server.start();
});

afterAll(async () => {
  server.dispose();
  await rm(root, { recursive: true, force: true });
});

interface RpcResponse {
  status: number;
  body: Record<string, unknown>;
}

/** First text content of a CallToolResult; throws (test-fatal) if missing. */
function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text;
  if (text === undefined) { throw new Error('tool result has no text content'); }
  return text;
}

function rpc(method: string, params: unknown, headers: Record<string, string> = {}): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = http.request(
      {
        host: '127.0.0.1',
        port: endpoint.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${endpoint.token}`,
          ...headers,
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c: Buffer) => { b += c; });
        res.on('end', () => {
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(b) as Record<string, unknown>; } catch { body = { raw: b }; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

async function initialize(): Promise<void> {
  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0' },
  });
}

describe('editor MCP server (protocol + security)', () => {
  it('answers healthz without auth', async () => {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/healthz`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('rejects missing/wrong bearer tokens with 401', async () => {
    const noAuth = await rpc('initialize', {}, { authorization: '' });
    expect(noAuth.status).toBe(401);
    const wrong = await rpc('initialize', {}, { authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);
  });

  it('rejects non-loopback Host headers with 403', async () => {
    const res = await new Promise<{ status?: number }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: endpoint.port,
          path: '/mcp',
          method: 'POST',
          headers: { host: 'evil.example.com', 'content-type': 'application/json' },
        },
        (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); },
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(res.status).toBe(403);
  });

  it('initializes and lists exactly the five read-only tools', async () => {
    await initialize();
    const res = await rpc('tools/list', {});
    const tools = ((res.body.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
    expect(tools.sort()).toEqual(['get_diagnostics', 'get_editor_context', 'list_files', 'read_file', 'search_text']);
  });

  it('read_file returns numbered lines, totalLines and contentHash', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: 'src/app.ts' } });
    const result = res.body.result as { isError?: boolean };
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(firstText(res.body.result)) as { totalLines: number; contentHash: string; lines: string };
    expect(parsed.totalLines).toBe(2);
    expect(parsed.lines).toContain('1| export const a = 1;');
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('read_file path escape returns a structured error, never a crash', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: '../outside/x.txt' } });
    const result = res.body.result as { isError?: boolean };
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(firstText(res.body.result)) as { error: string };
    expect(['outside_workspace', 'not_found']).toContain(parsed.error);
  });

  it('read_file denies .git paths', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: '.git/config' } });
    const result = res.body.result as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(res.body.result))).toMatchObject({ error: 'denied' });
  });

  it('read_file caps at 400 lines by default with truncated flag', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: 'src/big.ts' } });
    const parsed = JSON.parse(firstText(res.body.result)) as {
      endLine: number;
      totalLines: number;
      truncated: boolean;
    };
    expect(parsed.endLine).toBe(400);
    expect(parsed.totalLines).toBe(500);
    expect(parsed.truncated).toBe(true);
  });

  it('read_file honors startLine/endLine ranges', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: 'src/big.ts', startLine: 498, endLine: 500 } });
    const parsed = JSON.parse(firstText(res.body.result)) as { lines: string };
    expect(parsed.lines).toBe('498| line 498\n499| line 499\n500| line 500');
  });

  it('read_file prefers the dirty buffer (deps.readText contract)', async () => {
    await initialize();
    const realRoot = await realpath(root);
    const dirtyDeps: EditorToolDeps = {
      ...deps,
      readText: async (abs) => {
        if (abs === path.join(realRoot, 'src', 'app.ts')) {
          return { content: 'dirty buffer content\n', totalLines: 1 };
        }
        return deps.readText(abs);
      },
    };
    const dirty = new EditorMcpServer(dirtyDeps, 45901);
    const ep = await dirty.start();
    const req = rpcWith(ep);
    await req('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    const res = await req('tools/call', { name: 'read_file', arguments: { path: 'src/app.ts' } });
    const parsed = JSON.parse(firstText(res.body.result)) as { lines: string };
    expect(parsed.lines).toContain('dirty buffer content');
    dirty.dispose();
  });

  it('list_files lists workspace files without .git', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'list_files', arguments: {} });
    const parsed = JSON.parse(firstText(res.body.result)) as { files: string[] };
    expect(parsed.files).toContain('src/app.ts');
    expect(parsed.files.some((f) => f.includes('.git'))).toBe(false);
  });

  it('search_text finds matches with path:line: snippets', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'search_text', arguments: { pattern: 'const a', glob: 'src/**' } });
    const parsed = JSON.parse(firstText(res.body.result)) as {
      matches: Array<{ path: string; line: number; snippet: string }>;
    };
    expect(parsed.matches).toContainEqual(expect.objectContaining({ path: 'src/app.ts', line: 1 }));
  });

  it('get_diagnostics and get_editor_context round-trip', async () => {
    await initialize();
    const d = await rpc('tools/call', { name: 'get_diagnostics', arguments: {} });
    const dp = JSON.parse(firstText(d.body.result)) as { diagnostics: unknown[] };
    expect(dp.diagnostics).toHaveLength(1);
    const c = await rpc('tools/call', { name: 'get_editor_context', arguments: {} });
    const cp = JSON.parse(firstText(c.body.result)) as { context: { activeFile: string } };
    expect(cp.context.activeFile).toBe('src/app.ts');
  });

  it('unknown tool yields a tool-level error, not a crash', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'propose_edit', arguments: {} });
    // The SDK reports unknown tools either as a JSON-RPC error or an isError result
    const result = res.body.result as { isError?: boolean } | undefined;
    expect(res.body.error !== undefined || result?.isError === true).toBe(true);
  });

  it('rejects bad arguments with a validation error, never a crash', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: 42 } });
    const result = res.body.result as { isError?: boolean } | undefined;
    expect(res.body.error !== undefined || result?.isError === true).toBe(true);
  });

  it('rejects a missing required argument', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: {} });
    const result = res.body.result as { isError?: boolean } | undefined;
    expect(res.body.error !== undefined || result?.isError === true).toBe(true);
  });

  it('refuses a secret file read over MCP', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'read_file', arguments: { path: '.env' } });
    const result = res.body.result as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(res.body.result))).toMatchObject({ error: 'secret' });
  });

  it('rejects a search with a broken regular expression', async () => {
    await initialize();
    const res = await rpc('tools/call', { name: 'search_text', arguments: { pattern: '([', isRegex: true } });
    const result = res.body.result as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(JSON.parse(firstText(res.body.result))).toMatchObject({ error: 'invalid' });
  });
});

function rpcWith(ep: McpEndpoint) {
  return (method: string, params: unknown): Promise<RpcResponse> =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
      const req = http.request(
        {
          host: '127.0.0.1',
          port: ep.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${ep.token}`,
          },
        },
        (res) => {
          let b = '';
          res.on('data', (c: Buffer) => { b += c; });
          res.on('end', () => {
            let body: Record<string, unknown> = {};
            try { body = JSON.parse(b) as Record<string, unknown>; } catch { body = { raw: b }; }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on('error', reject);
      req.end(data);
    });
}

describe('port fallback', () => {
  it('falls back to the next free port when the default is taken', async () => {
    const a = new EditorMcpServer(deps, 45910);
    const b = new EditorMcpServer(deps, 45910);
    const epA = await a.start();
    const epB = await b.start();
    expect(epB.port).toBe(epA.port + 1);
    a.dispose();
    b.dispose();
  });
});
