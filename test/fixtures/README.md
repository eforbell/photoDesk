# HEIC fixtures

- `heic-probe.heic` is a small synthetic HEVC fixture used for fast startup and
  deployment capability checks.
- `heic-probe-rotated.heic` is a synthetic orientation regression fixture.
- `test.heic` is a real tiled iPhone HEIC contributed for repository use. Its
  location data was removed before commit. Local inspection shows no GPS or
  location fields, dimensions 3052x2720, top-left orientation, and an embedded
  ICC profile.

The real fixture is intentionally not used for the startup probe because it is
about 1.1 MB and decodes to a roughly 24 MB TIFF. It is used by integration
tests to cover modern tiled HEIC files whose item-reference count exceeds
libheif's default security limit.
