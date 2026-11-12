#!/usr/bin/env node
// fake-trueforge: a local server emulating the verified subset of the real
// TrueForge API (sessions, SSE stream, approval gate, injectable faults).
// Phase 0 task 0.9 fills in the verified endpoints; this stub provides health.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_TF_PORT ?? 8791);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, fake: true }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fake-trueforge listening on http://127.0.0.1:${port}`);
});
