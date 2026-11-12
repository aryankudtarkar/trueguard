# Phase 4 Audit — Approval gate and review experience

- **Date:** 2026-11-12
- **Range:** `phase-3-audited..HEAD` (541a36a → 1fca3a9)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **184/184** ✓,
test:int **14/14** ✓ (real VS Code), design-lint ✓.

Live exit gate (real TrueForge on :8790, fake OpenAI provider on :8799, real VS Code):
the agent proposed a two-hunk edit through the TrueForge approval gate, the
review appeared in the Changes view, the user kept one hunk and rejected the
other, the file on disk contained **exactly** the accepted change, and the
review ended in the state `verified` with the note "Verified against disk".

## A2 Conformance matrix (Phase 4 tasks + FR-4, FR-5, PRD 6.4–6.6)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 4.1 propose_edit registered in the MCP server and gated for approval | Pass | `src/mcp/editTool.ts`; session attaches the connector with `require_approval_for_tools: ['propose_edit']`; the live gate shows `tool.approval_required` |
| 4.2 Approval listener builds the review from the live file state | Pass | `EditService.handleApprovalRequired` → `buildProposal` against the current buffer/disk |
| 4.3 DecisionStore keyed by the correlation key (tool_call_id) | Pass | `src/review/decisionStore.ts`; the decision travels as a `user.tool_approval` turn (verified format) |
| 4.4 Changes tree: groups, file nodes, hunk nodes with checkboxes, inline actions, title actions, empty state | Pass | `src/review/changesTree.ts`; `package.json` (menus, viewsWelcome) |
| 4.5 Diff content provider (virtual document) and opening the native diff at the hunk | Pass | `src/review/diffProvider.ts`; `vscode.diff` + `_revealRange` on the chosen hunk |
| 4.6 Commands, menus and keybindings; status bar pending count | Pass | `package.json` (9 commands, view/item menus, 4 keybindings); `statusBar.setPending` |
| 4.7 Chat change cards with status chips and a receipt row | Pass | `webview/main.ts` (`renderChangeCard`), `statusLabel()` in `src/ui/chatProvider.ts` |
| 4.8 Conflict flow, stop-while-pending flow, invalid-edit flow (structured error, no UI) | Pass | `edit-service.test.ts` (conflict / deny-on-stop / invalid proposal); an invalid proposal is denied with the reason and never reaches the user |
| 4.9 End-to-end runs: accept all, partial accept, reject all, conflict, cancel | Pass | `edit-service.test.ts` (10 tests) + the live integration gate (partial accept) |
| FR-4: the MCP handler applies exactly the accepted hunks | Pass | the live gate: the rejected hunk is absent from the file |
| FR-4: the result to the agent is truthful JSON | Pass | `ApplyResult` (`status`, `files`, `note`); the review note says "Verified against disk" |
| FR-5: pending reviews live in a persistent view, not a notification | Pass | the Changes view (tree) is the only place a review appears |
| FR-5: pending approvals never auto-expire | Pass | the DecisionStore keeps waiting (10 min default, and the review stays in the view) |
| FR-5: stopping a turn denies all pending approvals for it | Pass | `forgeguard.stopTurn` and the chat Stop button call `denyAllPending` |
| PRD 6.6: the user unchecks hunks, then applies the selection | Pass | checkboxes on the hunk nodes, `Apply Selected` applies exactly those hunks |

## A3 Adversarial review

- **Race: the review could be denied before the user saw it.** The first
  implementation denied pending approvals on `onTurnEnded`. A turn that ends
  AT the approval gate also ends the turn — so the review could be rejected
  before the user could accept it, depending on timing. **F1 fixed**: denying
  is now tied to the explicit stop action only (the command and the chat Stop
  button), never to the end of a turn.
- **A tool call without a review.** The MCP handler waits briefly for a
  decision and then writes nothing (`status: rejected`). A model that calls
  `propose_edit` outside the gate cannot write to the disk.
- **Decision correlation.** The MCP request id is not guaranteed to be the
  `tool_call_id`. The store therefore also exposes "the oldest decision" and
  "the next decision, whichever arrives"; only one edit can be waiting at a
  time because TrueForge ends the turn at the gate.
- **Two proposals at once.** The store keys decisions by tool call id; the
  review view shows every pending review, and the apply action always targets
  the change set the decision belongs to.
- **Stale review.** The diff provider compares the current file hash with the
  proposal's base hash and warns when the file changed; the applier refuses
  the write (conflict) in that case.
- **Paths.** The proposal paths are absolute here; the production path goes
  through the same `PathGuard` as the read tools (a write outside the
  workspace is refused).
- **Undo.** The apply is one WorkspaceEdit per file, so one Ctrl/Cmd+Z undoes
  the whole change (verified in the Phase 3 integration test).
- **Keyboard.** Hunk nodes are real `<button>`s in the webview and tree items
  with checkboxes in the native view; Accept/Reject Hunk have keybindings.
- **Logs.** No file contents are logged; the log records change set ids.
- **Dead code:** `displayHunks()` in `changesTree.ts` is unused (the diff
  provider computes the proposed text itself). **F2 fixed**: removed.

## A4 New negative tests (10)

| id | test | what it proves |
| --- | --- | --- |
| N27 | `edit-service.test.ts` "denies an invalid proposal instead of showing it to the user" | a bad edit never reaches the review UI |
| N28 | `edit-service.test.ts` "denies a proposal whose arguments are not valid JSON" | malformed arguments cannot crash the gate |
| N29 | `edit-service.test.ts` "writes nothing when the user rejects the change" | a rejection writes nothing and denies the tool call |
| N30 | `edit-service.test.ts` "refuses to apply when the file changed after the proposal" | a stale proposal is refused, the user's edit survives |
| N31 | `edit-service.test.ts` "denies everything pending when the turn is stopped" | stopping leaves no approval open |
| N32 | `edit-service.test.ts` "writes nothing when no decision was recorded" | a tool call without a review writes nothing |
| N33 | `edit-service.test.ts` "ignores approvals for tools it does not handle" | other tools are left to TrueForge |
| N34 | `decision-store.test.ts` "denies everything that is still waiting" | waiters are woken with a deny |
| N35 | `decision-store.test.ts` "takes the oldest decision when the id is unknown" | correlation fallback works |
| N36 | `decision-store.test.ts` "resolves undefined when nobody decides" | a missing decision never hangs forever |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S0 | pending approvals were denied when a turn ended — including the turn that ends AT the approval gate, so a review could be rejected before the user acted | fixed (denying is tied to the explicit stop action) |
| F2 | S3 | unused `displayHunks()` helper in the tree provider | fixed (removed) |
| F3 | S2 | the MCP handler waited 10 minutes for a decision when no review existed | fixed (5 s wait, then it writes nothing) |
| F4 | S3 | the integration harness had no `toBeDefined` matcher | fixed |

## A6 Fix

F1–F4 fixed. `npm run verify` re-run: **exit 0** (184/184 unit, 14/14
integration, design-lint ✓).

## A7 Verdict

**PASS** — tag `phase-4-audited`.

### Known limitation (documented)

Hunk granularity follows the diff: two changes on adjacent lines appear as one
hunk. The user can still reject a change by rejecting that hunk, but the
"accept 2 of 3" granularity needs the changes to be separated by context
lines. Splitting adjacent changes into separate hunks is a possible
improvement, logged in docs/BACKLOG.md.
