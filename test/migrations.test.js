const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  BASELINE_MIGRATION,
  BASELINE_SHAPE,
  migrateDatabase,
} = require('../db/migrate');

function silentLogger() {
  return { log() {} };
}

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-migrate-'));
  return {
    dir,
    path: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('fresh database applies the current schema baseline', () => {
  const temp = tempDatabase();
  const db = new Database(temp.path);
  try {
    const result = migrateDatabase(db, { logger: silentLogger() });
    assert.equal(result.applied, 4);
    assert.equal(result.adopted, false);

    const tables = new Set(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map(row => row.name)
    );
    for (const table of Object.keys(BASELINE_SHAPE)) assert.ok(tables.has(table));
    assert.ok(tables.has('schema_migrations'));
    assert.ok(tables.has('edits'));
    assert.ok(tables.has('commit_actions'));
    assert.ok(tables.has('commit_runs'));
    assert.deepEqual(
      db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all(),
      [
        { filename: BASELINE_MIGRATION },
        { filename: '002-baseline-indexes.sql' },
        { filename: '003-editor-state.sql' },
        { filename: '004-commit-history.sql' },
      ]
    );
  } finally {
    db.close();
    temp.cleanup();
  }
});

test('migration runner is idempotent', () => {
  const temp = tempDatabase();
  const db = new Database(temp.path);
  try {
    migrateDatabase(db, { logger: silentLogger() });
    const second = migrateDatabase(db, { logger: silentLogger() });
    assert.equal(second.applied, 0);
    assert.equal(second.adopted, false);
  } finally {
    db.close();
    temp.cleanup();
  }
});

test('existing matching database adopts the baseline without losing data', () => {
  const temp = tempDatabase();
  const db = new Database(temp.path);
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', BASELINE_MIGRATION),
      'utf8'
    );
    db.exec(sql);
    db.exec(`
      DROP INDEX idx_scenes_session;
      DROP INDEX idx_decisions_session;
      DROP INDEX idx_ratings_session;
      DROP INDEX idx_stack_groups_session;
      DROP INDEX idx_processed_assets_session;
    `);
    db.prepare(`INSERT INTO sessions (name) VALUES (?)`).run('Keep me');

    const result = migrateDatabase(db, { logger: silentLogger() });
    assert.equal(result.applied, 3);
    assert.equal(result.adopted, true);
    assert.equal(db.prepare('SELECT name FROM sessions').get().name, 'Keep me');
    assert.deepEqual(
      db.prepare('SELECT filename FROM schema_migrations ORDER BY filename').all(),
      [
        { filename: BASELINE_MIGRATION },
        { filename: '002-baseline-indexes.sql' },
        { filename: '003-editor-state.sql' },
        { filename: '004-commit-history.sql' },
      ]
    );
    const indexes = new Set(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all()
        .map(row => row.name)
    );
    assert.ok(indexes.has('idx_scenes_session'));
  } finally {
    db.close();
    temp.cleanup();
  }
});

test('legacy adoption refuses a partial schema', () => {
  const temp = tempDatabase();
  const db = new Database(temp.path);
  try {
    db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    assert.throws(
      () => migrateDatabase(db, { logger: silentLogger() }),
      /Cannot adopt baseline/
    );
  } finally {
    db.close();
    temp.cleanup();
  }
});

test('legacy adoption refuses unknown user tables', () => {
  const temp = tempDatabase();
  const db = new Database(temp.path);
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'migrations', BASELINE_MIGRATION),
      'utf8'
    );
    db.exec(sql);
    db.exec('CREATE TABLE stray_table (id INTEGER PRIMARY KEY)');
    assert.throws(
      () => migrateDatabase(db, { logger: silentLogger() }),
      /unknown table/
    );
  } finally {
    db.close();
    temp.cleanup();
  }
});
