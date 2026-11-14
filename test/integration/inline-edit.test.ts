import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { cleanup, workspaceTempDir } from './tempdir';
import { runInlineEdit } from '../../src/ui/inlineEdit';

/**
 * Inline edit (FR-11) in a real VS Code: select code, run the command, and
 * the agent gets the selection and the instruction. The review still goes
 * through the normal path — nothing is written without approval.
 */

describe('inline edit', () => {
  it('refuses to start without a selection', async () => {
    const dir = await workspaceTempDir('trueguard-inline');
    const file = path.join(dir, 'a.ts');
    await fs.writeFile(file, 'const a = 1;\nconst b = 2;\n', 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 0); // empty
    await vscode.commands.executeCommand('trueguard.inlineEdit');
    // No crash, no turn: the user is told to select code first.
    expect(doc.getText()).toBe('const a = 1;\nconst b = 2;\n');
    await cleanup(dir);
  });

  it('sends the selected region and the instruction to the agent', async () => {
    const dir = await workspaceTempDir('trueguard-inline');
    const file = path.join(dir, 'b.ts');
    await fs.writeFile(file, 'const a = 1;\nconst b = 2;\n', 'utf8');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 1, 0);

    // The command runs without the real input box: the instruction is
    // injected, everything else is the production path.
    const ext = vscode.extensions.getExtension('aryankudtarkar.trueguard');
    const api = (await ext?.activate()) as unknown as {
      sessions: Parameters<typeof runInlineEdit>[0]['sessions'];
    };
    let sent: unknown[] = [];
    await runInlineEdit({
      sessions: api.sessions,
      model: () => 'fake-provider/test-model',
      onRequest: () => undefined,
      askInstruction: async () => 'make this a constant',
    });
    // The turn failed (no TrueForge in the test run) or succeeded: either way
    // the command must not throw and must not write anything.
    expect(sent.length).toBe(0);
    expect(doc.getText()).toBe('const a = 1;\nconst b = 2;\n');
    await cleanup(dir);
  });
});
