import { groupSeries, type SeriesEvent } from '../../src/insights/liquidation-series';
import { SERIES_MAX_SPAN_SEC, SERIES_MIN_EVENTS, SERIES_MIN_USD } from '../../src/insights/thresholds';

/** IB-084 / R3 — what a cascade is: ≥ 3 same-side events, each ≥ $100k, first to last within 10 min. */
const ev = (key: string, minute: number, side: 'long' | 'short' = 'long', usd = 150_000): SeriesEvent => ({ key, timeSec: 1_000_000 + minute * 60, side, usd });

describe('groupSeries', () => {
  it('the thresholds are the design\'s: 3 events, $100k each, 10 minutes', () => {
    expect([SERIES_MIN_EVENTS, SERIES_MIN_USD, SERIES_MAX_SPAN_SEC]).toEqual([3, 100_000, 600]);
  });

  it('4 events in 9 minutes are ONE series', () => {
    const series = groupSeries([ev('a', 0), ev('b', 3), ev('c', 6), ev('d', 9)]);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ count: 4, spanSec: 540, side: 'long', keys: ['a', 'b', 'c', 'd'] });
  });

  it('3 events in 11 minutes are NOT a series', () => {
    expect(groupSeries([ev('a', 0), ev('b', 5), ev('c', 11)])).toEqual([]);
  });

  it('exactly 10 minutes still counts; the bound is inclusive', () => {
    expect(groupSeries([ev('a', 0), ev('b', 5), ev('c', 10)])).toHaveLength(1);
  });

  it('the other side and sub-$100k events neither join nor break a series', () => {
    const events = [ev('a', 0), ev('x', 1, 'short'), ev('small', 2, 'long', 99_999), ev('b', 3), ev('c', 4)];
    const series = groupSeries(events);
    expect(series.map((s) => s.keys)).toEqual([['a', 'b', 'c']]);
  });

  it('two separate cascades are two series, and order does not matter', () => {
    const series = groupSeries([ev('d', 30), ev('a', 0), ev('e', 31), ev('b', 1), ev('f', 32), ev('c', 2)]);
    expect(series.map((s) => s.count)).toEqual([3, 3]);
    expect(series[0].id).not.toBe(series[1].id);
  });
});
