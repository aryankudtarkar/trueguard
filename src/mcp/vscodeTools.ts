import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { logger, redact } from '../util/logger';
import { type EditorToolDeps } from './tools';

/**
 * vscode-backed EditorToolDeps: reads the dirty buffer when the file is open,
 * otherwise the file on disk. listFiles uses findFiles (respects .gitignore).
 */

function rel(fsPath: string): string {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fsPath));
  const root = folder?.uri.fsPath;
  if (root && fsPath.startsWith(root)) {
    return fsPath.slice(root.length + 1).split(path.sep).join('/');
  }
  return fsPath.split(path.sep).join('/');
}

async function workspaceRoots(): Promise<string[]> {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

async function readText(absolute: string): Promise<{ content: string; totalLines: number }> {
  const open = vscode.workspace.textDocuments.find(
    (d) => d.uri.fsPath === absolute || (d.uri.scheme === 'file' && d.uri.fsPath.toLowerCase() === absolute.toLowerCase()),
  );
  if (open) {
    const content = open.getText(); // includes unsaved changes
    return { content, totalLines: countLines(content) };
  }
  const content = await fs.readFile(absolute, 'utf8');
  return { content, totalLines: countLines(content) };
}

function countLines(content: string): number {
  const lines = content.split(/\r\n|\r|\n/);
  return lines.length > 0 && lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

async function listFiles(glob: string | undefined, maxResults: number): Promise<string[]> {
  const pattern = new vscode.RelativePattern(
    vscode.workspace.workspaceFolders?.[0] ?? vscode.Uri.file('.'),
    glob ?? '**/*',
  );
  const uris = await vscode.workspace.findFiles(pattern, '**/.git/**', maxResults);
  return uris.map((u) => rel(u.fsPath)).sort();
}

async function getDiagnostics(filterPath: string | undefined): Promise<Array<{ path: string; severity: string; line: number; message: string }>> {
  const out: Array<{ path: string; severity: string; line: number; message: string }> = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const p = rel(uri.fsPath);
    if (filterPath && p !== filterPath && !p.endsWith(filterPath)) { continue; }
    for (const d of diags.slice(0, 20)) {
      out.push({
        path: p,
        severity: ['error', 'warning', 'info', 'hint'][Math.min(d.severity, 3)] ?? 'info',
        line: d.range.start.line + 1,
        message: redact(d.message.slice(0, 300)),
      });
    }
  }
  return out;
}

async function getEditorContext(): Promise<unknown> {
  const active = vscode.window.activeTextEditor;
  const tabs = vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .map((t) => {
      const input = t.input as { uri?: vscode.Uri } | undefined;
      return input?.uri ? rel(input.uri.fsPath) : '(untitled)';
    })
    .slice(0, 30);
  if (!active) {
    return { activeFile: null, openTabs: tabs };
  }
  const sel = active.selection;
  const visible = active.visibleRanges[0];
  return {
    activeFile: rel(active.document.uri.fsPath),
    language: active.document.languageId,
    dirty: active.document.isDirty,
    selection: sel.isEmpty ? null : { startLine: sel.start.line + 1, endLine: sel.end.line + 1 },
    cursorLine: sel.active.line + 1,
    visibleRange: visible ? { startLine: visible.start.line + 1, endLine: visible.end.line + 1 } : null,
    openTabs: tabs,
  };
}

export function vscodeToolDeps(): EditorToolDeps {
  const log = logger();
  return {
    workspaceRoots,
    readText,
    listFiles,
    getDiagnostics,
    getEditorContext: () => getEditorContext().catch((e) => {
      log.warn(`getEditorContext failed: ${redact(String(e))}`);
      return { activeFile: null, error: 'editor context unavailable' };
    }),
    allowSecretReads: () =>
      vscode.workspace.getConfiguration('forgeguard').get<boolean>('allowSecretReads', false),
    outputCapBytes: () =>
      vscode.workspace.getConfiguration('forgeguard').get<number>('toolOutputCapBytes', 16_384),
  };
}
