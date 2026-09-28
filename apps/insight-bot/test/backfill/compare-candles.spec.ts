import { compareCandles, renderComparison } from '../../src/backfill/compare-candles';

/** IB-012 — the archive/live agreement check (§5). */

const bar = (minute: number, over: Partial<{ open: number; high: number; low: number; close: number; volume: number }> = {}) => ({
  openTime: Date.UTC(2026, 8, 20) + minute * 60_000,
  open: 100, high: 101, low: 99, close: 100.5, volume: 12.5, ...over,
});

describe('compareCandles', () => {
  it('identical sets agree', () => {
    const set = [bar(0), bar(1), bar(2)];
    const result = compareCandles(set, [...set]);
    expect(result).toMatchObject({ compared: 3, agree: true, differences: [], onlyLeft: [], onlyRight: [] });
  });

  it('a single changed field is reported with both values', () => {
    const result = compareCandles([bar(0)], [bar(0, { close: 100.6 })]);
    expect(result.agree).toBe(false);
    expect(result.differences).toEqual([{ openTime: bar(0).openTime, field: 'close', left: 100.5, right: 100.6 }]);
  });

  it('a minute missing on either side is named, not silently skipped', () => {
    const result = compareCandles([bar(0), bar(1)], [bar(1), bar(2)]);
    expect(result.compared).toBe(1);
    expect(result.onlyLeft).toEqual([bar(0).openTime]);
    expect(result.onlyRight).toEqual([bar(2).openTime]);
    expect(result.agree).toBe(false);
  });

  it('compares EXACTLY by default — same venue, same numbers', () => {
    expect(compareCandles([bar(0)], [bar(0, { volume: 12.5000001 })]).agree).toBe(false);
  });

  it('a relative tolerance can absorb a restated last digit', () => {
    expect(compareCandles([bar(0)], [bar(0, { volume: 12.5000001 })], 1e-6).agree).toBe(true);
  });

  it('renders a verdict a person can read', () => {
    expect(renderComparison('2026-09-20 BTCUSDT', compareCandles([bar(0)], [bar(0)]))).toContain('every OHLCV field identical');
    expect(renderComparison('x', compareCandles([bar(0)], [bar(0, { high: 102 })]))).toContain('high 101 vs 102');
  });
});
