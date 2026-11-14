import * as http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger, redact } from '../util/logger';
import { ToolCallGuard } from '../util/idempotency';
import { PathGuard, type ResolvedPath } from './pathGuard';
import { registerEditorTools, type EditorToolDeps, type ToolRegistrar } from './tools';
import { registerEditTools, type EditToolDeps } from './editTool';
import { registerCommandTools, type CommandRunnerDeps } from './commandTool';
import { vscodeToolDeps } from './vscodeTools';

/**
 * TrueGuard editor MCP server (FR-3): Streamable HTTP on 127.0.0.1, default
 * port 45821 with next-free-port fallback. Auth: bearer token generated at
 * start; non-loopback Host headers are rejected. Stateless: a fresh McpServer
 * + transport per request (SDK 1.32.2 pattern, see DECISIONS).
 */

export const DEFAULT_MCP_PORT = 45821;
export const MCP_SERVER_NAME = 'trueguard-editor';

export interface McpEndpoint {
  port: number;
  token: string;
  url: string;
}

export class EditorMcpServer implements vscode.Disposable {
  private server: http.Server | undefined;
  private endpoint: McpEndpoint | undefined;
  private readonly log = logger();
  private readonly token = randomBytes(24).toString('hex');
  private disposed = false;
  private readonly endpointEmitter = new vscode.EventEmitter<McpEndpoint>();
  readonly onEndpointChange = this.endpointEmitter.event;
  /** Remembers the tool calls of the current turn (no duplicated execution). */
  private readonly guard = new ToolCallGuard();

  constructor(
    private readonly deps: EditorToolDeps = vscodeToolDeps(),
    private readonly startPort: number = DEFAULT_MCP_PORT,
    private readonly maxPortTries = 32,
    private editTools?: EditToolDeps,
    private commandTools?: CommandRunnerDeps & { approval: () => Promise<{ command: string; cwd: string; timeoutSec?: number } | undefined> },
  ) {}

  getEndpoint(): McpEndpoint | undefined {
    return this.endpoint;
  }

  /**
   * Attach the edit tools once the review service exists (the service needs
   * the session manager, which needs this server's endpoint).
   */
  setEditTools(tools: EditToolDeps): void {
    this.editTools = tools;
  }

  /** Attach the command tools (the runner and the approval flow). */
  setCommandTools(
    tools: CommandRunnerDeps & { approval: () => Promise<{ command: string; cwd: string; timeoutSec?: number } | undefined> },
  ): void {
    this.commandTools = tools;
  }

  async start(): Promise<McpEndpoint> {
    if (this.endpoint) { return this.endpoint; }
    if (this.disposed) { throw new Error('EditorMcpServer disposed'); }
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const tryListen = (): void => {
        const port = this.startPort + attempt;
        const srv = http.createServer((req, res) => void this.handle(req, res));
        srv.once('error', (e: NodeJS.ErrnoException) => {
          if (e.code === 'EADDRINUSE' && attempt < this.maxPortTries - 1) {
            attempt++;
            srv.close();
            tryListen();
            return;
          }
          this.log.error(`editor MCP server failed to listen: ${redact(String(e))}`);
          reject(e);
        });
        // Narrow the token check to the loopback interface only
        srv.listen(port, '127.0.0.1', () => {
          this.server = srv;
          this.endpoint = { port, token: this.token, url: `http://127.0.0.1:${port}/mcp` };
          this.log.info(`editor MCP server on ${this.endpoint.url}`);
          this.endpointEmitter.fire(this.endpoint);
          resolve(this.endpoint);
        });
      };
      tryListen();
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Host guard: only loopback hosts, as with the spike server
      const host = String(req.headers.host ?? '');
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad host' }));
        return;
      }
      // Health endpoint is unauthenticated (host-guarded) for our own use
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, name: MCP_SERVER_NAME }));
        return;
      }
      // Bearer token auth (constant-time)
      const auth = String(req.headers.authorization ?? '');
      const expected = `Bearer ${this.token}`;
      const ok = auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
      if (!ok) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (req.method === 'DELETE') {
        res.writeHead(200);
        res.end();
        return;
      }

      const mcpServer = this.buildMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
        enableJsonResponse: true,
      });
      res.on('close', () => void transport.close());
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      this.log.warn(`mcp request error: ${redact(String(e))}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'mcp error' }));
      }
    }
  }

  private buildMcpServer(): McpServer {
    const server = new McpServer({ name: MCP_SERVER_NAME, version: '0.1.0' });
    // Structural cast: the SDK's registerTool generics instantiate too deep to
    // check against our minimal registrar interface.
    const registrar = server as unknown as ToolRegistrar;
    registerEditorTools(guardRegistrar(registrar, this.guard), {
      deps: this.deps,
      // Guard re-resolves the current workspace roots on every call, so folder
      // changes at runtime are honored.
      guard: new GuardProxy(this.deps),
    });
    if (this.editTools) {
      registerEditTools(guardRegistrar(registrar, this.guard), this.editTools);
    }
    if (this.commandTools) {
      registerCommandTools(guardRegistrar(registrar, this.guard), this.commandTools);
    }
    return server;
  }

  /** Forget the tool calls of the previous turn (a new user turn). */
  resetToolGuard(): void {
    this.guard.reset();
  }

  dispose(): void {
    this.disposed = true;
    this.endpointEmitter.dispose();
    this.server?.close();
    this.endpoint = undefined;
  }
}

/**
 * Wrap a registrar so every tool runs at most once per turn: a repeat (the
 * model asked again after a failover) replays the first result.
 */
function guardRegistrar(registrar: ToolRegistrar, guard: ToolCallGuard): ToolRegistrar {
  return {
    registerTool(name, def, handler) {
      registrar.registerTool(name, def, async (args, extra) => {
        const key = ToolCallGuard.key(name, args);
        return guard.run(key, () => handler(args, extra));
      });
    },
  };
}

/**
 * GuardProxy builds a fresh PathGuard from the CURRENT workspace roots on
 * every call (folders can be added/removed at runtime) and re-reads the
 * secret-read setting each time (it can be toggled while running).
 */
class GuardProxy {
  constructor(private readonly deps: EditorToolDeps) {}

  async resolve(input: string, opts?: { mustExist?: boolean }): Promise<ResolvedPath> {
    const roots = await this.deps.workspaceRoots();
    const fresh = new PathGuard({ roots, allowSecrets: this.deps.allowSecretReads() });
    return fresh.resolve(input, opts);
  }
}
