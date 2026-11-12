#!/usr/bin/env node
// Spike 2+3: minimal MCP server (official SDK, Streamable HTTP) exposing an echo
// tool; registered with TrueForge. Spike 3 requires approval for the tool and
// exercises the allow/deny decision flow.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer } from 'node:http';

const port = Number(process.env.SPIKE_MCP_PORT ?? 45899);

function buildMcpServer() {
  const server = new McpServer({ name: 'spike-echo', version: '0.1.0' });
  server.registerTool(
    'echo',
    {
      description: 'Echoes the given text back to the agent.',
      inputSchema: { text: z.string().describe('Text to echo') },
    },
    async ({ text }) => {
      console.log(`[echo tool called] text=${JSON.stringify(text)}`);
      return { content: [{ type: 'text', text: `echo:${text}` }] };
    },
  );
  return server;
}

const httpServer = createServer(async (req, res) => {
  // Reject non-loopback hosts
  const host = String(req.headers.host ?? '');
  if (!/^127\.0\.0\.1(:\d+)?$/.test(host) && !/^localhost(:\d+)?$/.test(host)) {
    res.writeHead(403); res.end('bad host'); return;
  }
  if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
  try {
    const mcpServer = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    res.on('close', () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error('[spike mcp] error', e);
    if (!res.headersSent) { res.writeHead(500); res.end('mcp error'); }
  }
});

httpServer.listen(port, '127.0.0.1', () => console.log(`spike mcp on http://127.0.0.1:${port}/mcp`));
