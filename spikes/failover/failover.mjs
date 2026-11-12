#!/usr/bin/env node
// Spike 4 (failover): verify a session's model can be overridden mid-session via
// PATCH /api/v1/sessions/{id} with { agent: { spec: AgentSpec } }, and capture the
// provider error shapes (401 / 429 / 500 / timeout) for the ErrorClassifier.
const BASE = process.env.TF_BASE_URL ?? 'http://localhost:8790';

async function j(res) { return res.json(); }

async function main() {
  // 0. capture provider error shapes: point a provider at a bad endpoint
  const badProvider = await j(await fetch(`${BASE}/api/v1/settings/model-providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      manifest: {
        type: 'custom',
        name: 'bad-provider',
        base_url: 'http://127.0.0.1:9', // port 9: connection refused
        auth: { api_key: 'sk-bad' },
        models: [{ model_id: 'bad-model', name: 'bad-model', properties: { context_length: 1000, max_output_tokens: 10 } }],
      },
    }),
  }));
  console.log('bad-provider register:', badProvider?.data?.name ?? JSON.stringify(badProvider));

  // 1. session on the bad model
  const created = await j(await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: { spec: { model: { name: 'bad-provider/bad-model' } } } }),
  }));
  const sessionId = created?.data?.id;
  console.log('session:', sessionId);

  // 2. turn against the unreachable provider — capture the failure shape
  const turnRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: [{ type: 'user.message', content: 'hi' }], stream: true }),
  });
  console.log('turn status:', turnRes.status, turnRes.headers.get('content-type'));
  if (turnRes.status !== 200) {
    console.log('HTTP error body:', JSON.stringify(await j(turnRes)));
  } else {
    const text = await turnRes.text();
    console.log('SSE stream:', text.slice(0, 1200));
  }

  // 3. PATCH the session to switch to the working fake model
  const patchRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: { spec: { model: { name: 'fake-provider/test-model' } } } }),
  });
  console.log('patch status:', patchRes.status);
  const patched = await j(patchRes);
  console.log('patched model:', patched?.data?.agent?.spec?.model?.name ?? JSON.stringify(patched));

  // 4. new turn on the same session — should succeed on the fallback model
  const turn2 = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: [{ type: 'user.message', content: 'hi again' }], stream: true }),
  });
  console.log('turn2 status:', turn2.status, turn2.headers.get('content-type'));
  const text2 = await turn2.text();
  const doneIdx = text2.lastIndexOf('turn.done');
  console.log('turn2 stream tail:', text2.slice(Math.max(0, doneIdx - 200), doneIdx + 600));
}

main().catch((e) => { console.error('SPIKE FAILED:', e); process.exit(1); });
