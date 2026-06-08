const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSnapshot,
  clusterSuggestions,
  dateKeyInTimeZone,
  formatDateRange,
  rangeSummary,
} = require('../src/library');

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
