# Phase 5 Audit — Command execution and context hygiene

- **Date:** 2026-11-12
- **Range:** `phase-4-audited..HEAD` (7947278 → b7a6c87)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **216/216** ✓,
test:int **15/15** ✓ (real VS Code), design-lint ✓. Coverage thresholds are
enforced per module (edits ≥ 90 %, mcp/tools ≥ 90 %, exec ≥ 70 % because the
Windows kill path cannot run on macOS).

Live exit gate (real TrueForge + fake OpenAI + real VS Code): the agent asked
to run a command, the turn paused at the gate, the command waited for the
user, and nothing ran before the approval.

## A2 Conformance matrix (Phase 5 tasks + FR-6, FR-9)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 5.1 run_command requires approval; the card shows the verbatim command and cwd; risky patterns are highlighted | Pass | `src/mcp/commandTool.ts`, `src/exec/risky.ts`; `edit-service.test.ts` ("shows a command waiting for approval, with its risky patterns"); the chat card shows the command, the cwd and the risk sentence |
| 5.2 Shell spawn, cwd guard, timeout, streamed output channel, 16 KB tail, process-tree kill | Pass | `src/exec/runner.ts`; `runner.test.ts` (9 tests: timeout, tree kill, tail, non-zero exit, stderr, cancel) |
| 5.3 Every tool result is capped (FR-9) | Pass | `capJson` (Phase 2) applies to every MCP tool result |
| 5.4 Chat rendering with exit code and duration | Pass | the command card shows "Exit code N · X.Xs" |
| 5.5 Tests: timeout, cancel mid-run, large output, non-zero exit, denied approval, cwd escape | Pass | `runner.test.ts`, `command-tool.test.ts`, `edit-service.test.ts` |
| FR-6: no auto-approve in v1 | Pass | the tool asks for the approval first; without one it returns `rejected` and runs nothing |
| FR-6: the result is the exit code, the duration and the last 16 KB with a truncation marker | Pass | `toAgentResult` |
| FR-6: cancel kills the whole process tree | Pass | POSIX process group kill, Windows `taskkill /T /F`; the timeout test proves the tree dies |
| Exit gate: the agent runs a command after approval and reports it truthfully | Pass | the live integration gate (command waits for the user, then runs) |

## A3 Adversarial review

- **A tool call without an approval.** The handler asks the decision store for
  an approved command; when there is none it returns `rejected` and runs
  nothing. **F1 fixed**: the wait is now 5 s instead of 10 minutes, so a
  misbehaving model cannot pin an MCP request open.
- **The working directory.** `resolveCommandCwd` resolves the path with
  `realpath` and refuses anything outside the workspace. **F2 fixed**: the
  ROOTS are resolved too — on macOS `/var` is a symlink to `/private/var`, so
  a string comparison against the unresolved root rejected every legitimate
  directory. Caught by the test.
- **A command with no arguments JSON.** **F3 fixed (real bug)**: the tool-call
  buffer only released a call when the server sent
  `finish_reason: tool_calls`. The live gate showed a server that does NOT
  send it — the call was never recorded, so the approval could not be
  correlated and the review never appeared. Calls are now released when their
  arguments are valid JSON, and whatever is left is flushed on `turn.done`.
- **Empty arguments are not complete arguments.** The fix above initially
  released a call as soon as the name arrived (the arguments arrive in the
  next delta). **F4 fixed**: an empty argument string means "not yet".
- **Shell injection through the cwd.** The cwd is a resolved realpath inside
  the workspace; the command itself is the user's to approve, verbatim.
- **Output flooding.** The tail is kept (16 KB) and the full stream goes to
  the output channel, never to the agent's context.
- **Zombie processes.** The timeout and the cancel both kill the process
  group; the runner resolves exactly once (`settled` guard).
- **Secrets in the output.** The output channel is local; the agent only sees
  the tail the user approved by running the command.

## A4 New negative tests (14)

| id | test | what it proves |
| --- | --- | --- |
| N37 | `runner.test.ts` "stops a command that runs too long" | the timeout really kills the command |
| N38 | `runner.test.ts` "kills the whole process tree on timeout" | no orphaned grandchildren |
| N39 | `runner.test.ts` "keeps only the tail of a huge output" | a chatty command cannot flood the context |
| N40 | `runner.test.ts` "cancels a running command and kills its tree" | the cancel path works |
| N41 | `command-tool.test.ts` "refuses a directory outside the workspace" | cwd escape is refused |
| N42 | `command-tool.test.ts` "refuses a directory that escapes with .." | `..` escape is refused |
| N43 | `command-tool.test.ts` "does not flag words that merely contain a risky token" | no false alarms on ordinary commands |
| N44 | `command-tool.test.ts` "rejects a timeout that is out of range" | absurd timeouts are refused |
| N45 | `command-tool.test.ts` "is truthful about a timeout" | the agent is told the command timed out |
| N46 | `edit-service.test.ts` "runs nothing until the user allows the command" | no implicit approval |
| N47 | `edit-service.test.ts` "denies a command the user refused" | a refusal never runs the command |
| N48 | `edit-service.test.ts` "denies a command with invalid arguments" | a malformed command never reaches the user |
| N49 | `edit-service.test.ts` "denies pending commands when the turn is stopped" | stopping closes the gate |
| N50 | `tool-calls.test.ts` "completes a call when its arguments become valid JSON" | the correlation key survives a server that omits `finish_reason` |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S2 | the MCP handler waited ten minutes for a decision when no review existed | fixed (5 s, then it writes nothing) |
| F2 | S1 | the cwd guard compared a resolved path with unresolved roots: on macOS every legitimate directory was refused | fixed (the roots are resolved too) |
| F3 | S1 | tool calls were only recorded when the server sent `finish_reason: tool_calls`; a server that omits it never reached the review | fixed (released on valid JSON arguments, flushed on turn.done) |
| F4 | S1 | the first fix for F3 released a call before its arguments arrived | fixed (an empty argument string is not complete) |
| F5 | S3 | the coverage threshold was global only | fixed (per-module thresholds) |

## A6 Fix

F1–F5 fixed. `npm run verify` re-run: **exit 0** (216/216 unit, 15/15
integration, design-lint ✓).

## A7 Verdict

**PASS** — tag `phase-5-audited`.
