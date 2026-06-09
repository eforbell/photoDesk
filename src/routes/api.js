const express = require('express');
const fs = require('fs');
const router = express.Router();
const editLocks = new Map();
const { getDb } = require('../db');
const {
  fetchAllAssets,
  getThumbnailBuffer,
  getOriginalAssetBuffer,
  createStack,
  trashAssets,
  updateAssetRating,
  checkConnection,
} = require('../immich-client');
const { clusterByTime } = require('../clustering');
const {
  clusterSuggestions,
  getLibrarySnapshot,
  invalidateLibraryCache,
  rangeSummary,
} = require('../library');
const config = require('../config');
const {
  parseEditRow,
  validateAdjustments,
  validateCrop,
} = require('../editor');
const {
  safeEditPath,
  sharpCapabilities,
  writeRenderedEdit,
} = require('../edit-renderer');

function localDateBoundary(dateKey, endOfDay = false) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  return new Date(`${dateKey}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function sessionAssetIds(db, sessionId) {
  return db.prepare('SELECT asset_ids FROM scenes WHERE session_id = ? ORDER BY scene_index')
    .all(sessionId)
    .flatMap(row => {
      const values = JSON.parse(row.asset_ids);
      return values.map(asset => typeof asset === 'string' ? asset : asset.id);
    });
}

function sessionAssetMetadata(db, sessionId, assetId) {
  const rows = db.prepare(
    'SELECT asset_ids FROM scenes WHERE session_id = ? ORDER BY scene_index'
  ).all(sessionId);
  for (const row of rows) {
    const match = JSON.parse(row.asset_ids).find(asset => (
      typeof asset === 'string' ? asset === assetId : asset.id === assetId
    ));
    if (match) return typeof match === 'string' ? { id: match } : match;
  }
  return null;
}

function removeRenderedFile(relativePath) {
  if (!relativePath) return;
  fs.rmSync(safeEditPath(config.editDir, relativePath), { force: true });
}

async function withEditLock(sessionId, assetId, work) {
  const key = `${sessionId}:${assetId}`;
  const previous = editLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  editLocks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (editLocks.get(key) === current) editLocks.delete(key);
  }
}

// GET /api/sessions
router.get('/sessions', (req, res) => {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT sessions.*,
      COALESCE(SUM(CASE WHEN decisions.decision = 'pick' THEN 1 ELSE 0 END), 0) AS kept_count,
      COALESCE(SUM(CASE WHEN decisions.decision = 'reject' THEN 1 ELSE 0 END), 0) AS rejected_count
    FROM sessions
    LEFT JOIN decisions ON decisions.session_id = sessions.id
    GROUP BY sessions.id
    ORDER BY sessions.created_at DESC
  `).all();
  res.json(sessions);
});

// POST /api/sessions
router.post('/sessions', async (req, res) => {
  try {
    const { name, dateFrom, dateTo, sceneThreshold = 30, untriagedOnly = false } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Fetch all assets from Immich
    let assets = await fetchAllAssets({
      dateFrom: localDateBoundary(dateFrom),
      dateTo: localDateBoundary(dateTo, true),
    });
    if (untriagedOnly) {
      const db = getDb();
      const processed = new Set(
        db.prepare('SELECT asset_id FROM processed_assets').all().map(row => row.asset_id)
      );
      assets = assets.filter(asset => !processed.has(asset.id));
    }

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
        // Store full asset metadata for aspect ratios, filenames, timestamps
        const assetData = scene.map(a => ({
          id: a.id,
          width: a.exifInfo?.exifImageWidth || a.originalWidth || 0,
          height: a.exifInfo?.exifImageHeight || a.originalHeight || 0,
          originalFileName: a.originalFileName || '',
          fileCreatedAt: a.fileCreatedAt || '',
        }));
        insertScene.run(sessionId, i, JSON.stringify(assetData));
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

router.get('/health', async (req, res) => {
  const apiKeySet = Boolean(config.immichApiKey);
  if (!apiKeySet) {
    return res.json({ immich: 'disconnected', apiKeySet: false });
  }
  try {
    await checkConnection();
    res.json({ immich: 'connected', apiKeySet: true });
  } catch (err) {
    res.status(503).json({
      immich: 'disconnected',
      apiKeySet: true,
      error: err.message,
    });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await getLibrarySnapshot(db, { refresh: req.query.refresh === 'true' });
    res.json({
      totalLibrary: snapshot.totalLibrary,
      totalProcessed: snapshot.totalProcessed,
      totalUntriaged: snapshot.totalUntriaged,
      activeDays: snapshot.activeDays,
      computedAt: snapshot.computedAt,
      timezone: snapshot.timezone,
    });
  } catch (err) {
    console.error('[GET /stats]', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/library/density', async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await getLibrarySnapshot(db, { refresh: req.query.refresh === 'true' });
    res.json({
      computedAt: snapshot.computedAt,
      timezone: snapshot.timezone,
      days: snapshot.days.map(day => ({
        date: day.date,
        count: day.count,
        untriaged: day.untriagedCount > 0,
        untriagedCount: day.untriagedCount,
      })),
    });
  } catch (err) {
    console.error('[GET /library/density]', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/library/suggestions', async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await getLibrarySnapshot(db);
    res.json(clusterSuggestions(snapshot));
  } catch (err) {
    console.error('[GET /library/suggestions]', err);
    res.status(502).json({ error: err.message });
  }
});

router.get('/library/range', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  try {
    const db = getDb();
    const snapshot = await getLibrarySnapshot(db);
    res.json(rangeSummary(snapshot, from, to));
  } catch (err) {
    console.error('[GET /library/range]', err);
    res.status(502).json({ error: err.message });
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
    scenes: scenes.map(s => {
      const raw = JSON.parse(s.asset_ids);
      const isLegacy = raw.length > 0 && typeof raw[0] === 'string';
      const assets = isLegacy ? raw.map(id => ({ id, width: 0, height: 0, originalFileName: '', fileCreatedAt: '' })) : raw;
      return { ...s, asset_ids: assets.map(a => a.id), assets };
    }),
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
  const editRows = db.prepare('SELECT * FROM edits WHERE session_id = ?').all(req.params.id);

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
      const raw = JSON.parse(s.asset_ids);
      // Support both old format (array of strings) and new format (array of objects)
      const isLegacy = raw.length > 0 && typeof raw[0] === 'string';
      const assets = isLegacy ? raw.map(id => ({ id, width: 0, height: 0, originalFileName: '', fileCreatedAt: '' })) : raw;
      const assetIds = assets.map(a => a.id);
      return {
        ...s,
        asset_ids: assetIds,
        assets,
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
    editMap: Object.fromEntries(editRows.map(row => [row.asset_id, parseEditRow(row)])),
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

// POST /api/edits
router.post('/edits', async (req, res, next) => {
  const { sessionId, assetId } = req.body;
  if (!sessionId || !assetId) {
    return res.status(400).json({ error: 'sessionId and assetId are required' });
  }

  let adjustments;
  let crop;
  try {
    adjustments = validateAdjustments(req.body.adjustments);
    crop = validateCrop(req.body.crop);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    await withEditLock(sessionId, assetId, async () => {
      const db = getDb();
      const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      if (!sessionAssetIds(db, sessionId).includes(assetId)) {
        res.status(400).json({ error: 'Asset does not belong to this session' });
        return;
      }

      const previousEdit = db.prepare(
        'SELECT * FROM edits WHERE session_id = ? AND asset_id = ?'
      ).get(sessionId, assetId);

      db.prepare(`
        INSERT INTO edits (session_id, asset_id, adjustments, crop, render_status)
        VALUES (?, ?, ?, ?, 'rendering')
        ON CONFLICT(session_id, asset_id) DO UPDATE SET
          adjustments = excluded.adjustments,
          crop = excluded.crop,
          render_status = 'rendering',
          render_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      `).run(sessionId, assetId, JSON.stringify(adjustments), JSON.stringify(crop));

      let rendered;
      try {
        const original = await getOriginalAssetBuffer(assetId);
        rendered = await writeRenderedEdit({
          input: original.buffer,
          adjustments,
          crop,
          editDir: config.editDir,
          sessionId,
          assetId,
        });
        db.prepare(`
          UPDATE edits
          SET rendered_path = ?,
              render_status = 'ready',
              render_error = NULL,
              immich_asset_id = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE session_id = ? AND asset_id = ?
        `).run(rendered.relativePath, sessionId, assetId);
        if (previousEdit?.rendered_path
            && previousEdit.rendered_path !== rendered.relativePath) {
          try {
            removeRenderedFile(previousEdit.rendered_path);
          } catch (cleanupError) {
            console.warn('[edits] Failed to remove superseded render:', cleanupError.message);
          }
        }
      } catch (err) {
        if (rendered?.relativePath
            && rendered.relativePath !== previousEdit?.rendered_path) {
          try {
            removeRenderedFile(rendered.relativePath);
          } catch (cleanupError) {
            console.warn('[edits] Failed to remove incomplete render:', cleanupError.message);
          }
        }
        const isHeic = /\.hei[cf]$/i.test(
          sessionAssetMetadata(db, sessionId, assetId)?.originalFileName || ''
        );
        const message = isHeic && !sharpCapabilities().heicGuaranteed
          ? `HEIC decode failed on this host: ${err.message}`
          : err.message;
        if (previousEdit?.render_status === 'ready' && previousEdit.rendered_path) {
          db.prepare(`
            UPDATE edits
            SET adjustments = ?,
                crop = ?,
                rendered_path = ?,
                render_status = 'ready',
                render_error = ?,
                immich_asset_id = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE session_id = ? AND asset_id = ?
          `).run(
            previousEdit.adjustments,
            previousEdit.crop,
            previousEdit.rendered_path,
            message,
            previousEdit.immich_asset_id,
            sessionId,
            assetId
          );
        } else {
          db.prepare(`
            UPDATE edits
            SET render_status = 'failed',
                render_error = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE session_id = ? AND asset_id = ?
          `).run(message, sessionId, assetId);
        }
        const failed = db.prepare(
          'SELECT * FROM edits WHERE session_id = ? AND asset_id = ?'
        ).get(sessionId, assetId);
        res.status(422).json({ error: message, edit: parseEditRow(failed) });
        return;
      }

      const ready = db.prepare(
        'SELECT * FROM edits WHERE session_id = ? AND asset_id = ?'
      ).get(sessionId, assetId);
      res.json(parseEditRow(ready));
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/edits
router.delete('/edits', async (req, res, next) => {
  const { sessionId, assetId } = req.body;
  if (!sessionId || !assetId) {
    return res.status(400).json({ error: 'sessionId and assetId are required' });
  }
  try {
    await withEditLock(sessionId, assetId, async () => {
      const db = getDb();
      const edit = db.prepare(
        'SELECT rendered_path FROM edits WHERE session_id = ? AND asset_id = ?'
      ).get(sessionId, assetId);
      removeRenderedFile(edit?.rendered_path);
      db.prepare('DELETE FROM edits WHERE session_id = ? AND asset_id = ?')
        .run(sessionId, assetId);
      res.json({ ok: true });
    });
  } catch (err) {
    next(err);
  }
});

router.get('/edits/capabilities', (req, res) => {
  res.json(sharpCapabilities());
});

router.get('/edits/:sessionId/:assetId/image', (req, res) => {
  const db = getDb();
  const edit = db.prepare(`
    SELECT rendered_path, render_status
    FROM edits
    WHERE session_id = ? AND asset_id = ?
  `).get(req.params.sessionId, req.params.assetId);
  if (!edit || edit.render_status !== 'ready' || !edit.rendered_path) {
    return res.status(404).json({ error: 'Rendered edit is not ready' });
  }
  try {
    const filePath = safeEditPath(config.editDir, edit.rendered_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Rendered edit file is missing' });
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(filePath);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  if (session.committed) {
    return res.json({
      assetsTrashed: 0,
      ratingsWritten: 0,
      stacksCreated: 0,
      errors: [],
      committed: true,
      alreadyCommitted: true,
    });
  }

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

  if (results.errors.length === 0) {
    const assetIds = sessionAssetIds(db, sessionId);
    const markCommitted = db.transaction(() => {
      const insertProcessed = db.prepare(`
        INSERT OR IGNORE INTO processed_assets (asset_id, session_id)
        VALUES (?, ?)
      `);
      for (const assetId of assetIds) insertProcessed.run(assetId, sessionId);
      db.prepare(`
        UPDATE sessions
        SET committed = 1, committed_at = datetime('now')
        WHERE id = ?
      `).run(sessionId);
      invalidateLibraryCache(db);
    });
    markCommitted();
    results.committed = true;
    results.assetsProcessed = assetIds.length;
  } else {
    results.committed = false;
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
