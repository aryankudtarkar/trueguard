# Progress

Owner gate G0: **approved 2026-11-12** — Phase 1 started.

## Phase 0 (audited PASS, tag phase-0-audited)

| Task | Status | Commit |
| --- | --- | --- |
| 0.1 skeleton + tooling | done | 30fe1b6 |
| 0.2 brief extraction + conflicts | done | 30fe1b6 |
| 0.3 TrueForge packages verified | done | 10574db |
| 0.4 verification ledger | done | 10574db |
| 0.5–0.8 spikes 1–4 | done | 372f370 |
| 0.9 fake-trueforge | done | beeb07d |
| 0.10 ledger files | done | 30fe1b6 |
| audit | PASS | 226cf3d |

## Phase 1 (extension shell, TrueForge client, streaming chat)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 1.1 extension.ts + contributes | done | c1facbf | container, 2 views, 7 commands, keybindings, settings, viewsWelcome |
| 1.2 Logger, zod schemas, hashing/mutex/SSE utils | done | c1facbf | |
| 1.3 ServerManager + viewsWelcome | done | c1facbf | spawn/health/stop/state events |
| 1.4 TrueForgeClient (HTTP/SSE, zod, abort) | done | c1facbf | no SDK exists → HTTP API; reconnect backoff added in audit |
| 1.5 SessionManager | done | c1facbf | create/send/stop, 20-session persistence, sync one-turn guard |
| 1.6 Chat webview | done | c1facbf | CSP+nonce, sanitized markdown, batched render, chip, Send/Stop; zod-validated webview messages |
| 1.7 Status bar item | done | c1facbf | offline/starting/working/failover/pending/idle |
| 1.8 Tests unit + integration | done | c1facbf | 26 unit (incl. 5 new negatives) vs fake server; 2 int in real VS Code |
| Phase 1 exit gate: real streaming + Stop on real TrueForge | done | c731545 | automated live tests (fake-provider/test-model); abort+cancel < 1.1 s |
| Phase 1 audit | **PASS** | — | docs/audits/phase-1.md; 6 findings fixed, tag phase-1-audited |

## Phase 2 (editor MCP server, read-only tools)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 2.1 MCP server (Streamable HTTP, 127.0.0.1, port fallback, bearer auth, Host check) | done | 6fa3602 | started at activation — was never started (audit F1) |
| 2.2 Path guard (realpath containment, deny list, secret policy) + truncation utility | done | 6fa3602 | `.env`/`*.pem` need `trueguard.allowSecretReads` |
| 2.3 read_file, list_files, search_text, get_diagnostics, get_editor_context | done | 6fa3602 | zod schemas, caps, dirty-buffer reads, 2 MB file limit |
| 2.4 Connector registration with TrueForge (POST/PUT, re-register on port change) | done | cbcc7d1 | proven live: `mcp.initialize` → `trueguard-editor` |
| 2.5 Chat: collapsed tool activity rows with expandable details | done | f3eacc8 | tool calls arrive as deltas → merging buffer, rows keyed by tool_call_id |
| 2.6 Tests: success, bad input, path escape, symlink escape, cap, dirty buffer | done | 93bf993 | 39 new tests (unit + protocol + real VS Code) |
| Phase 2 exit gate: agent finds a named function using only the tools | done | 93bf993 | live against real TrueForge, transcript in docs/spikes/ |
| fix: list_files honours .gitignore (findFiles does not) | done | ec212e2 | git-backed listing, node_modules never leaks |
| Phase 2 audit | **PASS** | — | docs/audits/phase-2.md; 13 findings fixed, tag phase-2-audited |

## Phase 3 (edit engine, headless)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 3.1 Text normalization (EOL, BOM, trailing newline, LF hash) | done | cc2733b | exact round-trip for LF/CRLF/CR/BOM |
| 3.2 Edit matcher (unique match, structured errors, overlap) | done | cc2733b | nearest candidate line numbers |
| 3.3 Hunk engine (zero-context diff, stable ids, applyHunks) | done | cc2733b | randomized properties prove apply-all == proposed |
| 3.4 ChangeStore state machine | done | cc2733b | illegal transitions throw |
| 3.5 Proposal builder + VS Code bridge (one WorkspaceEdit, mutex, conflict check) | done | dbd0119 | one undo step per file |
| 3.6 Verifier (buffer + disk, rollback, truthful result) | done | cc2733b | no path reports success unverified |
| 3.7 Dev fault hook (corrupt the next write) | done | dbd0119 | command + `trueguard.dev.enableFaultInjection` |
| 3.8 Randomized + real TextDocument tests | done | dbd0119 | CRLF, BOM, unicode, dirty buffer, undo, corruption |
| Phase 3 audit | **PASS** | — | docs/audits/phase-3.md; 7 findings fixed, edits/ coverage 96 % |

## Phase 4 (approval gate and review experience)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 4.1 propose_edit registered and gated for approval | done | 1fca3a9 | `require_approval_for_tools: ['propose_edit']` |
| 4.2 Approval listener builds the review from the live file state | done | 1fca3a9 | proposals are built from the current buffer/disk |
| 4.3 DecisionStore keyed by tool_call_id | done | 1fca3a9 | the decision travels as a `user.tool_approval` turn |
| 4.4 Changes tree view (groups, files, hunk checkboxes, actions, empty state) | done | 1fca3a9 | |
| 4.5 Diff content provider + native diff at the chosen hunk | done | 1fca3a9 | warns when the file changed since the proposal |
| 4.6 Commands, menus, keybindings, status bar pending count | done | 1fca3a9 | 9 commands, 4 keybindings |
| 4.7 Chat change cards with status chips and receipt row | done | 1fca3a9 | Awaiting review / Verified / Conflict / Rejected |
| 4.8 Conflict, stop-while-pending, invalid-edit flows | done | 1fca3a9 | invalid edits are denied with a reason, never shown |
| 4.9 End-to-end runs (accept all, partial, reject, conflict, cancel) | done | 1fca3a9 | 10 service tests + the live gate |
| Phase 4 exit gate: agent proposes, user accepts 1 of 2 hunks, disk has exactly that | done | 1fca3a9 | live, real TrueForge + real VS Code |
| Phase 4 audit | **PASS** | — | docs/audits/phase-4.md; 4 findings fixed, tag phase-4-audited |

## Phase 5 (command execution and context hygiene)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 5.1 run_command with approval, verbatim card, risky-pattern highlight | done | b7a6c87 | nothing runs without the user's approval |
| 5.2 Process runner (shell, cwd guard, timeout, output channel, 16 KB tail, tree kill) | done | b7a6c87 | POSIX process group / Windows taskkill |
| 5.3 Every tool result capped (FR-9) | done | f35985c | `capJson` keeps the payload valid JSON |
| 5.4 Chat rendering: exit code and duration | done | b7a6c87 | command card |
| 5.5 Tests: timeout, cancel, large output, non-zero exit, denied approval, cwd escape | done | b7a6c87 | 33 new tests |
| Phase 5 exit gate: the agent runs a command only after approval | done | b7a6c87 | live, real TrueForge + real VS Code |
| Phase 5 audit | **PASS** | — | docs/audits/phase-5.md; 5 findings fixed, tag phase-5-audited |

## Phase 6 (failover — G3)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 6.1 ErrorClassifier (table-driven) | done | this commit | 429/5xx/timeout → transient; 401/403/quota → provider-fatal; 400/context → request-fatal |
| 6.2 FailoverManager: policy, per-turn attempts, 429 backoff (5 s cap), breaker (60 s) | done | this commit | one attempt per model per turn; probe back to the primary |
| 6.3 Resume strategy (PATCH the session's model, same session) + idempotency guard | done | this commit | a tool that already ran is never run twice |
| 6.4 UI: inline notice, status bar warning, model label, all-models-down error | done | this commit | Retry + Edit Models actions |
| 6.5 Dev fault injection (429, 503, timeout, 401) | done | this commit | dev flags only, hidden from the palette |
| 6.6 Tests: classifier table, state machine, live end-to-end | done | this commit | 34 new tests |
| Phase 6 exit gate: an injected 429 completes the turn on the fallback | done | this commit | live, real TrueForge; one calm notice |
| Phase 6 audit | **PASS** | — | docs/audits/phase-6.md; 4 findings fixed, tag phase-6-audited |

## Phase 7 — inline edit (FR-11, brief Task A)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| Select + keybinding + instruction → agent proposes → diff beside the code | done | fcec9b7 | Cmd/Ctrl+Alt+I; the write still goes through the review |
| Tests | done | fcec9b7 | unit (the prompt) + integration (the selection) |

## Phase 8 — context assembly (FR-12, brief B1)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| @-mentions in the composer | done | 04dc7df | type @, pick a file, it becomes a chip |
| Automatic retrieval, budgeted | done | 04dc7df | only the promising files are read |
| The user sees what was chosen | done | 04dc7df | `Context: app/x.py (2.1 KB of 16 KB)` |
| Tests | done | 04dc7df | 20 new tests |

## Phases 9–10 (design polish, onboarding, hardening, packaging)

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 9.1 design-lint: colors, icons, font sizes, aria labels, reduced motion | done | c7d6e97 | stricter rules; the build fails on a violation |
| 9.2 Every state in 6.4 / 6.5 | done | c7d6e97 | including the missing "Not configured" |
| 9.3 Walkthrough (three steps) | done | c7d6e97 | native walkthrough contribution |
| 9.4 Microcopy pass | done | c7d6e97 | the PRD's sentences |
| 9.5–9.6 Keyboard, screen readers, themes | done | c7d6e97 | aria labels on every control; theme variables only |
| 10.1–10.2 README + the quick start | done | c7d6e97 | the owner walks it once before the demo |
| 10.3 `scripts/demo-prepare.mjs` | done | c7d6e97 | clones the benchmark, writes the prompts |
| 10.4 `docs/DEMO.md` | done | c7d6e97 | the timed script D1–D5 |
| 10.5 The `.vsix` | done | c7d6e97 | 328 KB, 11 files |
| 10.7 `docs/SUBMISSION.md` | done | c7d6e97 | the pitch, the screenshots, the brief mapping |
| Phases 9–10 audit | **PASS** | — | docs/audits/phase-9-10.md; 8 findings fixed |

## Whole-codebase audit (2026-11-14, before the demo freeze)

| Finding | Severity | Status |
| --- | --- | --- |
| The edit pipeline had no path containment: the agent's proposal path was read and written as-is, outside the workspace, and relative paths resolved against an unpredictable cwd | **S1** | fixed — every disk path goes through the workspace guard |
| An editor error during the apply left the review stuck in `applying` and told the agent nothing | **S1** | fixed |
| `production.env` and friends were not refused as secrets | S2 | fixed |
| The revert did not take the per-file lock and could race an apply | S2 | fixed |
| A throwing webview handler became an unhandled rejection | S2 | fixed |
| The chat history, the session log and the checkpoints grew without bound | S2 | fixed (200 / 20 / 50) |
| The design-lint failed on GitHub issue references in comments | S2 | fixed |
| The integration tests wrote outside the workspace — they relied on the hole above | S3 | fixed |

**Verdict: PASS** — `docs/audits/whole-codebase.md`; 310 unit + 27 integration
tests; tag `whole-codebase-audited`.

## Modes and providers (2026-11-14)

| Item | Status | Note |
| --- | --- | --- |
| Fast mode (Groq, `gpt-oss-120b`) | done | own failover chain |
| Thinking mode (NVIDIA NIM, `deepseek-ai/deepseek-v4.1-flash`, `reasoning_effort: medium`) | done | the effort survives a failover |
| Onboarding collects both keys | done | walkthrough step 2 → SecretStorage, never the settings |
| Customizable later | done | the same command changes a key; the chains are in Settings |
| The extension never calls a provider | verified | only TrueForge's settings API receives the key |
| Audit | **PASS** | `docs/audits/modes.md`; 3 findings fixed, tag `modes-audited` |

## Status: all planned phases are done and audited

| Phase | Tag |
| --- | --- |
| 0 Foundations | phase-0-audited |
| 1 Extension shell and chat | phase-1-audited |
| 2 Editor MCP server | phase-2-audited |
| 3 Edit engine | phase-3-audited |
| 4 Approval gate and review | phase-4-audited |
| 5 Command execution | phase-5-audited |
| 6 Failover (G3) | phase-6-audited |
| 7 Inline edit (FR-11) | this commit |
| 8 Context assembly (FR-12) | 04dc7df |
| 9–10 Polish and packaging | this commit |
