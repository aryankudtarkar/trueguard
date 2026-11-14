# Using TrueGuard — the complete first run

This guide assumes you have **never used TrueGuard before**. It takes about
fifteen minutes the first time, five minutes afterwards.

Read it once end to end, then keep it open while you learn the tool.

---

## Part 0 — What you are about to run

Three pieces, and it helps to know what each one is:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| **TrueForge** | The agent harness. It owns the agent loop, the sessions, the tools and the models. | a local server on `http://localhost:8790` |
| **The model provider** | Something that answers model requests. For the first run, a **fake** one that needs no API key. | a local server on `http://127.0.0.1:8799` |
| **TrueGuard** | The VS Code extension *you* are about to run. It is a **client**: it creates sessions, streams the answers, and gives the agent access to your editor. | inside VS Code |

TrueGuard never talks to a model provider directly. Everything goes through
TrueForge. That is a rule of the whole design, and it is why the extension
cannot break your agent loop.

---

## Part 1 — Start everything (one command)

```bash
cd trueguard
npm install        # once
npm run dev
```

`npm run dev` does the boring parts for you:

```
TrueGuard — getting you ready

  ✓ model provider already running on :8799
  ✓ TrueForge already running on :8790

  registering the development provider…
  provider fake-provider registered (PUT)

TrueGuard is ready. Next:
  1. open the folder in VS Code and press F5 (Run Extension)
  2. click the TrueGuard icon in the Activity Bar
  3. run "TrueGuard: Check Setup" if anything looks wrong

Keep this terminal open. Ctrl+C stops both processes.
```

**Leave that terminal open.** Ctrl+C stops TrueForge and the provider.

<details>
<summary>I would rather start the two servers myself</summary>

```bash
# terminal 1
npm run trueforge

# terminal 2
npm run fake-provider

# terminal 3 (once)
npm run setup
```

</details>

## Part 2 — Launch the extension

1. In VS Code, open the `trueguard` folder (the one with `package.json`).
2. Press <kbd>F5</kbd>. A new VS Code window opens with TrueGuard loaded.
   *(Or: the ▷ button in the Run and Debug panel, with "Run Extension" selected.)*
3. In that new window, click the **TrueGuard** shield in the Activity Bar —
   the left-hand strip. The chat opens on the right.
4. Look at the **status bar, bottom left**:

| It says | Meaning |
| --- | --- |
| `$(shield) TrueGuard` | Ready. |
| `$(error) TrueForge offline` | The server is not running. Go back to Part 1. |
| `$(loading~spin) Starting TrueForge` | It is starting (first time takes a minute). |
| `$(eye) N to review` | Changes are waiting for your approval. |
| `$(warning) Model B` | The primary model failed; the turn moved to the next one. |

## Part 3 — Check the setup (once, and any time you are stuck)

Press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> to open the Command
Palette, type **TrueGuard: Check Setup** and press <kbd>Enter</kbd>.

You get one of two answers:

- *"TrueGuard is ready"* — everything is fine, carry on.
- A **list of problems**, each with a button. Click the button and TrueGuard
  fixes it for you (starting the server, registering the connector, opening
  the provider setup).

This command exists because "nothing happens" is the worst bug report in the
world. Never guess again: run it, read it, click the fix.

## Part 4 — Your first question

Click in the chat box at the bottom right and type:

> What does this extension do? Read the README and answer in three sentences.

Press <kbd>Enter</kbd>.

What happens, second by second:

1. The text appears in the chat as your message.
2. An **agent message** starts streaming in, word by word.
3. Behind it, the agent called `read_file` on `README.md` **through TrueForge,
   through our own MCP server**. You can see it: the chat grows a collapsed
   line like `read_file README.md`, and the TrueGuard output channel logs it.
4. The answer arrives.

*If nothing happens:* the model may not be set. Click the pill next to the
composer (it shows the mode) and pick a model — TrueGuard lists every model
TrueForge knows, so there is nothing to type.

## Part 5 — Watch the trust layer work (the important part)

Type:

> Add a short docstring to the `runInlineEdit` function in src/ui/inlineEdit.ts.

Now watch what does **not** happen: **your file does not change.** Not yet.

Here is the sequence:

1. The agent reads the file (`read_file`).
2. The agent calls `propose_edit` with the exact text it wants to replace.
3. **TrueForge pauses the turn** at the approval gate. The agent is now
   waiting for a human.
4. A **change card** appears in the chat: the file name, `+1 -0`, and a chip
   that says **Awaiting review**.
5. The **Changes view** (the second icon in the Activity Bar, next to the
   chat) shows the pending change: a group node, the file, and one node per
   hunk with a checkbox.
6. The **diff opens beside your code**: the left side is your file, the right
   side is what TrueGuard *would* write. It is a real VS Code diff editor —
   you can scroll it, search it, and jump between sides with the arrow keys.
7. The status bar now says `$(eye) 1 to review`.

### Now approve it

- **Uncheck** a hunk in the Changes view → it will not be written.
- Press **Apply Selected Changes** in the Changes view title bar
  (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> accepts a
  hunk, <kbd>R</kbd> rejects it).
- The card moves to **Applying**, then to **Verified**, and the chat says:

  > Applied 1 of 2 changes. Verified against disk.

- Open your file: **only** the hunks you approved are there. The ones you
  unchecked are not.
- Press <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd>: the whole change is undone in one
  step (it was one edit, so it is one undo).

### If it goes wrong, TrueGuard tells you

| The chat says | What happened | What TrueGuard did |
| --- | --- | --- |
| *This file changed after the agent proposed edits.* | You edited the file while the review was open. | **Nothing was written.** Your version is untouched. |
| *The file did not match what you approved, so it was restored.* | The write did not land as intended. | The file was **rolled back** to your version. Nothing was lost. |
| *Verification failed* | The editor or the disk did not end up with the approved text. | Rolled back, and the agent is told the truth — never "done". |

This is the part competitors get wrong: they apply a diff and *say* it worked.

## Part 6 — The inline edit

1. Put the cursor in some code and **select** it.
2. Press <kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>.
3. A small input box appears at the top of the editor. Type what you want:

   > make this a for loop

4. Press <kbd>Enter</kbd>. The diff opens next to your selection, with the
   proposed change on the right.
5. Same approval flow: uncheck what you do not want, then **Apply Selected
   Changes**.

## Part 7 — Running commands (with your permission)

Type:

> Run the tests with pytest.

A **command card** appears showing the **exact** command, the working
directory, and a warning if the command is risky (`rm -rf`, `sudo`, `git push`,
a download piped into a shell — those are **highlighted**, never blocked).

- **Allow** → the command runs. Its output streams to the
  **TrueGuard Commands** output channel. The agent gets the exit code and the
  duration.
- **Deny** → it never runs, and the agent is told you refused.

## Part 8 — Proving it survives a broken provider

1. Press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> → **TrueGuard: Dev:
   Inject 429 (rate limit)**.
2. Ask for another change and approve it.
3. The first attempt is rate-limited. **The turn does not die**: it continues
   on the next model, and the chat shows exactly one line:

   > Switched to Model B because Model A is rate-limited.

4. Clear it afterwards: **TrueGuard: Dev: Clear injected faults**.

## Part 9 — Finding out what really happened

**TrueGuard: Show Session Log** opens the redacted JSON log of the last
session: every event, every tool call, every result, with keys and tokens
removed.

When something surprises you, this is the first place to look. The second is
*View → Output → TrueGuard*.

---

## Part 10 — Switching to your own models

The fake provider is free and needs no account. For the real thing:

1. Get a key: [Groq](https://console.groq.com/keys) (starts `gsk_`) and
   [NVIDIA NIM](https://build.nvidia.com) (starts `nvapi-`).
2. **TrueGuard: Configure Providers** (or the walkthrough's third step).
3. Paste the Groq key, then the NVIDIA NIM key. Both are stored in VS Code's
   **secret storage** — never in `settings.json`, never in the repository,
   never in a log.
4. TrueGuard registers both providers **in TrueForge** and fills the modes:

   | Mode | Provider | Model |
   | --- | --- | --- |
   | **Fast** | Groq | `gpt-oss-120b` |
   | **Thinking** | NVIDIA NIM | `deepseek-ai/deepseek-v4.1-flash` |

5. **TrueGuard: Switch Mode** (or the pill in the chat) picks which one the
   next turn uses. The Thinking mode asks the model to think harder
   (`reasoning_effort: medium`).

The same keys can come from a `.env` file instead:

```bash
echo "GROQ_API_KEY=gsk_..." >> .env
echo "NVIDIA_API_KEY=nvapi-..." >> .env
npm run setup
```

`.env` is in `.gitignore` — it never reaches the repository.

---

## Part 11 — The commands, all of them

Press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> and type `TrueGuard`:

| Command | What it does |
| --- | --- |
| **Check Setup** | Is everything ready? Fixes what is not. |
| **Start TrueForge** | Starts (or attaches to) the agent harness. |
| **Stop TrueForge** | Stops it. |
| **Configure Providers** | Adds or changes your Groq / NVIDIA keys. |
| **Switch Mode** | Fast or Thinking. |
| **New Chat** | A fresh conversation. |
| **Stop Turn** | Cancels the running turn (and denies its approvals). |
| **Inline Edit Selection** | Select → describe → diff. (<kbd>Ctrl/Cmd+Alt+I</kbd>) |
| **Review Next Change** | Focuses the Changes view. |
| **Accept Hunk** / **Reject Hunk** | One hunk. (<kbd>Ctrl/Cmd+Shift+Alt+A</kbd> / <kbd>R</kbd>) |
| **Accept All** / **Reject All** | The whole review. |
| **Apply Selected Changes** | Writes the accepted hunks (verified). |
| **Revert Last Change** | Puts a file back the way it was (FR-10). |
| **Show Session Log** | The redacted JSON log of the last session. |
| **Dev: Inject 429 / 503 / 401 / stall** | Break the provider on purpose (demo). |
| **Dev: Corrupt Next Write** | Corrupt the next write on purpose (demo). |

## Part 12 — When something does not happen

| What you see | Why | What to do |
| --- | --- | --- |
| `TrueForge offline` | The server is not running | `npm run dev` |
| *Add a model in Settings* | TrueForge has no model for this mode | Click the pill, pick a model |
| The agent answers but reads nothing | The MCP connector is not registered | **TrueGuard: Check Setup** → *Reload the window* |
| *Provider returned error* | The provider is unreachable or the key is wrong | **TrueGuard: Configure Providers** |
| The approve button does nothing | The turn is still waiting at the gate | Look at the **Changes** view; the approval is per tool call |
| *Conflict* | The file changed after the agent read it | Review again |
| *Did not match what you approved* | The write did not land | It was rolled back; nothing was lost |

**Two places to look, always:** *View → Output → TrueGuard* (everything that
happened) and **TrueGuard: Show Session Log** (the same, structured).
