# ForgeGuard: Product Requirements and Autonomous Build Plan

Owner: Aryan Kudtarkar. Event: TrueFoundry Forge-a-thon, Techfest 2026-27, IIT Bombay. Builder: Oh My Pi (autonomous). Window: 3 days, solo. Version 1.0.

## 0. How to use this document

This is the single source of truth for the build. Read all of it before writing code.

- Sections 1 to 9 define what to build and why. Sections 10 to 14 define how, in what order, and how to check your own work.
- MUST, SHOULD and MAY follow RFC 2119. P0 means required for the demo. P1 means build only after every P0 phase has passed its audit.
- Items tagged \[VERIFY\] come from third-party sources (public repos of other hackathon participants), not official docs. Confirm each one in Phase 0 against the installed packages and record the result in docs/TRUEFORGE\_NOTES.md. If a symbol is not in the installed type definitions, it does not exist. Never invent an API.
- If docs/brief.pdf exists, it is the official hackathon brief. It overrides this document on mandatory requirements, scoring and submission format. Log every conflict in docs/DECISIONS.md.
- Never edit this document. Propose changes in docs/DECISIONS.md.

## 1. Summary

ForgeGuard is a VS Code extension that puts an autonomous coding agent inside the editor. The agent loop runs entirely on TrueForge (@truefoundry/trueforge, TrueFoundry's open-source agent harness). The extension is a client: it creates sessions, streams events, exposes editor capabilities to the agent as MCP tools, and owns everything the user sees and touches.

Its difference is trust. It makes three guarantees:

- **G1. Nothing reaches disk without explicit, hunk-level approval.**
- **G2. The agent can never claim an edit succeeded unless the extension has verified it.**
- **G3. A provider failure (429, 5xx, timeout, auth error) does not end the session.** The turn continues on a fallback model, visibly.

## 2. Problem and evidence

Existing agents (Cline, Continue, Roo Code) work, but break trust in specific, repeatable ways. Evidence below is from public GitHub issues and write-ups. Reddit threads could not be retrieved during research, so do not cite Reddit as evidence anywhere.

| # | Pain | Evidence | Product response |
| --- | --- | --- | --- |
| 1 | Phantom success: agent says edits applied, file unchanged | Continue issue 7909 (no diff shown, green check, file untouched) | G2: post-apply verification, truthful tool result |
| 2 | Corrupted edits: file overwritten with model reasoning, or diff deletes half the file | Continue issues 9379 and 7143 | Targeted old/new edits only, extension-computed diff, verification, auto-rollback |
| 3 | Large files break editing | Continue issues 6525 and 7544 (file or range too large, token limit while streaming diffs) | Never whole-file rewrite of existing files. Ranged reads. Small localized edits |
| 4 | Rate limits end sessions | Rate limiting (429) is the most common single error class in Cline's issue tracker; the usual fix is manual provider switching | G3: automatic, visible failover |
| 5 | Approval is all-or-nothing, and prompts get lost | Cline offers per-action approval or YOLO mode, which can delete files and push to version control; approval prompts scroll out of view and look like a hang | Hunk-level review in a persistent native view, status bar cue, no auto-approve for edits in v1 |
| 6 | Context bloat | One git diff or test trace can add 4,000 to 10,000 tokens to history; third-party proxies exist only to compress and add fallback | Output caps, head and tail elision, ranged tools (P1) |

Note: do not claim a competitor lacks a feature unless Phase 0 or the demo prep verifies it.

## 3. Vision, principles, non-goals

Principles:

- **Verify, do not trust.** Every claim shown to the user or the agent is backed by a check.
- **Show, do not surprise.** Nothing is written, run or switched without a visible, explained step.
- **Degrade gracefully.** Every failure has a plain-language cause and a next action.
- **Native first.** It should feel like VS Code shipped it.
- **Small surface, deep polish.** Few features, each complete in every state.

Non-goals (v1): inline autocomplete, multi-agent orchestration, hosting or training models, telemetry, cloud sync, other editors, auto-approval of edits.

## 4. Users and scenarios

Primary user: a developer who uses agents on real repositories and has been burned by one saying done when it was not.

- S1. Ask for a refactor touching 3 files. Review each hunk. Accept some, reject one. Disk matches exactly what was accepted. Undo works.
- S2. Provider rate-limits mid-task. The task finishes on the fallback model and the user is told once, calmly.
- S3. User edits a file while a proposal is pending. The proposal is blocked as stale, not applied over their work.
- S4. Agent wants to run a command. The user sees the exact command and approves or denies.
- S5. Fresh machine: clone, install, start TrueForge, run a first task in under 5 minutes.

## 5. Functional requirements

### FR-1 Setup and TrueForge lifecycle (P0)

- Command ForgeGuard: Start TrueForge spawns `npx @truefoundry/trueforge@latest` \[VERIFY\] as a child process, with the environment needed to allow loopback MCP calls \[VERIFY: OUTBOUND\_URL\_ALLOWED\_HOSTS or NETWORK\_POLICY\_ENABLED=false\]. Output streams to the ForgeGuard log channel.
- Health check against baseUrl (setting forgeguard.trueforge.baseUrl, default http://localhost:8790 \[VERIFY\]). States: Stopped, Starting, Ready, Failed.
- The extension kills only a server process it spawned, on deactivate.
- Provider keys live in SecretStorage and are never logged. Registering models, agents and the MCP connector with TrueForge happens through the verified SDK or REST path \[VERIFY\].
- AC: from a clean state the user reaches Ready in 3 clicks or fewer. Each failure state names the cause and offers one fix action.

### FR-2 Chat and sessions (P0)

- Create a session, send turns, consume the SSE event stream, render tokens incrementally. A Stop button cancels the turn.
- The active file and selection attach automatically as a removable context chip.
- New Chat command. The last 20 sessions persist per workspace in workspaceState.
- AC: first streamed token renders within 100 ms of the event arriving. Stop halts rendering and cancels the server turn within 1 s. A TrueForge restart is survived without a stuck UI.

### FR-3 Editor tools over embedded MCP (P0)

The extension runs an MCP server (official @modelcontextprotocol/sdk, Streamable HTTP) on 127.0.0.1, default port 45821, next free port if busy, re-registering the connector with TrueForge when it changes. Tools, each with a zod schema:

- read\_file(path, startLine?, endLine?): numbered lines, default cap 400 lines, returns totalLines and contentHash. Reads the dirty buffer if the file is open.
- list\_files(glob?, maxResults): respects .gitignore.
- search\_text(pattern, glob?, isRegex?, maxResults): returns path:line: snippet.
- get\_diagnostics(path?): from vscode.languages.getDiagnostics.
- get\_editor\_context(): active file, selection, visible range, open tabs.
- propose\_edit(changes): see FR-4.
- run\_command(command, cwd?, timeoutSec?): see FR-6.

AC: every tool has a unit test for success, bad input, path escape and cap behavior. Auth: bearer token, or an unguessable path segment if TrueForge cannot send headers \[VERIFY\]. Reject requests with a non-loopback Host header.

### FR-4 Safe edit pipeline (P0)

Input of propose\_edit: `changes: [{ path, kind: modify | create | delete, edits?: [{oldText, newText}], content?, expectedBaseHash? }]`.

Rules:

- modify uses exact-match edits. Each oldText MUST match exactly once in the current text (after EOL normalization). Zero or many matches returns a structured error to the agent with the nearest candidate line numbers, before any UI appears.
- Whole-file replacement of an existing file is not allowed. create is only for paths that do not exist. Edits MUST NOT overlap.
- Writes to .git and outside workspace folders are refused.
- The extension computes the diff itself, never trusting a diff from the model. Hunks come from a zero-context Myers diff (jsdiff) of base text vs proposed text, so hunks are independent and any subset can be applied safely.
- Approval uses TrueForge's tool approval gate: propose\_edit is listed in requireApprovalForTools \[VERIFY\]. The extension receives the approval-required event, builds the review, and sends allow or deny \[VERIFY event names\]. When the gate releases the tool, the MCP handler applies exactly the hunks the user accepted.
- Apply uses a single WorkspaceEdit so VS Code undo works. Apply is serialized per file.
- Conflict check: just before applying, the base hash must still match. If not, nothing is applied and the result is status conflict.
- Verification: (a) buffer text equals expected text, (b) after save, disk content equals expected text modulo the file's EOL. Failure triggers automatic rollback to the pre-edit snapshot and the result is verification\_failed.
- Preserve BOM, EOL style, trailing newline and encoding.
- Result returned to the agent is truthful JSON: `{ status: applied | partially_applied | rejected | conflict | verification_failed | invalid, files: [{ path, hunksProposed, hunksAccepted, verified, newHash }], note }`.

Change lifecycle: Proposed, ReviewPending, then Rejected or Accepted (full or partial), Applying, then Verified, VerificationFailed (rolled back) or Conflict.

AC: with 3 hunks proposed and 2 accepted, disk equals base plus exactly those 2 hunks and the agent is told so. Randomized tests prove apply-all equals proposed text and apply-none equals base. A forced corruption is caught and rolled back. CRLF, BOM, unicode and dirty-buffer cases pass.

### FR-5 Review experience (P0)

Specified in section 6. Requirements: pending reviews live in a persistent Changes view, never only in a transient notification. Pending approvals never auto-expire. Stopping a turn denies all pending approvals for it. Every review action has a keyboard path.

### FR-6 Command execution (P0)

- run\_command always requires approval through the gate. No auto-approve in v1.
- The approval card shows the verbatim command and cwd. Risky patterns (rm -rf, git push, sudo, curl piped to a shell, chmod -R) get a warning style. They are highlighted, not silently blocked.
- Runs with a shell, cwd inside the workspace, default timeout 120 s (setting). Output streams to a ForgeGuard Commands output channel. The result to the agent is exit code, duration and the last 16 KB of combined output with an explicit truncation marker.
- Cancel kills the whole process tree (taskkill /T /F on Windows).

### FR-7 Failover (P0)

- Setting forgeguard.models: ordered list of model profiles, each with id, label and the identifier TrueForge expects \[VERIFY\]. Index 0 is primary.
- Error classes: transient (429, 500, 502, 503, 504, timeout, connection reset, stream stall), provider-fatal (401, 403, quota exhausted), request-fatal (400, context length exceeded; not failed over), unknown (treated as transient once).
- Behavior: for 429 honor Retry-After up to a 5 s cap, then switch. At most one attempt per model per turn. A circuit breaker marks a model unhealthy for 60 s, after which a probe returns traffic to the primary.
- Idempotency: tool calls that already ran in a failed turn MUST NOT run again. The resume strategy is chosen in Phase 0 from \[VERIFY\] findings: preferred is continuing the same TrueForge session with a model override; fallback is a new session seeded with a condensed transcript.
- Visibility: inline notice row in chat, status bar warning state, log line, and a small model label on each agent message.
- Dev-only fault injection: commands to inject 429, 503, timeout or 401 on the next model call, and to corrupt the next write (for demo scenario D3). Enabled only in Development mode or when forgeguard.dev.enableFaultInjection is true.

AC: an injected 429 on the primary completes the turn on the secondary with a visible notice and no duplicated tool execution. With every model down, the user gets a clear error with Retry and Edit Models actions.

### FR-8 Observability and settings (P0)

- LogOutputChannel named ForgeGuard with levels. A redacted JSON event log per session in globalStorage, opened by ForgeGuard: Show Session Log.
- All configuration through contributed settings, using the native Settings UI. No custom settings page.

### FR-9 Context hygiene (P1)

Every tool result is capped (default 16 KB). Over-cap output is elided head and tail with a marker that tells the agent how to request a range.

### FR-10 Checkpoints (P1)

Each applied change set stores a snapshot. A Revert action on the receipt card restores it, blocked with a confirmation if the file has diverged since.

## 6. UX and design specification

### 6.1 Principles, translated from Apple's Human Interface Guidelines

- **Clarity:** plain words, strong hierarchy, one primary action per surface.
- **Deference:** the code and the diff are the hero. Chrome stays quiet.
- **Depth:** progressive disclosure. Summary first, detail on demand (collapsed tool rows, expandable receipts).
- **Consistency:** reuse VS Code components and conventions. Do not invent new ones.
- **Direct manipulation:** click a hunk to see it, check it to accept it.
- **Feedback:** every action shows state: pending, applying, verified.
- **User control and forgiveness:** nothing irreversible without undo or revert. Confirm only truly destructive actions.
- **Accessibility:** complete keyboard use, screen reader labels, meaning never carried by color alone.

### 6.2 Native-first rules (MUST)

- Prefer native surfaces: TreeView, diff editor, QuickPick, StatusBarItem, viewsWelcome, walkthroughs, Settings UI. Use a webview only for chat.
- Colors come only from `--vscode-*` CSS variables in the webview and ThemeColor in native UI. No hex or rgb literals in source.
- Icons are codicons only (bundle @vscode/codicons), plus one monochrome SVG for the Activity Bar. Do not depend on @vscode/webview-ui-toolkit (deprecated).
- Type inherits `--vscode-font-family` and `--vscode-font-size`; code uses `--vscode-editor-font-family`. Three text styles only: body, secondary (reduced opacity), caption. Hierarchy comes from weight and opacity, not size jumps.
- Spacing scale 4, 8, 12, 16, 24 px. Corner radius 6 px. 1 px borders from `--vscode-widget-border` or `--vscode-panel-border`. No shadows, no gradients.
- Motion: 120 ms ease-out for fades and height changes only, and none under prefers-reduced-motion.
- Webview hygiene: strict CSP with nonce, no remote resources, typed and validated message protocol, localized strings in one module.

### 6.3 Information architecture

- Activity Bar container ForgeGuard with two views: Chat (webview) and Changes (tree). Users may drag either to the Secondary Side Bar.
- Editor area: the native diff editor for review.
- Status bar: one item, left side.
- Command Palette: ForgeGuard: New Chat, Start TrueForge, Stop Turn, Switch Model, Review Next Change, Accept Hunk, Reject Hunk, Accept All, Reject All, Show Session Log (plus dev-only fault commands).

### 6.4 Chat view

Anatomy, top to bottom: message list, then the composer.

- Composer: multi-line field, Enter sends and Shift+Enter adds a newline. A context chip row above it. A model pill below it showing the current model, which opens the Switch Model QuickPick. While running, Send becomes Stop.
- User message: right-aligned, subtle surface. Agent message: full-width prose, rendered Markdown, code blocks in editor font with a Copy button. No bubbles for the agent.
- Tool activity: one collapsed line each, such as `Read src/app.py`, with a chevron to expand details.
- Change card: file name, +added and -removed counts, a status chip, and one primary button: Review. Status chips: Awaiting review, Applying, Verified, Partly applied, Rejected, Conflict, Failed check.
- Failover notice: neutral system row with the sync icon: `Switched to Model B (Model A is rate-limited).`
- States to design and test: Empty (title, one sentence, three starter chips), Idle, Streaming, Awaiting review, Failover active, Server not running (viewsWelcome with Start TrueForge button), Not configured (add a model), Error.

### 6.5 Changes view

A tree. Group: Awaiting your review. File node: path, description `+12 -3`. Hunk child: `Lines 42 to 58` with a checkbox (TreeItem checkboxState). Inline actions on file nodes: Accept, Reject. View title actions: Accept Selected, Reject All. Empty state via viewsWelcome: `No changes waiting.` Clicking a file or hunk opens the native diff (virtual document via TextDocumentContentProvider vs the real file) scrolled to that hunk \[VERIFY reveal via show options\].

### 6.6 Review flow

1. Agent proposes. The Changes view reveals, the status bar shows `$(eye) 2 to review`, and if the view is hidden one non-modal notification appears with Review.
2. User clicks a hunk. The diff opens beside it. Checked means accept. All hunks start checked.
3. User unchecks any they reject, then presses Apply Selected (primary).
4. The card moves to Applying, then Verified. A receipt row states: `Applied 2 of 3 changes. Verified against disk.`
5. Undo (Ctrl or Cmd+Z) works in the editor. Keyboard: Accept Hunk and Reject Hunk bound to non-conflicting chords, checked in Phase 7.

Experiment (P1): CodeLens above hunks inside the diff editor. Ship only if verified to work.

### 6.7 Status bar item

- Idle: `$(shield) ForgeGuard`. Working: `$(loading~spin) Working`. Pending: `$(eye) 2 to review`.
- Failover active: `$(warning) Model B`, using the warning background. Server down: `$(error) TrueForge offline`, using the error background.
- Click opens the relevant QuickPick or view. Tooltip explains the state in a full sentence.

### 6.8 Microcopy

Calm, plain, specific, no exclamation marks, no blame.

| Moment | Copy |
| --- | --- |
| Review banner | Review 3 changes. Nothing is written until you apply. |
| Applied | Applied 2 of 3 changes. Verified against disk. |
| Verification failed | The file did not match what you approved, so it was restored. Nothing was lost. |
| Conflict | This file changed after the agent proposed edits. Review again to continue. |
| Failover | Switched to Model B because Model A is rate-limited. |
| Server down | ForgeGuard can not reach TrueForge. Start it, or check the address in Settings. |
| All models down | No model is available right now. Retry, or edit your model list. |

### 6.9 Accessibility

- Chat list uses role log with a polite live region, throttled so streaming is not read token by token.
- Focus returns to a sensible element after every action. Every control has an accessible name.
- Status uses icon plus text, never color alone. Verify in Light, Dark and High Contrast themes.

### 6.10 Onboarding

A native walkthrough (contributes.walkthroughs) with three steps: Start TrueForge (button), Add your models (opens settings), Try a first task (inserts a sample prompt).

## 7. Architecture

Single extension host process, TypeScript strict, bundled with esbuild.

| Module | Responsibility |
| --- | --- |
| core/ | activation, dependency wiring, disposables |
| trueforge/ | server manager, SDK client, SSE events, sessions, approvals |
| mcp/ | MCP server, tool registry, path guard, caps, auth |
| edits/ | normalize, match, hunks, store (state machine), apply, verify, snapshot |
| review/ | Changes tree provider, diff content provider, decision store |
| failover/ | classifier, policy, circuit breaker, resume strategy |
| ui/ | chat webview provider, status bar, QuickPicks, walkthrough |
| util/ | logger, hashing, zod schemas, mutex, truncation |

Edit data flow:

1. Agent calls propose\_edit. TrueForge pauses at the approval gate and emits the approval-required event \[VERIFY\].
2. The extension validates args and computes hunks from the live buffer or disk. Invalid input goes back to the agent immediately.
3. ChangeStore enters ReviewPending and the Changes view and chat card update.
4. The user decides. The extension sends allow (if any hunk accepted) or deny, and stores the hunk decision keyed by the correlation key found in Phase 0 \[VERIFY: tool call id or args hash\].
5. TrueForge calls the MCP propose\_edit handler. The handler reads the decision, re-checks the base hash, applies via WorkspaceEdit, saves, verifies, and returns the truthful result.
6. The chat card and receipt update from ChangeStore events.

Key types (illustrative, finalize in code):

```ts
type ChangeState = 'proposed'|'reviewPending'|'rejected'|'applying'|'verified'|'verificationFailed'|'conflict';
interface Hunk { id: string; oldStart: number; oldLines: number; newLines: string[]; }
interface FileChange { path: string; baseHash: string; hunks: Hunk[]; accepted: Set<string>; }
interface ApplyResult { status: string; files: { path: string; hunksProposed: number; hunksAccepted: number; verified: boolean; newHash?: string }[]; note: string; }
interface ModelProfile { id: string; label: string; ref: string; }
```

Concurrency: one active turn per session. Applies are serialized per file by a mutex. Hashes are sha256 of text with EOL normalized to LF.

## 8. Security and privacy

- MCP server binds 127.0.0.1 only, authenticates every request, validates the Host header, and uses zod on all inputs.
- Every path is resolved with realpath and MUST stay inside a workspace folder. Writes to .git are refused. Reads of common secret files (.env, \*.pem, id\_rsa) require a setting to enable.
- Secrets only in SecretStorage. Logs redact keys and tokens.
- No telemetry. No network calls except to the configured TrueForge address.
- Webview CSP forbids remote content. All Markdown is sanitized (marked plus DOMPurify).

## 9. Non-functional requirements

- Compatibility: VS Code ^1.93.0 \[VERIFY\], Windows, macOS, Linux. Use vscode.Uri and fsPath correctly. Handle case-insensitive file systems.
- Performance: lazy activation (onView, onCommand). No synchronous work over 50 ms on the extension host. Diffing a 5,000-line file in under 200 ms.
- Reliability: every Disposable is registered. No unhandled rejections. Every external input is validated.
- Quality bar: TypeScript strict with no `any` outside validated boundaries. Coverage of at least 85% lines on edits/, failover/ and mcp/tools, and at least 90% on edits/.
- License: MIT. Dependencies limited to section 10 unless justified in docs/DECISIONS.md, and only MIT, BSD or Apache-2.0.

## 10. Repository layout and tooling

```
forgeguard/
  package.json  tsconfig.json  esbuild.mjs  eslint.config.mjs  vitest.config.ts
  src/  extension.ts  core/  trueforge/  mcp/  edits/  review/  failover/  ui/  util/
  webview/  main.ts  styles.css  protocol.ts
  test/  unit/  integration/  fixtures/
  tools/fake-trueforge/
  scripts/  design-lint.mjs  demo-prepare.mjs  setup-trueforge.mjs
  spikes/
  docs/  PRD.md  brief.pdf  reference/  BRIEF_NOTES.md  TRUEFORGE_NOTES.md
         PROGRESS.md  DECISIONS.md  BACKLOG.md  audits/  spikes/  DEMO.md  SUBMISSION.md
  .vscode/  launch.json  tasks.json
  README.md  LICENSE
```

docs/reference/ is the reference pack. The owner places TrueForge's README and any docs there before the build starts. The agent also saves what it reads from node\_modules there (README, key .d.ts files).

npm scripts (all MUST exist after Phase 0): build, watch, typecheck, lint, test:unit, test:int, design-lint, verify (typecheck, lint, test:unit, test:int, design-lint, in that order), package, trueforge (start the server), setup (register models, agent and MCP connector), fake-trueforge.

Dependencies (pin exact versions): typescript, esbuild, vitest, eslint, @types/vscode, @vscode/test-electron, @vscode/vsce, @modelcontextprotocol/sdk, zod, diff (jsdiff), @truefoundry/trueforge and its SDK \[VERIFY exact package names\], @vscode/codicons, marked, dompurify. Nothing else without a DECISIONS entry.

## 11. Operating protocol for the build agent

### 11.1 Rules

- R1. At the start of every session, read docs/PROGRESS.md, docs/DECISIONS.md and docs/TRUEFORGE\_NOTES.md first. They are your memory if your context is reset.
- R2. Work one task at a time. Keep each change small. After each task run `npm run typecheck && npm run lint && npm run test:unit`, then commit with a conventional message (feat, fix, test, chore, docs) and the task id.
- R3. Never invent an API. Check node\_modules type definitions or official docs. If unsure, write a 10-line spike and run it.
- R4. Write tests first for pure logic (edits/, failover/, util/).
- R5. No `any` outside validated boundaries. No ts-ignore without a DECISIONS entry.
- R6. Validate every external input with zod: MCP arguments, webview messages, TrueForge events.
- R7. Push every Disposable into context.subscriptions or an owning disposable.
- R8. Never weaken or delete a failing test to get a pass. Fix the cause.
- R9. If the same gate fails 3 times for the same cause, write a root-cause note in DECISIONS and try a different approach.
- R10. Stay inside the repository. Never run destructive commands outside it. Never print or commit secrets. Keep .env out of git.
- R11. Do not paste whole large files into your context. Read ranges.
- R12. When the spec is ambiguous, pick the default in section 14, log it in DECISIONS, and continue. Do not stop to ask, except at the owner gate G0 and on a BLOCKED audit.

### 11.2 Ledger files

- docs/PROGRESS.md: a table of task id, status (todo, doing, done, blocked), commit hash, one-line note. Update after every task. It is the resume point.
- docs/DECISIONS.md: dated entries: context, options, choice, reason. Includes every deviation from this PRD.
- docs/TRUEFORGE\_NOTES.md: every \[VERIFY\] item with status VERIFIED, CONTRADICTED or UNKNOWN, evidence (file and symbol, or spike transcript), and the chosen approach.
- docs/audits/phase-N.md: one audit report per phase (format below).

### 11.3 Audit and fix protocol (runs after every major phase, no exceptions)

1. **A1 Gates.** Run `npm run verify`. Record the result.
2. **A2 Conformance matrix.** For every FR and acceptance criterion owned by the phase, write a row: criterion, Pass, Partial or Fail, evidence (test name, file and line, or the manual steps you ran and what you saw). A criterion with no evidence is Fail.
3. **A3 Adversarial review.** Read `git diff phase-(N-1)-audited..HEAD` against this checklist: error paths and timeouts; disposables and leaks; races (double apply, stale hunk ids, concurrent turns); path and security rules (section 8); Windows paths, CRLF, BOM, unicode; every UI state in section 6 present; logs free of secrets; dead code and TODOs.
4. **A4 Break it.** Write at least 5 new negative tests aimed at the phase's riskiest behavior and run them.
5. **A5 Findings.** List each finding with severity. S0: data loss, security hole, crash, or any false claim of success. S1: an acceptance criterion failing. S2: polish. S3: nit.
6. **A6 Fix.** Fix all S0 and S1. Fix S2 if it takes under 15 minutes, else add it to docs/BACKLOG.md. Re-run A1 and A2.
7. **A7 Exit.** Max 3 audit-fix cycles per phase. If an S0 or S1 remains after 3, write BLOCKED in the audit file and stop for the owner. Otherwise tag `phase-N-audited` and update PROGRESS.

Audit report format: header (phase, date, commit), gate output summary, conformance matrix, findings table (id, severity, description, status, fix commit), and a final verdict line: PASS or BLOCKED.

## 12. Phased implementation plan

Suggested pacing for a 3-day window: Day 1 covers Phases 0 to 3, Day 2 covers Phases 4 to 6, Day 3 covers Phases 7 and 8 plus buffer. If behind, cut in this order: stretch items, FR-9, walkthrough polish, session history. Never cut G1, G2, G3 or the audits.

Each phase ends with its audit (section 11.3). Do not start the next phase until the audit verdict is PASS.

### Phase 0. Foundations and TrueForge discovery

Goal: a working skeleton, and verified knowledge of how TrueForge really behaves. This is how the build agent learns TrueForge: by reading the installed package and running small experiments, never from memory or from this PRD's \[VERIFY\] claims.

Tasks:

- 0.1 Create the repo, git, MIT LICENSE, package.json, strict tsconfig, esbuild config, eslint, vitest, .vscode/launch.json (Run Extension), and all npm scripts from section 10. `npm run verify` MUST pass on the empty skeleton.
- 0.2 If docs/brief.pdf exists, extract its text and write docs/BRIEF\_NOTES.md: mandatory tasks, scoring, submission format, dates. Compare with this PRD and log conflicts in DECISIONS. The brief wins.
- 0.3 Install the TrueForge packages. Read their README and the type definitions. Save the relevant excerpts to docs/reference/. Start the server with the documented command.
- 0.4 Build docs/TRUEFORGE\_NOTES.md. For every \[VERIFY\] item in this PRD, record VERIFIED, CONTRADICTED or UNKNOWN with evidence. Minimum items: server start command and Node requirement; default port; session create and send API; SSE event names and payload shapes; approval event and decision message; how an approval correlates to the later MCP call; model and agent registration; MCP connector registration and header support; the loopback allow-list setting; how to change the model for a session or turn; error shapes for 429, 5xx, timeout and 401.
- 0.5 Spike 1 (spikes/hello): create a session, send one prompt, print the raw events. Save the transcript to docs/spikes/.
- 0.6 Spike 2 (spikes/mcp-echo): a minimal MCP server using the official SDK exposing an echo tool. Register it with TrueForge. Prove the agent calls it.
- 0.7 Spike 3 (spikes/approval): require approval for the echo tool. Capture the approval-required payload. Send allow, then deny. Determine the correlation key between the event and the MCP call. This decides the DecisionStore design.
- 0.8 Spike 4 (spikes/failover): determine whether a session's model can be overridden per turn. If not, prove the fallback strategy: a new session seeded with a condensed transcript. Record the chosen strategy in DECISIONS.
- 0.9 Build tools/fake-trueforge: a local server emulating the verified subset (sessions, SSE stream, approval gate, MCP calls, injectable 429, 503, timeout and 401, stall). All later automated tests use it.
- 0.10 Create PROGRESS, DECISIONS and BACKLOG files.

Exit gate: verify passes. Spikes 1 to 3 demonstrably work with saved transcripts. No UNKNOWN remains for anything Phases 1 to 4 need, or a default is logged for it.

Audit focus: are the notes evidence-based? Does the fake server match real behavior (compare one recorded real transcript against the fake's output)?

**OWNER GATE G0 (hard stop).** After the Phase 0 audit passes, stop and ask the owner to review docs/TRUEFORGE\_NOTES.md and docs/BRIEF\_NOTES.md. Continue only after the owner replies. Wrong assumptions here would poison every later phase.

Owner prerequisites for Phase 0: network access for npm, a Node 22 or newer runtime, at least two model provider API keys supplied through .env (needed for failover), and the brief PDF in docs/.

### Phase 1. Extension shell, TrueForge client, streaming chat

Tasks:

- 1.1 extension.ts with lazy activation, contributes for the ForgeGuard Activity Bar container, the Chat and Changes views, commands, and the settings schema (baseUrl, models, timeouts, caps, dev flags).
- 1.2 Logger (LogOutputChannel), zod schemas folder, hashing and mutex utilities.
- 1.3 ServerManager: start, health check, stop, state events, and the viewsWelcome content for Stopped and Failed.
- 1.4 TrueForgeClient: typed wrapper over the verified API, SSE reader with abort, reconnect with backoff, event parsing through zod.
- 1.5 SessionManager: create, send turn, stop, persist the last 20 sessions in workspaceState.
- 1.6 Chat webview: CSP with nonce, typed message protocol, Markdown render with sanitization, streaming render batched per animation frame, composer, Send and Stop, context chip for the active file.
- 1.7 Status bar item with Idle, Working and Offline states.
- 1.8 Tests: unit tests against the fake server; an integration test that activates the extension and asserts the views and commands are registered.

Exit gate: with real TrueForge, a prompt streams an answer into the chat and Stop works. verify passes.

Audit focus: webview security (CSP, sanitization, message validation), stream cancellation, reconnect behavior, disposables.

### Phase 2. Editor MCP server and read-only tools

Tasks:

- 2.1 MCP server (Streamable HTTP) bound to 127.0.0.1 with the port fallback logic, token auth or path-secret auth per the Phase 0 finding, and Host header validation.
- 2.2 Path guard (realpath inside workspace, deny list) and the truncation utility (head and tail elision with marker).
- 2.3 Tools: read\_file, list\_files, search\_text, get\_diagnostics, get\_editor\_context, each with zod schemas and caps.
- 2.4 Connector registration with TrueForge on session start, re-registration on port change.
- 2.5 Chat: collapsed tool activity rows with expandable details.
- 2.6 Tests for each tool: success, bad input, path escape, symlink escape, cap behavior, dirty buffer read.

Exit gate: on the benchmark repo, the agent answers where a named function is defined using only the tools. Path-escape tests pass.

Audit focus: security tests, Windows paths, .gitignore handling, output caps.

### Phase 3. Edit engine (headless, no UI)

Tasks:

- 3.1 Text normalization: EOL detection and conversion, BOM, trailing newline, sha256 of LF-normalized text.
- 3.2 Edit matcher: exact unique match, structured errors for zero or multiple matches with nearest-candidate line numbers, overlap detection.
- 3.3 Hunk engine: zero-context Myers diff, stable hunk ids, a display grouping with context lines, and applyHunks(base, hunks, acceptedIds).
- 3.4 ChangeStore: the state machine from section 5 with typed events and illegal-transition guards.
- 3.5 Snapshot store and the Applier: single WorkspaceEdit, per-file mutex, base-hash conflict check, save.
- 3.6 Verifier: buffer check, then disk check, automatic rollback on mismatch, and the truthful ApplyResult builder.
- 3.7 Dev fault hook: corrupt the next write (active only when dev flags allow).
- 3.8 Tests: randomized tests over many generated files and edit sets proving apply-all equals proposed text, apply-none equals base, and any subset leaves untouched regions byte-identical. Integration tests on real TextDocuments: dirty buffers, CRLF, BOM, unicode, undo restoring the original, forced corruption caught and rolled back.

Exit gate: coverage at least 90% on edits/. All randomized and integration tests pass.

Audit focus: any path where success could be reported without verification. This is the most important audit in the project.

### Phase 4. Approval gate and review experience

Tasks:

- 4.1 Register propose\_edit in the MCP server and in the agent's approval-required tool list.
- 4.2 Approval listener: on the approval-required event, build the ReviewSession from the live file state.
- 4.3 DecisionStore keyed by the Phase 0 correlation key. The MCP handler awaits and consumes the decision.
- 4.4 Changes tree view: groups, file nodes, hunk nodes with checkboxes, inline actions, view title actions, viewsWelcome empty state.
- 4.5 Diff content provider (virtual document) and opening the native diff scrolled to the chosen hunk.
- 4.6 Commands, menus and keybindings (checked for conflicts), and the status bar pending-count state.
- 4.7 Chat change cards with status chips, and the receipt row after apply.
- 4.8 Conflict flow, stop-while-pending flow (deny all), and the invalid-edit flow (agent gets a structured error, no UI shown).
- 4.9 End-to-end tests with the fake server for accept all, partial accept, reject all, conflict, and cancel.

Exit gate on real TrueForge: the agent proposes a 3-hunk edit, the user accepts 2 and rejects 1, disk has exactly 2, the agent is told the truth, and undo works.

Audit focus: approval and decision correlation races, stale review after the file changes, leaked pending approvals, accessibility of the tree and diff flow.

### Phase 5. Command execution and context hygiene

Tasks:

- 5.1 run\_command tool: approval through the gate, verbatim command card, risky-pattern highlight.
- 5.2 Process runner: shell spawn, cwd guard, timeout, streamed Commands output channel, 16 KB tail capture, process-tree kill (Windows and POSIX).
- 5.3 Apply the truncation utility to every tool result (FR-9).
- 5.4 Chat rendering for command results with exit code and duration.
- 5.5 Tests: timeout, cancel mid-run, large output, non-zero exit, denied approval, cwd escape.

Exit gate: the agent runs the benchmark's test command after approval and reports results truthfully.

Audit focus: orphaned processes, output flooding, shell injection through cwd or arguments, Windows behavior.

### Phase 6. Failover

Tasks:

- 6.1 ErrorClassifier (table-driven) for the verified error shapes.
- 6.2 FailoverManager: policy, per-turn attempt tracking, 429 backoff with cap, circuit breaker with a 60 s cooldown and a probe back to the primary.
- 6.3 Resume strategy implementation as decided in Phase 0, with a guard that prevents re-running tool calls that already completed.
- 6.4 UI: inline failover notice, status bar warning state, model label on agent messages, Switch Model QuickPick, All-models-down error with Retry and Edit Models.
- 6.5 Dev fault injection commands (429, 503, timeout, 401) gated by dev flags.
- 6.6 Tests: classifier table, state machine, and end-to-end with the fake server injecting a 429 mid-stream and mid-tool-call.

Exit gate: demo scenario D2 passes on real providers with an injected fault and on the fake server.

Audit focus: duplicate tool execution, infinite retry loops, state left stuck after failure, notice spam.

### Phase 7. Design polish, onboarding, accessibility

Tasks:

- 7.1 scripts/design-lint.mjs: fails the build on hex or rgb literals, non-codicon icons, px font sizes in the webview, missing aria labels on buttons, and animations without a reduced-motion guard.
- 7.2 Walk every state in section 6.4 and 6.5 and fix gaps: empty, idle, streaming, awaiting review, failover, server down, not configured, error.
- 7.3 Walkthrough contribution with three steps.
- 7.4 Microcopy pass against the table in section 6.8. No state may show a raw error string.
- 7.5 Keyboard-only pass of the full flow. Screen reader labels. Check Light, Dark and High Contrast tokens.
- 7.6 Webview DOM snapshot tests (jsdom) for each state.

Exit gate: design-lint passes and the keyboard-only flow completes S1.

Audit focus: consistency with native VS Code behavior, visual hierarchy, density, focus management.

### Phase 8. Hardening, docs, packaging, demo

Tasks:

- 8.1 README: what it is, the three guarantees, a quick start that works from a fresh clone in under 5 minutes, configuration, troubleshooting, architecture overview, and the starting point declaration (built from scratch, no fork) \[VERIFY against the brief\].
- 8.2 Test the quick start in a clean directory, following only the README. Fix every gap.
- 8.3 scripts/demo-prepare.mjs: clones the benchmark repo (pallets/flask, pinned commit) and seeds demo prompts.
- 8.4 docs/DEMO.md: the timed demo script for D1 to D5 and a recording checklist.
- 8.5 Package the .vsix. Add third-party license notices.
- 8.6 Final whole-spec audit: a conformance matrix over every FR, G1 to G3 and section 9, plus a performance check.
- 8.7 docs/SUBMISSION.md with the pitch, screenshots list and links.

Exit gate: the Definition of Done in section 14 is fully ticked.

### Stretch (only after every phase is audited clean)

Checkpoints and Revert (FR-10), @file mentions, reject-with-reason sent to the agent, a session cost meter, and CodeLens in the diff editor.

## 13. Test strategy and demo scenarios

Test layers:

- **Unit (vitest):** edits/, failover/, util/, mcp tool handlers, classifiers, zod schemas.
- **Integration (@vscode/test-electron):** real TextDocuments, WorkspaceEdit apply and undo, views and commands registered, tree and diff providers.
- **End-to-end with tools/fake-trueforge:** deterministic runs of every flow, including injected faults.
- **Real TrueForge smoke tests:** run manually at each phase exit gate, with transcripts saved to docs/spikes/ or docs/audits/.
- **Fixtures:** small repos in test/fixtures (CRLF file, BOM file, unicode file, 5,000-line file, nested workspace) and the pinned Flask checkout from demo-prepare.

Demo scenarios (all MUST pass before submission):

| ID | Scenario | Expected result |
| --- | --- | --- |
| D1 | Multi-file refactor, 3 hunks, accept 2, reject 1 | Disk has exactly the 2 accepted hunks, receipt says Verified, agent told the truth, Undo works |
| D2 | Inject 429 on the primary model mid-task | Task completes on the fallback, one calm notice, no duplicated tool calls |
| D3 | Inject a corrupted write | Verification catches it, file auto-restored, UI says so, agent told verification\_failed |
| D4 | Edit the file by hand while a review is pending | Proposal marked Conflict, nothing applied, user can re-review |
| D5 | Agent runs the benchmark test command | Verbatim command shown, approved, output streamed, truthful result |
| D6 | Fresh clone, follow README only | First successful task in under 5 minutes |

Success metrics: zero silent bad writes across all demo runs, failover overhead under 8 s including backoff, review UI never more than 2 clicks from a pending change.

## 14. Defaults, risks, Definition of Done

### 14.1 Defaults for open questions (use these, log in DECISIONS, do not stop)

- Product name ForgeGuard. Extension id forgeguard, publisher forgeguard-dev. License MIT.
- Auto-save after apply: on. MCP port 45821 with fallback to the next free port.
- Models: index 0 is the strongest model the owner has a key for, index 1 is a model from a different provider so a provider outage can be demonstrated.
- Tool output cap 16 KB. Command timeout 120 s. Session history 20.
- Diff view side-by-side by default.
- Webview framework: none. Plain TypeScript, a small render module, and CSS using theme variables.

### 14.2 Risk register

| Risk | Mitigation |
| --- | --- |
| TrueForge API differs from the \[VERIFY\] claims or changes between versions | Phase 0 verification, pin exact versions, fake server mirrors verified behavior, owner gate G0 |
| Approval event cannot be correlated to the MCP call | Spike 3 decides. Fallback: perform the review inside the MCP handler and still use the gate for a coarse allow or deny |
| Loopback MCP calls are blocked by TrueForge's network guard | Record the allow-list setting in Phase 0 and set it in ServerManager |
| Mid-session model switching is unsupported | Fallback strategy: new session seeded with a condensed transcript (Spike 4) |
| Windows path and process differences | Use Uri and fsPath everywhere, test taskkill path, include Windows cases in tests |
| Out of time | Follow the cut order in section 12. Protect G1, G2, G3 and the audits |
| Agent loses context in a long run | PROGRESS, DECISIONS and NOTES files are the memory. Rule R1 |

### 14.3 Definition of Done

- [ ] Every P0 requirement in section 5 has a Pass row with evidence in the final audit.
- [ ] G1, G2 and G3 are demonstrated by D1, D3 and D2.
- [ ] `npm run verify` is green. Coverage targets met.
- [ ] design-lint passes. Keyboard-only flow works. Light, Dark and High Contrast checked.
- [ ] README quick start verified on a fresh clone. The .vsix installs and runs.
- [ ] D1 to D6 pass and DEMO.md is accurate.
- [ ] No open S0 or S1 findings. BACKLOG lists the rest.
- [ ] SUBMISSION.md complete, including the starting point declaration.
