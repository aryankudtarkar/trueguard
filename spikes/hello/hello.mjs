#!/usr/bin/env node
// Spike 1 (hello): create a session, send one turn, print raw SSE events.
// Transcript saved by the caller to docs/spikes/hello-transcript.md
const BASE = process.env.TF_BASE_URL ?? 'http://localhost:8790';

async function main() {
  // 1. create session with an inline agent spec
  const createRes = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: {
        spec: {
          model: { name: 'fake-provider/test-model' },
          instructions: 'You are a helpful assistant.',
        },
      },
    }),
  });
  console.log('CREATE session status:', createRes.status);
  const created = await createRes.json();
  console.log('CREATE session body:', JSON.stringify(created, null, 2));
  const sessionId = created?.data?.id ?? created?.id;
  if (!sessionId) throw new Error('no session id');

  // 2. send a turn with stream=true
  const turnRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'user.message', content: 'Say hello and one sentence about yourself.' }],
      stream: true,
    }),
  });
  console.log('TURN status:', turnRes.status);
  console.log('TURN content-type:', turnRes.headers.get('content-type'));

  // 3. read raw SSE
  const reader = turnRes.body.getReader();
  const decoder = new TextDecoder();
  let saw = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value));
    saw++;
  }
  console.log(`\n[sse chunks: ${saw}]`);

  // 4. turn history
  const turns = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`).then((r) => r.json());
  console.log('TURNS after:', JSON.stringify(turns, null, 2).slice(0, 2000));
}

main().catch((e) => {
  console.error('SPIKE FAILED:', e);
  process.exit(1);
});
