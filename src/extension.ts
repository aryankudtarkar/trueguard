import * as vscode from 'vscode';
import { ServerManager, ServerState } from './trueforge/serverManager';
import { SessionManager } from './trueforge/sessionManager';
import { ChatViewProvider } from './ui/chatProvider';
import { StatusBar } from './ui/statusBar';
import { logger } from './util/logger';

export function activate(context: vscode.ExtensionContext): void {
  const log = logger();
  log.info('ForgeGuard activating');

  const server = new ServerManager(context);
  const sessions = new SessionManager(server, context);

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
  registerDisposable(server);
  registerDisposable(sessions);
  registerDisposable(statusBar);

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

  log.info('ForgeGuard activated');
}

export function deactivate(): void {
  // Disposables handle teardown (server stop happens in ServerManager.dispose).
}
