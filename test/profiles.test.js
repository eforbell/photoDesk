const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-profiles-'));
process.env.PHOTODESK_DB_PATH = path.join(tempDir, 'test.db');
process.env.PHOTODESK_EDIT_DIR = path.join(tempDir, 'edits');
process.env.IMMICH_URL = 'http://immich.test';
process.env.IMMICH_API_KEY = 'test-key';

const nativeFetch = global.fetch;
const immichCalls = [];

global.fetch = async (url, options = {}) => {
  const href = String(url);
  if (!href.startsWith('http://immich.test/')) return nativeFetch(url, options);
  immichCalls.push({
    href,
    method: options.method || 'GET',
    apiKey: options.headers?.['x-api-key'],
  });
  if (href.endsWith('/api/users/me')) {
    return Response.json({ id: 'user-1', name: 'Test User', email: 'test@example.com' });
  }
  if (href.endsWith('/api/search/metadata')) {
    return Response.json({ assets: { items: [], nextPage: null } });
  }
  throw new Error(`Unexpected Immich request: ${options.method || 'GET'} ${href}`);
};

const app = require('../src/app');
const { getDb } = require('../src/db');

let server;
let baseUrl;

async function apiFetch(urlPath, options = {}) {
  return nativeFetch(`${baseUrl}${urlPath}`, options);
}

async function authedFetch(urlPath, cookie, options = {}) {
  return nativeFetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: { ...options.headers, cookie },
  });
}

function getCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/pd_session=([^;]+)/);
  return match ? `pd_session=${match[1]}` : null;
}

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() => {
  server?.close();
});

// ─── Setup flow ──────────────────────────────────────────────

test('GET /api/auth/profiles returns empty list on fresh install', async () => {
  const res = await apiFetch('/api/auth/profiles');
  assert.equal(res.status, 200);
  const profiles = await res.json();
  assert.ok(Array.isArray(profiles));
  assert.equal(profiles.length, 0, 'bootstrap profile has no passphrase so is excluded');
});

test('unauthenticated root serves the login page without dashboard bootstrap', async () => {
  const res = await apiFetch('/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /PhotoDesk — Sign in/);
  assert.doesNotMatch(html, /src="app\.js"/);
});

test('POST /api/auth/setup creates the first parent profile', async () => {
  const res = await apiFetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Parent A', passphrase: 'test1234' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  const cookie = getCookie(res);
  assert.ok(cookie, 'should set a session cookie');
});

test('POST /api/auth/setup rejects duplicate setup', async () => {
  const res = await apiFetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Parent B', passphrase: 'test5678' }),
  });
  assert.equal(res.status, 409);
});

// ─── Login flow ──────────────────────────────────────────────

let parentCookie;

test('POST /api/auth/login with correct credentials sets session cookie', async () => {
  const profilesRes = await apiFetch('/api/auth/profiles');
  const profiles = await profilesRes.json();
  const parentProfile = profiles.find(p => p.role === 'parent');

  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: parentProfile.id, passphrase: 'test1234' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  parentCookie = getCookie(res);
  assert.ok(parentCookie, 'should set a session cookie');
});

test('POST /api/auth/login with wrong passphrase returns 401', async () => {
  const profilesRes = await apiFetch('/api/auth/profiles');
  const profiles = await profilesRes.json();
  const parentProfile = profiles.find(p => p.role === 'parent');

  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: parentProfile.id, passphrase: 'wrong-pass' }),
  });
  assert.equal(res.status, 401);
});

test('auth routes reject non-string passphrases without throwing', async () => {
  const profilesRes = await apiFetch('/api/auth/profiles');
  const profiles = await profilesRes.json();
  const parentProfile = profiles.find(p => p.role === 'parent');

  const loginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: parentProfile.id, passphrase: { value: 'bad' } }),
  });
  assert.equal(loginRes.status, 400);

  const createRes = await authedFetch('/api/auth/admin/profiles', parentCookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Invalid Passphrase',
      role: 'kid',
      passphrase: { value: 'bad' },
    }),
  });
  assert.equal(createRes.status, 400);
});

test('GET /api/auth/me returns profile info when authenticated', async () => {
  const res = await authedFetch('/api/auth/me', parentCookie);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.displayName, 'Parent A');
  assert.equal(body.role, 'parent');
  assert.equal(typeof body.id, 'number');
});

test('GET /api/auth/me returns 401 without cookie', async () => {
  const res = await apiFetch('/api/auth/me');
  assert.equal(res.status, 401);
});

// ─── Profile isolation ───────────────────────────────────────

let kidProfileId;
let kidCookie;
let parentSessionId;

test('sessions are scoped to the authenticated profile', async () => {
  // Create a second profile (kid) via admin API
  const createRes = await authedFetch('/api/auth/admin/profiles', parentCookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Kid One', role: 'kid', passphrase: 'kidpass1' }),
  });
  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  kidProfileId = createBody.profileId;

  // Activate the kid profile so login works
  const db = getDb();
  db.prepare("UPDATE profiles SET status = 'active' WHERE id = ?").run(kidProfileId);

  // Login as kid
  const loginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: kidProfileId, passphrase: 'kidpass1' }),
  });
  assert.equal(loginRes.status, 200);
  kidCookie = getCookie(loginRes);

  // Create a culling session as parent (directly in DB to avoid Immich calls)
  const parentProfile = db.prepare("SELECT id FROM profiles WHERE role = 'parent' LIMIT 1").get();
  parentSessionId = Number(db.prepare(`
    INSERT INTO sessions (name, total_assets, total_scenes, profile_id)
    VALUES ('Parent Session', 1, 1, ?)
  `).run(parentProfile.id).lastInsertRowid);
  db.prepare(`
    INSERT INTO scenes (session_id, scene_index, asset_ids)
    VALUES (?, 0, ?)
  `).run(parentSessionId, JSON.stringify([{ id: 'asset-1', width: 100, height: 100, originalFileName: 'a.jpg', fileCreatedAt: '' }]));

  // Fetch sessions as kid — should not see parent's session
  const kidSessionsRes = await authedFetch('/api/sessions', kidCookie);
  assert.equal(kidSessionsRes.status, 200);
  const kidSessions = await kidSessionsRes.json();
  const parentSessionIds = kidSessions.filter(s => s.name === 'Parent Session');
  assert.equal(parentSessionIds.length, 0, 'kid should not see parent sessions');
});

test('profiles without an enrolled key never fall back to the server key', async () => {
  immichCalls.length = 0;
  const res = await authedFetch('/api/health', kidCookie);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { immich: 'disconnected', apiKeySet: false });
  assert.equal(immichCalls.length, 0);
});

test('rendered edits cannot be fetched across profile boundaries', async () => {
  const db = getDb();
  fs.mkdirSync(process.env.PHOTODESK_EDIT_DIR, { recursive: true });
  const renderedPath = 'profile-1/private-edit.jpg';
  const absolutePath = path.join(process.env.PHOTODESK_EDIT_DIR, renderedPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.from('private derivative'));
  db.prepare(`
    INSERT INTO edits (
      session_id, asset_id, rendered_path, render_status
    ) VALUES (?, 'asset-1', ?, 'ready')
  `).run(parentSessionId, renderedPath);

  const parentResponse = await authedFetch(
    `/api/edits/${parentSessionId}/asset-1/image`,
    parentCookie
  );
  assert.equal(parentResponse.status, 200);

  const kidResponse = await authedFetch(
    `/api/edits/${parentSessionId}/asset-1/image`,
    kidCookie
  );
  assert.equal(kidResponse.status, 404);
});

test('expired ISO auth sessions are rejected immediately', async () => {
  const db = getDb();
  const token = crypto.randomUUID();
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  db.prepare(`
    INSERT INTO auth_sessions (token, profile_id, expires_at)
    VALUES (?, 1, ?)
  `).run(token, expiredAt);

  const res = await authedFetch('/api/auth/me', `pd_session=${token}`);
  assert.equal(res.status, 401);
});

test('unauthenticated requests to /api routes return 401', async () => {
  const res = await apiFetch('/api/sessions');
  assert.equal(res.status, 401);
});

// ─── Credential enrollment ───────────────────────────────────

test('POST /api/auth/immich-credential verifies and saves the Immich key', async () => {
  const res = await authedFetch('/api/auth/immich-credential', parentCookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'my-immich-key' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.immichUserId, 'user-1');

  // Verify the profile was updated
  const meRes = await authedFetch('/api/auth/me', parentCookie);
  const me = await meRes.json();
  assert.equal(me.immichConnected, true);
  assert.equal(me.immichUserId, 'user-1');
});

// ─── Admin profile management ────────────────────────────────

test('parent can create a new profile', async () => {
  const res = await authedFetch('/api/auth/admin/profiles', parentCookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: 'Kid Two', role: 'kid', passphrase: 'kidpass2' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.displayName, 'Kid Two');
  assert.equal(body.role, 'kid');
  assert.equal(typeof body.profileId, 'number');
});

test('parent can disable a profile', async () => {
  const db = getDb();

  // Activate kid profile and create a session for it
  db.prepare("UPDATE profiles SET status = 'active' WHERE id = ?").run(kidProfileId);
  const kidLoginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: kidProfileId, passphrase: 'kidpass1' }),
  });
  assert.equal(kidLoginRes.status, 200);
  const freshKidCookie = getCookie(kidLoginRes);

  // Verify kid can access /me before being disabled
  const preMeRes = await authedFetch('/api/auth/me', freshKidCookie);
  assert.equal(preMeRes.status, 200);

  // Disable the kid profile
  const res = await authedFetch(`/api/auth/admin/profiles/${kidProfileId}`, parentCookie, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'disabled' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'disabled');

  // Verify the kid's sessions were expired (cookie no longer works)
  const postMeRes = await authedFetch('/api/auth/me', freshKidCookie);
  assert.equal(postMeRes.status, 401);
});

test('kid cannot access admin routes', async () => {
  // Re-enable kid and login
  const db = getDb();
  db.prepare("UPDATE profiles SET status = 'active' WHERE id = ?").run(kidProfileId);
  const loginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: kidProfileId, passphrase: 'kidpass1' }),
  });
  assert.equal(loginRes.status, 200);
  const kidAdminCookie = getCookie(loginRes);

  const res = await authedFetch('/api/auth/admin/profiles', kidAdminCookie);
  assert.equal(res.status, 403);
});

test('profile can change its own passphrase and rotate its auth session', async () => {
  const loginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: kidProfileId, passphrase: 'kidpass1' }),
  });
  const oldCookie = getCookie(loginRes);

  const changeRes = await authedFetch('/api/auth/passphrase', oldCookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      currentPassphrase: 'kidpass1',
      newPassphrase: 'kidpass-new',
    }),
  });
  assert.equal(changeRes.status, 200);
  const newCookie = getCookie(changeRes);
  assert.ok(newCookie);
  assert.notEqual(newCookie, oldCookie);

  assert.equal((await authedFetch('/api/auth/me', oldCookie)).status, 401);
  assert.equal((await authedFetch('/api/auth/me', newCookie)).status, 200);

  const relogin = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profileId: kidProfileId, passphrase: 'kidpass-new' }),
  });
  assert.equal(relogin.status, 200);
});
