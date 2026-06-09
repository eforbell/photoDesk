-- Persist non-destructive editor recipes before rendered/uploaded versions exist.

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

CREATE INDEX idx_edits_session ON edits(session_id);
CREATE INDEX idx_edits_status ON edits(render_status);
