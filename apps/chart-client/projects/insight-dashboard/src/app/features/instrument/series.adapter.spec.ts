import {
  toCandleData, toCvdSegments, toFundingSteps, toLiquidationHistogram, toLongShortLine,
  toOpenInterestPoints, toPredictedFunding, toTakerDelta, toVolumeData,
} from './series.adapter';

/**
 * IB-031 — the instrument page's data mapping. These are the places a chart can quietly start
 * lying, so each rule has its own test rather than being implied by a happy path.
 */

const candle = (time: number, over: Partial<{ volume: number; takerBuyVolume: number | null }> = {}) => ({
  time, open: 100, high: 110, low: 90, close: 105, volume: 10, takerBuyVolume: 6, ...over,
});

describe('ordering', () => {
  it('sorts ascending — lightweight-charts throws on unordered data and the panel goes blank', () => {
    const out = toCandleData([candle(300), candle(100), candle(200)]);
    expect(out.map((c) => c.time)).toEqual([100, 200, 300]);
  });

  it('de-duplicates a repeated timestamp, last one winning', () => {
    const out = toCandleData([candle(100), { ...candle(100), close: 999 }]);
    expect(out).toHaveLength(1);
    expect(out[0].close).toBe(999);
  });
});

describe('toOpenInterestPoints', () => {
  it('converts seconds to MILLISECONDS, because that is what MetricPoint.time means', () => {
    // caught on the live acceptance run, not by this spec's first version, which asserted the
    // passthrough and so encoded the bug: the backtest adapter divides MetricPoint.time by 1000
    // on its way to the chart, so seconds in means 1970 on the chart and a paint-time throw
    const [point] = toOpenInterestPoints([{ time: 1_790_541_000, value: 1, notional: 2 }], 'i', '1m');
    expect(point.time).toBe(1_790_541_000_000);
    expect(Math.floor(point.time / 1000)).toBe(1_790_541_000); // what the renderer will do
  });

  it('emits the MetricPoint shape the existing renderer draws unchanged', () => {
    const points = toOpenInterestPoints([{ time: 100, value: 1500, notional: 90_000 }], 'binance:BTCUSDT', '15m');
    expect(points[0]).toEqual({
      metric: 'openInterest', instrument: 'binance:BTCUSDT', timeframe: '15m',
      time: 100_000, unit: 'base', value: 1500,
      ohlc: { open: 1500, high: 1500, low: 1500, close: 1500 },
      notional: 90_000, notionalBasis: 'venue', samples: 1,
      notionalOhlc: { open: 90_000, high: 90_000, low: 90_000, close: 90_000 },
    });
  });

  it('carries a flat notionalOhlc, which is all the renderer plots in its candle style', () => {
    // 2026-10-24: without it every point mapped to whitespace and OI vanished above 1m
    const [point] = toOpenInterestPoints([{ time: 1, value: 7, notional: 560 }], 'i', '1h');
    expect(point.notionalOhlc).toEqual({ open: 560, high: 560, low: 560, close: 560 });
  });

  it('a flat ohlc, because a snapshot has no range — wicks we did not measure would be invented', () => {
    const [point] = toOpenInterestPoints([{ time: 1, value: 7, notional: null }], 'i', '1h');
    expect(point.ohlc).toEqual({ open: 7, high: 7, low: 7, close: 7 });
    expect(point.samples).toBe(1);
  });

  it('omits notional entirely when the venue did not give one, rather than sending 0', () => {
    const [point] = toOpenInterestPoints([{ time: 1, value: 7, notional: null }], 'i', '1h');
    expect(point.notional).toBeUndefined();
    expect('notionalBasis' in point).toBe(false);
  });
});

describe('toCvdSegments', () => {
  it('accumulates 2·takerBuy − volume', () => {
    const [segment] = toCvdSegments([
      candle(100, { volume: 10, takerBuyVolume: 6 }), // +2
      candle(200, { volume: 10, takerBuyVolume: 4 }), // −2 → 0
      candle(300, { volume: 10, takerBuyVolume: 10 }), // +10 → 10
    ]);
    expect(segment.map((p) => p.value)).toEqual([2, 0, 10]);
  });

  it('BREAKS the line at a bar with no taker split instead of treating it as balanced flow', () => {
    // a null is "we do not know", and calling it zero drags CVD toward flat exactly where the
    // data is worst — a dead feed would read as balanced two-sided trading
    const segments = toCvdSegments([
      candle(100, { takerBuyVolume: 6 }),
      candle(200, { takerBuyVolume: null }),
      candle(300, { takerBuyVolume: 6 }),
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0].map((p) => p.time)).toEqual([100]);
    expect(segments[1].map((p) => p.time)).toEqual([300]);
  });

  it('the running total continues across the gap rather than restarting at zero', () => {
    const segments = toCvdSegments([
      candle(100, { volume: 10, takerBuyVolume: 10 }), // +10
      candle(200, { takerBuyVolume: null }),
      candle(300, { volume: 10, takerBuyVolume: 10 }), // +10 → 20, not 10
    ]);
    expect(segments[1][0].value).toBe(20);
  });

  it('is empty, not a crash, when nothing has a taker split', () => {
    expect(toCvdSegments([candle(1, { takerBuyVolume: null })])).toEqual([]);
  });
});

describe('toTakerDelta', () => {
  it('drops bars with no split rather than plotting them as zero', () => {
    const out = toTakerDelta([candle(100, { takerBuyVolume: 6 }), candle(200, { takerBuyVolume: null })]);
    expect(out).toEqual([{ time: 100, value: 2 }]);
  });

  it('is negative when sellers dominate', () => {
    expect(toTakerDelta([candle(1, { volume: 10, takerBuyVolume: 2 })])[0].value).toBe(-6);
  });
});

describe('toFundingSteps', () => {
  it('holds each rate until the next settlement — a step, not a drift', () => {
    const out = toFundingSteps([{ time: 100, rate: 0.0001 }, { time: 200, rate: -0.0002 }]);
    expect(out.map((p) => p.time)).toEqual([100, 199, 200]);
    expect(out[0].value).toBeCloseTo(0.01, 12);
    expect(out[1].value).toBeCloseTo(0.01, 12);
    expect(out[2].value).toBeCloseTo(-0.02, 12);
  });

  it('a single settlement is one point, with nothing invented after it', () => {
    const out = toFundingSteps([{ time: 100, rate: 0.0001 }]);
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(0.01, 12);
  });

  it('keeps a negative rate — the sign is the signal', () => {
    expect(toFundingSteps([{ time: 1, rate: -0.00075 }])[0].value).toBeCloseTo(-0.075, 12);
  });

  it('draws the venue FRACTION as a percentage, because the pane is labelled %', () => {
    // 0.0001 per interval is 0.01 %; drawing 0.0001 under a % label understates it 100-fold
    expect(toFundingSteps([{ time: 1, rate: 0.0001 }])[0].value).not.toBeCloseTo(0.0001, 6);
    expect(toFundingSteps([{ time: 1, rate: 0.0001 }])[0].value).toBeCloseTo(0.01, 12);
  });
});

describe('toLiquidationHistogram', () => {
  const colors = { long: '#ef5350', short: '#26a69a' };

  it('gives two series per bucket: longs positive, shorts negative', () => {
    // one summed bar would hide which side was liquidated, which is the pane's whole point
    const out = toLiquidationHistogram([{ time: 100, long: 500, short: 200, events: 3 }], colors);
    expect(out.longs).toEqual([{ time: 100, value: 500, color: colors.long }]);
    expect(out.shorts).toEqual([{ time: 100, value: -200, color: colors.short }]);
  });

  it('keeps empty buckets as zero bars, so quiet periods are not compressed away', () => {
    const out = toLiquidationHistogram([
      { time: 100, long: 0, short: 0, events: 0 },
      { time: 160, long: 5, short: 0, events: 1 },
    ], colors);
    expect(out.longs.map((b) => b.value)).toEqual([0, 5]);
  });
});

describe('the simple mappings', () => {
  it('volume and long/short come through in order', () => {
    expect(toVolumeData([candle(200, { volume: 5 }), candle(100, { volume: 3 })]))
      .toEqual([{ time: 100, value: 3 }, { time: 200, value: 5 }]);
    expect(toLongShortLine({ points: [{ time: 2, ratio: 1.5 }, { time: 1, ratio: 0.9 }] }))
      .toEqual([{ time: 1, value: 0.9 }, { time: 2, value: 1.5 }]);
  });

  it('predicted funding is a plain line', () => {
    const out = toPredictedFunding({ predicted: [{ time: 1, rate: 0.0001 }] });
    expect(out).toHaveLength(1);
    expect(out[0].time).toBe(1);
    expect(out[0].value).toBeCloseTo(0.01, 12); // percent, like the settled steps
  });

  it('empty in, empty out, for every mapping', () => {
    expect(toCandleData([])).toEqual([]);
    expect(toVolumeData([])).toEqual([]);
    expect(toOpenInterestPoints([], 'i', '1h')).toEqual([]);
    expect(toFundingSteps([])).toEqual([]);
    expect(toLiquidationHistogram([], { long: 'a', short: 'b' })).toEqual({ longs: [], shorts: [] });
  });
});
