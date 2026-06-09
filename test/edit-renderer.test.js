const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  pixelCrop,
  renderEditBuffer,
  safeEditPath,
  sharpCapabilities,
  writeRenderedEdit,
} = require('../src/edit-renderer');

const NEUTRAL = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temp: 0,
  saturation: 0,
  vibrance: 0,
  vignette: 0,
};

test('converts normalized crops into bounded pixel regions', () => {
  assert.deepEqual(
    pixelCrop({ x: 0.25, y: 0, width: 0.5, height: 1 }, 400, 300),
    { left: 100, top: 0, width: 200, height: 300 }
  );
  assert.deepEqual(
    pixelCrop({ x: 0.999, y: 0.999, width: 0.5, height: 0.5 }, 400, 300),
    { left: 399, top: 299, width: 1, height: 1 }
  );
});

test('renders deterministic JPEG dimensions from a crop recipe', async () => {
  const input = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: '#5b7fa3',
    },
  }).jpeg().toBuffer();

  const result = await renderEditBuffer(input, {
    ...NEUTRAL,
    exposure: 20,
    contrast: 10,
    temp: 15,
    vignette: 25,
  }, {
    aspect: '1:1',
    x: 0.125,
    y: 0,
    width: 0.75,
    height: 1,
  });

  assert.equal(result.info.format, 'jpeg');
  assert.equal(result.info.width, 300);
  assert.equal(result.info.height, 300);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.orientation, 1);
});

test('writes rendered files atomically inside the configured edit directory', async () => {
  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-edits-'));
  try {
    const input = await sharp({
      create: {
        width: 80,
        height: 60,
        channels: 3,
        background: '#cb6f45',
      },
    }).png().toBuffer();
    const result = await writeRenderedEdit({
      input,
      adjustments: NEUTRAL,
      crop: { aspect: 'Original', x: 0, y: 0, width: 1, height: 1 },
      editDir,
      sessionId: 12,
      assetId: 'asset-abc',
    });

    assert.match(
      result.relativePath,
      new RegExp(`^12${path.sep}asset-abc-[0-9a-f-]+\\.jpg$`)
    );
    assert.ok(fs.existsSync(path.join(editDir, result.relativePath)));
    assert.deepEqual(fs.readdirSync(path.join(editDir, '12')), [
      path.basename(result.relativePath),
    ]);
  } finally {
    fs.rmSync(editDir, { recursive: true, force: true });
  }
});

test('removes temporary files when the final rename fails', async () => {
  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-edits-'));
  const originalRename = fs.promises.rename;
  try {
    const input = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: '#24384a',
      },
    }).jpeg().toBuffer();
    fs.promises.rename = async () => {
      throw new Error('rename failed');
    };

    await assert.rejects(writeRenderedEdit({
      input,
      adjustments: NEUTRAL,
      crop: { aspect: 'Original', x: 0, y: 0, width: 1, height: 1 },
      editDir,
      sessionId: 12,
      assetId: 'asset-abc',
    }));
    assert.deepEqual(fs.readdirSync(path.join(editDir, '12')), []);
  } finally {
    fs.promises.rename = originalRename;
    fs.rmSync(editDir, { recursive: true, force: true });
  }
});

test('removes a new version if directory sync fails after rename', async () => {
  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-edits-'));
  const originalOpen = fs.promises.open;
  try {
    const sessionDir = path.join(editDir, '12');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'previous.jpg'), 'previous');
    const input = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: '#24384a',
      },
    }).jpeg().toBuffer();
    let openCount = 0;
    fs.promises.open = async (...args) => {
      openCount++;
      if (openCount === 2) {
        return {
          async sync() { throw new Error('directory sync failed'); },
          async close() {},
        };
      }
      return originalOpen(...args);
    };

    await assert.rejects(writeRenderedEdit({
      input,
      adjustments: NEUTRAL,
      crop: { aspect: 'Original', x: 0, y: 0, width: 1, height: 1 },
      editDir,
      sessionId: 12,
      assetId: 'asset-abc',
    }), /directory sync failed/);
    assert.deepEqual(fs.readdirSync(sessionDir), ['previous.jpg']);
    assert.equal(fs.readFileSync(path.join(sessionDir, 'previous.jpg'), 'utf8'), 'previous');
  } finally {
    fs.promises.open = originalOpen;
    fs.rmSync(editDir, { recursive: true, force: true });
  }
});

test('rejects rendered paths outside the configured directory', () => {
  assert.throws(
    () => safeEditPath('/tmp/photodesk-edits', '../outside.jpg'),
    /escapes PHOTODESK_EDIT_DIR/
  );
});

test('reports the image codec capabilities of the installed sharp build', () => {
  const capabilities = sharpCapabilities();
  assert.match(capabilities.sharpVersion, /^\d+\.\d+\.\d+/);
  assert.equal(typeof capabilities.heifDecoder, 'boolean');
  assert.equal(typeof capabilities.heicGuaranteed, 'boolean');
});
