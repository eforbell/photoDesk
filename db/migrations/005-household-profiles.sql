-- Migration 005: Household Profiles (Feature #5)
-- Adds multi-profile support so each household member gets their own
-- review queue, Immich connection, and session history.

-- 1. Create profiles table
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('parent', 'kid')) DEFAULT 'kid',
  passphrase_hash TEXT,
  immich_url TEXT NOT NULL DEFAULT '',
  immich_api_key TEXT,
  immich_user_id TEXT,
  immich_verified_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'disabled', 'setup')) DEFAULT 'setup',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Bootstrap admin profile (must exist before any FK references with DEFAULT 1)
INSERT INTO profiles (id, display_name, role, status)
  VALUES (1, 'Admin', 'parent', 'active');

-- 3. Create auth_sessions table (named to avoid collision with review sessions)
CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_sessions_token ON auth_sessions(token);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);

-- 4. Rebuild sessions to add profile_id (ALTER TABLE cannot add REFERENCES with non-NULL default)
CREATE TABLE sessions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  total_assets INTEGER NOT NULL DEFAULT 0,
  total_scenes INTEGER NOT NULL DEFAULT 0,
  immich_url TEXT NOT NULL DEFAULT '',
  date_from TEXT,
  date_to TEXT,
  scene_threshold INTEGER NOT NULL DEFAULT 30,
  committed INTEGER NOT NULL DEFAULT 0,
  committed_at TEXT,
  profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id)
);
INSERT INTO sessions_new (id, name, created_at, total_assets, total_scenes, immich_url, date_from, date_to, scene_threshold, committed, committed_at, profile_id)
  SELECT id, name, created_at, total_assets, total_scenes, immich_url, date_from, date_to, scene_threshold, committed, committed_at, 1
  FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

-- 5. Rebuild processed_assets: change from asset_id PRIMARY KEY to UNIQUE(profile_id, asset_id)
CREATE TABLE processed_assets_new (
  asset_id TEXT NOT NULL,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) DEFAULT 1,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  committed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, asset_id)
);
INSERT INTO processed_assets_new (asset_id, profile_id, session_id, committed_at)
  SELECT asset_id, 1, session_id, committed_at FROM processed_assets;
DROP TABLE processed_assets;
ALTER TABLE processed_assets_new RENAME TO processed_assets;
CREATE INDEX idx_processed_assets_session ON processed_assets(session_id);
CREATE INDEX idx_processed_assets_profile ON processed_assets(profile_id);

-- 6. Rebuild density_cache: change from singleton CHECK(id=1) to per-profile
CREATE TABLE density_cache_new (
  profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id),
  computed_at TEXT NOT NULL,
  data TEXT NOT NULL
);
INSERT INTO density_cache_new (profile_id, computed_at, data)
  SELECT 1, computed_at, data FROM density_cache WHERE id = 1;
DROP TABLE density_cache;
ALTER TABLE density_cache_new RENAME TO density_cache;
