import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { contentHash } from '../util/hash';
import type { EditorBridge } from './apply';

/**
 * VS Code bridge for the edit engine.
 *
 * Writes go through ONE WorkspaceEdit, so the user can undo the whole change
 * with a single Ctrl/Cmd+Z. The file is saved right after the edit, and the
 * applier verifies the buffer AND the disk before it reports success.
 */

function documentFor(path: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === path);
}

async function readCurrentText(path: string): Promise<string> {
  const open = documentFor(path);
  if (open) { return open.getText(); }
  return fs.readFile(path, 'utf8');
}

export function vscodeBridge(): EditorBridge {
  /** VS Code manages the file encoding (and the BOM) itself: we write text. */
  const stripBom = (text: string): string => (text.startsWith('﻿') ? text.slice(1) : text);

  return {
    async readText(path: string): Promise<string> {
      return readCurrentText(path);
    },

    async writeText(path: string, text: string): Promise<void> {
      const uri = vscode.Uri.file(path);
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      // Replace the whole document in one edit: VS Code makes it one undo step.
      const lastLine = Math.max(0, doc.lineCount - 1);
      const end = doc.lineAt(lastLine).range.end;
      edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), end), stripBom(text));
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) { throw new Error(`the edit to ${path} could not be applied`); }
      await doc.save();
    },

    async snapshot(path: string): Promise<string> {
      return readCurrentText(path);
    },

    async restore(path: string, text: string): Promise<void> {
      const uri = vscode.Uri.file(path);
      const doc = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const lastLine = Math.max(0, doc.lineCount - 1);
      const end = doc.lineAt(lastLine).range.end;
      edit.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), end), stripBom(text));
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) { throw new Error(`the rollback of ${path} could not be applied`); }
      await doc.save();
    },

    async readDisk(path: string): Promise<string> {
      return fs.readFile(path, 'utf8');
    },

    async hash(path: string): Promise<string> {
      return contentHash(await readCurrentText(path));
    },
  };
}

/** Proposal context backed by the real workspace. */
export function vscodeProposalContext(): {
  readFile(path: string): Promise<string | undefined>;
  exists(path: string): Promise<boolean>;
} {
  return {
    async readFile(path: string): Promise<string | undefined> {
      const open = documentFor(path);
      if (open) { return open.getText(); }
      try {
        return await fs.readFile(path, 'utf8');
      } catch {
        return undefined;
      }
    },
    async exists(path: string): Promise<boolean> {
      if (documentFor(path)) { return true; }
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}
