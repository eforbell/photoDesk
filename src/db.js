const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'photodesk.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      total_assets INTEGER NOT NULL DEFAULT 0,
      total_scenes INTEGER NOT NULL DEFAULT 0,
      immich_url TEXT NOT NULL DEFAULT '',
      date_from TEXT,
      date_to TEXT,
      scene_threshold INTEGER NOT NULL DEFAULT 30
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      scene_index INTEGER NOT NULL,
      asset_ids TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('pick', 'reject')),
      decided_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      asset_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      rated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS stack_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      asset_ids TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

module.exports = { getDb };
