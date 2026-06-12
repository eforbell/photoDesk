const ADJUSTMENT_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'temp',
  'saturation',
  'vibrance',
  'vignette',
];

const ASPECTS = new Set(['Free', 'Original', '1:1', '4:5', '5:4', '3:2', '2:3', '16:9', '9:16']);

function validateAdjustments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('adjustments must be an object');
  }

  const normalized = {};
  for (const key of ADJUSTMENT_KEYS) {
    const number = Number(value[key] ?? 0);
    const min = key === 'vignette' ? 0 : -100;
    if (!Number.isFinite(number) || number < min || number > 100) {
      throw new Error(`${key} must be between ${min} and 100`);
    }
    normalized[key] = Math.round(number);
  }
  return normalized;
}

function validateCrop(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('crop must be an object');
  }

  const aspect = value.aspect || 'Original';
  if (!ASPECTS.has(aspect)) throw new Error('crop aspect is not supported');

  const normalized = { aspect };
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = Number(value[key] ?? (key === 'width' || key === 'height' ? 1 : 0));
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw new Error(`crop ${key} must be between 0 and 1`);
    }
    normalized[key] = number;
  }

  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new Error('crop width and height must be greater than 0');
  }
  if (normalized.x + normalized.width > 1.000001
      || normalized.y + normalized.height > 1.000001) {
    throw new Error('crop rectangle must remain inside the image');
  }
  return normalized;
}

function parseEditRow(row) {
  return {
    ...row,
    adjustments: JSON.parse(row.adjustments),
    crop: JSON.parse(row.crop),
  };
}

module.exports = {
  ADJUSTMENT_KEYS,
  ASPECTS,
  parseEditRow,
  validateAdjustments,
  validateCrop,
};
