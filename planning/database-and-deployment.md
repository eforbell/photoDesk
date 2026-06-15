# Database and Deployment Notes

## SQLite migration policy

PhotoDesk now uses explicit SQLite migrations under `db/migrations/`.

- `db/migrations/001-current-schema.sql` is the Feature 2 baseline.
- `db/migrations/002-baseline-indexes.sql` converges legacy baseline adoption onto the current indexes.
- `db/schema.sql` is a readable snapshot of the current complete schema.
- `npm run migrate` applies pending migrations and records them in `schema_migrations`.
- `src/db.js` runs migrations at startup so local dev and deployed services converge before queries execute.

Rules for future features:

1. Never add schema by inline `CREATE TABLE` / `ALTER TABLE` in app startup code.
2. Add the next numbered SQL migration, e.g. `003-editor-state.sql`.
3. Update `db/schema.sql` in the same change.
4. Add/extend migration tests for:
   - fresh database creation
   - idempotent rerun
   - existing database upgrade/adoption path when relevant
5. Run `npm test` and `npm run migrate` before committing.

Existing pre-migration dev databases are accepted only if they match the Feature 2 baseline tables/columns. Partial or unknown schemas fail loudly instead of being guessed.

## Deployment shape

`deploy/deploy.sh` follows the homeApps git-deploy pattern:

1. fetch the requested ref from git
2. update the deploy work tree
3. install production dependencies with `npm ci --omit=dev`
4. validate the configured HEIC mode with `npm run check:heic`
5. stop the running service
6. back up the SQLite database
7. run `npm run migrate`
8. restart the systemd service

Default production path and service name:

```bash
APP_DIR=/data/apps/photoDesk
SERVICE_NAME=photodesk
```

Override either when needed:

```bash
APP_DIR=/opt/sovereign-home/apps/photoDesk SERVICE_NAME=photodesk ./deploy/deploy.sh origin/main
```

Database backups default to a `backups/` directory beside the configured
`PHOTODESK_DB_PATH`. Override the destination with `PHOTODESK_BACKUP_DIR`.
If migration fails, the backup is retained and the previously running service
remains stopped rather than starting against an uncertain schema.

A starter unit lives at `deploy/photodesk.service`. Edit `User=`, paths, and `.env` location before installing it to `/etc/systemd/system/photodesk.service`.

Edited JPEG derivatives default to `var/edits/` for local development. Production
should point `PHOTODESK_EDIT_DIR` at a durable location that is not replaced by a
git checkout, for example:

```bash
PHOTODESK_EDIT_DIR=/data/apps/photoDesk-data/edits
```

The service user must be able to create directories and atomically replace files
under that path.

## HEIC decode modes

HomeServer is the authoritative production target:

- Linux Mint 22.1 (`xia`)
- system vips 8.15.1
- PhotoDesk and Immich run on the same host
- `vips copy IMG_0001.heic IMG_0001.tif` successfully decoded a real iPhone
  HEVC-coded HEIC without adding packages

HEIC decoding defaults to disabled:

```dotenv
PHOTODESK_HEIC_DECODE=off
```

The supported first production mode is the standalone system vips:

```dotenv
PHOTODESK_HEIC_DECODE=external
PHOTODESK_HEIC_DECODER_CMD=/usr/bin/vips
```

The command variable must be an absolute executable path. It may be omitted when
`vips` is available on the service `PATH`.

Verify HomeServer before deployment:

```bash
vips --version
vips -l | grep heif
npm run check:heic
```

`npm run check:heic` decodes the committed synthetic HEVC fixture through the
same external adapter used at runtime. The real iPhone source remains a manual
production validation fixture rather than being copied from the private Immich
library into git.

At runtime, an unavailable enabled decoder is logged and exposed by
`GET /api/edits/capabilities`, but PhotoDesk continues serving non-HEIC edits.
During deployment, the preflight exits non-zero before the service is stopped.
Rollback is setting `PHOTODESK_HEIC_DECODE=off`.

The later in-process mode requires Sharp to link against a global libvips:

```dotenv
PHOTODESK_HEIC_DECODE=libvips
```

Sharp 0.34.5 requires libvips `>=8.17.3`; HomeServer's 8.15.1 is too old for that
mode, so it remains a later source-build option.
