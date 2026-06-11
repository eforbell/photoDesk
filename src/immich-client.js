const config = require('./config');

function headers() {
  return {
    'x-api-key': config.immichApiKey,
    'Content-Type': 'application/json',
  };
}

function authHeaders() {
  return { 'x-api-key': config.immichApiKey };
}

async function getCurrentUser() {
  const res = await fetch(`${config.immichUrl}/api/users/me`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Immich current user lookup failed: ${res.status} ${text}`);
  }
  return res.json();
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

async function fetchOwnedAssets(options = {}) {
  const [user, assets] = await Promise.all([
    getCurrentUser(),
    fetchAllAssets(options),
  ]);
  return assets.filter(asset => asset.ownerId === user.id);
}

async function checkConnection() {
  await getCurrentUser();
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

async function getAssetInfo(assetId) {
  const res = await fetch(`${config.immichUrl}/api/assets/${assetId}`, {
    headers: authHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset info fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function assetExists(assetId) {
  const res = await fetch(`${config.immichUrl}/api/assets/${assetId}`, {
    headers: authHeaders(),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset existence check failed: ${res.status} ${text}`);
  }
  return true;
}

async function uploadAsset({
  buffer,
  filename,
  deviceAssetId,
  deviceId = 'photodesk',
  fileCreatedAt,
  fileModifiedAt,
}) {
  const form = new FormData();
  form.append('assetData', new Blob([buffer], { type: 'image/jpeg' }), filename);
  form.append('deviceAssetId', deviceAssetId);
  form.append('deviceId', deviceId);
  form.append('fileCreatedAt', fileCreatedAt);
  form.append('fileModifiedAt', fileModifiedAt);
  form.append('filename', filename);

  const res = await fetch(`${config.immichUrl}/api/assets`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset upload failed: ${res.status} ${text}`);
  }

  return res.json();
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

async function copyStackAssociation(sourceId, targetId) {
  // Immich's stable asset-copy API can copy stack membership. StackUpdateDto
  // only supports changing primaryAssetId, so it cannot append an asset.
  const res = await fetch(`${config.immichUrl}/api/assets/copy`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify({
      sourceId,
      targetId,
      stack: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Copy stack association failed: ${res.status} ${text}`);
  }
}

async function stackEditedAsset(originalAssetId, editedAssetId) {
  const original = await getAssetInfo(originalAssetId);
  if (original.stack) {
    await copyStackAssociation(originalAssetId, editedAssetId);
    return { existingStack: true, stackId: original.stack.id };
  }
  const stack = await createStack([originalAssetId, editedAssetId]);
  return { existingStack: false, stackId: stack.id };
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
  fetchOwnedAssets,
  getCurrentUser,
  assetExists,
  getAssetInfo,
  getThumbnailBuffer,
  getOriginalAssetBuffer,
  uploadAsset,
  createStack,
  copyStackAssociation,
  stackEditedAsset,
  trashAssets,
  updateAssetRating,
  checkConnection,
};
