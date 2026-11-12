# Phase 6 Audit — Failover (G3)

- **Date:** 2026-11-12
- **Range:** `phase-5-audited..HEAD` (f14cbb8 → working tree)
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **250/250** ✓,
test:int **16/16** ✓ (real VS Code), design-lint ✓.
`failover/` coverage: **96.6 % lines**.

Live exit gate (real TrueForge + fake OpenAI provider + real VS Code):
the primary model answered **429**, the turn continued on the fallback model,
the answer arrived, and exactly one notice was shown.

## A2 Conformance matrix (Phase 6 tasks + FR-7, G3)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 6.1 ErrorClassifier, table-driven, for the verified error shapes | Pass | `src/failover/classifier.ts`; `classifier.test.ts` (13 tests: 429, 5xx, timeout, reset, 401/403, quota, 400, context length, unknown) |
| 6.2 Policy, per-turn attempt tracking, 429 backoff with a 5 s cap, circuit breaker with a 60 s cooldown and a probe back to the primary | Pass | `src/failover/manager.ts`; `failover-manager.test.ts` (15 tests) |
| 6.3 Resume strategy (PATCH the session's model, continue the same session) + no re-running of tool calls that already completed | Pass | `SessionManager.sendTurn` (the retry loop); `ToolCallGuard` (the idempotency guard); `failover-resume.test.ts` |
| 6.4 Inline notice, status bar warning, model label on agent messages, Switch Model QuickPick, all-models-down error with Retry and Edit Models | Pass | `chatProvider.onFailover` (notice), `statusBar.setFailover`, `shortModelName` on the agent message, `forgeguard.switchModel`, the error with two actions |
| 6.5 Dev fault injection (429, 503, timeout, 401), dev flags only | Pass | `ForgeGuard: Dev: Inject 429/503/401/stall` + `Clear injected faults`; gated by `devFaultsEnabled()` and hidden from the palette |
| 6.6 Classifier table, state machine, end-to-end with an injected fault | Pass | `classifier.test.ts`, `failover-manager.test.ts`, `failover-resume.test.ts`, and the live integration gate |
| FR-7: ordered models, index 0 is the primary | Pass | `forgeguard.models` setting; `FailoverManager.active` |
| FR-7: 429 honors Retry-After up to a 5 s cap | Pass | `classifier.test.ts` ("honours Retry-After, capped at 5 seconds") |
| FR-7: at most one attempt per model per turn | Pass | `failover-manager.test.ts` ("tries each model at most once per turn") |
| FR-7: the breaker marks a model unhealthy for 60 s | Pass | `failover-manager.test.ts` ("marks a failed model unhealthy for 60 seconds") |
| FR-7: tool calls that already ran do NOT run again | Pass | `ToolCallGuard` wraps every registered tool; `failover-resume.test.ts` |
| FR-7 visibility: inline notice, status bar, log line, model label | Pass | four places, one notice per failover |
| Exit gate: an injected 429 completes the turn on the secondary with a visible notice | Pass | `test/integration/failover.test.ts` (live) |

## A3 Adversarial review

- **The failure arrives with HTTP 200.** The verified shape is a
  `turn.done {state: {status: 'error'}}` inside the stream. The classifier is
  fed that message, not just the HTTP status — the live gate proves it.
- **A 429 that keeps coming back.** One attempt per model per turn, so a turn
  cannot loop forever; when the list is exhausted the user gets a clear error.
- **A provider that is permanently broken (401).** Classified as
  provider-fatal: no failover, the error is shown as it is.
- **A request that is simply too big (400, context length).** Classified as
  request-fatal: failing over would not help, so the turn fails immediately.
- **Duplicated tool execution.** The biggest risk of a failover: the model may
  ask for the same tool again. Every registered tool runs through
  `ToolCallGuard`, which replays the first result instead of executing again.
  The guard is reset when a new user turn starts.
- **The breaker vs the per-turn budget.** They are independent: the budget is
  per turn, the breaker is 60 s. A model that failed stays out for a minute
  even across turns — documented in the tests.
- **Two models, one provider.** The live gate uses a provider with a failing
  model and a working one, so the failover is deterministic.
- **Secrets.** The provider keys live in TrueForge's settings; the extension
  never sees them.
- **The notice says what happened, once.** "Switched to Model B because Model
  A is rate-limited." — no exclamation marks, no blame (PRD 6.8).
- **Dead code:** none.

## A4 New negative tests (12)

| id | test | what it proves |
| --- | --- | --- |
| N51 | `classifier.test.ts` "does not fail over a request-fatal error" | a 400 is not retried |
| N52 | `classifier.test.ts` "treats an exhausted quota as provider-fatal" | a quota error is not retried |
| N53 | `classifier.test.ts` "treats an unknown error as unknown, which fails over once" | unknown failures fail over exactly once |
| N54 | `classifier.test.ts` "honours Retry-After, capped at 5 seconds" | no long waits |
| N55 | `failover-manager.test.ts` "tries each model at most once per turn" | no infinite retry loop |
| N56 | `failover-manager.test.ts` "does not switch back to a model that is still unhealthy" | the breaker is respected |
| N57 | `failover-manager.test.ts` "returns traffic to the primary after the cooldown" | the probe works |
| N58 | `failover-manager.test.ts` "gives up cleanly when there are no models at all" | an empty model list is handled |
| N59 | `failover-resume.test.ts` "does not run a tool twice when the model asks again" | no duplicated execution |
| N60 | `failover-resume.test.ts` "does not confuse two different calls" | the guard keys on the arguments |
| N61 | `failover-resume.test.ts` "forgets the calls of the previous turn" | the guard does not leak across turns |
| N62 | `failover.test.ts` (integration) "continues the turn on the fallback model and tells the user once" | the live end-to-end behavior |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S1 | the failover manager could not find a model to switch to when the breaker was cooling down: the user got "give up" instead of a clear "no model available" reason | fixed (the decision carries a notice) |
| F2 | S2 | `scripts/setup-trueforge.mjs` was referenced by `npm run setup` but did not exist | fixed (written: it registers the development provider and the real ones from `.env`) |
| F3 | S2 | the development provider only had one model, so a failover could not be demonstrated | fixed (a failing model was added; the fake provider fails any model named `failNNN`) |
| F4 | S3 | the test asserted on the FIRST `turn.done` (the failure) instead of the last one | fixed |

## A6 Fix

F1–F4 fixed. `npm run verify` re-run: **exit 0** (250/250 unit, 16/16
integration, design-lint ✓).

## A7 Verdict

**PASS** — tag `phase-6-audited`.

### Known limitation (documented)

A failover continues the SAME session with the same user message, so the model
sees the original request again. Tools that already ran are protected by the
idempotency guard, but the model may still repeat its reasoning. The
alternative (a fresh session seeded with a condensed transcript) is the
documented fallback of the PRD; it was not needed.
