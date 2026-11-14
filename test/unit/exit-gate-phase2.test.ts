import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TrueForgeClient } from '../../src/trueforge/client';
import { EditorMcpServer, MCP_SERVER_NAME } from '../../src/mcp/editorServer';
import type { EditorToolDeps } from '../../src/mcp/tools';
import type { StreamingEvent } from '../../src/trueforge/schemas';

/**
 * Phase 2 exit gate, against a REAL TrueForge server and the real editor MCP
 * server: the agent must reach the workspace through our tools and read a
 * named function back.
 *
 * Needs `npm run trueforge` (localhost:8790) and the fake OpenAI provider
 * (spikes/fake-openai.mjs, localhost:8799). Skipped at runtime when either is
 * not running.
 */

const BASE_URL = 'http://localhost:8790';
const FAKE_LLM = 'http://127.0.0.1:8799';
const FUNCTION_NAME = 'forgeGuardPhaseTwoProbe';

async function probe(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
}

/** The fake LLM only answers POST /set-mode; any HTTP response means it is up. */
async function probeFakeLlm(): Promise<boolean> {
  return fetch(FAKE_LLM, { signal: AbortSignal.timeout(2000) })
    .then(() => true)
    .catch(() => false);
}

async function setFakeMode(body: Record<string, unknown>): Promise<void> {
  await fetch(`${FAKE_LLM}/set-mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('phase 2 exit gate: real TrueForge + editor MCP server', () => {
  it('lets the agent find a function through the editor tools', async (ctx) => {
    if (!(await probe(`${BASE_URL}/api/v1/users`))) { ctx.skip(); }
    if (!(await probeFakeLlm())) { ctx.skip(); }

    const root = await mkdtemp(path.join(os.tmpdir(), 'trueguard-e2g-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'src/app.ts'),
      `export function ${FUNCTION_NAME}() {\n  return 42;\n}\n`,
    );

    const deps: EditorToolDeps = {
      workspaceRoots: async () => [root],
      readText: async (abs) => {
        const content = await (await import('node:fs/promises')).readFile(abs, 'utf8');
        const lines = content.split('\n');
        return { content, totalLines: lines.at(-1) === '' ? lines.length - 1 : lines.length };
      },
      listFiles: async () => ['src/app.ts'],
      getDiagnostics: async () => [],
      getEditorContext: async () => ({ activeFile: 'src/app.ts' }),
      allowSecretReads: () => false,
      outputCapBytes: () => 16_384,
    };

    const server = new EditorMcpServer(deps, 45930);
    const endpoint = await server.start();
    const client = new TrueForgeClient(BASE_URL);

    try {
      // Register the connector exactly like the extension does (FR-3).
      await client.upsertMcpServer({
        type: 'remote',
        name: MCP_SERVER_NAME,
        url: endpoint.url,
        description: 'TrueGuard editor tools: read-only workspace access from the agent.',
        auth: { type: 'header', headers: { authorization: `Bearer ${endpoint.token}` } },
      });

      await setFakeMode({ mode: 'call-tool', tool: 'read_file', args: '{"path":"src/app.ts"}' });

      const session = await client.createSession({
        model: { name: 'fake-provider/test-model' },
        instructions: 'You are TrueGuard, a careful coding agent inside VS Code.',
        mcp_servers: [
          {
            name: MCP_SERVER_NAME,
            enable_tools: ['@all'],
            require_approval_for_tools: [],
            preload: true,
          },
        ],
      });

      const events: StreamingEvent[] = [];
      await client.sendTurn(
        session.id,
        [{ type: 'user.message', content: 'Where is the probe function defined?' }],
        { onEvent: (e) => events.push(e), onEnd: () => undefined },
      );

      const types = events.map((e) => e.type);
      expect(types).toContain('mcp.initialize');
      expect(types).toContain('tool.response');

      const response = events.find((e) => e.type === 'tool.response');
      const content = (response as { content?: unknown } | undefined)?.content;
      expect(String(content)).toContain(FUNCTION_NAME);

      // Keep the raw transcript as evidence for the Phase 2 audit.
      await writeFile(
        path.join(process.cwd(), 'docs', 'spikes', 'phase2-exit-gate-transcript.md'),
        [
          '# Phase 2 exit gate — real TrueForge + TrueGuard editor MCP server',
          '',
          `- date: ${new Date().toISOString()}`,
          `- connector: ${MCP_SERVER_NAME} at ${endpoint.url} (bearer auth)`,
          `- model: fake-provider/test-model (spikes/fake-openai.mjs)`,
          `- prompt: Where is the probe function defined?`,
          '',
          '## Events',
          '',
          '```json',
          ...events.map((e) => JSON.stringify(e)),
          '```',
          '',
        ].join('\n'),
        'utf8',
      );
    } finally {
      await setFakeMode({ mode: 'echo' });
      server.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
