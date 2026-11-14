# Using TrueGuard — a first run

This is the guide for the first time: what to type, what you should see, and
what to do when something does not happen.

---

## 1. Start the two servers

TrueGuard is a **client**: it talks to a TrueForge server, and the model
provider runs behind that server. Two processes, two terminals.

```bash
cd trueguard

# terminal 1 — the agent harness (the thing that runs the agent loop)
npm run trueforge

# terminal 2 — a model provider
node spikes/fake-openai.mjs        # the free fake provider: no API key needed
```

You should see:

```
TrueForge listening on http://localhost:8790     (terminal 1)
fake-openai on http://127.0.0.1:8799              (terminal 2)
```

**Check it in one line:**

```bash
curl -s http://localhost:8790/api/v1/settings/model-providers | \
  python3 -c "import json,sys; [print(' ', p['name']+'/'+m['model_id']) for p in json.load(sys.stdin)['data'] for m in p['manifest'].get('models',[])]"
```

If that prints `fake-provider/test-model`, you are ready. If it prints
nothing, run `npm run setup` (it registers the fake provider with TrueForge).

## 2. Launch the extension

In VS Code: open the `trueguard` folder, then

- press <kbd>F5</kbd> (**Run Extension**), or
- the ▷ button in the Run and Debug panel,

and pick the **Run Extension** configuration. A second VS Code window opens
with TrueGuard loaded. Click the **TrueGuard** icon in the Activity Bar (the
shield on the left edge) to open the chat.

The status bar, at the bottom left, tells you the state:

| It says | It means |
| --- | --- |
| `$(shield) TrueGuard` | ready |
| `$(error) TrueForge offline` | the server is not running — go back to step 1 |
| `$(loading~spin) Working` | a turn is running |
| `$(eye) N to review` | changes are waiting for you |

## 3. Say something

Type in the chat box and press <kbd>Enter</kbd>:

> What does this extension do? Read the README and answer in three sentences.

The answer streams in. Behind it, the agent read `README.md` **through our own
MCP tool** — you can watch that in the **TrueGuard** output channel
(*View → Output → TrueGuard*) or in the collapsed tool row in the chat.

**If the chat says "Add a model in Settings"**, TrueForge has no model for the
active mode. Click the pill next to the composer (it shows the mode) and pick
one — TrueGuard lists every model TrueForge knows, so there is nothing to
type.

## 4. Watch the trust layer work

Ask for a change:

> Add a short docstring to the `runInlineEdit` function in src/ui/inlineEdit.ts.

What happens, in order:

1. The agent reads the file and calls `propose_edit`.
2. **TrueForge pauses the turn** at the approval gate.
3. A **change card** appears in the chat, and the **Changes** view (the second
   icon in the Activity Bar) shows the hunks with checkboxes.
4. The **diff opens beside your code** — the right-hand side is the proposed
   version.
5. **Uncheck one hunk**, then press **Apply Selected Changes**
   (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> accepts a
   hunk; <kbd>R</kbd> rejects it).
6. The file changes **only** in the hunks you accepted. The chat says
   *Applied 1 of 2 changes. Verified against disk.*
7. Press <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> — the change is undone in one step.

Nothing is written before step 5. That is the whole point.

## 5. The inline edit

Select some code, press <kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>, and
type what you want:

> make this a for loop

The diff opens next to the selection. Same approval flow, same verification.

## 6. Run a command

> Run the tests with pytest.

A **command card** appears with the exact command. Press **Allow** (or
**Deny**). The output streams to the **TrueGuard Commands** output channel and
the agent gets the exit code and the duration.

## 7. Prove the resilience

> TrueGuard: Dev: Inject 429 (rate limit)

then ask for another change. The turn **continues on the next model**, and the
chat shows exactly one line:

> Switched to Model B because Model A is rate-limited.

Clear the fault afterwards with **TrueGuard: Dev: Clear injected faults**.

## 8. Check what really happened

**TrueGuard: Show Session Log** opens the redacted JSON log of the last
session — every event, every tool call, every result. It is the answer to
"what did the agent actually see and do?".

---

## Using your own keys (Groq + NVIDIA NIM)

The fake provider above is free and needs no account. For the real thing:

1. **TrueGuard: Configure Providers** (or the walkthrough's second step).
2. Paste your **Groq** key (starts with `gsk_`) and your **NVIDIA NIM** key
   (starts with `nvapi-`). They are stored in VS Code's **secret storage** —
   never in your settings, never in the repository.
3. TrueGuard registers both providers **in TrueForge** and fills the two
   modes:
   - **Fast** → Groq `gpt-oss-120b`
   - **Thinking** → NVIDIA NIM `deepseek-ai/deepseek-v4.1-flash`
4. **TrueGuard: Switch Mode** (or the pill in the chat) picks which one the
   next turn uses.

You can also put the keys in a `.env` file and run `npm run setup` — the
script registers the same two providers from there.

---

## When something does not happen

| What you see | What it means | What to do |
| --- | --- | --- |
| `TrueForge offline` in the status bar | The server is not running | `npm run trueforge` in terminal 1 |
| "Add a model in Settings" | TrueForge has no model for this mode | Click the pill and pick a model |
| The agent answers but cannot read files | The MCP connector is not registered | `npm run setup`, then reload the extension window |
| "Provider returned error" on every turn | The provider is not reachable | Check the key: **TrueGuard: Configure Providers** |
| Nothing happens when you accept a change | The turn is still waiting for approval | Look at the **Changes** view; the approval is per tool call |
| A change says "Conflict" | The file changed after the agent read it | Review again — the extension refuses to overwrite your newer edit |
| A change says "did not match what you approved" | The write did not land | It was rolled back; nothing was lost |

**The one place to look when something is strange: the output channel.**
*View → Output → TrueGuard* has everything: the server's output, the tool
calls and the failures.
