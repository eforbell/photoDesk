# PhotoDesk Backlog

## Household access

### Household profiles and scoped Immich credentials

**Priority:** P1
**Status:** Discovery / unscheduled
**Feature concept:** [`features/feature-5-household-profiles.json`](features/feature-5-household-profiles.json)

Allow each family member to sign in to PhotoDesk, connect their own
user-scoped Immich API key, and maintain private review sessions and reviewed
state even when the household shares photos through Immich partner timelines.

The first release should be deliberately narrow: one PhotoDesk profile maps to
one Immich user, credentials remain server-side, and write operations are
limited to assets the active Immich user can safely modify. Shared partner
assets may appear in discovery, but visibility must not be treated as write
authorization.

Key decisions still to make:

- Reuse the household member/passphrase pattern from FamilyPulse and HomeSource,
  or place PhotoDesk behind a shared OIDC/reverse-proxy identity provider.
- Whether partner assets are included by default, opt-in per profile, or
  deferred until after owned-library multi-user support ships.
- Whether any future household-level review state should supplement—not
  replace—the default private per-person review state.

Acceptance criteria and a staged delivery plan are captured in the linked
feature concept. This is intentionally not designated as the next feature.

## Image compatibility

### Full iPhone HEIC editing support

**Priority:** P1  
**Status:** Backlog

PhotoDesk currently detects HEIC render failures and preserves the original or
last successful edit, but the packaged Sharp/libvips build on the development
host cannot decode every iPhone HEIC compression variant.

Acceptance criteria:

- Document and provide a repeatable Linux installation/build path for Sharp,
  libvips, libheif, and the required HEVC decoder.
- Validate decoding and rendering with representative iPhone HEIC fixtures,
  including the compression variant that currently reports `11.6003`.
- Add a startup or deployment check that distinguishes advertised HEIF support
  from successful decoding of a real HEIC fixture.
- Preserve EXIF orientation and capture metadata in rendered JPEG derivatives.
- Keep the current safe behavior when support is unavailable: originals remain
  untouched, previous successful edits remain usable, and the UI shows an
  actionable compatibility error.
- Document the supported setup for the Debian/Mint production host.

### Bounded-memory source rendering

**Priority:** P2
**Status:** Backlog

The current renderer downloads an Immich original into a Node.js buffer before
passing it to Sharp. Replace this with a bounded-memory stream or temporary-file
pipeline before PhotoDesk expands into large RAW workflows.

Acceptance criteria:

- Source download does not require holding the complete original and rendered
  derivative in memory simultaneously.
- Abort and network failures remove incomplete temporary files.
- Existing per-asset serialization, atomic final writes, and previous-ready
  preservation remain intact.
- Add a large generated fixture or constrained-memory integration test.
