'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const {
  COOKIE_NAME,
  hashPassphrase,
  verifyPassphrase,
  createSession,
  destroySession,
  destroyProfileSessions,
  parseCookie,
  requireAuth,
  requireParent,
} = require('../auth');
const { invalidateLibraryCache } = require('../library');
const { assertNoSecrets, sanitizeString } = require('../secrets-guard');

router.get('/profiles', (req, res) => {
  const db = getDb();
  const profiles = db.prepare(`
    SELECT id, display_name, role
    FROM profiles
    WHERE status IN ('active', 'setup') AND passphrase_hash IS NOT NULL
    ORDER BY role DESC, display_name
  `).all();
  assertNoSecrets(profiles);
  res.json(profiles);
});

router.post('/login', (req, res) => {
  const { profileId, passphrase } = req.body || {};
  if (!Number.isInteger(Number(profileId)) || typeof passphrase !== 'string' || !passphrase) {
    return res.status(400).json({ error: 'Profile and passphrase are required' });
  }
  const db = getDb();
  const profile = db.prepare(
    'SELECT id, passphrase_hash, status FROM profiles WHERE id = ?'
  ).get(profileId);
  if (!profile || !profile.passphrase_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (profile.status === 'disabled') {
    return res.status(403).json({ error: 'This profile has been disabled' });
  }
  if (!verifyPassphrase(passphrase, profile.passphrase_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const session = createSession(db, profile.id);
  res.cookie(COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: new Date(session.expiresAt),
    path: '/',
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const db = getDb();
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  destroySession(db, token);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.post('/setup', (req, res) => {
  const { displayName, passphrase } = req.body || {};
  const normalizedName = typeof displayName === 'string' ? displayName.trim() : '';
  if (!normalizedName || typeof passphrase !== 'string' || !passphrase) {
    return res.status(400).json({ error: 'Display name and passphrase are required' });
  }
  if (passphrase.length < 4) {
    return res.status(400).json({ error: 'Passphrase must be at least 4 characters' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS count FROM profiles WHERE passphrase_hash IS NOT NULL').get();
  if (existing.count > 0) {
    return res.status(409).json({ error: 'Setup already completed' });
  }
  // Update the bootstrap admin profile created by migration
  const hash = hashPassphrase(passphrase);
  db.prepare(`
    UPDATE profiles
    SET display_name = ?, passphrase_hash = ?, status = 'active'
    WHERE id = 1
  `).run(normalizedName, hash);
  const session = createSession(db, 1);
  res.cookie(COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: new Date(session.expiresAt),
    path: '/',
  });
  res.json({ ok: true, profileId: 1 });
});

router.get('/me', requireAuth, (req, res) => {
  const profile = req.profile;
  res.json({
    id: profile.id,
    displayName: profile.display_name,
    role: profile.role,
    immichConnected: Boolean(profile.immich_api_key),
    immichUserId: profile.immich_user_id || null,
  });
});

router.post('/immich-credential', requireAuth, async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return res.status(400).json({ error: 'API key is required' });
  }
  const trimmedKey = apiKey.trim();
  const db = getDb();
  const config = require('../config');
  const { getCurrentUser } = require('../immich-client');
  const credentials = {
    apiKey: trimmedKey,
    immichUrl: req.profile.immich_url || config.immichUrl,
  };
  try {
    const immichUser = await getCurrentUser(credentials);
    db.prepare(`
      UPDATE profiles
      SET immich_api_key = ?,
          immich_user_id = ?,
          immich_verified_at = datetime('now'),
          status = 'active'
      WHERE id = ?
    `).run(trimmedKey, immichUser.id, req.profile.id);
    invalidateLibraryCache(db, req.profile.id);
    res.json({
      ok: true,
      immichUserName: immichUser.name || immichUser.email,
      immichUserId: immichUser.id,
    });
  } catch (err) {
    console.error(
      '[auth] Immich credential verification failed:',
      sanitizeString(err.message, [trimmedKey])
    );
    res.status(400).json({
      error: 'Could not verify key with Immich. Check the key, URL, and required permissions.',
    });
  }
});

router.get('/admin/profiles', requireParent, (req, res) => {
  const db = getDb();
  const profiles = db.prepare(`
    SELECT id, display_name, role, status, immich_user_id, immich_verified_at, created_at
    FROM profiles
    ORDER BY id
  `).all();
  assertNoSecrets(profiles);
  res.json(profiles);
});

router.post('/admin/profiles', requireParent, (req, res) => {
  const { displayName, role = 'kid', passphrase } = req.body || {};
  const normalizedName = typeof displayName === 'string' ? displayName.trim() : '';
  if (!normalizedName) return res.status(400).json({ error: 'Display name is required' });
  if (typeof passphrase !== 'string' || passphrase.length < 4) {
    return res.status(400).json({ error: 'Passphrase must be at least 4 characters' });
  }
  if (!['parent', 'kid'].includes(role)) {
    return res.status(400).json({ error: 'Role must be parent or kid' });
  }
  const db = getDb();
  const hash = hashPassphrase(passphrase);
  try {
    const result = db.prepare(`
      INSERT INTO profiles (display_name, role, passphrase_hash, status)
      VALUES (?, ?, ?, 'setup')
    `).run(normalizedName, role, hash);
    res.status(201).json({
      ok: true,
      profileId: Number(result.lastInsertRowid),
      displayName: normalizedName,
      role,
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A profile with that name already exists' });
    }
    throw err;
  }
});

router.patch('/admin/profiles/:id', requireParent, (req, res) => {
  const db = getDb();
  const profileId = Number(req.params.id);
  const target = db.prepare('SELECT id, role FROM profiles WHERE id = ?').get(profileId);
  if (!target) return res.status(404).json({ error: 'Profile not found' });

  const { status, passphrase } = req.body || {};

  if (status === 'disabled') {
    if (profileId === req.profile.id) {
      return res.status(400).json({ error: 'Cannot disable your own profile' });
    }
    db.prepare("UPDATE profiles SET status = 'disabled' WHERE id = ?").run(profileId);
    destroyProfileSessions(db, profileId);
    return res.json({ ok: true, status: 'disabled' });
  }
  if (status === 'active') {
    db.prepare("UPDATE profiles SET status = 'active' WHERE id = ?").run(profileId);
    return res.json({ ok: true, status: 'active' });
  }
  if (passphrase !== undefined) {
    if (typeof passphrase !== 'string') {
      return res.status(400).json({ error: 'Passphrase must be a string' });
    }
    if (passphrase.length < 4) {
      return res.status(400).json({ error: 'Passphrase must be at least 4 characters' });
    }
    const hash = hashPassphrase(passphrase);
    db.prepare('UPDATE profiles SET passphrase_hash = ? WHERE id = ?').run(hash, profileId);
    destroyProfileSessions(db, profileId);
    return res.json({ ok: true, passphraseReset: true });
  }
  res.status(400).json({ error: 'No recognized action in request body' });
});

module.exports = router;
