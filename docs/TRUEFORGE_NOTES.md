# TrueForge Notes — verification ledger

Every [VERIFY] item from docs/PRD.md recorded here with status (VERIFIED /
CONTRADICTED / UNKNOWN), evidence, and the chosen approach. Evidence = installed
package, official docs, or a spike transcript. Never from memory.

Verified against **@truefoundry/trueforge 0.183.2** running locally in standalone
mode (SQLite), inspected 2026-11-12.

## Registry and packaging

| Item | Status | Evidence | Approach |
| --- | --- | --- | --- |
| `npx @truefoundry/trueforge@latest` exists | VERIFIED | `npm view` → latest 0.183.2, bin `trueforge → dist/cli.js` | ServerManager spawns `npx @truefoundry/trueforge@latest`. |
| Node requirement | VERIFIED | engines `node >=22.14.0`; local node v24.21.0 | Require Node ≥22.14; warn below. |
| TypeScript SDK | CONTRADICTED for this version | `@truefoundry/trueforge-sdk` npm says "Placeholder … Do not use" (0.184.1); README links it but it is not published as usable | Extension talks **HTTP API** (brief allows HTTP API or TS SDK). |
| Default port | VERIFIED | README quick start: `Open http://localhost:8790`; server banner | Default baseUrl `http://localhost:8790`. |
| Local mode = standalone | VERIFIED | Startup banner "TrueForge v0.183.2 · standalone"; sqlite at `~/Library/Application Support/trueforge/db/db.sqlite` | Spawn as child process; kill only what we spawn. |

## HTTP API (evidence: `GET /api/v1/openapi.json` on the running server; copy in
docs/reference/trueforge-openapi-0.183.2.json)

Base path: `/api/v1/`. 55 paths.

| Item | Status | Evidence | Approach |
| --- | --- | --- | --- |
| Health check | VERIFIED (adjusted) | No `/health` route; 404 with `{error:{message}}`. `GET /api/v1/sessions` returns 200 | Health = GET /api/v1/sessions (or /api/v1/users) returning 200. States Stopped/Starting/Ready/Failed. |
| Create session | VERIFIED | `POST /api/v1/sessions` body `CreateSessionRequest { agent: {name} \| {spec}, metadata }` | Use inline `agent: {spec: AgentSpec}` so the extension controls model + tools. |
| Send turn | VERIFIED | `POST /api/v1/sessions/{id}/turns` body `CreateTurnRequest { input: TurnInputItem[], previous_turn_id: 'auto'\|'none'\|id (default 'auto'), stream: bool (default true) }` | stream=true returns SSE directly. |
| Turn input items | VERIFIED | `TurnInputItem` oneOf: `user.message` (`{type, content}`), `user.tool_approval`, `user.tool_response` | Chat turn = single user.message. Approvals = separate turn on same session. |
| SSE events | VERIFIED | `TurnStreamingEvent` oneOf 19 event types, all with `type`, `id` (monotonic ULID), `thread_id`, `created_at` | zod-validated event union; see event list below. |
| Streaming deltas | VERIFIED | `ModelMessageDeltaEvent { type: 'model.message.delta', content, tool_calls, finish_reason, usage }` | Chat renders deltas incrementally. |
| Approval-required event | VERIFIED | `ToolApprovalRequiredEvent { type:'tool.approval_required', thread_id, tool_calls: [{id, source_event_id}] }` | ChangeStore keyed on tool_call id. |
| Approval decision | VERIFIED | Decision sent as a **new turn**: input item `user.tool_approval` = `{type:'user.tool_approval', thread_id, tool_call_id, approval: {status:'allow'} \| {status:'deny', reason?}}` | DecisionStore holds per-tool_call_id decisions; extension sends allow/deny turn. Correlation key = **tool_call_id** (+ thread_id). |
| Client-side tool response | VERIFIED | `user.tool_response` = `{type:'user.tool_response', thread_id, tool_call_id, content}` resumes after `tool.response_required` | Alternative to MCP for the propose_edit flow; evaluate in Phase 4. |
| Cancel turn | VERIFIED | `POST /api/v1/sessions/{id}/cancel` | Stop button. |
| Session patch (model override!) | VERIFIED | `PATCH /api/v1/sessions/{id}` accepts `agent: {spec: AgentSpec}` on **inline sessions only** | Failover preferred strategy: PATCH session agent spec with fallback model, continue same session. Spike 4 confirms live. |
| Named agents | VERIFIED | `GET/POST/PUT/DELETE /api/v1/agents`, CreateSessionAgent `SessionAgentNameRef {name}` | Ship an agent definition; sessions created by name. |
| Agent spec | VERIFIED | `AgentSpec { model: {name: 'provider/model', params}, instructions, messages, mcp_servers[], skills[], response_format, config: RuntimeConfig }` | Extension composes spec with editor MCP server. |
| Model naming | VERIFIED | FQN `provider/model` e.g. `openai/gpt-5.4`; catalog: `GET /api/v1/catalogs/model-providers` | Model profiles map to FQNs; Switch Model QuickPick lists configured providers' models. |
| Register model provider | VERIFIED | `POST/PUT /api/v1/settings/model-providers` body `{manifest: ModelProviderManifest}`; auth `{api_key}` (redacted on read) | Setup script registers providers with keys from env/SecretStorage; catalog types: openai, anthropic, google-gemini, fireworks, zai, moonshot, together, alibaba, custom (base_url for OpenAI-compatible). |
| Register MCP server (connector) | VERIFIED | `GET/POST/PUT /api/v1/settings/mcp-servers` body `{manifest: RemoteMCPServerManifest {type:'remote', name, url, description, auth}}`; auth oneOf includes **header auth `{type:'header', headers: {...}}`** | Extension's MCP server registers as remote with header bearer token. Headers ARE supported. |
| Tool approval on MCP servers | VERIFIED | `MCPServer.approval` selector list: `@all`, `@write`, `@destructive`, or literal tool names | Set `approval: ['@all']` (or propose_edit/run_command) so TrueForge gates before calling. |
| Deferred tool loading (B4 feature) | VERIFIED | `MCPServer.preload_tools[]` — tools loaded eagerly "while the rest stay deferred" | Use it for context budget: preload read_file only, defer the rest. |
| Context-engineering features (B4) | VERIFIED | `RuntimeConfig`: `context_management {compaction, large_tool_response}`, `dynamic_sub_agents`, sandbox, generative_ui, ask_user_questions, web_search | Enable compaction + large_tool_response; document in write-up (B4 anchor 10). |
| Compaction events | VERIFIED | `ThreadContextCompactionStartedEvent` / `…FinishedEvent` | Show a subtle compaction row in chat. |
| Loopback guard | VERIFIED | `NETWORK_POLICY_ENABLED` (default **true**) env; `OUTBOUND_URL_ALLOWED_HOSTS` env = JSON string array; parsed in dist/main.js `configureOutboundUrlGuard` | Spawn TrueForge with `OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'` (keeps guard on, allows extension MCP port). Fallback: NETWORK_POLICY_ENABLED=false. |
| Error shapes | VERIFIED (shape) | 404 body: `{error: {message: string}}` — `RequestErrorResponse` in spec | ErrorClassifier parses `{error.message}`; statuses 429/5xx/401 classified per FR-7. Live spike confirms. |
| Sandbox | VERIFIED | Optional (`sandbox: {enabled:false…}` default off; brief says not required) | Keep disabled. |
| Session events history | VERIFIED | `GET /api/v1/sessions/{id}/events` → ListSessionEventsResponse | Rehydrate chat after TrueForge restart. |
| Turn events history | VERIFIED | `GET /api/v1/sessions/{id}/turns/{turn_id}/events` and `/subscribe` (GET, SSE) | Subscribe = reattach to an in-flight turn after reconnect. |
| Search MCP catalog | VERIFIED | `GET /api/v1/catalogs/mcp-servers` | Not needed for v1 editor connector. |

## Event list (TurnStreamingEvent oneOf)

model.message, model.message.delta, tool.response, thread.created, thread.done,
thread.context_compaction.started, thread.context_compaction.finished,
mcp.auth_required, mcp.initialize, sandbox.created, tool.approval_required,
tool.response_required, user.tool_approval, user.tool_response,
user.tool_approval_policy, user.mcp_auth_continue, turn.created, turn.update,
turn.done.

## Setup requirements (owner prerequisites)

- Two model provider API keys in `.env` (failover, Task C). Example `.env.example` shipped; keys loaded via `PUT /api/v1/settings/model-providers`, never committed.
- The agent definition the extension registers (named agent via `/api/v1/agents`) — repo must contain it (eligibility gate).

## Remaining UNKNOWNs (block nothing before Phase 1)

- Real 429/401 provider error payloads (fake-openai fault modes implemented; classifier tests use them).
- Whether `propose_edit` round-trips faster via MCP tool + approval gate vs `user.tool_response` resume (both paths exist; Phase 4 decides).

## Spike results (2026-11-12, live against the running server)

All transcripts in docs/spikes/. The agent loop ran on a **fake OpenAI-compatible
provider** (spikes/fake-openai.mjs) registered as a `custom` model provider — no
real API keys needed.

### Spike 1 — hello (docs/spikes/hello-transcript.md)
- `POST /api/v1/sessions` → 201, returns `{data: {id, agent: {type:'inline', spec}, …}}`.
- `POST /api/v1/sessions/{id}/turns` (stream=true) → 200 `text/event-stream`.
- SSE framing: `data: {json}\n\n` with optional `id: N` line per event.
- Event sequence: `turn.created` → `model.message` (header w/ model+params) → `model.message.delta`* (with final delta carrying `finish_reason` + `usage`) → `turn.done` (state.output = full message, metrics).
- Usage includes `input_tokens_breakdown {harness, skills, instructions, tool_definitions, messages}`.

### Spike 2 — mcp-echo (docs/spikes/mcp-echo-transcript.md)
- MCP server (official SDK 1.32.2, `StreamableHTTPServerTransport`, stateless mode,
  fresh McpServer per request) registered via `POST /api/v1/settings/mcp-servers`.
- `mcp.initialize` event on turn start: `{mcp_servers: [{name, transport_type:'streamable-http'}]}`.
- Tool schemas loaded (`preload: true`); tool call executed by the harness; result
  came back as `tool.response` event with content `{content:[{type:'text',text:…}]}`.

### Spike 3 — approval (docs/spikes/approval-allow-transcript.md, approval-deny-transcript.md)
- With `mcp_servers: [{name, require_approval_for_tools:['@all'], preload:true}]`:
  - Turn 1: `turn.created` → `mcp.initialize` → `model.message.delta` (tool_calls) →
    **`tool.approval_required`** `{thread_id, tool_calls:[{id, source_event_id}]}` → `turn.done`
    with `state.required_actions` repeating the same payload. Turn PAUSES.
  - Allow decision = **new turn** on the same session with input
    `{type:'user.tool_approval', thread_id, tool_call_id, approval:{status:'allow'}}`.
    Then the harness executes the tool (exactly once) and emits `tool.response`.
  - Deny with reason: `{approval:{status:'deny', reason}}` → agent receives tool
    result `{"error":"User denied tool call: <reason>"}`.
- **Correlation key verified: `tool_call_id` (+ `thread_id`)** — this keys the DecisionStore.

### Spike 4 — failover (docs/spikes/failover-transcript.md)
- Session on `bad-provider/bad-model` (base_url port 9): turn SSE ends with
  `turn.done {"state":{"status":"error","message":"[Model Error] Cannot connect to API: bad port"}}`.
  **The turn ends with an error event, HTTP stays 200** — the extension classifies
  from the turn.done error, not just HTTP status.
- `PATCH /api/v1/sessions/{id}` with `{agent:{spec:{model:{name:'fake-provider/test-model'}}}}`
  → 200, `agent.spec.model.name` switched.
- New turn on the **same session** succeeds on the fallback model.
- **Chosen failover strategy (preferred, per PRD): PATCH the session's model, then
  send a new turn on the same session.** No condensed-transcript reseed needed.
- Iteration limit reached (stateless fake model looped): turn.done error message
  "You have reached iteration limit of 512, please request again" — status `error`.
