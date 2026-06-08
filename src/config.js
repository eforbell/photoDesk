require('dotenv').config();

const config = {
  immichUrl: process.env.IMMICH_URL || 'http://localhost:2283',
  immichApiKey: process.env.IMMICH_API_KEY || '',
  port: parseInt(process.env.PORT || '3400', 10),
};

if (!config.immichApiKey) {
  console.warn('[config] Warning: IMMICH_API_KEY not set. Set it in .env before using the app.');
}

module.exports = config;
