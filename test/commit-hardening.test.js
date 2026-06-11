const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-commit-hardening-'));
process.env.PHOTODESK_DB_PATH = path.join(tempDir, 'test.db');
process.env.IMMICH_URL = 'http://immich.test';
process.env.IMMICH_API_KEY = 'test-key';

const nativeFetch = global.fetch;
const calls = [];
let ratingFailuresRemaining = 0;
const trashFailures = new Set();
const assetInfoOwners = new Map();

global.fetch = async (url, options = {}) => {
  const href = String(url);
  if (!href.startsWith('http://immich.test/')) return nativeFetch(url, options);

  const method = options.method || 'GET';
  calls.push({ href, method, body: options.body });
  if (href.endsWith('/api/users/me')) {
    return Response.json({ id: 'user-1', name: 'PhotoDesk Owner' });
  }
  const assetInfoMatch = href.match(/\/api\/assets\/([^/]+)$/);
  if (assetInfoMatch && method === 'GET' && assetInfoOwners.has(assetInfoMatch[1])) {
    return Response.json({
      id: assetInfoMatch[1],
      ownerId: assetInfoOwners.get(assetInfoMatch[1]),
    });
  }
  if (href.endsWith('/api/assets') && method === 'DELETE') {
    const payload = JSON.parse(options.body);
    assert.equal(payload.force, false);
    assert.equal(payload.ids.length, 1);
    if (trashFailures.has(payload.ids[0])) {
      trashFailures.delete(payload.ids[0]);
      return Response.json({ message: 'temporary trash failure' }, { status: 500 });
    }
    return new Response(null, { status: 204 });
  }
  if (href.endsWith('/api/assets/asset-2') && method === 'PUT') {
    if (ratingFailuresRemaining > 0) {
      ratingFailuresRemaining--;
      return Response.json({ message: 'temporary rating failure' }, { status: 500 });
    }
    assert.deepEqual(JSON.parse(options.body), { rating: 4 });
    return Response.json({ id: 'asset-2', rating: 4 });
  }
  if (href.endsWith('/api/stacks') && method === 'POST') {
    assert.deepEqual(JSON.parse(options.body), { assetIds: ['asset-2', 'asset-3'] });
    return Response.json({ id: 'stack-1', primaryAssetId: 'asset-2' }, { status: 201 });
  }
  throw new Error(`Unexpected Immich request: ${method} ${href}`);
};

const app = require('../src/app');
const { getDb } = require('../src/db');

let server;
let baseUrl;

function createSession() {
  const db = getDb();
  const sessionId = Number(db.prepare(`
    INSERT INTO sessions (name, total_assets, total_scenes)
    VALUES ('Hardening test', 3, 1)
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO scenes (session_id, scene_index, asset_ids)
    VALUES (?, 0, ?)
  `).run(sessionId, JSON.stringify([
    { id: 'asset-1', ownerId: 'user-1' },
    { id: 'asset-2', ownerId: 'user-1' },
    { id: 'asset-3', ownerId: 'user-1' },
  ]));
  db.prepare(`
    INSERT INTO decisions (session_id, asset_id, decision)
    VALUES (?, 'asset-1', 'reject')
  `).run(sessionId);
  db.prepare(`
    INSERT INTO ratings (session_id, asset_id, rating)
    VALUES (?, 'asset-2', 4)
  `).run(sessionId);
  db.prepare(`
    INSERT INTO stack_groups (session_id, asset_ids)
    VALUES (?, ?)
  `).run(sessionId, JSON.stringify(['asset-2', 'asset-3']));
  return sessionId;
}

async function postCommit(sessionId, body, dryRun = false) {
  const response = await nativeFetch(
    `${baseUrl}/api/sessions/${sessionId}/commit${dryRun ? '?dryRun=true' : ''}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return { response, body: await response.json() };
}

test.before(async () => {
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  global.fetch = nativeFetch;
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  calls.length = 0;
  ratingFailuresRemaining = 0;
  trashFailures.clear();
  assetInfoOwners.clear();
});

test('dry-run previews actions without mutating Immich or writing commit history', async () => {
  const sessionId = createSession();
  const options = {
    trashRejects: true,
    writeRatings: true,
    createStacks: true,
    uploadEdits: false,
  };

  const { response, body } = await postCommit(sessionId, options, true);

  assert.equal(response.status, 200);
  assert.equal(body.dryRun, true);
  assert.equal(body.pendingActions, 3);
  assert.equal(body.alreadyAppliedActions, 0);
  assert.equal(body.warnings.length, 1);
  assert.deepEqual(
    calls.map(call => ({ method: call.method, path: new URL(call.href).pathname })),
    [{ method: 'GET', path: '/api/users/me' }]
  );
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS count FROM commit_runs').get().count,
    0
  );
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS count FROM commit_actions').get().count,
    0
  );
});

test('partial failure is durable and retry sends only unfinished actions', async () => {
  const sessionId = createSession();
  const options = {
    trashRejects: true,
    writeRatings: true,
    createStacks: true,
    uploadEdits: false,
  };
  ratingFailuresRemaining = 1;

  const first = await postCommit(sessionId, options);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.committed, false);
  assert.equal(first.body.assetsTrashed, 1);
  assert.equal(first.body.ratingsWritten, 0);
  assert.equal(first.body.stacksCreated, 1);
  assert.equal(first.body.errors.length, 1);

  calls.length = 0;
  const preview = await postCommit(sessionId, options, true);
  assert.equal(preview.body.pendingActions, 1);
  assert.equal(preview.body.alreadyAppliedActions, 2);
  assert.deepEqual(
    calls.map(call => ({ method: call.method, path: new URL(call.href).pathname })),
    [{ method: 'GET', path: '/api/users/me' }]
  );

  const second = await postCommit(sessionId, options);
  assert.equal(second.body.committed, true);
  assert.equal(second.body.assetsTrashed, 0);
  assert.equal(second.body.ratingsWritten, 1);
  assert.equal(second.body.stacksCreated, 0);
  assert.deepEqual(second.body.errors, []);
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 0);
  assert.equal(calls.filter(call => call.href.endsWith('/api/stacks')).length, 0);
  assert.equal(calls.filter(call => call.href.endsWith('/api/assets/asset-2')).length, 1);

  const actions = getDb().prepare(`
    SELECT action_type, status, attempts
    FROM commit_actions
    WHERE session_id = ?
    ORDER BY action_type
  `).all(sessionId);
  assert.deepEqual(actions, [
    { action_type: 'rating', status: 'succeeded', attempts: 2 },
    { action_type: 'stack', status: 'succeeded', attempts: 1 },
    { action_type: 'trash', status: 'succeeded', attempts: 1 },
  ]);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS count FROM commit_runs WHERE session_id = ?')
      .get(sessionId).count,
    2
  );
});

test('trash rejects are checkpointed independently when one asset fails', async () => {
  const sessionId = createSession();
  const db = getDb();
  db.prepare(`
    INSERT INTO decisions (session_id, asset_id, decision)
    VALUES (?, 'asset-4', 'reject')
  `).run(sessionId);
  trashFailures.add('asset-4');
  const options = {
    trashRejects: true,
    writeRatings: false,
    createStacks: false,
    uploadEdits: false,
  };

  const first = await postCommit(sessionId, options);
  assert.equal(first.body.committed, false);
  assert.equal(first.body.assetsTrashed, 1);
  assert.equal(first.body.steps.find(step => step.id === 'trash').succeeded, 1);
  assert.equal(first.body.steps.find(step => step.id === 'trash').failed, 1);
  assert.match(first.body.errors[0], /asset-4/);
  assert.deepEqual(
    calls.filter(call => call.method === 'DELETE').map(call => JSON.parse(call.body).ids),
    [['asset-1'], ['asset-4']]
  );

  calls.length = 0;
  const preview = await postCommit(sessionId, options, true);
  assert.equal(preview.body.pendingActions, 1);
  assert.equal(preview.body.alreadyAppliedActions, 1);

  const second = await postCommit(sessionId, options);
  assert.equal(second.body.committed, true);
  assert.equal(second.body.assetsTrashed, 1);
  assert.deepEqual(
    calls.filter(call => call.method === 'DELETE').map(call => JSON.parse(call.body).ids),
    [['asset-4']]
  );
});

test('orphaned running commit attempts are marked interrupted before retry', async () => {
  const sessionId = createSession();
  const db = getDb();
  const orphanId = Number(db.prepare(`
    INSERT INTO commit_runs (session_id, status, options)
    VALUES (?, 'running', '{}')
  `).run(sessionId).lastInsertRowid);

  const result = await postCommit(sessionId, {
    trashRejects: false,
    writeRatings: false,
    createStacks: false,
    uploadEdits: false,
  });
  assert.equal(result.body.committed, true);

  const orphan = db.prepare(`
    SELECT status, result, completed_at
    FROM commit_runs
    WHERE id = ?
  `).get(orphanId);
  assert.equal(orphan.status, 'interrupted');
  assert.match(orphan.result, /restarted/);
  assert.ok(orphan.completed_at);
});

test('already committed responses retain the normal preview envelope', async () => {
  const sessionId = createSession();
  const db = getDb();
  db.prepare('UPDATE sessions SET committed = 1 WHERE id = ?').run(sessionId);

  const result = await postCommit(sessionId, {}, true);
  assert.equal(result.body.committed, true);
  assert.deepEqual(result.body.warnings, []);
  assert.deepEqual(result.body.items, { rejects: [], ratings: [], stacks: [], edits: [] });
});

test('mixed-owner sessions are rejected before any Immich mutation', async () => {
  const sessionId = createSession();
  const db = getDb();
  const scene = db.prepare(
    'SELECT id, asset_ids FROM scenes WHERE session_id = ?'
  ).get(sessionId);
  const assets = JSON.parse(scene.asset_ids);
  assets[1].ownerId = 'partner-user';
  db.prepare('UPDATE scenes SET asset_ids = ? WHERE id = ?')
    .run(JSON.stringify(assets), scene.id);
  calls.length = 0;

  const result = await postCommit(sessionId, {
    trashRejects: true,
    writeRatings: true,
    createStacks: true,
    uploadEdits: false,
  }, true);

  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'session_contains_unwritable_assets');
  assert.equal(result.body.partnerAssetCount, 1);
  assert.match(result.body.error, /Start a new session/);
  assert.deepEqual(
    calls.map(call => `${call.method} ${call.href}`),
    ['GET http://immich.test/api/users/me']
  );
});

test('legacy sessions resolve missing owner metadata through Immich', async () => {
  const sessionId = createSession();
  const db = getDb();
  const scene = db.prepare(
    'SELECT id, asset_ids FROM scenes WHERE session_id = ?'
  ).get(sessionId);
  const assets = JSON.parse(scene.asset_ids);
  delete assets[1].ownerId;
  db.prepare('UPDATE scenes SET asset_ids = ? WHERE id = ?')
    .run(JSON.stringify(assets), scene.id);
  assetInfoOwners.set('asset-2', 'partner-user');
  calls.length = 0;

  const result = await postCommit(sessionId, {
    trashRejects: true,
    writeRatings: true,
    createStacks: true,
    uploadEdits: false,
  }, true);

  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'session_contains_unwritable_assets');
  assert.equal(result.body.partnerAssetCount, 1);
  assert.equal(result.body.unavailableAssetCount, 0);
  assert.deepEqual(
    calls.map(call => `${call.method} ${call.href}`),
    [
      'GET http://immich.test/api/users/me',
      'GET http://immich.test/api/assets/asset-2',
    ]
  );
});

test('commit option types are validated before any work begins', async () => {
  const sessionId = createSession();
  const { response, body } = await postCommit(sessionId, { trashRejects: 'yes' }, true);
  assert.equal(response.status, 400);
  assert.match(body.error, /trashRejects must be a boolean/);
  assert.equal(calls.length, 0);
});
