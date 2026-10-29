import type { PaneData } from './pane-data';
import { isBeforeHistory, prependEarlier } from './pane-merge';

const candle = (time: number, close = 1) => ({ time, open: 1, high: 1, low: 1, close, volume: 1, takerBuyVolume: 1 });

/** A window of one of everything at `t`, so each series' order after the join is visible. */
function window(t: number, over: Partial<PaneData> = {}): PaneData {
  return {
    instrument: 'binance:BTCUSDT', timeframe: '1h', bucket: '1m',
    candles: { venue: 'binance', symbol: 'BTCUSDT', market: 'perp', timeframe: '1h', candles: [candle(t)], downsampled: false } as never,
    openInterest: [{ time: t, value: t, notional: null }],
    funding: { symbol: 'BTCUSDT', settled: [{ venue: 'binance', points: [{ time: t, rate: 0.0001 }] }], predicted: [{ time: t, rate: t }], downsampled: false },
    longShort: { symbol: 'BTCUSDT', kind: 'global_account', points: [{ time: t, ratio: 1 }], downsampled: false },
    liquidations: { symbol: 'BTCUSDT', bucket: '1m', venue: 'all', venuesPresent: [], bars: [{ time: t, long: 1, short: 1 }], downsampled: false, undercounted: false } as never,
    liquidationEvents: [{ time: t } as never], liquidationVenues: ['binance'],
    dailyCandles: [candle(t, 2)],
    ...over,
  };
}

describe('prependEarlier', () => {
  const merged = prependEarlier(window(7_200), window(3_600));

  it('puts the earlier read first in every series', () => {
    expect(merged.candles.candles.map((c) => c.time)).toEqual([3_600, 7_200]);
    expect(merged.openInterest.map((p) => p.time)).toEqual([3_600, 7_200]);
    expect(merged.funding.settled[0].points.map((p) => p.time)).toEqual([3_600, 7_200]);
    expect(merged.longShort.points.map((p) => p.time)).toEqual([3_600, 7_200]);
    expect(merged.liquidations.bars.map((b) => b.time)).toEqual([3_600, 7_200]);
    expect(merged.liquidationEvents.map((e) => e.time)).toEqual([3_600, 7_200]);
    expect(merged.dailyCandles.map((c) => c.time)).toEqual([3_600, 7_200]);
  });

  it('keeps the current predicted funding: it is "now", not history', () => {
    expect(merged.funding.predicted).toEqual([{ time: 7_200, rate: 7_200 }]);
  });

  it('marks the result as an extension so the chart keeps the reader\'s view', () => {
    expect(merged.extendsPrevious).toBe(true);
  });

  it('a "thinned" or "missed something" flag holds if either read says so', () => {
    const thin = window(3_600);
    thin.candles = { ...thin.candles, downsampled: true };
    thin.liquidations = { ...thin.liquidations, undercounted: true };
    const out = prependEarlier(window(7_200), thin);
    expect(out.candles.downsampled).toBe(true);
    expect(out.liquidations.undercounted).toBe(true);
  });

  it('a funding venue present in only one read is kept, not dropped', () => {
    const earlier = window(3_600, { funding: { symbol: 'BTCUSDT', settled: [{ venue: 'okx', points: [{ time: 1, rate: 0 }] }], predicted: [], downsampled: false } });
    const out = prependEarlier(window(7_200), earlier);
    expect(out.funding.settled.map((v) => v.venue).sort()).toEqual(['binance', 'okx']);
  });

  it('daily candles overlap by the lookback: one per day, the current read winning', () => {
    const current = window(7_200, { dailyCandles: [candle(0, 5), candle(86_400, 6)] });
    const earlier = window(3_600, { dailyCandles: [candle(-86_400, 1), candle(0, 2)] });
    const out = prependEarlier(current, earlier);
    expect(out.dailyCandles.map((c) => [c.time, c.close])).toEqual([[-86_400, 1], [0, 5], [86_400, 6]]);
  });

  it('venues are a union without repeats', () => {
    const out = prependEarlier(window(7_200), window(3_600, { liquidationVenues: ['binance', 'bybit'] }));
    expect([...out.liquidationVenues].sort()).toEqual(['binance', 'bybit']);
  });
});

describe('isBeforeHistory', () => {
  it('is true only when the earlier read has no candles', () => {
    expect(isBeforeHistory(window(1))).toBe(false);
    const empty = window(1);
    empty.candles = { ...empty.candles, candles: [] };
    expect(isBeforeHistory(empty)).toBe(true);
  });
});
