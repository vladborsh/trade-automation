import { AHEAD_PAGE_SIZE, cacheSizing } from './cache-sizing';

describe('cacheSizing (backtest-app-system-design.md §5.3)', () => {
  it('is 500 bars ahead, refill at 100, up to 1h', () => {
    expect(cacheSizing('1m')).toEqual({ target1m: 500, refill1m: 100 });
    expect(cacheSizing('5m')).toEqual({ target1m: 2_500, refill1m: 500 });
    expect(cacheSizing('15m')).toEqual({ target1m: 7_500, refill1m: 1_500 });
    expect(cacheSizing('1h')).toEqual({ target1m: 30_000, refill1m: 6_000 });
  });

  it('caps 4h and 1d at 50 000 / 10 000', () => {
    expect(cacheSizing('4h')).toEqual({ target1m: 50_000, refill1m: 10_000 });
    expect(cacheSizing('1d')).toEqual({ target1m: 50_000, refill1m: 10_000 });
  });

  it('fetches in pages of 5000', () => {
    expect(AHEAD_PAGE_SIZE).toBe(5_000);
  });
});
