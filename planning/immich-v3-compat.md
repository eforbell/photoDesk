# Immich v3 Compatibility Review

**Status: deferred — staying on Immich v2.x until v3.x stabilizes.**

Immich v3.0.0 shipped 2026-07 with breaking API changes, followed days later by
the v3.0.1 hotfix (v2 mobile clients broke against v3 servers). This doc maps
the published breaking changes onto photoDesk's Immich client
(`src/immich-client.js`) so the upgrade is a checklist, not a re-investigation.

References:

- Migration guide: https://immich.app/blog/v3-migration
- Hotfix release: https://github.com/immich-app/immich/releases/tag/v3.0.1

## Required changes before pointing photoDesk at a v3 server

### 1. Upload: remove `deviceAssetId` / `deviceId` form fields

`uploadAsset()` sends `deviceAssetId` and `deviceId` in the multipart form
because **v2 requires them**. v3 **removes** both properties from
`POST /assets`, and its new Zod validation may reject requests carrying them
(400) rather than stripping them.

Fix: drop the fields (or send them only when the server major version is < 3 —
`GET /api/server/about` exposes the version).

Affects: "Upload edited versions" commit step.

### 2. Search: pin `visibility: 'timeline'` on metadata search

v3 changes the default `visibility` on `POST /api/search/metadata` from
`timeline` to `any`. Without an explicit value, photoDesk's library scans
(`searchAssets()` → density heatmap, suggestions, un-triaged counts) would
start including **trashed and archived** assets — i.e. photos rejected via
photoDesk reappear in un-triaged counts until trash purge (~30 days).

Fix: always send `visibility: 'timeline'`. Backward-compatible — v2 accepts
the parameter — so this can be committed ahead of any upgrade.

Affects: library screen stats, heatmap, suggestions, session creation.

### 3. Verify: `PUT /api/assets/copy` (stack association)

`copyStackAssociation()` uses `PUT /api/assets/copy` to attach an uploaded
edit to the original's existing stack. Not listed as removed in the migration
guide, but the adjacent `PUT /assets/:id/original` was replaced with
`PUT /assets/:id/clone`, so this API area was touched. Verify against a v3
test instance before trusting the edits commit step.

## Reviewed and believed safe

| photoDesk call | v3 status |
| --- | --- |
| `PUT /api/assets/:id` `{ rating }` | Unchanged; rating tightened to integer (we already send integers) |
| `DELETE /api/assets` (trash) | Not in breaking list |
| `POST /api/stacks` | Not in breaking list |
| `GET /api/assets/:id/thumbnail?size=preview` | Unchanged |
| `GET /api/assets/:id/original` (download) | Unchanged (`PUT :id/original` was removed, not `GET`) |
| `GET /api/users/me` (`x-api-key` auth) | Unchanged |
| Error handling | v3 restructures error bodies (Zod); photoDesk only string-interpolates them, no parsing |
| Response shape changes (`deviceId`/`deviceAssetId` removed, width/height integer) | photoDesk doesn't read the removed fields |

## Upgrade procedure (when ready)

1. Land fix #2 (`visibility: 'timeline'`) — safe on v2 today.
2. Land fix #1 (upload fields), gated on server version if v2 support matters.
3. Stand up a v3 test instance; run a full session against it: scan → review →
   edit → commit with all four options checked. Watch the edits step (#1, #3).
4. `npm test` (integration tests mock the v2 contract — update fixtures that
   assert `deviceAssetId` on upload).
5. Only then upgrade the production Immich.

## Related notes

- Immich star ratings are hidden behind a per-user preference
  (Account Settings → Rating), off by default. photoDesk-committed ratings
  surface in the detail panel and search filters once enabled.
- photoDesk "picks" intentionally do not map to any Immich concept (not
  favorites); rejects surface as Immich trash after commit.
