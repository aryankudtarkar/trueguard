#!/usr/bin/env node
// Minimal OpenAI-compatible chat completions endpoint for spikes and tests.
// Returns a scripted, deterministic assistant response (no real model).
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_LLM_PORT ?? 8799);
let mode = 'echo'; // echo | call-tool | fail429 | fail401 | fail500 | stall
// Tool the scripted model calls in 'call-tool' mode (overridable per run).
let callTool = { name: 'echo', args: '{"text":"hello-approval"}' };

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/set-mode') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      mode = parsed.mode ?? 'echo';
      if (parsed.tool) { callTool = { name: parsed.tool, args: parsed.args ?? '{}' }; }
      res.writeHead(200); res.end('"ok"');
    });
    return;
  }
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    if (mode === 'fail429') {
      res.writeHead(429, { 'retry-after': '1', 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } }));
      return;
    }
    if (mode === 'fail401') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }));
      return;
    }
    if (mode === 'fail500') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal error', type: 'server_error' } }));
      return;
    }
    if (mode === 'stall') {
      req.on('close', () => {});
      return; // never respond
    }
    // echo mode: stream a small SSE completion
    // Body is not consumed yet; for call-tool mode we need to know whether the
    // conversation already has a tool result, to avoid an infinite tool loop.
    const rawBody = await new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
    const body = JSON.parse(rawBody || '{}');
    if (process.env.FAKE_LLM_DEBUG) {
      console.log('TOOLS:', (body.tools ?? []).map((t) => t.function?.name).join(',') || '(none)');
      console.log('MSG:', JSON.stringify(body.messages ?? []).slice(0, 400));
    }
    const hasToolResult = Array.isArray(body.messages) && body.messages.some((m) => m.role === 'tool');
    // A model whose name asks for a fault fails that way, so a failover can
    // be demonstrated with two models on one provider.
    const modelName = String(body.model ?? '');
    const modelFault = /fail(429|503|401|500)/.exec(modelName)?.[1];
    if (modelFault) {
      const status = Number(modelFault);
      res.writeHead(status, { 'content-type': 'application/json', ...(status === 429 ? { 'retry-after': '1' } : {}) });
      res.end(JSON.stringify({ error: { message: `injected ${status} for ${modelName}`, type: 'injected_fault' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (mode === 'call-tool' && !hasToolResult) {
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { role: 'assistant', content: 'I will call the tool now.' } }] });
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_fake_1', type: 'function', function: { name: callTool.name, arguments: callTool.args } }] } }] });
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (hasToolResult) {
      const lastTool = body.messages.filter((m) => m.role === 'tool').pop();
      const text = String(lastTool?.content ?? 'tool result unavailable');
      chunk({ id: 'fake-3', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { role: 'assistant', content: `The tool returned: ${text}` } }] });
      chunk({ id: 'fake-3', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    chunk({ id: 'fake-1', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello from the fake model. ' } }] });    chunk({ id: 'fake-1', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { content: 'The agent loop works.' } }] });
    chunk({ id: 'fake-1', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`fake-openai on http://127.0.0.1:${port}`));
