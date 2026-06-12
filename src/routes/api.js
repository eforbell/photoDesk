const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const editLocks = new Map();
const commitLocks = new Set();
const { getDb } = require('../db');
const {
  fetchOwnedAssets,
  getCurrentUser,
  getAssetInfo,
  assetExists,
  getThumbnailBuffer,
  getOriginalAssetBuffer,
  uploadAsset,
  createStack,
  stackEditedAsset,
  trashAssets,
  updateAssetRating,
  checkConnection,
} = require('../immich-client');
const { clusterByTime } = require('../clustering');
const {
  clusterSuggestions,
  getLibrarySnapshot,
  invalidateLibraryCache,
  processedAssetIds,
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

function profileCredentials(req) {
  if (!req.profile) return undefined;
  if (!req.profile.immich_api_key) return undefined;
  return {
    apiKey: req.profile.immich_api_key,
    immichUrl: req.profile.immich_url || config.immichUrl,
  };
}

function verifySessionOwner(db, sessionId, profileId) {
  const session = db.prepare('SELECT profile_id FROM sessions WHERE id = ?').get(sessionId);
  return session && session.profile_id === profileId;
}

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
  return sessionAssetMetadataMap(db, sessionId).get(assetId) || null;
}

function sessionAssetMetadataMap(db, sessionId) {
  const rows = db.prepare(
    'SELECT asset_ids FROM scenes WHERE session_id = ? ORDER BY scene_index'
  ).all(sessionId);
  const metadata = new Map();
  for (const row of rows) {
    for (const asset of JSON.parse(row.asset_ids)) {
      const value = typeof asset === 'string' ? { id: asset } : asset;
      metadata.set(value.id, value);
    }
  }
  return metadata;
}

async function sessionOwnership(db, sessionId, credentials) {
  const currentUser = await getCurrentUser(credentials);
  const metadata = sessionAssetMetadataMap(db, sessionId);
  const ownership = await Promise.all(
    [...metadata].map(async ([assetId, asset]) => {
      if (asset.ownerId) return { assetId, ownerId: asset.ownerId };
      try {
        const remoteAsset = await getAssetInfo(assetId, credentials);
        return { assetId, ownerId: remoteAsset.ownerId };
      } catch {
        return { assetId, unverifiable: true };
      }
    })
  );
  const partnerAssetIds = ownership
    .filter(asset => !asset.unverifiable && asset.ownerId !== currentUser.id)
    .map(asset => asset.assetId);
  const unverifiableAssetIds = ownership
    .filter(asset => asset.unverifiable || !asset.ownerId)
    .map(asset => asset.assetId);

  return {
    currentUserId: currentUser.id,
    partnerAssetIds,
    unverifiableAssetIds,
    writable: partnerAssetIds.length === 0 && unverifiableAssetIds.length === 0,
  };
}

function removeRenderedFile(relativePath) {
  if (!relativePath) return;
  fs.rmSync(safeEditPath(config.editDir, relativePath), { force: true });
}

function editedFilename(originalFileName, assetId) {
  const source = originalFileName || assetId || 'photo';
  const extensionIndex = source.lastIndexOf('.');
  const stem = extensionIndex > 0 ? source.slice(0, extensionIndex) : source;
  const safeStem = stem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '') || 'photo';
  return `${safeStem}-photodesk.jpg`;
}

function clientErrorMessage(error, fallback = 'Image processing failed') {
  let message = String(error?.message || fallback).replace(/\0/g, '');
  for (const root of [config.editDir, process.cwd(), path.parse(process.cwd()).root]) {
    if (!root || root === path.parse(root).root) continue;
    message = message.split(root).join('[local path]');
  }
  message = message
    .replace(/[A-Za-z]:\\(?:[^\\\s:]+\\)*[^\\\s:]*/g, '[local path]')
    .replace(/\/(?:[^/\s:]+\/)*[^/\s:]*/g, '[local path]');
  return message.slice(0, 500);
}

function uploadTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

async function uploadAndStackEdit(db, sessionId, edit, metadata = {}, credentials) {
  let immichAssetId = edit.immich_asset_id;

  if (immichAssetId) {
    const exists = await assetExists(immichAssetId, credentials);
    if (exists && edit.render_status === 'uploaded') {
      return { immichAssetId, alreadyApplied: true };
    }
    if (!exists) {
      immichAssetId = null;
      db.prepare(`
        UPDATE edits
        SET immich_asset_id = NULL,
            render_status = 'ready',
            render_error = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(edit.id);
    }
  }

  if (!immichAssetId) {
    if (!edit.rendered_path) throw new Error('Rendered edit file is missing');
    const filePath = safeEditPath(config.editDir, edit.rendered_path);
    if (!fs.existsSync(filePath)) throw new Error('Rendered edit file is missing');
    const createdAt = uploadTimestamp(metadata.fileCreatedAt || edit.updated_at);
    const modifiedAt = uploadTimestamp(edit.updated_at);
    const uploaded = await uploadAsset({
      buffer: fs.readFileSync(filePath),
      filename: editedFilename(metadata.originalFileName, edit.asset_id),
      deviceAssetId: `photodesk:${sessionId}:${edit.asset_id}:${edit.updated_at}`,
      fileCreatedAt: createdAt,
      fileModifiedAt: modifiedAt,
    }, credentials);
    if (!uploaded?.id) throw new Error('Immich upload returned no asset ID');
    immichAssetId = uploaded.id;
    db.prepare(`
      UPDATE edits
      SET immich_asset_id = ?,
          render_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(immichAssetId, edit.id);
  }

  await stackEditedAsset(edit.asset_id, immichAssetId, credentials);
  db.prepare(`
    UPDATE edits
    SET render_status = 'uploaded',
        render_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(edit.id);
  return { immichAssetId, alreadyApplied: false };
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
    // Entries are self-pruning: only the newest waiter owns the map slot, and
    // removes it when its work completes.
    if (editLocks.get(key) === current) editLocks.delete(key);
  }
}

function parseCommitOptions(body = {}) {
  const defaults = {
    trashRejects: true,
    writeRatings: true,
    createStacks: true,
    uploadEdits: false,
  };
  for (const key of Object.keys(defaults)) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      throw new TypeError(`${key} must be a boolean`);
    }
  }
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, body[key] ?? fallback])
  );
}

function commitActionApplied(db, sessionId, actionType, actionKey, payload) {
  const row = db.prepare(`
    SELECT status, payload
    FROM commit_actions
    WHERE session_id = ? AND action_type = ? AND action_key = ?
  `).get(sessionId, actionType, String(actionKey));
  return Boolean(row && row.status === 'succeeded' && row.payload === JSON.stringify(payload));
}

function recordCommitAction(db, sessionId, actionType, actionKey, payload, status, lastError = null) {
  db.prepare(`
    INSERT INTO commit_actions (
      session_id, action_type, action_key, payload, status, attempts, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(session_id, action_type, action_key) DO UPDATE SET
      payload = excluded.payload,
      status = excluded.status,
      attempts = commit_actions.attempts + 1,
      last_error = excluded.last_error,
      updated_at = datetime('now')
  `).run(
    sessionId,
    actionType,
    String(actionKey),
    JSON.stringify(payload),
    status,
    lastError
  );
}

function commitContext(db, sessionId) {
  return {
    decisions: db.prepare(
      'SELECT asset_id, decision FROM decisions WHERE session_id = ?'
    ).all(sessionId),
    ratings: db.prepare(
      'SELECT asset_id, rating FROM ratings WHERE session_id = ?'
    ).all(sessionId),
    stacks: db.prepare(
      'SELECT id, asset_ids FROM stack_groups WHERE session_id = ? ORDER BY id'
    ).all(sessionId).map(row => ({ id: row.id, assetIds: JSON.parse(row.asset_ids) })),
    edits: db.prepare(`
      SELECT id, asset_id, rendered_path, render_status, render_error,
             immich_asset_id, updated_at
      FROM edits
      WHERE session_id = ?
        AND (render_status = 'ready' OR render_status = 'uploaded')
      ORDER BY id
    `).all(sessionId),
  };
}

function commitPreview(db, sessionId, options, context = commitContext(db, sessionId)) {
  const rejects = context.decisions
    .filter(row => row.decision === 'reject')
    .map(row => ({ key: row.asset_id, payload: { assetId: row.asset_id } }));
  const ratings = context.ratings
    .map(row => ({ key: row.asset_id, payload: { assetId: row.asset_id, rating: row.rating } }));
  const stacks = context.stacks
    .map(row => ({ key: row.id, payload: { assetIds: row.assetIds } }));
  const edits = context.edits.map(row => ({
    key: row.asset_id,
    alreadyApplied: row.render_status === 'uploaded' && Boolean(row.immich_asset_id),
  }));

  function ledgerStep(id, label, selected, items, actionType) {
    const alreadyApplied = selected
      ? items.filter(item => commitActionApplied(
        db, sessionId, actionType, item.key, item.payload
      )).length
      : 0;
    return {
      id,
      label,
      selected,
      total: items.length,
      pending: selected ? items.length - alreadyApplied : 0,
      alreadyApplied,
    };
  }

  const steps = [
    ledgerStep('trash', 'Trash rejects', options.trashRejects, rejects, 'trash'),
    ledgerStep('ratings', 'Write star ratings', options.writeRatings, ratings, 'rating'),
    ledgerStep('stacks', 'Create stacks', options.createStacks, stacks, 'stack'),
    {
      id: 'edits',
      label: 'Upload edited versions',
      selected: options.uploadEdits,
      total: edits.length,
      pending: options.uploadEdits ? edits.filter(edit => !edit.alreadyApplied).length : 0,
      alreadyApplied: options.uploadEdits ? edits.filter(edit => edit.alreadyApplied).length : 0,
      recheckedAtCommit: true,
    },
  ];

  return {
    steps,
    pendingActions: steps.reduce((sum, step) => sum + step.pending, 0),
    alreadyAppliedActions: steps.reduce((sum, step) => sum + step.alreadyApplied, 0),
    warnings: steps.find(step => step.id === 'trash')?.pending > 0
      ? ['Rejected photos will be moved to Immich trash. This is recoverable in Immich.']
      : [],
    items: { rejects, ratings, stacks, edits },
  };
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
    WHERE sessions.profile_id = ?
    GROUP BY sessions.id
    ORDER BY sessions.created_at DESC
  `).all(req.profile.id);
  res.json(sessions);
});

// POST /api/sessions
router.post('/sessions', async (req, res) => {
  try {
    const { name, dateFrom, dateTo, sceneThreshold = 30, untriagedOnly = false } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    // Fetch all assets from Immich
    let assets = await fetchOwnedAssets({
      dateFrom: localDateBoundary(dateFrom),
      dateTo: localDateBoundary(dateTo, true),
    }, profileCredentials(req));
    if (untriagedOnly) {
      const db = getDb();
      const processed = processedAssetIds(db, req.profile.id);
      assets = assets.filter(asset => !processed.has(asset.id));
    }

    if (assets.length === 0) {
      return res.status(400).json({ error: 'No assets found for the given date range' });
    }

    // Cluster into scenes
    const sceneClusters = clusterByTime(assets, Number(sceneThreshold));

    const db = getDb();

    const insertSession = db.prepare(`
      INSERT INTO sessions (name, total_assets, total_scenes, immich_url, date_from, date_to, scene_threshold, profile_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        Number(sceneThreshold),
        req.profile.id
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
          ownerId: a.ownerId,
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
  const apiKeySet = Boolean(req.profile.immich_api_key || config.immichApiKey);
  if (!apiKeySet) {
    return res.json({ immich: 'disconnected', apiKeySet: false });
  }
  try {
    await checkConnection(profileCredentials(req));
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
    const snapshot = await getLibrarySnapshot(db, req.profile.id, { refresh: req.query.refresh === 'true', credentials: profileCredentials(req) });
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
    const snapshot = await getLibrarySnapshot(db, req.profile.id, { refresh: req.query.refresh === 'true', credentials: profileCredentials(req) });
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
    const snapshot = await getLibrarySnapshot(db, req.profile.id, { credentials: profileCredentials(req) });
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
    const snapshot = await getLibrarySnapshot(db, req.profile.id, { credentials: profileCredentials(req) });
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
  if (session.profile_id !== req.profile.id) return res.status(404).json({ error: 'Session not found' });

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
  if (session.profile_id !== req.profile.id) return res.status(404).json({ error: 'Session not found' });

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
  if (!verifySessionOwner(db, sessionId, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
  if (!verifySessionOwner(db, sessionId, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
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
  if (!verifySessionOwner(db, sessionId, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
  if (!verifySessionOwner(db, sessionId, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
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
    const db = getDb();
    if (!verifySessionOwner(db, sessionId, req.profile.id)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!sessionAssetIds(db, sessionId).includes(assetId)) {
      return res.status(400).json({ error: 'Asset does not belong to this session' });
    }

    const result = await withEditLock(sessionId, assetId, async () => {
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
        const original = await getOriginalAssetBuffer(assetId, profileCredentials(req));
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
        console.error('[edits] Render failed:', err);
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
        const detail = clientErrorMessage(err);
        const message = isHeic && !sharpCapabilities().heicGuaranteed
          ? `HEIC decode failed on this host: ${detail}`
          : detail;
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
        return { status: 422, body: { error: message, edit: parseEditRow(failed) } };
      }

      const ready = db.prepare(
        'SELECT * FROM edits WHERE session_id = ? AND asset_id = ?'
      ).get(sessionId, assetId);
      return { status: 200, body: parseEditRow(ready) };
    });
    return res.status(result.status).json(result.body);
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
    const db = getDb();
    if (!verifySessionOwner(db, sessionId, req.profile.id)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    await withEditLock(sessionId, assetId, async () => {
      const edit = db.prepare(
        'SELECT rendered_path FROM edits WHERE session_id = ? AND asset_id = ?'
      ).get(sessionId, assetId);
      removeRenderedFile(edit?.rendered_path);
      db.prepare('DELETE FROM edits WHERE session_id = ? AND asset_id = ?')
        .run(sessionId, assetId);
    });
    return res.json({ ok: true });
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
  if (!edit || !['ready', 'uploaded'].includes(edit.render_status) || !edit.rendered_path) {
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
  if (!verifySessionOwner(db, sessionId, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
  const group = db.prepare('SELECT session_id FROM stack_groups WHERE id = ?').get(req.params.id);
  if (group && !verifySessionOwner(db, group.session_id, req.profile.id)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  db.prepare('DELETE FROM stack_groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/sessions/:id/commit
router.post('/sessions/:id/commit', async (req, res) => {
  const db = getDb();
  const sessionId = req.params.id;
  const dryRun = req.query.dryRun === 'true';

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.profile_id !== req.profile.id) return res.status(404).json({ error: 'Session not found' });
  let options;
  try {
    options = parseCommitOptions(req.body || {});
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (session.committed) {
    return res.json({
      dryRun,
      assetsTrashed: 0,
      ratingsWritten: 0,
      stacksCreated: 0,
      editsUploaded: 0,
      editsAlreadyUploaded: 0,
      errors: [],
      committed: true,
      alreadyCommitted: true,
      steps: [],
      pendingActions: 0,
      alreadyAppliedActions: 0,
      warnings: [],
      items: { rejects: [], ratings: [], stacks: [], edits: [] },
    });
  }

  let ownership;
  try {
    ownership = await sessionOwnership(db, sessionId, profileCredentials(req));
  } catch (err) {
    return res.status(502).json({
      error: clientErrorMessage(err, 'Unable to verify session asset ownership'),
      code: 'ownership_check_failed',
    });
  }
  if (!ownership.writable) {
    const partnerCount = ownership.partnerAssetIds.length;
    const unknownCount = ownership.unverifiableAssetIds.length;
    const details = [
      partnerCount ? `${partnerCount} partner-owned` : null,
      unknownCount ? `${unknownCount} unavailable` : null,
    ].filter(Boolean).join(' and ');
    return res.status(409).json({
      error: `This session contains ${details} ${partnerCount + unknownCount === 1 ? 'asset' : 'assets'} that PhotoDesk cannot safely commit. Start a new session; discovery now includes only photos owned by the connected Immich account.`,
      code: 'session_contains_unwritable_assets',
      partnerAssetCount: partnerCount,
      unavailableAssetCount: unknownCount,
    });
  }

  const context = commitContext(db, sessionId);
  const preview = commitPreview(db, sessionId, options, context);
  if (dryRun) {
    return res.json({
      dryRun: true,
      committed: false,
      alreadyCommitted: false,
      ...preview,
    });
  }

  if (commitLocks.has(String(sessionId))) {
    return res.status(409).json({ error: 'A commit is already running for this session' });
  }
  commitLocks.add(String(sessionId));

  let runId;
  let assetMetadata;
  try {
    db.prepare(`
      UPDATE commit_runs
      SET status = 'interrupted',
          result = COALESCE(result, ?),
          completed_at = COALESCE(completed_at, datetime('now'))
      WHERE session_id = ? AND status = 'running'
    `).run(JSON.stringify({
      committed: false,
      errors: ['PhotoDesk restarted before this commit attempt completed.'],
    }), sessionId);
    const run = db.prepare(`
      INSERT INTO commit_runs (session_id, status, options)
      VALUES (?, 'running', ?)
    `).run(sessionId, JSON.stringify(options));
    runId = Number(run.lastInsertRowid);
    assetMetadata = options.uploadEdits ? sessionAssetMetadataMap(db, sessionId) : new Map();
  } catch (err) {
    commitLocks.delete(String(sessionId));
    return res.status(500).json({ error: clientErrorMessage(err, 'Commit setup failed') });
  }

  const results = {
    dryRun: false,
    assetsTrashed: 0,
    ratingsWritten: 0,
    stacksCreated: 0,
    editsUploaded: 0,
    editsAlreadyUploaded: 0,
    errors: [],
    steps: preview.steps.map(step => ({
      ...step,
      pending: step.id === 'edits' && step.selected ? step.total : step.pending,
      alreadyApplied: step.id === 'edits' ? 0 : step.alreadyApplied,
      succeeded: 0,
      failed: 0,
      errors: [],
    })),
    pendingActions: preview.pendingActions,
    alreadyAppliedActions: preview.alreadyAppliedActions,
    warnings: preview.warnings,
  };

  const step = id => results.steps.find(item => item.id === id);
  const addError = (stepId, message) => {
    results.errors.push(message);
    const target = step(stepId);
    target.failed++;
    target.errors.push(message);
  };

  try {
    // 1. Trash rejects
    if (options.trashRejects) {
      const pendingRejects = preview.items.rejects.filter(item => !commitActionApplied(
        db, sessionId, 'trash', item.key, item.payload
      ));
      for (const item of pendingRejects) {
        try {
          await trashAssets([item.payload.assetId], profileCredentials(req));
          recordCommitAction(db, sessionId, 'trash', item.key, item.payload, 'succeeded');
          results.assetsTrashed++;
          step('trash').succeeded++;
        } catch (err) {
          const message = clientErrorMessage(err, 'Trash failed');
          recordCommitAction(db, sessionId, 'trash', item.key, item.payload, 'failed', message);
          addError('trash', `Trash failed for ${item.payload.assetId}: ${message}`);
        }
      }
    }

    // 2. Write ratings
    if (options.writeRatings) {
      for (const item of preview.items.ratings) {
        if (commitActionApplied(db, sessionId, 'rating', item.key, item.payload)) continue;
        try {
          await updateAssetRating(item.payload.assetId, item.payload.rating, profileCredentials(req));
          recordCommitAction(db, sessionId, 'rating', item.key, item.payload, 'succeeded');
          results.ratingsWritten++;
          step('ratings').succeeded++;
        } catch (err) {
          const message = clientErrorMessage(err, 'Rating update failed');
          recordCommitAction(db, sessionId, 'rating', item.key, item.payload, 'failed', message);
          addError(
            'ratings',
            `Rating update failed for ${item.payload.assetId}: ${message}`
          );
        }
      }
    }

    // 3. Create stacks
    if (options.createStacks) {
      for (const item of preview.items.stacks) {
        if (commitActionApplied(db, sessionId, 'stack', item.key, item.payload)) continue;
        try {
          await createStack(item.payload.assetIds, profileCredentials(req));
          recordCommitAction(db, sessionId, 'stack', item.key, item.payload, 'succeeded');
          results.stacksCreated++;
          step('stacks').succeeded++;
        } catch (err) {
          const message = clientErrorMessage(err, 'Stack creation failed');
          recordCommitAction(db, sessionId, 'stack', item.key, item.payload, 'failed', message);
          addError('stacks', `Stack creation failed: ${message}`);
        }
      }
    }

    // 4. Upload edited versions, preserving the original as stack primary.
    if (options.uploadEdits) {
      for (const edit of context.edits) {
        try {
          const uploadResult = await withEditLock(sessionId, edit.asset_id, async () => (
            uploadAndStackEdit(
              db,
              sessionId,
              edit,
              assetMetadata.get(edit.asset_id) || {},
              profileCredentials(req)
            )
          ));
          if (uploadResult.alreadyApplied) {
            results.editsAlreadyUploaded++;
            step('edits').alreadyApplied++;
          } else {
            results.editsUploaded++;
            step('edits').succeeded++;
          }
        } catch (err) {
          const message = clientErrorMessage(err, 'Edited upload failed');
          db.prepare(`
            UPDATE edits
            SET render_error = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ?
          `).run(message, edit.id);
          addError('edits', `Edited upload failed for ${edit.asset_id}: ${message}`);
        }
      }
    }

    if (results.errors.length === 0) {
      const assetIds = sessionAssetIds(db, sessionId);
      const uploadedEditIds = db.prepare(`
        SELECT immich_asset_id
        FROM edits
        WHERE session_id = ?
          AND render_status = 'uploaded'
          AND immich_asset_id IS NOT NULL
      `).all(sessionId).map(row => row.immich_asset_id);
      const processedIds = [...new Set([...assetIds, ...uploadedEditIds])];
      const markCommitted = db.transaction(() => {
        const insertProcessed = db.prepare(`
          INSERT OR IGNORE INTO processed_assets (asset_id, profile_id, session_id)
          VALUES (?, ?, ?)
        `);
        for (const assetId of processedIds) insertProcessed.run(assetId, req.profile.id, sessionId);
        db.prepare(`
          UPDATE sessions
          SET committed = 1, committed_at = datetime('now')
          WHERE id = ?
        `).run(sessionId);
        invalidateLibraryCache(db, req.profile.id);
      });
      markCommitted();
      results.committed = true;
      results.assetsProcessed = processedIds.length;
      results.editedAssetsProcessed = uploadedEditIds.length;
    } else {
      results.committed = false;
    }

    db.prepare(`
      UPDATE commit_runs
      SET status = ?, result = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(results.committed ? 'succeeded' : 'failed', JSON.stringify(results), runId);
    return res.json(results);
  } catch (err) {
    const message = clientErrorMessage(err, 'Commit failed');
    const failedResult = { ...results, committed: false, errors: [...results.errors, message] };
    db.prepare(`
      UPDATE commit_runs
      SET status = 'failed', result = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(failedResult), runId);
    return res.status(500).json({ error: message, result: failedResult });
  } finally {
    commitLocks.delete(String(sessionId));
  }
});

// GET /api/proxy/thumbnail/:assetId
router.get('/proxy/thumbnail/:assetId', async (req, res) => {
  try {
    const { buffer, contentType } = await getThumbnailBuffer(req.params.assetId, profileCredentials(req));
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error('[thumbnail proxy]', err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
