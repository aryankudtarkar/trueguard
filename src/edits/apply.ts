/**
 * Applier and verifier (Phase 3.5, 3.6).
 *
 * This is the trust core of the product:
 *
 *  - the base hash is re-checked right before writing (conflict),
 *  - the write goes through ONE WorkspaceEdit (so VS Code undo works),
 *  - the result is verified against the buffer AND the disk,
 *  - a mismatch triggers an automatic rollback to the pre-edit snapshot,
 *  - the result the agent sees is truthful, or says nothing was applied.
 *
 * Everything is injected, so the whole pipeline is testable without VS Code.
 */

import { contentHash } from '../util/hash';
import { applyHunks, type Hunk } from './hunks';
import { materialize, toEditableText, type TextProfile } from './text';

export type ApplyStatus =
  | 'applied'
  | 'partially_applied'
  | 'rejected'
  | 'conflict'
  | 'verification_failed'
  | 'invalid';

export interface ApplyFileResult {
  path: string;
  hunksProposed: number;
  hunksAccepted: number;
  verified: boolean;
  newHash?: string;
  /** Why the file was not applied (when it was not). */
  reason?: string;
}

export interface ApplyResult {
  status: ApplyStatus;
  files: ApplyFileResult[];
  note: string;
}

/** What the applier needs from the editor. */
export interface EditorBridge {
  /** Current text of a file: the dirty buffer if open, otherwise the disk. */
  readText(path: string): Promise<string>;
  /** Replace the whole text of a file (buffer + save) as one undoable edit. */
  writeText(path: string, text: string): Promise<void>;
  /** Snapshot of the current text, used to roll back. */
  snapshot(path: string): Promise<string>;
  /** Restore a snapshot (used when verification fails). */
  restore(path: string, text: string): Promise<void>;
  /** Text on disk (ignoring the buffer). */
  readDisk(path: string): Promise<string>;
  /** Hash of the file's text with LF normalization. */
  hash(path: string): Promise<string>;
}

export interface ApplyFileRequest {
  path: string;
  /** The text the proposal was computed against (base). */
  baseText: string;
  /** Hash of the base text, re-checked before writing. */
  baseHash: string;
  hunks: Hunk[];
  acceptedIds: ReadonlySet<string>;
}

export interface ApplyRequest {
  files: readonly ApplyFileRequest[];
}

export interface ApplierOptions {
  bridge: EditorBridge;
  /** Serializes applies per path (a mutex); must return the callback's value. */
  lock?: <T>(path: string, fn: () => Promise<T>) => Promise<T>;
  /** Dev-only fault hook: corrupt the next write so the rollback path can be
   * demonstrated (PRD Phase 3.7). */
  corruptNextWrite?: boolean;
}

/**
 * Apply the accepted hunks of a change set.
 *
 * Returns a truthful result: `applied` only when every file was written and
 * verified against the disk.
 */
export async function applyChanges(request: ApplyRequest, options: ApplierOptions): Promise<ApplyResult> {
  const results: ApplyFileResult[] = [];
  let conflict = false;
  let verificationFailed = false;
  let appliedCount = 0;

  for (const file of request.files) {
    const outcome = await applyFile(file, options.corruptNextWrite === true, options);
    results.push(outcome.result);
    if (outcome.status === 'conflict') { conflict = true; }
    if (outcome.status === 'verification_failed') { verificationFailed = true; }
    if (outcome.status === 'applied') { appliedCount++; }
  }

  const anyAccepted = results.some((r) => r.hunksAccepted > 0);
  const proposed = results.reduce((sum, r) => sum + r.hunksProposed, 0);
  const accepted = results.reduce((sum, r) => sum + r.hunksAccepted, 0);
  let status: ApplyStatus;
  let note: string;

  if (verificationFailed && appliedCount > 0) {
    status = 'partially_applied';
    note = `Applied ${accepted} of ${proposed} changes. One file did not match what you approved, so it was restored.`;
  } else if (verificationFailed) {
    status = 'verification_failed';
    note = 'The file did not match what you approved, so it was restored. Nothing was lost.';
  } else if (conflict && appliedCount > 0) {
    status = 'partially_applied';
    note = `Applied ${accepted} of ${proposed} changes. One file changed after the proposal and was left alone.`;
  } else if (conflict) {
    status = 'conflict';
    note = 'A file changed after the agent proposed the edit. Nothing was written to it.';
  } else if (!anyAccepted) {
    status = 'rejected';
    note = 'No changes were accepted, so nothing was written.';
  } else if (appliedCount === results.length) {
    status = 'applied';
    note = `Applied ${accepted} of ${proposed} changes. Verified against disk.`;
  } else {
    status = 'partially_applied';
    note = `Applied ${accepted} of ${proposed} changes. Verified against disk.`;
  }

  return { status, files: results, note };
}

interface FileOutcome {
  result: ApplyFileResult;
  status: 'applied' | 'conflict' | 'verification_failed' | 'rejected';
}

/** Apply one file: conflict check, write, verify, roll back on mismatch. */
async function applyFile(
  file: ApplyFileRequest,
  corruptWrite: boolean,
  options: ApplierOptions,
): Promise<FileOutcome> {
  const { bridge } = options;
  const run = async (): Promise<FileOutcome> => {
    // 1. Conflict check: the file must still be what the proposal assumed.
    const currentHash = await bridge.hash(file.path);
    if (currentHash !== file.baseHash) {
      return {
        status: 'conflict',
        result: {
          path: file.path,
          hunksProposed: file.hunks.length,
          hunksAccepted: 0,
          verified: false,
          reason: 'the file changed after the proposal was made',
        },
      };
    }

    const accepted = file.hunks.filter((h) => file.acceptedIds.has(h.id));
    if (accepted.length === 0) {
      return {
        status: 'rejected',
        result: {
          path: file.path,
          hunksProposed: file.hunks.length,
          hunksAccepted: 0,
          verified: false,
          reason: 'no hunks were accepted for this file',
        },
      };
    }

    // 2. Build the new text from the CURRENT text (not the base): the base
    //    hash matched, so they are the same content.
    const current = await bridge.readText(file.path);
    const { profile } = toEditableText(current);
    const lf = toEditableText(current).text;
    const nextLf = applyHunks(lf, file.hunks, file.acceptedIds);
    const expected = materialize(nextLf, profile);

    // 3. Snapshot before writing, so a failure can be undone.
    const snapshot = await bridge.snapshot(file.path);

    // 4. Write (one WorkspaceEdit → one undo step).
    const toWrite = corruptWrite ? `${expected}<!-- corrupt -->` : expected;
    try {
      await bridge.writeText(file.path, toWrite);
    } catch (e) {
      // The write failed: restore the snapshot (best effort) and report it.
      const restored = await tryRestore(bridge, file.path, snapshot);
      return {
        status: 'verification_failed',
        result: {
          path: file.path,
          hunksProposed: file.hunks.length,
          hunksAccepted: 0,
          verified: false,
          reason: restored
            ? `the write failed (${message(e)}) and the file was restored`
            : `the write failed (${message(e)}) and the rollback FAILED — check the file`,
        },
      };
    }

    // 5. Verify: buffer first, then disk.
    const bufferText = await bridge.readText(file.path);
    const bufferOk = normalize(bufferText) === normalize(expected);
    let diskOk = false;
    if (bufferOk) {
      const diskText = await bridge.readDisk(file.path);
      diskOk = normalize(diskText) === normalize(expected);
    }

    if (bufferOk && diskOk) {
      return {
        status: 'applied',
        result: {
          path: file.path,
          hunksProposed: file.hunks.length,
          hunksAccepted: accepted.length,
          verified: true,
          newHash: contentHash(expected),
        },
      };
    }

    // 6. Verification failed: roll back and say so.
    const restored = await tryRestore(bridge, file.path, snapshot);
    return {
      status: 'verification_failed',
      result: {
        path: file.path,
        hunksProposed: file.hunks.length,
        hunksAccepted: 0,
        verified: false,
        reason: restored
          ? bufferOk
            ? 'the file on disk did not match; the file was restored'
            : 'the editor buffer did not match; the file was restored'
          : 'the file did not match AND the rollback failed — check the file',
      },
    };
  };

  if (options.lock) {
    return options.lock(file.path, run);
  }
  return run();
}

/** Normalization used when comparing texts: EOL-agnostic, BOM-agnostic. */
function normalize(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Restore a snapshot; returns false when the rollback itself failed. */
async function tryRestore(bridge: EditorBridge, path: string, snapshot: string): Promise<boolean> {
  try {
    await bridge.restore(path, snapshot);
    return true;
  } catch {
    return false;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The profile of a file's current text (used by callers that pre-compute). */
export function profileOf(text: string): TextProfile {
  return toEditableText(text).profile;
}
