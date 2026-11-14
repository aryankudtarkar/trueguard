# Decisions

Dated entries: context, options, choice, reason. Includes every deviation from the PRD.

## 2026-11-12 — Brief vs PRD conflicts (task 0.2)

- **Context:** docs/brief.pdf is authoritative. Compared against docs/PRD.md.
- **Conflicts found:**
  1. Brief makes **inline edit** (selection + keybinding → rendered diff) a mandatory
     capability worth 10 points (Task A). The PRD never specifies it as an FR.
     → **Added** an inline-edit feature requirement (Phase 4+, before demo).
  2. Brief makes **context assembly** (@file/@symbol mentions + automatic retrieval,
     budgeted) mandatory and worth 15 points (B1, the largest single technical
     criterion). PRD treats @file mentions as stretch.
     → **Promoted** context assembly from stretch to P0.
  3. Brief Task C accepts "clear message + workspace unchanged" as a 7-anchor;
     automatic model fallback scores 10. PRD's FR-7 failover targets the 10-anchor.
     → Keep FR-7, it matches the brief's top anchor.
  4. Brief allows reusing open-source editor-side code (declared forks). PRD says
     built from scratch. → From scratch (PRD stands); declare "from scratch" in the
     write-up and README.
  5. Deadline pressure: brief deadline is **20 Nov 2026** (8 days), PRD assumed a
     3-day window. → Keep the PRD's cut order; phases remain sequential.
- **Choice:** the brief wins on all points (per PRD section 0).
- **Consequence:** FR-11 (inline edit) and FR-12 (context assembly) to be added to
  the phase plan after Phase 0; already reflected in BACKLOG ordering.

## 2026-11-12 — No TypeScript SDK exists

- **Context:** PRD FR-1 assumed a TrueForge SDK `[VERIFY]`.
- **Finding:** `@truefoundry/trueforge-sdk` is an explicit placeholder ("Do not use").
- **Choice:** the extension speaks to TrueForge over the **HTTP API** only. Brief
  explicitly allows "the TrueForge HTTP API or the TypeScript SDK".
- **Consequence:** TrueForgeClient (1.4) is an HTTP/SSE client; no SDK dependency.

## 2026-11-12 — Spike-informed design decisions (Phase 0)

- **Approval flow:** the turn pauses at `tool.approval_required` and ends with
  `state.required_actions`; the decision is a **new turn** with a `user.tool_approval`
  input item keyed by `tool_call_id`. The DecisionStore holds hunk decisions keyed
  `tool_call_id`; the propose_edit MCP handler waits for the user's decision, then
  applies exactly the accepted hunks and returns the truthful result.
- **Failover:** PATCH the session's agent spec model, then continue the same session.
  Fault detection uses the `turn.done` error message (HTTP stays 200) plus HTTP status.
- **Provider-independent testing:** a fake OpenAI-compatible server
  (spikes/fake-openai.mjs) registered as a `custom` provider lets every automated
  test run the real TrueForge loop without API keys. The fake-trueforge tool (0.9)
  and unit/integration tests build on this.
- **MCP stateless pattern:** with `sessionIdGenerator: undefined`, create a fresh
  `McpServer` + `StreamableHTTPServerTransport` per request; reuse otherwise fails
  with "MCP error" on the second POST.

## 2026-11-12 — Repo name and location

- **Context:** PRD calls the folder `trueguard/`; the workspace is `~/Desktop/trueguard`.
- **Choice:** build in place at `~/Desktop/trueguard`; package name stays
  `trueguard` (publisher `aryankudtarkar`, the owner's GitHub handle).
- **Consequence:** none beyond path naming.

## 2026-11-12 — Task 2.4 "reconnect with backoff" interpretation (R12 default)

- **Context:** the verified TrueForge API has no mid-turn SSE resume endpoint for
  inline sessions (docs/TRUEFORGE_NOTES.md — subscribe replays a past turn, it
  does not attach to a live one).
- **Choice:** reconnect-with-backoff is implemented at the server-state level:
  when health probes fail, ServerManager polls with capped exponential backoff
  (1s → 2s → 4s … 10s) and flips back to Ready when TrueForge answers. A turn
  whose connection drops mid-stream surfaces as a turn error instead of
  silently resuming.
- **Consequence:** "a TrueForge restart is survived without a stuck UI" (FR-2 AC)
  is met via state recovery; stream-level resume stays out of scope.

## 2026-11-12 — Phase 2: the file listing comes from git, not from findFiles

- **Context:** FR-3 requires `list_files` to respect `.gitignore`. VS Code's
  `workspace.findFiles` does **not** (proved by an integration probe:
  `test/integration/gitignore-probe.test.ts`), and it happily returns
  `node_modules` — thousands of files the agent must never see.
- **Options:** (a) implement a `.gitignore` matcher in TypeScript, (b) call
  `git ls-files --cached --others --exclude-standard`, (c) keep findFiles.
- **Choice:** (b), with (c) as the fallback for folders that are not in a git
  work tree. Git is the source of truth for what is ignored; the listing is
  cached for 5 s so repeated searches do not spawn a process each time.
- **Consequence:** `list_files` needs git on PATH (it always is for a coding
  agent's users). Non-git folders still work, minus `.gitignore` support.

## 2026-11-12 — Phase 2: the tool-result cap shrinks the value, not the text

- **Context:** FR-9 caps every tool result at 16 KB. Cutting the *serialized*
  JSON at a byte offset can split an escape sequence and hand the agent
  unparseable output — a silent corruption of the contract.
- **Choice:** `capJson` (src/util/jsonCap.ts) shrinks the value: the longest
  string inside it is elided head/tail, then arrays are halved, until the
  payload fits. The structure (path, line counts, hashes) always survives.
- **Consequence:** the agent can always parse a tool result, and the marker
  tells it how to narrow the request.

## 2026-11-14 — The product is TrueGuard (owner decision)

- **Context:** the extension was built as "ForgeGuard" while the repository and
  the product were called TrueGuard. Two names for one thing is the kind of
  inconsistency that costs points in a demo and in a review.
- **Decision (owner):** rename the product to **TrueGuard**, everywhere —
  including the identifiers that are public API surfaces.
- **What changed:**
  | Was | Now |
  | --- | --- |
  | `forgeguard-dev.forgeguard` (extension id) | `aryankudtarkar.trueguard` |
  | `forgeguard.*` (commands) | `trueguard.*` |
  | `forgeguard.*` (settings) | `trueguard.*` |
  | `forgeguard.chatView`, `forgeguard.changesView` | `trueguard.chatView`, `trueguard.changesView` |
  | `forgeguard-container` (activity bar) | `trueguard-container` |
  | `forgeguard-editor` (MCP connector) | `trueguard-editor` |
  | `media/forgeguard.svg` | `media/trueguard.svg` |
  | the "ForgeGuard" output channel | the "TrueGuard" output channel |
- **Why the identifiers too:** the extension id, the command ids and the
  settings namespace are permanent public surfaces. Nothing is released yet, so
  renaming now is free; renaming after the demo would break every keybinding
  and every published setting.
- **Consequence:** `prd-and-plan.md` was amended with a header note (the
  document's own rule is "never edit it, propose changes here" — the owner
  authorised the rename, and the change is recorded here and in the header).
  The git history keeps the old names in the older commits, as a rename's
  history should.
- **Publisher:** `aryankudtarkar` (the owner's GitHub handle — the owner
  decision of 2026-11-14). The extension id is therefore
  `aryankudtarkar.trueguard`.

## 2026-11-14 — Two modes, two providers, keys in SecretStorage

- **Context:** the product needs a fast model for everyday work and a
  thinking model for hard problems. The owner chose **Groq**
  (`gpt-oss-120b`) for Fast and **NVIDIA NIM**
  (`deepseek-ai/deepseek-v4.1-flash`) for Thinking.
- **Decision:**
  - The extension **registers the providers in TrueForge** and refers to the
    models by their TrueForge name (`groq/gpt-oss-120b`). TrueGuard never
    calls a provider itself: the brief's eligibility rule says the agent loop
    must run inside TrueForge.
  - Both providers are OpenAI-compatible, so they are registered as
    `custom` providers with a `base_url` (verified live against the running
    server: the manifest is accepted and the key comes back redacted).
  - The **keys go into VS Code's SecretStorage**, not into the settings and
    not into the repository. A setting is plaintext in `settings.json`; an API
    key does not belong there. The keys are collected once, during the
    onboarding (the walkthrough's second step, *Add your providers*), and can
    be changed later with the same command.
  - Each mode has **its own failover chain**
    (`trueguard.modes.fast.models`, `trueguard.modes.thinking.models`). The
    generic `trueguard.models` list is the fallback when a mode has none, so
    an existing configuration keeps working.
  - The chains are filled **only for providers that are actually registered**
    in TrueForge — a package.json default would otherwise silently override
    the user's own model list.
  - The Thinking mode sends `reasoning_effort: medium` with the model
    (the parameter the verified TrueForge API exposes).
- **Consequence:** a fresh install asks for two keys and works; the chat's
  mode pill shows which mode (and model) is in use, and the extension warns
  when the active mode needs a provider that is not set up yet, instead of
  letting every turn fail.

## 2026-11-12 — A failover continues the task; it never restarts it
- **Context:** cline/cline#713 reports that Cline's retry *"doesn't continue
  the task, but it starts again. So it generates an infinite loop and money
  consuming."* Our Phase 6 implementation had the same shape: it re-sent the
  original user message on the fallback model, which makes the model see the
  request twice and start over.
- **Choice:** a retry sends a **continuation** instead of the request:
  *"The previous attempt failed: … Continue where you left off. Do not repeat
  the work that already succeeded."* The tools that already returned a result
  are named, and the idempotency guard (`src/util/idempotency.ts`) replays a
  repeated call instead of executing it again.
- **Consequence:** a failover costs the work already done, not the whole task.
  The live failover gate proves the turn completes on the fallback model.

## 2026-11-12 — The failover policy is a setting, not a constant

- **Context:** cline/cline discussion #10465 notes that Cline's retry count is
  a compile-time constant (`maxRetries: 3`) with no UI visibility and no
  tunable backoff.
- **Choice:** `trueguard.failover.enabled` and
  `trueguard.failover.breakerCooldownSec` are contributed settings, and the
  chat shows exactly one row per failover plus the model label on every agent
  message.
- **Consequence:** the user can see and tune the policy instead of guessing.

## 2026-11-12 — A redacted per-session event log (FR-8)

- **Context:** FR-8 asks for "a redacted JSON event log per session in
  globalStorage, opened by TrueGuard: Show Session Log". Neither Cline nor
  Continue exposes an inspectable per-session event log (see
  docs/COMPETITIVE.md).
- **Choice:** every turn event is appended to
  `globalStorage/sessions/<sessionId>.jsonl`. Keys that look like secrets
  and bearer tokens inside free text are replaced with `[redacted]`. A log
  that cannot be written never breaks a turn.
- **Consequence:** when a demo goes sideways, the artefact that answers "what
  did the agent actually see and do?" exists.

## 2026-11-12 — A stale review is visible before it becomes a conflict

- **Context:** continuedev/continue#12269 reports the agent's view of a file
  drifting from the disk. We refuse such a write (the base-hash conflict
  check), but the user only found out at apply time.
- **Choice:** the Changes view marks a file that changed since the proposal
  with a warning icon and "changed since the proposal".
- **Consequence:** the desync is visible while the user is still deciding.

## 2026-11-12 — Amended phase order: the brief-driven anchors move up

- **Context:** docs/brief.pdf (authoritative) makes two capabilities mandatory
  that the PRD's phase plan left out: **inline edit** (Task A, 10 points) and
  **context assembly** (B1, 15 points). The PRD also says it must never be
  edited — changes are proposed here.
- **Decision:** the phase order is amended as follows (Phase numbers below are
  the new ones; the old PRD numbers are in brackets):

  | New | Work | Old |
  | --- | --- | --- |
  | 5 | Command execution and context hygiene | 5 |
  | 6 | Failover (G3) | 6 |
  | 7 | Inline edit (FR-11) — brief Task A | new |
  | 8 | Context assembly (FR-12) — brief B1 | new |
  | 9 | Design polish, onboarding, accessibility | 7 |
  | 10 | Hardening, docs, packaging, demo | 8 |

- **Reason:** the two brief anchors are worth 25 points and are worth nothing
  if the demo has no time for them. They sit after the three guarantees (G1,
  G2, G3) are complete and before design polish, so the scoring criteria are
  covered while the harness is still fresh.
- **Consequence:** design polish and packaging move last and may be cut down
  to fit the deadline (20 Nov 2026). The audits, the exit gates and G1–G3 are
  never cut.

## 2026-11-12 — Phase 3: the canonical hash ignores the BOM

- **Context:** the same file read from disk and from an editor buffer can
  differ by a UTF-8 BOM. With the BOM included in the hash, every proposal on
  a BOM file looked like a conflict and was refused.
- **Choice:** `contentHash` normalizes EOL **and** the BOM. The hash
  identifies the text, not the encoding.
- **Consequence:** the editor owns the encoding: the bridge writes plain text
  and VS Code re-adds the BOM when saving. The applier compares
  BOM-insensitively.

## 2026-11-12 — Phase 3: hunks are computed on LF-normalized text

- **Context:** a CRLF file and an LF file must produce the same hunks, or the
  line numbers of a proposal would depend on the file's line endings.
- **Choice:** the proposal is computed on LF-normalized text (BOM stripped);
  the file's EOL style, BOM and trailing-newline convention are captured in a
  profile and restored when the result is written.
- **Consequence:** the trailing newline is represented as an explicit line, so
  a proposal that adds or removes it still reproduces the proposed text
  exactly (proven by the randomized property test).

## 2026-11-12 — Phase 3: a change set is applied in one operation

- **Context:** hunks carry line numbers, so applying a subset and then
  re-applying the rest with the original coordinates would corrupt the file.
- **Choice:** the user accepts a subset and the extension applies exactly that
  subset in one operation, against the base text the proposal was computed
  from. A second, later change to the same file is refused by the base-hash
  check (conflict) and must be re-proposed.
- **Consequence:** the "apply a subset, then the rest" flow is intentionally
  not supported; the Changes view always applies the current selection in one
  step.

## 2026-11-12 — Phase 2: read-only tools are attached with no approval gate

- **Context:** TrueForge's default `require_approval_for_tools` is
  `["@write","@destructive"]`. Our Phase 2 tools are read-only, but we do not
  know how TrueForge classifies them.
- **Choice:** sessions attach the connector with an explicit
  `require_approval_for_tools: []`, so a read never pauses the turn. Phase 4
  re-adds the gate with the explicit tool names (`propose_edit`, `run_command`).
- **Consequence:** the read-only phase cannot stall on an approval nobody asked
  for; the write phase still gates by name.
