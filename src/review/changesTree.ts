import * as vscode from 'vscode';
import type { ChangeSet } from '../edits/store';
import type { Hunk } from '../edits/hunks';
import type { EditService } from './editService';

/**
 * The Changes view (PRD 6.5).
 *
 * A tree of pending reviews:
 *
 *   Awaiting your review
 *     └ src/app.ts            +12 -3
 *         └ Lines 42 to 58    [x]
 *         └ Lines 90 to 91    [x]
 *
 * Hunk nodes carry a checkbox: checked means "apply this hunk".
 */

export type ChangeTreeItem =
  | { kind: 'group'; changeSetId: string; label: string }
  | { kind: 'file'; changeSetId: string; path: string; label: string }
  | { kind: 'hunk'; changeSetId: string; path: string; hunkId: string; label: string; hunk: Hunk };

export interface ChangesTreeCallbacks {
  /** Open the native diff for a file or hunk. */
  openDiff(item: ChangeTreeItem): void;
  /** Accept every hunk of a file (or of the whole review). */
  accept(item: ChangeTreeItem): void;
  /** Reject a file or the whole review. */
  reject(item: ChangeTreeItem): void;
}

export class ChangesTreeProvider implements vscode.TreeDataProvider<ChangeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<ChangeTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(
    private readonly service: EditService,
    /** Callbacks for the UI actions (open diff, accept, reject). */
    readonly callbacks: ChangesTreeCallbacks,
  ) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: ChangeTreeItem): vscode.TreeItem {
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'forgeguard.review';
      item.iconPath = new vscode.ThemeIcon('eye');
      return item;
    }
    if (element.kind === 'file') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'forgeguard.file';
      item.iconPath = new vscode.ThemeIcon('file');
      item.description = countsFor(element.path, this.service);
      item.resourceUri = vscode.Uri.file(element.path);
      item.tooltip = element.path;
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'forgeguard.hunk';
    item.checkboxState = this.isAccepted(element.changeSetId, element.path, element.hunkId)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.description = `+${element.hunk.newLines.length} -${element.hunk.oldLines}`;
    item.command = {
      command: 'forgeguard.review.openDiff',
      title: 'Open diff',
      arguments: [element],
    };
    return item;
  }

  getChildren(element?: ChangeTreeItem): ChangeTreeItem[] {
    if (!element) {
      return this.service.changeStore.pending().map((changeSet) => ({
        kind: 'group' as const,
        changeSetId: changeSet.id,
        label: groupLabel(changeSet),
      }));
    }
    if (element.kind === 'group') {
      const changeSet = this.service.changeStore.get(element.changeSetId);
      if (!changeSet) { return []; }
      return changeSet.files.map((file) => ({
        kind: 'file' as const,
        changeSetId: changeSet.id,
        path: file.path,
        label: file.path,
      }));
    }
    if (element.kind === 'file') {
      const changeSet = this.service.changeStore.get(element.changeSetId);
      const file = changeSet?.files.find((f) => f.path === element.path);
      if (!changeSet || !file) { return []; }
      return file.hunks.map((hunk) => ({
        kind: 'hunk' as const,
        changeSetId: changeSet.id,
        path: file.path,
        hunkId: hunk.id,
        label: hunkLabel(hunk),
        hunk,
      }));
    }
    return [];
  }

  /** Is this hunk currently accepted? */
  isAccepted(changeSetId: string, path: string, hunkId: string): boolean {
    const changeSet = this.service.changeStore.get(changeSetId);
    const file = changeSet?.files.find((f) => f.path === path);
    return file?.accepted.has(hunkId) ?? false;
  }

  /** Toggle one hunk (the checkbox handler). */
  setHunkAccepted(changeSetId: string, path: string, hunkId: string, accepted: boolean): void {
    const changeSet = this.service.changeStore.get(changeSetId);
    const file = changeSet?.files.find((f) => f.path === path);
    if (!changeSet || !file) { return; }
    const next = new Set(file.accepted);
    if (accepted) { next.add(hunkId); } else { next.delete(hunkId); }
    this.service.changeStore.setAccepted(changeSetId, path, next);
    this.refresh();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** "src/app.ts" plus the number of pending hunks. */
export function groupLabel(changeSet: ChangeSet): string {
  const files = changeSet.files.length;
  const hunks = changeSet.files.reduce((sum, f) => sum + f.hunks.length, 0);
  return files === 1 ? 'Awaiting your review' : `Awaiting your review (${files} files, ${hunks} hunks)`;
}

/** "Lines 42 to 58" (or "After line 41" for an insertion). */
export function hunkLabel(hunk: Hunk): string {
  if (hunk.oldLines === 0) { return `After line ${hunk.oldStart - 1}`; }
  const end = hunk.oldStart + hunk.oldLines - 1;
  return end === hunk.oldStart ? `Line ${hunk.oldStart}` : `Lines ${hunk.oldStart} to ${end}`;
}

/** "+12 -3" for a file node. */
function countsFor(path: string, service: EditService): string {
  for (const changeSet of service.changeStore.pending()) {
    const file = changeSet.files.find((f) => f.path === path);
    if (!file) { continue; }
    const added = file.hunks.reduce((sum, h) => sum + h.newLines.length, 0);
    const removed = file.hunks.reduce((sum, h) => sum + h.oldLines, 0);
    return `+${added} -${removed}`;
  }
  return '';
}
