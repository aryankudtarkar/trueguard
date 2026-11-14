# The plan — from a working demo to a product that scores

Written 2026-11-14, after the first real hands-on run exposed three problems:
**the onboarding never happened**, **the panel read badly**, and **the agent
was a stub that answered everything the same way**.

This is the plan to fix all three and to land the brief's scoring criteria
before the 20 Nov deadline. Six days left.

---

## Where we honestly are

| | State |
| --- | --- |
| The trust core (G1/G2/G3) | **Done and proven.** Hunk-level approval, verification against buffer *and* disk, rollback, failover with a resume that does not repeat the work. |
| The editor tools | **Done.** The agent reads, searches and edits through our own MCP server. |
| The onboarding | **Broken.** The walkthrough does not activate the extension, the "onboarded" flag is set before the user does anything, and nobody is ever asked for a key. |
| The chat | **Works, looks like a demo.** A narrow panel, no header, no real state, no sense of place. |
| The agent's intelligence | **Borrowed.** With the fake provider it searches and quotes your code; with a real key it is a real model. Nobody has seen the second one yet. |
| The demo | **Unrehearsed.** Tasks A, B and C on Flask have never been run end to end. |
| The write-up and the video | **Not written.** 25 points. |

**The product is real underneath and unfinished on the surface.** Everything
below is about the surface — and about proving the thing works.

---

## Phase 1 — Onboarding that actually happens *(half a day)*

**Why:** nothing else matters if the first thirty seconds are confusing. The
user opened the extension and got a chat with a stub model and no explanation.

**The fixes:**
1. `onWalkthrough:trueguard.gettingStarted` joins the activation events, so
   opening the walkthrough runs our code.
2. The `onboarded` flag is set **only when the user finishes the provider
   step** (or explicitly skips it). Never optimistically.
3. The first run shows a **welcome in the chat** — not a blank panel — with
   one clear action: *Set up your models*.
4. The provider setup is a **flow**, not a form: Groq key → NVIDIA NIM key →
   done, with *Skip, use the development provider* as an honest escape.
5. The walkthrough is **re-offered** from the chat until it is done.
6. `TrueGuard: Check Setup` becomes the single "am I ready?" command, and the
   walkthrough's first step is it.

**Done when:** a clean VS Code profile → install → the walkthrough opens on
its own, the chat greets the user, the key prompt appears, and after the keys
a real question gets a real answer. Verified on a fresh profile, not on mine.

---

## Phase 2 — The agent, with a real model *(half a day)*

**Why:** the fake provider is a demo crutch. It searches and quotes; it cannot
reason or write a patch. The brief's Tasks A and B need a model that can.

**The work:**
1. **The tool descriptions are the prompt.** A real model reads our MCP tool
   schemas and nothing else: `propose_edit` must say exactly what an exact
   match is, when to use `create` instead, and that the user reviews hunks.
2. **The agent instructions** (the system prompt we send with every session)
   get the same treatment — short, concrete, about *how* to work here.
3. **The fake provider says what it is**: "I am the development provider — I
   search and quote, I do not reason. Add a key for a real model." No more
   pretending.
4. **A model check on the provider**: the setup verifies the key works (a
   one-token call) before declaring success.

**Done when:** with a real key, "add a docstring to X" produces a correct
hunk-level proposal that the user can accept, and the fake provider never
claims to be more than it is.

---

## Phase 3 — The chat as a product *(1–1.5 days)*

**Why:** the panel is where the user lives. Right now it is a message list in
a narrow strip.

**The work:**
1. **A header**: the mode and model, the server's state, and what TrueGuard
   is doing right now ("Working…", "2 changes to review").
2. **A real empty state**: a title, one sentence, three starter chips, and the
   setup action when nothing is configured.
3. **A message list that reads**: the agent's prose at full width, the user's
   message as a quiet bubble, the system rows as quiet lines, the tool rows as
   one collapsed line each.
4. **The review cards**: the file, the counts, the status chip, and the
   **Revert** once it is applied.
5. **The composer**: the context chips, the mode pill, and a clear disabled
   state that says *why* it is disabled.
6. **Two layouts**: the panel must work in the 300 px sidebar **and** in a
   wide panel. (The chat belongs in the Secondary Side Bar for the demo.)
7. **The states, all of them**: empty, streaming, working, awaiting review,
   failover, offline, not configured, error.

**Done when:** a screen recording of the five flows looks like a product
someone would pay for — and I can show it to the user before they see it.

---

## Phase 4 — The review experience, end to end *(1 day)*

**Why:** the trust story is the whole pitch. It must be demonstrable in one
take, without fumbling.

**The work:**
1. The change card → the diff → accept/reject → verified → **undo** → **revert**.
2. The diff opens at the right hunk, scrolls to it, and says when the file
   changed under the proposal.
3. The **conflict** and **rollback** paths get their own one-click demos
   (the dev commands already exist).
4. The **status bar** and the **Changes view** always agree with the chat.

**Done when:** Tasks A and B of the brief run end to end on Flask, with the
verification visible on screen.

---

## Phase 5 — The demo, recorded *(1 day)*

**Why:** 10 points for the video, 15 for the write-up. Both are writing, and
both are cheap **if** the product works.

**The work:**
1. Rehearse the three fixed tasks on `pallets/flask` @ `22d92470` and fix
   whatever breaks.
2. Record the four-minute video: Tasks A, B, C in order, each with its
   on-screen verification, the TrueForge session visible during Task B, and
   no cuts between an instruction and the diff appearing.
3. Write the PDF with the eight required headings, including the honest
   limitations and the scorecard with timestamps.

**Done when:** the video is recorded, the write-up is written, and both link
to the public repo.

---

## Phase 6 — The final pass *(half a day)*

The whole-codebase audit again, the dead-code sweep, the packaging, the
repository README, the submission page.

---

## The order, and why

```
1. Onboarding      → nothing else matters if the first 30 s are confusing
2. The agent       → the demo needs a real model; this unblocks Tasks A and B
3. The chat        → the product's face; do it while the behaviour is fresh
4. The review flow → the trust story, rehearsed
5. The demo        → only once 1–4 hold
6. The final pass
```

Phases 1 and 2 are small and unblock everything. Phase 3 is the biggest
chunk of work; it is also the one where your taste matters most, so I will
show you the result **before** I polish it further.

## What I will not do

- **Inline autocomplete, repository indexing, embeddings.** The brief lists
  them as out of scope, and the six days are better spent on the five
  criteria that are in scope.
- **A second window, a custom UI kit, a framework in the webview.** The
  chat stays a plain webview with theme variables — that is what "native
  first" means, and it is why the panel can look right in any theme.
- **Anything that touches the trust core without a test first.**

## The risk register

| Risk | Mitigation |
| --- | --- |
| The real model proposes edits worse than we hope | The tool description and the instructions get a dedicated pass (Phase 2); the approval flow means a bad proposal costs the user nothing but a click |
| Phase 3 is too big for the time | The header, the empty state and the message list are separable from the cards; I will land them in that order and show you after each |
| The keys do not arrive | The development provider stays, and says plainly what it can and cannot do |
| The video is rushed | The rehearsal in Phase 5 is the rehearsal of the demo, not a separate thing — if the rehearsal is good, the recording is quick |
