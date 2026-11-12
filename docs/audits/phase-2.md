# Phase 2 Audit — Editor MCP server and read-only tools

- **Date:** 2026-11-12
- **Range:** `phase-1-audited..HEAD` (137b2ad → ec212e2)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **97/97** ✓ (includes 3 live
exit-gate tests against real TrueForge), test:int **6/6** ✓ (real VS Code via test-electron),
design-lint ✓.

Coverage on the PRD-scored modules (`npm run coverage`): **92.85 % lines** overall —
`mcp/tools.ts` 100 %, `mcp/pathGuard.ts` 88 %, `mcp/editorServer.ts` 88 %,
`util/truncate.ts` 100 %, `util/jsonCap.ts` 90 %. Configured thresholds: 85 lines /
85 functions / 80 branches / 85 statements.

Live exit gate (real TrueForge on :8790, fake OpenAI provider on :8799):
the agent called our `read_file` tool through the registered connector and read a named
function back. Transcript: `docs/spikes/phase2-exit-gate-transcript.md`.

## A2 Conformance matrix (Phase 2 tasks + FR-3, FR-8, §8)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 2.1 MCP server: Streamable HTTP, 127.0.0.1, default port 45821, next free port | Pass | `src/mcp/editorServer.ts` (DEFAULT_MCP_PORT, EADDRINUSE fallback); `mcp-server.test.ts` "falls back to the next free port"; integration test "listening on loopback" |
| 2.1 Auth: bearer token (TrueForge can send headers — VERIFIED) | Pass | constant-time compare; 401 on missing/wrong token (`mcp-server.test.ts`); header auth proven against real TrueForge (exit-gate transcript) |
| 2.1 Non-loopback Host rejected | Pass | 403 in `mcp-server.test.ts` and in the real VS Code integration test |
| 2.2 Path guard: realpath inside workspace, deny list | Pass | `src/mcp/pathGuard.ts`; `path-guard.test.ts` (7 tests): `..` escape, absolute escape, symlink escape, `.git` deny, not_found |
| 2.2 Secret files need a setting (PRD §8) | Pass | `.env`/`*.pem`/`id_rsa` refused with code `secret`; `forgeguard.allowSecretReads` opt-in |
| 2.2 Truncation utility: head/tail elision with a marker | Pass | `src/util/truncate.ts` (byte-accurate, never splits a UTF-8 character); `json-cap.test.ts` |
| 2.3 read_file: numbered lines, 400-line cap, totalLines, contentHash | Pass | `mcp-tools.test.ts` (cap 400, hard cap 2000, ranges, hash format) |
| 2.3 read_file reads the dirty buffer | Pass | integration test "reads the dirty buffer of an open file" (real VS Code, unsaved edit visible through MCP) |
| 2.3 list_files respects .gitignore | Pass | git-backed listing; integration test "hides files that .gitignore excludes"; `glob.test.ts` |
| 2.3 search_text returns path:line:snippet, capped | Pass | `mcp-tools.test.ts` (matches, maxResults, bad regex, no path leaks) |
| 2.3 get_diagnostics / get_editor_context | Pass | `mcp-tools.test.ts`, `mcp-server.test.ts` |
| 2.3 zod schema on every tool | Pass | `src/mcp/tools.ts` (zod shapes); bad input rejected over the protocol (`mcp-server.test.ts`) |
| 2.4 Connector registration with TrueForge, re-registered on port change | Pass | `TrueForgeClient.upsertMcpServer` (POST/PUT), `src/extension.ts`; live proof in the exit-gate transcript (`mcp.initialize` → `forgeguard-editor`) |
| 2.5 Chat: collapsed tool activity rows with expandable details | Pass | `ToolCallBuffer` + chat rows (`read_file src/app.ts`), webview row with aria-expanded |
| 2.6 Tests: success, bad input, path escape, symlink escape, cap, dirty buffer | Pass | 20 tool-level tests, 19 MCP protocol tests, 3 integration tests |
| Exit gate: the agent finds a named function using only the tools | Pass | `test/unit/exit-gate-phase2.test.ts` (live, real TrueForge) + transcript |
| FR-3 AC: every tool has success/bad-input/escape/cap tests | Pass | `mcp-tools.test.ts`, `mcp-server.test.ts` |
| FR-9 context hygiene (tool result cap) | Pass | `capJson` — payload stays valid JSON, structure preserved |
| §8 secrets only in SecretStorage, logs redacted | Pass | no key material in the MCP path; `redact()` on every log line |

## A3 Adversarial review (diff phase-1-audited..HEAD)

- **Was the server ever started?** No. The MCP server was constructed but never
  `listen()`ed, so the agent had no tools and the connector was never registered.
  **Fixed** (F1).
- **Tool calls were read from the wrong event.** The verified transcript
  (`docs/spikes/approval-allow-transcript.md`) shows tool calls arriving in
  `model.message.delta`, with the name in one delta and the arguments in the next.
  The chat only looked at `model.message`, so **no tool row would ever have
  appeared**. **Fixed** (F2) with a merging buffer.
- **The FR-9 cap could emit invalid JSON.** Cutting serialized JSON at a byte
  offset splits escape sequences (`"\n"` → `"\` + newline) and the agent receives
  unparseable output. **Fixed** (F3) by shrinking the *value*, not the text.
- **Cap unit mismatch.** The setting says bytes, the code counted characters.
  **Fixed** (F5): byte-accurate, boundary-safe.
- **Result correlation.** Tool results were attached to "the last pending row",
  which is wrong when calls run in parallel. **Fixed** (F4) via `tool_call_id`.
- **`.gitignore` was not respected.** VS Code's `findFiles` ignores it (proved by
  an integration probe) and would have pulled `node_modules` into the agent's
  context. **Fixed** (F8) with a git-backed listing.
- **Large files.** A 100 MB file was read whole into memory. **Fixed** (F12):
  files over 2 MB are refused with an actionable message.
- **Stale bundle in integration tests.** `npm run test:int` never rebuilt the
  extension, so the integration suite ran against the previous build and could
  not catch F1. **Fixed** (F6): `test:int` now builds first.
- **Flaky live tests.** Vitest ran test files in parallel; the two live exit-gate
  tests share the fake provider's mode, so they fought each other.
  **Fixed** (F7): `fileParallelism: false`.
- **Path/security:** every tool path goes through `PathGuard` (realpath, deny
  list, secret policy). `search_text` resolves each candidate through the guard
  and skips anything that escapes, so no outside path can appear in a result.
- **Windows/CRLF/BOM/unicode:** `read_file` splits on `\r\n|\r|\n`; the guard
  compares realpaths, not raw strings. Case-insensitive filesystems are handled
  in `readText` (lowercased comparison). Paths are converted to `/` for the
  agent.
- **UI states:** tool rows cover running and done; expansion is keyboard
  reachable (a real `<button>` with `aria-expanded`).
- **Logs:** no token is logged; the bearer token appears only in the connector
  manifest sent to TrueForge (its own settings store) and in memory.
- **Dead code / TODOs:** none left in `src/`.

## A4 New negative tests (7)

| id | test | what it proves |
| --- | --- | --- |
| N11 | `mcp-tools.test.ts` "refuses a path outside the workspace" | `..` escape is refused, not served |
| N12 | `mcp-tools.test.ts` "refuses a symlink that escapes the workspace" | a link inside the workspace cannot reach outside |
| N13 | `mcp-tools.test.ts` "refuses secret files unless the user opted in" | `.env` needs an explicit setting |
| N14 | `mcp-server.test.ts` "rejects bad arguments / a missing required argument" | bad input never reaches a handler |
| N15 | `mcp-server.test.ts` "refuses a secret file read over MCP" | the policy holds at the protocol level |
| N16 | `json-cap.test.ts` "never returns invalid JSON" | the cap cannot corrupt the payload |
| N17 | `gitignore-probe.test.ts` (integration) | ignored files and `node_modules` never reach the agent |

Plus the existing live negatives: wrong/missing bearer token (401), non-loopback
Host (403), unknown tool, broken regex, oversized file, out-of-range lines.

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S0 | The editor MCP server was never started: the agent had no tools and the connector was never registered | fixed (extension.ts starts it; integration test proves it listens) |
| F2 | S1 | Tool calls arrive as `model.message.delta` fragments; the chat read only `model.message`, so tool rows never appeared | fixed (`ToolCallBuffer`, unit tested) |
| F3 | S1 | The FR-9 byte cap could cut JSON mid-escape and send the agent unparseable output | fixed (`capJson` shrinks the value; structure survives) |
| F4 | S1 | Tool results were attached to the last pending row instead of their own call | fixed (`tool_call_id` correlation) |
| F5 | S2 | The output cap counted characters while the setting promised bytes | fixed (byte-accurate, UTF-8 safe) |
| F6 | S1 | `npm run test:int` did not rebuild the extension: integration tests ran against a stale bundle | fixed (`test:int` builds first) |
| F7 | S1 | Live exit-gate tests raced over the shared fake provider mode (flaky failures) | fixed (`fileParallelism: false`) |
| F8 | S1 | `list_files` ignored `.gitignore` and could hand `node_modules` to the agent | fixed (git-backed listing + fallback) |
| F9 | S2 | New webview CSS broke the design-lint (px font sizes) | fixed |
| F10 | S2 | An emoji was used as a tool-row icon (PRD: codicons only, no invented icons) | fixed (typographic marker) |
| F11 | S3 | `HostToWebviewMessage` declared a `toggleTool` message the host never sends | fixed (removed) |
| F12 | S2 | Very large files were read whole into memory | fixed (2 MB limit, actionable error) |
| F13 | S3 | The integration harness had no `.not` matchers | fixed |

## A6 Fix

F1–F13 fixed. `npm run verify` re-run after the fixes: **exit 0**
(97/97 unit including 3 live exit gates, 6/6 integration, design-lint ✓).
Coverage thresholds are enforced by `vitest.config.ts`.

## A7 Verdict

**PASS** — tag `phase-1-audited` → `phase-2-audited`.
