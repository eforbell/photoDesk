(function attachPhotoDeskCalendar(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PhotoDeskCalendar = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createCalendarHelpers() {
  function yearsForDays(days) {
    return [...new Set(
      days
        .map(day => Number(String(day.date || '').slice(0, 4)))
        .filter(Number.isInteger)
    )].sort((a, b) => a - b);
  }

  function monthKeysForYear(days, year) {
    if (!days.length || !Number.isInteger(year)) return [];

    const firstMonth = days[0].date.slice(0, 7);
    const lastMonth = days.at(-1).date.slice(0, 7);
    const start = year === Number(firstMonth.slice(0, 4))
      ? Number(firstMonth.slice(5, 7))
      : 1;
    const end = year === Number(lastMonth.slice(0, 4))
      ? Number(lastMonth.slice(5, 7))
      : 12;

    if (start > end) return [];
    return Array.from(
      { length: end - start + 1 },
      (_, index) => `${year}-${String(start + index).padStart(2, '0')}`
    );
  }

  return { monthKeysForYear, yearsForDays };
}));
