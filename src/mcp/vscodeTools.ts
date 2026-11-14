import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { logger, redact } from '../util/logger';
import { type EditorToolDeps } from './tools';

/**
 * vscode-backed EditorToolDeps: reads the dirty buffer when the file is open,
 * otherwise the file on disk. listFiles honours .gitignore (see listFiles).
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

// --- file listing -------------------------------------------------------

/** Files listed by git are cached briefly: searches ask for them often. */
const gitCache = new Map<string, { files: string[]; at: number }>();
const GIT_CACHE_MS = 5_000;

/**
 * List the files of a folder with .gitignore respected.
 *
 * VS Code's findFiles does NOT honour .gitignore (verified in the integration
 * probe), so the repository listing comes from git itself. Outside a git
 * work tree we fall back to findFiles with an explicit exclude list.
 */
async function listFolderFiles(folder: vscode.WorkspaceFolder, glob: string | undefined, max: number): Promise<string[]> {
  const root = folder.uri.fsPath;
  const gitFiles = await gitListFiles(root);
  if (gitFiles) {
    return filterByGlob(gitFiles, glob).slice(0, max).map((f) => path.join(root, f));
  }
  const pattern = new vscode.RelativePattern(folder, glob ?? '**/*');
  const uris = await vscode.workspace.findFiles(pattern, excludePattern(), max);
  return uris.map((u) => u.fsPath);
}

/** Files known to git in `root` (tracked + untracked but not ignored). */
async function gitListFiles(root: string): Promise<string[] | undefined> {
  const cached = gitCache.get(root);
  if (cached && Date.now() - cached.at < GIT_CACHE_MS) { return cached.files; }
  const files = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  if (!files) { return undefined; }
  const list = files.split('\0').filter(Boolean);
  gitCache.set(root, { files: list, at: Date.now() });
  return list;
}

/** Run git in `cwd`; returns stdout, or undefined when git is unavailable. */
function runGit(cwd: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = '';
    let failed = false;
    try {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
      child.on('error', () => { failed = true; resolve(undefined); });
      child.on('close', (code) => { resolve(code === 0 && !failed ? out : undefined); });
    } catch {
      resolve(undefined);
    }
  });
}

/** Exclude list for the findFiles fallback: .git, node_modules and the user's files.exclude. */
function excludePattern(): string {
  const configured = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude', {});
  const patterns = Object.entries(configured)
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern);
  patterns.push('**/.git/**', '**/node_modules/**');
  return `{${patterns.join(',')}}`;
}

/** Glob filter with VS Code-ish semantics ('**' crosses directories). */
export function filterByGlob(files: readonly string[], glob: string | undefined): string[] {
  if (!glob) { return [...files]; }
  const re = globToRegExp(glob);
  return files.filter((f) => re.test(f));
}

export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (const part of glob.split('/')) {
    if (part === '**') {
      out += out.endsWith('/') ? '.*' : '(?:.*/)?';
      continue;
    }
    const escaped = part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    out += `${escaped}/`;
  }
  return new RegExp(`^${out.replace(/\/$/, '')}(/|$)`);
}

/** The workspace files (respecting .gitignore), relative to the workspace. */
export async function listFiles(glob: string | undefined, maxResults: number): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const out: string[] = [];
  for (const folder of folders) {
    const files = await listFolderFiles(folder, glob, maxResults);
    out.push(...files.map((f) => rel(f)));
  }
  return [...new Set(out)].sort();
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

async function sizeOf(absolute: string): Promise<number | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === absolute);
  if (open) { return Buffer.byteLength(open.getText(), 'utf8'); }
  return fs
    .stat(absolute)
    .then((s) => s.size)
    .catch(() => undefined);
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
      vscode.workspace.getConfiguration('trueguard').get<boolean>('allowSecretReads', false),
    outputCapBytes: () =>
      vscode.workspace.getConfiguration('trueguard').get<number>('toolOutputCapBytes', 16_384),
    sizeOf,
  };
}
