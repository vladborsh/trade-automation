import { mergePoint, prependPoints, MetricPointsStore } from './metric-points.store';
import type { MetricPoint } from '@trade-automation/contracts';

function point(time: number, value: number): MetricPoint {
  return { metric: 'openInterest', instrument: 'binance:BTCUSDT', timeframe: '1m', time, value };
}

describe('mergePoint', () => {
  it('appends a point with a newer time', () => {
    const series = [point(1000, 10)];
    const result = mergePoint(series, point(2000, 11));
    expect(result.map((p) => p.time)).toEqual([1000, 2000]);
  });

  it('replaces the last point when time matches (forming-bucket update)', () => {
    const series = [point(1000, 10), point(2000, 11)];
    const updated = point(2000, 12);
    const result = mergePoint(series, updated);
    expect(result).toHaveLength(2);
    expect(result[1].value).toBe(12);
  });

  it('ignores a point older than everything in the series', () => {
    const series = [point(2000, 10), point(3000, 11)];
    const result = mergePoint(series, point(1000, 999));
    expect(result.map((p) => p.time)).toEqual([2000, 3000]);
  });

  it('seeds an empty series with the first point', () => {
    const result = mergePoint([], point(1000, 10));
    expect(result).toEqual([point(1000, 10)]);
  });

  it('replaces a point mid-series when its time matches an existing (non-last) one', () => {
    const series = [point(1000, 10), point(2000, 11), point(3000, 12)];
    const result = mergePoint(series, point(2000, 99));
    expect(result.map((p) => p.value)).toEqual([10, 99, 12]);
  });
});

describe('prependPoints', () => {
  it('prepends an older page ascending before the current series', () => {
    const series = [point(3000, 10), point(4000, 11)];
    const older = [point(1000, 8), point(2000, 9)];
    const result = prependPoints(series, older);
    expect(result.map((p) => p.time)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('drops overlapping points at the boundary', () => {
    const series = [point(2000, 9), point(3000, 10)];
    const older = [point(1000, 7), point(2000, 999)];
    const result = prependPoints(series, older);
    expect(result.map((p) => p.time)).toEqual([1000, 2000, 3000]);
    expect(result[1].value).toBe(9);
  });

  it('is a no-op when there is nothing older to add', () => {
    const series = [point(1000, 10)];
    expect(prependPoints(series, [])).toEqual(series);
  });
});

describe('MetricPointsStore', () => {
  it('tracks first/last time and merges live updates through the signal', () => {
    const store = new MetricPointsStore();
    store.setHistory([point(1000, 10), point(2000, 11)]);
    expect(store.firstTime()).toBe(1000);
    expect(store.lastTime()).toBe(2000);

    store.mergeLive(point(3000, 12));
    expect(store.points().map((p) => p.time)).toEqual([1000, 2000, 3000]);
    expect(store.lastTime()).toBe(3000);

    store.clear();
    expect(store.points()).toEqual([]);
    expect(store.lastTime()).toBeNull();
  });

  it('prepends an older page', () => {
    const store = new MetricPointsStore();
    store.setHistory([point(3000, 10)]);
    store.prepend([point(1000, 8), point(2000, 9)]);
    expect(store.points().map((p) => p.time)).toEqual([1000, 2000, 3000]);
  });
});
