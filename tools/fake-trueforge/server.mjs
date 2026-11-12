#!/usr/bin/env node
// fake-trueforge: a local server emulating the VERIFIED subset of the TrueForge
// HTTP API (see docs/TRUEFORGE_NOTES.md). Deterministic, fault-injectable, used
// by unit tests. Real TrueForge is used for integration/spike flows via
// spikes/fake-openai.mjs when available.
//
// Endpoints (base /api/v1):
//  GET  /users                          -> 200 {}  (health)
//  POST /sessions                       -> 201 {data:{id, agent:{type:'inline',spec}}}
//  PATCH /sessions/:id                  -> 200 (updates agent.spec.model)
//  POST /sessions/:id/turns             -> 200 SSE or 400 (fault)
//  GET  /sessions/:id/turns/:tid/subscribe -> 200 SSE (replay)
//  POST /sessions/:id/cancel            -> 200
//  GET  /settings/model-providers       -> list (redacted)
//  POST /settings/model-providers       -> register
// Faults via POST /__fault {mode:'429'|'503'|'401'|'timeout'|'stall'} on next turn.
// Scripted replies via POST /__script {events:[...]} for the next turn stream.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.FAKE_TF_PORT ?? 8791);
const state = {
  fault: null, // '429'|'503'|'401'|'timeout'|'stall'
  scriptedEvents: null, // array of event objects to stream on next turn
  modelProviders: [],
  mcpServers: new Map(), // name -> manifest
  sessions: new Map(),
  turnCounter: 0,
};

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
    });
  });
}

function ev(type, extra = {}) {
  return { type, id: randomUUID(), created_at: new Date().toISOString(), ...extra };
}

function streamTurn(res, sessionId, input, mode) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const turnId = `turn_${++state.turnCounter}`;
  const userMsg = input.find((i) => i.type === 'user.message');

  send(ev('turn.created', { turn_id: turnId, previous_turn_id: null, input, state: { status: 'running' }, thread_id: null }));

  if (state.scriptedEvents) {
    for (const e of state.scriptedEvents) send(e);
    state.scriptedEvents = null;
    send(ev('turn.done', { turn_id: turnId, state: { status: 'done', output: { content: 'scripted', type: 'model.message' }, required_actions: [] }, thread_id: null }));
    res.end();
    return;
  }

  if (state.fault) {
    const fault = state.fault;
    state.fault = null;
    if (fault === 'stall') { req.on('close', () => res.end()); return; } // never completes
    if (fault === 'timeout') { setTimeout(() => { send(ev('turn.done', { turn_id: turnId, state: { status: 'error', message: '[Model Error] Request timed out' }, thread_id: null })); res.end(); }, 5000); return; }
    const messages = {
      '429': '[Model Error] Provider returned 429: Rate limit exceeded',
      '503': '[Model Error] Provider returned 503: Service unavailable',
      '401': '[Model Error] Provider returned 401: Invalid API key',
    };
    if (messages[fault]) {
      send(ev('turn.done', { turn_id: turnId, state: { status: 'error', message: messages[fault] }, thread_id: null }));
      res.end();
      return;
    }
  }

  const reply = userMsg?.content ? `Fake reply to: ${userMsg.content}` : 'Fake reply.';
  send(ev('model.message', { thread_id: 'main', model: { name: 'fake/test' } }));
  send(ev('model.message.delta', { thread_id: 'main', content: reply }));
  send(ev('model.message.delta', { thread_id: 'main', finish_reason: 'stop', usage: { input_tokens: 10, output_tokens: 5 } }));
  send(ev('turn.done', { turn_id: turnId, state: { status: 'done', output: { content: reply, type: 'model.message', finish_reason: 'stop' }, required_actions: [], metrics: { total_input_tokens: 10, total_output_tokens: 5 } }, thread_id: null }));
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const p = url.pathname;

  // Host guard, mirroring the security rule
  const host = String(req.headers.host ?? '');
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) { json(res, 403, { error: { message: 'bad host' } }); return; }

  if (req.method === 'POST' && p === '/__fault') {
    const body = await readBody(req);
    const valid = ['429', '503', '401', 'timeout', 'stall'];
    if (body.mode && !valid.includes(body.mode)) { json(res, 400, { error: { message: `Invalid fault mode: ${body.mode}` } }); return; }
    state.fault = body.mode ?? null;
    json(res, 200, { ok: true, fault: state.fault });
    return;
  }
  if (req.method === 'POST' && p === '/__script') {
    const body = await readBody(req);
    state.scriptedEvents = body.events ?? null;
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && p === '/__reset') {
    state.fault = null; state.scriptedEvents = null; state.sessions.clear(); state.mcpServers.clear();
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/api/v1/settings/mcp-servers' && req.method === 'GET') {
    json(res, 200, { data: [...state.mcpServers.keys()].map((name) => ({ name })) });
    return;
  }
  if (p === '/api/v1/settings/mcp-servers' && (req.method === 'POST' || req.method === 'PUT')) {
    const body = await readBody(req);
    const m = body.manifest;
    if (!m || m.type !== 'remote' || typeof m.name !== 'string' || typeof m.url !== 'string') {
      json(res, 400, { error: { message: 'manifest must be remote {name,url}' } });
      return;
    }
    if (req.method === 'POST' && state.mcpServers.has(m.name)) {
      json(res, 409, { error: { message: `MCP server already registered: ${m.name}` } });
      return;
    }
    if (req.method === 'PUT' && !state.mcpServers.has(m.name)) {
      json(res, 404, { error: { message: `MCP server not registered: ${m.name}` } });
      return;
    }
    state.mcpServers.set(m.name, m);
    json(res, 201, { data: { name: m.name, manifest: m } });
    return;
  }
  if (p === '/api/v1/users') { json(res, 200, { data: { id: 'fake-user' } }); return; }
  if (p === '/api/v1/settings/model-providers' && req.method === 'POST') {
    const body = await readBody(req);
    const m = body.manifest;
    state.modelProviders.push({ name: m.name, base_url: m.base_url });
    json(res, 201, { data: { name: m.name, manifest: { ...m, auth: { api_key: '***REDACTED***' } } } });
    return;
  }
  if (p === '/api/v1/settings/model-providers' && req.method === 'GET') {
    json(res, 200, { data: state.modelProviders.map((mp) => ({ name: mp.name })) });
    return;
  }
  if (p === '/api/v1/sessions' && req.method === 'POST') {
    const body = await readBody(req);
    const id = `sess_${randomUUID().slice(0, 8)}`;
    state.sessions.set(id, { agent: body.agent ?? { spec: { model: { name: 'fake/test' } } }, turns: [] });
    json(res, 201, { data: { id, agent: { type: 'inline', spec: state.sessions.get(id).agent.spec } } });
    return;
  }
  let m = p.match(/^\/api\/v1\/sessions\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const sess = state.sessions.get(m[1]);
    if (!sess) { json(res, 404, { error: { message: 'Session not found' } }); return; }
    json(res, 200, { data: { id: m[1], agent: { type: 'inline', spec: sess.agent.spec } } });
    return;
  }
  if (m && req.method === 'PATCH') {
    const sess = state.sessions.get(m[1]);
    if (!sess) { json(res, 404, { error: { message: 'Session not found' } }); return; }
    const body = await readBody(req);
    if (body.agent?.spec?.model) sess.agent.spec.model = body.agent.spec.model;
    json(res, 200, { data: { id: m[1], agent: { type: 'inline', spec: sess.agent.spec } } });
    return;
  }
  m = p.match(/^\/api\/v1\/sessions\/([^/]+)\/turns$/);
  if (m && req.method === 'POST') {
    const sess = state.sessions.get(m[1]);
    if (!sess) { json(res, 404, { error: { message: 'Session not found' } }); return; }
    const body = await readBody(req);
    if (body.stream === false) { json(res, 200, { data: { id: `turn_${++state.turnCounter}`, state: { status: 'running' } } }); return; }
    streamTurn(res, m[1], body.input ?? [], state.fault);
    return;
  }
  m = p.match(/^\/api\/v1\/sessions\/([^/]+)\/cancel$/);
  if (m && req.method === 'POST') { json(res, 200, { data: { cancelled: true } }); return; }

  json(res, 404, { error: { message: `Route not found: ${req.method} ${p}` } });
});

server.listen(port, '127.0.0.1', () => console.log(`fake-trueforge on http://127.0.0.1:${port}`));
