# PhotoDesk external HEIC decoder image.
#
# Use Debian Trixie rather than Bullseye/Bookworm/Ubuntu Noble because the
# iOS 18-style "Too many auxiliary image references" HEIC failure requires a
# newer libheif line than Ubuntu 24.04 currently ships.
FROM debian:trixie-slim

ENV DEBIAN_FRONTEND=noninteractive \
    VIPS_CONCURRENCY=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      libvips-tools \
      libheif-examples \
      libheif-plugin-libde265 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /work
ENTRYPOINT ["/usr/bin/vips"]
CMD ["--version"]
