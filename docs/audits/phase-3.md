# Phase 3 Audit — Edit engine (headless, no UI)

- **Date:** 2026-11-12
- **Range:** `phase-2-audited..HEAD` (f35985c → working tree)
- **Auditor:** build agent (autonomous)
- **Note:** this is the audit the PRD calls "the most important audit in the project":
  every path where success could be reported without verification.

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **167/167** ✓,
test:int **13/13** ✓ (real VS Code), design-lint ✓.

Coverage on the PRD-scored modules: **edits/ 96.2 % lines** (PRD asks ≥ 90 %),
overall 94.7 %. Thresholds are enforced in `vitest.config.ts` (85/85/80/85).

## A2 Conformance matrix (Phase 3 tasks + FR-4, G1, G2)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 3.1 EOL detection and conversion, BOM, trailing newline, sha256 of LF text | Pass | `src/edits/text.ts`; `edits-text.test.ts` (round-trips LF/CRLF/CR/BOM exactly) |
| 3.2 Exact unique match; structured errors for zero/multiple matches with nearest candidate lines; overlap detection | Pass | `src/edits/matcher.ts`; `edits-matcher.test.ts` (9 tests) |
| 3.3 Zero-context hunks, stable ids, display grouping, applyHunks(base, hunks, accepted) | Pass | `src/edits/hunks.ts`; `edits-hunks.test.ts` (10 tests) |
| 3.4 ChangeStore state machine with typed events and illegal-transition guards | Pass | `src/edits/store.ts`; `edits-store.test.ts` (11 tests) |
| 3.5 Snapshot + Applier: single WorkspaceEdit, per-file mutex, base-hash conflict check, save | Pass | `src/edits/apply.ts`, `src/edits/vscodeBridge.ts`; integration "writes a change to disk and verifies it", "undoes the whole change with one undo step" |
| 3.6 Verifier: buffer check, disk check, automatic rollback, truthful result | Pass | `edits-apply.test.ts` (12 tests); integration "catches a corrupted write and rolls it back" |
| 3.7 Dev fault hook: corrupt the next write | Pass | `src/edits/faults.ts` + command `TrueGuard: Dev: Corrupt Next Write` (dev flags only) |
| 3.8 Randomized tests (apply-all == proposed, apply-none == base, untouched regions identical) + real TextDocument integration (dirty buffer, CRLF, BOM, unicode, undo, corruption) | Pass | `edits-random.test.ts` (3 randomized properties over 60+ seeds), `test/integration/edits.test.ts` (7 tests) |
| FR-4: whole-file replacement of an existing file refused | Pass | `proposal.ts` (`whole_file_rewrite`), `edits-proposal.test.ts` |
| FR-4: create only for paths that do not exist; delete only for paths that exist | Pass | `edits-proposal.test.ts` |
| FR-4: writes outside the workspace / to .git refused | Pass | `src/mcp/pathGuard.ts` (Phase 2) — the edit pipeline resolves paths through the same guard |
| FR-4: `expectedBaseHash` honoured | Pass | `edits-proposal.test.ts` ("checks the expected base hash") |
| G1 (nothing on disk without hunk-level approval) | Pass | the applier only ever applies hunks from an accepted set; no approval path exists yet in this phase |
| G2 (never claim success without verification) | Pass | `apply.ts` verifies buffer **and** disk; a mismatch rolls back and reports `verification_failed`; write failures are caught and rolled back |
| Result JSON shape `{status, files:[{path,hunksProposed,hunksAccepted,verified,newHash}], note}` | Pass | `src/edits/apply.ts` (`ApplyResult`) |
| Preserve BOM, EOL style, trailing newline | Pass | `text.ts` + integration "keeps CRLF and BOM conventions" |

## A3 Adversarial review

- **Could the engine report success without verifying?** No path exists: the
  only "applied" return happens after the buffer *and* the disk matched the
  expected text. A write that throws, a buffer that differs, a disk that
  differs — all three lead to a rollback and a `verification_failed` result.
  **F1 fixed**: a failing rollback is now reported explicitly ("rollback
  FAILED — check the file") instead of being hidden behind a generic reason.
- **Write failure mid-apply.** Previously an exception from the editor
  propagated out of `applyChanges`, leaving the change set stuck in
  `applying`. **F2 fixed**: the write is wrapped, the snapshot is restored and
  the failure is reported.
- **Multi-file outcomes.** One file applied and another conflicted used to be
  reported as `conflict`, which reads like "nothing was written".
  **F3 fixed**: the status is now `partially_applied` and the note says
  exactly what happened.
- **BOM.** The canonical hash did not ignore the BOM, so the same file read
  from disk and from an editor buffer hashed differently — every proposal on
  a BOM file would have been rejected as a conflict. **F4 fixed**
  (`contentHash` ignores the BOM; the applier writes text and lets VS Code
  own the encoding).
- **Whole-file rewrites.** Detected by comparing the edit's oldText with the
  whole file. A rewrite that differs only in whitespace is still caught
  (comparison is trimmed).
- **Ambiguous edits.** An oldText that appears twice is refused with the
  candidate line numbers — the agent gets a chance to fix it before the user
  sees anything.
- **Duplicate paths in one proposal.** Two changes for the same file would
  race each other's base hash and produce a misleading "the file changed"
  conflict. **F5 fixed**: duplicate paths are refused up front.
- **Hunk coordinates.** Hunks are computed against LF-normalized text and
  applied to LF-normalized text; a CRLF file keeps its CRLF because the
  profile is restored at write time. The integration test proves it.
- **Trailing newline.** Represented as an explicit line, so a proposal that
  adds or removes the final newline still reproduces exactly (randomized
  property "apply-all == proposed").
- **Undo.** One WorkspaceEdit per file = one undo step. Undo restores the
  buffer; the file on disk keeps the saved content until the user saves again
  (VS Code behaviour, documented in the audit notes below).
- **Dead code / TODOs:** none in `src/edits/`.

## A4 New negative tests (9)

| id | test | what it proves |
| --- | --- | --- |
| N18 | `edits-matcher.test.ts` "reports multiple matches with the candidate lines" | an ambiguous edit is refused, with both line numbers |
| N19 | `edits-matcher.test.ts` "refuses overlapping edits" | two edits may not touch the same text |
| N20 | `edits-matcher.test.ts` "refuses an empty oldText" | an empty oldText cannot match everywhere |
| N21 | `edits-random.test.ts` "any subset keeps the untouched regions byte-identical" | no hunk can corrupt untouched code |
| N22 | `edits-apply.test.ts` "reports a conflict when the file changed after the proposal" | a stale proposal is refused, the user's edit survives |
| N23 | `edits-apply.test.ts` "rolls back when the disk does not match what was written" | a lying disk triggers the rollback |
| N24 | `edits-apply.test.ts` "never reports success for a file it did not verify" | no partial truth slips through |
| N25 | `edits-apply.test.ts` "says so loudly when the rollback also fails" | a failed rollback is never hidden |
| N26 | `edits-proposal.test.ts` "refuses two changes for the same file" | duplicate paths are caught before any write |

Plus the integration negatives: forced corruption rolled back, conflict
refused, dirty buffer preserved, BOM/CRLF preserved, undo restores.

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S1 | a failed rollback was reported like a successful one | fixed (explicit "rollback FAILED" reason) |
| F2 | S1 | a write that threw left the change set stuck in `applying` | fixed (write wrapped, rollback attempted, error reported) |
| F3 | S1 | a partially applied multi-file change reported `conflict` ("nothing was written") | fixed (`partially_applied` + accurate note) |
| F4 | S1 | the canonical hash ignored the BOM: every proposal on a BOM file looked like a conflict | fixed (`contentHash` ignores the BOM; the editor owns the encoding) |
| F5 | S2 | two changes for the same file produced a misleading conflict later | fixed (duplicate paths refused up front) |
| F6 | S2 | the applier's `corruptNextWrite` flag lived on the request instead of the options | fixed (moved to the applier options) |
| F7 | S3 | `src/edits/` had no coverage floor of its own | fixed (thresholds per module in vitest.config.ts) |

## A6 Fix

F1–F7 fixed. `npm run verify` re-run: **exit 0** (167/167 unit, 13/13
integration, design-lint ✓). `edits/` coverage 96.2 % lines.

## A7 Verdict

**PASS** — tag `phase-3-audited`.

### Known limitation (documented, not a defect)

Undo restores the editor buffer; the file on disk keeps the applied content
until the user saves again. VS Code does not undo a save by itself. The
revert affordance of FR-10 (checkpoints) is the planned answer to this and is
scheduled as stretch work.
