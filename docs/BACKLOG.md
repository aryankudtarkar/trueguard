# Backlog

Ordered. Promoted P0 items first (per DECISIONS 2026-11-12), then PRD stretch.

## Promoted to P0 (brief-driven)

1. FR-12 Context assembly: `@file` and `@symbol` mentions in the composer; automatic
   retrieval (strategy TBD: file map + ripgrep scoring + recent-edits recency) with a
   visible size budget; agent shows which files it chose (B1 top anchor, 15 pts).
2. FR-11 Inline edit: selection + keybinding (Cmd+K style), inline instruction input,
   proposed diff rendered in the editor, per-hunk accept/reject (A1, 10 pts; Task A).

## Phase 1–4 audit leftovers (2026-11-12)

- (S2) FR-8 redacted JSON event log per session in globalStorage (LogOutputChannel
  exists; the structured per-session event log does not yet).
- (S3) `newChat()` while a turn is running drops the session pointer; the running
  turn keeps streaming into a cleared chat. New Chat should stop the turn first.
- (S3) chatProvider.chipFor builds workspace-relative paths with a string prefix
  slice — wrong on Windows backslash paths; the Phase 2 path guard must own this.
- (S3) switchModel QuickPick logic duplicated in extension.ts and chatProvider.ts.
- (S2) Adjacent changes appear as ONE hunk (the diff merges them). Splitting
  adjacent changes into separate hunks would give the user finer accept/reject
  granularity in the demo ("accept 2 of 3").
- (S3) The Changes view shows absolute paths for files outside the workspace
  folder; a workspace-relative label would read better.

## PRD stretch (after all phases clean)

- Checkpoints and Revert (FR-10)
- reject-with-reason sent to the agent
- Session cost meter
- CodeLens in the diff editor
- Session history (last 20) — keep only if time
