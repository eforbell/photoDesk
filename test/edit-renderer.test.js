const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const config = require('../src/config');
const {
  findExecutable,
  initializeHeicCapability,
  resetHeicCapability,
} = require('../src/heic-decoder');
const {
  immichExifMetadata,
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

function splitColorImage(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      const left = x < width / 2;
      pixels[offset] = left ? 240 : 10;
      pixels[offset + 1] = 10;
      pixels[offset + 2] = left ? 10 : 240;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

function quadrantImage(width, height) {
  const pixels = Buffer.alloc(width * height * 3);
  const colors = [
    [240, 10, 10],
    [10, 10, 240],
    [10, 220, 10],
    [230, 210, 10],
  ];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const quadrant = (y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0);
      const offset = (y * width + x) * 3;
      pixels[offset] = colors[quadrant][0];
      pixels[offset + 1] = colors[quadrant][1];
      pixels[offset + 2] = colors[quadrant][2];
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

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

test('renders the selected off-center region rather than a centered crop', async () => {
  const input = await splitColorImage(200, 100).png().toBuffer();
  const result = await renderEditBuffer(input, NEUTRAL, {
    aspect: 'Free',
    x: 0.5,
    y: 0,
    width: 0.5,
    height: 1,
  });
  assert.equal(result.info.width, 100);
  assert.equal(result.info.height, 100);
  const stats = await sharp(result.data).stats();
  assert.ok(stats.channels[2].mean > 220);
  assert.ok(stats.channels[0].mean < 30);
});

test('renders an arbitrary Free crop from an off-center portrait region', async () => {
  const input = await quadrantImage(100, 200).png().toBuffer();
  const result = await renderEditBuffer(input, NEUTRAL, {
    aspect: 'Free',
    x: 0,
    y: 0.5,
    width: 0.5,
    height: 0.5,
  });
  assert.equal(result.info.width, 50);
  assert.equal(result.info.height, 100);
  const stats = await sharp(result.data).stats();
  assert.ok(stats.channels[1].mean > 190);
  assert.ok(stats.channels[0].mean < 35);
  assert.ok(stats.channels[2].mean < 35);
});

test('applies off-center crop coordinates after EXIF auto-orientation', async () => {
  const input = await splitColorImage(120, 80)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await renderEditBuffer(input, NEUTRAL, {
    aspect: 'Free',
    x: 0,
    y: 0,
    width: 1,
    height: 0.5,
  });
  assert.equal(result.info.width, 80);
  assert.equal(result.info.height, 60);
  const stats = await sharp(result.data).stats();
  assert.ok(stats.channels[0].mean > 220);
  assert.ok(stats.channels[2].mean < 30);
});

test('can skip orientation when an external decoder already oriented the pixels', async () => {
  const input = await splitColorImage(120, 80)
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await renderEditBuffer(input, NEUTRAL, {
    aspect: 'Original',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  }, {
    inputAlreadyOriented: true,
  });
  assert.equal(result.info.width, 120);
  assert.equal(result.info.height, 80);
  const metadata = await sharp(result.data).metadata();
  assert.equal(metadata.orientation, 1);
});

test('maps Immich capture time and decimal GPS into writable EXIF values', () => {
  assert.deepEqual(immichExifMetadata({
    exifInfo: {
      dateTimeOriginal: '2026-06-15T14:30:45.000Z',
      latitude: 40.5,
      longitude: -73.25,
    },
  }), {
    IFD2: {
      DateTimeOriginal: '2026:06:15 14:30:45',
    },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '40/1 30/1 0/10000',
      GPSLongitudeRef: 'W',
      GPSLongitude: '73/1 15/1 0/10000',
    },
  });
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

test('external mode renders the committed HEVC fixture through system vips', {
  skip: !findExecutable('vips'),
}, async () => {
  const previousMode = config.heicDecodeMode;
  const previousCommand = config.heicDecoderCommand;
  const editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-edits-'));
  try {
    config.heicDecodeMode = 'external';
    config.heicDecoderCommand = findExecutable('vips');
    await initializeHeicCapability({
      mode: 'external',
      decoderCommand: config.heicDecoderCommand,
    });
    const result = await writeRenderedEdit({
      input: fs.readFileSync(path.join(__dirname, 'fixtures', 'heic-probe.heic')),
      adjustments: NEUTRAL,
      crop: { aspect: 'Original', x: 0, y: 0, width: 1, height: 1 },
      editDir,
      sessionId: 12,
      assetId: 'heic-asset',
      source: {
        originalFileName: 'probe.heic',
        contentType: 'image/heic',
        assetInfo: {
          exifInfo: {
            dateTimeOriginal: '2026-06-15T14:30:45.000Z',
          },
        },
      },
    });
    assert.equal(result.width, 32);
    assert.equal(result.height, 24);
    const metadata = await sharp(path.join(editDir, result.relativePath)).metadata();
    assert.equal(metadata.orientation, 1);

    const rotated = await writeRenderedEdit({
      input: fs.readFileSync(
        path.join(__dirname, 'fixtures', 'heic-probe-rotated.heic')
      ),
      adjustments: NEUTRAL,
      crop: { aspect: 'Original', x: 0, y: 0, width: 1, height: 1 },
      editDir,
      sessionId: 12,
      assetId: 'heic-rotated',
      source: {
        originalFileName: 'probe-rotated.heic',
        contentType: 'image/heic',
      },
    });
    assert.equal(rotated.width, 80);
    assert.equal(rotated.height, 120);
    const rotatedMetadata = await sharp(
      path.join(editDir, rotated.relativePath)
    ).metadata();
    assert.equal(rotatedMetadata.orientation, 1);
  } finally {
    config.heicDecodeMode = previousMode;
    config.heicDecoderCommand = previousCommand;
    resetHeicCapability();
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
  assert.equal(capabilities.mode, 'off');
  assert.equal(capabilities.heicDecode, 'off');
});
