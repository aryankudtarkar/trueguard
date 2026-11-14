# Phases 9–10 Audit — Design polish, onboarding, accessibility, hardening, packaging

- **Date:** 2026-11-12
- **Range:** `phase-6-audited..HEAD` (53e21e3 → working tree)
- **Auditor:** build agent (autonomous)
- **Note:** these are the two phases the amended plan moved last (see DECISIONS
  2026-11-12). Phase 7 (inline edit) and Phase 8 (context assembly) are the
  brief-driven anchors that were moved in front of them.

## A1 Gates

`npm run verify` → **exit 0**: typecheck ✓, lint ✓, test:unit **271/271** ✓,
test:int **19/19** ✓ (real VS Code), design-lint ✓ (now with the stricter
rules).

`npm run package` → `trueguard-0.1.0.vsix`, 11 files, 328 KB.

## A2 Conformance matrix (PRD 6.2–6.10, 8, 9, section 10)

| Criterion | Status | Evidence |
| --- | --- | --- |
| 6.2 Colors only from `--vscode-*`; no hex/rgb literals | Pass | design-lint (fails the build on a literal) |
| 6.2 Codicons only, no invented icons | Pass | design-lint fails on emoji; the webview uses typographic markers |
| 6.2 Type inherits the VS Code font; three text styles only | Pass | `webview/styles.css` (body, secondary, caption via opacity) |
| 6.2 Spacing scale 4/8/12/16/24, radius 6 px, 1 px borders | Pass | `webview/styles.css` |
| 6.2 Motion: 120 ms ease-out, none under reduced motion | Pass | the CSS has the `prefers-reduced-motion` guard; design-lint fails when it is missing |
| 6.2 Webview hygiene: strict CSP with nonce, no remote resources, typed and validated protocol | Pass | the CSP in `chatProvider.html`; every message is zod-validated |
| 6.4 The states: empty, idle, streaming, awaiting review, failover, server down, not configured, error | Pass | empty = viewsWelcome + placeholder; idle = the composer; streaming = the agent message; awaiting review = the change card; failover = the notice row; server down = viewsWelcome + a disabled composer; not configured = the composer says "Add a model in Settings"; error = the friendly error text |
| 6.5 The Changes view: group, file node with `+12 -3`, hunk nodes with checkboxes, inline actions, title actions, empty state | Pass | `src/review/changesTree.ts`; `package.json` (menus, viewsWelcome) |
| 6.7 The status bar: idle, working, pending, failover, offline | Pass | `src/ui/statusBar.ts` |
| 6.8 The microcopy: the PRD's sentences, no exclamation marks, no blame | Pass | the review banner, the receipt, the conflict and the failover notices follow PRD 6.8 |
| 6.9 Accessibility: role log, polite live region, accessible names, icon plus text | Pass | `role="log" aria-live="polite"`; every button has an aria-label (design-lint enforces it) |
| 6.10 A native walkthrough with three steps | Pass | `contributes.walkthroughs` (start, models, first task) |
| 8.1 README: what it is, the three guarantees, a quick start, configuration, troubleshooting, architecture, from-scratch | Pass | `README.md` |
| 8.2 The quick start works from a fresh clone | Partial | `npm install && npm run setup && npm run trueforge` works; the README says so. The five-minute claim was not timed end to end with a human (the owner should walk it once) |
| 8.3 `scripts/demo-prepare.mjs` | Pass | clones the benchmark, pins a commit, writes the demo prompts |
| 8.4 `docs/DEMO.md` | Pass | the timed script D1–D5 and the recording checklist |
| 8.5 The `.vsix` and the third-party notices | Pass | `trueguard-0.1.0.vsix` (328 KB, 11 files); the dependencies are MIT/BSD/Apache-2.0 |
| 8.7 `docs/SUBMISSION.md` | Pass | the pitch, the screenshots list, the brief mapping, the honest limitations |
| 9 TypeScript strict, no `any` outside validated boundaries | Pass | `tsc --noEmit` with `strict`; the only casts are documented |
| 9 Reliability: every disposable registered, no unhandled rejections | Pass | the audit of each phase; the extension registers every disposable |
| 9 Coverage: ≥ 85 % on mcp/tools, ≥ 90 % on edits/ | Pass | edits/ 97 %, mcp/tools 100 %, failover/ 97 % — enforced per module in `vitest.config.ts` |
| 9 License MIT, dependencies limited and permissive | Pass | MIT; MCP SDK (MIT), zod (MIT), jsdiff (BSD), marked (MIT), DOMPurify (Apache-2.0) |
| 10 All npm scripts exist | Pass | build, watch, typecheck, lint, test:unit, test:int, design-lint, verify, package, trueforge, setup, fake-trueforge |

## A3 Adversarial review

- **The packaged extension was unstyled.** `styles.css` was never copied into
  `out/webview`, where the webview loads it from. The integration tests never
  opened the chat view, so nothing caught it. **F1 fixed** (the build copies
  it; an integration test now asserts both assets are present).
- **The `.vsix` carried the whole repository** (144 files, 2 MB) because
  there was no `.vscodeignore`. **F2 fixed** (11 files, 328 KB).
- **`npm run setup` pointed at a script that did not exist.** The README and
  the quick start would have failed on a fresh clone. **F3 fixed**.
- **`scripts/demo-prepare.mjs` did not exist either.** **F4 fixed**.
- **The "Not configured" state was missing** (PRD 6.4): with no model the
  composer looked broken. **F5 fixed**: the composer says what to do and the
  input is disabled.
- **The review count never reached the chat.** The composer's "N to review"
  pill stayed at 0 while the status bar was right. **F6 fixed**.
- **The chat showed no microcopy of the review count.** Now the pill and the
  status bar agree.
- **Accessibility.** The tool-row and mention buttons had no accessible name
  (they had visible text, but no explicit label); the stricter design-lint
  caught both. **F7 fixed**.
- **The repository URL was missing**, so `vsce package` refused. **F8 fixed**
  (a placeholder the owner must replace before publishing).

## A4 New negative tests (2)

| id | test | what it proves |
| --- | --- | --- |
| N63 | `extension.test.ts` (integration) "ships the webview assets the chat needs" | the packaged chat is not unstyled |
| N64 | `design-lint.mjs` "buttons without an accessible name" | the lint catches unlabeled buttons |

## A5 Findings

| id | severity | description | status |
| --- | --- | --- | --- |
| F1 | S1 | the packaged extension rendered the chat unstyled (the stylesheet was never copied into `out/webview`) | fixed (build + integration test) |
| F2 | S2 | the `.vsix` shipped the whole repository (2 MB) | fixed (`.vscodeignore`) |
| F3 | S1 | `npm run setup` referenced a missing script | fixed (written) |
| F4 | S2 | `scripts/demo-prepare.mjs` did not exist | fixed (written) |
| F5 | S2 | the "Not configured" chat state was missing | fixed |
| F6 | S2 | the composer's review count never updated | fixed |
| F7 | S2 | two buttons had no explicit accessible name | fixed |
| F8 | S2 | `vsce package` refused: no repository URL | fixed (placeholder — the owner must replace it) |

## A6 Fix

F1–F8 fixed. `npm run verify` re-run: **exit 0** (271/271 unit, 19/19
integration, design-lint ✓). `vsce package`: 328 KB, 11 files.

## A7 Verdict

**PASS** — tag `phase-9-10-audited`.

### Known limitation (documented)

The five-minute quick start was not timed with a human on a clean machine;
the owner should walk the README once before the demo (checklist in
docs/DEMO.md).
