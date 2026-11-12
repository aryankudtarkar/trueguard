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

- **Context:** PRD calls the folder `forgeguard/`; the workspace is `~/Desktop/trueguard`.
- **Choice:** build in place at `~/Desktop/trueguard`; package name stays
  `forgeguard` (publisher `forgeguard-dev`), matching PRD defaults.
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

## 2026-11-12 — Phase 2: read-only tools are attached with no approval gate

- **Context:** TrueForge's default `require_approval_for_tools` is
  `["@write","@destructive"]`. Our Phase 2 tools are read-only, but we do not
  know how TrueForge classifies them.
- **Choice:** sessions attach the connector with an explicit
  `require_approval_for_tools: []`, so a read never pauses the turn. Phase 4
  re-adds the gate with the explicit tool names (`propose_edit`, `run_command`).
- **Consequence:** the read-only phase cannot stall on an approval nobody asked
  for; the write phase still gates by name.
