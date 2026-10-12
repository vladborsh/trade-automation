import {
  completeWindowStarts, sampleFor, windowStats,
} from '../../src/web/liquidations/overview.assemble';
import type { BucketRow, TrailingRow } from '../../src/web/liquidations/pg/overview.repo';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 18, 0, 0); // exactly on an hour boundary

describe('completeWindowStarts', () => {
  it('excludes the window in progress', () => {
    // At 18:30 the window that STARTED at 18:00 does not end until 19:00, so it holds half an
    // hour of data. Counting it as an hour would halve it, and halve the median with it.
    const starts = completeWindowStarts(NOW - 3 * HOUR, NOW + 30 * 60_000, 3_600);
    expect(starts).toEqual([NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR]);
    expect(starts).not.toContain(NOW);
  });

  it('excludes a first window the period starts in the middle of', () => {
    const starts = completeWindowStarts(NOW - 2 * HOUR + 60_000, NOW, 3_600);
    expect(starts).toEqual([NOW - HOUR]);
  });

  it('is empty when the period is shorter than one window', () => {
    expect(completeWindowStarts(NOW - 60_000, NOW, 3_600)).toEqual([]);
  });
});

describe('sampleFor', () => {
  const starts = [NOW - 3 * HOUR, NOW - 2 * HOUR, NOW - HOUR];
  const buckets: BucketRow[] = [
    { symbolId: 'BTCUSDT', side: 'long', bucketMs: NOW - 3 * HOUR, usd: 100 },
    { symbolId: 'BTCUSDT', side: 'short', bucketMs: NOW - 3 * HOUR, usd: 40 },
    { symbolId: 'BTCUSDT', side: 'long', bucketMs: NOW - HOUR, usd: 900 },
  ];

  it('FILLS EMPTY WINDOWS WITH ZERO: a quiet hour is a measurement', () => {
    expect(sampleFor(buckets, starts, 'long')).toEqual([100, 0, 900]);
  });

  it('sums both sides when no side is given', () => {
    expect(sampleFor(buckets, starts, null)).toEqual([140, 0, 900]);
  });

  it('drops a bucket outside the grid rather than appending it', () => {
    // a partial window arriving from SQL must not become a full one by being pushed on the end
    const stray: BucketRow[] = [{ symbolId: 'BTCUSDT', side: 'long', bucketMs: NOW + HOUR, usd: 1e9 }];
    expect(sampleFor([...buckets, ...stray], starts, 'long')).toEqual([100, 0, 900]);
  });
});

describe('windowStats', () => {
  const PERIOD_START = NOW - 10 * 24 * HOUR;
  const venues = ['bybit', 'okx'];

  /** Ten days of hourly buckets: every hour holds 100 USD of longs, so the median is knowable. */
  const steadyBuckets = (symbolId: string | null): BucketRow[] =>
    completeWindowStarts(PERIOD_START, NOW, 3_600).map((bucketMs) => ({
      symbolId, side: 'long' as const, bucketMs, usd: 100,
    }));

  const trailing = (symbolId: string | null, usd: number, events = 3): TrailingRow[] => [
    { symbolId, side: 'long', usdByWindow: { 3600: usd }, eventsByWindow: { 3600: events } },
  ];

  it('divides the trailing hour by the median hour and states the basis', () => {
    const stats = windowStats({
      window: '1h', windowSec: 3_600, nowMs: NOW, periodStartMs: PERIOD_START,
      buckets: steadyBuckets('BTCUSDT'), trailing: trailing('BTCUSDT', 500), symbolId: 'BTCUSDT', venues,
    });
    expect(stats.long.median).toBe(100);
    expect(stats.long.ratio).toBe(5);
    expect(stats.basis.unavailable).toBeNull();
    expect(stats.basis.windowsInPeriod).toBe(stats.basis.windowsObserved); // every hour had data
    expect(stats.basis.venues).toEqual(['bybit', 'okx']);
    expect(stats.events).toBe(3);
  });

  it('MARKET-WIDE INCLUDES ROWS NO COIN CLAIMS', () => {
    // The unmapped row is in no coin's table row. If the headline dropped it too, the page would
    // under-report the market by exactly the amount it could not attribute — which is how
    // IB-BUG-011 read as a quiet market.
    const buckets: BucketRow[] = [
      { symbolId: 'BTCUSDT', side: 'long', bucketMs: NOW - HOUR, usd: 100 },
      { symbolId: null, side: 'long', bucketMs: NOW - HOUR, usd: 900 },
    ];
    const rows: TrailingRow[] = [
      { symbolId: 'BTCUSDT', side: 'long', usdByWindow: { 3600: 100 }, eventsByWindow: { 3600: 1 } },
      { symbolId: null, side: 'long', usdByWindow: { 3600: 900 }, eventsByWindow: { 3600: 1 } },
    ];
    const common = { window: '1h' as const, windowSec: 3_600, nowMs: NOW, periodStartMs: PERIOD_START, buckets, trailing: rows, venues };

    expect(windowStats({ ...common, symbolId: null }).total.usd).toBe(1000);
    expect(windowStats({ ...common, symbolId: null }).events).toBe(2);
    expect(windowStats({ ...common, symbolId: 'BTCUSDT' }).total.usd).toBe(100);
  });

  it('refuses a ratio when the period is under seven days, however loud the hour', () => {
    const shortPeriod = NOW - 3 * 24 * HOUR;
    const stats = windowStats({
      window: '1h', windowSec: 3_600, nowMs: NOW, periodStartMs: shortPeriod,
      buckets: steadyBuckets('BTCUSDT'), trailing: trailing('BTCUSDT', 1_000_000), symbolId: 'BTCUSDT', venues,
    });
    expect(stats.long.ratio).toBeNull();
    expect(stats.basis.unavailable).toBe('insufficient_history');
    expect(stats.long.usd).toBe(1_000_000); // the amount is still reported
  });

  it('refuses a ratio when nearly every window is empty, and says which case it is', () => {
    // The real local tape: 9 busy hours in 226. The median is 0, so there is no divisor.
    const starts = completeWindowStarts(PERIOD_START, NOW, 3_600);
    const buckets: BucketRow[] = starts.slice(0, 9).map((bucketMs) => ({
      symbolId: 'BTCUSDT', side: 'long' as const, bucketMs, usd: 5_000,
    }));
    const stats = windowStats({
      window: '1h', windowSec: 3_600, nowMs: NOW, periodStartMs: PERIOD_START,
      buckets, trailing: trailing('BTCUSDT', 5_000), symbolId: 'BTCUSDT', venues,
    });
    expect(stats.long.ratio).toBeNull();
    expect(stats.long.median).toBe(0);
    expect(stats.basis.unavailable).toBe('no_norm');
    expect(stats.basis.windowsObserved).toBe(9);
    expect(stats.basis.windowsInPeriod).toBe(starts.length);
  });
});
