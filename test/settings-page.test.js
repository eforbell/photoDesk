const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const settingsHtml = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'settings.html'),
  'utf8'
);

test('settings API requests are root-relative', () => {
  const requestPaths = [...settingsHtml.matchAll(/request\((['"`])([^'"`]+)\1/g)]
    .map(match => match[2])
    .filter(value => value.includes('api/auth'));

  assert.ok(requestPaths.length > 0);
  assert.ok(
    requestPaths.every(value => value.startsWith('/api/auth')),
    `Expected root-relative auth requests, received: ${requestPaths.join(', ')}`
  );
  assert.doesNotMatch(settingsHtml, /request\((['"`])api\/auth/);
});

test('settings request helper rejects non-JSON fallback pages explicitly', () => {
  assert.match(settingsHtml, /content-type/);
  assert.match(settingsHtml, /PhotoDesk returned an unexpected response/);
});

test('settings profile list uses the public credential status DTO', () => {
  assert.match(settingsHtml, /profile\.displayName/);
  assert.match(settingsHtml, /profile\.immichConnected/);
  assert.doesNotMatch(settingsHtml, /profile\.display_name/);
  assert.doesNotMatch(settingsHtml, /profile\.immich_connected/);
});
