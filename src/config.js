require('dotenv').config();
const path = require('path');

const HEIC_DECODE_MODES = new Set(['off', 'external']);

function parseLibraryStartDate(value, warn = message => console.warn(message)) {
  if (value === undefined || value === '') return null;
  const date = String(value).trim();
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(timestamp)
    && new Date(timestamp).toISOString().slice(0, 10) === date) return date;
  warn(`[config] Invalid PHOTODESK_LIBRARY_START_DATE value "${value}"; no library discovery floor will be applied.`);
  return null;
}

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
  libraryStartDate: parseLibraryStartDate(process.env.PHOTODESK_LIBRARY_START_DATE),
  heicDecodeMode: parseHeicDecodeMode(process.env.PHOTODESK_HEIC_DECODE),
  heicDecoderCommand: process.env.PHOTODESK_HEIC_DECODER_CMD || '',
};

process.env.TZ = config.timezone;

module.exports = Object.assign(config, {
  parseHeicDecodeMode,
  parseLibraryStartDate,
});
