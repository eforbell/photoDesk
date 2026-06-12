-- PhotoDesk current schema snapshot.
-- Source of truth for changes is db/migrations/*.sql; update this snapshot after
-- every migration so the complete present-day shape remains easy to inspect.

CREATE TABLE schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  committed_at TEXT,
  profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profiles(id)
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
  asset_id TEXT NOT NULL,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) DEFAULT 1,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  committed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(profile_id, asset_id)
);

CREATE TABLE density_cache (
  profile_id INTEGER NOT NULL UNIQUE REFERENCES profiles(id),
  computed_at TEXT NOT NULL,
  data TEXT NOT NULL
);

CREATE TABLE edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  adjustments TEXT NOT NULL DEFAULT '{}',
  crop TEXT NOT NULL DEFAULT '{}',
  rendered_path TEXT,
  render_status TEXT NOT NULL DEFAULT 'pending'
    CHECK(render_status IN ('pending', 'rendering', 'ready', 'failed', 'uploaded')),
  render_error TEXT,
  immich_asset_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, asset_id)
);

CREATE TABLE commit_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL
    CHECK(action_type IN ('trash', 'rating', 'stack')),
  action_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, action_type, action_key)
);

-- Edited uploads use edits.render_status + edits.immich_asset_id as their
-- durable checkpoint because upload and stack association have a two-stage
-- retry boundary. commit_actions covers the single-stage remote operations.
CREATE TABLE commit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK(status IN ('running', 'succeeded', 'failed', 'interrupted')),
  options TEXT NOT NULL,
  result TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_scenes_session ON scenes(session_id, scene_index);
CREATE INDEX idx_decisions_session ON decisions(session_id);
CREATE INDEX idx_ratings_session ON ratings(session_id);
CREATE INDEX idx_stack_groups_session ON stack_groups(session_id);
CREATE INDEX idx_processed_assets_session ON processed_assets(session_id);
CREATE INDEX idx_edits_session ON edits(session_id);
CREATE INDEX idx_edits_status ON edits(render_status);
CREATE INDEX idx_commit_actions_session ON commit_actions(session_id, status);
CREATE INDEX idx_commit_runs_session ON commit_runs(session_id, started_at);
CREATE INDEX idx_auth_sessions_token ON auth_sessions(token);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_processed_assets_profile ON processed_assets(profile_id);
