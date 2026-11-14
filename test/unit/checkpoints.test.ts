import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CheckpointStore, hasDiverged, hashOf } from '../../src/edits/checkpoints';

/**
 * Checkpoints and Revert (FR-10).
 *
 * A checkpoint remembers the text before and after a change, so the change
 * can be undone later. A file that changed since is never overwritten
 * silently.
 */

describe('the checkpoint store', () => {
  it('records a checkpoint with the before and after text', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'trueguard-cp-'));
    const store = new CheckpointStore(dir);
    const checkpoint = store.create('cs1', [
      {
        path: '/ws/a.ts',
        before: 'one\n',
        after: 'two\n',
        hashBefore: hashOf('one\n'),
        hashAfter: hashOf('two\n'),
      },
    ], 'Applied 1 of 1 changes');
    expect(checkpoint.id).toBeTruthy();
    expect(store.get(checkpoint.id)?.files.length).toBe(1);
    expect(store.forChangeSet('cs1')?.id).toBe(checkpoint.id);
    await rm(dir, { recursive: true, force: true });
  });

  it('survives a reload', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'trueguard-cp-'));
    const store = new CheckpointStore(dir);
    const checkpoint = store.create('cs1', [
      {
        path: '/ws/a.ts',
        before: 'one\n',
        after: 'two\n',
        hashBefore: hashOf('one\n'),
        hashAfter: hashOf('two\n'),
      },
    ], 'note');
    // Give the write a moment, then load into a fresh store.
    await new Promise((r) => setTimeout(r, 50));
    const reloaded = new CheckpointStore(dir);
    await reloaded.load();
    expect(reloaded.get(checkpoint.id)?.files[0]?.before).toBe('one\n');
    await rm(dir, { recursive: true, force: true });
  });

  it('lists the newest checkpoint first', () => {
    const store = new CheckpointStore();
    const first = store.create('cs1', [], 'first');
    const second = store.create('cs2', [], 'second');
    expect(store.latest()?.id).toBe(second.id);
    expect(store.list().length).toBe(2);
    expect(first.id).not.toBe(second.id);
  });

  it('detects a file that changed since the checkpoint', () => {
    const file = {
      path: '/ws/a.ts',
      before: 'one\n',
      after: 'two\n',
      hashBefore: hashOf('one\n'),
      hashAfter: hashOf('two\n'),
    };
    expect(hasDiverged(file, 'two\n')).toBe(false);
    expect(hasDiverged(file, 'the user typed something\n')).toBe(true);
  });

  it('works without a directory (in memory only)', () => {
    const store = new CheckpointStore();
    const checkpoint = store.create('cs1', [], 'note');
    expect(store.get(checkpoint.id)).toBeDefined();
  });
});
