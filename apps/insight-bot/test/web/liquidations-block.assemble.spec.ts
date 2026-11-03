import { availableFrom, hourly, largeEvents, periodNorm, verdict } from '../../src/web/liquidations/block.assemble';
import type { BucketRow, FeedRow } from '../../src/web/liquidations/pg/overview.repo';

/** IB-084 D8, D14 — the block's pure rules. */
const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 3, 12); // on an hour boundary
const DAY = 24 * H;
const bucket = (t: number, usd: number, side: 'long' | 'short' = 'long', symbolId: string | null = 'BTCUSDT'): BucketRow => ({ symbolId, side, bucketMs: t, usd });

describe('hourly bars and their norm', () => {
  it('AN EMPTY BUCKET IS A 0 IN THE NORM SAMPLE, not a gap — so one busy hour among quiet ones is rare', () => {
    // 10 days of history; only 20 hours ever had anything. The median of the sample must be 0, and
    // a 5 000 hour now must rank at the top, which only happens if the ~220 empty hours are counted.
    const rows: BucketRow[] = [];
    for (let i = 0; i < 20; i++) rows.push(bucket(NOW - (i * 11 + 30) * H, 100));
    rows.push(bucket(NOW - 2 * H, 5_000));
    const out = hourly({ periodSec: 86_400, bucketSec: 3_600, nowMs: NOW, buckets: rows, periodStartMs: NOW - 10 * DAY, venues: ['bybit'] });
    expect(out.basis.windowsInPeriod).toBe(240);
    expect(out.basis.windowsObserved).toBe(21);
    expect(out.norm.total).toBe(0); // median of mostly zeros
    const busy = out.buckets.find((b) => b.time === (NOW - 2 * H) / 1000);
    expect(busy?.rarity).toBeGreaterThan(0.99);
    expect(busy?.outlier).toBe(true);
    const quiet = out.buckets.find((b) => b.time === (NOW - 3 * H) / 1000);
    expect(quiet?.outlier).toBe(false);
  });

  it('with now on a boundary, 24h is exactly 24 complete hourly bars', () => {
    const out = hourly({ periodSec: 86_400, bucketSec: 3_600, nowMs: NOW, buckets: [], periodStartMs: NOW - 10 * DAY, venues: [] });
    expect(out.buckets).toHaveLength(24);
    expect(out.buckets.every((b) => !b.partial)).toBe(true);
  });

  it('mid-hour, the ends that stick out are partial and carry no rarity', () => {
    const out = hourly({ periodSec: 14_400, bucketSec: 3_600, nowMs: NOW + 30 * 60_000, buckets: [], periodStartMs: NOW - 10 * DAY, venues: [] });
    expect(out.buckets).toHaveLength(5);
    expect(out.buckets[0].partial).toBe(true);
    expect(out.buckets[4].partial).toBe(true);
    expect(out.buckets[4].rarity).toBeNull();
  });

  it('under 7 days of history: bars, but no norm, no rarity, no outliers — and the reason', () => {
    const out = hourly({ periodSec: 86_400, bucketSec: 3_600, nowMs: NOW, buckets: [bucket(NOW - H, 1e6)], periodStartMs: NOW - 2 * DAY, venues: ['okx'] });
    expect(out.basis.unavailable).toBe('insufficient_history');
    expect(out.norm).toEqual({ long: null, short: null, total: null });
    expect(out.buckets.every((b) => b.rarity === null && !b.outlier)).toBe(true);
  });
});

describe('periodNorm and verdict', () => {
  const totals = { usd: 3_000, long: 2_500, short: 500, events: 9 };

  it('7d ALWAYS refuses insufficient_history (D14), whatever the history', () => {
    const n = periodNorm({ period: '7d', totals, buckets: [], periodStartMs: NOW - 30 * DAY, nowMs: NOW, venues: ['bybit'] });
    expect(n.basis.unavailable).toBe('insufficient_history');
    expect(verdict(n)).toBeNull();
  });

  it('the verdict is the side furthest above its own norm', () => {
    const rows: BucketRow[] = [];
    const midnight = Date.UTC(2026, 10, 3); // daily windows align to UTC midnight
    for (let d = 1; d <= 20; d++) { rows.push(bucket(midnight - d * DAY, 500, 'long')); rows.push(bucket(midnight - d * DAY, 400, 'short')); }
    const n = periodNorm({ period: '24h', totals, buckets: rows, periodStartMs: NOW - 20 * DAY, nowMs: NOW, venues: ['bybit'] });
    expect(n.long.ratio).toBe(5);
    expect(n.short.ratio).toBe(1.25);
    expect(verdict(n)).toEqual({ side: 'long', ratio: 5 });
  });
});

describe('largeEvents', () => {
  const ev = (minute: number, usd: number, side: 'long' | 'short' = 'long'): FeedRow => ({
    timeSec: NOW / 1000 + minute * 60, symbolId: 'BTCUSDT', venueSymbol: 'BTCUSDT', base: 'BTC', side, usd, price: 1, venue: 'binance',
  });

  it('biggest first, xMedian against the median event, and a series found across events the limit cuts', () => {
    const events = [ev(0, 150_000), ev(3, 160_000), ev(6, 170_000), ev(9, 2_000_000, 'short')];
    const out = largeEvents({ events, minUsd: 100_000, limit: 2, medianEventUsd: 1_000, normPeriodDays: 20, minHistoryDays: 7 });
    expect(out.map((e) => e.usd)).toEqual([2_000_000, 170_000]);
    expect(out[0].xMedian).toBe(2_000);
    expect(out[0].seriesId).toBeNull();
    // the 170k is the third of a 3-event long series, though the other two are cut by the limit
    expect(out[1]).toMatchObject({ seriesCount: 3, seriesSpanSec: 360 });
  });

  it('no xMedian under 7 days of history', () => {
    const out = largeEvents({ events: [ev(0, 150_000)], minUsd: 100_000, limit: 10, medianEventUsd: 1_000, normPeriodDays: 3, minHistoryDays: 7 });
    expect(out[0].xMedian).toBeNull();
  });
});

describe('availableFrom (D14)', () => {
  it('7d becomes available a week after the first row; shorter periods sooner', () => {
    const out = availableFrom(NOW - 2 * DAY, NOW);
    expect(out['1h']).toBeNull();
    expect(out['24h']).toBeNull();
    expect(out['7d']).toBe((NOW + 5 * DAY) / 1000);
  });

  it('an empty box: every period is a full period away', () => {
    const out = availableFrom(null, NOW);
    expect(out['1h']).toBe((NOW + H) / 1000);
    expect(out['7d']).toBe((NOW + 7 * DAY) / 1000);
  });
});
