# PhotoDesk -- Planning

Feature-driven development tracking for PhotoDesk, the photo review & light-edit tool for Immich.

## Structure

- `current-feature.json` -- Active feature context and shipping history
- `progress.txt` -- Chronological development log
- `features/` -- Per-feature PRD (JSON) and summary (MD) pairs
- `iteration-process.md` -- Agent iteration instructions
- `feature-build-learnings.md` -- Durable product, UX, data, and delivery lessons
- `database-and-deployment.md` -- SQLite migration and git deploy policy
- `backlog.md` -- Prioritized follow-up work outside the active feature

## Feature Pipeline

| # | Feature | Status |
|---|---------|--------|
| 0 | Foundation (Express backend, SQLite, Immich API client, basic review UI) | shipped |
| 1 | Visual System + Workspace Redesign | shipped |
| 2 | Library / Discover Screen | shipped |
| 3 | Editor (Crop + Adjustments + Presets) | shipped |
| 4 | Commit Hardening + Edited Asset Upload | shipped |
| 5 | Household Profiles + Scoped Immich Credentials | shipped |
| 6 | Editor Interaction Upgrades | planned |

## Design Reference

All design specs live in `design/design_handoff_photodesk/`. The README.md there is the authoritative design document with tokens, screen specs, interaction patterns, and Immich integration points. The prototype is high-fidelity -- tokens, colors, typography, spacing are final.

## Design Invariants

- **Immich is source of truth**: PhotoDesk reads from it, writes back only on explicit Commit.
- **No build step**: Vanilla HTML/CSS/JS frontend. Express/CommonJS backend.
- **Dark-only**: Photos are judged against neutral dark chrome. No light mode.
- **Keyboard-first**: Every action has a keyboard shortcut. Mouse is the fallback.
- **Non-destructive**: Rejects go to Immich trash (recoverable). Edits upload as new stacked variants.
- **Local state until Commit**: All decisions live in SQLite until the user explicitly pushes.
- **Three-pass model**: Review (pick/reject) -> Rate (1-5 stars) -> Stack (manual grouping). Sequential but switchable.

## Tech Stack

- **Backend**: Node.js, Express, CommonJS
- **Frontend**: Vanilla HTML/CSS/JS (no framework, no build tools)
- **Database**: SQLite via better-sqlite3
- **Image processing** (Phase 3): sharp (libvips)
- **Fonts**: Hanken Grotesk + JetBrains Mono (Google Fonts, self-host in prod)
- **Immich API**: REST, API key auth via x-api-key header, proxied server-side
