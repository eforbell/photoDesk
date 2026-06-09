const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

function sharpCapabilities() {
  const heif = sharp.format.heif;
  return {
    sharpVersion: sharp.versions.sharp,
    libvipsVersion: sharp.versions.vips,
    heifDecoder: Boolean(heif?.input?.buffer),
    heicGuaranteed: Boolean(heif?.input?.fileSuffix?.includes('.heic')),
    heifVersion: sharp.versions.heif || null,
  };
}

function pixelCrop(crop, width, height) {
  const left = Math.min(width - 1, Math.max(0, Math.round(crop.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round(crop.y * height)));
  const cropWidth = Math.min(width - left, Math.max(1, Math.round(crop.width * width)));
  const cropHeight = Math.min(height - top, Math.max(1, Math.round(crop.height * height)));
  return { left, top, width: cropWidth, height: cropHeight };
}

function adjustmentValues(adjustments) {
  const brightness = 1
    + adjustments.exposure / 100 * 0.4
    + adjustments.shadows / 100 * 0.12
    - adjustments.highlights / 100 * 0.10;
  const contrast = 1
    + adjustments.contrast / 100 * 0.32
    + adjustments.highlights / 100 * 0.06;
  const saturation = Math.max(
    0,
    1 + adjustments.saturation / 100 + adjustments.vibrance / 100 * 0.5
  );
  return { brightness, contrast, saturation };
}

function overlaySvg(width, height, adjustments) {
  const overlays = [];
  if (adjustments.temp) {
    const color = adjustments.temp > 0 ? '#ffa84c' : '#4e96ff';
    const opacity = Math.min(0.34, Math.abs(adjustments.temp) / 100 * 0.30);
    overlays.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + `<rect width="100%" height="100%" fill="${color}" fill-opacity="${opacity}"/>`
        + '</svg>'
      ),
      blend: 'soft-light',
    });
  }
  if (adjustments.vignette) {
    const opacity = adjustments.vignette / 100 * 0.75;
    overlays.push({
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + '<defs><radialGradient id="v">'
        + '<stop offset="50%" stop-color="black" stop-opacity="0"/>'
        + `<stop offset="100%" stop-color="black" stop-opacity="${opacity}"/>`
        + '</radialGradient></defs>'
        + '<rect width="100%" height="100%" fill="url(#v)"/>'
        + '</svg>'
      ),
      blend: 'multiply',
    });
  }
  return overlays;
}

async function renderEditBuffer(input, adjustments, crop) {
  const metadata = await sharp(input).metadata();
  const oriented = metadata.autoOrient || metadata;
  if (!oriented.width || !oriented.height) throw new Error('Source image dimensions are unavailable');

  const region = pixelCrop(crop, oriented.width, oriented.height);
  const values = adjustmentValues(adjustments);
  let pipeline = sharp(input)
    .autoOrient()
    .extract(region)
    .modulate({
      brightness: values.brightness,
      saturation: values.saturation,
    })
    .linear(values.contrast, 128 * (1 - values.contrast));

  const overlays = overlaySvg(region.width, region.height, adjustments);
  if (overlays.length) pipeline = pipeline.composite(overlays);

  return pipeline
    .jpeg({ quality: 92, mozjpeg: true })
    .withMetadata()
    .toBuffer({ resolveWithObject: true });
}

function safeEditPath(editDir, relativePath) {
  const root = path.resolve(editDir);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Rendered edit path escapes PHOTODESK_EDIT_DIR');
  }
  return resolved;
}

async function writeRenderedEdit({
  input,
  adjustments,
  crop,
  editDir,
  sessionId,
  assetId,
}) {
  const result = await renderEditBuffer(input, adjustments, crop);
  const relativePath = path.join(
    String(sessionId),
    `${assetId}-${crypto.randomUUID()}.jpg`
  );
  const target = safeEditPath(editDir, relativePath);
  const temporary = `${target}.tmp`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  let renamed = false;
  try {
    const file = await fs.promises.open(temporary, 'w');
    try {
      await file.writeFile(result.data);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.promises.rename(temporary, target);
    renamed = true;
    const directory = await fs.promises.open(path.dirname(target), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (err) {
    if (renamed) await fs.promises.rm(target, { force: true });
    throw err;
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
  return {
    relativePath,
    width: result.info.width,
    height: result.info.height,
    size: result.info.size,
    format: result.info.format,
  };
}

module.exports = {
  adjustmentValues,
  pixelCrop,
  renderEditBuffer,
  safeEditPath,
  sharpCapabilities,
  writeRenderedEdit,
};
