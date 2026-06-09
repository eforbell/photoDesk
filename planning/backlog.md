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

