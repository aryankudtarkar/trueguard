#!/usr/bin/env node
// A fake OpenAI-compatible provider for development and demos.
//
// It is not a language model, but it is not a dummy either: it reads the
// files the agent fetched and answers with what is actually in them, so the
// whole loop — context assembly, tool calls, streaming, approval — can be
// tried without an API key.
//
// Modes (POST /set-mode {"mode": ...}):
//   echo      (default) answer from the files the agent read
//   call-tool call one tool, then answer (the tests use this)
//   fail429 / fail503 / fail401 / fail500 / stall   the fault injection
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_LLM_PORT ?? 8799);
let mode = 'echo'; // echo | call-tool | fail429 | fail503 | fail401 | fail500 | stall
// Tool the scripted model calls in 'call-tool' mode (overridable per run).
let callTool = { name: 'echo', args: '{"text":"hello-approval"}' };

/** Words that say nothing about the code. */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on', 'for', 'with', 'as',
  'at', 'by', 'from', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'please',
  'can', 'could', 'should', 'would', 'make', 'change', 'code', 'file', 'files', 'add',
  'remove', 'update', 'fix', 'write', 'implement', 'refactor', 'do', 'not', 'no', 'so',
  'what', 'does', 'how', 'why', 'where', 'when', 'who', 'tell', 'me', 'about',
]);

/** The meaningful words of a question. */
function keywords(text) {
  return [...new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )].slice(0, 8);
}

/** The last user message. */
function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') { return String(messages[i]?.content ?? ''); }
  }
  return '';
}

/** The tool results of this turn, parsed back into something readable. */
function toolResults(messages) {
  const out = [];
  for (const message of messages) {
    if (message?.role !== 'tool') { continue; }
    const text = String(message.content ?? '');
    try {
      const parsed = JSON.parse(text);
      if (parsed?.path && parsed?.lines) {
        out.push({ path: parsed.path, lines: String(parsed.lines) });
      } else if (Array.isArray(parsed?.matches)) {
        // search_text: the matches ARE the answer.
        const lines = parsed.matches
          .map((m) => `${m.path}:${m.line}| ${m.snippet}`)
          .join('\n');
        out.push({ path: 'search results', lines });
      } else if (parsed?.context) {
        out.push({ path: '(context)', lines: String(parsed.context) });
      } else {
        out.push({ path: '(tool)', lines: text });
      }
    } catch {
      out.push({ path: '(tool)', lines: text.slice(0, 400) });
    }
  }
  return out;
}

/**
 * Answer from what the agent actually read: the lines that match the
 * question, with their numbers.
 */
function answerFrom(question, files) {
  const words = keywords(question);
  if (!files.length) {
    return [
      `I looked at your question — "${question.slice(0, 120)}" — but I have not read any file yet.`,
      '',
      'Ask me to look at a file, or select code and use the inline edit.',
    ].join('\n');
  }
  const blocks = [];
  for (const file of files) {
    const lines = file.lines.split('\n');
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const lower = (lines[i] ?? '').toLowerCase();
      if (words.some((w) => lower.includes(w))) { hits.push(`${i + 1}| ${lines[i]}`); }
    }
    if (hits.length) {
      blocks.push(`**${file.path}** — ${hits.length} place${hits.length === 1 ? '' : 's'} matching ${words.map((w) => `\`${w}\``).join(', ')}:\n\n${hits.slice(0, 12).map((h) => '```\n' + h + '\n```').join('\n')}`);
    } else {
      const head = lines.slice(0, 12).join('\n');
      blocks.push(`**${file.path}** — nothing matched ${words.map((w) => `\`${w}\``).join(', ')}. The file starts with:\n\n${head}`);
    }
  }
  const opener = words.length
    ? `I read ${files.length} file${files.length === 1 ? '' : 's'} and searched for ${words.map((w) => `\`${w}\``).join(', ')}.`
    : `I read ${files.length} file${files.length === 1 ? '' : 's'}.`;
  return `${opener}\n\n${blocks.join('\n\n')}`;
}

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
      res.end(JSON.stringify({ error: { message: 'Internal server error', type: 'server_error' } }));
      return;
    }
    if (mode === 'stall') {
      req.on('close', () => {});
      return; // never respond
    }
    const rawBody = await new Promise((resolve) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => resolve(b));
    });
    const body = JSON.parse(rawBody || '{}');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const hasToolResult = messages.some((m) => m.role === 'tool');
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

    // The normal answer: built from what the agent actually read.
    const question = lastUser(messages);
    const toolNames = (body.tools ?? []).map((t) => t.function?.name).filter(Boolean);

    // Like a real agent, it searches the workspace before answering — the
    // tool call goes through TrueForge and our own MCP server.
    if (!hasToolResult && toolNames.includes('search_text') && keywords(question).length) {
      const pattern = keywords(question)[0];
      const args = JSON.stringify({ pattern, maxResults: 20 });
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { role: 'assistant', content: `Let me search the workspace for "${pattern}".` } }] });
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_fake_1', type: 'function', function: { name: 'search_text', arguments: args } }] } }] });
      chunk({ id: 'fake-2', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const answer = answerFrom(question, toolResults(messages));
    const pieces = answer.match(/[\s\S]{1,80}/g) ?? [answer];
    let first = true;
    for (const piece of pieces) {
      chunk({ id: 'fake-1', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: { ...(first ? { role: 'assistant' } : {}), content: piece } }] });
      first = false;
    }
    chunk({ id: 'fake-1', object: 'chat.completion.chunk', created: 0, model: 'fake/test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`fake-openai on http://127.0.0.1:${port}`));
