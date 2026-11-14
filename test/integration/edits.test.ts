import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyChanges } from '../../src/edits/apply';
import { computeHunks } from '../../src/edits/hunks';
import { contentHash } from '../../src/util/hash';
import { vscodeBridge } from '../../src/edits/vscodeBridge';
import { BOM } from '../../src/edits/text';
import { CheckpointStore, hashOf } from '../../src/edits/checkpoints';

/**
 * Integration on real TextDocuments (PRD Phase 3.8): dirty buffers, CRLF,
 * BOM, unicode, undo, and a forced corruption that must be caught and
 * rolled back.
 */

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'trueguard-edits-'));
}

async function writeFile(dir: string, name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, content, 'utf8');
  return p;
}

function requestFor(file: string, base: string, proposed: string) {
  const hunks = computeHunks(base, proposed);
  return {
    path: file,
    baseText: base,
    baseHash: contentHash(base),
    hunks,
    acceptedIds: new Set(hunks.map((h) => h.id)),
  };
}

describe('edit engine in real VS Code', () => {
  it('writes a change to disk and verifies it', async () => {
    const dir = await tempDir();
    const file = await writeFile(dir, 'a.ts', 'one\ntwo\nthree\n');
    const result = await applyChanges(
      { files: [requestFor(file, 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')] },
      { bridge: vscodeBridge() },
    );
    expect(result.status).toBe('applied');
    expect(result.files[0]?.verified).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('one\nTWO\nthree\n');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps CRLF and BOM conventions', async () => {
    const dir = await tempDir();
    const crlf = `${BOM}one\r\ntwo\r\nthree\r\n`;
    const file = await writeFile(dir, 'crlf.ts', crlf);
    const result = await applyChanges(
      { files: [requestFor(file, 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')] },
      { bridge: vscodeBridge() },
    );
    expect(result.status).toBe('applied');
    const written = await fs.readFile(file, 'utf8');
    expect(written).toBe(`${BOM}one\r\nTWO\r\nthree\r\n`);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps unicode content intact', async () => {
    const dir = await tempDir();
    const file = await writeFile(dir, 'u.ts', 'const emoji = "🚀 héllo wörld";\nconst two = 2;\n');
    const result = await applyChanges(
      { files: [requestFor(file, 'const emoji = "🚀 héllo wörld";\nconst two = 2;\n', 'const emoji = "🚀 héllo wörld";\nconst two = 22;\n')] },
      { bridge: vscodeBridge() },
    );
    expect(result.status).toBe('applied');
    expect(await fs.readFile(file, 'utf8')).toContain('🚀 héllo wörld');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('applies on top of a dirty buffer and keeps the unsaved edit', async () => {
    const dir = await tempDir();
    const file = await writeFile(dir, 'dirty.ts', 'one\ntwo\n');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((b) => {
      b.insert(new vscode.Position(0, 0), '// unsaved\n');
    });
    expect(doc.isDirty).toBe(true);

    const dirtyText = doc.getText();
    const result = await applyChanges(
      { files: [requestFor(file, dirtyText, dirtyText.replace('two', 'TWO'))] },
      { bridge: vscodeBridge() },
    );
    expect(result.status).toBe('applied');
    expect(doc.getText()).toContain('// unsaved');
    expect(doc.getText()).toContain('TWO');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('undoes the whole change with one undo step', async () => {
    const dir = await tempDir();
    const original = 'one\ntwo\nthree\n';
    const file = await writeFile(dir, 'undo.ts', original);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc);
    const result = await applyChanges(
      { files: [requestFor(file, original, 'one\nTWO\nthree\n')] },
      { bridge: vscodeBridge() },
    );
    expect(result.status).toBe('applied');
    expect(doc.getText()).toContain('TWO');

    await vscode.commands.executeCommand('undo');
    expect(doc.getText()).toBe(original);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('catches a corrupted write and rolls it back', async () => {
    const dir = await tempDir();
    const original = 'one\ntwo\n';
    const file = await writeFile(dir, 'corrupt.ts', original);
    const result = await applyChanges(
      { files: [requestFor(file, original, 'one\nTWO\n')] },
      { bridge: vscodeBridge(), corruptNextWrite: true },
    );
    expect(result.status).toBe('verification_failed');
    expect(result.files[0]?.verified).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('refuses to apply when the file changed after the proposal', async () => {
    const dir = await tempDir();
    const file = await writeFile(dir, 'conflict.ts', 'one\ntwo\n');
    const request = requestFor(file, 'one\ntwo\n', 'one\nTWO\n');
    // The user edits the file while the proposal waits.
    await fs.writeFile(file, 'one\nuser edit\n', 'utf8');
    const result = await applyChanges({ files: [request] }, { bridge: vscodeBridge() });
    expect(result.status).toBe('conflict');
    expect(await fs.readFile(file, 'utf8')).toBe('one\nuser edit\n');
    await fs.rm(dir, { recursive: true, force: true });
  });
  it('reverts an applied change back to the text before it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forgeguard-revert-'));
    const file = path.join(dir, 'r.ts');
    const original = 'one\ntwo\n';
    await fs.writeFile(file, original, 'utf8');

    // Apply the change through the real editor bridge.
    const bridge = vscodeBridge();
    await bridge.writeText(file, 'one\nTWO\n');
    expect(await fs.readFile(file, 'utf8')).toBe('one\nTWO\n');

    // Record the checkpoint the way the edit service does.
    const store = new CheckpointStore();
    const checkpoint = store.create('cs1', [
      {
        path: file,
        before: original,
        after: 'one\nTWO\n',
        hashBefore: hashOf(original),
        hashAfter: hashOf('one\nTWO\n'),
      },
    ], 'Applied 1 of 1 changes');

    // Revert it.
    await bridge.writeText(checkpoint.files[0]!.path, checkpoint.files[0]!.before);
    expect(await fs.readFile(file, 'utf8')).toBe(original);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
