import { WebLiquidationBucketSchema } from '@trade-automation/contracts';
import { bucketFor, isServed, TIMEFRAMES, WINDOW_DAYS, windowFor } from './time-range';

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const DAY = 86_400_000;

describe('windowFor (the window follows the timeframe)', () => {
  it('ends at the given time and opens with the frame\'s span', () => {
    expect(windowFor('1m', NOW)).toEqual({ fromMs: NOW - DAY, toMs: NOW });
    expect(windowFor('15m', NOW).fromMs).toBe(NOW - 7 * DAY);
    expect(windowFor('1h', NOW).fromMs).toBe(NOW - 30 * DAY);
    expect(windowFor('4h', NOW).fromMs).toBe(NOW - 90 * DAY);
    expect(windowFor('1d', NOW).fromMs).toBe(NOW - 365 * DAY);
  });

  it('widens with the bar, so a coarser frame never opens on fewer bars than a finer one', () => {
    const bars = TIMEFRAMES.map((tf) => (WINDOW_DAYS[tf] * 1440) / { '1m': 1, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 }[tf]);
    for (const n of bars) expect(n).toBeGreaterThanOrEqual(365);
  });
});

describe('every offered timeframe is served', () => {
  it('no window is one the server refuses (1m over WEB_MAX_1M_RANGE_DAYS)', () => {
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
