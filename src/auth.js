'use strict';
// Authentication and session management for photoDesk household profiles

const crypto = require('crypto');

const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;
const COOKIE_NAME = 'pd_session';

function hashPassphrase(plain) {
  if (typeof plain !== 'string') throw new TypeError('Passphrase must be a string');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassphrase(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || !/^[a-f0-9]+$/i.test(salt) || !/^[a-f0-9]+$/i.test(hash)) {
    return false;
  }
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const test = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN).toString('hex');
  return crypto.timingSafeEqual(expected, Buffer.from(test, 'hex'));
}

function createSession(db, profileId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token, profile_id, expires_at) VALUES (?, ?, ?)'
  ).run(token, profileId, expiresAt);
  return { token, expiresAt };
}

function validateSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT p.id, p.display_name, p.role, p.status,
           p.immich_api_key, p.immich_url, p.immich_user_id
    FROM auth_sessions s
    JOIN profiles p ON s.profile_id = p.id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).get(token);
  return row || null;
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

function destroyProfileSessions(db, profileId) {
  db.prepare('DELETE FROM auth_sessions WHERE profile_id = ?').run(profileId);
}

function cleanExpiredSessions(db) {
  return db.prepare("DELETE FROM auth_sessions WHERE datetime(expires_at) <= datetime('now')").run().changes;
}

function parseCookie(header, name) {
  if (!header) return null;
  const match = header.split(';').find(c => c.trim().startsWith(name + '='));
  return match ? match.split('=')[1].trim() : null;
}

function sessionMiddleware(db) {
  return (req, res, next) => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    const profile = validateSession(db, token);
    if (profile && profile.status !== 'disabled') {
      req.profile = profile;
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.profile) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

function requireParent(req, res, next) {
  if (!req.profile) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.profile.role !== 'parent') {
    return res.status(403).json({ error: 'Parent access required' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  hashPassphrase,
  verifyPassphrase,
  createSession,
  validateSession,
  destroySession,
  destroyProfileSessions,
  cleanExpiredSessions,
  parseCookie,
  sessionMiddleware,
  requireAuth,
  requireParent,
};
