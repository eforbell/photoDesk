# PhotoDesk Backlog

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
