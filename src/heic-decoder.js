const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const config = require('./config');

const execFileAsync = promisify(execFile);
const defaultFixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'heic-probe.heic');
const DEFAULT_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;
let decodeQueue = Promise.resolve();

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
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  signal,
} = {}) {
  if (!command) throw new Error('HEIC decoder command is unavailable');
  if (input.length > maxSourceBytes) {
    throw new Error(`HEIC source exceeds the ${maxSourceBytes}-byte safety limit`);
  }
  const previous = decodeQueue;
  let release;
  decodeQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    signal?.throwIfAborted();
    const workDir = await fs.promises.mkdtemp(path.join(tempRoot, 'photodesk-heic-'));
    const inputPath = path.join(workDir, 'source.heic');
    const outputPath = path.join(workDir, 'decoded.tif');
    try {
      await fs.promises.writeFile(inputPath, input);
      try {
        const childEnv = {
          ...process.env,
          VIPS_CONCURRENCY: '1',
          VIPS_DISC_THRESHOLD: String(Math.min(maxOutputBytes, 64 * 1024 * 1024)),
        };
        delete childEnv.VIPSHOME;
        await execFileImpl(command, [
          'heifload',
          inputPath,
          outputPath,
          '--unlimited',
        ], {
          env: childEnv,
          signal,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024,
          windowsHide: true,
        });
      } catch (err) {
        throw new Error(`External HEIC decode failed: ${decoderError(err)}`);
      }
      const output = await fs.promises.stat(outputPath);
      if (output.size > maxOutputBytes) {
        throw new Error(`Decoded HEIC output exceeds the ${maxOutputBytes}-byte safety limit`);
      }
      return await fs.promises.readFile(outputPath);
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    }
  } finally {
    release();
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
  return baseCapability('off');
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
