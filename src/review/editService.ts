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
  kind: 'pending' | 'applied' | 'rejected' | 'conflict' | 'failed';
  changeSetId: string;
  summary: string;
}

export class EditService implements vscode.Disposable {
  private readonly log = logger();
  private readonly changes: ChangeStore;
  private readonly decisions: DecisionStore;
  private readonly locks = new MutexMap();
  private readonly updateEmitter = new vscode.EventEmitter<ReviewUpdate>();
  readonly onUpdate = this.updateEmitter.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(
    private readonly sessions: SessionManager,
    private readonly bridge: EditorBridge,
    private readonly proposalContext: ProposalContext,
    changes: ChangeStore,
    decisions: DecisionStore,
    private readonly decisionWaitMs: number = TOOL_DECISION_WAIT_MS,
  ) {
    this.changes = changes;
    this.decisions = decisions;
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
      if (call.name !== 'propose_edit') { continue; } // other tools are approved by TrueForge itself

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
      this.updateEmitter.fire({
        kind: 'pending',
        changeSetId: changeSet.id,
        summary: `Review ${proposal.files.length} change(s). Nothing is written until you apply.`,
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

    const result = await applyChanges(
      { files: requests },
      {
        bridge: this.bridge,
        lock: (path, fn) => this.locks.run(path, fn),
      },
    );

    if (result.status === 'applied' || result.status === 'partially_applied') {
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
