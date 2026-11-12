# Phase 1 Audit — Extension shell, TrueForge client, streaming chat

- **Date:** 2026-11-12
- **Range:** `phase-0-audited..HEAD` (88450ce → audit fixes)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit 26/26 ✓
(includes 2 live exit-gate tests against real TrueForge + fake OpenAI),
test:int 2/2 ✓ (real VS Code via test-electron), design-lint ✓.

## A2 Conformance matrix (Phase 1, PRD section 12 + FR-1/FR-2/FR-8)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 1.1 lazy activation, contributes (Activity Bar container, Chat + Changes views, commands, keybindings, settings schema, viewsWelcome) | Pass | package.json `contributes` (viewsContainers/views/viewsWelcome/commands/keybindings/configuration); integration test asserts settings schema + commands registered; activationEvents limited to onView/onCommand |
| 1.2 Logger (LogOutputChannel + redact), zod schemas, hash + mutex utils | Pass | src/util/logger.ts, hash.ts, mutex.ts; src/trueforge/schemas.ts (full verified event union) |
| 1.3 ServerManager start/health/stop/state events; viewsWelcome for Stopped | Pass | src/trueforge/serverManager.ts (spawn `npx @truefoundry/trueforge@latest` with OUTBOUND_URL_ALLOWED_HOSTS allowlist, health probe, kill only own child); viewsWelcome shown when view empty |
| 1.4 TrueForgeClient: SSE reader with abort, zod-validated events, reconnect with backoff | Pass | src/trueforge/client.ts (abort swallows read-loop errors, unknown events skipped); reconnect = capped exponential health backoff in serverManager.ts (interpretation logged in DECISIONS 2026-11-12) |
| 1.5 SessionManager create/send/stop, last-20 persistence | Pass | src/trueforge/sessionManager.ts (workspaceState, MAX_STORED_SESSIONS=20, one-turn guard synchronous, stop→abort+cancelSession) |
| 1.6 Chat webview: CSP+nonce, typed protocol, sanitized markdown, batched streaming, composer, Stop, context chip | Pass | webview/*; CSP `default-src 'none'` + script nonce; DOMPurify+marked for agent text, textContent for user/system; 16 ms flush batching; chip tracks active file/selection |
| 1.7 Status bar Idle / Working / Offline | Pass | src/ui/statusBar.ts — offline error style, Starting, Working (via onTurnStarted/onTurnEnded), failover, pending, idle; click actions |
| 1.8 Unit tests vs fake server; integration test activating the extension | Pass | 26 unit tests (fake-trueforge on :8795/:8794); 2 integration tests in real VS Code |
| Exit gate: with real TrueForge a prompt streams and Stop works | Pass | test/unit/exit-gate.test.ts (live): streams 'Hello from the fake model'; stall cancelled < 1.1 s via abort + cancel |
| FR-1 lifecycle (Start spawns child w/ env, health states, kill own child) | Partial | child spawn + env allowlist + states verified; SecretStorage/provider registration deferred per owner gate (keys at demo time; DECISIONS 2026-11-11) |
| FR-2 chat/sessions (stream, Stop ≤1 s, chip, 20 sessions, restart survived) | Pass | exit-gate live tests; NEG10 reconnect; chatProvider batched render; sessions persisted |
| FR-8 observability/settings (LogOutputChannel, redaction, contributed settings) | Partial | logger + redact + Show Session Log command ✓; redacted JSON event log in globalStorage not yet built (BACKLOG S2) |

## A3 Adversarial review (diff phase-0-audited..HEAD)

- **Error paths/timeouts:** health/create/patch/cancel all have AbortSignal timeouts; stream read-loop errors re-thrown unless aborted (user stop ≠ error). Turn errors arrive as HTTP 200 + `turn.done` error state and are surfaced in chat ("Turn failed: …") ✓.
- **Disposables/leaks:** found 5 undisposed subscriptions (ChatViewProvider ×3, StatusBar ×2) + untracked flush timer → fixed; both classes now Disposable, registered in context.subscriptions.
- **Races:** found sendTurn one-turn-guard race (guard passed, then `await ensureSession` before claiming) → fixed by claiming synchronously before first await; guarded by NEG8. newChat-during-turn is S3 (BACKLOG).
- **Webview security:** CSP default-src 'none', nonce'd script, cspSource styles, localResourceRoots scoped to out/webview. Found webview→host messages were unvalidated and protocol.ts falsely claimed a schemas file existed → fixed with zod schemas + drop-on-invalid (NEG6/NEG7).
- **Injection:** agent markdown through DOMPurify; user/system text via textContent ✓.
- **Logs/secrets:** child stdout/stderr redacted; no request/response bodies logged; api keys never touch the extension (registered directly in TrueForge during Phase 0) ✓.
- **Paths:** chatProvider chip uses fsPath prefix slice — fine on POSIX, wrong on Windows → S3 note (Phase 2 path guard owns real path handling).
- **UI states:** offline, starting, working, failed-to-reach, streaming placeholder ("…"), empty-state welcome ✓.
- **Dead code/TODOs:** switchModel QuickPick duplicated (extension.ts + chatProvider) → S3 note; no TODOs in src.

## A4 Negative tests (5 new, phase1-negative.test.ts)

- **NEG6** webview message schema rejects malformed/malicious shapes (wrong types, unknown command, oversized text, inverted selection) ·
- **NEG7** ChatViewProvider drops invalid webview messages without acting; valid ones still work ·
- **NEG8** concurrent sendTurn: second call rejected synchronously before any await (one-turn guard race) ·
- **NEG9** unparseable scripted SSE event is skipped; stream continues to turn.done ·
- **NEG10** ServerManager reconnects with backoff: Stopped → Ready once TrueForge appears, without spawning.

All pass. (Exit-gate skip logic also fixed: `skipIf` was evaluated at collection time before the probe ran; now skips at runtime via `ctx.skip()`.)

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S1 | webview→host messages not zod-validated; protocol.ts referenced a non-existent schemas file (false claim) | fixed (src/ui/chatProtocolSchemas.ts + drop-on-invalid) |
| F2 | S1 | sendTurn one-turn-guard race: guard checked before an awaited session creation, claim happened after | fixed (synchronous claim; NEG8) |
| F3 | S2 | 5 event subscriptions + flush timer never disposed | fixed (Disposable on ChatViewProvider/StatusBar) |
| F4 | S1 | task 1.7: status bar had no Working state | fixed (onTurnStarted + Working render) |
| F5 | S1 | task 1.4: "reconnect with backoff" absent | fixed (ServerManager capped backoff poll; interpretation in DECISIONS) |
| F6 | S2 | exit-gate tests silently skipped: skipIf evaluated before the probe | fixed (runtime ctx.skip) |
| F7 | S3 | newChat while a turn runs leaves it attached to a dropped session pointer | BACKLOG |
| F8 | S3 | Windows path slice in chipFor; QuickPick duplication | BACKLOG |

## A6 Fix

F1–F6 fixed; verify re-run after fixes: **exit 0** (26/26 unit incl. live exit gate, 2/2 integration, design-lint ✓). F7/F8 → docs/BACKLOG.md.

## A7 Verdict

**PASS** — tag `phase-1-audited`.
