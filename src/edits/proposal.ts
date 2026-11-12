/**
 * Proposal builder (FR-4 input side).
 *
 * Turns the agent's `changes` array into a reviewable set of hunks:
 *
 *  - modify: exact-match edits only; every oldText must match exactly once
 *  - create: only for paths that do not exist
 *  - delete: only for paths that exist
 *  - a whole-file rewrite of an existing file is refused
 *  - the expected base hash is checked when the agent provides one
 *
 * Anything invalid comes back as a structured error, before any UI appears.
 */

import { contentHash } from '../util/hash';
import { computeHunks, hunkId, type Hunk } from './hunks';
import { applyProposedEdits, matchEdits, type ProposedEdit } from './matcher';
import { toEditableText } from './text';

export type ChangeKind = 'modify' | 'create' | 'delete';

export interface ProposedChange {
  path: string;
  kind: ChangeKind;
  edits?: ProposedEdit[];
  /** New file content (create) — required for create. */
  content?: string;
  /** Hash the agent believed the file had (optional). */
  expectedBaseHash?: string;
}

export interface ProposalError {
  code:
    | 'no_match'
    | 'multiple_matches'
    | 'overlapping_edits'
    | 'empty_old_text'
    | 'whole_file_rewrite'
    | 'already_exists'
    | 'does_not_exist'
    | 'missing_content'
    | 'base_hash_mismatch'
    | 'invalid';
  path: string;
  message: string;
  editIndex?: number;
  candidates?: Array<{ line: number; text: string }>;
}

export interface ProposalFile {
  path: string;
  kind: ChangeKind;
  /** Hash of the base text the hunks were computed against. */
  baseHash: string;
  hunks: Hunk[];
  /** The text the proposal would produce if everything is accepted. */
  proposedText: string;
  /** For create: the content of the new file. */
  content?: string;
}

export interface ProposalResult {
  ok: boolean;
  files: ProposalFile[];
  errors: ProposalError[];
}

/** What the builder needs to know about the workspace. */
export interface ProposalContext {
  /** Current text of a file, or undefined when it does not exist. */
  readFile(path: string): Promise<string | undefined>;
  /** Whether the path exists at all (create vs modify). */
  exists(path: string): Promise<boolean>;
}

export async function buildProposal(
  changes: readonly ProposedChange[],
  ctx: ProposalContext,
): Promise<ProposalResult> {
  const files: ProposalFile[] = [];
  const errors: ProposalError[] = [];

  for (const change of changes) {
    const exists = await ctx.exists(change.path);
    const current = exists ? await ctx.readFile(change.path) : undefined;

    if (change.kind === 'create') {
      if (exists) {
        errors.push({
          code: 'already_exists',
          path: change.path,
          message: `${change.path} already exists. Use kind "modify" to change it.`,
        });
        continue;
      }
      if (typeof change.content !== 'string') {
        errors.push({
          code: 'missing_content',
          path: change.path,
          message: `content is required for a new file (${change.path}).`,
        });
        continue;
      }
      const proposed = toEditableText(change.content).text;
      files.push({
        path: change.path,
        kind: 'create',
        baseHash: '',
        hunks: [
          {
            id: hunkId(1, [], proposed.split('\n')),
            oldStart: 1,
            oldLines: 0,
            newLines: proposed.split('\n'),
          },
        ],
        proposedText: proposed,
        content: change.content,
      });
      continue;
    }

    if (change.kind === 'delete') {
      if (!exists || current === undefined) {
        errors.push({
          code: 'does_not_exist',
          path: change.path,
          message: `${change.path} does not exist, so it cannot be deleted.`,
        });
        continue;
      }
      const { text } = toEditableText(current);
      files.push({
        path: change.path,
        kind: 'delete',
        baseHash: contentHash(text),
        hunks: computeHunks(text, ''),
        proposedText: '',
      });
      continue;
    }

    // kind === 'modify'
    if (!exists || current === undefined) {
      errors.push({
        code: 'does_not_exist',
        path: change.path,
        message: `${change.path} does not exist. Use kind "create" for a new file.`,
      });
      continue;
    }
    const { text: baseText } = toEditableText(current);
    const baseHash = contentHash(baseText);

    if (change.expectedBaseHash && change.expectedBaseHash !== baseHash) {
      errors.push({
        code: 'base_hash_mismatch',
        path: change.path,
        message:
          `${change.path} changed since you read it (expected hash ${change.expectedBaseHash.slice(0, 12)}, ` +
          `found ${baseHash.slice(0, 12)}). Read it again and propose the edit.`,
      });
      continue;
    }

    const edits = change.edits ?? [];
    if (edits.length === 0) {
      errors.push({
        code: 'invalid',
        path: change.path,
        message: `no edits given for ${change.path}.`,
      });
      continue;
    }

    // A whole-file replacement is refused: it hides the real change.
    const wholeFile = edits.some(
      (e) => e.oldText !== '' && toEditableText(e.oldText).text.trim() === baseText.trim() && baseText.trim() !== '',
    );
    if (wholeFile) {
      errors.push({
        code: 'whole_file_rewrite',
        path: change.path,
        message:
          `${change.path} would be rewritten in full. Propose the exact lines to change instead, ` +
          'so the user can review them.',
      });
      continue;
    }

    const matched = matchEdits(baseText, edits);
    if (!matched.ok) {
      for (const error of matched.errors) {
        errors.push({
          code: error.code,
          path: change.path,
          message: error.message,
          ...(error.editIndex !== undefined ? { editIndex: error.editIndex } : {}),
          ...(error.candidates ? { candidates: error.candidates } : {}),
        });
      }
      continue;
    }

    const proposedText = applyProposedEdits(baseText, matched.matches, edits);
    files.push({
      path: change.path,
      kind: 'modify',
      baseHash,
      hunks: computeHunks(baseText, proposedText),
      proposedText,
    });
  }

  return { ok: errors.length === 0, files, errors };
}
