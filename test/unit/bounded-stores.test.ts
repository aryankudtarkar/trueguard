import { describe, expect, it } from 'vitest';
import { CheckpointStore } from '../../src/edits/checkpoints';
import { SessionLog } from '../../src/util/sessionLog';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The stores must not fill the disk: the chat history, the session log and
 * the checkpoints are all bounded.
 */

describe('bounded stores', () => {
  it('the checkpoint store keeps at most MAX_CHECKPOINTS', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'trueguard-cp-'));
    const store = new CheckpointStore(dir);
    for (let i = 0; i < CheckpointStore.MAX_CHECKPOINTS + 5; i++) {
      store.create(`cs${i}`, [], `note ${i}`);
    }
    // The prune runs in the background: give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(store.list().length).toBeLessThanOrEqual(CheckpointStore.MAX_CHECKPOINTS);
    await rm(dir, { recursive: true, force: true });
  });

  it('the session log keeps at most MAX_SESSIONS files', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'trueguard-log-'));
    const log = new SessionLog(dir);
    for (let i = 0; i < SessionLog.MAX_SESSIONS + 3; i++) {
      await log.append(`session-${i}`, 'turn.created', { i });
    }
    await new Promise((r) => setTimeout(r, 50));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    expect(files.length).toBeLessThanOrEqual(SessionLog.MAX_SESSIONS);
    await rm(dir, { recursive: true, force: true });
  });
});
