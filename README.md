# PhotoDesk

PhotoDesk is a self-hosted photo review and light-editing companion for
[Immich](https://immich.app).

It fills the gap between **photos arriving automatically from a phone** and
**an intentionally reviewed library**. Immich remains the source of truth for
storage, synchronization, and browsing. PhotoDesk provides a focused workspace
for discovering unreviewed photos, making decisions locally, and applying them
to Immich only after an explicit Commit.

## Product intent

PhotoDesk is designed around a careful, non-destructive workflow:

1. **Discover** — see unreviewed batches, browse the complete library calendar,
   and start a session from a date or range.
2. **Review** — quickly keep or reject frames grouped into time-based scenes.
3. **Rate** — assign zero to five stars without leaving the review flow.
4. **Stack** — manually group true variants; scene clustering never makes this
   decision automatically.
5. **Edit** — apply presets, core adjustments, and normalized crops while
   preserving the original.
6. **Commit** — explicitly choose what PhotoDesk should send to Immich:
   recoverably trash rejects, write ratings, create stacks, and upload edited
   JPEG versions stacked with their originals.

Until Commit, review state lives only in PhotoDesk's local SQLite database.
Committed sessions are treated as processed so their source photos and
PhotoDesk-generated edited versions do not reappear in discovery.

## Principles

- **Immich is the source of truth.** PhotoDesk complements it rather than
  replacing its storage or browsing experience.
- **Nothing is written silently.** Immich mutations happen only through the
  Commit screen.
- **Edits are non-destructive.** Originals are never modified; rendered edits
  are uploaded as new stacked assets.
- **Rejects remain recoverable.** Rejected photos go to Immich trash, not
  permanent deletion.
- **The user decides semantic groupings.** Time clustering aids navigation;
  only the user creates stacks.
- **Fast on desktop, usable on touch devices.** The full workflow is
  desktop-first, keyboard-friendly, and retains reachable primary actions on
  narrow screens.
- **Dark, photo-first presentation.** Neutral chrome, disciplined semantic
  colors, and restrained typography keep attention on the images.

## Current capabilities

- Immich connection through a server-side API key
- Complete-library discovery and year navigation
- Suggested unreviewed sessions and selectable calendar ranges
- Configurable time-based scene clustering
- Review decisions, ratings, filters, keyboard navigation, and an immersive
  lightbox
- Manual stack creation
- Presets, eight adjustment controls, common crop ratios, and durable local
  JPEG rendering with Sharp
- Retry-safe edited asset upload and Immich stack association
- SQLite migrations, schema snapshot, git-based deployment script, and systemd
  service template
- Responsive workspace, editor, and Commit controls

## Architecture

- **Backend:** Node.js, Express, CommonJS
- **Frontend:** vanilla HTML, CSS, and JavaScript with no build step
- **Database:** SQLite through `better-sqlite3`
- **Image rendering:** Sharp/libvips
- **Integration:** Immich REST API, proxied server-side so the API key is never
  exposed to the browser

Important paths:

```text
src/                 application, library, rendering, and Immich integration
src/routes/api.js    HTTP API and commit workflow
public/              browser application
db/migrations/       ordered SQLite migrations
db/schema.sql        current complete schema snapshot
design/              high-fidelity product and visual handoff
planning/            feature history, decisions, backlog, and deployment notes
deploy/              git deployment script and systemd template
```

## Local setup

Requirements:

- Node.js 18 or newer
- A reachable Immich server
- An Immich API key with the permissions needed by the actions you intend to
  commit

```bash
git clone git@github.com:eforbell/photoDesk.git
cd photoDesk
npm install
cp .env.example .env
```

Configure `.env`:

```dotenv
IMMICH_URL=http://localhost:2283
IMMICH_API_KEY=your-api-key-here
PORT=3400
TZ=America/New_York
PHOTODESK_EDIT_DIR=/durable/path/to/photodesk-edits
PHOTODESK_HEIC_DECODE=off
# PHOTODESK_HEIC_DECODER_CMD=/usr/bin/vips
```

Then run:

```bash
npm run migrate
npm start
```

Open `http://localhost:3400`.

For development with automatic server restarts:

```bash
npm run dev
```

## Validation

```bash
npm test
npm run migrate
PHOTODESK_HEIC_DECODE=off npm run check:heic
```

The test suite covers migrations, discovery semantics, editor validation,
durable rendering, request serialization, retry safety, stack integration, and
processed-state reconciliation.

## Deployment

PhotoDesk includes a git-based deployment helper and a starter systemd unit:

```bash
APP_DIR=/data/apps/photoDesk \
SERVICE_NAME=photodesk \
./deploy/deploy.sh origin/main
```

Keep the SQLite database and `PHOTODESK_EDIT_DIR` on durable storage outside any
checkout path that deployment may replace. See
[`planning/database-and-deployment.md`](planning/database-and-deployment.md)
for the migration and deployment policy.

## HEIC editing

HEIC decoding is an explicit operator choice and defaults to off:

```dotenv
PHOTODESK_HEIC_DECODE=off
```

HomeServer's supported first mode uses its standalone vips 8.15.1 CLI, which has
already decoded a real iPhone HEIC:

```dotenv
PHOTODESK_HEIC_DECODE=external
# Optional when vips is already on PATH:
PHOTODESK_HEIC_DECODER_CMD=/usr/bin/vips
```

Validate the exact configured mode before restarting PhotoDesk:

```bash
npm run check:heic
```

The check decodes `test/fixtures/heic-probe.heic` through the same path used by
the editor. Mode `off` skips probing. An enabled but unavailable decoder is
reported without preventing normal non-HEIC editing at runtime; the deployment
script treats the same result as a failed preflight and does not restart the
service.

External mode decodes into a private temporary TIFF, then reuses the existing
Sharp crop/adjustment/JPEG pipeline. Originals remain untouched and failed
re-renders preserve the previous ready derivative. The decoder uses
`vips heifload --unlimited` because modern tiled iPhone files can exceed
libheif's default item-reference limit; this override is restricted to
authenticated Immich originals, not arbitrary public uploads. PhotoDesk
serializes HEIC decodes, limits source files to 50 MiB and decoded TIFFs to
256 MiB, constrains vips to one worker, and aborts the subprocess when the
client disconnects.

## Design and planning

The visual and interaction source of truth is
[`design/design_handoff_photodesk/README.md`](design/design_handoff_photodesk/README.md).
Development history, feature PRDs, and durable decisions are under
[`planning/`](planning/).
