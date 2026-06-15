const config = require('./config');

function resolveUrl(credentials) {
  return (credentials && credentials.immichUrl) || config.immichUrl;
}

function resolveKey(credentials) {
  const key = credentials && credentials.apiKey;
  if (!key) {
    throw new Error('Immich credentials are not configured for this profile');
  }
  return key;
}

function headers(credentials) {
  return {
    'x-api-key': resolveKey(credentials),
    'Content-Type': 'application/json',
  };
}

function authHeaders(credentials) {
  return { 'x-api-key': resolveKey(credentials) };
}

async function getCurrentUser(credentials) {
  const res = await fetch(`${resolveUrl(credentials)}/api/users/me`, {
    headers: authHeaders(credentials),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Immich current user lookup failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function searchAssets({ page = 1, size = 250, dateFrom, dateTo } = {}, credentials) {
  const body = {
    page,
    size,
    type: 'IMAGE',
    order: 'asc',
  };

  if (dateFrom) body.takenAfter = dateFrom;
  if (dateTo) body.takenBefore = dateTo;

  const res = await fetch(`${resolveUrl(credentials)}/api/search/metadata`, {
    method: 'POST',
    headers: headers(credentials),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Immich search failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function fetchAllAssets({ dateFrom, dateTo } = {}, credentials) {
  const allAssets = [];
  let page = 1;

  while (true) {
    const data = await searchAssets({ page, size: 250, dateFrom, dateTo }, credentials);
    const items = data.assets && data.assets.items ? data.assets.items : [];
    allAssets.push(...items);

    if (!data.assets.nextPage) break;
    page++;

  }

  return allAssets;
}

async function fetchOwnedAssets(options = {}, credentials) {
  const [user, assets] = await Promise.all([
    getCurrentUser(credentials),
    fetchAllAssets(options, credentials),
  ]);
  return assets.filter(asset => asset.ownerId === user.id);
}

async function checkConnection(credentials) {
  await getCurrentUser(credentials);
  return true;
}

async function getThumbnailBuffer(assetId, credentials) {
  const res = await fetch(
    `${resolveUrl(credentials)}/api/assets/${assetId}/thumbnail?size=preview`,
    { headers: authHeaders(credentials) }
  );

  if (!res.ok) {
    throw new Error(`Thumbnail fetch failed: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

async function getOriginalAssetBuffer(assetId, credentials, { signal } = {}) {
  const res = await fetch(
    `${resolveUrl(credentials)}/api/assets/${assetId}/original`,
    { headers: authHeaders(credentials), signal }
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

async function getAssetInfo(assetId, credentials, { signal } = {}) {
  const res = await fetch(`${resolveUrl(credentials)}/api/assets/${assetId}`, {
    headers: authHeaders(credentials),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset info fetch failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function assetExists(assetId, credentials) {
  const res = await fetch(`${resolveUrl(credentials)}/api/assets/${assetId}`, {
    headers: authHeaders(credentials),
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
}, credentials) {
  const form = new FormData();
  form.append('assetData', new Blob([buffer], { type: 'image/jpeg' }), filename);
  form.append('deviceAssetId', deviceAssetId);
  form.append('deviceId', deviceId);
  form.append('fileCreatedAt', fileCreatedAt);
  form.append('fileModifiedAt', fileModifiedAt);
  form.append('filename', filename);

  const res = await fetch(`${resolveUrl(credentials)}/api/assets`, {
    method: 'POST',
    headers: authHeaders(credentials),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset upload failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function createStack(assetIds, credentials) {
  if (!assetIds || assetIds.length < 2) {
    throw new Error('createStack requires at least 2 asset IDs');
  }

  const res = await fetch(`${resolveUrl(credentials)}/api/stacks`, {
    method: 'POST',
    headers: headers(credentials),
    body: JSON.stringify({ assetIds }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create stack failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function copyStackAssociation(sourceId, targetId, credentials) {
  // Immich's stable asset-copy API can copy stack membership. StackUpdateDto
  // only supports changing primaryAssetId, so it cannot append an asset.
  const res = await fetch(`${resolveUrl(credentials)}/api/assets/copy`, {
    method: 'PUT',
    headers: headers(credentials),
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

async function stackEditedAsset(originalAssetId, editedAssetId, credentials) {
  const original = await getAssetInfo(originalAssetId, credentials);
  if (original.stack) {
    await copyStackAssociation(originalAssetId, editedAssetId, credentials);
    return { existingStack: true, stackId: original.stack.id };
  }
  const stack = await createStack([originalAssetId, editedAssetId], credentials);
  return { existingStack: false, stackId: stack.id };
}

async function trashAssets(ids, credentials) {
  if (!ids || ids.length === 0) return;

  const res = await fetch(`${resolveUrl(credentials)}/api/assets`, {
    method: 'DELETE',
    headers: headers(credentials),
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

async function updateAssetRating(assetId, rating, credentials) {
  const res = await fetch(`${resolveUrl(credentials)}/api/assets/${assetId}`, {
    method: 'PUT',
    headers: headers(credentials),
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
