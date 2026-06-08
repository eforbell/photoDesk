const Database = require('better-sqlite3');
const path = require('path');
const { migrateDatabase } = require('../db/migrate');

const DB_PATH = process.env.PHOTODESK_DB_PATH
  ? path.resolve(process.env.PHOTODESK_DB_PATH)
  : path.join(__dirname, '..', 'photodesk.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrateDatabase(db, { logger: { log() {} } });
  }
  return db;
}

module.exports = { getDb };
