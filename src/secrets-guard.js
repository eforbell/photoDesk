'use strict';

const SECRET_ENV_KEYS = ['IMMICH_API_KEY'];

const REDACTED_FIELDS = new Set([
  'immich_api_key',
  'passphrase_hash',
  'token',
  'api_key',
  'apikey',
  'secret',
]);

function getEnvPatterns() {
  const patterns = [];
  for (const key of SECRET_ENV_KEYS) {
    const val = process.env[key];
    if (val && val.length >= 8) {
      patterns.push(val);
    }
  }
  return patterns;
}

function sanitizeString(str, additionalSecrets = []) {
  if (typeof str !== 'string') return str;
  let result = str;
  const patterns = [
    ...getEnvPatterns(),
    ...additionalSecrets.filter(val => typeof val === 'string' && val.length >= 8),
  ];
  for (const val of patterns) {
    if (result.includes(val)) {
      result = result.split(val).join('[REDACTED]');
    }
  }
  return result;
}

function sanitizeForLog(obj, additionalSecrets = []) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj, additionalSecrets);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(value => sanitizeForLog(value, additionalSecrets));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeForLog(value, additionalSecrets);
    }
  }
  return result;
}

function assertNoSecrets(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const keys = Object.keys(rows[0]);
  for (const key of keys) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      throw new Error(`SECURITY: query result contains forbidden column "${key}"`);
    }
  }
}

module.exports = { sanitizeString, sanitizeForLog, assertNoSecrets };
