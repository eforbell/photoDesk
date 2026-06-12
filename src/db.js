const Database = require('better-sqlite3');
const path = require('path');
const { migrateDatabase } = require('../db/migrate');

const DB_PATH = process.env.PHOTODESK_DB_PATH
  ? path.resolve(process.env.PHOTODESK_DB_PATH)
  : path.join(__dirname, '..', 'photodesk.db');

let db;

function bootstrapProfileCredential(database) {
  const apiKey = String(process.env.IMMICH_API_KEY || '').trim();
  if (!apiKey) return 0;
  const immichUrl = String(process.env.IMMICH_URL || '').trim();
  return database.prepare(`
    UPDATE profiles
    SET immich_api_key = ?,
        immich_url = CASE WHEN immich_url = '' THEN ? ELSE immich_url END
    WHERE id = 1
      AND passphrase_hash IS NULL
      AND immich_api_key IS NULL
  `).run(apiKey, immichUrl).changes;
}

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db, { logger: { log() {} } });
    bootstrapProfileCredential(db);
  }
  return db;
}

module.exports = { bootstrapProfileCredential, getDb };
