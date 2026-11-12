import * as vscode from 'vscode';
import { EditorMcpServer, MCP_SERVER_NAME } from './mcp/editorServer';
import { FaultHook } from './edits/faults';
import { ServerManager, ServerState } from './trueforge/serverManager';
import { SessionManager } from './trueforge/sessionManager';
import { ChatViewProvider } from './ui/chatProvider';
import { StatusBar } from './ui/statusBar';
import { logger, redact } from './util/logger';

export function activate(context: vscode.ExtensionContext): void {
  const log = logger();
  log.info('ForgeGuard activating');

  const server = new ServerManager(context);
  const editor = new EditorMcpServer();
  const sessions = new SessionManager(server, context, () => {
    const ep = editor.getEndpoint();
    if (!ep) { return []; }
    return [
      {
        name: MCP_SERVER_NAME,
        enable_tools: ['@all'],
        // Every Phase 2 tool is read-only: no approval gate, the agent may use
        // them freely. Phase 4 adds propose_edit/run_command with explicit
        // approval selectors.
        require_approval_for_tools: [],
        preload: true,
      },
    ];
  });

  const chatProvider = new ChatViewProvider(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview').fsPath,
    server,
    sessions,
  );
  const statusBar = new StatusBar(server, sessions);

  const registerDisposable = <T extends vscode.Disposable>(d: T): T => {
    context.subscriptions.push(d);
    return d;
  };

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
        description: 'ForgeGuard editor tools: read-only workspace access from the agent.',
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
    vscode.commands.registerCommand('forgeguard.startTrueForge', async () => {
      try {
        await server.start();
        void vscode.window.showInformationMessage('TrueForge is running.');
      } catch {
        void vscode.window.showErrorMessage(
          'ForgeGuard can not start TrueForge. Check the ForgeGuard output channel for the cause.',
        );
      }
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.stopTrueForge', () => server.stop()),
  );
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.newChat', () => {
      sessions.newChat();
      void vscode.commands.executeCommand('forgeguard.chatView.focus');
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.stopTurn', () => sessions.stopTurn()),
  );
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.switchModel', async () => {
      // QuickPick lives in the chat provider; focus the view and let the user click the pill,
      // or expose the same QuickPick here.
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
    }),
  );
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.showSessionLog', () => logger().show()),
  );

  // Focus helpers contributed via views/item commands
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.chat.focus', () => {
      void vscode.commands.executeCommand('forgeguard.chatView.focus');
    }),
  );
  // Placeholder until Phase 4 wires the Changes view
  registerDisposable(
    vscode.commands.registerCommand('forgeguard.reviewNextChange', () => {
      void vscode.window.showInformationMessage('Review flow arrives in Phase 4.');
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
    vscode.commands.registerCommand('forgeguard.dev.corruptNextWrite', () => {
      if (!devFaultsEnabled()) {
        void vscode.window.showInformationMessage(
          'Fault injection is off. Enable "ForgeGuard: Enable Fault Injection" in Settings first.',
        );
        return;
      }
      faults.armCorruptNextWrite();
      void vscode.window.showInformationMessage('The next write will be corrupted on purpose.');
    }),
  );

  log.info('ForgeGuard activated');
}

/** Fault injection is only available in development mode or when enabled. */
function devFaultsEnabled(): boolean {
  const mode = vscode.env.appName.toLowerCase();
  const devMode = mode.includes('insiders') || mode.includes('dev');
  return devMode || vscode.workspace.getConfiguration('forgeguard').get<boolean>('dev.enableFaultInjection', false);
}

export function deactivate(): void {
  // Disposables handle teardown (server stop happens in ServerManager.dispose).
}
