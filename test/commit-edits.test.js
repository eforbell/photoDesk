const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-commit-edits-'));
process.env.PHOTODESK_DB_PATH = path.join(tempDir, 'test.db');
process.env.PHOTODESK_EDIT_DIR = path.join(tempDir, 'edits');
process.env.IMMICH_URL = 'http://immich.test';
process.env.IMMICH_API_KEY = 'test-key';

const nativeFetch = global.fetch;
const immichCalls = [];
let stackFailuresRemaining = 0;
let originalStack = null;
let remoteEditedExists = false;

global.fetch = async (url, options = {}) => {
  const href = String(url);
  if (!href.startsWith('http://immich.test/')) return nativeFetch(url, options);

  immichCalls.push({ href, method: options.method || 'GET', body: options.body });
  if (href.endsWith('/api/assets') && options.method === 'POST') {
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('deviceId'), 'photodesk');
    assert.equal(options.body.get('filename'), 'IMG_0001-photodesk.jpg');
    remoteEditedExists = true;
    return Response.json({ id: 'edited-asset-1', status: 'created' }, { status: 201 });
  }
  if (href.endsWith('/api/assets/asset-1')) {
    return Response.json({ id: 'asset-1', stack: originalStack });
  }
  if (href.endsWith('/api/assets/edited-asset-1')) {
    return remoteEditedExists
      ? Response.json({ id: 'edited-asset-1' })
      : Response.json({ message: 'not found' }, { status: 404 });
  }
  if (href.endsWith('/api/stacks') && options.method === 'POST') {
    if (stackFailuresRemaining > 0) {
      stackFailuresRemaining--;
      return Response.json({ message: 'temporary stack failure' }, { status: 500 });
    }
    assert.deepEqual(JSON.parse(options.body), {
      assetIds: ['asset-1', 'edited-asset-1'],
    });
    return Response.json({
      id: 'stack-1',
      primaryAssetId: 'asset-1',
      assets: [],
    }, { status: 201 });
  }
  if (href.endsWith('/api/assets/copy') && options.method === 'PUT') {
    assert.deepEqual(JSON.parse(options.body), {
      sourceId: 'asset-1',
      targetId: 'edited-asset-1',
      stack: true,
    });
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected Immich request: ${options.method || 'GET'} ${href}`);
};

const app = require('../src/app');
const { getDb } = require('../src/db');

let server;
let baseUrl;

function createReadySession(name) {
  const db = getDb();
  const sessionId = Number(db.prepare(`
    INSERT INTO sessions (name, total_assets, total_scenes)
    VALUES (?, 1, 1)
  `).run(name).lastInsertRowid);
  db.prepare(`
    INSERT INTO scenes (session_id, scene_index, asset_ids)
    VALUES (?, 0, ?)
  `).run(sessionId, JSON.stringify([{
    id: 'asset-1',
    originalFileName: 'IMG_0001.HEIC',
    fileCreatedAt: '2026-06-01T14:30:00.000Z',
    width: 4000,
    height: 3000,
  }]));
  const relativePath = `${sessionId}/asset-1/edit.jpg`;
  const fullPath = path.join(process.env.PHOTODESK_EDIT_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, 'rendered jpeg');
  db.prepare(`
    INSERT INTO edits (
      session_id, asset_id, adjustments, crop, rendered_path, render_status, updated_at
    ) VALUES (?, 'asset-1', '{}', '{}', ?, 'ready', '2026-06-09T10:00:00.000Z')
  `).run(sessionId, relativePath);
  return sessionId;
}

async function commit(sessionId) {
  const response = await nativeFetch(`${baseUrl}/api/sessions/${sessionId}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trashRejects: false,
      writeRatings: false,
      createStacks: false,
      uploadEdits: true,
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
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
  immichCalls.length = 0;
  stackFailuresRemaining = 0;
  originalStack = null;
  remoteEditedExists = false;
});

test('persists the uploaded asset ID and retries stacking without a duplicate upload', async () => {
  const sessionId = createReadySession('Retry upload');
  stackFailuresRemaining = 1;

  const first = await commit(sessionId);
  assert.equal(first.committed, false);
  assert.equal(first.editsUploaded, 0);
  assert.equal(first.errors.length, 1);

  const db = getDb();
  const afterFailure = db.prepare(
    'SELECT render_status, render_error, immich_asset_id FROM edits WHERE session_id = ?'
  ).get(sessionId);
  assert.equal(afterFailure.render_status, 'ready');
  assert.match(afterFailure.render_error, /temporary stack failure/);
  assert.equal(afterFailure.immich_asset_id, 'edited-asset-1');
  assert.equal(db.prepare('SELECT committed FROM sessions WHERE id = ?').get(sessionId).committed, 0);

  const second = await commit(sessionId);
  assert.equal(second.committed, true);
  assert.equal(second.editsUploaded, 1);
  assert.deepEqual(second.errors, []);

  const afterRetry = db.prepare(
    'SELECT render_status, render_error, immich_asset_id FROM edits WHERE session_id = ?'
  ).get(sessionId);
  assert.equal(afterRetry.render_status, 'uploaded');
  assert.equal(afterRetry.render_error, null);
  assert.equal(afterRetry.immich_asset_id, 'edited-asset-1');
  assert.equal(
    immichCalls.filter(call => call.href.endsWith('/api/assets') && call.method === 'POST').length,
    1
  );
  assert.equal(
    immichCalls.filter(call => call.href.endsWith('/api/stacks') && call.method === 'POST').length,
    2
  );
});

test('adds an edited asset to the original existing stack', async () => {
  const sessionId = createReadySession('Existing stack');
  originalStack = { id: 'existing-stack', primaryAssetId: 'other-primary' };

  const result = await commit(sessionId);
  assert.equal(result.committed, true);
  assert.equal(result.editsUploaded, 1);
  assert.equal(
    immichCalls.filter(call => call.href.endsWith('/api/assets/copy') && call.method === 'PUT').length,
    1
  );
  assert.equal(
    immichCalls.filter(call => call.href.endsWith('/api/stacks') && call.method === 'POST').length,
    0
  );
});

test('re-uploads when a persisted edited asset no longer exists in Immich', async () => {
  const sessionId = createReadySession('Missing remote edit');
  const db = getDb();
  db.prepare(`
    UPDATE edits
    SET immich_asset_id = 'edited-asset-1',
        render_status = 'uploaded'
    WHERE session_id = ?
  `).run(sessionId);

  const result = await commit(sessionId);
  assert.equal(result.committed, true);
  assert.equal(result.editsUploaded, 1);
  assert.equal(
    immichCalls.filter(call => call.href.endsWith('/api/assets') && call.method === 'POST').length,
    1
  );
  assert.equal(
    db.prepare('SELECT immich_asset_id FROM edits WHERE session_id = ?').get(sessionId).immich_asset_id,
    'edited-asset-1'
  );
});
