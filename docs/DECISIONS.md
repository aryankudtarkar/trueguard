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
