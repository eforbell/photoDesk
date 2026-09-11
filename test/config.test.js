const test = require('node:test');
const assert = require('node:assert/strict');

const { parseHeicDecodeMode } = require('../src/config');

test('HEIC decode mode defaults and fails closed to off', () => {
  assert.equal(parseHeicDecodeMode(undefined), 'off');
  assert.equal(parseHeicDecodeMode(''), 'off');
  assert.equal(parseHeicDecodeMode('off'), 'off');
  assert.equal(parseHeicDecodeMode('EXTERNAL'), 'external');

  const warnings = [];
  assert.equal(parseHeicDecodeMode('libvips', message => warnings.push(message)), 'off');
  assert.equal(parseHeicDecodeMode('unexpected', message => warnings.push(message)), 'off');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /PHOTODESK_HEIC_DECODE/);
});

test('library discovery floor accepts only real YYYY-MM-DD dates', () => {
  const { parseLibraryStartDate } = require('../src/config');
  const warnings = [];

  assert.equal(parseLibraryStartDate(undefined), null);
  assert.equal(parseLibraryStartDate('2024-01-01'), '2024-01-01');
  assert.equal(parseLibraryStartDate('2024-02-30', message => warnings.push(message)), null);
  assert.equal(parseLibraryStartDate('01/01/2024', message => warnings.push(message)), null);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /PHOTODESK_LIBRARY_START_DATE/);
});
