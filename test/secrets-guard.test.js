const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertNoSecrets,
  sanitizeForLog,
  sanitizeString,
} = require('../src/secrets-guard');

test('redacts per-profile credentials from strings and structured logs', () => {
  const profileKey = 'profile-secret-key';
  assert.equal(
    sanitizeString(`Immich rejected ${profileKey}`, [profileKey]),
    'Immich rejected [REDACTED]'
  );
  assert.deepEqual(
    sanitizeForLog({
      immich_api_key: profileKey,
      nested: { message: `failed for ${profileKey}` },
    }, [profileKey]),
    {
      immich_api_key: '[REDACTED]',
      nested: { message: 'failed for [REDACTED]' },
    }
  );
});

test('rejects query results that accidentally include secret columns', () => {
  assert.throws(
    () => assertNoSecrets([{ id: 1, immich_api_key: 'secret' }]),
    /forbidden column/
  );
  assert.doesNotThrow(() => assertNoSecrets([{ id: 1, display_name: 'Parent' }]));
});
