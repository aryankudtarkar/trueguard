import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { vscodeBridge, vscodeProposalContext } from '../../src/edits/vscodeBridge';

/**
 * The containment rule (PRD FR-4 / section 8): every path that reaches the
 * disk resolves inside a workspace folder. The agent proposes paths — they
 * are untrusted input, exactly like tool arguments.
 *
 * The tests run inside the real VS Code, with the workspace folder open.
 */

const outsideDir = path.join(os.tmpdir(), 'trueguard-outside');
const outsideFile = path.join(outsideDir, 'secret.txt');

describe('the path containment of the edit pipeline', () => {
  it('refuses to read a file outside the workspace', async () => {
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(outsideFile, 'secret\n', 'utf8');
    const bridge = vscodeBridge();
    let refused = false;
    try {
      await bridge.readText(outsideFile);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('refuses to write a file outside the workspace', async () => {
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(outsideFile, 'secret\n', 'utf8');
    const bridge = vscodeBridge();
    let refused = false;
    try {
      await bridge.writeText(outsideFile, 'overwritten\n');
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    // The file outside the workspace is untouched.
    expect(await fs.readFile(outsideFile, 'utf8')).toBe('secret\n');
  });

  it('refuses a path that escapes the workspace with ..', async () => {
    const bridge = vscodeBridge();
    let refused = false;
    try {
      await bridge.readText('../../../etc/passwd');
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('refuses a .git path', async () => {
    const bridge = vscodeBridge();
    let refused = false;
    try {
      await bridge.readText('.git/config');
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('refuses to read a secret file inside the workspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return; }
    const secret = path.join(folder.uri.fsPath, 'trueguard-secret-probe.env');
    await fs.writeFile(secret, 'SECRET=1\n', 'utf8');
    try {
      const bridge = vscodeBridge();
      let refused = false;
      try {
        await bridge.readText(secret);
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    } finally {
      await fs.rm(secret, { force: true });
    }
  });

  it('resolves a relative path against the workspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return; }
    const relative = 'package.json';
    const exists = await fs
      .stat(path.join(folder.uri.fsPath, relative))
      .then(() => true)
      .catch(() => false);
    if (!exists) { return; }
    const bridge = vscodeBridge();
    const text = await bridge.readText(relative);
    expect(text).toContain('trueguard');
  });

  it('the proposal context refuses a path outside the workspace', async () => {
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(outsideFile, 'secret\n', 'utf8');
    const context = vscodeProposalContext();
    expect(await context.readFile(outsideFile)).toBeUndefined();
    expect(await context.exists(outsideFile)).toBe(false);
  });
});
