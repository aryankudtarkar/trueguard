import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  type ApplyFileRequest,
  type EditorBridge,
} from '../../src/edits/apply';
import { computeHunks } from '../../src/edits/hunks';
import { contentHash } from '../../src/util/hash';

/**
 * The applier is the trust core: it must never report success it cannot
 * prove. The bridge below is a fake editor (buffer + disk), so the tests can
 * simulate a corrupted write, a changed file and a failing save.
 */

interface FakeFile {
  buffer: string;
  disk: string;
}

function fakeBridge(files: Record<string, FakeFile>, options: { corruptDisk?: boolean } = {}): EditorBridge & { files: Record<string, FakeFile> } {
  const bridge = {
    files,
    async readText(path: string): Promise<string> {
      return files[path]?.buffer ?? '';
    },
    async writeText(path: string, text: string): Promise<void> {
      const file = files[path];
      if (!file) { throw new Error(`no such file: ${path}`); }
      file.buffer = text;
      file.disk = options.corruptDisk ? `${text}<!-- tampered -->` : text;
    },
    async snapshot(path: string): Promise<string> {
      return files[path]?.buffer ?? '';
    },
    async restore(path: string, text: string): Promise<void> {
      const file = files[path];
      if (!file) { throw new Error(`no such file: ${path}`); }
      file.buffer = text;
      file.disk = text;
    },
    async readDisk(path: string): Promise<string> {
      return files[path]?.disk ?? '';
    },
    async hash(path: string): Promise<string> {
      return contentHash(files[path]?.buffer ?? '');
    },
  };
  return bridge;
}

const BASE = 'line one\nline two\nline three\n';

function request(base = BASE, accepted: 'all' | 'none' | 'first' = 'all'): ApplyFileRequest {
  const proposed = base.replace('line two', 'line TWO');
  const hunks = computeHunks(base, proposed);
  const acceptedIds =
    accepted === 'all'
      ? new Set(hunks.map((h) => h.id))
      : accepted === 'none'
        ? new Set<string>()
        : new Set([hunks[0]!.id]);
  return {
    path: 'src/a.ts',
    baseText: base,
    baseHash: contentHash(base),
    hunks,
    acceptedIds,
  };
}

describe('applier', () => {
  it('applies and verifies a change', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.status).toBe('applied');
    expect(result.files[0]?.verified).toBe(true);
    expect(result.files[0]?.hunksAccepted).toBe(1);
    expect(files['src/a.ts']?.disk).toContain('line TWO');
    expect(result.note).toContain('Verified against disk');
  });

  it('writes nothing when no hunk was accepted', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    const result = await applyChanges({ files: [request(BASE, 'none')] }, { bridge });
    expect(result.status).toBe('rejected');
    expect(files['src/a.ts']?.disk).toBe(BASE);
  });

  it('reports a conflict when the file changed after the proposal', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    // The user edits the file while the proposal waits.
    files['src/a.ts']!.buffer = 'line one\nchanged by the user\nline three\n';
    files['src/a.ts']!.disk = files['src/a.ts']!.buffer;
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.status).toBe('conflict');
    expect(result.files[0]?.verified).toBe(false);
    expect(result.files[0]?.hunksAccepted).toBe(0);
    expect(files['src/a.ts']?.disk).toContain('changed by the user');
    expect(result.note).toContain('changed');
  });

  it('rolls back when the disk does not match what was written', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files, { corruptDisk: true });
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.status).toBe('verification_failed');
    expect(result.files[0]?.verified).toBe(false);
    // Rolled back: the file is exactly as it was.
    expect(files['src/a.ts']?.buffer).toBe(BASE);
    expect(files['src/a.ts']?.disk).toBe(BASE);
    expect(result.note).toContain('restored');
  });

  it('rolls back when the write itself is corrupted', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    const result = await applyChanges({ files: [request()] }, { bridge, corruptNextWrite: true });
    expect(result.status).toBe('verification_failed');
    expect(files['src/a.ts']?.buffer).toBe(BASE);
  });

  it('never reports success for a file it did not verify', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files, { corruptDisk: true });
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.files.some((f) => f.verified)).toBe(false);
    expect(result.status).not.toBe('applied');
  });

  it('serializes applies per file through the lock', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    const order: string[] = [];
    const lock = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
      order.push(`start:${path}`);
      const out = await fn();
      order.push(`end:${path}`);
      return out;
    };
    await applyChanges({ files: [request()] }, { bridge, lock });
    expect(order).toEqual(['start:src/a.ts', 'end:src/a.ts']);
  });

  it('reports partial application truthfully', async () => {
    const files: Record<string, { buffer: string; disk: string }> = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    const multi = request();
    const bHunks = computeHunks(BASE, BASE.replace('line three', 'line THREE'));
    const second: ApplyFileRequest = {
      ...multi,
      path: 'src/b.ts',
      hunks: bHunks,
      acceptedIds: new Set(bHunks.map((h) => h.id)),
    };
    files['src/b.ts'] = { buffer: BASE, disk: BASE };
    const result = await applyChanges({ files: [multi, second] }, { bridge });
    expect(result.status).toBe('applied');
    expect(result.files.length).toBe(2);
  });

  it('restores the file when the write itself fails', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    bridge.writeText = async () => { throw new Error('the file was deleted'); };
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.status).toBe('verification_failed');
    expect(result.files[0]?.verified).toBe(false);
    expect(result.files[0]?.reason).toContain('restored');
  });

  it('says so loudly when the rollback also fails', async () => {
    const files = { 'src/a.ts': { buffer: BASE, disk: BASE } };
    const bridge = fakeBridge(files);
    bridge.writeText = async () => { throw new Error('boom'); };
    bridge.restore = async () => { throw new Error('cannot restore'); };
    const result = await applyChanges({ files: [request()] }, { bridge });
    expect(result.status).toBe('verification_failed');
    expect(result.files[0]?.reason).toContain('rollback FAILED');
  });

  it('reports a partial application when one file conflicts', async () => {
    const files: Record<string, { buffer: string; disk: string }> = {
      'src/a.ts': { buffer: BASE, disk: BASE },
      'src/b.ts': { buffer: BASE, disk: BASE },
    };
    const bridge = fakeBridge(files);
    const aHunks = computeHunks(BASE, BASE.replace('line two', 'line TWO'));
    const bHunks = computeHunks(BASE, BASE.replace('line three', 'line THREE'));
    const a: ApplyFileRequest = { path: 'src/a.ts', baseText: BASE, baseHash: contentHash(BASE), hunks: aHunks, acceptedIds: new Set(aHunks.map((h) => h.id)) };
    const b: ApplyFileRequest = { path: 'src/b.ts', baseText: BASE, baseHash: contentHash(BASE), hunks: bHunks, acceptedIds: new Set(bHunks.map((h) => h.id)) };
    // The second file changed after the proposal.
    files['src/b.ts']!.buffer = 'someone else was here\n';
    files['src/b.ts']!.disk = files['src/b.ts']!.buffer;
    const result = await applyChanges({ files: [a, b] }, { bridge });
    expect(result.status).toBe('partially_applied');
    expect(result.files[0]?.verified).toBe(true);
    expect(result.files[1]?.verified).toBe(false);
    expect(result.note).toContain('left alone');
  });

  it('keeps CRLF files in CRLF', async () => {    const crlf = 'line one\r\nline two\r\nline three\r\n';
    const files = { 'src/a.ts': { buffer: crlf, disk: crlf } };
    const bridge = fakeBridge(files);
    // Hunks are always computed on the LF-normalized text.
    const crlfLf = 'line one\nline two\nline three\n';
    const crlfHunks = computeHunks(crlfLf, crlfLf.replace('line two', 'line TWO'));
    const crlfRequest: ApplyFileRequest = {
      ...request(crlf),
      hunks: crlfHunks,
      acceptedIds: new Set(crlfHunks.map((h) => h.id)),
    };
    const result = await applyChanges({ files: [crlfRequest] }, { bridge });
    expect(result.status).toBe('applied');
    expect(files['src/a.ts']?.disk).toContain('line TWO\r\n');
    expect(files['src/a.ts']?.disk).not.toContain('\n\n');
  });
});
