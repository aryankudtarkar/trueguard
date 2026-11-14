import * as vscode from 'vscode';
import type { ContextChip, HostToWebviewMessage, MentionSymbol, Message } from '../../webview/protocol';
import { webviewToHostMessageSchema, type WebviewToHostParsed } from './chatProtocolSchemas';
import { type ServerManager, ServerState } from '../trueforge/serverManager';
import { type SessionManager } from '../trueforge/sessionManager';
import { type EditService, type ReviewUpdate } from '../review/editService';
import { MODES, modeById } from '../providers/presets';
import { logger, redact } from '../util/logger';
import { findFilesForMention } from '../context/mentions';
import { describeContext, formatContext, retrieveContext } from '../context/retriever';
import type { ContextProvider } from '../context/workspaceContext';
import { listFiles as listWorkspaceFiles } from '../mcp/vscodeTools';
import { readWorkspaceFile } from '../context/workspaceContext';
import { ToolCallBuffer, type StreamingEvent } from '../trueforge/schemas';

/**
 * Host side of the chat webview: CSP-hardened HTML, typed message protocol,
 * streaming render state, context chip for the active file. Messages from the
 * webview are untrusted input: zod-validated, invalid ones dropped.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = 'trueguard.chatView';
  /** The chat keeps a bounded history: the webview receives the whole list on
   * every update, so an unbounded one would get slower with every message. */
  private static readonly MAX_MESSAGES = 200;

  private view: vscode.WebviewView | undefined;
  private messages: Message[] = [];
  private streamingMessageId: string | undefined;
  private streamBuffer = '';
  private flushTimer: NodeJS.Timeout | undefined;
  private chip: ContextChip | null = null;
  private lastServerState = ServerState.Stopped;
  private working = false;
  private pendingReviews = 0;
  private lastToolRowId: string | undefined;
  /** Merges streamed tool-call fragments (name and arguments arrive apart). */
  private readonly toolCalls = new ToolCallBuffer();
  /** Tool call ids already shown as a chat row (never show one twice). */
  private readonly seenToolCalls = new Set<string>();
  /** tool_call_id -> chat message id of the pending tool row. */
  private readonly pendingToolRows = new Map<string, string>();
  /** Change set id -> the chat message id of its change card. */
  private readonly changeCards = new Map<string, string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly webviewRoot: string, // out/webview — built webview assets
    server: ServerManager,
    private readonly sessions: SessionManager,
    private readonly reviews?: EditService,
    private readonly contextProvider?: ContextProvider,
  ) {
    this.subscriptions.push(
      server.onStateChange((state) => {
        this.lastServerState = state;
        this.postState();
        if (state === ServerState.Failed) { this.addSystemMessage('TrueGuard can not reach TrueForge. Start it, or check the address in Settings.'); }
      }),
      sessions.onTurnEnded(() => this.setWorking(false)),
      // Track active file/selection for the context chip
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.chip = editor ? this.chipFor(editor) : null;
        this.post({ type: 'chip', chip: this.chip });
      }),
    );
    if (reviews) {
      this.subscriptions.push(reviews.onUpdate((update) => this.onReviewUpdate(update)));
    }
    this.subscriptions.push(
      sessions.onFailover((failover) => {
        // One calm notice (FR-7), not a stream of them.
        this.addSystemMessage(failover.notice);
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
      // A handler that throws must not become an unhandled rejection.
      void this.onMessage(parsed.data).catch((e) => {
        logger().warn(`webview message failed: ${redact(String(e))}`);
      });
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
  <title>TrueGuard</title>
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
        // Stopping denies every approval that is still waiting (FR-5).
        await this.reviews?.denyAllPending('The turn was stopped.');
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
      case 'openReview': {
        void vscode.commands.executeCommand('trueguard.reviewNextChange');
        break;
      }
      case 'mentionFiles': {
        const files = await this.listMentionCandidates(m.query);
        const symbols = await this.listMentionSymbols(m.query);
        this.post({ type: 'mentionFilesResult', files, symbols });
        break;
      }
      case 'mention': {
        // The user picked a file or a symbol: it becomes a context chip.
        this.chip = m.symbol ? { path: m.path, symbol: m.symbol } : { path: m.path };
        this.post({ type: 'chip', chip: this.chip });
        break;
      }
      case 'revertChange': {
        await this.reviews?.revertChangeSet(m.changeSetId);
        break;
      }
      case 'approveCommand': {
        await this.reviews?.approveCommand(m.toolCallId);
        break;
      }
      case 'denyCommand': {
        await this.reviews?.denyCommand(m.toolCallId);
        break;
      }
    }
  }

  private chipForCurrent(): { path: string; selection?: { startLine: number; endLine: number } } | null {
    const editor = vscode.window.activeTextEditor;
    return editor ? this.chipFor(editor) : null;
  }

  private async showSwitchModelQuickPick(): Promise<void> {
    const configured = this.sessions.configuredModels();
    if (!configured.length) {
      void vscode.window.showInformationMessage(
        'No models found. Start TrueForge and run "TrueGuard: Configure Providers".',
      );
      return;
    }
    const active = this.sessions.mode();
    const items = [
      ...MODES.map((mode) => ({
        label: mode.label,
        description: mode.description,
        detail: mode.defaultModel,
        itemKind: 'mode' as const,
        id: mode.id,
        ref: mode.defaultModel,
      })),
      ...configured.map((m) => ({
        label: m.label,
        description: m.ref,
        detail: `Model of the ${active} chain`,
        itemKind: 'model' as const,
        id: m.id,
        ref: m.ref,
      })),
    ];
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Choose a mode or a model for the next turns',
    });
    if (!pick) { return; }
    if (pick.itemKind === 'mode') {
      await vscode.workspace.getConfiguration('trueguard').update('mode', pick.id, vscode.ConfigurationTarget.Global);
      this.postState();
      this.addSystemMessage(`Switched to ${pick.label} mode. New turns use ${pick.detail}.`);
      return;
    }
    // Switching a model rewrites the ACTIVE MODE's chain: the mode keeps its
    // own failover chain, so the choice has to land there.
    const chain = [...configured];
    const idx = chain.findIndex((m) => m.ref === pick.ref);
    if (idx < 0) { return; }
    chain.splice(idx, 1);
    chain.unshift({ id: pick.id, label: pick.label, ref: pick.ref });
    await vscode.workspace
      .getConfiguration('trueguard')
      .update(`modes.${active}.models`, chain, vscode.ConfigurationTarget.Global);
    this.postState();
    this.addSystemMessage(`Switched to ${pick.label}. New turns use ${pick.ref}.`);
  }

  private async sendUserTurn(text: string, chips: readonly ContextChip[]): Promise<void> {
    if (!text.trim() || this.working) { return; }

    // Context assembly (FR-12): the mentions the user typed, plus the files
    // that match the message — within a visible budget.
    const mentioned = chips.map((c) => c.path);
    const contextBlock = await this.buildContext(text, mentioned, chips);
    const contextLines = chips.map((c) => {
      if (c.symbol) { return `${c.symbol.name} (${c.symbol.kind}) in ${c.path}:${c.symbol.line}`; }
      return c.selection ? `${c.path} (lines ${c.selection.startLine}-${c.selection.endLine})` : c.path;
    });
    const parts = [text];
    if (contextLines.length) { parts.push(`Context: ${contextLines.join(', ')}`); }
    if (contextBlock.text) { parts.push(contextBlock.text); }
    const full = parts.join('\n\n');

    this.pushMessage({ id: `u${Date.now()}`, role: 'user', text });
    const agentId = `a${Date.now()}`;
    this.pushMessage({ id: agentId, role: 'agent', text: '', streaming: true });
    this.streamingMessageId = agentId;
    this.streamBuffer = '';
    this.toolCalls.drain();
    this.seenToolCalls.clear();
    this.post({ type: 'messages', messages: this.messages });
    this.setWorking(true);
    if (contextBlock.summary) { this.addSystemMessage(contextBlock.summary); }

    const input = [{ type: 'user.message', content: full }];
    try {
      await this.sessions.sendTurn(input, (event) => this.onStreamEvent(agentId, event), this.primaryModel());
    } catch (e) {
      this.setWorking(false);
      this.messages = this.messages.filter((msg) => msg.id !== agentId || msg.text !== '');
      this.addSystemMessage(this.friendlyError(e));
      if (this.isAllModelsDown(e)) {
        void vscode.window
          .showErrorMessage('No model is available right now. Retry, or edit your model list.', 'Retry', 'Edit Models')
          .then((choice) => {
            if (choice === 'Retry') { void this.retryLast(); }
            if (choice === 'Edit Models') {
              void vscode.commands.executeCommand('workbench.action.openSettings', 'trueguard.models');
            }
          });
      }
    }
  }

  /** True when every model failed (FR-7). */
  private isAllModelsDown(e: unknown): boolean {
    const msg = e instanceof Error ? e.message : String(e);
    return /no model is available|rate limit|429/i.test(msg);
  }

  /** Send the last user message again. */
  private async retryLast(): Promise<void> {
    const last = [...this.messages].reverse().find((m) => m.role === 'user');
    if (!last) { return; }
    await this.sendUserTurn(last.text, []);
  }

  /**
   * Assemble the context for a message: the files the user mentioned and the
   * files that match it, within the budget. The user sees what was chosen.
   */
  private async buildContext(
    text: string,
    mentioned: readonly string[],
    chips: readonly ContextChip[] = [],
  ): Promise<{ text: string; summary: string }> {
    const provider = this.contextProvider;
    if (!provider) { return { text: '', summary: '' }; }
    try {
      const candidates = await provider.candidates(text);
      const context = retrieveContext(text, candidates, provider.budgetBytes());
      // A mentioned symbol contributes its definition, not the whole file.
      const symbolBlocks = await this.symbolContext(chips);
      const summary = describeContext(context, mentioned);
      const body = [formatContext(context, mentioned), ...symbolBlocks].filter(Boolean).join('\n\n');
      return { text: body, summary };
    } catch (e) {
      logger().warn(`context assembly failed: ${redact(String(e))}`);
      return { text: '', summary: '' };
    }
  }

  /** The definition of every mentioned symbol, as a context block. */
  private async symbolContext(chips: readonly ContextChip[]): Promise<string[]> {
    const blocks: string[] = [];
    for (const chip of chips) {
      if (!chip.symbol) { continue; }
      const content = await readWorkspaceFile(chip.path);
      if (!content) { continue; }
      const lines = content.split('\n');
      const start = Math.max(0, chip.symbol.line - 1);
      const excerpt = lines.slice(start, start + 40).join('\n');
      blocks.push(`--- ${chip.path}:${chip.symbol.line} (${chip.symbol.name}) ---\n${excerpt}`);
    }
    return blocks;
  }

  /** The workspace files the user can mention. */
  async listMentionCandidates(query: string): Promise<string[]> {
    try {
      const files = await listWorkspaceFiles(undefined, 2000);
      return findFilesForMention(files, query, 20);
    } catch (e) {
      logger().warn(`mention lookup failed: ${redact(String(e))}`);
      return [];
    }
  }

  /** The symbols the user can mention with @. */
  async listMentionSymbols(query: string): Promise<MentionSymbol[]> {
    if (!this.contextProvider) { return []; }
    try {
      const symbols = await this.contextProvider.symbols(query);
      return symbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        path: s.path,
        line: s.line,
        signature: s.signature,
      }));
    } catch (e) {
      logger().warn(`symbol lookup failed: ${redact(String(e))}`);
      return [];
    }
  }

  private primaryModel(): string {
    return this.sessions.activeModel();
  }

  /** The label of the mode button: "Fast · GPT-OSS 120B". */
  private modeLabel(): string {
    const mode = modeById(this.sessions.mode());
    const model = this.sessions.activeModel();
    const short = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
    return `${mode?.label ?? 'Fast'} · ${short}`;
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
        // The model that produced this answer is shown on the message.
        const modelName = event.model?.name;
        if (modelName && agentId) {
          this.updateMessage(agentId, (m) => ({ ...m, modelLabel: shortModelName(modelName) }));
        }
        break;
      }
      case 'tool.response': {
        this.attachToolResult(event.tool_call_id, event.content);
        break;
      }
      case 'thread.context_compaction.started': {
        // TrueForge's context engineering, made visible (B4).
        this.addSystemMessage('The conversation is long: TrueGuard asked the harness to compact it.');
        break;
      }
      case 'thread.context_compaction.finished': {
        this.addSystemMessage('Context compacted. The turn continues.');
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

  /** A command card: the verbatim command, its risks and the Allow/Deny pair. */
  private onCommandUpdate(update: ReviewUpdate): void {
    const command = update.command;
    if (!command) { return; }
    const id = `cmd-${command.toolCallId}`;
    const status = update.kind === 'rejected' ? 'Denied' : 'Awaiting approval';
    const existing = this.messages.find((m) => m.id === id);
    if (existing) {
      this.updateMessage(id, (m) => ({
        ...m,
        command: m.command ? { ...m.command, status } : m.command,
      }));
      return;
    }
    this.pushMessage({
      id,
      role: 'command',
      text: command.command,
      command: {
        toolCallId: command.toolCallId,
        command: command.command,
        cwd: command.cwd,
        risky: command.risky,
        status,
      },
    });
    this.post({ type: 'messages', messages: this.messages });
  }

  /** A review changed: show a change card per file, with a status chip
   * (PRD 6.4). The card is the chat's window into the Changes view.
   */
  private onReviewUpdate(update: ReviewUpdate): void {
    if (!this.reviews || !update.changeSetId) { return; }
    if (update.kind === 'command') { this.onCommandUpdate(update); return; }
    const changeSet = this.reviews.changeStore.get(update.changeSetId);
    if (!changeSet) { return; }
    const status = statusLabel(update.kind, changeSet.state);
    const existing = this.changeCards.get(update.changeSetId);

    if (!existing) {
      for (const file of changeSet.files) {
        const id = `c${Date.now()}-${this.messages.length}`;
        this.pushMessage({
          id,
          role: 'change',
          text: file.path,
          change: {
            path: file.path,
            added: file.hunks.reduce((sum, h) => sum + h.newLines.length, 0),
            removed: file.hunks.reduce((sum, h) => sum + h.oldLines, 0),
            status,
            note: update.summary,
            changeSetId: update.changeSetId,
            revertible: status === 'Verified',
          },
        });
        this.changeCards.set(update.changeSetId, id);
      }
      this.post({ type: 'messages', messages: this.messages });
      return;
    }

    // Update the existing card (status chip + receipt).
    this.updateMessage(existing, (m) => ({
      ...m,
      change: m.change
        ? {
            ...m.change,
            status,
            note: update.summary,
            revertible: status === 'Verified' || status === 'Reverted',
          }
        : m.change,
    }));
  }

  /** Add a collapsed tool-activity row. Rows are keyed by tool call id when the
   * server provides one, so a result always lands on the row it belongs to
   * even when several calls run in parallel.
   */
  private addToolRow(toolCallId: string | undefined, name: string, args: string | undefined): void {    const id = `t${Date.now()}-${this.messages.length}`;
    this.pushMessage({
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

  /** Append a message and keep the history bounded. */
  private pushMessage(message: Message): void {
    this.messages.push(message);
    const overflow = this.messages.length - ChatViewProvider.MAX_MESSAGES;
    if (overflow > 0) { this.messages.splice(0, overflow); }
  }

  private addSystemMessage(text: string): void {
    this.pushMessage({ id: `s${Date.now()}`, role: 'system', text });
    this.post({ type: 'messages', messages: this.messages });
  }

  private friendlyError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not running')) { return 'TrueGuard can not reach TrueForge. Start it, or check the address in Settings.'; }
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
      pendingReviews: this.pendingReviews,
      configured: this.hasModels(),
      mode: this.modeLabel(),
    });
  }

  /** The number of changes waiting for review (the composer's pill). */
  setPendingReviews(count: number): void {
    this.pendingReviews = count;
    this.postState();
  }

  /** Is at least one model configured for the active mode? */
  private hasModels(): boolean {
    return this.sessions.configuredModels().length > 0;
  }

  private post(m: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(m);
  }
}

/** The short name of a model ("gpt-4o-mini" of "openai/gpt-4o-mini"). */
export function shortModelName(fqn: string): string {
  const parts = fqn.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : fqn;
}

/** Status chip text for a review (PRD 6.4). */
export function statusLabel(kind: ReviewUpdate['kind'], state: string): string {
  if (kind === 'reverted') { return 'Reverted'; }
  if (kind === 'applied') { return 'Verified'; }
  if (kind === 'rejected') { return 'Rejected'; }
  if (kind === 'conflict') { return 'Conflict'; }
  if (kind === 'failed') { return 'Failed check'; }
  if (state === 'partially_applied') { return 'Partly applied'; }
  if (state === 'applying') { return 'Applying'; }
  return 'Awaiting review';
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
