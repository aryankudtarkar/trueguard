/**
 * Decision store (Phase 4.3).
 *
 * TrueForge pauses a turn at the approval gate and the decision is sent as a
 * NEW turn with a `user.tool_approval` input item, keyed by `tool_call_id`
 * (verified in docs/TRUEFORGE_NOTES.md and the Phase 0 transcripts).
 *
 * This store holds the user's decision — including WHICH HUNKS were accepted
 * — until the MCP handler for that tool call consumes it.
 *
 * The MCP request id is not guaranteed to be the tool_call_id, so decisions
 * are also reachable as "the oldest waiting decision" and as "the next
 * decision, whichever arrives": only one propose_edit can be waiting at a
 * time, because TrueForge ends the turn at the gate.
 */

export interface HunkDecision {
  /** Path of the file. */
  path: string;
  /** Ids of the hunks the user accepted. */
  accepted: string[];
}

export interface ApprovalDecision {
  toolCallId: string;
  /** The change set this decision belongs to. */
  changeSetId: string;
  status: 'allow' | 'deny';
  /** Per-file accepted hunk ids (only for allow). */
  hunks: HunkDecision[];
  /** The approved command (only for run_command). */
  command?: { command: string; cwd: string; timeoutSec?: number };
  reason?: string;
}

/** How long the MCP handler waits for the user before giving up. */
export const DEFAULT_DECISION_TIMEOUT_MS = 10 * 60_000;

type Resolver = (decision: ApprovalDecision) => void;

export class DecisionStore {
  private readonly decisions = new Map<string, ApprovalDecision>();
  private readonly waiters = new Map<string, Resolver[]>();
  private readonly anyWaiters: Resolver[] = [];

  /** Record a decision. Waiting handlers are woken immediately. */
  set(decision: ApprovalDecision): void {
    this.decisions.set(decision.toolCallId, decision);
    const waiting = this.waiters.get(decision.toolCallId);
    if (waiting) {
      this.waiters.delete(decision.toolCallId);
      for (const resolve of waiting) { resolve(decision); }
    }
    const any = this.anyWaiters.splice(0, this.anyWaiters.length);
    for (const resolve of any) { resolve(decision); }
  }

  /** Take a decision for this tool call (consuming it). */
  take(toolCallId: string): ApprovalDecision | undefined {
    const decision = this.decisions.get(toolCallId);
    if (decision) { this.decisions.delete(toolCallId); }
    return decision;
  }

  /** Take the oldest recorded decision (consuming it). */
  takeOldest(): ApprovalDecision | undefined {
    for (const [id, decision] of this.decisions) {
      this.decisions.delete(id);
      return decision;
    }
    return undefined;
  }

  /** Take the oldest decision that matches the predicate (consuming it). */
  takeOldestWhere(predicate: (decision: ApprovalDecision) => boolean): ApprovalDecision | undefined {
    for (const [id, decision] of this.decisions) {
      if (!predicate(decision)) { continue; }
      this.decisions.delete(id);
      return decision;
    }
    return undefined;
  }

  /** Wait for the decision of one tool call. Resolves undefined on timeout. */
  waitFor(toolCallId: string, timeoutMs = DEFAULT_DECISION_TIMEOUT_MS): Promise<ApprovalDecision | undefined> {
    const existing = this.take(toolCallId);
    if (existing) { return Promise.resolve(existing); }
    return new Promise((resolve) => {
      const list = this.waiters.get(toolCallId) ?? [];
      const timer = setTimeout(() => {
        const current = this.waiters.get(toolCallId);
        if (current) {
          this.waiters.set(toolCallId, current.filter((r) => r !== onResolve));
          if (this.waiters.get(toolCallId)?.length === 0) { this.waiters.delete(toolCallId); }
        }
        resolve(undefined);
      }, timeoutMs);
      timer.unref?.();
      const onResolve: Resolver = (d) => {
        clearTimeout(timer);
        resolve(d);
      };
      list.push(onResolve);
      this.waiters.set(toolCallId, list);
    });
  }

  /** Wait for the next decision, whichever tool call it belongs to. */
  waitForAny(timeoutMs = DEFAULT_DECISION_TIMEOUT_MS): Promise<ApprovalDecision | undefined> {
    const oldest = this.takeOldest();
    if (oldest) { return Promise.resolve(oldest); }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.anyWaiters.indexOf(onResolve);
        if (index >= 0) { this.anyWaiters.splice(index, 1); }
        resolve(undefined);
      }, timeoutMs);
      timer.unref?.();
      const onResolve: Resolver = (d) => {
        clearTimeout(timer);
        resolve(d);
      };
      this.anyWaiters.push(onResolve);
    });
  }

  has(toolCallId: string): boolean {
    return this.decisions.has(toolCallId) || this.waiters.has(toolCallId);
  }

  /** Deny every pending decision (used when the user stops the turn). */
  denyAll(toolCallIds: readonly string[], reason = 'The turn was stopped.'): void {
    for (const id of toolCallIds) {
      const waiting = this.waiters.get(id);
      this.waiters.delete(id);
      const decision: ApprovalDecision = { toolCallId: id, changeSetId: '', status: 'deny', hunks: [], reason };
      if (waiting) {
        for (const resolve of waiting) { resolve(decision); }
      } else {
        this.decisions.set(id, decision);
      }
    }
  }

  /** Forget every decision (new chat). */
  clear(): void {
    this.decisions.clear();
    this.waiters.clear();
    this.anyWaiters.length = 0;
  }
}
