#!/usr/bin/env node
// Spike 3 (approval): agent calls the echo tool from the spike MCP server with
// require_approval_for_tools: ['@all']. Capture tool.approval_required, then send
// an allow decision as a new turn on the same session. Prints raw SSE.
const BASE = process.env.TF_BASE_URL ?? 'http://localhost:8790';

function ssePrint(readerLabel, res) {
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
          try {
            const ev = JSON.parse(dataLine.slice(5).trim());
            events.push(ev);
            console.log(`[${readerLabel}] event:`, JSON.stringify(ev).slice(0, 500));
          } catch { console.log(`[${readerLabel}] raw:`, raw.slice(0, 300)); }
        }
      }
    }
  }
  return { events, pump };
}

async function main() {
  // 1. create session with the echo MCP server, approval for all its tools
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
  console.log('session:', sessionId, createRes.status);
  if (!sessionId) throw new Error(JSON.stringify(created));

  // 2. turn asking the agent to call echo
  const turnRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'user.message', content: 'Call the echo tool with text "hello-approval" and tell me the result.' }],
      stream: true,
    }),
  });
  console.log('turn1 status:', turnRes.status);
  const s1 = ssePrint('turn1', turnRes);
  await s1.pump();

  const approvalEvent = s1.events.find((e) => e.type === 'tool.approval_required');
  console.log('\n=== approval event:', JSON.stringify(approvalEvent, null, 2));
  if (!approvalEvent) {
    console.log('NO approval event. Full turn1 events:');
    console.log(JSON.stringify(s1.events.map((e) => ({ type: e.type, tool_calls: e.tool_calls })), null, 1));
    return;
  }

  const call = approvalEvent.tool_calls[0];
  console.log('\n=== tool call ref:', JSON.stringify(call));

  // 3. send the allow decision as a NEW turn on the same session
  const decisionRes = await fetch(`${BASE}/api/v1/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input: [{ type: 'user.tool_approval', thread_id: approvalEvent.thread_id, tool_call_id: call.id, approval: { status: 'allow' } }],
      stream: true,
    }),
  });
  console.log('\ndecision turn status:', decisionRes.status);
  const s2 = ssePrint('turn2', decisionRes);
  await s2.pump();

  console.log('\n=== turn2 event types:', s2.events.map((e) => e.type).join(', '));
}

main().catch((e) => { console.error('SPIKE FAILED:', e); process.exit(1); });
