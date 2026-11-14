import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { contentHash } from '../util/hash';
import { PathGuard } from '../mcp/pathGuard';
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


/**
 * Resolve a path for the editor.
 *
 * EVERY path that reaches the disk goes through here: the agent's proposal
 * paths are relative ("src/app.ts") or absolute, and they must resolve inside
 * a workspace folder. The guard refuses .git, secret files and anything
 * outside the workspace (PRD FR-4 / section 8).
 */
async function resolveWorkspacePath(path: string, mustExist: boolean): Promise<string> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const allowSecrets = vscode.workspace.getConfiguration('trueguard').get<boolean>('allowSecretReads', false);
  const guard = new PathGuard({ roots, allowSecrets });
  const resolved = await guard.resolve(path, { mustExist });
  return resolved.absolute;
}

export function vscodeBridge(): EditorBridge {
  /** VS Code manages the file encoding (and the BOM) itself: we write text. */
  const stripBom = (text: string): string => (text.startsWith('﻿') ? text.slice(1) : text);

  return {
    async readText(path: string): Promise<string> {
      return readCurrentText(await resolveWorkspacePath(path, true));
    },

    async writeText(path: string, text: string): Promise<void> {
      const uri = vscode.Uri.file(await resolveWorkspacePath(path, false));
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
      return readCurrentText(await resolveWorkspacePath(path, true));
    },

    async restore(path: string, text: string): Promise<void> {
      const uri = vscode.Uri.file(await resolveWorkspacePath(path, false));
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
      return fs.readFile(await resolveWorkspacePath(path, true), 'utf8');
    },

    async hash(path: string): Promise<string> {
      return contentHash(await readCurrentText(await resolveWorkspacePath(path, true)));
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
      const absolute = await resolveWorkspacePath(path, true).catch(() => undefined);
      if (!absolute) { return undefined; }
      const open = documentFor(absolute);
      if (open) { return open.getText(); }
      try {
        return await fs.readFile(absolute, 'utf8');
      } catch {
        return undefined;
      }
    },
    async exists(path: string): Promise<boolean> {
      const absolute = await resolveWorkspacePath(path, false).catch(() => undefined);
      if (!absolute) { return false; }
      if (documentFor(absolute)) { return true; }
      try {
        await fs.access(absolute);
        return true;
      } catch {
        return false;
      }
    },
  };
}
