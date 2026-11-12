/**
 * Change store (Phase 3.4).
 *
 * Every proposed change set is a state machine:
 *
 *   proposed → reviewPending → rejected
 *                           → accepted → applying → verified
 *                                                   → verificationFailed
 *                                                   → conflict
 *
 * Illegal transitions throw instead of silently corrupting the state, so a
 * bug can never make the UI claim something the disk does not have.
 */

import { createHash } from 'node:crypto';
import type { Hunk } from './hunks';

export type ChangeState =
  | 'proposed'
  | 'reviewPending'
  | 'rejected'
  | 'accepted'
  | 'applying'
  | 'verified'
  | 'verificationFailed'
  | 'conflict';

export interface FileChange {
  path: string;
  /** Hash of the base text (LF normalized) the proposal was computed against. */
  baseHash: string;
  hunks: Hunk[];
  /** Ids of the hunks the user accepted. */
  accepted: Set<string>;
}

export interface ChangeSet {
  id: string;
  state: ChangeState;
  /** Tool call that proposed this change set (correlation key). */
  toolCallId: string | undefined;
  /** Thread the approval decision must be sent to. */
  threadId: string | undefined;
  files: FileChange[];
  createdAt: number;
  /** Free-form note shown in the receipt. */
  note: string;
}

export interface ChangeEvent {
  type: 'created' | 'stateChanged' | 'decisionChanged' | 'updated';
  changeSet: ChangeSet;
  previousState?: ChangeState;
}

/** Allowed transitions. Anything else is a programming error. */
const TRANSITIONS: Record<ChangeState, readonly ChangeState[]> = {
  proposed: ['reviewPending', 'rejected'],
  reviewPending: ['accepted', 'rejected', 'conflict'],
  accepted: ['applying', 'conflict', 'reviewPending'],
  applying: ['verified', 'verificationFailed', 'conflict'],
  verified: [],
  verificationFailed: [],
  rejected: [],
  conflict: ['reviewPending', 'rejected'],
};

export function canTransition(from: ChangeState, to: ChangeState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class ChangeStore {
  private readonly sets = new Map<string, ChangeSet>();
  private readonly listeners = new Set<(event: ChangeEvent) => void>();

  onEvent(listener: (event: ChangeEvent) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  private emit(event: ChangeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken listener must never break the store.
      }
    }
  }

  /** Deterministic id for a proposal (same content → same id). */
  static idFor(toolCallId: string | undefined, files: readonly FileChange[]): string {
    const hash = createHash('sha256');
    hash.update(toolCallId ?? 'no-tool-call');
    for (const file of files) {
      hash.update(`|${file.path}:${file.baseHash}:${file.hunks.map((h) => h.id).join(',')}`);
    }
    return `c${hash.digest('hex').slice(0, 12)}`;
  }

  create(files: readonly FileChange[], toolCallId?: string, threadId?: string): ChangeSet {
    const id = ChangeStore.idFor(toolCallId, files);
    const existing = this.sets.get(id);
    if (existing) { return existing; }
    const changeSet: ChangeSet = {
      id,
      state: 'proposed',
      toolCallId,
      threadId,
      files: files.map((f) => ({ ...f, accepted: new Set(f.accepted) })),
      createdAt: Date.now(),
      note: '',
    };
    this.sets.set(id, changeSet);
    this.emit({ type: 'created', changeSet });
    return changeSet;
  }

  get(id: string): ChangeSet | undefined {
    return this.sets.get(id);
  }

  list(): ChangeSet[] {
    return [...this.sets.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Change sets waiting for the user (the Changes view shows these). */
  pending(): ChangeSet[] {
    return this.list().filter((s) => s.state === 'reviewPending');
  }

  /** Move to a new state; throws on an illegal transition. */
  transition(id: string, next: ChangeState): ChangeSet {
    const changeSet = this.require(id);
    const previous = changeSet.state;
    if (previous === next) { return changeSet; }
    if (!canTransition(previous, next)) {
      throw new Error(`illegal change transition: ${previous} → ${next} (change ${id})`);
    }
    changeSet.state = next;
    this.emit({ type: 'stateChanged', changeSet, previousState: previous });
    return changeSet;
  }

  /** Record which hunks the user accepted (all of them by default). */
  setAccepted(id: string, path: string, acceptedIds: ReadonlySet<string>): ChangeSet {
    const changeSet = this.require(id);
    const file = changeSet.files.find((f) => f.path === path);
    if (!file) { throw new Error(`unknown file in change set ${id}: ${path}`); }
    file.accepted = new Set(acceptedIds);
    this.emit({ type: 'decisionChanged', changeSet });
    return changeSet;
  }

  /** Accept every hunk of every file. */
  acceptAll(id: string): ChangeSet {
    const changeSet = this.require(id);
    for (const file of changeSet.files) {
      file.accepted = new Set(file.hunks.map((h) => h.id));
    }
    this.emit({ type: 'decisionChanged', changeSet });
    return changeSet;
  }

  /** Reject every hunk of every file. */
  rejectAll(id: string): ChangeSet {
    const changeSet = this.require(id);
    for (const file of changeSet.files) {
      file.accepted = new Set();
    }
    this.emit({ type: 'decisionChanged', changeSet });
    return changeSet;
  }

  setNote(id: string, note: string): ChangeSet {
    const changeSet = this.require(id);
    changeSet.note = note;
    this.emit({ type: 'updated', changeSet });
    return changeSet;
  }

  /** Forget a finished change set. */
  remove(id: string): void {
    this.sets.delete(id);
  }

  private require(id: string): ChangeSet {
    const changeSet = this.sets.get(id);
    if (!changeSet) { throw new Error(`unknown change set: ${id}`); }
    return changeSet;
  }
}
