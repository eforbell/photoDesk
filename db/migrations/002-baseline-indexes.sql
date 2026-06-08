-- Ensure legacy databases that adopt 001 also receive the current indexes.

CREATE INDEX IF NOT EXISTS idx_scenes_session ON scenes(session_id, scene_index);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_ratings_session ON ratings(session_id);
CREATE INDEX IF NOT EXISTS idx_stack_groups_session ON stack_groups(session_id);
CREATE INDEX IF NOT EXISTS idx_processed_assets_session ON processed_assets(session_id);
