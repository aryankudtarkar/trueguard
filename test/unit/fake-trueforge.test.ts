import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | undefined;

beforeAll(() => {
  child = spawn('node', ['tools/fake-trueforge/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, FAKE_TF_PORT: String(PORT) },
    stdio: 'ignore',
  });
  // wait for listen
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      fetch(`${BASE}/api/v1/users`).then(() => { clearInterval(timer); resolve(); }).catch(() => {});
    }, 100);
  });
});

afterAll(() => {
  child?.kill();
});

async function readSse(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('no response body');
  const decoder = new TextDecoder();
  const events = [];
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = raw.split('\n').find((l) => l.startsWith('data:'));
      if (line) events.push(JSON.parse(line.slice(5).trim()));
    }
  }
  return events;
}

describe('fake-trueforge', () => {
  it('health endpoint responds', async () => {
    const res = await fetch(`${BASE}/api/v1/users`);
    expect(res.status).toBe(200);
  });

  it('rejects non-loopback Host header', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port: PORT, path: '/api/v1/users', method: 'GET', headers: { host: 'evil.example.com' } }, (r) => {
          void r.resume();
          resolve(r.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    });
    expect(status).toBe(403);
  });

  it('streams a scripted happy-path turn', async () => {
    await fetch(`${BASE}/__reset`, { method: 'POST' });
    const created = (await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { data: { id: string } };
    const sessionId = created.data.id;
    const res = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: [{ type: 'user.message', content: 'hi' }], stream: true }),
    });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.map((e) => e.type)).toEqual(['turn.created', 'model.message', 'model.message.delta', 'model.message.delta', 'turn.done']);
    const done = events.at(-1);
    expect(done.state.status).toBe('done');
    expect(done.state.output.content).toContain('Fake reply to: hi');
  });

  it('injects a 429 fault as a turn.done error event', async () => {
    const created = (await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { data: { id: string } };
    await fetch(`${BASE}/__fault`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: '429' }) });
    const res = await fetch(`${BASE}/api/v1/sessions/${created.data.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: [{ type: 'user.message', content: 'hi' }], stream: true }),
    });
    expect(res.status).toBe(200); // HTTP stays 200; error is in the stream
    const events = await readSse(res);
    const done = events.at(-1);
    expect(done.type).toBe('turn.done');
    expect(done.state.status).toBe('error');
    expect(done.state.message).toContain('429');
  });

  it('patches the session model (failover path)', async () => {
    const created = (await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { data: { id: string } };
    const res = await fetch(`${BASE}/api/v1/sessions/${created.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: { spec: { model: { name: 'fake/fallback' } } } }),
    });
    const patched = (await res.json()) as { data: { agent: { spec: { model: { name: string } } } } };
    expect(res.status).toBe(200);
    expect(patched.data.agent.spec.model.name).toBe('fake/fallback');
  });

  it('returns 404 with error envelope for unknown route', async () => {
    const res = await fetch(`${BASE}/api/v1/nonexistent`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Route not found');
  });
});
