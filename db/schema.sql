-- PhotoDesk current schema snapshot.
-- Source of truth for changes is db/migrations/*.sql; update this snapshot after
-- every migration so the complete present-day shape remains easy to inspect.

CREATE TABLE schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
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
  committed_at TEXT
);

CREATE TABLE scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  scene_index INTEGER NOT NULL,
  asset_ids TEXT NOT NULL
);

CREATE TABLE decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('pick', 'reject')),
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, asset_id)
);

CREATE TABLE ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  rated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, asset_id)
);

CREATE TABLE stack_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  asset_ids TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE processed_assets (
  asset_id TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  committed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE density_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  computed_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE INDEX idx_scenes_session ON scenes(session_id, scene_index);
CREATE INDEX idx_decisions_session ON decisions(session_id);
CREATE INDEX idx_ratings_session ON ratings(session_id);
CREATE INDEX idx_stack_groups_session ON stack_groups(session_id);
CREATE INDEX idx_processed_assets_session ON processed_assets(session_id);
