# Feature Iteration Agent Instructions

1. Read `planning/current-feature.json` to find active feature
2. Read the PRD at the path specified in `prdPath`
3. Read `planning/progress.txt` (check Codebase Patterns first)
4. Read `planning/feature-build-learnings.md` for cross-feature product and delivery constraints
5. Read the design reference: `design/design_handoff_photodesk/README.md` for tokens, specs, interaction patterns
6. Check you're on the correct branch (from `current-feature.json`)
   - If branch doesn't exist, create it from `main`
7. Start with the highest priority unfinished story, but use judgment:
   - complete one story when the work is naturally bounded
   - complete multiple tightly-coupled stories in one pass when the implementation and verification are materially shared
   - avoid artificial pauses when the work can be carried further safely
8. Prefer implementing end-to-end slices instead of partial scaffolding
9. **Verify visually**: after any frontend change, check the result in a browser. Screenshots or manual inspection are required before marking a story complete.
10. Update PRD status fields for stories completed in the pass
11. Append learnings to progress.txt
12. Commit when asked or when the operating mode explicitly expects commits

## Design Reference

The design handoff lives in `design/design_handoff_photodesk/`. Key files:
- `README.md` — authoritative spec: tokens, layouts, interaction patterns, Immich integration points
- `theme.css` — CSS custom properties (OKLCH colors, typography, radii, shadows, motion)
- `workspace.jsx` — ProgressRail, Thumb, SceneBlock components
- `lightbox.jsx` — Lightbox, Editor, Stage, Histogram
- `library.jsx` — Library/Discover screen (heatmap, suggested cards, selection panel)
- `shell.jsx` — WorkspaceShell (keyboard, filtering, focus, stacking, toasts) + Summary
- `components.jsx` — Icon SVGs, adjustment engine (adjCss, tempOverlay, vignetteOverlay)

**These are React prototypes for visual reference only.** Reimplement in vanilla JS matching the project's no-build-tools pattern.

## Schema Change Contract

For any story that changes SQLite:

1. Add the next numbered file in `db/migrations/`.
2. Update the full current snapshot in `db/schema.sql`.
3. Never add ad-hoc schema creation or `ALTER TABLE` fallback logic to app startup.
4. Extend migration tests for fresh creation, idempotency, and upgrade from the last shipped schema.
5. Run `npm run migrate` against the local development database after automated tests pass.

## Deploy Contract

Deployment order is git update -> `npm ci --omit=dev` -> `npm run migrate` -> service restart/status. Keep runtime data and secrets outside tracked files so deploys remain replaceable.

## Progress Format

APPEND to progress.txt:

```
## [Date] - [Story ID]
- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered
---
```

## Codebase Patterns

Add reusable patterns to the TOP of progress.txt:

```
## Codebase Patterns
- Pattern name: Description
```

## File Structure

```
planning/
├── current-feature.json        # READ THIS FIRST - active feature config
├── iteration-process.md        # These instructions
├── progress.txt                # Development log (append here)
├── README.md                   # Planning overview
└── features/
    ├── feature-1-visual-workspace.json
    ├── feature-2-library-discover.json
    ├── feature-3-editor.json
    └── feature-4-commit-hardening.json
```

## Stop Condition

If ALL stories in current feature pass, reply:
<promise>COMPLETE</promise>

Otherwise end normally after completing a coherent implementation slice.

## Bash Guidelines
- DO NOT pipe output through `head`, `tail`, `less`, or `more` — causes buffering issues
- Use command-specific flags (e.g., `git log -n 10` instead of `git log | head -10`)
- Avoid chained pipes that can buffer indefinitely
