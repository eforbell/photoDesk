const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-partner-ownership-'));
process.env.PHOTODESK_DB_PATH = path.join(tempDir, 'test.db');
process.env.IMMICH_URL = 'http://immich.test';
process.env.IMMICH_API_KEY = 'test-key';

const nativeFetch = global.fetch;
const calls = [];

function asset(id, ownerId, timestamp) {
  return {
    id,
    ownerId,
    fileCreatedAt: timestamp,
    originalFileName: `${id}.jpg`,
    originalWidth: 1600,
    originalHeight: 1200,
  };
}

global.fetch = async (url, options = {}) => {
  const href = String(url);
  if (!href.startsWith('http://immich.test/')) return nativeFetch(url, options);
  const method = options.method || 'GET';
  calls.push({ href, method, body: options.body });

  if (href.endsWith('/api/users/me')) {
    return Response.json({ id: 'user-1', name: 'PhotoDesk Owner' });
  }
  if (href.endsWith('/api/search/metadata') && method === 'POST') {
    return Response.json({
      assets: {
        items: [
          asset('owned-1', 'user-1', '2026-06-10T10:00:00.000Z'),
          asset('partner-1', 'user-2', '2026-06-10T10:01:00.000Z'),
        ],
        nextPage: null,
      },
    });
  }
  throw new Error(`Unexpected Immich request: ${method} ${href}`);
};

const app = require('../src/app');
const { getDb } = require('../src/db');

let server;
let baseUrl;
let authToken;

function authenticateProfile() {
  const db = getDb();
  db.prepare(`
    UPDATE profiles
    SET immich_api_key = 'test-key',
        immich_user_id = 'user-1',
        immich_verified_at = datetime('now'),
        status = 'active',
        passphrase_hash = 'not-used'
    WHERE id = 1
  `).run();
  const crypto = require('crypto');
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO auth_sessions (token, profile_id, expires_at) VALUES (?, 1, ?)'
  ).run(token, expiresAt);
  return token;
}

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  authToken = authenticateProfile();
});

test.after(async () => {
  global.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  calls.length = 0;
});

test('new sessions include only assets owned by the connected Immich user', async () => {
  const response = await nativeFetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': `pd_session=${authToken}` },
    body: JSON.stringify({
      name: 'Owned photos only',
      dateFrom: '2026-06-10',
      dateTo: '2026-06-10',
      sceneThreshold: 30,
    }),
  });
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal(session.total_assets, 1);

  const stored = JSON.parse(
    getDb().prepare('SELECT asset_ids FROM scenes WHERE session_id = ?')
      .get(session.id).asset_ids
  );
  assert.deepEqual(stored.map(item => item.id), ['owned-1']);
  assert.equal(stored[0].ownerId, 'user-1');
});

test('library discovery excludes partner assets and invalidates old unscoped cache data', async () => {
  const db = getDb();
  db.prepare(`
    INSERT INTO density_cache (profile_id, computed_at, data)
    VALUES (1, datetime('now'), ?)
    ON CONFLICT(profile_id) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data
  `).run(JSON.stringify({
    computedAt: new Date().toISOString(),
    totalLibrary: 99,
    totalProcessed: 0,
    totalUntriaged: 99,
    activeDays: 1,
    days: [],
  }));

  const response = await nativeFetch(`${baseUrl}/api/stats`, {
    headers: { 'cookie': `pd_session=${authToken}` },
  });
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.totalLibrary, 1);
  assert.equal(stats.totalUntriaged, 1);

  const cached = JSON.parse(
    db.prepare('SELECT data FROM density_cache WHERE profile_id = 1').get().data
  );
  assert.equal(cached.libraryScope, 'owned');
  assert.equal(cached.totalLibrary, 1);
});
