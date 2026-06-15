const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const {
  decodeHeicBuffer,
  findExecutable,
  getHeicCapability,
  initializeHeicCapability,
  isHeicSource,
  probeHeicCapability,
  resetHeicCapability,
} = require('../src/heic-decoder');

const fixturePath = path.join(__dirname, 'fixtures', 'heic-probe.heic');

test('identifies HEIC from trusted filename or content type', () => {
  assert.equal(isHeicSource({ originalFileName: 'IMG_0001.HEIC' }), true);
  assert.equal(isHeicSource({ contentType: 'image/heif' }), true);
  assert.equal(isHeicSource({ originalFileName: 'photo.jpg', contentType: 'image/jpeg' }), false);
});

test('off capability skips command discovery and fixture reads', async () => {
  let discovered = false;
  let read = false;
  const result = await probeHeicCapability({
    mode: 'off',
    findExecutableImpl() {
      discovered = true;
    },
    readFileImpl() {
      read = true;
    },
  });
  assert.equal(result.mode, 'off');
  assert.equal(result.heicDecode, 'off');
  assert.equal(discovered, false);
  assert.equal(read, false);
});

test('external capability reports a missing decoder without throwing', async () => {
  const result = await probeHeicCapability({
    mode: 'external',
    findExecutableImpl: () => null,
  });
  assert.equal(result.mode, 'external');
  assert.equal(result.heicDecode, 'unavailable');
  assert.match(result.detail, /vips executable/i);
});

test('decode cleans its private temporary directory after command failure', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-heic-test-'));
  try {
    await assert.rejects(
      decodeHeicBuffer(Buffer.from('not-an-image'), {
        command: '/usr/bin/vips',
        tempRoot,
        execFileImpl: async () => {
          throw new Error('decoder exploded');
        },
      }),
      /decoder exploded/
    );
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('decode returns a readable TIFF and removes temporary files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'photodesk-heic-test-'));
  const tiff = await sharp({
    create: { width: 7, height: 5, channels: 3, background: '#4477aa' },
  }).tiff().toBuffer();
  try {
    const result = await decodeHeicBuffer(Buffer.from('fake-heic'), {
      command: '/usr/bin/vips',
      tempRoot,
      execFileImpl: async (_command, args) => {
        await fs.promises.writeFile(args[2], tiff);
      },
    });
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.format, 'tiff');
    assert.equal(metadata.width, 7);
    assert.equal(metadata.height, 5);
    assert.deepEqual(fs.readdirSync(tempRoot), []);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('standalone vips does not inherit Sharp bundled VIPSHOME', async () => {
  const previous = process.env.VIPSHOME;
  process.env.VIPSHOME = '/bundled/sharp/libvips';
  try {
    await decodeHeicBuffer(Buffer.from('fake-heic'), {
      command: '/usr/bin/vips',
      execFileImpl: async (_command, args, options) => {
        assert.equal(options.env.VIPSHOME, undefined);
        await fs.promises.writeFile(args[2], await sharp({
          create: { width: 2, height: 2, channels: 3, background: '#000' },
        }).tiff().toBuffer());
      },
    });
  } finally {
    if (previous === undefined) delete process.env.VIPSHOME;
    else process.env.VIPSHOME = previous;
  }
});

test('process capability state caches the latest non-throwing probe result', async () => {
  resetHeicCapability();
  const warnings = [];
  const result = await initializeHeicCapability({
    mode: 'external',
    findExecutableImpl: () => null,
    logger: { warn: message => warnings.push(message) },
  });
  assert.equal(result.heicDecode, 'unavailable');
  assert.deepEqual(getHeicCapability(), result);
  assert.equal(warnings.length, 1);
  resetHeicCapability();
});

test('local Homebrew/system vips decodes the committed HEVC fixture when available', {
  skip: !findExecutable('vips'),
}, async () => {
  const result = await probeHeicCapability({
    mode: 'external',
    decoderCommand: findExecutable('vips'),
    fixturePath,
  });
  assert.equal(result.heicDecode, 'available');
});
