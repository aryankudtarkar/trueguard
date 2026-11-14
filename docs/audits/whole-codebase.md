# Whole-codebase audit — TrueGuard

- **Date:** 2026-11-14
- **Range:** the whole codebase at `4659ae3` (every phase), plus the three
  features added on top (symbol mentions, checkpoints/revert, hunk splitting)
- **Auditor:** build agent (autonomous)
- **Why now:** the brief's Round 1 deadline is 20 Nov; this is the last full
  pass before the code is frozen for the demo.

## A1 Gates

`npm run verify` → **exit 0**

| Gate | Result |
| --- | --- |
| typecheck (strict) | ✓ 0 errors, no `any`, no `@ts-ignore`, no `eslint-disable` in `src/` |
| lint | ✓ 0 warnings (`--max-warnings 0`) |
| unit tests | ✓ **310/310** (38 files) |
| integration (real VS Code) | ✓ **27/27** |
| design-lint | ✓ (colors, emoji icons, px font sizes, aria labels, reduced motion) |

Coverage (the PRD-scored modules): **edits/ 97.3 %**, **failover/ 96.8 %**,
**mcp/tools 100 %**, **exec/ 83.8 %** (the Windows kill path cannot run on
macOS), **util/ 92.5 %** — all above the PRD's floors (90 % on edits/, 85 % on
mcp/tools), enforced per module in `vitest.config.ts`.

Live gates (real TrueForge + real VS Code, all green): the agent reads a file
through our MCP connector; the agent proposes 2 hunks, the user keeps 1, the
disk has exactly that change; a command waits for approval; an injected 429
completes the turn on the fallback model.

## A2 Conformance matrix (every PRD requirement + the brief's five capabilities)

### The three guarantees

| Guarantee | Status | Evidence |
| --- | --- | --- |
| **G1** — nothing reaches disk without hunk-level approval | Pass | `propose_edit` is gated by TrueForge (`require_approval_for_tools`); the applier only writes the accepted hunk ids; the live gate shows the rejected hunk absent from the disk |
| **G2** — no success claimed without verification | Pass | `apply.ts` verifies the buffer **and** the disk; a mismatch restores the snapshot and reports `verification_failed`; the write-failure path is caught too |
| **G3** — a provider failure does not end the session | Pass | the classifier, the breaker, the resume-on-another-model, the idempotency guard; the live gate completes the turn on the fallback with one notice |

### The functional requirements

| FR | Status | Note |
| --- | --- | --- |
| FR-1 setup & lifecycle | Pass | spawn/health/stop, states, kill only our child |
| FR-2 chat & sessions | Pass | streaming, Stop < 1.1 s, chips, 20 sessions, survives a restart |
| FR-3 editor MCP + read-only tools | Pass | loopback, bearer auth, Host check, 5 tools, `.gitignore`-aware listing |
| FR-4 safe edit pipeline | Pass | exact-match edits, structured errors, whole-file rewrites refused, base-hash conflict check, truthful result JSON |
| FR-5 review experience | Pass | persistent Changes view, hunk checkboxes, no auto-expiry, stop denies approvals |
| FR-6 command execution | Pass | approval, verbatim card, risky-pattern highlight, cwd guard, timeout, tree kill, 16 KB tail |
| FR-7 failover | Pass | see G3 |
| FR-8 observability | Pass | output channel, per-session redacted JSON log, 10 contributed settings |
| FR-9 context hygiene | Pass | every tool result capped; the payload stays valid JSON |
| FR-10 checkpoints | Pass | every applied change stores a snapshot; Revert on the receipt and in the palette; a diverged file needs a confirmation |

### The brief's five mandatory capabilities

| Capability | Status | Note |
| --- | --- | --- |
| 1 Inline edit | Pass | select → `Cmd/Ctrl+Alt+I` → instruction → the diff opens beside the code |
| 2 Agent mode (≥3 files, none named) | Pass | the proposal builder handles several files in one request; the multi-file apply is one WorkspaceEdit per file |
| 3 Context assembly | Pass | `@file` **and** `@symbol` mentions, automatic retrieval, a visible budget, the chat names the files it chose |
| 4 Diff review | Pass | hunk-by-hunk, accept/reject each, no silent writes, undoable (and now revertible) |
| 5 Streaming & cancellation | Pass | tokens stream, Stop is immediate, the workspace stays consistent |

### Non-functional (section 9)

| Requirement | Status |
| --- | --- |
| TypeScript strict, no `any` outside validated boundaries | Pass — every external input is zod-validated |
| Every disposable registered, no unhandled rejections | Pass (one fixed in this audit, F6) |
| Coverage floors | Pass |
| MIT, permissive dependencies only | Pass — MCP SDK (MIT), zod (MIT), jsdiff (BSD), marked (MIT), DOMPurify (Apache-2.0) |
| Windows / CRLF / BOM / unicode | Pass — CRLF, BOM and unicode are proven by integration tests; the path guard resolves realpaths, so symlinks and case-insensitive filesystems behave |

## A3 Adversarial review

- **Path containment (the big one).** Every path that reaches the disk now
  resolves through the workspace guard. Before this pass, the *edit* pipeline
  had **no containment at all**: the agent's proposal path went straight to
  `fs.readFile`/`applyEdit`, so a path outside the workspace — or a relative
  path resolved against the extension host's unpredictable working directory —
  was read and written as-is. **F1 fixed** (S1).
- **Secret files.** `.env` was refused, but `production.env` was not.
  **F2 fixed** (S2): any `*.env`, `*.pem`, `*.key`, `.netrc`, `credentials`
  is a secret now.
- **The revert raced an apply.** The revert wrote without taking the per-file
  lock the applier uses. **F3 fixed** (S2).
- **A failed apply could strand the review.** An editor error during the
  apply propagated out and left the change set in `applying` forever.
  **F4 fixed** (S1): the failure is caught, the review moves to
  `verificationFailed`, and the agent is told nothing was written.
- **Unhandled rejections.** A webview handler that threw became an unhandled
  promise rejection. **F5 fixed** (S2).
- **Unbounded growth.** The chat re-sent its whole message list on every
  update; the session log and the checkpoint store grew without limit (each
  checkpoint stores full file texts). **F6 fixed** (S2): all three are bounded
  (200 messages, 20 logs, 50 checkpoints).
- **The design-lint had a false positive.** A GitHub issue reference in a
  comment (`cline#713`) matched the hex-colour rule and failed the build.
  **F7 fixed** (S2): only `#RGB`/`#RGBA`/`#RRGGBB`/`#RRGGBBAA` in code count.
- **Logs and secrets.** No key, token or bearer value is written to the log
  channel; the session log redacts secret-looking keys and bearer tokens in
  free text. *Accepted trade-off:* the session log stores tool results (the
  agent's view of a file) — it is local, in globalStorage, and never leaves
  the machine.
- **Dead code, TODOs, `any`, `console.log`.** None in `src/` or `webview/`.
- **Disposables.** Every emitter, view, channel and subscription is disposed;
  the timers are cleared on both paths.

## A4 New negative tests (10, all from this audit)

| id | test | what it proves |
| --- | --- | --- |
| N65 | `path-containment.test.ts` "refuses to read a file outside the workspace" | the edit pipeline cannot read outside the workspace |
| N66 | `path-containment.test.ts` "refuses to write a file outside the workspace" | and cannot write either — the file outside is byte-identical afterwards |
| N67 | `path-containment.test.ts` "refuses a path that escapes the workspace with .." | `..` escapes are refused |
| N68 | `path-containment.test.ts` "refuses a .git path" | the repository internals stay out of reach |
| N69 | `path-containment.test.ts` "refuses to read a secret file inside the workspace" | `.env` is refused even inside the workspace |
| N70 | `path-containment.test.ts` "resolves a relative path against the workspace" | a relative path means what the user thinks |
| N71 | `path-containment.test.ts` "the proposal context refuses a path outside the workspace" | the read side is guarded too |
| N72 | `edit-service.test.ts` "reverts a diverged file when the user confirms" | the confirmation path restores the file |
| N73 | `edit-service.test.ts` "refuses to revert a file that changed since" | without a confirmation the user's newer edit survives |
| N74 | `bounded-stores.test.ts` (2 tests) | the checkpoints and the session log cannot fill the disk |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | **S1** | the edit pipeline had **no path containment**: the agent's proposal path was read and written as-is, outside the workspace, and relative paths resolved against an unpredictable cwd | fixed (every disk path goes through the guard) |
| F2 | S2 | `production.env` and other secret names were not refused | fixed |
| F3 | S2 | the revert did not take the per-file lock, so it could race an apply | fixed |
| F4 | **S1** | an editor error during the apply left the review stuck in `applying` and told the agent nothing | fixed |
| F5 | S2 | a throwing webview handler became an unhandled rejection | fixed |
| F6 | S2 | the chat history, the session log and the checkpoint store grew without bound | fixed |
| F7 | S2 | the design-lint failed on GitHub issue references in comments | fixed |
| F8 | S3 | the integration tests wrote outside the workspace — they were relying on the F1 hole | fixed (the tests now work inside the workspace) |

**41 findings across the project's phase audits + 8 in this pass — all fixed.**
No S0 remains. No open S1.

## A6 Fix

F1–F8 fixed and covered by the tests above. `npm run verify` re-run after the
fixes: **exit 0** (310/310 unit, 27/27 integration, design-lint ✓).

## A7 Verdict

**PASS** — tag `whole-codebase-audited`. The codebase is ready to freeze for
the demo.

### Known limitations (unchanged, documented)

1. Undo restores the editor buffer; the file on disk keeps the applied content
   until it is saved again (VS Code does not undo a save). **The Revert
   button (FR-10) is the answer** — it restores the file itself.
2. Adjacent changes are now split into one hunk per line, so the granularity
   is fine; a replacement of two lines by two lines is split, but an
   insertion next to a deletion stays one hunk (splitting it would be
   ambiguous).
3. The failover continues the same session with a continuation message, so
   the model may repeat its reasoning (the tools it already ran cannot run
   twice).
4. The `@symbol` index is a line scanner, not a language server: it finds
   definitions in Python, JavaScript/TypeScript, Go, Rust and Java-like
   files, but not, say, a definition buried in a decorator.
5. The five-minute quick start is not human-timed.
