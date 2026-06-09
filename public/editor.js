(function attachPhotoDeskEditor(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhotoDeskEditor = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createEditorHelpers() {
  const ADJ_ZERO = Object.freeze({
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    temp: 0,
    saturation: 0,
    vibrance: 0,
    vignette: 0,
  });

  const CROP_ASPECTS = ['Original', '1:1', '4:5', '5:4', '3:2', '2:3', '16:9'];
  const PRESETS = [
    { id: 'original', name: 'Original', adj: {} },
    { id: 'punch', name: 'Punch', adj: { exposure: 5, contrast: 24, saturation: 14, vibrance: 22 } },
    { id: 'warm', name: 'Warm', adj: { exposure: 4, temp: 28, saturation: 8, vibrance: 12 } },
    { id: 'cool', name: 'Cool', adj: { temp: -26, contrast: 8, vibrance: 10 } },
    { id: 'matte', name: 'Matte', adj: { contrast: -20, highlights: -18, shadows: 24, saturation: -8 } },
    { id: 'bw', name: 'B&W', adj: { contrast: 18, saturation: -100, highlights: 8 } },
    { id: 'film', name: 'Film', adj: { contrast: 12, highlights: -16, shadows: 18, temp: 10, saturation: -12, vignette: 18 } },
  ];

  function normalizeAdjustments(adj) {
    return Object.fromEntries(
      Object.keys(ADJ_ZERO).map(key => [key, Math.round(Number(adj?.[key] || 0))])
    );
  }

  function adjustmentFilter(adj) {
    const a = normalizeAdjustments(adj);
    const brightness = 1 + a.exposure / 100 * 0.4
      + a.shadows / 100 * 0.12
      - a.highlights / 100 * 0.10;
    const contrast = 1 + a.contrast / 100 * 0.32 + a.highlights / 100 * 0.06;
    const saturate = Math.max(0, 1 + a.saturation / 100 + a.vibrance / 100 * 0.5);
    return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)})`;
  }

  function temperatureOverlay(adj) {
    const temp = normalizeAdjustments(adj).temp;
    if (!temp) return '';
    const color = temp > 0 ? '255,168,76' : '78,150,255';
    const opacity = Math.min(0.34, Math.abs(temp) / 100 * 0.30);
    return `rgba(${color},${opacity.toFixed(3)})`;
  }

  function vignetteOverlay(adj) {
    const vignette = normalizeAdjustments(adj).vignette;
    if (!vignette) return '';
    const opacity = vignette / 100 * 0.75;
    return `radial-gradient(ellipse 78% 78% at 50% 50%, transparent 50%, rgba(0,0,0,${opacity.toFixed(3)}) 100%)`;
  }

  function ratioValue(aspect, fallbackWidth = 3, fallbackHeight = 2) {
    if (aspect === 'Original') {
      return fallbackWidth > 0 && fallbackHeight > 0
        ? fallbackWidth / fallbackHeight
        : 3 / 2;
    }
    const [width, height] = aspect.split(':').map(Number);
    return width / height;
  }

  function cropForAspect(meta, aspect) {
    const sourceRatio = ratioValue('Original', meta?.width, meta?.height);
    const targetRatio = ratioValue(aspect, meta?.width, meta?.height);
    if (aspect === 'Original' || Math.abs(sourceRatio - targetRatio) < 0.0001) {
      return { aspect, x: 0, y: 0, width: 1, height: 1 };
    }
    if (sourceRatio > targetRatio) {
      const width = targetRatio / sourceRatio;
      return { aspect, x: (1 - width) / 2, y: 0, width, height: 1 };
    }
    const height = sourceRatio / targetRatio;
    return { aspect, x: 0, y: (1 - height) / 2, width: 1, height };
  }

  function containSize(containerWidth, containerHeight, aspectRatio, maxWidth = Infinity) {
    const widthLimit = Math.max(0, Math.min(Number(containerWidth) || 0, maxWidth));
    const heightLimit = Math.max(0, Number(containerHeight) || 0);
    const ratio = Number(aspectRatio);
    if (!widthLimit || !heightLimit || !Number.isFinite(ratio) || ratio <= 0) {
      return { width: 0, height: 0 };
    }
    let width = widthLimit;
    let height = width / ratio;
    if (height > heightLimit) {
      height = heightLimit;
      width = height * ratio;
    }
    return { width, height };
  }

  function isNeutralEdit(adjustments, crop) {
    return Object.values(normalizeAdjustments(adjustments)).every(value => value === 0)
      && (!crop || crop.aspect === 'Original');
  }

  return {
    ADJ_ZERO,
    CROP_ASPECTS,
    PRESETS,
    adjustmentFilter,
    containSize,
    cropForAspect,
    isNeutralEdit,
    normalizeAdjustments,
    ratioValue,
    temperatureOverlay,
    vignetteOverlay,
  };
}));
