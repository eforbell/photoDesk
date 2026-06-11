-- Preserve per-action commit outcomes so partial commits can be retried safely.

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

CREATE INDEX idx_commit_actions_session ON commit_actions(session_id, status);
CREATE INDEX idx_commit_runs_session ON commit_runs(session_id, started_at);
