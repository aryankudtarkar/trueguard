#!/usr/bin/env node
// Spike 3b (deny): same as approval.mjs but sends a deny decision with a reason.
const BASE = process.env.TF_BASE_URL ?? 'http://localhost:8790';

function sseCollect(label, res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  async function pump() {
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
        if (dataLine) {
          try { events.push(JSON.parse(dataLine.slice(5).trim())); }
          catch { /* skip */ }
        }
      }
    }
  }
  return { events, pump, label };
}

async function main() {
  const createRes = await fetch(`${BASE}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: {
        spec: {
          model: { name: 'fake-provider/test-model' },
          instructions: 'Use tools when asked.',
          mcp_servers: [{ name: 'spike-echo', require_approval_for_tools: ['@all'], preload: true }],
        },
      },
    }),
  });
  const created = await createRes.json();
  const sessionId = created?.data?.id;
  console.log('session:', sessionId);

  const turnRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'user.message', content: 'Call the echo tool with text "deny-me".' }],
      stream: true,
    }),
  });
  const s1 = sseCollect('turn1', turnRes);
  await s1.pump();
  const approval = s1.events.find((e) => e.type === 'tool.approval_required');
  console.log('approval event found:', Boolean(approval), approval ? JSON.stringify(approval.tool_calls) : '');
  if (!approval) { console.log('events:', s1.events.map((e) => e.type)); return; }

  const call = approval.tool_calls[0];
  const decisionRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'user.tool_approval', thread_id: approval.thread_id, tool_call_id: call.id, approval: { status: 'deny', reason: 'The user rejected this action in the review UI.' } }],
      stream: true,
    }),
  });
  console.log('deny turn status:', decisionRes.status);
  const s2 = sseCollect('turn2', decisionRes);
  await s2.pump();
  console.log('turn2 types:', s2.events.map((e) => e.type).join(', '));
  const done = s2.events.find((e) => e.type === 'turn.done');
  console.log('turn.done:', JSON.stringify(done?.state?.output?.content ?? done?.state?.message ?? done?.state?.status));
  const final = s2.events.filter((e) => e.type === 'model.message.delta' && e.content).map((e) => e.content).join('');
  console.log('agent final text:', final);
}

main().catch((e) => { console.error('SPIKE FAILED:', e); process.exit(1); });
