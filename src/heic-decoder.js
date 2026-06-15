const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const config = require('./config');

const execFileAsync = promisify(execFile);
const defaultFixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'heic-probe.heic');

function baseCapability(mode = config.heicDecodeMode) {
  return {
    mode,
    decoder: null,
    heicDecode: mode === 'off' ? 'off' : 'unavailable',
    detail: mode === 'off' ? null : 'HEIC capability has not been checked.',
  };
}

let capability = baseCapability();

function isHeicSource({ originalFileName = '', contentType = '' } = {}) {
  return /\.hei[cf]$/i.test(originalFileName)
    || /^image\/hei[cf]$/i.test(contentType);
}

function executableExists(candidate) {
  if (!candidate) return false;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findExecutable(name, envPath = process.env.PATH || '') {
  if (path.isAbsolute(name)) return executableExists(name) ? name : null;
  for (const directory of envPath.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (executableExists(candidate)) return candidate;
  }
  return null;
}

function resolveExternalDecoder(configuredCommand, findExecutableImpl = findExecutable) {
  if (configuredCommand) {
    if (!path.isAbsolute(configuredCommand)) {
      return {
        command: null,
        detail: 'PHOTODESK_HEIC_DECODER_CMD must be an absolute executable path.',
      };
    }
    const command = findExecutableImpl(configuredCommand);
    return command
      ? { command, detail: null }
      : {
          command: null,
          detail: `Configured HEIC decoder is not executable: ${configuredCommand}`,
        };
  }
  const command = findExecutableImpl('vips');
  return command
    ? { command, detail: null }
    : {
        command: null,
        detail: 'External HEIC mode requires the vips executable. See planning/database-and-deployment.md.',
      };
}

function decoderError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  let detail = stderr || err?.message || 'unknown decoder error';
  detail = detail.replaceAll(process.cwd(), '[app path]');
  return detail
    .replace(/[A-Za-z]:\\(?:[^\\\s:]+\\)*[^\\\s:]*/g, '[local path]')
    .replace(/\/(?:[^/\s:]+\/)*[^/\s:]*/g, '[local path]')
    .slice(0, 500);
}

async function decodeHeicBuffer(input, {
  command,
  tempRoot = os.tmpdir(),
  execFileImpl = execFileAsync,
  timeoutMs = 30_000,
} = {}) {
  if (!command) throw new Error('HEIC decoder command is unavailable');
  const workDir = await fs.promises.mkdtemp(path.join(tempRoot, 'photodesk-heic-'));
  const inputPath = path.join(workDir, 'source.heic');
  const outputPath = path.join(workDir, 'decoded.tif');
  try {
    await fs.promises.writeFile(inputPath, input);
    try {
      // sharp's bundled libvips sets VIPSHOME in the parent process. Passing
      // that value to the standalone system vips binary can make it load the
      // bundled plugin directory instead of its own codecs.
      const childEnv = { ...process.env };
      delete childEnv.VIPSHOME;
      // Immich originals are authenticated, trusted household assets. Modern
      // tiled iPhone HEICs can exceed libheif's default item-reference limit,
      // so use the loader-specific trusted-input override rather than `copy`.
      await execFileImpl(command, [
        'heifload',
        inputPath,
        outputPath,
        '--unlimited',
      ], {
        env: childEnv,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        windowsHide: true,
      });
    } catch (err) {
      throw new Error(`External HEIC decode failed: ${decoderError(err)}`);
    }
    return await fs.promises.readFile(outputPath);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
}

async function probeHeicCapability({
  mode = config.heicDecodeMode,
  decoderCommand = config.heicDecoderCommand,
  fixturePath = defaultFixturePath,
  findExecutableImpl = findExecutable,
  readFileImpl = fs.promises.readFile,
  execFileImpl = execFileAsync,
} = {}) {
  if (mode === 'off') return baseCapability('off');

  if (mode === 'external') {
    const resolved = resolveExternalDecoder(decoderCommand, findExecutableImpl);
    if (!resolved.command) {
      return {
        mode,
        decoder: null,
        heicDecode: 'unavailable',
        detail: resolved.detail,
      };
    }
    try {
      const fixture = await readFileImpl(fixturePath);
      const decoded = await decodeHeicBuffer(fixture, {
        command: resolved.command,
        execFileImpl,
      });
      const metadata = await sharp(decoded).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error('decoded fixture dimensions are unavailable');
      }
      return {
        mode,
        decoder: resolved.command,
        heicDecode: 'available',
        detail: null,
      };
    } catch (err) {
      return {
        mode,
        decoder: resolved.command,
        heicDecode: 'unavailable',
        detail: `HEIC fixture decode failed: ${decoderError(err)}`,
      };
    }
  }

  try {
    const fixture = await readFileImpl(fixturePath);
    const metadata = await sharp(fixture).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('decoded fixture dimensions are unavailable');
    }
    return {
      mode: 'libvips',
      decoder: 'sharp',
      heicDecode: 'available',
      detail: null,
    };
  } catch (err) {
    return {
      mode: 'libvips',
      decoder: 'sharp',
      heicDecode: 'unavailable',
      detail: `Sharp/libvips HEIC fixture decode failed: ${decoderError(err)}`,
    };
  }
}

async function initializeHeicCapability(options = {}) {
  capability = await probeHeicCapability(options);
  const logger = options.logger || console;
  if (capability.heicDecode === 'unavailable') {
    logger.warn(`[heic] ${capability.detail}`);
  }
  return capability;
}

function getHeicCapability() {
  return { ...capability };
}

function resetHeicCapability() {
  capability = baseCapability();
}

module.exports = {
  decodeHeicBuffer,
  findExecutable,
  getHeicCapability,
  initializeHeicCapability,
  isHeicSource,
  probeHeicCapability,
  resetHeicCapability,
  resolveExternalDecoder,
};
