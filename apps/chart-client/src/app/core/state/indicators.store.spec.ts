import { mergeIndicatorPoint, IndicatorsStore } from './indicators.store';
import type { IndicatorPoint } from '@trade-automation/contracts';

function point(time: number, vwap: number, seriesId = 'vwap-band', strategyId = 'vwap-band-reversal'): IndicatorPoint {
  return {
    strategyId,
    instrument: 'capitalcom:US100',
    timeframe: '1m',
    tier: 'research',
    seriesId,
    time,
    values: { vwap },
  };
}

describe('mergeIndicatorPoint', () => {
  it('appends a point at a new time', () => {
    const result = mergeIndicatorPoint([point(1000, 1)], point(2000, 2));
    expect(result.map((p) => p.time)).toEqual([1000, 2000]);
  });

  it('replaces a point at the same (strategyId, seriesId, time) key', () => {
    const list = [point(1000, 1), point(2000, 2)];
    const result = mergeIndicatorPoint(list, point(2000, 99));
    expect(result).toHaveLength(2);
    expect(result[1].values['vwap']).toBe(99);
  });

  it('does not conflate the same time across different series', () => {
    const list = [point(1000, 1, 'vwap-band', 'vwap-band-reversal')];
    const result = mergeIndicatorPoint(list, point(1000, 5, 'other-series', 'vwap-band-reversal'));
    expect(result).toHaveLength(2);
  });

  it('seeds an empty list', () => {
    expect(mergeIndicatorPoint([], point(1000, 1))).toEqual([point(1000, 1)]);
  });
});

describe('IndicatorsStore', () => {
  it('sets history, merges live points, and clears', () => {
    const store = new IndicatorsStore();
    store.setHistory([point(1000, 1), point(2000, 2)]);
    expect(store.points()).toHaveLength(2);

    store.append(point(3000, 3));
    expect(store.points().map((p) => p.time)).toEqual([1000, 2000, 3000]);

    store.append(point(2000, 42)); // replaces the existing point at 2000
    expect(store.points().find((p) => p.time === 2000)?.values['vwap']).toBe(42);

    store.clear();
    expect(store.points()).toEqual([]);
  });
});
