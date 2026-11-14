import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * A temporary directory INSIDE the workspace.
 *
 * The edit pipeline refuses every path outside the workspace (that is the
 * point), so the integration tests must work inside it.
 */
export async function workspaceTempDir(prefix = 'trueguard-test'): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { throw new Error('no workspace folder is open'); }
  const dir = path.join(folder.uri.fsPath, `.${prefix}-${Date.now().toString(36)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Remove a temporary directory and everything in it. */
export async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
