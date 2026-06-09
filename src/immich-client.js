const config = require('./config');

function headers() {
  return {
    'x-api-key': config.immichApiKey,
    'Content-Type': 'application/json',
  };
}

async function searchAssets({ page = 1, size = 250, dateFrom, dateTo } = {}) {
  const body = {
    page,
    size,
    type: 'IMAGE',
    order: 'asc',
  };

  if (dateFrom) body.takenAfter = dateFrom;
  if (dateTo) body.takenBefore = dateTo;

  const res = await fetch(`${config.immichUrl}/api/search/metadata`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Immich search failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function fetchAllAssets({ dateFrom, dateTo } = {}) {
  const allAssets = [];
  let page = 1;

  while (true) {
    const data = await searchAssets({ page, size: 250, dateFrom, dateTo });
    const items = data.assets && data.assets.items ? data.assets.items : [];
    allAssets.push(...items);

    if (!data.assets.nextPage) break;
    page++;

  }

  return allAssets;
}

async function checkConnection() {
  await searchAssets({ page: 1, size: 1 });
  return true;
}

async function getThumbnailBuffer(assetId) {
  const res = await fetch(
    `${config.immichUrl}/api/assets/${assetId}/thumbnail?size=preview`,
    { headers: { 'x-api-key': config.immichApiKey } }
  );

  if (!res.ok) {
    throw new Error(`Thumbnail fetch failed: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

async function getOriginalAssetBuffer(assetId) {
  const res = await fetch(
    `${config.immichUrl}/api/assets/${assetId}/original`,
    { headers: { 'x-api-key': config.immichApiKey } }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Original asset fetch failed: ${res.status} ${text}`);
  }

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
    contentDisposition: res.headers.get('content-disposition') || '',
  };
}

async function createStack(assetIds) {
  if (!assetIds || assetIds.length < 2) {
    throw new Error('createStack requires at least 2 asset IDs');
  }

  const res = await fetch(`${config.immichUrl}/api/stacks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ assetIds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create stack failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function trashAssets(ids) {
  if (!ids || ids.length === 0) return;

  const res = await fetch(`${config.immichUrl}/api/assets`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ ids, force: false }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trash assets failed: ${res.status} ${text}`);
  }

  // 204 No Content is success
  if (res.status === 204) return null;
  return res.json();
}

async function updateAssetRating(assetId, rating) {
  const res = await fetch(`${config.immichUrl}/api/assets/${assetId}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({ rating }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Update asset rating failed: ${res.status} ${text}`);
  }

  return res.json();
}

module.exports = {
  fetchAllAssets,
  getThumbnailBuffer,
  getOriginalAssetBuffer,
  createStack,
  trashAssets,
  updateAssetRating,
  checkConnection,
};
