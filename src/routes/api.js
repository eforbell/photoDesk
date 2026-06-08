const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { fetchAllAssets, getThumbnailBuffer, createStack, trashAssets, updateAssetRating } = require('../immich-client');
const { clusterByTime } = require('../clustering');
const config = require('../config');

// GET /api/sessions
router.get('/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
  res.json(sessions);
});

// POST /api/sessions
router.post('/sessions', async (req, res) => {
  try {
    const { name, dateFrom, dateTo, sceneThreshold = 30 } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Fetch all assets from Immich
    const assets = await fetchAllAssets({ dateFrom, dateTo });

    if (assets.length === 0) {
      return res.status(400).json({ error: 'No assets found for the given date range' });
    }

    // Cluster into scenes
    const sceneClusters = clusterByTime(assets, Number(sceneThreshold));

    const db = getDb();

    const insertSession = db.prepare(`
      INSERT INTO sessions (name, total_assets, total_scenes, immich_url, date_from, date_to, scene_threshold)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertScene = db.prepare(`
      INSERT INTO scenes (session_id, scene_index, asset_ids)
      VALUES (?, ?, ?)
    `);

    const createSessionTx = db.transaction(() => {
      const result = insertSession.run(
        name,
        assets.length,
        sceneClusters.length,
        config.immichUrl,
        dateFrom || null,
        dateTo || null,
        Number(sceneThreshold)
      );
      const sessionId = result.lastInsertRowid;

      for (let i = 0; i < sceneClusters.length; i++) {
        const scene = sceneClusters[i];
        insertScene.run(sessionId, i, JSON.stringify(scene.map(a => a.id)));
      }

      return sessionId;
    });

    const sessionId = createSessionTx();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);

    res.status(201).json(session);
  } catch (err) {
    console.error('[POST /sessions]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id
router.get('/sessions/:id', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index').all(req.params.id);
  const decisions = db.prepare('SELECT * FROM decisions WHERE session_id = ?').all(req.params.id);
  const ratings = db.prepare('SELECT * FROM ratings WHERE session_id = ?').all(req.params.id);
  const stackGroups = db.prepare('SELECT * FROM stack_groups WHERE session_id = ?').all(req.params.id);

  res.json({
    ...session,
    scenes: scenes.map(s => ({ ...s, asset_ids: JSON.parse(s.asset_ids) })),
    decisions,
    ratings,
    stackGroups: stackGroups.map(sg => ({ ...sg, asset_ids: JSON.parse(sg.asset_ids) })),
  });
});

// GET /api/sessions/:id/scenes
router.get('/sessions/:id/scenes', (req, res) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const scenes = db.prepare('SELECT * FROM scenes WHERE session_id = ? ORDER BY scene_index').all(req.params.id);
  const decisions = db.prepare('SELECT * FROM decisions WHERE session_id = ?').all(req.params.id);
  const ratingsRows = db.prepare('SELECT * FROM ratings WHERE session_id = ?').all(req.params.id);
  const stackGroupRows = db.prepare('SELECT * FROM stack_groups WHERE session_id = ?').all(req.params.id);

  const decisionMap = {};
  for (const d of decisions) {
    decisionMap[d.asset_id] = d.decision;
  }

  const ratingMap = {};
  for (const r of ratingsRows) {
    ratingMap[r.asset_id] = r.rating;
  }

  const stackGroups = stackGroupRows.map(sg => ({
    id: sg.id,
    asset_ids: JSON.parse(sg.asset_ids),
    created_at: sg.created_at,
  }));

  // Build a map of assetId -> stackGroupId for quick lookup
  const stackGroupMap = {};
  for (const sg of stackGroups) {
    for (const assetId of sg.asset_ids) {
      stackGroupMap[assetId] = sg.id;
    }
  }

  res.json({
    scenes: scenes.map(s => {
      const assetIds = JSON.parse(s.asset_ids);
      return {
        ...s,
        asset_ids: assetIds,
        decisions: assetIds.reduce((acc, id) => {
          acc[id] = decisionMap[id] || null;
          return acc;
        }, {}),
      };
    }),
    decisionMap,
    ratingMap,
    stackGroups,
    stackGroupMap,
  });
});

// POST /api/decisions
router.post('/decisions', (req, res) => {
  const { sessionId, assetId, decision } = req.body;

  if (!sessionId || !assetId || !decision) {
    return res.status(400).json({ error: 'sessionId, assetId, and decision are required' });
  }

  if (!['pick', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be pick or reject' });
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO decisions (session_id, asset_id, decision)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, asset_id) DO UPDATE SET decision = excluded.decision, decided_at = datetime('now')
  `);

  upsert.run(sessionId, assetId, decision);
  res.json({ ok: true });
});

// DELETE /api/decisions
router.delete('/decisions', (req, res) => {
  const { sessionId, assetId } = req.body;

  if (!sessionId || !assetId) {
    return res.status(400).json({ error: 'sessionId and assetId are required' });
  }

  const db = getDb();
  db.prepare('DELETE FROM decisions WHERE session_id = ? AND asset_id = ?').run(sessionId, assetId);
  res.json({ ok: true });
});

// POST /api/ratings
router.post('/ratings', (req, res) => {
  const { sessionId, assetId, rating } = req.body;

  if (!sessionId || !assetId || rating === undefined) {
    return res.status(400).json({ error: 'sessionId, assetId, and rating are required' });
  }

  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO ratings (session_id, asset_id, rating)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, asset_id) DO UPDATE SET rating = excluded.rating, rated_at = datetime('now')
  `);

  upsert.run(sessionId, assetId, r);
  res.json({ ok: true });
});

// DELETE /api/ratings
router.delete('/ratings', (req, res) => {
  const { sessionId, assetId } = req.body;

  if (!sessionId || !assetId) {
    return res.status(400).json({ error: 'sessionId and assetId are required' });
  }

  const db = getDb();
  db.prepare('DELETE FROM ratings WHERE session_id = ? AND asset_id = ?').run(sessionId, assetId);
  res.json({ ok: true });
});

// POST /api/stack-groups
router.post('/stack-groups', (req, res) => {
  const { sessionId, assetIds } = req.body;

  if (!sessionId || !assetIds || !Array.isArray(assetIds) || assetIds.length < 2) {
    return res.status(400).json({ error: 'sessionId and assetIds (array of at least 2) are required' });
  }

  const db = getDb();

  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const result = db.prepare(`
    INSERT INTO stack_groups (session_id, asset_ids) VALUES (?, ?)
  `).run(sessionId, JSON.stringify(assetIds));

  const group = db.prepare('SELECT * FROM stack_groups WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...group, asset_ids: JSON.parse(group.asset_ids) });
});

// DELETE /api/stack-groups/:id
router.delete('/stack-groups/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM stack_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/sessions/:id/commit
router.post('/sessions/:id/commit', async (req, res) => {
  const db = getDb();
  const sessionId = req.params.id;

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { trashRejects = true, writeRatings = true, createStacks = true } = req.body || {};

  const decisions = db.prepare('SELECT * FROM decisions WHERE session_id = ?').all(sessionId);
  const ratingsRows = db.prepare('SELECT * FROM ratings WHERE session_id = ?').all(sessionId);
  const stackGroupRows = db.prepare('SELECT * FROM stack_groups WHERE session_id = ?').all(sessionId);

  const results = {
    assetsTrashed: 0,
    ratingsWritten: 0,
    stacksCreated: 0,
    errors: [],
  };

  // 1. Trash rejects
  if (trashRejects) {
    const rejectIds = decisions.filter(d => d.decision === 'reject').map(d => d.asset_id);
    if (rejectIds.length > 0) {
      try {
        await trashAssets(rejectIds);
        results.assetsTrashed = rejectIds.length;
      } catch (err) {
        results.errors.push(`Trash failed: ${err.message}`);
      }
    }
  }

  // 2. Write ratings
  if (writeRatings) {
    for (const row of ratingsRows) {
      try {
        await updateAssetRating(row.asset_id, row.rating);
        results.ratingsWritten++;
      } catch (err) {
        results.errors.push(`Rating update failed for ${row.asset_id}: ${err.message}`);
      }
    }
  }

  // 3. Create stacks
  if (createStacks) {
    for (const sg of stackGroupRows) {
      const assetIds = JSON.parse(sg.asset_ids);
      try {
        await createStack(assetIds);
        results.stacksCreated++;
      } catch (err) {
        results.errors.push(`Stack creation failed: ${err.message}`);
      }
    }
  }

  res.json(results);
});

// GET /api/proxy/thumbnail/:assetId
router.get('/proxy/thumbnail/:assetId', async (req, res) => {
  try {
    const { buffer, contentType } = await getThumbnailBuffer(req.params.assetId);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('[thumbnail proxy]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
