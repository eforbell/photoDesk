require('dotenv').config();
const path = require('path');

const config = {
  immichUrl: process.env.IMMICH_URL || 'http://localhost:2283',
  immichApiKey: process.env.IMMICH_API_KEY || '',
  port: parseInt(process.env.PORT || '3400', 10),
  timezone: process.env.TZ || 'America/New_York',
  editDir: path.resolve(process.env.PHOTODESK_EDIT_DIR || path.join(__dirname, '..', 'var', 'edits')),
};

process.env.TZ = config.timezone;

module.exports = config;
