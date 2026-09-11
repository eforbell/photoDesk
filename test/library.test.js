const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSnapshot,
  clusterSuggestions,
  dateKeyInTimeZone,
  formatDateRange,
  libraryFetchOptions,
  processedAssetIds,
  rangeSummary,
} = require('../src/library');
const {
  monthKeysForYear,
  yearsForDays,
} = require('../public/calendar');

function asset(id, fileCreatedAt) {
  return { id, fileCreatedAt, exifInfo: { exifImageWidth: 4000, exifImageHeight: 3000 } };
}

test('groups timestamps into the configured Immich timezone', () => {
  assert.equal(
    dateKeyInTimeZone('2026-06-08T02:30:00.000Z', 'America/New_York'),
    '2026-06-07'
  );
});

test('computes exact processed and untriaged counts from current assets', () => {
  const snapshot = buildSnapshot([
    asset('a', '2026-06-07T14:00:00Z'),
    asset('b', '2026-06-07T15:00:00Z'),
    asset('c', '2026-06-08T15:00:00Z'),
  ], new Set(['a', 'missing']), 'America/New_York');

  assert.equal(snapshot.totalLibrary, 3);
  assert.equal(snapshot.totalProcessed, 1);
  assert.equal(snapshot.totalUntriaged, 2);
  assert.equal(snapshot.activeDays, 2);
  assert.equal(snapshot.days[0].untriagedCount, 1);
});

test('returns committed and uploaded edit IDs scoped to the given profile', () => {
  const db = {
    prepare(sql) {
      if (sql.includes('FROM processed_assets')) {
        return {
          all: (processedProfileId, editProfileId) => {
            assert.equal(processedProfileId, 7);
            assert.equal(editProfileId, 7);
            return [
              { asset_id: 'original' },
              { asset_id: 'batch-2' },
              { asset_id: 'uploaded-edit' },
            ];
          },
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  assert.deepEqual(
    [...processedAssetIds(db, 7)].sort(),
    ['batch-2', 'original', 'uploaded-edit']
  );
});

test('suggestions allow one empty calendar day and remain newest first', () => {
  const snapshot = buildSnapshot([
    asset('a', '2026-06-01T14:00:00Z'),
    asset('b', '2026-06-03T14:00:00Z'),
    asset('c', '2026-06-08T14:00:00Z'),
  ], new Set(), 'America/New_York');
  const suggestions = clusterSuggestions(snapshot);

  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].dateFrom, '2026-06-08');
  assert.equal(suggestions[1].dateFrom, '2026-06-01');
  assert.equal(suggestions[1].dateTo, '2026-06-03');
  assert.deepEqual(suggestions[1].previewAssetIds, ['a', 'b']);
});

test('range summaries include both endpoints and preview IDs', () => {
  const snapshot = buildSnapshot([
    asset('a', '2026-06-01T14:00:00Z'),
    asset('b', '2026-06-02T14:00:00Z'),
    asset('c', '2026-06-03T14:00:00Z'),
  ], new Set(['b']), 'America/New_York');
  const summary = rangeSummary(snapshot, '2026-06-03', '2026-06-01');

  assert.equal(summary.count, 3);
  assert.equal(summary.untriagedCount, 2);
  assert.deepEqual(summary.previewAssetIds, ['a', 'b', 'c']);
  assert.equal(formatDateRange('2026-06-01', '2026-06-03'), 'Jun 1–3');
});

test('calendar navigation exposes the full library year range', () => {
  const days = [
    { date: '2000-09-12' },
    { date: '2003-04-02' },
    { date: '2026-06-08' },
  ];

  assert.deepEqual(yearsForDays(days), [2000, 2003, 2026]);
  assert.deepEqual(monthKeysForYear(days, 2000), [
    '2000-09', '2000-10', '2000-11', '2000-12',
  ]);
  assert.equal(monthKeysForYear(days, 2003).length, 12);
  assert.deepEqual(monthKeysForYear(days, 2026), [
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  ]);
});

test('discovery floor excludes earlier local dates and scopes the snapshot cache', () => {
  const snapshot = buildSnapshot([
    asset('before', '2023-12-31T15:00:00Z'),
    asset('on-cutoff', '2024-01-01T15:00:00Z'),
  ], new Set(), 'America/New_York', '2024-01-01');

  assert.equal(snapshot.libraryScope, 'owned-from-2024-01-01');
  assert.equal(snapshot.totalLibrary, 1);
  assert.equal(snapshot.totalUntriaged, 1);
  assert.deepEqual(snapshot.days.map(day => day.date), ['2024-01-01']);
});


test('discovery floor is sent to Immich as a local start-of-day query', () => {
  assert.deepEqual(libraryFetchOptions(), {});
  assert.deepEqual(
    libraryFetchOptions('2024-01-01'),
    { dateFrom: new Date('2024-01-01T00:00:00.000').toISOString() }
  );
});
