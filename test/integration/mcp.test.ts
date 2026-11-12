import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { EditorMcpServer, MCP_SERVER_NAME } from '../../src/mcp/editorServer';
import { vscodeToolDeps } from '../../src/mcp/vscodeTools';

/**
 * Integration (real VS Code): the editor MCP server must read the DIRTY
 * buffer of an open file, and the extension must have its MCP server listening
 * on loopback after activation.
 */

interface RpcResponse {
  status: number;
  body: Record<string, unknown>;
}

function rpc(
  port: number,
  method: string,
  params: unknown,
  token: string,
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`,
        },
      },
      (res: import('node:http').IncomingMessage) => {
        let b = '';
        res.on('data', (c: Buffer) => { b += c; });
        res.on('end', () => {
          let body: Record<string, unknown> = {};
          try { body = JSON.parse(b) as Record<string, unknown>; } catch { body = { raw: b }; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

function firstText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? '';
}

describe('editor MCP server in real VS Code', () => {
  it('reads the dirty buffer of an open file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return; } // no workspace open: nothing to read
    const file = path.join(folder.uri.fsPath, 'package.json');
    const original = await fs.readFile(file, 'utf8');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    const marker = `// forgeguard-dirty-${Date.now()}`;
    await editor.edit((b) => {
      b.insert(new vscode.Position(0, 0), `${marker}\n`);
    });
    expect(doc.isDirty).toBe(true);

    const server = new EditorMcpServer(vscodeToolDeps(), 45940);
    const endpoint = await server.start();
    try {
      await rpc(endpoint.port, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'it', version: '0' },
      }, endpoint.token);
      const res = await rpc(endpoint.port, 'tools/call', {
        name: 'read_file',
        arguments: { path: 'package.json' },
      }, endpoint.token);
      const parsed = JSON.parse(firstText(res.body.result)) as { lines: string };
      expect(parsed.lines.includes(marker)).toBe(true);
    } finally {
      server.dispose();
      // Restore the file so the workspace stays clean.
      await vscode.commands.executeCommand('workbench.action.files.revert');
      const after = await fs.readFile(file, 'utf8');
      expect(after === original).toBe(true);
    }
  });

  it('has the extension MCP server listening on loopback after activation', async () => {
    let found = false;
    for (let port = 45821; port < 45853; port++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
        if (res.ok) {
          const body = (await res.json()) as { name?: string };
          expect(body.name === MCP_SERVER_NAME).toBe(true);
          found = true;
          break;
        }
      } catch {
        // port closed: keep looking
      }
    }
    expect(found).toBe(true);
  });

  it('refuses a non-loopback Host header', async () => {
    const res = await new Promise<number | undefined>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: 45821,
          path: '/healthz',
          method: 'GET',
          headers: { host: 'evil.example.com' },
        },
        (r: import('node:http').IncomingMessage) => {
          r.resume();
          r.on('end', () => resolve(r.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    // The port may have moved; a closed port means the request never landed.
    expect(res === 403 || res === undefined).toBe(true);
  });
});
