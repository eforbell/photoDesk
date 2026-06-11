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

CREATE TABLE commit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  dry_run INTEGER NOT NULL DEFAULT 0 CHECK(dry_run IN (0, 1)),
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
  options TEXT NOT NULL,
  result TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX idx_commit_actions_session ON commit_actions(session_id, status);
CREATE INDEX idx_commit_runs_session ON commit_runs(session_id, started_at);
