# Brief Notes (extracted from docs/brief.pdf, 13 pages)

Source: docs/brief.pdf (official hackathon brief — overrides docs/PRD.md on conflicts).

## Objective

Ship a coding agent as a VS Code extension whose agent loop runs on **TrueForge**
(TrueFoundry's open-source agent harness). TrueForge handles the loop; the team's
energy goes to context assembly and a safe, fast editor experience.

## Mandatory capabilities (all five, or poor capability-coverage score)

1. **Inline edit** — user selects code, presses a keybinding, types an instruction;
   a proposed diff renders in the editor (copy-paste chat reply does NOT count).
2. **Agent mode** — panel where one request drives a TrueForge agent through a tool
   loop (read, search, write, run command); must complete a change spanning ≥3 files
   without the user naming them.
3. **Context assembly** — explicit `@file` and `@symbol` mentions plus automatic
   retrieval of relevant code; TrueForge's context-engineering features should be used.
4. **Diff review** — hunk-by-hunk preview, accept/reject each, no silent writes,
   applied change must be undoable.
5. **Streaming and cancellation** — tokens stream as they arrive; interrupt
   mid-flight; editor never blocks; cancelled run leaves workspace consistent.

## Out of scope (do not spend time)

Tab completion / fill-in-the-middle; training or hosting models; hosted backend
beyond TrueForge local mode; user accounts/auth; Marketplace publishing.

## Models (BYOM)

Any provider API, free tier, AI gateway, or local OpenAI-compatible endpoint —
configured **in TrueForge**. Extension must not call a model provider directly and
must not depend on one provider. Judges may repeat Task A live with a model of
their choice. Every model used must be declared in the write-up with cost. Ship an
example config file; never commit API keys.

## Open-source policy

May reuse open-source editor-side code (webview, diff rendering, keybindings from
Cline/Continue/Roo Code/opencode). The agent loop MUST be TrueForge — keeping an
upstream loop is an **eligibility failure**. If forking: declare upstream URL +
exact commit in README, preserve upstream licence, describe the delta. Judges read
git history from the fork point forward. We are building from scratch.

## Eligibility gate (checked first)

- Extension is a **client** of a TrueForge agent: creates sessions, sends turns via
  the TrueForge HTTP API or TypeScript SDK, renders streamed events.
- Editor capabilities (read file, search, propose write, run command) exposed as
  **MCP tools** — the agent, not the extension, decides what to read and change.
- TrueForge runs in **local mode** (`npx @truefoundry/trueforge@latest`); sandbox
  feature optional. Nothing deployed.
- Model configured in TrueForge as a catalog provider or OpenAI-compatible endpoint.
- Demo video briefly shows the TrueForge session for Task B; repo contains the
  **agent definition** used.

## Round 1 — three fixed tasks

Repository: **pallets/flask, tag 3.1.3 (commit 22d92470)** — ~17,000 lines of Python.

| Task | Instruction | On-screen verification |
| --- | --- | --- |
| A. Inline edit (single file) | Open `src/flask/helpers.py`, select `get_debug_flag`, instruct: "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false." Accept the diff. | `FLASK_DEBUG=off python -c "from flask.helpers import get_debug_flag; print(get_debug_flag())"` prints `False`. |
| B. Agent mode (≥3 files, none named) | Agent panel, no files mentioned: "Add a new built-in CLI command `flask config` that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as '***'. It must appear in `flask --help`, be covered by a test, and be documented alongside the other built-in commands." Review hunks and accept. Show the TrueForge session for this run. | `pytest tests/test_cli.py -q` passes; new command runs against a Flask app and shows masked JSON; diff touches ≥3 files. |
| C. Resilience | Configure TrueForge with an unreachable endpoint or invalid key, repeat Task A. | Editor stays responsive, user sees a clear message (or a second configured model takes over automatically), `git status` shows no files changed. |

## Submission (3 artefacts, via Techfest Competition Portal, links must be public)

1. **Demo video** — max 4 min, editor visible, Tasks A, B, C in order, each followed
   by its on-screen verification, TrueForge session shown during Task B. May cut
   model waiting time; must not cut between instruction and diff appearing.
2. **Write-up PDF** (1–3 pages) — eight headings in order: 1. Team; 2. Starting point
   ("from scratch" for us); 3. Architecture on TrueForge; 4. How context is selected
   (strategy + budget); 5. Model setup (models, where they ran, cost, switching);
   6. Scorecard table (criterion → video timestamp → one-line claim); 7. Tools used
   (declare AI assistants — costs no points); 8. Known limitations.
3. **GitHub repo** — public before deadline; README with clean-clone setup (how to
   start TrueForge locally and load the agent definition); declared fork point if any;
   example model configuration; upstream LICENSE preserved; no secrets committed.

## Scoring (100 points; written anchors, lower anchor applies when between)

| Criterion | Pts | Top anchor |
| --- | --- | --- |
| A1 Inline edit | 10 | diff rendered with per-hunk accept AND reject |
| A2 Agent mode | 10 | discovers and edits 3+ files unprompted (Task B) |
| A3 Streaming & cancellation | 10 | cancellation immediate, workspace consistent |
| B1 Context assembly | 15 | retrieval with size budget, strategy stated, visibly at work in Task B |
| B2 Diff safety | 10 | per-hunk review + working undo shown on screen |
| B3 Resilience (Task C) | 10 | automatic fallback to a second model, no user action, workspace unchanged |
| B4 TrueForge integration depth | 10 | meaningful use of ≥1 context-engineering feature (subagents, deferred tool loading, Code Mode, compaction) or skills, explained and visible in the session |
| C1 Video | 10 | all three tasks complete, legible, visibly verified |
| C2 Write-up | 15 | accurate scorecard with timestamps + honest limitations |

## Process

Two judges score independently (mean; spread >15 → third judge). Top 15 shortlisted.
Ties break on B, then A, then earlier submission. Shortlisted teams repeat Task A
live on a video call with an organisers' model.

Round 2: 16–18 December 2026 at Techfest IIT Bombay; includes raising a PR to the
TrueForge repo. Model credits provided to finalists.

## Key dates

| Event | Date |
| --- | --- |
| Registration closes | 15 November 2026 |
| **Round 1 submission deadline** | **20 November 2026, 23:59 IST** |
| Round 1 results | 30 November 2026 |
| Round 2 finals | 16–18 December 2026 |

## Rules to remember

- Agent loop must run on TrueForge; direct model-provider calls or kept upstream
  loops are ineligible.
- All code is the team's own except declared forks and ordinary dependencies.
- Any AI coding tool may be used to build; declare it in the write-up.
- Models must be declared and configured in TrueForge; hard-coding one provider is
  not acceptable.
- Submission public under an open-source licence compatible with any upstream used.
- Plagiarism/sharing between teams disqualifies all involved.

## Resources

- TrueForge repo: github.com/truefoundry/trueforge · trueforge.dev · /quickstart · Discord
- VS Code API: code.visualstudio.com/api
- Pinned repo: pallets/flask tag 3.1.3
- Editor-side references: Cline, Continue, Roo Code, opencode
