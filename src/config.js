require('dotenv').config();
const path = require('path');

const HEIC_DECODE_MODES = new Set(['off', 'external', 'libvips']);

function parseHeicDecodeMode(value, warn = message => console.warn(message)) {
  const mode = String(value || 'off').trim().toLowerCase();
  if (HEIC_DECODE_MODES.has(mode)) return mode;
  warn(`[config] Unknown PHOTODESK_HEIC_DECODE value "${value}"; HEIC decoding is off.`);
  return 'off';
}

const config = {
  immichUrl: process.env.IMMICH_URL || 'http://localhost:2283',
  immichApiKey: process.env.IMMICH_API_KEY || '',
  port: parseInt(process.env.PORT || '3400', 10),
  timezone: process.env.TZ || 'America/New_York',
  editDir: path.resolve(process.env.PHOTODESK_EDIT_DIR || path.join(__dirname, '..', 'var', 'edits')),
  heicDecodeMode: parseHeicDecodeMode(process.env.PHOTODESK_HEIC_DECODE),
  heicDecoderCommand: process.env.PHOTODESK_HEIC_DECODER_CMD || '',
};

process.env.TZ = config.timezone;

module.exports = Object.assign(config, {
  parseHeicDecodeMode,
});
