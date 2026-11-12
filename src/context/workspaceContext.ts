import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { listFiles } from '../mcp/vscodeTools';
import { keywords, scoreFile, type ContextCandidate } from './retriever';

/**
 * The workspace context provider (FR-12).
 *
 * Reads only the files that could matter: the paths are scored first (cheap),
 * and only the best candidates are read from disk. A repository with ten
 * thousand files does not cost ten thousand reads.
 */

/** How many files are read at most for one message. */
const MAX_READ = 40;
/** Files bigger than this are not read. */
const MAX_FILE_BYTES = 200_000;

export interface ContextProvider {
  /** The files that could be relevant, with their content. */
  candidates(message: string): Promise<ContextCandidate[]>;
  /** The context budget in bytes. */
  budgetBytes(): number;
}

export function workspaceContextProvider(): ContextProvider {
  return {
    async candidates(message: string): Promise<ContextCandidate[]> {
      const words = keywords(message);
      if (!words.length) { return []; }
      const files = await listFiles(undefined, 2000);
      if (!files.length) { return []; }

      // Cheap first pass: score by path only.
      const byPath = files
        .map((path) => ({ path, score: scoreFile(path, '', words).score }))
        .filter((f) => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_READ);

      // Read the promising ones and score them by content too.
      const candidates: ContextCandidate[] = [];
      for (const candidate of byPath) {
        const content = await readWorkspaceFile(candidate.path);
        if (content === undefined) { continue; }
        candidates.push({ path: candidate.path, content });
      }
      return candidates;
    },

    budgetBytes(): number {
      return vscode.workspace.getConfiguration('forgeguard').get<number>('contextBudgetBytes', 16_384);
    },
  };
}

/** Read a workspace file (relative path), or undefined when it is too big. */
async function readWorkspaceFile(relativePath: string): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) { return undefined; }
  const root = folders[0]!.uri.fsPath;
  const absolute = `${root}/${relativePath}`;
  try {
    const stat = await fs.stat(absolute);
    if (stat.size > MAX_FILE_BYTES) { return undefined; }
    return await fs.readFile(absolute, 'utf8');
  } catch {
    return undefined;
  }
}
