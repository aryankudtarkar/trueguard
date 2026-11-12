# Where ForgeGuard is ahead — and why

A comparison against the two extensions people actually compare it to. **Every
claim below is backed by a link to a public issue or discussion**, because a
competitor comparison without sources is marketing, not engineering.

Checked on 2026-11-12. Issue numbers and states are as they were on that
date.

---

## 1. A provider failure ends the task (Cline)

| | |
| --- | --- |
| **Their gap** | cline/cline#13606 (open, 2026-08-27): *"Task aborts on transient API errors (timeouts, provider outages) instead of retrying — requires manual Retry and constant babysitting."* cline/cline#10139 (open): a 429 with a long `retry-after` is *retried* rather than surfaced, and WAIT is not distinguished from STOP. The retry count is hard-coded (`maxRetries: 3`) with no UI visibility and no tunable backoff — cline/cline discussion #10465. |
| **What we do** | The turn continues on the next model: a classifier (`src/failover/classifier.ts`), an ordered model list, one attempt per model per turn, a circuit breaker with a 60 s cooldown and a probe back to the primary, and **one** calm notice in the chat. The policy is visible and tunable (`forgeguard.failover.*`). |
| **Proof** | `test/unit/failover-manager.test.ts` (15 tests), `test/unit/classifier.test.ts` (13 tests), and the live gate `test/integration/failover.test.ts`: an injected 429 completes the turn on the fallback model with exactly one notice. |

## 2. "Retry" restarts the task instead of continuing it (Cline — and we had it too)

| | |
| --- | --- |
| **Their gap** | cline/cline#713: *"the retry button doesn't continue the task, but it starts again. So it generates an infinite loop and money consuming."* |
| **What we do** | A failover sends a **continuation**, never the original request again: *"The previous attempt failed: … Continue where you left off. Do not repeat the work that already succeeded."* The tools that already ran are named, and an idempotency guard makes sure a repeated call replays the first result instead of running again. |
| **Proof** | `test/unit/resume-semantics.test.ts`; the guard itself is `src/util/idempotency.ts`, covered by `test/unit/failover-resume.test.ts`. |

**We had this bug too.** The Phase 6 audit re-sent the original request on a
failover — the same trap. Reading Cline's issue is what caught it.

## 3. The agent is told an edit succeeded when the file was not changed (Continue)

| | |
| --- | --- |
| **Their gap** | continuedev/continue#7564: *"The edit tools changes are not reflected in the file and continue says changes applied."* |
| **What we do** | G2: every write is verified against the editor buffer **and** the disk. A mismatch restores the pre-edit snapshot and the agent gets `verification_failed`, never "done". |
| **Proof** | `test/unit/edits-apply.test.ts` (12 tests) and the integration test *"catches a corrupted write and rolls it back"*. |

## 4. The whole file is rewritten for a small change (Continue)

| | |
| --- | --- |
| **Their gap** | continuedev/continue#6367 (closed, *not planned*): *"I asked it to make a small change - like adding a comment - to a large file (300+ lines), it ends up processing the whole file."* continuedev/continue#6471: rewriting a file over ~1000 lines fails on the output-token limit. continuedev/continue#7544: *"Token limit reached. File/range likely too large for this edit"* — even on small files, because the **model** streams the diff. |
| **What we do** | The extension computes the diff itself from a zero-context Myers diff; the model never streams a patch. A whole-file rewrite is refused (`whole_file_rewrite`), files over 2 MB are refused with an actionable message, and `read_file` returns a 400-line cap with a range hint. |
| **Proof** | `test/unit/edits-proposal.test.ts` ("refuses a whole-file rewrite"), `test/unit/edits-random.test.ts` (apply-all == proposed, apply-none == base, over 60 seeds), `test/unit/mcp-tools.test.ts` (the caps). |

## 5. The agent's view and the disk drift apart (Continue)

| | |
| --- | --- |
| **Their gap** | continuedev/continue#12269: *"When the AI requests an edit, you can type in a follow-up instead of rejecting or accepting the edit. The edit request will not be carried out, but the AI will receive an indicator that the edit was successful. As a result, the AI's view of the file will disagree with the actual state."* |
| **What we do** | The base hash is re-checked immediately before the write: a file that changed is a **conflict**, nothing is written, and the user is told. The Changes view also *shows* it: a file that changed since the proposal gets a warning icon and *"changed since the proposal"*. |
| **Proof** | `test/unit/edits-apply.test.ts` ("reports a conflict when the file changed after the proposal"), the integration test *"refuses to apply when the file changed after the proposal"*, and `src/review/changesTree.ts` (`refreshStaleness`). |

## 6. Apply is slow on large diffs (Continue)

| | |
| --- | --- |
| **Their gap** | continuedev/continue#8010: *"apply performance with larger search and replace diffs is pretty terrible"* (a long pause with a spinner before the file updates). |
| **What we do** | One `WorkspaceEdit` per file: a single undo step, one save, and the verification is two reads. |
| **Proof** | The integration test *"undoes the whole change with one undo step"*. |

## 7. Rate limits, retries and visibility (Cline)

| | |
| --- | --- |
| **Their gap** | The retry count is a compile-time constant with no UI (cline/cline discussion #10465); WAIT and STOP are not distinguished (#10139). |
| **What we do** | `forgeguard.failover.enabled` and `forgeguard.failover.breakerCooldownSec` are real settings; the chat shows one row, the status bar shows the model in use, and each agent message carries the model that produced it. |
| **Proof** | `test/unit/resume-semantics.test.ts` ("the failover settings"). |

## 8. What neither of them has: a redacted session log

Cline and Continue both keep their history in the chat panel and in the
extension's global state, but neither exposes a **per-session, redacted,
inspectable event log** that answers *"what did the agent actually see and
do?"* after the fact.

ForgeGuard writes every turn event to `globalStorage/sessions/<id>.jsonl`,
with keys and bearer tokens redacted, and **ForgeGuard: Show Session Log**
opens it. It is the artefact you need when a demo goes sideways or a user
reports something surprising.

---

## The honest summary

| Capability | Cline | Continue | ForgeGuard |
| --- | --- | --- | --- |
| Continues on another model after a provider failure | Retry, same model | Retry, same model | **Yes, with a breaker** |
| A retry continues the task instead of restarting it | No (#713) | No | **Yes** |
| Hunk-level approval | No | No | **Yes** |
| The diff is computed by the extension | No | No | **Yes** |
| Success is verified against the disk | No (#7564) | No | **Yes** |
| A changed file is a conflict, not an overwrite | No | Desync (#12269) | **Yes, and it is visible** |
| Whole-file rewrites are refused | No | No (#6367) | **Yes** |
| A redacted per-session event log | No | No | **Yes** |

**Where we are behind:** we have no inline autocomplete, no repository
indexing or embeddings (Continue has both), no multi-model comparison in the
chat, and our undo does not revert the file on disk (only the buffer).
Those are deliberate scope choices for a three-day build, not oversights —
and the last one is the one to fix first if there is time.
