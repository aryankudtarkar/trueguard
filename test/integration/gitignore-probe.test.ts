import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { listFiles } from '../../src/mcp/tools';
import { PathGuard } from '../../src/mcp/pathGuard';
import { vscodeToolDeps } from '../../src/mcp/vscodeTools';

/**
 * FR-3: list_files must respect .gitignore. VS Code's findFiles does not, so
 * the listing comes from git (see src/mcp/vscodeTools.ts). This test proves
 * it against the real platform.
 */
describe('list_files and .gitignore', () => {
  it('hides files that .gitignore excludes', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return; }
    const root = folder.uri.fsPath;
    const ignored = path.join(root, 'fg-ignored-probe.txt');
    const visible = path.join(root, 'fg-visible-probe.txt');
    const gitignore = path.join(root, '.gitignore');
    const hadGitignore = await fs
      .stat(gitignore)
      .then(() => true)
      .catch(() => false);
    const previous = hadGitignore ? await fs.readFile(gitignore, 'utf8') : '';
    await fs.writeFile(ignored, 'ignored\n');
    await fs.writeFile(visible, 'visible\n');
    await fs.appendFile(gitignore, '\nfg-ignored-probe.txt\n');

    try {
      const deps = vscodeToolDeps();
      const ctx = { deps, guard: new PathGuard({ roots: [root] }) };
      const res = await listFiles({}, ctx);
      const raw = res.content[0]?.text ?? '{}';
      console.log(`PROBE raw: ${JSON.stringify(JSON.parse(raw)).slice(0, 400)}`);
      const files = (JSON.parse(raw) as { files: string[] }).files;
      expect(files).toContain('fg-visible-probe.txt');
      expect(files).not.toContain('fg-ignored-probe.txt');
      // node_modules must never reach the agent's context
      expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
    } finally {
      await fs.rm(ignored, { force: true });
      await fs.rm(visible, { force: true });
      if (hadGitignore) {
        await fs.writeFile(gitignore, previous);
      } else {
        await fs.rm(gitignore, { force: true });
      }
    }
  });
});
