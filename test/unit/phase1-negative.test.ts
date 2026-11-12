import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { TrueForgeClient } from '../../src/trueforge/client';
import { SessionManager } from '../../src/trueforge/sessionManager';
import { ServerManager, ServerState } from '../../src/trueforge/serverManager';
import { ChatViewProvider } from '../../src/ui/chatProvider';
import { contextChipSchema, webviewToHostMessageSchema } from '../../src/ui/chatProtocolSchemas';
import * as vscode from '../mocks/vscode';

const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | undefined;

beforeAll(() => {
  child = spawn('node', ['tools/fake-trueforge/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, FAKE_TF_PORT: String(PORT) },
    stdio: 'ignore',
  });
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      fetch(`${BASE}/api/v1/users`).then(() => { clearInterval(timer); resolve(); }).catch(() => {});
    }, 100);
  });
});

afterAll(() => { child?.kill(); });

function fakeContext() {
  const store = new Map<string, unknown>();
  return {
    workspaceState: {
      get: (k: string) => store.get(k),
      update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
    },
  };
}

function fakeServerManager(baseUrl: string): ServerManager {
  vscode.workspace.configOverrides.set('forgeguard.trueforge.baseUrl', baseUrl);
  const sm = new ServerManager(fakeContext() as never);
  vscode.workspace.configOverrides.delete('forgeguard.trueforge.baseUrl');
  return sm;
}

function makeSessionManager(base: string): SessionManager {
  const server = {
    getState: () => ServerState.Ready,
    client: new TrueForgeClient(base),
    onStateChange: () => ({ dispose: () => undefined }),
  };
  return new SessionManager(server as never, fakeContext() as never);
}

describe('phase 1 negative tests', () => {
  it('NEG6 webview→host message validation rejects malicious/malformed shapes', () => {
    expect(webviewToHostMessageSchema.safeParse({ type: 'send', text: 42, chips: [] }).success).toBe(false);
    expect(webviewToHostMessageSchema.safeParse({ type: 'exec', cmd: 'rm -rf /' }).success).toBe(false);
    expect(webviewToHostMessageSchema.safeParse({ type: 'copyText', text: 'x'.repeat(33_000) }).success).toBe(false);
    expect(webviewToHostMessageSchema.safeParse({ type: 'send', text: 'hi', chips: [{ path: 'a.ts', selection: { startLine: 5, endLine: 2 } }] }).success).toBe(false);
    expect(webviewToHostMessageSchema.safeParse({ type: 'updateChip', chip: null }).success).toBe(true);
    expect(contextChipSchema.safeParse({ path: '../../etc/passwd' }).success).toBe(true); // path is display-only in chat
  });

  it('NEG7 ChatViewProvider drops invalid webview messages and acts on valid ones', async () => {
    const sessions = makeSessionManager(BASE);
    const provider = new ChatViewProvider('/out/webview', { onStateChange: () => ({ dispose: () => undefined }) } as never, sessions);
    let handler: ((m: unknown) => void) | undefined;
    const posted: unknown[] = [];
    const view = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-webview:',
        asWebviewUri: (u: unknown) => u,
        postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); },
        onDidReceiveMessage: (h: (m: unknown) => void) => { handler = h; },
      },
    } as never;
    provider.resolveWebviewView(view);
    expect(handler).toBeDefined();
    handler!({ type: 'ready' });
    await new Promise((r) => setTimeout(r, 0));
    handler!({ type: 'send', text: 42, chips: [] });
    handler!({ type: 'exec', cmd: 'boom' });
    await new Promise((r) => setTimeout(r, 0));
    // The ready snapshot is the only 'messages' post; invalid messages add none
    expect(posted.filter((m) => (m as { type: string }).type === 'messages')).toHaveLength(1);
    handler!({ type: 'newChat' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sessions.getActiveSessionId()).toBeUndefined();
    provider.dispose();
  });

  it('NEG8 concurrent sendTurn: second call is rejected before any await (one-turn guard)', async () => {
    const sessions = makeSessionManager(BASE);
    const first = sessions.sendTurn([{ type: 'user.message', content: 'one' }], () => undefined, 'fake/test');
    await expect(sessions.sendTurn([{ type: 'user.message', content: 'two' }], () => undefined, 'fake/test'))
      .rejects.toThrow('already running');
    await expect(first).resolves.toBeUndefined();
    await expect(sessions.sendTurn([{ type: 'user.message', content: 'three' }], () => undefined, 'fake/test')).resolves.toBeUndefined();
  });

  it('NEG9 the SSE parser skips unparseable scripted events and keeps streaming', async () => {
    const client = new TrueForgeClient(BASE);
    const session = await client.createSession({ model: { name: 'fake/test' } });
    await fetch(`${BASE}/__script`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ type: 'garbage.event', blob: 'x' }, { type: 'model.message.delta', id: 'd1', thread_id: 'main', content: 'survived' }] }),
    });
    const events: unknown[] = [];
    await client.sendTurn(session.id, [{ type: 'user.message', content: 'hi' }], {
      onEvent: (e) => events.push(e),
      onEnd: () => undefined,
    });
    const types = events.map((e) => (e as { type: string }).type);
    expect(types).toContain('model.message.delta');
    expect(types.at(-1)).toBe('turn.done');
  });

  it('NEG10 ServerManager reconnects with backoff when TrueForge appears later', async () => {
    const dead = `http://127.0.0.1:${PORT + 1}`;
    const server = fakeServerManager(dead);
    expect(server.getState()).toBe(ServerState.Stopped);
    // Start a second fake server on the "dead" port after 1.3s (after the first 1s probe missed)
    const late = spawn('node', ['tools/fake-trueforge/server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_TF_PORT: String(PORT + 1) },
      stdio: 'ignore',
    });
    setTimeout(() => late.unref?.(), 0);
    const sawReady = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 12_000);
      server.onStateChange((s) => {
        if (s === ServerState.Ready) { clearTimeout(timer); resolve(true); }
      });
    });
    late.kill();
    expect(sawReady).toBe(true);
    server.dispose();
  });
});
