#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const BASELINE_MIGRATION = '001-current-schema.sql';

const BASELINE_SHAPE = {
  sessions: [
    'id', 'name', 'created_at', 'total_assets', 'total_scenes', 'immich_url',
    'date_from', 'date_to', 'scene_threshold', 'committed', 'committed_at',
  ],
  scenes: ['id', 'session_id', 'scene_index', 'asset_ids'],
  decisions: ['id', 'session_id', 'asset_id', 'decision', 'decided_at'],
  ratings: ['id', 'session_id', 'asset_id', 'rating', 'rated_at'],
  stack_groups: ['id', 'session_id', 'asset_ids', 'created_at'],
  processed_assets: ['asset_id', 'session_id', 'committed_at'],
  density_cache: ['id', 'computed_at', 'data'],
};

function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort();
}

function userTables(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name != 'schema_migrations'
    ORDER BY name
  `).all().map(row => row.name);
}

function assertBaselineShape(db) {
  const existingTables = new Set(userTables(db));
  const expectedTables = new Set(Object.keys(BASELINE_SHAPE));
  for (const table of existingTables) {
    if (!expectedTables.has(table)) {
      throw new Error(`Cannot adopt baseline: unknown table "${table}"`);
    }
  }
  for (const [table, requiredColumns] of Object.entries(BASELINE_SHAPE)) {
    if (!existingTables.has(table)) {
      throw new Error(`Cannot adopt baseline: missing table "${table}"`);
    }
    const columns = new Set(
      db.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name)
    );
    for (const column of requiredColumns) {
      if (!columns.has(column)) {
        throw new Error(`Cannot adopt baseline: missing column "${table}.${column}"`);
      }
    }
  }
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function adoptLegacyBaselineIfNeeded(db, files) {
  const appliedCount = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  if (appliedCount > 0 || userTables(db).length === 0) return false;
  if (!files.includes(BASELINE_MIGRATION)) {
    throw new Error(`Baseline migration ${BASELINE_MIGRATION} is missing`);
  }

  assertBaselineShape(db);
  db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(BASELINE_MIGRATION);
  return true;
}

function migrateDatabase(db, { logger = console } = {}) {
  db.pragma('foreign_keys = ON');
  ensureMigrationTable(db);

  const files = listMigrations();
  const adopted = adoptLegacyBaselineIfNeeded(db, files);
  if (adopted) logger.log(`  adopt: ${BASELINE_MIGRATION} (existing schema baseline)`);

  const applied = new Set(
    db.prepare('SELECT filename FROM schema_migrations ORDER BY filename')
      .all()
      .map(row => row.filename)
  );
  const insertApplied = db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
  let count = 0;

  for (const file of files) {
    if (applied.has(file)) {
      logger.log(`  skip: ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.log(`  apply: ${file}`);
    // Table rebuilds (DROP+RENAME) require FK checks off; can't toggle inside a txn
    db.pragma('foreign_keys = OFF');
    const apply = db.transaction(() => {
      db.exec(sql);
      insertApplied.run(file);
    });
    try {
      apply();
      count++;
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      db.pragma('foreign_keys = ON');
    }
    const fkErrors = db.pragma('foreign_key_check');
    if (fkErrors.length > 0) {
      throw new Error(`Migration ${file} left FK violations: ${JSON.stringify(fkErrors)}`);
    }
  }

  logger.log(count === 0 ? 'All migrations already applied.' : `Applied ${count} migration(s).`);
  return { applied: count, adopted };
}

function migrateFile(dbPath) {
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    return migrateDatabase(db);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const dbPath = process.env.PHOTODESK_DB_PATH
    ? path.resolve(process.env.PHOTODESK_DB_PATH)
    : path.join(__dirname, '..', 'photodesk.db');
  try {
    migrateFile(dbPath);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  BASELINE_MIGRATION,
  BASELINE_SHAPE,
  assertBaselineShape,
  migrateDatabase,
  migrateFile,
};
