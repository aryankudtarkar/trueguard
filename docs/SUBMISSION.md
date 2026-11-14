# Submission — TrueGuard

**Team:** TrueGuard (owner: Aryan Kudtarkar)
**Event:** TrueFoundry Forge-a-thon, Techfest 2026-27, IIT Bombay
**Built from scratch** — not a fork of any existing extension.

## The pitch

Most coding agents break trust in three specific ways, and every one of them
is a trust failure, not a capability failure:

1. **Phantom success** — the agent says "done", the file is untouched.
2. **Trust-the-model editing** — the model sends a diff, the extension
   applies it blind.
3. **Fragile sessions** — one rate limit and the work stops.

TrueGuard fixes the trust, not the model. It is a VS Code extension that
runs the agent loop on TrueForge and owns everything the user sees:

- **G1 — Nothing reaches disk without explicit, hunk-level approval.**
  The extension computes the diff itself (a zero-context Myers diff), the
  user accepts or rejects each hunk, and one WorkspaceEdit applies exactly
  the accepted ones.
- **G2 — The agent can never claim an edit succeeded unless TrueGuard
  verified it.** Every write is verified against the editor buffer *and* the
  disk. A mismatch restores the file and the agent is told the truth.
- **G3 — A provider failure does not end the session.** 429s, 5xx and
  timeouts move the turn to the next model, with one calm notice, and a tool
  that already ran is never run twice.

## Why it is different

- The diff is **computed by the extension**, never trusted from the model.
- The result the agent receives is **truthful JSON**, or an error — never a
  hopeful "done".
- A file that changed under the proposal is a **conflict**, not a silent
  overwrite.
- Risky commands are **highlighted, not blocked**: the user keeps the last
  word.

The comparison against Cline and Continue — with links to the public issues
behind every claim — is in [docs/COMPETITIVE.md](docs/COMPETITIVE.md). The
short version: the competitors retry the same model and let a failed task die
or restart it; they rewrite whole files; and they report success without
checking the disk. TrueGuard continues on another model, reviews every hunk,
and verifies every write.

## Screenshots

| # | What it shows | Where to take it |
| --- | --- | --- |
| 1 | The chat with a streamed answer and a tool-activity row | D5 |
| 2 | The Changes view with file and hunk nodes, one unchecked | D1 |
| 3 | The native diff beside the code, at the chosen hunk | D1 |
| 4 | The receipt row `Applied 2 of 3 changes. Verified against disk.` | D1 |
| 5 | The status bar warning `$(warning) Model B` and the notice row | D2 |
| 6 | The context row `Context: app/calculate.py (2.1 KB of 16 KB)` | D5 |
| 7 | The command card with the exact command and the Allow button | D5 |

## Model setup

| Mode | Provider | Model | Where it runs | Cost |
| --- | --- | --- | --- | --- |
| **Fast** | Groq | `gpt-oss-120b` | Groq's API, reached by TrueForge on the local machine | free tier / pay-as-you-go |
| **Thinking** | NVIDIA NIM | `deepseek-ai/deepseek-v4.1-flash` | NVIDIA NIM, reached by TrueForge on the local machine | free credits / pay-as-you-go |

Both providers are OpenAI-compatible and are registered **in TrueForge**
(`POST /api/v1/settings/model-providers`, type `custom`). The extension never
calls a provider itself: it collects the keys once (into VS Code's secret
storage), registers the providers, and refers to the models by their TrueForge
name (`groq/gpt-oss-120b`, `nvidia/deepseek-ai/deepseek-v4.1-flash`). No key is
committed to the repository; the example configuration in
`examples/models.example.json` contains model names only.

Switching modes is one command (**TrueGuard: Switch Mode**) or the pill in the
chat; each mode has its own failover chain, so a rate limit in one mode does
not affect the other. The Thinking mode sends `reasoning_effort: medium`.

**Scorecard table** (criterion → video timestamp → one-line claim) — fill in
with the timestamps of the recorded demo:

| Criterion | Timestamp | Claim |
| --- | --- | --- |
| A1 Inline edit | | |
| A2 Agent mode | | |
| A3 Streaming & cancellation | | |
| B1 Context assembly | | |
| B2 Diff safety | | |
| B3 Resilience | | |
| B4 TrueForge depth | | |
| C1 Video | | |

## Links

- Repository: https://github.com/aryankudtarkar/trueguard
- Demo video: `<fill in>`
- Extension marketplace (if published): `<fill in>`
- TrueForge: https://github.com/truefoundry/trueforge

## How the brief's tasks are covered

| Brief task | Where it is |
| --- | --- |
| A — inline edit | `src/ui/inlineEdit.ts`: select, <kbd>Ctrl/Cmd+Alt+I</kbd>, describe, the diff opens beside the code; the write still goes through the hunk review |
| B1 — context assembly | `src/context/`: `@`-mentions in the composer, automatic retrieval scored against the workspace, a visible budget, and the chat names the files it chose |
| C — reliability under provider failure | `src/failover/`: the classifier, the ordered models, the 60 s breaker, the idempotency guard, one calm notice |
| Trust (the differentiator) | `src/edits/`: hunk-level approval, verification against buffer and disk, automatic rollback, truthful results |

## The honest limitations

- Undo restores the editor buffer; the file on disk keeps the applied content
  until it is saved again (VS Code does not undo a save).
- Adjacent changes appear as one hunk, because the diff merges them.
- The failover continues the same session with the same request, so the
  model may repeat its reasoning (the tools it already ran are protected).
- The `.vsix` is unsigned.

## Verification

`npm run verify` runs typecheck, lint, 271 unit tests, 18 integration tests
in a real VS Code and the design lint. The audit trail is in
`docs/audits/` (one report per phase, each with its conformance matrix and
its findings) and the build log in `docs/PROGRESS.md`.
