# Backlog

Ordered. Promoted P0 items first (per DECISIONS 2026-11-12), then PRD stretch.

## Promoted to P0 (brief-driven)

1. FR-12 Context assembly: `@file` and `@symbol` mentions in the composer; automatic
   retrieval (strategy TBD: file map + ripgrep scoring + recent-edits recency) with a
   visible size budget; agent shows which files it chose (B1 top anchor, 15 pts).
2. FR-11 Inline edit: selection + keybinding (Cmd+K style), inline instruction input,
   proposed diff rendered in the editor, per-hunk accept/reject (A1, 10 pts; Task A).

## PRD stretch (after all phases clean)

- Checkpoints and Revert (FR-10)
- reject-with-reason sent to the agent
- Session cost meter
- CodeLens in the diff editor
- Session history (last 20) — keep only if time
