import { mergeCandle, prependHistory, CandlesStore } from './candles.store';
import type { Candle } from '../contracts/contracts';

function candle(openTime: number, close: number, closed = true): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed,
    source: 'venue-stream',
  };
}

describe('mergeCandle', () => {
  it('appends a candle with a newer openTime', () => {
    const series = [candle(1000, 10)];
    const result = mergeCandle(series, candle(2000, 11));
    expect(result.map((c) => c.openTime)).toEqual([1000, 2000]);
  });

  it('replaces the last candle when openTime matches (forming-bar update)', () => {
    const series = [candle(1000, 10), candle(2000, 11, false)];
    const updated = candle(2000, 12, false);
    const result = mergeCandle(series, updated);
    expect(result).toHaveLength(2);
    expect(result[1].close).toBe(12);
    expect(result[1].closed).toBe(false);
  });

  it('replaces the forming bar with its closed version at the same openTime', () => {
    const series = [candle(1000, 10), candle(2000, 11, false)];
    const closed = candle(2000, 11.5, true);
    const result = mergeCandle(series, closed);
    expect(result[1].closed).toBe(true);
    expect(result[1].close).toBe(11.5);
  });

  it('ignores a frame older than everything in the series', () => {
    const series = [candle(2000, 10), candle(3000, 11)];
    const result = mergeCandle(series, candle(1000, 999));
    expect(result.map((c) => c.openTime)).toEqual([2000, 3000]);
  });

  it('seeds an empty series with the first candle', () => {
    const result = mergeCandle([], candle(1000, 10));
    expect(result).toEqual([candle(1000, 10)]);
  });
});

describe('prependHistory', () => {
  it('prepends an older page ascending before the current series', () => {
    const series = [candle(3000, 10), candle(4000, 11)];
    const older = [candle(1000, 8), candle(2000, 9)];
    const result = prependHistory(series, older);
    expect(result.map((c) => c.openTime)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('drops overlapping bars at the boundary', () => {
    const series = [candle(2000, 9), candle(3000, 10)];
    const older = [candle(1000, 7), candle(2000, 999)]; // 2000 overlaps — must not duplicate
    const result = prependHistory(series, older);
    expect(result.map((c) => c.openTime)).toEqual([1000, 2000, 3000]);
    expect(result[1].close).toBe(9); // the known bar wins, not the overlapping fetched one
  });

  it('is a no-op when there is nothing older to add', () => {
    const series = [candle(1000, 10)];
    expect(prependHistory(series, [])).toEqual(series);
  });
});

describe('CandlesStore', () => {
  it('tracks first/last openTime and merges live updates through the signal', () => {
    const store = new CandlesStore();
    store.setHistory([candle(1000, 10), candle(2000, 11)]);
    expect(store.firstOpenTime()).toBe(1000);
    expect(store.lastOpenTime()).toBe(2000);

    store.mergeLive(candle(3000, 12));
    expect(store.candles().map((c) => c.openTime)).toEqual([1000, 2000, 3000]);
    expect(store.lastOpenTime()).toBe(3000);

    store.clear();
    expect(store.candles()).toEqual([]);
    expect(store.lastOpenTime()).toBeNull();
  });
});
