import { WEB_MAX_1M_RANGE_DAYS, WebLiquidationBucketSchema } from '@trade-automation/contracts';
import { bucketFor, isServed, TIMEFRAMES, WINDOW_DAYS, windowFor } from './time-range';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;

describe('windowFor (the window follows the timeframe)', () => {
  it('ends at the given time and opens with the frame\'s span', () => {
    expect(windowFor('1m', NOW)).toEqual({ fromMs: NOW - DAY, toMs: NOW });
    expect(windowFor('15m', NOW).fromMs).toBe(NOW - 7 * DAY);
    expect(windowFor('1h', NOW).fromMs).toBe(NOW - 30 * DAY);
    expect(windowFor('4h', NOW).fromMs).toBe(NOW - 90 * DAY);
    expect(windowFor('1d', NOW).fromMs).toBe(NOW - 90 * DAY);
  });

  it('widens with the bar, so an intraday frame never opens on fewer than 365 bars', () => {
    const intraday = TIMEFRAMES.filter((tf) => tf !== '1d');
    const bars = intraday.map((tf) => (WINDOW_DAYS[tf] * 1440) / { '1m': 1, '15m': 15, '1h': 60, '4h': 240 }[tf as '1m']);
    for (const n of bars) expect(n).toBeGreaterThanOrEqual(365);
  });

  it('opens 1d on the widest window the server serves, since its reads include 1m-granular series', () => {
    expect(WINDOW_DAYS['1d']).toBe(WEB_MAX_1M_RANGE_DAYS);
  });
});

describe('every offered timeframe is served', () => {
  it('no window is one the server refuses (any frame over WEB_MAX_1M_RANGE_DAYS)', () => {
    for (const tf of TIMEFRAMES) expect(isServed(tf)).toBe(true);
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
  });

  it('only ever answers a bucket the contract accepts', () => {
    for (const tf of TIMEFRAMES) expect(WebLiquidationBucketSchema.safeParse(bucketFor(tf)).success).toBe(true);
  });
});
