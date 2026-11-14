# Audit — the two modes, the providers and the key handling

- **Date:** 2026-11-14
- **Range:** `71de635` (the modes and providers) plus a re-check of the whole
  codebase after the change
- **Auditor:** build agent (autonomous)

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, unit **325/325** ✓,
integration **31/31** ✓ (real VS Code), design-lint ✓.

Coverage unchanged where it matters: `edits/` 97.3 %, `mcp/tools` 100 %,
`failover/` 96.8 %.

Live check against the running TrueForge: the provider manifest this build
sends (`type: custom`, `base_url`, `models` with `reasoning_efforts`) is
**accepted**, and the key comes back **redacted** (`gsk-***REDACTED***-eck`).
The throwaway registration was deleted afterwards.

## A2 Conformance matrix

| Criterion | Status | Evidence |
| --- | --- | --- |
| Two modes: Fast and Thinking | Pass | `src/providers/presets.ts` (`MODES`); the mode pill in the chat; `trueguard.mode` |
| Fast → Groq `gpt-oss-120b` | Pass | `modeById('fast').defaultModel` |
| Thinking → NVIDIA NIM `deepseek-ai/deepseek-v4.1-flash` | Pass | `modeById('thinking').defaultModel` |
| The keys are collected during onboarding | Pass | the walkthrough's second step (*Add your providers*) runs `trueguard.configureProviders` |
| The keys are customizable later | Pass | the same command changes a key; the models are Settings → *Modes* |
| The keys never leave the secret storage | Pass | `key-handling.test.ts`: the key is in SecretStorage, not in the settings, not in the tree, not in a log, not in the chat |
| The extension never calls a provider itself | Pass | the only provider URLs in `src/` are the `base_url` values of the manifest TrueForge receives; the extension talks to `localhost:8790` only |
| The agent loop stays inside TrueForge | Pass | the models are referred to by their TrueForge name (`groq/…`, `nvidia/…`) |
| Each mode has its own failover chain | Pass | `configuredModels()` prefers `modes.<mode>.models`, falls back to `trueguard.models` |
| The user's own model list is never overridden | Pass | the chains start empty and are filled **only** for providers that are registered in TrueForge |
| The Thinking mode asks for depth | Pass | `reasoning_effort: medium` is sent with the model — and it survives a failover |
| A missing provider is explained, not silently failing | Pass | `checkProviderSetup()` warns with a button to the setup command |

## A3 Adversarial review

- **The failover dropped the reasoning effort.** The model was patched with
  `{name}` only, so a turn that moved to the fallback model in Thinking mode
  silently lost its `reasoning_effort`. **F1 fixed** (S2): the effort travels
  with the model.
- **The mode's defaults silently overrode the user.** The per-mode chains
  shipped with package.json defaults, so `trueguard.models` — the setting the
  user configures — was ignored. **F2 fixed** (S1): the chains start empty and
  are filled only for providers that are registered.
- **A fresh install had no way to run.** With no provider registered, every
  turn would fail with a provider error. **F3 fixed** (S2): the extension
  checks the registered providers and says which one is missing, with a
  button to the setup.
- **The key could leak into the tree.** The manifest builder is the only place
  that touches a key. **F4 verified** (no fix needed): `key-handling.test.ts`
  walks `src/`, `webview/`, `docs/`, `examples/` and `scripts/` and fails if
  the key appears anywhere.
- **A cancelled prompt.** The provider is skipped, not registered with an
  empty key; the user is told. Covered by a test.
- **A failed registration.** The failure is reported per provider and the
  loop continues with the next one. Covered by a test.
- **The keys in the logs.** Only the provider *id* is logged, never the key.
- **The extension calling a provider directly.** The only provider URLs in
  the source are the `base_url` values of the manifest that TrueForge
  receives. There is no fetch to groq.com or nvidia.com anywhere.

## A4 New negative tests (4 key-handling + 4 mode tests)

| id | test | what it proves |
| --- | --- | --- |
| N75 | `key-handling.test.ts` "never reaches the settings file" | the key is nowhere in the repository |
| N76 | `key-handling.test.ts` "is stored in the secret storage, not in the settings" | the settings never see it |
| N77 | `key-handling.test.ts` "is sent to TrueForge and nowhere else" | the manifest carries the key and nothing else |
| N78 | `key-handling.test.ts` "the provider presets carry no key" | only a shape hint (`gsk_…`) is in the source |
| N79 | `modes.test.ts` (integration) "starts in Fast mode" | the default mode is Fast |
| N80 | `modes.test.ts` "reads the mode from the settings" | switching the mode changes the model and the effort |
| N81 | `modes.test.ts` "uses the chain of the active mode when it has one" | the mode's chain wins over the generic one |
| N82 | `providers.test.ts` (8 tests) | the manifests, the onboarding and its failure paths |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S2 | a failover dropped the reasoning effort of the Thinking mode | fixed |
| F2 | **S1** | the per-mode chains' defaults silently overrode the user's own `trueguard.models` | fixed |
| F3 | S2 | a fresh install with no provider failed every turn with no explanation | fixed |
| F4 | — | the key handling was audited: no leak path found | verified by test |

## A6 Fix

F1–F3 fixed. `npm run verify` re-run: **exit 0** (325/325 unit, 31/31
integration, design-lint ✓).

## A7 Verdict

**PASS** — tag `modes-audited`.

### What the owner still has to do

The **keys**. TrueGuard cannot invent them: paste the Groq key and the NVIDIA
NIM key into *TrueGuard: Configure Providers* (the walkthrough's second step)
before the demo, and confirm that the Fast mode answers and that the Thinking
mode answers. Everything else about the modes is in place and tested.
