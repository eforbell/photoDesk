const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEditRow,
  validateAdjustments,
  validateCrop,
} = require('../src/editor');
const {
  adjustmentFilter,
  cropForAspect,
  isNeutralEdit,
  normalizeAdjustments,
  temperatureOverlay,
  vignetteOverlay,
} = require('../public/editor');

test('normalizes complete adjustment recipes', () => {
  assert.deepEqual(validateAdjustments({ exposure: 12.4, vignette: 33 }), {
    exposure: 12,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    temp: 0,
    saturation: 0,
    vibrance: 0,
    vignette: 33,
  });
});

test('rejects adjustment values outside supported ranges', () => {
  assert.throws(() => validateAdjustments({ exposure: 101 }), /exposure/);
  assert.throws(() => validateAdjustments({ vignette: -1 }), /vignette/);
});

test('accepts normalized crops and rejects rectangles outside the image', () => {
  assert.deepEqual(validateCrop({
    aspect: '4:5',
    x: 0.1,
    y: 0,
    width: 0.8,
    height: 1,
  }), {
    aspect: '4:5',
    x: 0.1,
    y: 0,
    width: 0.8,
    height: 1,
  });
  assert.throws(
    () => validateCrop({ aspect: '1:1', x: 0.5, y: 0, width: 0.6, height: 1 }),
    /inside the image/
  );
});

test('parses persisted JSON edit fields', () => {
  const row = parseEditRow({
    id: 1,
    adjustments: '{"exposure":10}',
    crop: '{"aspect":"Original"}',
  });
  assert.equal(row.adjustments.exposure, 10);
  assert.equal(row.crop.aspect, 'Original');
});

test('browser adjustment helpers produce stable preview styles', () => {
  const adjustments = normalizeAdjustments({
    exposure: 25,
    temp: -30,
    saturation: 10,
    vignette: 20,
  });
  assert.match(adjustmentFilter(adjustments), /brightness\(1\.100\)/);
  assert.match(temperatureOverlay(adjustments), /78,150,255/);
  assert.match(vignetteOverlay(adjustments), /radial-gradient/);
  assert.equal(isNeutralEdit(adjustments, { aspect: 'Original' }), false);
});

test('aspect selection creates a centered normalized crop', () => {
  assert.deepEqual(cropForAspect({ width: 4000, height: 3000 }, '1:1'), {
    aspect: '1:1',
    x: 0.125,
    y: 0,
    width: 0.75,
    height: 1,
  });
  assert.deepEqual(cropForAspect({ width: 3000, height: 4000 }, '16:9'), {
    aspect: '16:9',
    x: 0,
    y: 0.2890625,
    width: 1,
    height: 0.421875,
  });
});
