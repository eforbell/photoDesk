# Feature Build Learnings

Durable lessons from the foundation, visual workspace, and library/discovery builds. Apply these before starting later PRDs.

## Product semantics

- **Committed means processed.** A session/asset is not processed merely because local decisions exist; the marker is written only after the complete Immich commit succeeds.
- **Use “Review” in user-facing copy.** “Cull/culled” reads as destructive or harsh. Historical internal names may remain where renaming adds risk, but new UI and PRDs should use review/reviewed.
- **Immich remains the source of truth.** PhotoDesk caches local workflow state and discovery snapshots, then writes back only through explicit Commit.
- **Session labels are editable metadata.** Date-derived names are useful defaults, not permanent identities.
- **Ratings are a cross-stage action.** Small sessions make a strict second-pass-only rating stage inefficient, so stars should remain available anywhere an asset is being inspected.

## Workflow and commit safety

- The Review -> Rate -> Stack -> Commit rail is a navigation model, not a hard lock. Stages remain switchable while preserving context.
- Commit must be atomic from the user's perspective: record the committed/processed state only after every required remote action succeeds.
- Any future uploaded derivative needs durable local status and a remote asset ID so retries do not casually create duplicates.
- Commit completion must invalidate discovery caches because deletes/uploads change library membership and counts.

## Discovery and time

- Discovery should compute one coherent snapshot and reuse it for totals, suggested sessions, heatmap, and date browsing. Independent scans cause count drift and needless Immich load.
- Determine membership by exact asset IDs, not date-range inference. A date may contain both reviewed and unreviewed photos.
- Use the configured process timezone (`TZ=US/Eastern` in the current environment) for calendar buckets and display dates. UTC grouping can shift late-evening photos into the wrong day.
- Design mock data expresses composition and hierarchy, not production cardinality. Real libraries need empty, sparse, dense, duplicate-looking, and long-label handling.

## Responsive behavior

- PhotoDesk is desktop-first, but critical actions must remain reachable on a phone-sized viewport without device rotation.
- The stage rail is the first narrow-width pressure point. Allow horizontal scrolling/compression and keep Commit reachable.
- Lightbox and review interactions must work by tap without hover assumptions. Keyboard legends may compact or hide before primary controls do.
- For future editor forms, use mobile-safe text control sizing and persistent Save/Cancel actions. Mobile is a guarded lightweight mode, not a promise of full desktop ergonomics.

## Visual implementation

- The handoff prototypes are authoritative for tokens, typography, spacing, borders, radii, and semantic colors, but they are not production architecture.
- Reuse the shipped Hanken Grotesk and JetBrains Mono roles; avoid introducing near-match fonts or arbitrary grays/blues.
- Validate with real local Immich images. Photo aspect ratios, brightness, and scene sizes expose layout failures that placeholders hide.
- After frontend changes, compare desktop and narrow screenshots before calling the story complete.

## Database and deployment

- Every schema change gets a numbered migration plus an updated `db/schema.sql` snapshot. Do not return to ad-hoc startup `ALTER TABLE` logic.
- Migration validation must cover fresh creation, idempotent rerun, and upgrade/adoption of the previously shipped schema.
- Deploy order is fixed: update git checkout, install locked production dependencies, migrate, restart, then inspect service health/status.
- Runtime databases, rendered edits, secrets, and caches must live in ignored/durable paths and survive git deploys.

## Partner timelines expose readable but non-writable assets

Immich metadata search may include assets from partners whose timelines are
enabled. Those assets can be visible and previewable while trash, rating, stack,
and other update operations remain unauthorized for the connected API key.

For the single-user MVP, filter discovery to the current Immich user's
`ownerId`, persist that owner on session assets, and reject older mixed-owner
sessions before any commit mutation. Future partner support must be an explicit
library scope with visible ownership and per-operation capability handling.
