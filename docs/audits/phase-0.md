# Phase 0 Audit — Foundations and TrueForge discovery

- **Date:** 2026-11-12
- **Commit:** beeb07d (audit A4 additions on top)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit 12/12 ✓,
test:int 1/1 ✓, design-lint ✓.

## A2 Conformance matrix (Phase 0 exit gate, PRD section 12)

| Criterion | Status | Evidence |
| --- | --- | --- |
| verify passes on skeleton | Pass | `/tmp/verify.log` exit 0; CI-relevant scripts all defined in package.json |
| brief.pdf extracted → BRIEF_NOTES.md with mandatory tasks, scoring, submission | Pass | docs/BRIEF_NOTES.md; 13 pages extracted; conflicts logged in DECISIONS |
| TrueForge packages installed, README/types read, server started | Pass | npx cache install; live server on :8790 (standalone, sqlite); openapi.json fetched |
| TRUEFORGE_NOTES covers all [VERIFY] items with evidence | Pass | docs/TRUEFORGE_NOTES.md — server cmd, Node req, port, sessions/turns/SSE, approval, correlation key, registration paths, network guard, model override, error shapes — all VERIFIED via live probes + spikes |
| Spike 1: session + prompt + raw events saved | Pass | spikes/hello/hello.mjs → docs/spikes/hello-transcript.md |
| Spike 2: MCP echo registered, agent calls it | Pass | spikes/mcp-echo/server.mjs (SDK 1.32.2 Streamable HTTP, stateless) → docs/spikes/mcp-echo-transcript.md |
| Spike 3: approval gate allow + deny, correlation key | Pass | spikes/approval/{approval,deny}.mjs → docs/spikes/approval-{allow,deny}-transcript.md; key = tool_call_id (+thread_id) |
| Spike 4: model override per session | Pass | spikes/failover/failover.mjs → PATCH agent.spec.model works; turn errors end HTTP 200 with turn.done error |
| fake-trueforge emulates verified subset | Pass | tools/fake-trueforge/server.mjs; 12 unit tests incl. fault injection; behavior mirrors real transcripts (event sequence, error envelope, redaction-style) |
| PROGRESS/DECISIONS/BACKLOG exist and maintained | Pass | docs/*.md updated per task |

## A3 Adversarial review (skeleton diff)

- Error paths: fake server 404 envelope matches real `{error:{message}}` shape ✓.
- Disposables/leaks: N/A yet (no vscode wiring beyond a channel); test child processes killed in afterAll ✓.
- Races: fake server scripted/fault state consumed-once semantics tested (NEG2) ✓.
- Security: fake server Host guard tested with spoofed header ✓; real guard found and documented (NETWORK_POLICY_ENABLED / OUTBOUND_URL_ALLOWED_HOSTS) ✓.
- Secrets: provider api_key redaction verified live on registration response ✓; no secrets committed ✓.

## A4 Negative tests (5 new)

NEG1 unknown fault mode rejected · NEG2 scripted events consumed once · NEG3 turns
on unknown session 404 · NEG4 PATCH unknown session 404 · NEG5 stream=false returns
JSON. All pass (test/unit/phase0-negative.test.ts).

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S2 | fake-trueforge accepted unknown fault modes silently | fixed (400 + validation) |
| F2 | S2 | SDK 1.0.4 in package.json lacked Streamable HTTP; upgraded to 1.32.2 | fixed |
| F3 | S3 | eslint `tseslint.config` helper unavailable without typescript-eslint meta package | fixed (plain flat config) |

## A6 Fix

F1 fixed with validation + NEG1 guards it. Re-ran A1: verify exit 0.

## A7 Verdict

**PASS** — tag phase-0-audited.

Owner gate G0: awaiting owner review of docs/TRUEFORGE_NOTES.md and
docs/BRIEF_NOTES.md before starting Phase 1.
