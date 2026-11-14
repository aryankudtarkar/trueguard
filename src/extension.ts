import * as vscode from 'vscode';
import { resolveCommandCwd } from './exec/cwd';
import { SessionLog } from './util/sessionLog';
import { configureProviders } from './providers/setup';
import { MODES, PROVIDER_PRESETS, defaultModelsFor } from './providers/presets';
import * as path from 'node:path';
import { EditorMcpServer, MCP_SERVER_NAME } from './mcp/editorServer';
import { FaultHook } from './edits/faults';
import { ChangeStore } from './edits/store';
import { CheckpointStore } from './edits/checkpoints';
import { vscodeBridge, vscodeProposalContext } from './edits/vscodeBridge';
import { DecisionStore } from './review/decisionStore';
import { EditService } from './review/editService';
import { ChangesTreeProvider, type ChangeTreeItem } from './review/changesTree';
import { DiffContentProvider, DIFF_SCHEME, proposedUri } from './review/diffProvider';
import { ServerManager, ServerState } from './trueforge/serverManager';
import { SessionManager } from './trueforge/sessionManager';
import { ChatViewProvider } from './ui/chatProvider';
import { StatusBar } from './ui/statusBar';
import { runInlineEdit } from './ui/inlineEdit';
import { workspaceContextProvider } from './context/workspaceContext';
import { logger, redact } from './util/logger';

export interface TrueGuardApi {
  server: ServerManager;
  sessions: SessionManager;
  editor: EditorMcpServer;
  changes: ChangeStore;
  editService: EditService;
}

export function activate(context: vscode.ExtensionContext): TrueGuardApi {
  const log = logger();
  log.info('TrueGuard activating');

  const server = new ServerManager(context);
  const editor = new EditorMcpServer();
  // The redacted per-session event log (FR-8).
  const sessionLog = new SessionLog(path.join(context.globalStorageUri.fsPath, 'sessions'));
  const sessions = new SessionManager(server, context, () => {
    const ep = editor.getEndpoint();
    if (!ep) { return []; }
    return [
      {
        name: MCP_SERVER_NAME,
        enable_tools: ['@all'],
        // The read-only tools never pause the turn; propose_edit and
        // run_command always do.
        require_approval_for_tools: ['propose_edit', 'run_command'],
        // All six tools are loaded up front: the agent must be able to call
        // propose_edit directly. TrueForge's deferred tool loading (which
        // hands the model list_tools/call_tool instead) is documented in
        // docs/DECISIONS.md as deliberately not used on the demo's path.
        preload: true,
      },
    ];
  }, sessionLog);

  // The review pipeline: proposals → hunk-level review → verified writes.
  const changes = new ChangeStore();
  const decisions = new DecisionStore();
  const checkpointStore = new CheckpointStore(path.join(context.globalStorageUri.fsPath, 'checkpoints'));
  void checkpointStore.load();
  const editService = new EditService(
    sessions,
    vscodeBridge(),
    vscodeProposalContext(),
    changes,
    decisions,
    undefined,
    checkpointStore,
  );
  editor.setEditTools({ service: editService });


  const chatProvider = new ChatViewProvider(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview').fsPath,
    server,
    sessions,
    editService,
    workspaceContextProvider(),
  );
  const statusBar = new StatusBar(server, sessions);

  const registerDisposable = <T extends vscode.Disposable>(d: T): T => {
    context.subscriptions.push(d);
    return d;
  };

  // Commands run in a shell inside the workspace, after the user approves the
  // exact command. Their output goes to the Commands output channel.
  const commandsChannel = vscode.window.createOutputChannel('TrueGuard Commands');
  registerDisposable(commandsChannel);
  editor.setCommandTools({
    resolveCwd: async (cwd) =>
      resolveCommandCwd(cwd, (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)),
    defaultTimeoutSec: () =>
      vscode.workspace.getConfiguration('trueguard').get<number>('commandTimeoutSec', 120),
    onOutput: (chunk) => commandsChannel.append(chunk),
    approval: async () => editService.takeCommandApproval(),
  });

  // The Changes view (pending reviews) and the virtual diff documents.
  const diffProvider = new DiffContentProvider(editService);
  registerDisposable(vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider));
  const changesTree = new ChangesTreeProvider(editService, {
    openDiff: (item) => void openDiff(item),
    accept: (item) => void acceptItem(item),
    reject: (item) => void rejectItem(item),
  });
  const changesView = vscode.window.createTreeView('trueguard.changesView', {
    treeDataProvider: changesTree,
    showCollapseAll: true,
  });
  registerDisposable(changesView);
  registerDisposable(changesTree);
  registerDisposable(diffProvider);
  registerDisposable(editService);

  registerDisposable(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewId, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  registerDisposable(chatProvider);
  registerDisposable(server);
  registerDisposable(sessions);
  registerDisposable(statusBar);
  registerDisposable(editor);

  // The editor MCP server listens on loopback from activation; the connector
  // is registered with TrueForge whenever both sides are up, and re-registered
  // when the MCP port changes (FR-3).
  let registeredUrl: string | undefined;
  async function registerConnector(): Promise<void> {
    const ep = editor.getEndpoint();
    if (!ep || server.getState() !== ServerState.Ready) { return; }
    if (registeredUrl === ep.url) { return; }
    try {
      await server.client.upsertMcpServer({
        type: 'remote',
        name: MCP_SERVER_NAME,
        url: ep.url,
        description: 'TrueGuard editor tools: read-only workspace access from the agent.',
        auth: { type: 'header', headers: { authorization: `Bearer ${ep.token}` } },
      });
      registeredUrl = ep.url;
      log.info(`connector registered: ${MCP_SERVER_NAME} at ${ep.url}`);
    } catch (e) {
      log.warn(`connector registration failed: ${redact(String(e))}`);
    }
  }

  registerDisposable(editor.onEndpointChange(() => { void registerConnector(); }));
  registerDisposable(
    server.onStateChange((state) => {
      // A restarted TrueForge forgets its connectors: force a fresh registration.
      if (state !== ServerState.Ready) { registeredUrl = undefined; }
      void registerConnector();
    }),
  );
  void editor
    .start()
    .then(() => registerConnector())
    .catch((e) => log.warn(`editor MCP server failed to start: ${redact(String(e))}`));

  // Commands
  registerDisposable(
    vscode.commands.registerCommand('trueguard.startTrueForge', async () => {
      try {
        await server.start();
        void vscode.window.showInformationMessage('TrueForge is running.');
      } catch {
        void vscode.window.showErrorMessage(
          'TrueGuard can not start TrueForge. Check the TrueGuard output channel for the cause.',
        );
      }
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('trueguard.stopTrueForge', () => server.stop()),
  );
  registerDisposable(
    vscode.commands.registerCommand('trueguard.newChat', () => {
      sessions.newChat();
      void vscode.commands.executeCommand('trueguard.chatView.focus');
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('trueguard.stopTurn', async () => {
      await sessions.stopTurn();
      // Stopping denies every approval that is still waiting (FR-5).
      await editService.denyAllPending('The turn was stopped.');
      refreshPending();
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('trueguard.switchModel', async () => {
      // QuickPick lives in the chat provider; focus the view and let the user click the pill,
      // The same picker the chat pill opens.
      await vscode.commands.executeCommand('trueguard.chat.focus');
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('trueguard.showSessionLog', async () => {
      logger().show();
      const file = await sessionLog.latestFile();
      if (!file) {
        void vscode.window.showInformationMessage('No session log yet. Send a message first.');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await vscode.window.showTextDocument(doc, { preview: false });
    }),
  );

  /**
   * Tell the user when the active mode needs a provider that is not set up
   * yet, instead of letting every turn fail with a provider error.
   */
  async function checkProviderSetup(): Promise<void> {
    const registered = await server.client.listModelProviders().catch(() => [] as string[]);
    if (!registered.length) { return; }
    const model = sessions.activeModel();
    const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
    if (!provider || registered.includes(provider)) { return; }
    const preset = PROVIDER_PRESETS.find((p) => p.id === provider);
    const choice = await vscode.window.showWarningMessage(
      `${preset?.label ?? provider} is not set up in TrueForge, so turns will fail.`,
      'Configure Providers',
    );
    if (choice === 'Configure Providers') {
      await vscode.commands.executeCommand('trueguard.configureProviders');
    }
  }
  void checkProviderSetup();

  // Discover the models TrueForge knows about: a fresh install must work
  // without the user typing a single model name.
  void sessions.refreshModels();

  // The onboarding step: the provider keys go into SecretStorage and the
  // providers are registered in TrueForge (the extension never calls them).
  registerDisposable(
    vscode.commands.registerCommand('trueguard.configureProviders', async () => {
      await configureProviders({ client: server.client, secrets: context.secrets });
      await applyDefaultModeModels();
      await sessions.refreshModels();
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.switchMode', async () => {
      const items = MODES.map((mode) => ({
        label: mode.label,
        description: mode.description,
        detail: mode.defaultModel,
        id: mode.id,
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Choose the mode for the next turns',
      });
      if (!pick) { return; }
      await vscode.workspace.getConfiguration('trueguard').update('mode', pick.id, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`Switched to ${pick.label} mode. New turns use ${pick.detail}.`);
    }),
  );

  /**
   * Fill a mode's model chain with its default — but only for the providers
   * that are actually registered in TrueForge. A chain the user set by hand is
   * never touched.
   */
  async function applyDefaultModeModels(): Promise<void> {
    const registered = await server.client.listModelProviders().catch(() => [] as string[]);
    if (!registered.length) { return; }
    const cfg = vscode.workspace.getConfiguration('trueguard');
    for (const mode of MODES) {
      const key = `modes.${mode.id}.models`;
      const current = cfg.get<Array<{ id: string; label: string; ref: string }>>(key, []);
      if (current.length) { continue; }
      const provider = mode.defaultModel.includes('/')
        ? mode.defaultModel.slice(0, mode.defaultModel.indexOf('/'))
        : '';
      if (!provider || !registered.includes(provider)) { continue; }
      await cfg.update(key, defaultModelsFor(mode), vscode.ConfigurationTarget.Global);
    }
  }

  // Focus helpers contributed via views/item commands
  registerDisposable(
    vscode.commands.registerCommand('trueguard.chat.focus', () => {
      void vscode.commands.executeCommand('trueguard.chatView.focus');
    }),
  );

  // --- Review commands -------------------------------------------------

  /** The review the user is working on (the first pending one). */
  function currentReviewId(): string | undefined {
    const pending = changes.pending();
    return pending[0]?.id;
  }

  async function openDiff(item: ChangeTreeItem): Promise<void> {
    if (item.kind === 'group') {
      await vscode.commands.executeCommand('trueguard.reviewNextChange');
      return;
    }
    const changeSetId = item.changeSetId;
    const path = item.path;
    const left = vscode.Uri.file(path);
    const right = proposedUri(changeSetId, path);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path} (proposed)`);
    if (await diffProvider.isStale(changeSetId, path)) {
      void vscode.window.showWarningMessage(
        'This file changed after the agent proposed the edit. The diff may not match what will be written.',
      );
    }
    if (item.kind === 'hunk') {
      // Scroll the diff to the hunk the user clicked.
      const line = Math.max(0, item.hunk.oldStart - 1);
      const range = new vscode.Range(line, 0, line + Math.max(1, item.hunk.newLines.length), 0);
      try {
        await vscode.commands.executeCommand('_revealRange', right, range, 'inCenter');
      } catch {
        // The command is internal: the diff still opens, just not scrolled.
      }
    }
  }

  function acceptItem(item: ChangeTreeItem): void {
    if (item.kind === 'group') {
      const changeSet = changes.get(item.changeSetId);
      if (changeSet) { changes.acceptAll(changeSet.id); }
    } else if (item.kind === 'file') {
      const changeSet = changes.get(item.changeSetId);
      const file = changeSet?.files.find((f) => f.path === item.path);
      if (changeSet && file) {
        changes.setAccepted(changeSet.id, file.path, new Set(file.hunks.map((h) => h.id)));
      }
    } else {
      changesTree.setHunkAccepted(item.changeSetId, item.path, item.hunkId, true);
    }
    changesTree.refresh();
    refreshPending();
  }

  function rejectItem(item: ChangeTreeItem): void {
    if (item.kind === 'group') {
      void editService.rejectChangeSet(item.changeSetId);
    } else if (item.kind === 'file') {
      const changeSet = changes.get(item.changeSetId);
      const file = changeSet?.files.find((f) => f.path === item.path);
      if (changeSet && file) { changes.setAccepted(changeSet.id, file.path, new Set()); }
    } else {
      changesTree.setHunkAccepted(item.changeSetId, item.path, item.hunkId, false);
    }
    changesTree.refresh();
    refreshPending();
  }

  function refreshPending(): void {
    const pending = changes.pending();
    const hunks = pending.reduce((sum, c) => sum + c.files.reduce((s, f) => s + f.hunks.length, 0), 0);
    statusBar.setPending(hunks);
    chatProvider.setPendingReviews(hunks);
    changesTree.refresh();
    // Show the files that changed since the proposal (before the user acts).
    void changesTree.refreshStaleness();
  }

  registerDisposable(
    vscode.commands.registerCommand('trueguard.reviewNextChange', async () => {
      await vscode.commands.executeCommand('trueguard.changesView.focus');
      const pending = changes.pending();
      if (!pending.length) {
        void vscode.window.showInformationMessage('No changes are waiting for review.');
      }
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.review.openDiff', (item: ChangeTreeItem) => openDiff(item)),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.acceptHunk', async (item?: ChangeTreeItem) => {
      const target = item ?? (await pickHunk());
      if (target) { acceptItem(target); }
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.rejectHunk', async (item?: ChangeTreeItem) => {
      const target = item ?? (await pickHunk());
      if (target) { rejectItem(target); }
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.acceptAll', () => {
      const id = currentReviewId();
      if (!id) {
        void vscode.window.showInformationMessage('No changes are waiting for review.');
        return;
      }
      changes.acceptAll(id);
      changesTree.refresh();
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.rejectAll', async () => {
      const id = currentReviewId();
      if (!id) {
        void vscode.window.showInformationMessage('No changes are waiting for review.');
        return;
      }
      await editService.rejectChangeSet(id, 'The user rejected this change.');
      refreshPending();
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.revertChange', async () => {
      const latest = checkpointStore.latest();
      if (!latest) {
        void vscode.window.showInformationMessage('There is no applied change to revert.');
        return;
      }
      const result = await editService.revertCheckpoint(latest.id);
      void vscode.window.showInformationMessage(result.note);
    }),
  );

  registerDisposable(
    vscode.commands.registerCommand('trueguard.applyChanges', async () => {
      const id = currentReviewId();
      if (!id) {
        void vscode.window.showInformationMessage('No changes are waiting for review.');
        return;
      }
      await editService.applyChangeSet(id);
      refreshPending();
    }),
  );

  /** QuickPick to choose a hunk when the command comes from the palette. */
  async function pickHunk(): Promise<ChangeTreeItem | undefined> {
    const pending = changes.pending();
    const items: Array<Extract<ChangeTreeItem, { kind: 'hunk' }>> = [];
    for (const changeSet of pending) {
      for (const file of changeSet.files) {
        for (const hunk of file.hunks) {
          items.push({
            kind: 'hunk',
            changeSetId: changeSet.id,
            path: file.path,
            hunkId: hunk.id,
            label: `${file.path} · lines ${hunk.oldStart}`,
            hunk,
          });
        }
      }
    }
    if (!items.length) {
      void vscode.window.showInformationMessage('No changes are waiting for review.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      items.map((i) => ({ label: i.label, description: i.path, item: i })),
      { placeHolder: 'Choose a change' },
    );
    return picked?.item;
  }  // The status bar shows the failover state (FR-7).
  registerDisposable(
    sessions.onFailover((failover) => {
      statusBar.setFailover(failover.model);
    }),
  );

  // Health probe result surfaces through the status bar via onStateChange.
  registerDisposable(
    server.onStateChange((s) => {
      if (s === ServerState.Ready) { log.info('TrueForge ready'); }
    }),
  );

  // Dev-only: arm the "corrupt the next write" fault (demo scenario D3).
  const faults = new FaultHook();
  registerDisposable(
    vscode.commands.registerCommand('trueguard.dev.corruptNextWrite', () => {
      if (!devFaultsEnabled()) {
        void vscode.window.showInformationMessage(
          'Fault injection is off. Enable "TrueGuard: Enable Fault Injection" in Settings first.',
        );
        return;
      }
      faults.armCorruptNextWrite();
      void vscode.window.showInformationMessage('The next write will be corrupted on purpose.');
    }),
  );

  // Dev-only: inject a provider fault into the fake OpenAI provider, so the
  // failover can be demonstrated without a real rate limit (demo scenario D2).
  for (const [mode, label] of [
    ['fail429', 'a 429 (rate limit)'],
    ['fail503', 'a 503 (server error)'],
    ['fail401', 'a 401 (bad credentials)'],
    ['stall', 'a stalled response'],
  ] as const) {
    registerDisposable(
      vscode.commands.registerCommand(`trueguard.dev.inject.${mode}`, async () => {
        if (!devFaultsEnabled()) {
          void vscode.window.showInformationMessage(
            'Fault injection is off. Enable "TrueGuard: Enable Fault Injection" in Settings first.',
          );
          return;
        }
        const ok = await setFakeProviderMode(mode);
        void vscode.window.showInformationMessage(
          ok
            ? `The fake provider will answer the next call with ${label}.`
            : 'The fake provider is not running (npm run fake-openai).',
        );
      }),
    );
  }
  registerDisposable(
    vscode.commands.registerCommand('trueguard.dev.inject.clear', async () => {
      const ok = await setFakeProviderMode('echo');
      void vscode.window.showInformationMessage(ok ? 'Fault injection cleared.' : 'The fake provider is not running.');
    }),
  );

  // The tree and the status bar follow the review state.
  registerDisposable(
    editService.onUpdate(() => {
      changesTree.refresh();
      refreshPending();
    }),
  );
  registerDisposable(
    changes.onEvent(() => {
      changesTree.refresh();
      refreshPending();
    }),
  );

  // Checkboxes on the hunk nodes: checked means "apply this hunk".
  registerDisposable(
    changesView.onDidChangeCheckboxState((event) => {
      for (const [item, state] of event.items) {
        const target = item as ChangeTreeItem;
        if (target.kind !== 'hunk') { continue; }
        changesTree.setHunkAccepted(
          target.changeSetId,
          target.path,
          target.hunkId,
          state === vscode.TreeItemCheckboxState.Checked,
        );
      }
    }),
  );

  // Stopping a turn denies every approval that is still waiting (FR-5).
  // This is tied to the explicit stop action, NOT to the end of a turn: a turn
  // that ends AT the approval gate must keep its review alive.
  registerDisposable(
    vscode.commands.registerCommand('trueguard.denyPendingApprovals', async () => {
      await editService.denyAllPending('The turn was stopped.');
      refreshPending();
    }),
  );

  // A new turn forgets the tool calls of the previous one (idempotency guard).
  registerDisposable(
    sessions.onTurnStarted(() => {
      editor.resetToolGuard();
    }),
  );

  // --- Inline edit (FR-11) ------------------------------------------------

  /** The inline request waiting for its review (the diff opens when it lands). */
  let inlineRequest: { path: string; changeSetId?: string } | undefined;

  registerDisposable(
    vscode.commands.registerCommand('trueguard.inlineEdit', async () => {
      await runInlineEdit({
        sessions,
        // The model of the active mode, so an inline edit uses the same
        // model as the chat.
        model: () => sessions.activeModel(),
        onRequest: (selection) => {
          inlineRequest = { path: selection.path };
        },
      });
    }),
  );

  // When the review of an inline edit arrives, open the diff beside the code.
  registerDisposable(
    editService.onUpdate((update) => {
      if (update.kind !== 'pending' || !inlineRequest) { return; }
      const changeSet = changes.get(update.changeSetId);
      const file = changeSet?.files.find((f) => f.path === inlineRequest?.path);
      if (!changeSet || !file) { return; }
      const target = inlineRequest;
      inlineRequest = undefined;
      void vscode.commands.executeCommand(
        'vscode.diff',
        vscode.Uri.file(target.path),
        proposedUri(changeSet.id, target.path),
        `${target.path} (proposed)`,
      );
    }),
  );

  log.info('TrueGuard activated');

  return { server, sessions, editor, changes, editService };
}

/** Fault injection is only available in development mode or when enabled. */
function devFaultsEnabled(): boolean {
  const mode = vscode.env.appName.toLowerCase();
  const devMode = mode.includes('insiders') || mode.includes('dev');
  return devMode || vscode.workspace.getConfiguration('trueguard').get<boolean>('dev.enableFaultInjection', false);
}

/**
 * Switch the fake OpenAI provider to another mode. The provider is the demo
 * harness (spikes/fake-openai.mjs); a real provider cannot be told to fail.
 */
async function setFakeProviderMode(mode: string): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:8799/set-mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}



export function deactivate(): void {
  // Disposables handle teardown (server stop happens in ServerManager.dispose).
}
