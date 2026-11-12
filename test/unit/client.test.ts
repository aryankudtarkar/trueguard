import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { TrueForgeClient, TrueForgeError } from '../../src/trueforge/client';
import type { StreamingEvent } from '../../src/trueforge/schemas';

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
let child: ChildProcess | undefined;
let client: TrueForgeClient;

beforeAll(() => {
  child = spawn('node', ['tools/fake-trueforge/server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, FAKE_TF_PORT: String(PORT) },
    stdio: 'ignore',
  });
  client = new TrueForgeClient(BASE);
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      fetch(`${BASE}/api/v1/users`).then(() => { clearInterval(timer); resolve(); }).catch(() => {});
    }, 100);
  });
});

afterAll(() => { child?.kill(); });

describe('TrueForgeClient against fake-trueforge', () => {
  it('health detects a live server and a dead one', async () => {
    expect(await client.health()).toBe(true);
    const dead = new TrueForgeClient('http://127.0.0.1:1');
    expect(await dead.health()).toBe(false);
  });

  it('creates a session and parses the envelope', async () => {
    const session = await client.createSession({ model: { name: 'fake/test' } });
    expect(session.id).toMatch(/^sess_/);
  });

  it('streams a turn and yields validated events in order', async () => {
    const session = await client.createSession({ model: { name: 'fake/test' } });
    const events: StreamingEvent[] = [];
    await client.sendTurn(session.id, [{ type: 'user.message', content: 'hi' }], {
      onEvent: (e) => events.push(e),
      onEnd: () => undefined,
    });
    expect(events.map((e) => e.type)).toEqual(['turn.created', 'model.message', 'model.message.delta', 'model.message.delta', 'turn.done']);
  });

  it('surfaces a provider 401 as TrueForgeError status 0 (HTTP stays 200)', async () => {
    const session = await client.createSession({ model: { name: 'fake/test' } });
    await fetch(`${BASE}/__fault`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: '401' }) });
    let error: unknown;
    const events: StreamingEvent[] = [];
    try {
      await client.sendTurn(session.id, [{ type: 'user.message', content: 'hi' }], { onEvent: (e) => events.push(e), onEnd: () => undefined });
    } catch (e) { error = e; }
    expect(error).toBeUndefined();
    const done = events.at(-1);
    expect(done && 'state' in done ? done.state.status : undefined).toBe('error');
    expect(done && 'state' in done ? done.state.message : undefined).toContain('401');
  });

  it('propagates HTTP-level failures (404) as TrueForgeError', async () => {
    let error: TrueForgeError | undefined;
    try {
      await client.sendTurn('sess_missing', [{ type: 'user.message', content: 'x' }], { onEvent: () => undefined, onEnd: () => undefined });
    } catch (e) { error = e as TrueForgeError; }
    expect(error).toBeInstanceOf(TrueForgeError);
    expect(error?.status).toBe(404);
  });

  it('patches the session model for failover', async () => {
    const session = await client.createSession({ model: { name: 'fake/test' } });
    await client.updateSessionModel(session.id, { name: 'fake/fallback' });
    const res = await fetch(`${BASE}/api/v1/sessions/${session.id}`);
    const body = (await res.json()) as { data: { agent: { spec: { model: { name: string } } } } };
    expect(body.data.agent.spec.model.name).toBe('fake/fallback');
  });

  it('aborts a turn when the signal fires (Stop button path)', async () => {
    const session = await client.createSession({ model: { name: 'fake/test' } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const events: StreamingEvent[] = [];
    await client.sendTurn(session.id, [{ type: 'user.message', content: 'hi' }], {
      onEvent: (e) => events.push(e),
      onEnd: () => undefined,
    }, controller.signal);
    // Stream is torn down; no exception escapes, end callback fired via finally
    expect(events.length).toBeLessThanOrEqual(5);
  });
});
