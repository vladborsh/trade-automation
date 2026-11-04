import type { PaneData } from './pane-data';
import { appendLater, isBeforeHistory, prependEarlier } from './pane-merge';

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
    calendarEvents: [{ id: `ev:${t}`, scheduledAt: t * 1000, revision: 1 } as never],
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

describe('prependEarlier — calendar events (IB-060)', () => {
  it('joins both reads, one per id, the current read winning at the seam', () => {
    const seam = { id: 'ev:seam', scheduledAt: 5_000_000, revision: 1 } as never;
    const revised = { id: 'ev:seam', scheduledAt: 5_000_000, revision: 2 } as never;
    const out = prependEarlier(window(7_200, { calendarEvents: [revised] }), window(3_600, { calendarEvents: [{ id: 'ev:a', scheduledAt: 1_000, revision: 1 } as never, seam] }));
    expect(out.calendarEvents.map((e) => [e.id, e.revision])).toEqual([['ev:a', 1], ['ev:seam', 2]]);
  });
});

describe('appendLater (IB-066)', () => {
  const current = window(7_200, { candles: { ...window(0).candles, candles: [candle(3_600), candle(7_200, 10)] } });

  it('replaces the forming candle and appends the new one, in order', () => {
    const out = appendLater(current, { candles: [candle(7_200, 11), candle(10_800, 12)] });
    expect(out.candles.candles.map((c) => [c.time, c.close])).toEqual([[3_600, 1], [7_200, 11], [10_800, 12]]);
  });

  it('a duplicate at the seam is one bar, the tail winning', () => {
    const out = appendLater(current, { candles: [candle(7_200, 99)] });
    expect(out.candles.candles).toHaveLength(2);
    expect(out.candles.candles[1].close).toBe(99);
  });

  it('an empty tail changes no series', () => {
    const out = appendLater(current, { candles: [], openInterest: [], liquidationEvents: [] });
    expect(out.candles.candles).toEqual(current.candles.candles);
    expect(out.openInterest).toEqual(current.openInterest);
    expect(out.liquidationEvents).toEqual(current.liquidationEvents);
    expect(appendLater(current, {}).funding).toBe(current.funding);
  });

  it('marks the result as a later extension, not an earlier one', () => {
    const scrolled = prependEarlier(current, window(0));
    const out = appendLater(scrolled, {});
    expect(out.extendsLater).toBe(true);
    expect(out.extendsPrevious).toBe(false);
    expect(prependEarlier(out, window(-3_600)).extendsLater).toBe(false);
  });

  it('the minute\'s panes merge by time too: the filling bucket replaced, new points appended', () => {
    const tail = window(10_800);
    const out = appendLater(current, {
      openInterest: [{ time: 7_200, value: 5, notional: null }, ...tail.openInterest],
      funding: tail.funding,
      longShort: tail.longShort,
      liquidations: { ...tail.liquidations, bars: [{ time: 7_200, long: 9, short: 9 }, ...tail.liquidations.bars], venuesPresent: ['okx'] } as never,
      liquidationEvents: tail.liquidationEvents,
    });
    expect(out.openInterest.map((p) => [p.time, p.value])).toEqual([[7_200, 5], [10_800, 10_800]]);
    expect(out.funding.settled[0].points.map((p) => p.time)).toEqual([7_200, 10_800]);
    expect(out.funding.predicted.map((p) => p.time)).toEqual([7_200, 10_800]);
    expect(out.longShort.points.map((p) => p.time)).toEqual([7_200, 10_800]);
    expect(out.liquidations.bars.map((b) => [b.time, b.long])).toEqual([[7_200, 9], [10_800, 1]]);
    expect(out.liquidations.venuesPresent).toEqual(['okx']);
    expect(out.liquidationEvents.map((e) => e.time)).toEqual([7_200, 10_800]);
  });

  it('a liquidation read twice is drawn once; two in the same second are both kept', () => {
    const a = { time: 7_200, side: 'long', usd: 1_000, price: 1, venue: 'binance' } as const;
    const b = { ...a, usd: 2_000 };
    const base = window(7_200, { liquidationEvents: [a] });
    expect(appendLater(base, { liquidationEvents: [a, b] }).liquidationEvents).toEqual([a, b]);
  });

  // IB-066 × IB-068: the load and the tail both read grouped rows (`tf`), one per bar, side and
  // venue. The forming bar's row grows between reads, so its sum differs and the raw-event key
  // (which includes `usd`) kept both: that bar's liquidations were drawn twice.
  describe('grouped liquidation rows', () => {
    const row = { time: 7_200, side: 'long', usd: 1_000, price: 100, venue: 'binance', count: 2, maxUsd: 600 } as const;

    it('the forming bar\'s row is replaced by the tail\'s, its larger sum winning', () => {
      const base = window(7_200, { liquidationEvents: [row] });
      const grown = { ...row, usd: 1_500, price: 101, count: 3 };
      const out = appendLater(base, { liquidationEvents: [grown] }).liquidationEvents;
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual(grown);
    });

    it('a new bar is appended, the forming one still replaced', () => {
      const base = window(7_200, { liquidationEvents: [row] });
      const grown = { ...row, usd: 1_800, count: 4 };
      const next = { ...row, time: 10_800, usd: 50, count: 1, maxUsd: 50 };
      const out = appendLater(base, { liquidationEvents: [grown, next] }).liquidationEvents;
      expect(out.map((e) => [e.time, e.usd, e.count])).toEqual([[7_200, 1_800, 4], [10_800, 50, 1]]);
    });

    it('another side or venue in the same bar is its own row', () => {
      const base = window(7_200, { liquidationEvents: [row] });
      const short = { ...row, side: 'short' as const, usd: 10 };
      const okx = { ...row, venue: 'okx', usd: 20 };
      expect(appendLater(base, { liquidationEvents: [short, okx] }).liquidationEvents).toHaveLength(3);
    });
  });

  it('daily candles: the forming day replaced, the new day appended', () => {
    const base = window(7_200, { dailyCandles: [candle(0, 1), candle(86_400, 2)] });
    const out = appendLater(base, { dailyCandles: [candle(86_400, 3), candle(172_800, 4)] });
    expect(out.dailyCandles.map((c) => [c.time, c.close])).toEqual([[0, 1], [86_400, 3], [172_800, 4]]);
  });
});

describe('IB-081 — coverage and unavailable venues survive the joins', () => {
  const ls = (t: number, cov: { coverageFrom?: number; truncated?: boolean } = {}) =>
    ({ symbol: 'BTCUSDT', kind: 'global_account' as const, points: [{ time: t, ratio: 1 }], downsampled: false, ...cov });

  it('scrolling left: the joined OI and long/short begin where the EARLIER read begins', () => {
    const current = window(7_200, { openInterestCoverage: {}, longShort: ls(7_200) });
    const earlier = window(3_600, { openInterestCoverage: { coverageFrom: 3_000, truncated: true }, longShort: ls(3_600, { coverageFrom: 3_000, truncated: true }) });
    const out = prependEarlier(current, earlier);
    // the first DRAWN point is 3 600, so that is where the label must say the series begins
    expect(out.openInterestCoverage).toEqual({ coverageFrom: 3_600, truncated: true });
    expect(out.longShort.coverageFrom).toBe(3_600);
    expect(out.longShort.truncated).toBe(true);
  });

  it('scrolling left past a truncated window: the earlier read reached its whole window, so the label goes', () => {
    // the window on screen started late; the earlier one did not, so nothing is missing any more
    const current = window(7_200, { openInterestCoverage: { coverageFrom: 7_000, truncated: true }, longShort: ls(7_200, { coverageFrom: 7_000, truncated: true }) });
    const out = prependEarlier(current, window(3_600, { openInterestCoverage: {}, longShort: ls(3_600) }));
    expect(out.openInterestCoverage).toEqual({});
    expect('coverageFrom' in out.longShort).toBe(false);
    expect('truncated' in out.longShort).toBe(false);
  });

  it('funding: a venue missing from either read stays named; none missing leaves the field absent', () => {
    const f = (unavailable?: string[]) => ({ ...window(0).funding, ...(unavailable ? { unavailable } : {}) });
    expect(prependEarlier(window(7_200, { funding: f(['okx']) }), window(3_600, { funding: f(['bybit']) })).funding.unavailable).toEqual(['bybit', 'okx']);
    expect('unavailable' in prependEarlier(window(7_200), window(3_600)).funding).toBe(false);
    expect(appendLater(window(7_200, { funding: f() }), { funding: f(['okx']) }).funding.unavailable).toEqual(['okx']);
    expect('unavailable' in appendLater(window(7_200), { funding: f() }).funding).toBe(false);
  });

  it('the live tail does not move where the series begins', () => {
    const current = window(7_200, { longShort: ls(7_200, { coverageFrom: 7_000, truncated: true }) });
    const out = appendLater(current, { longShort: ls(10_800), openInterest: [{ time: 10_800, value: 1, notional: null }] });
    expect(out.longShort.coverageFrom).toBe(7_000);
    expect(out.longShort.truncated).toBe(true);
  });
});
