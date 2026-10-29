import {
  WEB_MAX_1M_RANGE_DAYS, WEB_MAX_CANDLE_BARS, WEB_MAX_POINTS, WebLiquidationBucketSchema, WebTimeframeSchema,
} from '@trade-automation/contracts';
import { LEVELS_LOOKBACK_DAYS } from './instrument-window';
import { bucketFor, isServed, sideWindow, TIMEFRAMES, timeframeLabel, WINDOW_DAYS, windowFor } from './time-range';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;
const MINUTES = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1_440, '1w': 10_080 } as const;

describe('windowFor (the window follows the timeframe)', () => {
  it('ends at the given time and opens with the frame\'s span', () => {
    expect(windowFor('1m', NOW)).toEqual({ fromMs: NOW - DAY, toMs: NOW });
    expect(windowFor('3m', NOW).fromMs).toBe(NOW - 3 * DAY);
    expect(windowFor('5m', NOW).fromMs).toBe(NOW - 5 * DAY);
    expect(windowFor('15m', NOW).fromMs).toBe(NOW - 7 * DAY);
    expect(windowFor('1h', NOW).fromMs).toBe(NOW - 30 * DAY);
    expect(windowFor('4h', NOW).fromMs).toBe(NOW - 90 * DAY);
    expect(windowFor('1d', NOW).fromMs).toBe(NOW - 90 * DAY);
    expect(windowFor('1w', NOW).fromMs).toBe(NOW - 728 * DAY);
  });

  it('widens with the bar, so an intraday frame never opens on fewer than 365 bars', () => {
    const intraday = TIMEFRAMES.filter((tf) => tf !== '1d' && tf !== '1w');
    for (const tf of intraday) expect((WINDOW_DAYS[tf] * 1440) / MINUTES[tf]).toBeGreaterThanOrEqual(365);
  });

  it('opens 1d on the widest window the server serves, since its reads include 1m-granular series', () => {
    expect(WINDOW_DAYS['1d']).toBe(WEB_MAX_1M_RANGE_DAYS);
  });

  it('IB-065: 1W opens on at least 100 weeks', () => {
    expect(WINDOW_DAYS['1w'] / 7).toBeGreaterThanOrEqual(100);
  });
});

describe('TIMEFRAMES', () => {
  it('offers every timeframe the contract has, in order of width', () => {
    expect([...TIMEFRAMES].sort()).toEqual([...WebTimeframeSchema.options].sort());
    const widths = TIMEFRAMES.map((tf) => MINUTES[tf]);
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
  });

  it('labels the week 1W and leaves the rest as their ids', () => {
    expect(timeframeLabel('1w')).toBe('1W');
    expect(timeframeLabel('5m')).toBe('5m');
  });
});

describe('sideWindow (IB-065: the reads that are not candles)', () => {
  it('is the window itself when it fits the 1m-granular cap', () => {
    const w = windowFor('1d', NOW);
    expect(sideWindow(w.fromMs, w.toMs)).toEqual(w);
  });

  it('is the window\'s LAST 90 days when the window is wider — 1W is', () => {
    const w = windowFor('1w', NOW);
    expect(w.toMs - w.fromMs).toBeGreaterThan(WEB_MAX_1M_RANGE_DAYS * DAY); // the clamp is load-bearing
    expect(sideWindow(w.fromMs, w.toMs)).toEqual({ fromMs: NOW - WEB_MAX_1M_RANGE_DAYS * DAY, toMs: NOW });
  });
});

describe('every offered timeframe is served (isServed)', () => {
  it('no frame\'s window has a read the server refuses or thins', () => {
    for (const tf of TIMEFRAMES) expect(isServed(tf, LEVELS_LOOKBACK_DAYS)).toBe(true);
  });

  it('says no when a read would be refused: a levels lookback past the candle cap', () => {
    expect(isServed('1d', WEB_MAX_CANDLE_BARS)).toBe(false);
  });

  it('the side reads of every frame fit the cap, whatever the candle window', () => {
    for (const tf of TIMEFRAMES) {
      const w = windowFor(tf, NOW);
      const side = sideWindow(w.fromMs, w.toMs);
      expect(side.toMs - side.fromMs).toBeLessThanOrEqual(WEB_MAX_1M_RANGE_DAYS * DAY);
    }
  });
});

describe('bucketFor', () => {
  it('follows the timeframe where the server has that bucket', () => {
    expect(bucketFor('1m')).toBe('1m');
    expect(bucketFor('15m')).toBe('15m');
    expect(bucketFor('1h')).toBe('1h');
  });

  it('falls back to the coarsest bucket the server accepts above 1h', () => {
    expect(bucketFor('4h')).toBe('1h');
    expect(bucketFor('1d')).toBe('1h');
    expect(bucketFor('1w')).toBe('1h');
  });

  it('IB-065: 3m takes 1m; 5m takes 15m because 1m buckets over its window would be thinned', () => {
    expect(bucketFor('3m')).toBe('1m');
    expect(bucketFor('5m')).toBe('15m');
    expect(WINDOW_DAYS['3m'] * 1440).toBeLessThanOrEqual(WEB_MAX_POINTS);
    expect(WINDOW_DAYS['5m'] * 1440).toBeGreaterThan(WEB_MAX_POINTS); // the reason 5m is not on 1m
  });

  it('only ever answers a bucket the contract accepts', () => {
    for (const tf of TIMEFRAMES) expect(WebLiquidationBucketSchema.safeParse(bucketFor(tf)).success).toBe(true);
  });
});
