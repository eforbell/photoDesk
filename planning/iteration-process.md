# Feature Iteration Agent Instructions

1. Read `planning/current-feature.json` to find active feature
2. Read the PRD at the path specified in `prdPath`
3. Read `planning/progress.txt` (check Codebase Patterns first)
4. Read the design reference: `design/design_handoff_photodesk/README.md` for tokens, specs, interaction patterns
5. Check you're on the correct branch (from `current-feature.json`)
   - If branch doesn't exist, create it from `main`
6. Start with the highest priority unfinished story, but use judgment:
   - complete one story when the work is naturally bounded
   - complete multiple tightly-coupled stories in one pass when the implementation and verification are materially shared
   - avoid artificial pauses when the work can be carried further safely
7. Prefer implementing end-to-end slices instead of partial scaffolding
8. **Verify visually**: after any frontend change, check the result in a browser. Screenshots or manual inspection are required before marking a story complete.
9. Update PRD status fields for stories completed in the pass
10. Append learnings to progress.txt
11. Commit when asked or when the operating mode explicitly expects commits

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
