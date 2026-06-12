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

  const CROP_ASPECTS = ['Free', 'Original', '1:1', '4:5', '5:4', '3:2', '2:3', '16:9'];
  const PRESETS = [
    { id: 'original', name: 'Original', group: 'Standard', adj: {} },
    { id: 'punch', name: 'Punch', group: 'Standard', adj: { exposure: 5, contrast: 24, saturation: 14, vibrance: 22 } },
    { id: 'vivid', name: 'Vivid', group: 'Standard', adj: { contrast: 14, saturation: 24, vibrance: 28 } },
    { id: 'soft', name: 'Soft', group: 'Standard', adj: { contrast: -12, highlights: -10, shadows: 16, saturation: -4 } },
    { id: 'warm', name: 'Warm', group: 'White balance', adj: { exposure: 4, temp: 28, saturation: 8, vibrance: 12 } },
    { id: 'cool', name: 'Cool', group: 'White balance', adj: { temp: -26, contrast: 8, vibrance: 10 } },
    { id: 'golden', name: 'Golden', group: 'White balance', adj: { exposure: 3, temp: 34, highlights: -8, saturation: 10, vibrance: 8 } },
    { id: 'shade', name: 'Open Shade', group: 'White balance', adj: { temp: -16, exposure: 6, shadows: 12, vibrance: 8 } },
    { id: 'bw', name: 'B&W', group: 'Black & white', adj: { contrast: 18, saturation: -100, highlights: 8 } },
    { id: 'monohi', name: 'Mono Hi', group: 'Black & white', adj: { contrast: 34, saturation: -100, highlights: -6, shadows: -10 } },
    { id: 'silver', name: 'Silver', group: 'Black & white', adj: { contrast: 6, saturation: -100, highlights: 10, shadows: 22 } },
    { id: 'film', name: 'Film', group: 'Film & vintage', adj: { contrast: 12, highlights: -16, shadows: 18, temp: 10, saturation: -12, vignette: 18 } },
    { id: 'matte', name: 'Matte', group: 'Film & vintage', adj: { contrast: -20, highlights: -18, shadows: 24, saturation: -8 } },
    { id: 'faded', name: 'Faded', group: 'Film & vintage', adj: { contrast: -16, exposure: 6, highlights: -10, shadows: 22, saturation: -14, vignette: 10 } },
    { id: 'classic', name: 'Classic', group: 'Film & vintage', adj: { contrast: 10, temp: 8, highlights: -10, shadows: 14, vibrance: 8, vignette: 8 } },
  ];
  const PROFILE_GROUPS = ['Standard', 'White balance', 'Black & white', 'Film & vintage'];

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
    if (aspect === 'Free') return null;
    if (aspect === 'Original') {
      return fallbackWidth > 0 && fallbackHeight > 0
        ? fallbackWidth / fallbackHeight
        : 3 / 2;
    }
    const [width, height] = aspect.split(':').map(Number);
    return width / height;
  }

  function cropForAspect(meta, aspect) {
    if (aspect === 'Free') {
      return { aspect, x: 0, y: 0, width: 1, height: 1 };
    }
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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function scaleAdjustments(adj, percent) {
    const factor = clamp(Number(percent) || 0, 0, 100) / 100;
    return Object.fromEntries(
      Object.keys(ADJ_ZERO).map(key => [key, Math.round(Number(adj?.[key] || 0) * factor)])
    );
  }

  function adjustmentsEqual(left, right) {
    const a = normalizeAdjustments(left);
    const b = normalizeAdjustments(right);
    return Object.keys(ADJ_ZERO).every(key => a[key] === b[key]);
  }

  function matchingPreset(adjustments) {
    const matches = PRESETS.filter(preset => adjustmentsEqual(adjustments, preset.adj));
    return matches.length === 1 ? matches[0] : null;
  }

  function flipAspect(aspect) {
    if (!aspect || !aspect.includes(':')) return aspect;
    const [width, height] = aspect.split(':');
    return `${height}:${width}`;
  }

  function refitCrop(crop, meta, aspect) {
    if (aspect === 'Free') return { ...crop, aspect };
    const sourceWidth = Number(meta?.width) || 3;
    const sourceHeight = Number(meta?.height) || 2;
    const targetRatio = ratioValue(aspect, sourceWidth, sourceHeight);
    const normalizedRatio = targetRatio / (sourceWidth / sourceHeight);
    const centerX = clamp(Number(crop?.x || 0) + Number(crop?.width || 1) / 2, 0, 1);
    const centerY = clamp(Number(crop?.y || 0) + Number(crop?.height || 1) / 2, 0, 1);
    let width = clamp(Number(crop?.width || 1), 0.000001, 1);
    let height = width / normalizedRatio;
    if (height > 1) {
      height = 1;
      width = height * normalizedRatio;
    }
    if (width > 1) {
      width = 1;
      height = width / normalizedRatio;
    }
    return {
      aspect,
      x: clamp(centerX - width / 2, 0, 1 - width),
      y: clamp(centerY - height / 2, 0, 1 - height),
      width,
      height,
    };
  }

  function transformCrop(crop, {
    handle,
    deltaX = 0,
    deltaY = 0,
    frameWidth,
    frameHeight,
    aspect = crop?.aspect || 'Free',
    sourceWidth = frameWidth,
    sourceHeight = frameHeight,
    minPixels = 44,
  }) {
    const W = Number(frameWidth);
    const H = Number(frameHeight);
    if (!(W > 0 && H > 0)) return { ...crop };
    let left = crop.x * W;
    let top = crop.y * H;
    let right = (crop.x + crop.width) * W;
    let bottom = (crop.y + crop.height) * H;
    const dx = Number(deltaX) || 0;
    const dy = Number(deltaY) || 0;

    if (handle === 'move') {
      const width = right - left;
      const height = bottom - top;
      left = clamp(left + dx, 0, W - width);
      top = clamp(top + dy, 0, H - height);
      right = left + width;
      bottom = top + height;
    } else {
      const moveLeft = handle.includes('w');
      const moveRight = handle.includes('e');
      const moveTop = handle.includes('n');
      const moveBottom = handle.includes('s');
      if (moveLeft) left = clamp(left + dx, 0, right - minPixels);
      if (moveRight) right = clamp(right + dx, left + minPixels, W);
      if (moveTop) top = clamp(top + dy, 0, bottom - minPixels);
      if (moveBottom) bottom = clamp(bottom + dy, top + minPixels, H);

      const lockedRatio = ratioValue(aspect, sourceWidth, sourceHeight);
      if (lockedRatio && moveLeft !== moveRight && moveTop !== moveBottom) {
        const anchorX = moveLeft ? right : left;
        const anchorY = moveTop ? bottom : top;
        let width = Math.abs((moveLeft ? left : right) - anchorX);
        let height = width / lockedRatio;
        if (height < minPixels) {
          height = minPixels;
          width = height * lockedRatio;
        }
        if (width < minPixels) {
          width = minPixels;
          height = width / lockedRatio;
        }
        width = Math.min(width, moveLeft ? anchorX : W - anchorX);
        height = width / lockedRatio;
        const maxHeight = moveTop ? anchorY : H - anchorY;
        if (height > maxHeight) {
          height = maxHeight;
          width = height * lockedRatio;
        }
        left = moveLeft ? anchorX - width : anchorX;
        right = moveLeft ? anchorX : anchorX + width;
        top = moveTop ? anchorY - height : anchorY;
        bottom = moveTop ? anchorY : anchorY + height;
      }
    }

    return {
      aspect,
      x: clamp(left / W, 0, 1),
      y: clamp(top / H, 0, 1),
      width: clamp((right - left) / W, 0.000001, 1),
      height: clamp((bottom - top) / H, 0.000001, 1),
    };
  }

  function cropDisplayAspect(crop, meta) {
    const sourceWidth = Number(meta?.width) || 3;
    const sourceHeight = Number(meta?.height) || 2;
    return (crop.width * sourceWidth) / (crop.height * sourceHeight);
  }

  function cropBackground(crop) {
    const positionX = crop.width < 0.999999 ? crop.x / (1 - crop.width) * 100 : 0;
    const positionY = crop.height < 0.999999 ? crop.y / (1 - crop.height) * 100 : 0;
    return {
      backgroundSize: `${(100 / crop.width).toFixed(4)}% ${(100 / crop.height).toFixed(4)}%`,
      backgroundPosition: `${positionX.toFixed(4)}% ${positionY.toFixed(4)}%`,
    };
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
    PROFILE_GROUPS,
    PRESETS,
    adjustmentsEqual,
    adjustmentFilter,
    containSize,
    cropBackground,
    cropDisplayAspect,
    cropForAspect,
    flipAspect,
    isNeutralEdit,
    matchingPreset,
    normalizeAdjustments,
    refitCrop,
    ratioValue,
    scaleAdjustments,
    temperatureOverlay,
    transformCrop,
    vignetteOverlay,
  };
}));
