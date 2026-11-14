import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { contentHash } from '../util/hash';

/**
 * Checkpoints (FR-10).
 *
 * Every applied change set stores a snapshot of the files it touched, so the
 * change can be undone later — even after the editor was closed, and even
 * when the user wants to revert a change from ten minutes ago.
 *
 * A checkpoint remembers the text before and after the change. Reverting is
 * refused (or confirmed) when the file has diverged since: the user's own
 * work must never be silently overwritten.
 */

export interface CheckpointFile {
  /** Absolute path of the file. */
  path: string;
  /** The text before the change. */
  before: string;
  /** The text after the change. */
  after: string;
  /** Hash of the text before the change. */
  hashBefore: string;
  /** Hash of the text after the change. */
  hashAfter: string;
}

export interface Checkpoint {
  id: string;
  /** The change set this checkpoint came from. */
  changeSetId: string;
  createdAt: number;
  files: CheckpointFile[];
  /** A short description, e.g. "Applied 2 of 3 changes". */
  note: string;
}

export function checkpointId(changeSetId: string, createdAt: number): string {
  return `cp${createdAt.toString(36)}${changeSetId.replace(/\W/g, '').slice(-6)}`;
}

export class CheckpointStore {
  private readonly checkpoints = new Map<string, Checkpoint>();
  /** Insertion order, so two checkpoints in the same millisecond still sort. */
  private sequence = 0;
  private readonly order = new Map<string, number>();

  constructor(private readonly directory?: string) {}

  /** Record a checkpoint. */
  create(changeSetId: string, files: CheckpointFile[], note: string): Checkpoint {
    const createdAt = Date.now();
    const checkpoint: Checkpoint = {
      id: checkpointId(changeSetId, createdAt),
      changeSetId,
      createdAt,
      files,
      note,
    };
    this.checkpoints.set(checkpoint.id, checkpoint);
    this.order.set(checkpoint.id, this.sequence++);
    void this.persist(checkpoint);
    return checkpoint;
  }

  get(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  /** The checkpoints, newest first. */
  list(): Checkpoint[] {
    return [...this.checkpoints.values()].sort(
      (a, b) => b.createdAt - a.createdAt || (this.order.get(b.id) ?? 0) - (this.order.get(a.id) ?? 0),
    );
  }

  /** The most recent checkpoint. */
  latest(): Checkpoint | undefined {
    return this.list()[0];
  }

  /** The checkpoint of a change set. */
  forChangeSet(changeSetId: string): Checkpoint | undefined {
    return this.list().find((c) => c.changeSetId === changeSetId);
  }

  /** Write the checkpoint to the extension's storage. */
  private async persist(checkpoint: Checkpoint): Promise<void> {
    if (!this.directory) { return; }
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(
        path.join(this.directory, `${checkpoint.id}.json`),
        JSON.stringify(checkpoint),
        'utf8',
      );
    } catch {
      // A checkpoint that cannot be written never breaks an apply.
    }
  }

  /** Load the checkpoints from the extension's storage. */
  async load(): Promise<void> {
    if (!this.directory) { return; }
    try {
      const files = await fs.readdir(this.directory);
      for (const file of files) {
        if (!file.endsWith('.json')) { continue; }
        const raw = await fs.readFile(path.join(this.directory, file), 'utf8');
        const parsed = JSON.parse(raw) as Checkpoint;
        if (parsed?.id) {
          this.checkpoints.set(parsed.id, parsed);
          this.order.set(parsed.id, this.sequence++);
        }
      }
    } catch {
      // No checkpoints yet: that is not an error.
    }
  }
}

/** Has the file changed since the checkpoint was taken? */
export function hasDiverged(file: CheckpointFile, currentText: string): boolean {
  return contentHash(currentText) !== file.hashAfter;
}

/** The hash of a text, the way the checkpoints store it. */
export function hashOf(text: string): string {
  return contentHash(text);
}
