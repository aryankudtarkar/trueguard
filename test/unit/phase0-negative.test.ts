// A4 adversarial negative tests for Phase 0 (audit). Aimed at the riskiest
// behaviors: fake-server fidelity to the real API, state leaks between tests,
// host guard, fault handling.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 8793;
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

describe('phase 0 adversarial: fake-trueforge edge behavior', () => {
  it('NEG1: unknown fault mode is rejected, not ignored silently', async () => {
    const res = await fetch(`${BASE}/__fault`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'nuke' }),
    });
    expect(res.status).toBe(400);
  });

  it('NEG2: scripted events are consumed once (no leak into next turn)', async () => {
    const created = (await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { data: { id: string } };
    await fetch(`${BASE}/__script`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ type: 'model.message.delta', content: 'scripted-only' }] }) });
    const res1 = await fetch(`${BASE}/api/v1/sessions/${created.data.id}/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [{ type: 'user.message', content: 'a' }], stream: true }) });
    expect(await res1.text()).toContain('scripted-only');
    const res2 = await fetch(`${BASE}/api/v1/sessions/${created.data.id}/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [{ type: 'user.message', content: 'b' }], stream: true }) });
    expect(await res2.text()).not.toContain('scripted-only');
  });

  it('NEG3: turns on a nonexistent session return 404 error envelope', async () => {
    const res = await fetch(`${BASE}/api/v1/sessions/nope/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [], stream: true }) });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('not found');
  });

  it('NEG4: PATCH on nonexistent session returns 404', async () => {
    const res = await fetch(`${BASE}/api/v1/sessions/nope`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: { spec: { model: { name: 'x' } } } }) });
    expect(res.status).toBe(404);
  });

  it('NEG5: stream=false returns JSON, not SSE', async () => {
    const created = (await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { data: { id: string } };
    const res = await fetch(`${BASE}/api/v1/sessions/${created.data.id}/turns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [{ type: 'user.message', content: 'x' }], stream: false }) });
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
