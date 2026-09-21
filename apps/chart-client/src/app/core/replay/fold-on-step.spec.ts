import type { Candle, Timeframe } from '@trade-automation/contracts';
import { foldOneMinute } from '@trade-automation/replay-core';
import { bucketStart, foldStep, seriesAt, seriesBars, type TfSeries } from './fold-on-step';

const M = 60_000;

function m1(min: number, close: number, volume = 1): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime: min * M,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume,
    closed: true,
    source: 'storage',
  };
}

/** 1m from minute 0 to 59 except a gap 20..34 (an empty stretch inside the hour). */
const TAPE = Array.from({ length: 60 }, (_, i) => i)
  .filter((i) => i < 20 || i >= 35)
  .map((i) => m1(i, 100 + i, i + 1));

/** Folds step by step from `cursors[0]`, as the engine does; returns the series at each cursor. */
function stepThrough(tf: Timeframe, cursors: number[]): TfSeries {
  const start = foldOneMinute(TAPE, tf, cursors[0]);
  let series: TfSeries = { closed: start.closed, forming: start.forming };
  for (let i = 1; i < cursors.length; i++) {
    const from = bucketStart(cursors[i - 1], tf);
    const revealed = TAPE.filter((c) => c.openTime >= from && c.openTime + M <= cursors[i]);
    series = foldStep(series, revealed, tf, cursors[i]);
  }
  return series;
}

describe('bucketStart', () => {
  it('is the open of the bar containing the cursor (the cursor itself on a boundary)', () => {
    expect(bucketStart(7 * M, '5m')).toBe(5 * M);
    expect(bucketStart(10 * M, '5m')).toBe(10 * M);
  });
});

describe('foldStep (§5.4 step 2)', () => {
  it('steps bar by bar to exactly what one fold of the whole tape gives', () => {
    const cursors = [3, 5, 10, 15, 20, 40, 45, 50, 55, 60].map((m) => m * M); // 20 -> 40 jumps the gap
    const stepped = stepThrough('5m', cursors);
    const once = foldOneMinute(TAPE, '5m', 60 * M);
    expect(seriesBars(stepped)).toEqual([...once.closed, ...(once.forming ? [once.forming] : [])]);
  });

  it('rebuilds a forming bar that grows across steps, mid-bar and off-boundary', () => {
    const cursors = [2, 4, 7, 9, 13, 38, 41].map((m) => m * M);
    const stepped = stepThrough('15m', cursors);
    const once = foldOneMinute(TAPE, '15m', 41 * M);
    expect(stepped.closed).toEqual(once.closed);
    expect(stepped.forming).toEqual(once.forming);
    expect(stepped.forming?.openTime).toBe(30 * M);
  });

  it('closes the last bar before a gap (BUG-001 semantics, via foldOneMinute)', () => {
    const stepped = stepThrough('5m', [18 * M, 37 * M]);
    expect(stepped.closed.map((c) => c.openTime / M)).toEqual([0, 5, 10, 15]);
    expect(stepped.forming?.openTime).toBe(35 * M);
  });

  it('leaves the closed bars untouched while the same bar keeps forming', () => {
    const before: TfSeries = { closed: [m1(0, 1)], forming: null };
    const after = foldStep(before, [m1(10, 5)], '1h', 11 * M);
    expect(after.closed).toBe(before.closed);
    expect(after.forming?.close).toBe(5);
  });
});

describe('seriesAt (timeframe switch while the client is ahead of the server cursor)', () => {
  it('server bars before the anchor + a fold from it = one fold of the whole tape at the cursor', () => {
    const cursor = 52 * M;
    for (const [tf, anchorMin] of [['15m', 15], ['5m', 40], ['15m', 45], ['1h', 0]] as const) {
      const anchor = anchorMin * M;
      const before = foldOneMinute(TAPE, tf, anchor).closed;
      const rest = TAPE.filter((c) => c.openTime >= anchor);
      const once = foldOneMinute(TAPE, tf, cursor);
      expect(seriesBars(seriesAt(before, rest, tf, cursor))).toEqual(seriesBars({ closed: once.closed, forming: once.forming }));
    }
  });
});
