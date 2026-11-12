# Progress

| Task | Status | Commit | Note |
| --- | --- | --- | --- |
| 0.1 Repo skeleton + tooling, `npm run verify` green | done | 30fe1b6 | tsconfig strict, esbuild, eslint, vitest, launch/tasks, design-lint, all npm scripts |
| 0.2 Extract brief, write BRIEF_NOTES, log conflicts | done | 30fe1b6 | 5 conflicts logged in DECISIONS; brief wins (inline edit + context assembly promoted to P0) |
| 0.3 Install TrueForge packages, read README/types | done | 10574db | openapi.json pulled from live server; SDK is placeholder → HTTP API |
| 0.4 TRUEFORGE_NOTES verification ledger | done | (pending) | all Phase-1-critical items VERIFIED via spikes |
| 0.5 Spike 1 hello | done | (pending) | docs/spikes/hello-transcript.md; SSE framing + event sequence verified |
| 0.6 Spike 2 mcp-echo | done | (pending) | stateless Streamable HTTP works; fresh McpServer per request |
| 0.7 Spike 3 approval correlation | done | (pending) | tool_call_id + thread_id; allow = new turn user.tool_approval; deny → error tool result with reason |
| 0.8 Spike 4 failover / model override | done | (pending) | PATCH session spec switches model; error turns end HTTP 200 with turn.done error |
| 0.9 fake-trueforge server | doing | — | stub up; full emulation now mirrors verified behavior |
| 0.10 PROGRESS/DECISIONS/BACKLOG files | done | 30fe1b6 | — |
| Audit Phase 0 (A1–A7) | todo | — | then OWNER GATE G0 |
