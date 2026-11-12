# Demo script — ForgeGuard

A timed run for the live demo (about four minutes). Every step has a line to
say and a thing to show. The recording checklist is at the end.

## Before the demo (5 minutes, not on stage)

```bash
npm install
node spikes/fake-openai.mjs &     # the provider (no keys needed)
npm run setup                     # registers the models
npm run trueforge                 # the agent harness
```

- Open the benchmark repository (a small Python project) in VS Code.
- Open the ForgeGuard view; the status bar shows **ForgeGuard** (ready).
- Open **Settings → ForgeGuard: Models** and check that two models are listed.
- Zoom the editor to 100 % and hide the sidebar panels you do not need.

---

## D1 — Multi-file refactor, 3 hunks, accept 2 (60 s)

**Say:** "ForgeGuard never writes anything without your review."

1. Select the function `calculate_total` in `app/calculate.py`.
2. Press <kbd>Ctrl/Cmd</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>.
3. Type: `add a docstring and handle empty items` and press Enter.
4. The agent reads the file and proposes an edit. **The diff opens next to
   the code**; the Changes view shows `3 to review`.
5. In the Changes view, **uncheck the third hunk**.
6. Press **Apply Selected Changes** (or Ctrl/Cmd+Shift+Alt+A).

**Show:** the file on disk now contains exactly the two accepted hunks. The
chat says `Applied 2 of 3 changes. Verified against disk.`
Press <kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd> — the change is undone in one step.

---

## D2 — The provider fails mid-task (60 s)

**Say:** "A rate limit does not end your turn."

1. Run **ForgeGuard: Dev: Inject 429 (rate limit)**.
2. Ask: `now add type hints to the calculate function`.
3. The first attempt fails. The chat shows **one** row:
   `Switched to Model B because Model A is rate-limited.`
   The status bar shows `$(warning) Model B`.
4. The turn **continues** on the fallback model and finishes.

**Show:** the answer arrives, and there is no second failure notice.
Run **ForgeGuard: Dev: Clear injected faults**.

---

## D3 — The write is corrupted (45 s)

**Say:** "ForgeGuard verifies every write. If the file does not match, it is
restored — and you are told."

1. Run **ForgeGuard: Dev: Corrupt Next Write**.
2. Ask for a small edit.
3. Accept it.
4. The chat says: `The file did not match what you approved, so it was
   restored. Nothing was lost.`

**Show:** the file on disk is **unchanged**. Nothing was lost.

---

## D4 — The agent proposes something invalid (45 s)

**Say:** "The agent gets told what is wrong, so it can correct itself."

1. Ask: `delete the function that does not exist`.
2. The agent proposes an edit whose `oldText` is not in the file.
3. ForgeGuard refuses it and the agent receives the reason
   (`oldText does not appear in the file… line 42 looks closest`).

**Show:** no review ever appears in the Changes view — the user is never
shown a broken proposal.

---

## D5 — The context and the commands (45 s)

**Say:** "The agent sees your workspace, and it can run your commands — with
your approval."

1. In the chat, type `@` and pick `app/calculate.py` — the file becomes a
   context chip.
2. Ask: `what does calculate_total do?`
3. The chat shows the context it chose: `Context: app/calculate.py (2.1 KB of
   16 KB)`.
4. Ask: `run the tests with pytest`.
5. The command card appears with the **exact** command. Press **Allow**.

**Show:** the command runs, the exit code and the duration are reported, and
the output channel has the full log.

---

## Closing (15 s)

**Say:** "Nothing reaches disk without hunk-level approval, no success is
claimed without verification, and a provider failure does not end the
session."

## Recording checklist

- [ ] The status bar shows a green **ForgeGuard** before the first question.
- [ ] The Changes view is visible during D1 (drag it next to the editor).
- [ ] The diff opens next to the code in D1 (not a modal).
- [ ] The receipt row `Applied 2 of 3 changes. Verified against disk.` is
      readable.
- [ ] Exactly one failover notice in D2 (no repeated rows).
- [ ] D3 ends with the file visibly unchanged.
- [ ] The context row in D5 names the files and the budget.
- [ ] No console errors, no red panels, no unexplained pauses.
