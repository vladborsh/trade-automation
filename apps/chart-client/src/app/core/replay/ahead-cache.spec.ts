import type { CompactCandleTuple } from '@trade-automation/contracts';
import { AheadCache, tupleToCandle } from './ahead-cache';

const M = 60_000;
const t = (min: number, close = min): CompactCandleTuple => [min * M, close, close + 1, close - 1, close, 1];

function cache(fromMin: number, mins: number[], endOfTape = false): AheadCache {
  const c = new AheadCache('binance:BTCUSDT');
  c.reset(fromMin * M);
  c.appendPage(mins.map((m) => t(m)), endOfTape);
  return c;
}

describe('AheadCache (backtest-app-system-design.md §5.3)', () => {
  it('knows the range a page covers: to just past its last candle, or to infinity at endOfTape', () => {
    const open = cache(0, [0, 1, 2]);
    expect(open.knownFrom).toBe(0);
    expect(open.knownUntil).toBe(2 * M + 1);
    expect(open.endOfTape).toBe(false);

    const ended = cache(0, [0, 1], true);
    expect(ended.knownUntil).toBe(Number.POSITIVE_INFINITY);
  });

  it('finds the next held candle across a gap, by binary search', () => {
    const c = cache(0, [0, 1, 2, 50, 51]);
    expect(c.firstAtOrAfter(3 * M)).toBe(50 * M);
    expect(c.firstAtOrAfter(51 * M)).toBe(51 * M);
    expect(c.firstAtOrAfter(52 * M)).toBeNull();
    expect(c.countAtOrAfter(2 * M)).toBe(3);
  });

  it('reveals a 1m candle only once its minute has closed (openTime + 60 000 <= upTo)', () => {
    const c = cache(0, [0, 1, 2, 3]);
    expect(c.revealed(0, 2 * M).map((x) => x.openTime)).toEqual([0, M]);
    expect(c.revealed(M, 2 * M + 59_999).map((x) => x.openTime)).toEqual([M]);
    expect(c.revealed(0, 4 * M).map((x) => x.openTime)).toEqual([0, M, 2 * M, 3 * M]);
  });

  it('drops the past but keeps what is still needed', () => {
    const c = cache(0, [0, 1, 2, 3]);
    c.dropBefore(2 * M);
    expect(c.knownFrom).toBe(2 * M);
    expect(c.size).toBe(2);
    expect(c.firstAtOrAfter(0)).toBe(2 * M);
  });

  it('extends the known range backwards for a coarser timeframe', () => {
    const c = cache(10, [10, 11]);
    c.prependRange(5 * M, [t(4), t(5), t(7), t(10)]); // 4 is before the range, 10 is already held
    expect(c.knownFrom).toBe(5 * M);
    expect(c.revealed(0, 12 * M).map((x) => x.openTime / M)).toEqual([5, 7, 10, 11]);
  });

  it('ignores a page that repeats candles it already holds', () => {
    const c = cache(0, [0, 1]);
    c.appendPage([t(1), t(2)], false);
    expect(c.revealed(0, 10 * M).map((x) => x.openTime / M)).toEqual([0, 1, 2]);
  });
});

describe('tupleToCandle', () => {
  it('rebuilds a closed stored 1m candle', () => {
    expect(tupleToCandle([60_000, 1, 2, 0.5, 1.5, 7], 'binance:BTCUSDT')).toEqual({
      instrument: 'binance:BTCUSDT',
      timeframe: '1m',
      openTime: 60_000,
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 7,
      closed: true,
      source: 'storage',
    });
  });
});
