import type { Timeframe } from '@trade-automation/contracts';
import { nyDayBoundaryIndices, showsDaySeparators } from './day-separators';

const sec = (iso: string): number => Date.parse(iso) / 1000;

/** `count` bars `stepMin` minutes apart from `startIso`, as UTC epoch seconds. */
function bars(startIso: string, stepMin: number, count: number): number[] {
  const start = sec(startIso);
  return Array.from({ length: count }, (_, i) => start + i * stepMin * 60);
}

describe('day separators (architecture/chart-layouts.md §12.3)', () => {
  it('shows on 1m/5m/15m/1h only', () => {
    const shown = (['1m', '5m', '15m', '1h', '4h', '1d'] as Timeframe[]).filter(showsDaySeparators);
    expect(shown).toEqual(['1m', '5m', '15m', '1h']);
  });

  it('puts the summer boundary at the bar opening 04:00Z (NY 00:00 EDT)', () => {
    const times = bars('2026-07-15T00:00:00Z', 60, 48);
    const idx = nyDayBoundaryIndices(times);
    expect(idx.map((i) => new Date(times[i] * 1000).toISOString())).toEqual(['2026-07-15T04:00:00.000Z', '2026-07-16T04:00:00.000Z']);
  });

  it('puts the winter boundary at the bar opening 05:00Z (NY 00:00 EST)', () => {
    const times = bars('2026-01-15T00:00:00Z', 15, 4 * 24);
    const idx = nyDayBoundaryIndices(times);
    expect(idx.map((i) => new Date(times[i] * 1000).toISOString())).toEqual(['2026-01-15T05:00:00.000Z']);
  });

  it('yields exactly one boundary per NY day across the 23h day 2026-03-08', () => {
    const times = bars('2026-03-07T12:00:00Z', 60, 72);
    const idx = nyDayBoundaryIndices(times).map((i) => new Date(times[i] * 1000).toISOString());
    expect(idx).toEqual(['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', '2026-03-10T04:00:00.000Z']);
  });

  it('yields exactly one boundary per NY day across the 25h day 2026-11-01', () => {
    const times = bars('2026-10-31T12:00:00Z', 60, 72);
    const idx = nyDayBoundaryIndices(times).map((i) => new Date(times[i] * 1000).toISOString());
    expect(idx).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', '2026-11-03T05:00:00.000Z']);
  });

  it('draws a Fri→Mon market-closed gap as exactly one boundary, at the first bar after it', () => {
    const fri = bars('2026-09-11T18:00:00Z', 60, 3); // Fri 14:00–16:00 NY
    const mon = bars('2026-09-14T13:00:00Z', 60, 3); // Mon 09:00–11:00 NY
    const times = [...fri, ...mon];
    expect(nyDayBoundaryIndices(times)).toEqual([3]);
  });

  it('returns nothing for empty or single-day data', () => {
    expect(nyDayBoundaryIndices([])).toEqual([]);
    expect(nyDayBoundaryIndices(bars('2026-07-15T05:00:00Z', 60, 10))).toEqual([]);
  });
});
