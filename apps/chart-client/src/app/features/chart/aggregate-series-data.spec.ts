import type { LineData } from 'lightweight-charts';
import { ALL, BN, BY, HL, aggPoint } from '../aggregate/aggregate-test-points';
import {
  aggregateBarStyle,
  seamMarkers,
  splitAggregateLine,
  toAggregateCandleData,
} from './aggregate-series-data';

const T = 300_000;

describe('aggregateBarStyle (aggregate-oi.md §1 point 1)', () => {
  it('complete bars: solid OI colours', () => {
    expect(aggregateBarStyle(true, true)).toEqual({ color: '#58a6ff', borderColor: '#58a6ff', wickColor: '#58a6ff' });
    expect(aggregateBarStyle(true, false)).toEqual({ color: '#f0883e', borderColor: '#f0883e', wickColor: '#f0883e' });
  });

  it('partial bars: hollow body, border + wick in the same hue at 45 %', () => {
    const up = aggregateBarStyle(false, true);
    expect(up.color).toBe('rgba(0, 0, 0, 0)');
    expect(up.borderColor).toBe('rgba(88, 166, 255, 0.45)');
    expect(up.wickColor).toBe('rgba(88, 166, 255, 0.45)');
    expect(aggregateBarStyle(false, false).borderColor).toBe('rgba(240, 136, 62, 0.45)');
  });
});

describe('toAggregateCandleData', () => {
  it('styles the USD candle by completeness and direction', () => {
    const bar = toAggregateCandleData(aggPoint(T, [BN, BY], { open: 2e8, close: 1.9e8 }));
    expect(bar).toMatchObject({ time: 300, open: 2e8, close: 1.9e8, color: 'rgba(0, 0, 0, 0)' });
    expect(bar).toMatchObject({ borderColor: 'rgba(240, 136, 62, 0.45)' });
  });

  it('a bar without notional is whitespace', () => {
    expect(toAggregateCandleData(aggPoint(T, ALL, { notional: false }))).toEqual({ time: 300 });
  });
});

describe('splitAggregateLine (aggregate-oi.md §1 point 1, line mode)', () => {
  const points = [
    aggPoint(0, [BY]),
    aggPoint(T, [BN, BY], { coverageStart: true }), // partial → partial seam
    aggPoint(2 * T, [BN, BY]),
    aggPoint(3 * T, ALL, { coverageStart: true }), // partial → complete seam
    aggPoint(4 * T, ALL),
    aggPoint(5 * T, [BN, BY], { coverageStart: true }), // complete → partial seam
  ];
  const split = splitAggregateLine(points);

  it('each bar is data in its own series and whitespace in the other', () => {
    expect(split.complete.map((i) => 'value' in i)).toEqual([false, false, false, true, true, false]);
    expect(split.partial.map((i) => 'value' in i)).toEqual([true, true, true, false, false, true]);
  });

  it('the bar before every seam is transparent, so no segment crosses it', () => {
    expect((split.partial[0] as LineData).color).toBe('rgba(0, 0, 0, 0)'); // before +Binance
    expect((split.partial[1] as LineData).color).toBeUndefined();
    expect((split.partial[2] as LineData).color).toBe('rgba(0, 0, 0, 0)'); // before +Hyperliquid
    expect((split.complete[3] as LineData).color).toBeUndefined();
    expect((split.complete[4] as LineData).color).toBe('rgba(0, 0, 0, 0)'); // before −Hyperliquid
  });

  it('reports a break at every seam and nowhere else', () => {
    expect(split.breaks).toEqual([T, 3 * T, 5 * T]);
  });

  it('a bar without USD is whitespace in both and breaks the line around it', () => {
    const s = splitAggregateLine([aggPoint(0, ALL), aggPoint(T, ALL, { notional: false }), aggPoint(2 * T, ALL)]);
    expect(s.complete[1]).toEqual({ time: 300 });
    expect(s.partial[1]).toEqual({ time: 300 });
    expect((s.complete[0] as LineData).color).toBe('rgba(0, 0, 0, 0)');
    expect(s.breaks).toEqual([2 * T]);
  });

  it('the last bar is never transparent (no segment leaves it)', () => {
    expect((split.partial[5] as LineData).color).toBeUndefined();
  });
});

describe('seamMarkers (aggregate-oi.md §1 point 2)', () => {
  it('one marker per coverageStart bar, naming the diff vs the previous emitted bar', () => {
    const markers = seamMarkers([
      aggPoint(0, [BY]),
      aggPoint(T, [BN, BY], { coverageStart: true }),
      aggPoint(2 * T, ALL, { coverageStart: true }),
      aggPoint(3 * T, [BN, BY], { coverageStart: true }),
      aggPoint(4 * T, ALL, { coverageStart: true }),
    ]);
    expect(markers).toEqual([
      { time: T, text: '+Binance', complete: false },
      { time: 2 * T, text: '+Hyperliquid', complete: true },
      { time: 3 * T, text: '−Hyperliquid', complete: false },
      { time: 4 * T, text: '+Hyperliquid', complete: true },
    ]);
  });

  it('no marker on the first loaded bar, nor on a coverageStart with an unchanged set', () => {
    expect(seamMarkers([aggPoint(0, ALL, { coverageStart: true }), aggPoint(2 * T, ALL, { coverageStart: true })])).toEqual([]);
  });

  it('no marker on a non-coverageStart bar', () => {
    expect(seamMarkers([aggPoint(0, ALL), aggPoint(T, ALL)])).toEqual([]);
  });
});
