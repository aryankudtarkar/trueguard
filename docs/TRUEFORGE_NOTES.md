# TrueForge Notes — verification ledger

Every [VERIFY] item from docs/PRD.md recorded here with status (VERIFIED /
CONTRADICTED / UNKNOWN), evidence, and the chosen approach. Evidence must come from
the installed package, an official doc, or a spike transcript — never from memory.

## Registry findings (2026-11-12, npm)

| Item | Status | Evidence | Approach |
| --- | --- | --- | --- |
| `npx @truefoundry/trueforge@latest` exists | **VERIFIED** | `npm view @truefoundry/trueforge` → latest `0.183.2`, bin `trueforge → dist/cli.js` | Use as the server start command (FR-1). |
| Node requirement | **VERIFIED** | `npm view` engines → `node >=22.14.0`; local node v24.21.0 satisfies it | Require Node ≥22.14 in docs; warn below it. |
| TypeScript SDK package | **CONTRADICTED** | `@truefoundry/trueforge-sdk` is a **placeholder** ("Do not use") | Talk to TrueForge over the **HTTP API** (brief allows HTTP API or TS SDK; SDK does not exist). |
| Related packages | **VERIFIED** | `@truefoundry/trueforge-core` (harness library), `@truefoundry/trueforge-ui` (assistant-ui chat), `@truefoundry/assistant-ui-runtime` | Editor-side stays independent; we only need the HTTP API. |
| Default port | UNKNOWN | — | To verify (task 0.3/0.5). |
| Session create/send API shapes | UNKNOWN | — | To verify. |
| SSE event names and payloads | UNKNOWN | — | To verify. |
| Approval event + decision message | UNKNOWN | — | Spike 3. |
| Approval→MCP-call correlation key | UNKNOWN | — | Spike 3. |
| Model/agent registration path | UNKNOWN | — | To verify. |
| MCP connector registration + header support | UNKNOWN | — | Spike 2. |
| Loopback allow-list setting | UNKNOWN | — | To verify. |
| Per-turn/session model override | UNKNOWN | — | Spike 4. |
| Error shapes (429, 5xx, timeout, 401) | UNKNOWN | — | To verify. |
| `requireApprovalForTools` support | UNKNOWN | — | Spike 3. |
