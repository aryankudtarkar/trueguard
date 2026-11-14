import * as vscode from 'vscode';
import type { SessionManager } from '../trueforge/sessionManager';
import { logger } from '../util/logger';

/**
 * Inline edit (FR-11, brief Task A).
 *
 * Select some code, press the keybinding, say what to change — the agent
 * proposes an edit and the diff opens next to the code. The write still goes
 * through the normal review: nothing is applied without the user's approval.
 */

export const INLINE_EDIT_COMMAND = 'trueguard.inlineEdit';

/** What the user selected. */
export interface InlineSelection {
  path: string;
  /** The path relative to the workspace (what the agent is told). */
  relativePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

/** Read the current selection (empty when there is none). */
export function currentSelection(): InlineSelection | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }
  const doc = editor.document;
  if (doc.uri.scheme !== 'file') { return undefined; }
  const selection = editor.selection;
  if (selection.isEmpty) { return undefined; }
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  const path = folder ? doc.uri.fsPath : doc.uri.fsPath;
  return {
    path,
    relativePath: folder ? vscode.workspace.asRelativePath(doc.uri) : doc.uri.fsPath,
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    text: doc.getText(selection),
  };
}

/** The prompt sent to the agent for an inline edit. */
export function buildInlinePrompt(selection: InlineSelection, instruction: string): string {
  const file = selection.relativePath;
  const lines = selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}-${selection.endLine}`;
  return [
    `The user selected ${lines} of ${file} and asked: "${instruction}".`,
    '',
    'Propose the change with propose_edit, using exact-match edits for the selected region only.',
    'Keep the change as small as the instruction allows.',
  ].join('\n');
}

export interface InlineEditDeps {
  sessions: SessionManager;
  /** The model the turn should use. */
  model(): string;
  /** Called when the user asked for an inline edit (the diff opens later). */
  onRequest(selection: InlineSelection, instruction: string): void;
  /** Asks the user what to change (injectable for the tests). */
  askInstruction?: () => Promise<string | undefined>;
}

/** Ask the user what to change, then send the turn. */
export async function runInlineEdit(deps: InlineEditDeps): Promise<void> {
  const selection = currentSelection();
  if (!selection) {
    void vscode.window.showInformationMessage('Select the code you want to change first.');
    return;
  }
  const instruction = await (deps.askInstruction ?? askForInstruction)();
  if (!instruction) { return; }

  deps.onRequest(selection, instruction);
  const prompt = buildInlinePrompt(selection, instruction);
  try {
    await deps.sessions.sendTurn(
      [{ type: 'user.message', content: prompt }],
      () => undefined,
      deps.model(),
    );
  } catch (e) {
    logger().warn(`inline edit failed: ${String(e)}`);
    void vscode.window.showErrorMessage('The inline edit could not be started. See the TrueGuard output for the cause.');
  }
}

/** A native input box for the instruction. */
export async function askForInstruction(): Promise<string | undefined> {
  const box = vscode.window.createInputBox();
  box.title = 'TrueGuard: change the selected code';
  box.placeholder = 'e.g. make this a for loop';
  box.prompt = 'Describe the change you want. Nothing is written until you approve it.';
  box.ignoreFocusOut = true;
  const result = await new Promise<string | undefined>((resolve) => {
    const subscriptions = [
      box.onDidAccept(() => {
        subscriptions.forEach((s) => s.dispose());
        resolve(box.value.trim() || undefined);
        box.hide();
      }),
      box.onDidHide(() => {
        subscriptions.forEach((s) => s.dispose());
        resolve(undefined);
      }),
    ];
    box.show();
  });
  box.dispose();
  return result;
}
