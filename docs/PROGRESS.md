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
| 2.2 Path guard (realpath containment, deny list, secret policy) + truncation utility | done | 6fa3602 | `.env`/`*.pem` need `forgeguard.allowSecretReads` |
| 2.3 read_file, list_files, search_text, get_diagnostics, get_editor_context | done | 6fa3602 | zod schemas, caps, dirty-buffer reads, 2 MB file limit |
| 2.4 Connector registration with TrueForge (POST/PUT, re-register on port change) | done | cbcc7d1 | proven live: `mcp.initialize` → `forgeguard-editor` |
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
| 3.7 Dev fault hook (corrupt the next write) | done | dbd0119 | command + `forgeguard.dev.enableFaultInjection` |
| 3.8 Randomized + real TextDocument tests | done | dbd0119 | CRLF, BOM, unicode, dirty buffer, undo, corruption |
| Phase 3 audit | **PASS** | — | docs/audits/phase-3.md; 7 findings fixed, edits/ coverage 96 % |

## Next: Phase 4 — approval gate and review experience
