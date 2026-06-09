const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-edit-api-'));
process.env.PHOTODESK_DB_PATH = path.join(tempDir, 'test.db');
process.env.PHOTODESK_EDIT_DIR = path.join(tempDir, 'edits');
process.env.IMMICH_URL = 'http://immich.test';
process.env.IMMICH_API_KEY = 'test-key';

const nativeFetch = global.fetch;
let originalResponse;
let originalFailure;
let originalHandler;
global.fetch = async (url, options) => {
  if (String(url).startsWith('http://immich.test/')) {
    if (originalHandler) return originalHandler(url, options);
    if (originalFailure) throw originalFailure;
    return new Response(originalResponse, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  }
  return nativeFetch(url, options);
};

const app = require('../src/app');
const { getDb } = require('../src/db');

let server;
let baseUrl;

test.before(async () => {
  originalResponse = await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: '#3c6d55',
    },
  }).jpeg().toBuffer();

  const db = getDb();
  const sessionId = db.prepare(`
    INSERT INTO sessions (name, total_assets, total_scenes)
    VALUES ('Render test', 1, 1)
  `).run().lastInsertRowid;
  db.prepare(`
    INSERT INTO scenes (session_id, scene_index, asset_ids)
    VALUES (?, 0, ?)
  `).run(sessionId, JSON.stringify([{
    id: 'asset-1',
    originalFileName: 'asset-1.jpg',
    width: 320,
    height: 240,
  }]));

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

test('edit API renders, serves, and removes a durable derivative', async () => {
  const response = await nativeFetch(`${baseUrl}/api/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 1,
      assetId: 'asset-1',
      adjustments: { exposure: 15, saturation: 10 },
      crop: { aspect: '1:1', x: 0.125, y: 0, width: 0.75, height: 1 },
    }),
  });
  assert.equal(response.status, 200);
  const edit = await response.json();
  assert.equal(edit.render_status, 'ready');
  assert.equal(edit.render_error, null);
  assert.ok(fs.existsSync(path.join(process.env.PHOTODESK_EDIT_DIR, edit.rendered_path)));

  const imageResponse = await nativeFetch(`${baseUrl}/api/edits/1/asset-1/image`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
  const metadata = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
  assert.equal(metadata.width, 240);
  assert.equal(metadata.height, 240);

  const deleteResponse = await nativeFetch(`${baseUrl}/api/edits`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 1, assetId: 'asset-1' }),
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal(fs.existsSync(path.join(process.env.PHOTODESK_EDIT_DIR, edit.rendered_path)), false);
});

test('failed re-renders preserve the previous ready derivative and recipe', async () => {
  originalFailure = null;
  const readyResponse = await nativeFetch(`${baseUrl}/api/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 1,
      assetId: 'asset-1',
      adjustments: { exposure: 5 },
      crop: { aspect: 'Original' },
    }),
  });
  assert.equal(readyResponse.status, 200);
  const readyEdit = await readyResponse.json();
  const renderedFile = path.join(process.env.PHOTODESK_EDIT_DIR, readyEdit.rendered_path);
  const previousBytes = fs.readFileSync(renderedFile);
  assert.ok(fs.existsSync(renderedFile));

  originalFailure = new Error('decoder unavailable');
  const response = await nativeFetch(`${baseUrl}/api/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 1,
      assetId: 'asset-1',
      adjustments: { contrast: 25 },
      crop: { aspect: 'Original' },
    }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.edit.render_status, 'ready');
  assert.match(body.edit.render_error, /decoder unavailable/);
  assert.equal(body.edit.rendered_path, readyEdit.rendered_path);
  assert.equal(body.edit.adjustments.exposure, 5);
  assert.deepEqual(fs.readFileSync(renderedFile), previousBytes);
});

test('database update failure preserves the previous pointer, recipe, and bytes', async () => {
  originalFailure = null;
  originalHandler = null;
  const db = getDb();
  const previous = db.prepare(
    'SELECT * FROM edits WHERE session_id = 1 AND asset_id = ?'
  ).get('asset-1');
  const previousFile = path.join(process.env.PHOTODESK_EDIT_DIR, previous.rendered_path);
  const previousBytes = fs.readFileSync(previousFile);
  const originalPrepare = db.prepare.bind(db);
  let injected = false;
  db.prepare = sql => {
    if (!injected && String(sql).includes('SET rendered_path = ?')) {
      injected = true;
      throw new Error('database update failed');
    }
    return originalPrepare(sql);
  };

  try {
    const response = await nativeFetch(`${baseUrl}/api/edits`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 1,
        assetId: 'asset-1',
        adjustments: { contrast: 40 },
        crop: { aspect: 'Original' },
      }),
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.match(body.error, /database update failed/);
    assert.equal(body.edit.render_status, 'ready');
    assert.equal(body.edit.rendered_path, previous.rendered_path);
    assert.equal(body.edit.adjustments.exposure, 5);
    assert.deepEqual(fs.readFileSync(previousFile), previousBytes);
    assert.deepEqual(
      fs.readdirSync(path.dirname(previousFile)),
      [path.basename(previousFile)]
    );
  } finally {
    db.prepare = originalPrepare;
  }
});

test('serializes overlapping saves so the final recipe matches the final derivative', async () => {
  originalFailure = null;
  const red = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#ff0000' },
  }).jpeg().toBuffer();
  const blue = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#0000ff' },
  }).jpeg().toBuffer();
  let call = 0;
  originalHandler = async () => {
    const index = call++;
    if (index === 0) await new Promise(resolve => setTimeout(resolve, 50));
    return new Response(index === 0 ? red : blue, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  };

  const save = exposure => nativeFetch(`${baseUrl}/api/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 1,
      assetId: 'asset-1',
      adjustments: { exposure },
      crop: { aspect: 'Original' },
    }),
  });
  const [first, second] = await Promise.all([save(10), save(20)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const finalEdit = await second.json();
  assert.equal(finalEdit.adjustments.exposure, 20);

  const image = await sharp(
    path.join(process.env.PHOTODESK_EDIT_DIR, finalEdit.rendered_path)
  ).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(image.data[2] > image.data[0]);
  originalHandler = null;
});

test('serializes delete behind an active render and leaves no orphan file', async () => {
  let releaseOriginal;
  let originalRequested;
  const requested = new Promise(resolve => { originalRequested = resolve; });
  originalHandler = async () => {
    originalRequested();
    await new Promise(resolve => { releaseOriginal = resolve; });
    return new Response(originalResponse, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    });
  };

  const savePromise = nativeFetch(`${baseUrl}/api/edits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: 1,
      assetId: 'asset-1',
      adjustments: { exposure: 30 },
      crop: { aspect: 'Original' },
    }),
  });
  await requested;
  const deletePromise = nativeFetch(`${baseUrl}/api/edits`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 1, assetId: 'asset-1' }),
  });
  releaseOriginal();

  assert.equal((await savePromise).status, 200);
  assert.equal((await deletePromise).status, 200);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) AS count FROM edits WHERE session_id = 1').get().count,
    0
  );
  const sessionDir = path.join(process.env.PHOTODESK_EDIT_DIR, '1');
  assert.deepEqual(fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir) : [], []);
  originalHandler = null;
});
