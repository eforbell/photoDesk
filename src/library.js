const { fetchOwnedAssets } = require('./immich-client');
const config = require('./config');

const CACHE_TTL_MS = 60 * 60 * 1000;
const DATE_FORMATTERS = new Map();

function dateKeyInTimeZone(value, timeZone = config.timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  let formatter = DATE_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    DATE_FORMATTERS.set(timeZone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function lightweightAsset(asset, timeZone = config.timezone) {
  const capturedAt = asset.fileCreatedAt || asset.localDateTime || asset.createdAt;
  const date = dateKeyInTimeZone(capturedAt, timeZone);
  if (!asset.id || !date) return null;
  return {
    id: asset.id,
    date,
    capturedAt,
    width: asset.exifInfo?.exifImageWidth || asset.originalWidth || 0,
    height: asset.exifInfo?.exifImageHeight || asset.originalHeight || 0,
  };
}

function buildSnapshot(assets, processedIds, timeZone = config.timezone) {
  const processed = processedIds instanceof Set ? processedIds : new Set(processedIds);
  const days = new Map();

  for (const raw of assets) {
    const asset = lightweightAsset(raw, timeZone);
    if (!asset) continue;
    if (!days.has(asset.date)) days.set(asset.date, []);
    days.get(asset.date).push({
      ...asset,
      processed: processed.has(asset.id),
    });
  }

  const sortedDays = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayAssets]) => ({
      date,
      count: dayAssets.length,
      untriagedCount: dayAssets.filter(asset => !asset.processed).length,
      assets: dayAssets,
    }));

  const totalLibrary = sortedDays.reduce((sum, day) => sum + day.count, 0);
  const totalUntriaged = sortedDays.reduce((sum, day) => sum + day.untriagedCount, 0);

  return {
    libraryScope: 'owned',
    computedAt: new Date().toISOString(),
    timezone: timeZone,
    totalLibrary,
    totalProcessed: totalLibrary - totalUntriaged,
    totalUntriaged,
    activeDays: sortedDays.filter(day => day.untriagedCount > 0).length,
    days: sortedDays,
  };
}

function clusterSuggestions(snapshot, max = 6) {
  const activeDays = snapshot.days.filter(day => day.untriagedCount > 0);
  const clusters = [];

  for (const day of activeDays) {
    const previous = clusters.at(-1);
    const dayMs = Date.parse(`${day.date}T00:00:00Z`);
    const previousMs = previous
      ? Date.parse(`${previous.days.at(-1).date}T00:00:00Z`)
      : null;
    const gapDays = previous ? Math.round((dayMs - previousMs) / 86400000) : null;

    if (!previous || gapDays > 2) {
      clusters.push({ days: [day] });
    } else {
      previous.days.push(day);
    }
  }

  return clusters
    .map(cluster => {
      const first = cluster.days[0];
      const last = cluster.days.at(-1);
      const untriagedAssets = cluster.days
        .flatMap(day => day.assets)
        .filter(asset => !asset.processed)
        .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
      const totalPhotos = untriagedAssets.length;
      return {
        name: formatDateRange(first.date, last.date),
        dateFrom: first.date,
        dateTo: last.date,
        totalPhotos,
        estimatedScenes: Math.max(1, Math.round(totalPhotos / 4)),
        previewAssetIds: untriagedAssets.slice(0, 4).map(asset => asset.id),
        dayCount: cluster.days.length,
        when: relativeDate(last.date),
      };
    })
    .reverse()
    .slice(0, max);
}

function rangeSummary(snapshot, from, to) {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const days = snapshot.days.filter(day => day.date >= lo && day.date <= hi);
  const assets = days.flatMap(day => day.assets);
  return {
    dateFrom: lo,
    dateTo: hi,
    count: assets.length,
    dayCount: days.length,
    untriagedCount: assets.filter(asset => !asset.processed).length,
    previewAssetIds: assets.slice(0, 6).map(asset => asset.id),
  };
}

function formatDateRange(from, to) {
  const first = parseDateKey(from);
  const last = parseDateKey(to);
  const firstLabel = `${first.month} ${first.day}`;
  if (from === to) return firstLabel;
  if (first.year === last.year && first.month === last.month) {
    return `${firstLabel}–${last.day}`;
  }
  return `${firstLabel} – ${last.month} ${last.day}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return {
    year,
    month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
      .format(new Date(Date.UTC(year, month - 1, day))),
    day,
  };
}

function relativeDate(dateKey, now = new Date()) {
  const todayKey = dateKeyInTimeZone(now, config.timezone);
  const diff = Math.round(
    (Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${dateKey}T00:00:00Z`)) / 86400000
  );
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}

function readCachedSnapshot(db, refresh = false) {
  if (refresh) return null;
  const row = db.prepare('SELECT computed_at, data FROM density_cache WHERE id = 1').get();
  if (!row) return null;
  const age = Date.now() - Date.parse(row.computed_at);
  if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null;
  const snapshot = JSON.parse(row.data);
  if (snapshot.libraryScope !== 'owned') return null;
  return snapshot;
}

function processedAssetIds(db) {
  const ids = new Set(
    db.prepare('SELECT asset_id FROM processed_assets').all().map(row => row.asset_id)
  );
  for (const row of db.prepare(`
    SELECT immich_asset_id
    FROM edits
    WHERE immich_asset_id IS NOT NULL
  `).all()) {
    ids.add(row.immich_asset_id);
  }
  return ids;
}

async function getLibrarySnapshot(db, { refresh = false } = {}) {
  const cached = readCachedSnapshot(db, refresh);
  if (cached) return cached;

  const assets = await fetchOwnedAssets();
  const processedIds = processedAssetIds(db);
  const snapshot = buildSnapshot(assets, processedIds);
  db.prepare(`
    INSERT INTO density_cache (id, computed_at, data)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data
  `).run(snapshot.computedAt, JSON.stringify(snapshot));
  return snapshot;
}

function invalidateLibraryCache(db) {
  db.prepare('DELETE FROM density_cache').run();
}

module.exports = {
  CACHE_TTL_MS,
  buildSnapshot,
  clusterSuggestions,
  dateKeyInTimeZone,
  formatDateRange,
  getLibrarySnapshot,
  invalidateLibraryCache,
  processedAssetIds,
  rangeSummary,
};
