import * as vscode from 'vscode';
import { z } from 'zod';
import { applyChanges, type ApplyResult, type EditorBridge } from '../edits/apply';
import { buildProposal, type ProposalContext } from '../edits/proposal';
import { ChangeStore } from '../edits/store';
import { MutexMap } from '../util/mutex';
import { logger, redact } from '../util/logger';
import type { SessionManager } from '../trueforge/sessionManager';
import type { ToolApprovalRequiredEvent } from '../trueforge/schemas';
import { DecisionStore, type ApprovalDecision } from './decisionStore';
import { findRiskyPatterns } from '../exec/risky';
import { CheckpointStore, hasDiverged, hashOf, type CheckpointFile } from '../edits/checkpoints';
import { runCommandSchema } from '../mcp/commandTool';

/**
 * How long the MCP handler waits for the user's decision when the tool call
 * arrives before the click. A tool call without a review writes nothing, so
 * the wait is short: the normal flow already has the decision.
 */
export const TOOL_DECISION_WAIT_MS = 5_000;

/**
 * Edit service (Phase 4.2, 4.3).
 *
 * Coordinates the approval gate:
 *
 *  1. TrueForge pauses the turn and emits `tool.approval_required`.
 *  2. The service builds the review from the LIVE file state and parks it in
 *     the Changes view.
 *  3. The user accepts or rejects hunks.
 *  4. The decision travels to TrueForge as an approval turn; TrueForge then
 *     calls the propose_edit MCP tool.
 *  5. The MCP handler asks this service for the decision and applies exactly
 *     the accepted hunks — then verifies.
 */

export const proposeEditSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        kind: z.enum(['modify', 'create', 'delete']),
        edits: z
          .array(z.object({ oldText: z.string(), newText: z.string() }))
          .optional(),
        content: z.string().optional(),
        expectedBaseHash: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export type ProposeEditInput = z.infer<typeof proposeEditSchema>;

export interface ReviewUpdate {
  kind: 'pending' | 'applied' | 'rejected' | 'conflict' | 'failed' | 'command' | 'reverted';
  changeSetId: string;
  summary: string;
  /** For command reviews: the exact command and its risky patterns. */
  command?: { toolCallId: string; command: string; cwd: string; risky: string[] };
}

/** A command waiting for the user's approval. */
export interface PendingCommand {
  toolCallId: string;
  threadId: string;
  command: string;
  cwd: string;
  timeoutSec: number | undefined;
  risky: string[];
}

export class EditService implements vscode.Disposable {
  private readonly log = logger();
  private readonly changes: ChangeStore;
  private readonly decisions: DecisionStore;
  private readonly locks = new MutexMap();
  private readonly updateEmitter = new vscode.EventEmitter<ReviewUpdate>();
  readonly onUpdate = this.updateEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Commands waiting for the user's approval, by tool call id. */
  private readonly pendingCommands = new Map<string, PendingCommand>();
  /** The checkpoints that make a change set revertible (FR-10). */
  private readonly checkpoints: CheckpointStore;
  /** Change set id → checkpoint id. */
  private readonly checkpointByChangeSet = new Map<string, string>();

  constructor(
    private readonly sessions: SessionManager,
    private readonly bridge: EditorBridge,
    private readonly proposalContext: ProposalContext,
    changes: ChangeStore,
    decisions: DecisionStore,
    private readonly decisionWaitMs: number = TOOL_DECISION_WAIT_MS,
    checkpoints?: CheckpointStore,
  ) {
    this.changes = changes;
    this.decisions = decisions;
    this.checkpoints = checkpoints ?? new CheckpointStore();
    this.subscriptions.push(
      this.changes.onEvent((event) => {
        this.updateEmitter.fire({
          kind: 'pending',
          changeSetId: event.changeSet.id,
          summary: event.changeSet.note,
        });
      }),
      this.sessions.onApprovalRequired((event) => {
        void this.handleApprovalRequired(event);
      }),
    );
  }

  /** The change store (the tree view reads it). */
  get changeStore(): ChangeStore {
    return this.changes;
  }

  /** The decision store (the MCP handler reads it). */
  get decisionStore(): DecisionStore {
    return this.decisions;
  }

  /** The checkpoint store (FR-10). */
  get checkpointStore(): CheckpointStore {
    return this.checkpoints;
  }

  /**
   * A tool call is waiting for approval: build the review from the live file
   * state and park it for the user.
   */
  async handleApprovalRequired(event: ToolApprovalRequiredEvent): Promise<void> {
    for (const ref of event.tool_calls) {
      const call = this.sessions.getToolCall(ref.id);
      if (!call) {
        this.log.warn(`approval for an unknown tool call: ${ref.id}`);
        continue;
      }
      if (call.name !== 'propose_edit' && call.name !== 'run_command') {
        continue; // other tools are approved by TrueForge itself
      }

      if (call.name === 'run_command') {
        await this.handleCommandApproval(event.thread_id, ref.id, call.arguments);
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(call.arguments || '{}');
      } catch {
        await this.denyWithReason(event.thread_id, ref.id, 'The edit request was not valid JSON.');
        continue;
      }
      const input = proposeEditSchema.safeParse(parsed);
      if (!input.success) {
        await this.denyWithReason(
          event.thread_id,
          ref.id,
          `The edit request was invalid: ${input.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
        continue;
      }

      const proposal = await buildProposal(input.data.changes, this.proposalContext);
      if (!proposal.ok) {
        // Invalid edits never reach the user: the agent gets the reason.
        await this.denyWithReason(event.thread_id, ref.id, describeProposalErrors(proposal.errors));
        continue;
      }

      const changeSet = this.changes.create(
        proposal.files.map((f) => ({
          path: f.path,
          baseHash: f.baseHash,
          hunks: f.hunks,
          accepted: new Set<string>(),
        })),
        ref.id,
        event.thread_id,
      );
      this.changes.acceptAll(changeSet.id);
      this.changes.transition(changeSet.id, 'reviewPending');
      this.log.info(`review ready: ${changeSet.id} (${proposal.files.length} file(s))`);
      const hunkCount = proposal.files.reduce((sum, f) => sum + f.hunks.length, 0);
      this.updateEmitter.fire({
        kind: 'pending',
        changeSetId: changeSet.id,
        summary: `Review ${hunkCount} change${hunkCount === 1 ? '' : 's'}. Nothing is written until you apply.`,
      });
    }
  }

  /** The user accepted the current selection: send the approval and remember it. */
  async applyChangeSet(changeSetId: string): Promise<void> {
    const changeSet = this.changes.get(changeSetId);
    if (!changeSet) { return; }
    if (!changeSet.toolCallId || !changeSet.threadId) {
      this.log.warn('cannot apply a change set without a tool call id');
      return;
    }
    const decision: ApprovalDecision = {
      toolCallId: changeSet.toolCallId,
      changeSetId,
      status: 'allow',
      hunks: changeSet.files.map((f) => ({ path: f.path, accepted: [...f.accepted] })),
    };
    this.decisions.set(decision);
    this.changes.transition(changeSetId, 'accepted');
    await this.sessions.sendApproval(changeSet.threadId, changeSet.toolCallId, 'allow');
    this.updateEmitter.fire({
      kind: 'pending',
      changeSetId,
      summary: 'Applying the changes you accepted.',
    });
  }

  /** The user rejected: deny the tool call with a reason. */
  async rejectChangeSet(changeSetId: string, reason = 'The user rejected this change.'): Promise<void> {
    const changeSet = this.changes.get(changeSetId);
    if (!changeSet) { return; }
    if (changeSet.toolCallId && changeSet.threadId) {
      await this.sessions.sendApproval(changeSet.threadId, changeSet.toolCallId, 'deny', reason);
    }
    this.changes.transition(changeSetId, 'rejected');
    this.updateEmitter.fire({ kind: 'rejected', changeSetId, summary: reason });
  }

  /** Deny everything that is still waiting (the user stopped the turn). */
  async denyAllPending(reason = 'The turn was stopped.'): Promise<void> {
    for (const command of [...this.pendingCommands.values()]) {
      this.pendingCommands.delete(command.toolCallId);
      await this.sessions.sendApproval(command.threadId, command.toolCallId, 'deny', reason);
    }
    const pending = this.changes.pending();
    for (const changeSet of pending) {
      if (changeSet.toolCallId && changeSet.threadId) {
        await this.sessions.sendApproval(changeSet.threadId, changeSet.toolCallId, 'deny', reason);
      }
      this.changes.transition(changeSet.id, 'rejected');
    }
    this.decisions.denyAll(
      pending.map((c) => c.toolCallId).filter((id): id is string => Boolean(id)),
      reason,
    );
    this.updateEmitter.fire({ kind: 'rejected', changeSetId: '', summary: reason });
  }

  /**
   * The MCP handler side: apply the accepted hunks of the decision and
   * return the truthful result.
   */
  async applyApproved(requestId?: string | number): Promise<ApplyResult> {
    const decision = await this.takeDecision(requestId);
    if (!decision) {
      return {
        status: 'rejected',
        files: [],
        note: 'No approval was recorded for this edit, so nothing was written.',
      };
    }
    if (decision.status === 'deny') {
      return {
        status: 'rejected',
        files: [],
        note: decision.reason ?? 'The user rejected this change.',
      };
    }
    const changeSet = this.changes.get(decision.changeSetId);
    if (!changeSet) {
      return { status: 'invalid', files: [], note: 'The review for this edit is no longer available.' };
    }

    this.changes.transition(changeSet.id, 'applying');
    const requests = changeSet.files.map((file) => {
      const accepted = decision.hunks.find((h) => h.path === file.path)?.accepted ?? [];
      return {
        path: file.path,
        baseText: '',
        baseHash: file.baseHash,
        hunks: file.hunks,
        acceptedIds: new Set(accepted),
      };
    });

    // The snapshot of what is on disk right now: the checkpoint that makes
    // the change revertible (FR-10).
    const before = new Map<string, string>();
    for (const file of changeSet.files) {
      before.set(file.path, await this.bridge.readText(file.path));
    }

    const result = await applyChanges(
      { files: requests },
      {
        bridge: this.bridge,
        lock: (path, fn) => this.locks.run(path, fn),
      },
    );

    if (result.status === 'applied' || result.status === 'partially_applied') {
      // Only the files that actually changed get a checkpoint.
      const files: CheckpointFile[] = [];
      for (const file of changeSet.files) {
        const after = await this.bridge.readText(file.path);
        const was = before.get(file.path) ?? '';
        if (hashOf(after) === hashOf(was)) { continue; }
        files.push({
          path: file.path,
          before: was,
          after,
          hashBefore: hashOf(was),
          hashAfter: hashOf(after),
        });
      }
      if (files.length) {
        const checkpoint = this.checkpoints.create(changeSet.id, files, result.note);
        this.checkpointByChangeSet.set(changeSet.id, checkpoint.id);
      }
      this.changes.transition(changeSet.id, 'verified');
    } else if (result.status === 'conflict') {
      this.changes.transition(changeSet.id, 'conflict');
    } else if (result.status === 'verification_failed') {
      this.changes.transition(changeSet.id, 'verificationFailed');
    } else {
      this.changes.transition(changeSet.id, 'rejected');
    }
    this.changes.setNote(changeSet.id, result.note);
    this.updateEmitter.fire({
      kind: result.status === 'conflict' ? 'conflict' : result.status === 'verification_failed' ? 'failed' : 'applied',
      changeSetId: changeSet.id,
      summary: result.note,
    });
    return result;
  }

  /**
   * A command is waiting for approval: show the verbatim command (and any
   * risky pattern) to the user. Nothing runs until they allow it.
   */
  private async handleCommandApproval(threadId: string, toolCallId: string, argsJson: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson || '{}');
    } catch {
      await this.denyWithReason(threadId, toolCallId, 'The command request was not valid JSON.');
      return;
    }
    const input = runCommandSchema.safeParse(parsed);
    if (!input.success) {
      await this.denyWithReason(
        threadId,
        toolCallId,
        `The command request was invalid: ${input.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      );
      return;
    }
    const risky = findRiskyPatterns(input.data.command).map((r) => r.label);
    const pending: PendingCommand = {
      toolCallId,
      threadId,
      command: input.data.command,
      cwd: input.data.cwd ?? '',
      timeoutSec: input.data.timeoutSec,
      risky,
    };
    this.pendingCommands.set(toolCallId, pending);
    this.log.info(`command waiting for approval: ${input.data.command}`);
    this.updateEmitter.fire({
      kind: 'command',
      changeSetId: toolCallId,
      summary: input.data.command,
      command: { toolCallId, command: input.data.command, cwd: pending.cwd, risky },
    });
  }

  /** The user allowed the command: let TrueForge run it. */
  async approveCommand(toolCallId: string): Promise<void> {
    const pending = this.pendingCommands.get(toolCallId);
    if (!pending) { return; }
    this.pendingCommands.delete(toolCallId);
    this.decisions.set({
      toolCallId,
      changeSetId: '',
      status: 'allow',
      hunks: [],
      command: { command: pending.command, cwd: pending.cwd, timeoutSec: pending.timeoutSec },
    });
    await this.sessions.sendApproval(pending.threadId, toolCallId, 'allow');
    this.updateEmitter.fire({
      kind: 'command',
      changeSetId: toolCallId,
      summary: pending.command,
      command: { toolCallId, command: pending.command, cwd: pending.cwd, risky: pending.risky },
    });
  }

  /** The user denied the command. */
  async denyCommand(toolCallId: string, reason = 'The user rejected this command.'): Promise<void> {
    const pending = this.pendingCommands.get(toolCallId);
    if (!pending) { return; }
    this.pendingCommands.delete(toolCallId);
    await this.sessions.sendApproval(pending.threadId, toolCallId, 'deny', reason);
    this.updateEmitter.fire({
      kind: 'rejected',
      changeSetId: toolCallId,
      summary: reason,
    });
  }

  /**
   * The MCP handler side: the approved command, or undefined when the user
   * did not approve it (then nothing runs).
   */
  takeCommandApproval(): { command: string; cwd: string; timeoutSec?: number } | undefined {
    const decision = this.decisions.takeOldestWhere((d) => Boolean(d.command));
    if (!decision || decision.status !== 'allow' || !decision.command) { return undefined; }
    return decision.command;
  }

  /** Commands waiting for approval (the chat renders them as cards). */
  getPendingCommands(): PendingCommand[] {
    return [...this.pendingCommands.values()];
  }

  /**
   * Revert a change set (FR-10): restore the files to the text they had
   * before the change.
   *
   * When a file has diverged since the change (the user edited it), the
   * revert needs a confirmation: their own work must not be lost silently.
   */
  async revertChangeSet(changeSetId: string): Promise<{ reverted: boolean; note: string }> {
    const checkpoint = this.checkpointByChangeSet.get(changeSetId)
      ? this.checkpoints.get(this.checkpointByChangeSet.get(changeSetId)!)
      : this.checkpoints.forChangeSet(changeSetId);
    if (!checkpoint) {
      return { reverted: false, note: 'There is nothing to revert for this change.' };
    }
    return this.revertCheckpoint(checkpoint.id);
  }

  /** Revert a checkpoint. */
  async revertCheckpoint(checkpointId: string): Promise<{ reverted: boolean; note: string }> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return { reverted: false, note: 'That change is no longer available to revert.' };
    }

    // Divergence check: a file the user changed since is never overwritten
    // without a confirmation.
    const diverged: string[] = [];
    for (const file of checkpoint.files) {
      const current = await this.bridge.readText(file.path);
      if (hasDiverged(file, current)) { diverged.push(file.path); }
    }
    if (diverged.length) {
      const choice = await vscode.window.showWarningMessage(
        diverged.length === 1
          ? `${diverged[0]} changed after the change was applied. Revert anyway? Your newer edits will be replaced.`
          : `${diverged.length} files changed after the change was applied. Revert anyway? Your newer edits will be replaced.`,
        { modal: true },
        'Revert anyway',
      );
      if (choice !== 'Revert anyway') {
        return { reverted: false, note: 'The revert was cancelled: the files changed since the change was applied.' };
      }
    }

    const reverted: string[] = [];
    for (const file of checkpoint.files) {
      await this.bridge.writeText(file.path, file.before);
      const after = await this.bridge.readText(file.path);
      if (hashOf(after) !== hashOf(file.before)) {
        return {
          reverted: false,
          note: `The revert of ${file.path} could not be verified. The file may differ from the snapshot.`,
        };
      }
      reverted.push(file.path);
    }
    const note = `Reverted ${reverted.length} file${reverted.length === 1 ? '' : 's'}. The files are back to the text before the change.`;
    this.updateEmitter.fire({ kind: 'reverted', changeSetId: checkpoint.changeSetId, summary: note });
    return { reverted: true, note };
  }

  /** The checkpoint of a change set (for the receipt card). */
  checkpointFor(changeSetId: string): string | undefined {
    return this.checkpointByChangeSet.get(changeSetId) ?? this.checkpoints.forChangeSet(changeSetId)?.id;
  }

  /**
   * Find the decision for this tool call: by request id when the server sends
   * one, otherwise the oldest waiting decision. When neither is available the
   * handler waits briefly for the user (the tool call can arrive before the
   * click) and then gives up: a tool call without a review writes nothing.
   */
  private async takeDecision(requestId?: string | number): Promise<ApprovalDecision | undefined> {
    const id = requestId !== undefined ? String(requestId) : undefined;
    if (id) {
      const exact = this.decisions.take(id);
      if (exact) { return exact; }
    }
    const oldest = this.decisions.takeOldest();
    if (oldest) { return oldest; }
    // The tool call arrived before the user decided: wait a little.
    return this.decisions.waitForAny(this.decisionWaitMs);
  }

  private async denyWithReason(threadId: string, toolCallId: string, reason: string): Promise<void> {
    this.log.info(`denying an invalid edit: ${reason}`);
    await this.sessions.sendApproval(threadId, toolCallId, 'deny', reason);
    this.updateEmitter.fire({ kind: 'rejected', changeSetId: '', summary: reason });
  }

  dispose(): void {
    for (const s of this.subscriptions) { s.dispose(); }
    this.updateEmitter.dispose();
  }
}

/** One-line summary of the proposal errors, for the agent. */
export function describeProposalErrors(errors: ReadonlyArray<{ path: string; message: string }>): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join(' ');
}

/** Log-safe rendering of an apply result (no file contents). */
export function summarizeResult(result: ApplyResult): string {
  return redact(
    result.files.map((f) => `${f.path}: ${f.hunksAccepted}/${f.hunksProposed}${f.verified ? ' verified' : ''}`).join(', '),
  );
}
