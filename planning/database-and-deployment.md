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
4. stop the running service
5. back up the SQLite database
6. run `npm run migrate`
7. restart the systemd service

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
under that path. The installed `sharp` build reports codec support at
`GET /api/edits/capabilities`; check that endpoint on the deployment host before
depending on HEIC input.
