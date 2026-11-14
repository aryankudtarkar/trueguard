# ForgeGuard

A trustworthy autonomous coding agent inside VS Code, running on
[TrueForge](https://github.com/truefoundry/trueforge).

ForgeGuard is an **extension**: it creates sessions, streams the agent's
answers, exposes your workspace to the agent as tools, and owns everything you
see. The agent loop runs on TrueForge; the trust runs here.

## Three guarantees

- **Nothing reaches disk without explicit, hunk-level approval.** Every edit
  arrives as a diff in the Changes view. You accept or reject each hunk.
- **The agent can never claim an edit succeeded unless ForgeGuard verified
  it.** Every write is checked against the editor buffer *and* the disk. If
  they do not match, the file is restored and the agent is told the truth.
- **A provider failure does not end the session.** A rate limit, a server
  error or a timeout moves the turn to your next model, and you are told once.

## Quick start

Requires Node 22+, VS Code 1.93+ and a TrueForge server.

```bash
git clone <this repo> forgeguard
cd forgeguard
npm install
npm run setup        # registers the models with TrueForge
npm run trueforge    # starts the server on http://localhost:8790
```

Then in VS Code: open the folder, press <kbd>F5</kbd> (Run Extension), and
click the ForgeGuard icon in the Activity Bar.

For a guided tour, run **ForgeGuard: Start TrueForge** from the Command
Palette, then ask for something small in the chat, for example:

> Add a doc comment to the function `formatDate` in src/util/date.ts

The agent reads the file, proposes a change, and the diff waits for you.

### A first run without any API keys

The repository ships a fake OpenAI-compatible provider
(`spikes/fake-openai.mjs`) so the whole flow can be tried without keys:

```bash
node spikes/fake-openai.mjs &     # the fake provider on :8799
npm run setup                     # registers it as "fake-provider"
npm run trueforge                 # the agent harness on :8790
```

Models are configured in **Settings → ForgeGuard: Models**. Each entry needs
an `id`, a `label` and a `ref` (the model identifier TrueForge expects, e.g.
`openai/gpt-4o-mini`). Index 0 is the primary; the rest are the fallbacks.

## What you can do

| Command | What it does |
| --- | --- |
| ForgeGuard: Start TrueForge | Start (or attach to) the agent harness |
| ForgeGuard: New Chat | Start a new conversation |
| ForgeGuard: Stop Turn | Cancel the running turn (and deny its approvals) |
| ForgeGuard: Switch Model | Choose the model for the next turn |
| ForgeGuard: Review Next Change | Focus the pending reviews |
| ForgeGuard: Accept Hunk / Reject Hunk | Accept or reject one hunk |
| ForgeGuard: Accept All / Reject All | Accept or reject the whole review |
| ForgeGuard: Apply Selected Changes | Write the accepted hunks (verified) |
| ForgeGuard: Inline Edit Selection | Select code, describe the change, see the diff |
| ForgeGuard: Show Session Log | Open the output channel |

Keyboard: <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd>
accepts a hunk, <kbd>R</kbd> rejects it, <kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>
starts an inline edit.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `forgeguard.trueforge.baseUrl` | `http://localhost:8790` | The TrueForge server |
| `forgeguard.models` | `[]` | Ordered model profiles (index 0 is primary) |
| `forgeguard.activeModelIndex` | `0` | The model for new turns |
| `forgeguard.toolOutputCapBytes` | `16384` | The cap on one tool result |
| `forgeguard.contextBudgetBytes` | `16384` | The cap on the context per message |
| `forgeguard.commandTimeoutSec` | `120` | The timeout for agent-run commands |
| `forgeguard.allowSecretReads` | `false` | Let the agent read `.env`, `*.pem`, … |
| `forgeguard.dev.enableFaultInjection` | `false` | Enable the demo fault commands |

## How it works

```
   VS Code  ── chat webview ──┐
      │                        │  events (SSE)
      │  MCP tools ◄── TrueForge ── agent loop ── model provider
      │      │
      │      ├─ read_file, list_files, search_text, get_diagnostics
      │      ├─ propose_edit  ──► hunk-level review ──► verified write
      │      └─ run_command  ──► approval card     ──► verified output
```

- `src/trueforge/` — the server lifecycle, the HTTP/SSE client, sessions and
  the approval events.
- `src/mcp/` — the embedded MCP server (loopback, bearer token), the path
  guard and the tools.
- `src/edits/` — the edit engine: matching, hunks, the change store, the
  applier and the verifier.
- `src/review/` — the Changes view, the decision store and the diff provider.
- `src/failover/` — the error classifier and the failover policy.
- `src/context/` — mentions and automatic context retrieval.
- `src/ui/` — the chat webview, the status bar and the inline edit.

Full details, including the verified TrueForge API, are in
[docs/TRUEFORGE_NOTES.md](docs/TRUEFORGE_NOTES.md), and the build log is in
[docs/PROGRESS.md](docs/PROGRESS.md).

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "ForgeGuard can not reach TrueForge" | The server is not running: `npm run trueforge`. Check `forgeguard.trueforge.baseUrl`. |
| The agent answers but cannot read files | The editor MCP server is not registered: run `npm run setup` and check the ForgeGuard output channel. |
| "No model is available right now" | Every model failed. Edit `forgeguard.models` and press Retry. |
| The agent's edit was refused | The `oldText` did not match the file exactly. The error says which line looked closest. |
| A change says "Conflict" | The file changed after the agent read it. Review again. |

## License

MIT. Built from scratch for the TrueFoundry Forge-a-thon (Techfest 2026-27).
It is not a fork of any other extension; the only third-party runtime
dependencies are the MCP SDK, zod, jsdiff, marked and DOMPurify.
