# TrueGuard

A trustworthy autonomous coding agent inside VS Code, running on
[TrueForge](https://github.com/truefoundry/trueforge).

TrueGuard is an **extension**: it creates sessions, streams the agent's
answers, exposes your workspace to the agent as tools, and owns everything you
see. The agent loop runs on TrueForge; the trust runs here.

## Three guarantees

- **Nothing reaches disk without explicit, hunk-level approval.** Every edit
  arrives as a diff in the Changes view. You accept or reject each hunk.
- **The agent can never claim an edit succeeded unless TrueGuard verified
  it.** Every write is checked against the editor buffer *and* the disk. If
  they do not match, the file is restored and the agent is told the truth.
- **A provider failure does not end the session.** A rate limit, a server
  error or a timeout moves the turn to your next model, and you are told once.

## Quick start

**First time? Read [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md)** — the
complete first run, step by step: what to type, what you should see, and what
to do when nothing happens.

The short version:

```bash
npm install
npm run dev        # starts TrueForge + a keyless model provider, registers it
```

Then in VS Code: open the folder, press <kbd>F5</kbd>, click the TrueGuard
shield in the Activity Bar. If anything looks wrong, run
**TrueGuard: Check Setup** — it tells you what is missing and offers the fix.

Requires Node 22+, VS Code 1.93+ and a TrueForge server.

```bash
git clone <this repo> trueguard
cd trueguard
npm install
npm run setup        # registers the models with TrueForge
npm run trueforge    # starts the server on http://localhost:8790
```

Then in VS Code: open the folder, press <kbd>F5</kbd> (Run Extension), and
click the TrueGuard icon in the Activity Bar.

For a guided tour, run **TrueGuard: Start TrueForge** from the Command
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

Models are configured in **Settings → TrueGuard → Modes**: each mode has its
own ordered chain (index 0 is the primary, the rest are the fallbacks).

## The two modes

| Mode | Provider | Model | For |
| --- | --- | --- | --- |
| **Fast** | Groq | `gpt-oss-120b` | everyday work: quick answers, small edits |
| **Thinking** | NVIDIA NIM | `deepseek-ai/deepseek-v4.1-flash` | hard problems: deeper reasoning (`reasoning_effort: medium`) |

Switch with **TrueGuard: Switch Mode**, or from the pill in the chat. Each mode
has its own failover chain, so a rate limit in one mode never affects the
other.

**Onboarding asks for the keys once.** *TrueGuard: Configure Providers* (also
the second step of the walkthrough) prompts for your Groq and NVIDIA NIM keys
and stores them in VS Code's **secret storage** — never in `settings.json`,
never in the repository, never in a log. The extension then registers the two
providers **in TrueForge** and refers to the models by their TrueForge name.
TrueGuard never calls a provider itself: the agent loop stays inside
TrueForge.

To change a key later, run the same command again. To use a different model,
edit the chain in Settings → TrueGuard → *Modes*.



| Command | What it does |
| --- | --- |
| TrueGuard: Start TrueForge | Start (or attach to) the agent harness |
| TrueGuard: New Chat | Start a new conversation |
| TrueGuard: Stop Turn | Cancel the running turn (and deny its approvals) |
| TrueGuard: Switch Model | Choose the model for the next turn |
| TrueGuard: Review Next Change | Focus the pending reviews |
| TrueGuard: Accept Hunk / Reject Hunk | Accept or reject one hunk |
| TrueGuard: Accept All / Reject All | Accept or reject the whole review |
| TrueGuard: Apply Selected Changes | Write the accepted hunks (verified) |
| TrueGuard: Inline Edit Selection | Select code, describe the change, see the diff |
| TrueGuard: Show Session Log | Open the output channel |

Keyboard: <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd>
accepts a hunk, <kbd>R</kbd> rejects it, <kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>
starts an inline edit.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `trueguard.trueforge.baseUrl` | `http://localhost:8790` | The TrueForge server |
| `trueguard.models` | `[]` | Ordered model profiles (index 0 is primary) |
| `trueguard.toolOutputCapBytes` | `16384` | The cap on one tool result |
| `trueguard.contextBudgetBytes` | `16384` | The cap on the context per message |
| `trueguard.commandTimeoutSec` | `120` | The timeout for agent-run commands |
| `trueguard.allowSecretReads` | `false` | Let the agent read `.env`, `*.pem`, … |
| `trueguard.dev.enableFaultInjection` | `false` | Enable the demo fault commands |

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
| "TrueGuard can not reach TrueForge" | The server is not running: `npm run trueforge`. Check `trueguard.trueforge.baseUrl`. |
| The agent answers but cannot read files | The editor MCP server is not registered: run `npm run setup` and check the TrueGuard output channel. |
| "No model is available right now" | Every model failed. Edit `trueguard.models` and press Retry. |
| The agent's edit was refused | The `oldText` did not match the file exactly. The error says which line looked closest. |
| A change says "Conflict" | The file changed after the agent read it. Review again. |

## License

MIT. Built from scratch for the TrueFoundry Forge-a-thon (Techfest 2026-27).
It is not a fork of any other extension; the only third-party runtime
dependencies are the MCP SDK, zod, jsdiff, marked and DOMPurify.
