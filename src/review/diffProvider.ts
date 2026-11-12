import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { applyHunks } from '../edits/hunks';
import { toEditableText } from '../edits/text';
import { contentHash } from '../util/hash';
import type { EditService } from './editService';

/**
 * Diff content provider (PRD 6.5, 4.5).
 *
 * The right-hand side of the diff is a virtual document: the current file
 * with the accepted hunks applied. The left-hand side is the real file, so
 * the user sees exactly what would change.
 */

export const DIFF_SCHEME = 'forgeguard';

/** URI of the virtual "proposed" version of a file. */
export function proposedUri(changeSetId: string, path: string): vscode.Uri {
  return vscode.Uri.parse(`${DIFF_SCHEME}:/${changeSetId}/${encodeURIComponent(path)}`);
}

/** Parse a proposed URI back into its parts. */
export function parseProposedUri(uri: vscode.Uri): { changeSetId: string; path: string } | undefined {
  if (uri.scheme !== DIFF_SCHEME) { return undefined; }
  const parts = uri.path.split('/').filter(Boolean);
  if (parts.length < 2) { return undefined; }
  const changeSetId = parts[0]!;
  const path = decodeURIComponent(parts.slice(1).join('/'));
  return { changeSetId, path };
}

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly service: EditService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const parsed = parseProposedUri(uri);
    if (!parsed) { return ''; }
    const changeSet = this.service.changeStore.get(parsed.changeSetId);
    const file = changeSet?.files.find((f) => f.path === parsed.path);
    if (!changeSet || !file) { return ''; }

    const current = await readFile(file.path);
    if (current === undefined) { return ''; }
    const { text } = toEditableText(current);
    // Preview all hunks of the file (the user can still uncheck hunks).
    const proposed = applyHunks(text, file.hunks, new Set(file.hunks.map((h) => h.id)));
    return proposed;
  }

  /** True when the file changed since the proposal (the diff would lie). */
  async isStale(changeSetId: string, path: string): Promise<boolean> {
    const changeSet = this.service.changeStore.get(changeSetId);
    const file = changeSet?.files.find((f) => f.path === path);
    if (!file) { return true; }
    const current = await readFile(path);
    if (current === undefined) { return true; }
    return contentHash(toEditableText(current).text) !== file.baseHash;
  }

  refresh(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

async function readFile(path: string): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === path);
  if (open) { return open.getText(); }
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
