import * as vscode from 'vscode';
import type { HostToWebviewMessage, Message } from '../../webview/protocol';
import { webviewToHostMessageSchema, type WebviewToHostParsed } from './chatProtocolSchemas';
import { type ServerManager, ServerState } from '../trueforge/serverManager';
import { type SessionManager } from '../trueforge/sessionManager';
import { logger } from '../util/logger';
import { ToolCallBuffer, type StreamingEvent } from '../trueforge/schemas';

/**
 * Host side of the chat webview: CSP-hardened HTML, typed message protocol,
 * streaming render state, context chip for the active file. Messages from the
 * webview are untrusted input: zod-validated, invalid ones dropped.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'forgeguard.chatView';

  private view: vscode.WebviewView | undefined;
  private messages: Message[] = [];
  private streamingMessageId: string | undefined;
  private streamBuffer = '';
  private flushTimer: NodeJS.Timeout | undefined;
  private chip: { path: string; selection?: { startLine: number; endLine: number } } | null = null;
  private lastServerState = ServerState.Stopped;
  private working = false;
  private lastToolRowId: string | undefined;
  /** Merges streamed tool-call fragments (name and arguments arrive apart). */
  private readonly toolCalls = new ToolCallBuffer();
  /** Tool call ids already shown as a chat row (never show one twice). */
  private readonly seenToolCalls = new Set<string>();
  /** tool_call_id -> chat message id of the pending tool row. */
  private readonly pendingToolRows = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly webviewRoot: string, // out/webview — built webview assets
    server: ServerManager,
    private readonly sessions: SessionManager,
  ) {
    this.subscriptions.push(
      server.onStateChange((state) => {
        this.lastServerState = state;
        this.postState();
        if (state === ServerState.Failed) { this.addSystemMessage('ForgeGuard can not reach TrueForge. Start it, or check the address in Settings.'); }
      }),
      sessions.onTurnEnded(() => this.setWorking(false)),
      // Track active file/selection for the context chip
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.chip = editor ? this.chipFor(editor) : null;
        this.post({ type: 'chip', chip: this.chip });
      }),
    );
  }

  dispose(): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = undefined; }
    for (const d of this.subscriptions) { d.dispose(); }
  }

  private chipFor(editor: vscode.TextEditor): { path: string; selection?: { startLine: number; endLine: number } } | null {
    const wsFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!wsFolder) { return null; }
    const rel = editor.document.uri.fsPath.startsWith(wsFolder.uri.fsPath)
      ? editor.document.uri.fsPath.slice(wsFolder.uri.fsPath.length + 1)
      : editor.document.uri.fsPath;
    const sel = editor.selection;
    const hasSelection = !sel.isEmpty;
    return {
      path: rel,
      ...(hasSelection ? { selection: { startLine: sel.start.line + 1, endLine: sel.end.line + 1 } } : {}),
    };
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file(this.webviewRoot)] };
    const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    view.webview.html = this.html(nonce);
    view.webview.onDidReceiveMessage((m: unknown) => {
      const parsed = webviewToHostMessageSchema.safeParse(m);
      if (!parsed.success) {
        // Untrusted input: drop, log at debug, never act
        logger().debug(`dropped invalid webview message: ${parsed.error.message.slice(0, 200)}`);
        return;
      }
      void this.onMessage(parsed.data);
    });
  }

  private html(nonce: string): string {
    const script = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.file(this.webviewRoot), 'main.js'));
    const css = this.view!.webview.asWebviewUri(vscode.Uri.joinPath(vscode.Uri.file(this.webviewRoot), 'styles.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${this.view!.webview.cspSource}; img-src ${this.view!.webview.cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css}">
  <title>ForgeGuard</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private async onMessage(m: WebviewToHostParsed): Promise<void> {
    switch (m.type) {
      case 'ready': {
        this.postState();
        this.post({ type: 'messages', messages: this.messages });
        this.post({ type: 'chip', chip: this.chip ?? this.chipForCurrent() });
        break;
      }
      case 'send': {
        await this.sendUserTurn(m.text, m.chips);
        break;
      }
      case 'stop': {
        await this.sessions.stopTurn();
        break;
      }
      case 'newChat': {
        this.sessions.newChat();
        this.messages = [];
        this.post({ type: 'messages', messages: [] });
        this.addSystemMessage('New chat. Nothing is written without your review.');
        break;
      }
      case 'updateChip': {
        this.chip = m.chip;
        break;
      }
      case 'switchModel': {
        await this.showSwitchModelQuickPick();
        break;
      }
      case 'copyText': {
        void vscode.env.clipboard.writeText(m.text);
        break;
      }
      case 'toggleTool': {
        this.updateMessage(m.messageId, (msg) => ({ ...msg, expanded: !msg.expanded }));
        break;
      }
    }
  }

  private chipForCurrent(): { path: string; selection?: { startLine: number; endLine: number } } | null {
    const editor = vscode.window.activeTextEditor;
    return editor ? this.chipFor(editor) : null;
  }

  private async showSwitchModelQuickPick(): Promise<void> {
    const models = vscode.workspace.getConfiguration('forgeguard').get<Array<{ id: string; label: string; ref: string }>>('models', []);
    if (!models.length) {
      void vscode.window.showInformationMessage('No models configured. Add one in Settings under ForgeGuard: Models.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      models.map((m) => ({ label: m.label, description: m.ref, id: m.id })),
      { placeHolder: 'Switch the model for new turns' },
    );
    if (!pick) { return; }
    const idx = models.findIndex((m) => m.id === pick.id);
    await vscode.workspace.getConfiguration('forgeguard').update('activeModelIndex', idx, vscode.ConfigurationTarget.Global);
    this.addSystemMessage(`Switched to ${pick.label}. New turns use ${pick.description}.`);
  }

  private async sendUserTurn(text: string, chips: readonly { path: string; selection?: { startLine: number; endLine: number } }[]): Promise<void> {
    if (!text.trim() || this.working) { return; }
    const contextLines = chips.map((c) => (c.selection ? `${c.path} (lines ${c.selection.startLine}-${c.selection.endLine})` : c.path));
    const full = contextLines.length ? `${text}\n\nContext: ${contextLines.join(', ')}` : text;
    this.messages.push({ id: `u${Date.now()}`, role: 'user', text });
    const agentId = `a${Date.now()}`;
    this.messages.push({ id: agentId, role: 'agent', text: '', streaming: true });
    this.streamingMessageId = agentId;
    this.streamBuffer = '';
    this.toolCalls.drain();
    this.seenToolCalls.clear();
    this.post({ type: 'messages', messages: this.messages });
    this.setWorking(true);

    const input = [{ type: 'user.message', content: full }];
    try {
      await this.sessions.sendTurn(input, (event) => this.onStreamEvent(agentId, event), this.primaryModel());
    } catch (e) {
      this.setWorking(false);
      this.messages = this.messages.filter((msg) => msg.id !== agentId || msg.text !== '');
      this.addSystemMessage(this.friendlyError(e));
    }
  }

  private primaryModel(): string {
    const cfg = vscode.workspace.getConfiguration('forgeguard');
    const models = cfg.get<Array<{ id: string; label: string; ref: string }>>('models', []);
    const idx = cfg.get<number>('activeModelIndex', 0);
    return models[idx]?.ref ?? models[0]?.ref ?? 'openai/gpt-4o-mini';
  }

  private onStreamEvent(agentId: string, event: StreamingEvent): void {
    switch (event.type) {
      case 'model.message.delta': {
        if (event.content) { this.streamBuffer += event.content; }
        // Tool calls are streamed as deltas: merge the fragments.
        this.toolCalls.add(event.tool_calls);
        if (event.finish_reason === 'tool_calls') { this.flushToolRows(); }
        this.scheduleFlush(agentId);
        break;
      }
      case 'model.message': {
        const content = event.content;
        if (typeof content === 'string' && !this.streamBuffer) {
          this.streamBuffer = content;
          this.scheduleFlush(agentId);
        }
        // Some servers deliver the whole call in the final message instead.
        this.toolCalls.add(event.tool_calls);
        this.flushToolRows();
        break;
      }
      case 'tool.response': {
        this.attachToolResult(event.tool_call_id, event.content);
        break;
      }
      case 'turn.done': {
        this.finishStreaming(agentId, event.state.status === 'error' ? `Turn failed: ${event.state.message ?? 'unknown error'}` : undefined);
        break;
      }
      default:
        break;
    }
  }

  /** Turn the merged tool-call fragments into chat rows (once per call). */
  private flushToolRows(): void {
    const calls = this.toolCalls.drain();
    for (const call of calls) {
      if (call.id && this.seenToolCalls.has(call.id)) { continue; }
      if (call.id) { this.seenToolCalls.add(call.id); }
      this.addToolRow(call.id, call.name, call.arguments);
    }
  }

  /**
   * Add a collapsed tool-activity row. Rows are keyed by tool call id when the
   * server provides one, so a result always lands on the row it belongs to
   * even when several calls run in parallel.
   */
  private addToolRow(toolCallId: string | undefined, name: string, args: string | undefined): void {    const id = `t${Date.now()}-${this.messages.length}`;
    this.messages.push({
      id,
      role: 'tool',
      text: toolLabel(name, args),
      toolCallId,
      toolArgs: args ? truncateText(args, 4000) : undefined,
      toolResult: undefined,
      expanded: false,
    });
    if (toolCallId) { this.pendingToolRows.set(toolCallId, id); }
    this.lastToolRowId = id;
    this.post({ type: 'messages', messages: this.messages });
  }

  private attachToolResult(toolCallId: string | undefined, content: unknown): void {
    const rowId = (toolCallId ? this.pendingToolRows.get(toolCallId) : undefined) ?? this.lastToolRowId;
    if (!rowId) { return; }
    if (toolCallId) { this.pendingToolRows.delete(toolCallId); }
    if (this.lastToolRowId === rowId) { this.lastToolRowId = undefined; }
    const text = typeof content === 'string' ? content : JSON.stringify(content ?? null);
    this.updateMessage(rowId, (m) => ({ ...m, toolResult: truncateText(text, 8000) }));
  }

  private scheduleFlush(agentId: string): void {
    if (this.flushTimer) { return; }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.streamingMessageId === agentId) {
        this.updateMessage(agentId, (m) => ({ ...m, text: this.streamBuffer }));
      }
    }, 16); // batch per animation frame
  }

  private finishStreaming(agentId: string, errorText?: string): void {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = undefined; }
    if (errorText && !this.streamBuffer) {
      this.updateMessage(agentId, (m) => ({ ...m, text: errorText, streaming: false }));
    } else {
      this.updateMessage(agentId, (m) => ({ ...m, text: this.streamBuffer || m.text, streaming: false }));
    }
    this.streamingMessageId = undefined;
    this.streamBuffer = '';
    this.setWorking(false);
  }

  private updateMessage(id: string, fn: (m: Message) => Message): void {
    this.messages = this.messages.map((m) => (m.id === id ? fn(m) : m));
    this.post({ type: 'messages', messages: this.messages });
  }

  private addSystemMessage(text: string): void {
    this.messages.push({ id: `s${Date.now()}`, role: 'system', text });
    this.post({ type: 'messages', messages: this.messages });
  }

  private friendlyError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not running')) { return 'ForgeGuard can not reach TrueForge. Start it, or check the address in Settings.'; }
    if (msg.includes('already running')) { return 'A turn is already running. Stop it first, or wait for it to finish.'; }
    return `Something went wrong: ${msg}`;
  }

  private setWorking(working: boolean): void {
    if (this.working === working) { return; }
    this.working = working;
    this.postState();
  }

  private postState(): void {
    this.post({
      type: 'state',
      serverState: this.lastServerState,
      working: this.working,
      pendingReviews: 0,
    });
  }

  private post(m: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(m);
  }
}

/** Bound tool-row detail size (never the raw cap — see truncate.ts for FR-9). */
function truncateText(text: string, max: number): string {
  if (text.length <= max) { return text; }
  return `${text.slice(0, max)}… [${text.length - max} more chars]`;
}

/**
 * Human label for a tool row: `read_file src/app.ts` (PRD 6.4 — one collapsed
 * line per tool activity). Falls back to the tool name alone.
 */
export function toolLabel(name: string, argsJson: string | undefined): string {
  if (!argsJson) { return name; }
  try {
    const parsed: unknown = JSON.parse(argsJson);
    if (!parsed || typeof parsed !== 'object') { return name; }
    const rec = parsed as Record<string, unknown>;
    for (const key of ['path', 'pattern', 'command', 'glob']) {
      const value = rec[key];
      if (typeof value === 'string' && value) { return `${name} ${value}`; }
    }
    return name;
  } catch {
    return name;
  }
}
