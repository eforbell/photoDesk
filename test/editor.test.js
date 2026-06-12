const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEditRow,
  validateAdjustments,
  validateCrop,
} = require('../src/editor');
const {
  adjustmentFilter,
  adjustmentsEqual,
  containSize,
  cropBackground,
  cropDisplayAspect,
  cropForAspect,
  flipAspect,
  isNeutralEdit,
  matchingPreset,
  normalizeAdjustments,
  PRESETS,
  PROFILE_GROUPS,
  refitCrop,
  scaleAdjustments,
  temperatureOverlay,
  transformCrop,
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
  assert.equal(validateCrop({
    aspect: 'Free',
    x: 0.12,
    y: 0.08,
    width: 0.61,
    height: 0.77,
  }).aspect, 'Free');
  assert.equal(validateCrop({
    aspect: '9:16',
    x: 0.2,
    y: 0,
    width: 0.4,
    height: 1,
  }).aspect, '9:16');
});

test('editing profiles are grouped, stable, and intensity-scalable', () => {
  assert.equal(PRESETS.length, 15);
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, 15);
  assert.deepEqual([...new Set(PRESETS.map(preset => preset.group))], PROFILE_GROUPS);
  assert.deepEqual(PRESETS.find(preset => preset.id === 'film').adj, {
    contrast: 12,
    highlights: -16,
    shadows: 18,
    temp: 10,
    saturation: -12,
    vignette: 18,
  });
  assert.deepEqual(scaleAdjustments(PRESETS.find(preset => preset.id === 'punch').adj, 60), {
    exposure: 3,
    contrast: 14,
    highlights: 0,
    shadows: 0,
    temp: 0,
    saturation: 8,
    vibrance: 13,
    vignette: 0,
  });
  assert.equal(adjustmentsEqual(scaleAdjustments({}, 50), {}), true);
  assert.equal(matchingPreset(PRESETS.find(preset => preset.id === 'warm').adj).id, 'warm');
  assert.equal(matchingPreset({ exposure: 1 }), null);
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
  assert.deepEqual(cropForAspect({ width: 1323, height: 983 }, '1:1'), {
    aspect: '1:1',
    x: 0.12849584278155706,
    y: 0,
    width: 0.7430083144368859,
    height: 1,
  });
});

test('aspect refit preserves center and flip supports portrait widescreen', () => {
  const crop = { aspect: 'Free', x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
  const refit = refitCrop(crop, { width: 4000, height: 3000 }, '1:1');
  assert.equal(refit.aspect, '1:1');
  assert.ok(Math.abs((refit.x + refit.width / 2) - 0.4) < 1e-9);
  assert.ok(Math.abs((refit.y + refit.height / 2) - 0.45) < 1e-9);
  assert.ok(Math.abs(cropDisplayAspect(refit, { width: 4000, height: 3000 }) - 1) < 1e-9);
  assert.equal(flipAspect('16:9'), '9:16');
  assert.equal(flipAspect('Original'), 'Original');
});

test('crop transforms move, resize, clamp, and preserve locked ratios', () => {
  const crop = { aspect: '1:1', x: 0.2, y: 0.2, width: 0.4, height: 0.5333333333 };
  const moved = transformCrop(crop, {
    handle: 'move',
    deltaX: 500,
    deltaY: -500,
    frameWidth: 800,
    frameHeight: 600,
    aspect: '1:1',
    sourceWidth: 4000,
    sourceHeight: 3000,
  });
  assert.ok(moved.x + moved.width <= 1.000001);
  assert.equal(moved.y, 0);

  const resized = transformCrop(crop, {
    handle: 'se',
    deltaX: 100,
    deltaY: 20,
    frameWidth: 800,
    frameHeight: 600,
    aspect: '1:1',
    sourceWidth: 4000,
    sourceHeight: 3000,
  });
  assert.ok(Math.abs(cropDisplayAspect(resized, { width: 4000, height: 3000 }) - 1) < 0.002);

  const free = transformCrop({ ...crop, aspect: 'Free' }, {
    handle: 'e',
    deltaX: 80,
    frameWidth: 800,
    frameHeight: 600,
    aspect: 'Free',
  });
  assert.equal(free.x, crop.x);
  assert.equal(free.y, crop.y);
  assert.ok(Math.abs(free.height - crop.height) < 1e-9);
  assert.ok(free.width > crop.width);
});

test('crop background geometry targets the selected source region', () => {
  assert.deepEqual(cropBackground({ x: 0.25, y: 0.1, width: 0.5, height: 0.8 }), {
    backgroundSize: '200.0000% 125.0000%',
    backgroundPosition: '50.0000% 50.0000%',
  });
});

test('fits portrait and landscape frames entirely inside the editor stage', () => {
  assert.deepEqual(containSize(1000, 700, 3 / 4, 1100), {
    width: 525,
    height: 700,
  });
  assert.deepEqual(containSize(1000, 700, 3 / 2, 1100), {
    width: 1000,
    height: 666.6666666666666,
  });
  assert.deepEqual(containSize(1600, 900, 16 / 9, 1100), {
    width: 1100,
    height: 618.75,
  });
});
