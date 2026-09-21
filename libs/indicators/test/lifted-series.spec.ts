import { atrSeries, ifvgSeries, previousHourSeries, rangeSeries, vwapBandSeries } from '../src';
import { KeyedSet } from '../src/keyed-set';
import { bar } from './test-helpers';

/**
 * T-034 — what anchors the series forms, shown on hand-built bars around a UTC midnight
 * (2024-03-01 → 03-02). The parity spec proves they equal the lifted functions; this one pins the
 * anchors in plain numbers.
 */
const MIN = 60_000;
const at = (hh: number, mm: number, day = 1) => Date.UTC(2024, 2, day, hh, mm);
const flat = (t: number, price: number, volume = 1) => bar(t, { open: price, high: price + 1, low: price - 1, close: price }, volume);
const valueAt = (s: { time: number; value: number }[], t: number) => s.find((p) => p.time === t)?.value;

describe('session anchors at a UTC day boundary (T-034)', () => {
  // 22:00–23:59 at 100 (the 22:xx hour) and 200 (23:xx), then 00:00–00:09 at 300 on the next day.
  const bars = [
    ...Array.from({ length: 60 }, (_, m) => flat(at(22, m), 100)),
    ...Array.from({ length: 60 }, (_, m) => flat(at(23, m), 200)),
    ...Array.from({ length: 10 }, (_, m) => flat(at(0, m, 2), 300)),
  ];

  it('VWAP restarts at 00:01 UTC; the 00:00 bar belongs to no day window (the plug-in, bug-faithfully)', () => {
    const s = vwapBandSeries(bars);
    expect(valueAt(s.vwap, at(23, 59))).toBe(150); // 22:00..23:59, all volume 1: (60·100 + 60·200) / 120
    expect(valueAt(s.vwap, at(0, 0, 2))).toBeUndefined();
    expect(valueAt(s.vwap, at(0, 1, 2))).toBe(300); // a fresh day: only the 00:01 bar
    expect(valueAt(s.upper, at(0, 1, 2))).toBe(300); // one deviation, σ = 0
    expect(valueAt(s.vwap, at(0, 9, 2))).toBe(300);
  });

  it('the previous hour of the 00:xx bars is 23:00–23:59 of the day before', () => {
    const s = previousHourSeries(bars);
    expect(valueAt(s.high, at(23, 30))).toBe(101); // 22:xx
    expect(valueAt(s.high, at(0, 0, 2))).toBe(201); // 23:xx, across midnight
    expect(valueAt(s.low, at(0, 9, 2))).toBe(199);
    expect(valueAt(s.high, at(22, 30))).toBeUndefined(); // 21:xx has no bars
  });

  it('the range is not session-anchored: its window runs across midnight', () => {
    const s = rangeSeries(bars, { length: 5 });
    expect(valueAt(s.top, at(0, 2, 2))).toBe(301); // 23:57..00:01
    expect(valueAt(s.bottom, at(0, 2, 2))).toBe(199);
    expect(valueAt(s.middle, at(0, 2, 2))).toBe(250);
  });

  it('ATR is not session-anchored either: the 00:00 true range is measured from the 23:59 close', () => {
    const s = atrSeries(bars, { length: 1 });
    expect(valueAt(s.atr, at(0, 0, 2))).toBe(101); // |301 − 200|
  });
});

describe('ifvgSeries (T-034)', () => {
  it('reports the latest iFVG from the bar that inverts it', () => {
    // fvg.spec.ts case 1: a bearish FVG {94, 95} forms at bar 3 and is inverted at bar 4.
    const bars = [
      bar(0, { open: 50, high: 51, low: 49, close: 50 }),
      bar(1 * MIN, { open: 100, high: 100, low: 95, close: 98 }),
      bar(2 * MIN, { open: 96, high: 97, low: 93, close: 95 }),
      bar(3 * MIN, { open: 92, high: 94, low: 88, close: 90 }),
      bar(4 * MIN, { open: 90, high: 97, low: 85, close: 96 }),
    ];
    expect(ifvgSeries(bars)).toEqual({ high: [{ time: 4 * MIN, value: 95 }], low: [{ time: 4 * MIN, value: 94 }] });
  });
});

describe('KeyedSet (T-034)', () => {
  it('takes exactly the live members strictly inside (lo, hi), in id order, once', () => {
    const set = new KeyedSet([5, 1, 3, 3, 9, 7]);
    [0, 1, 2, 3, 4].forEach((id) => set.insert(id)); // id 5 (key 7) never inserted
    expect(set.takeBetween(3, 9)).toEqual([0]); // key 5 only: 3 and 9 are excluded, 7 is not live
    expect(set.takeBetween(0, 4)).toEqual([1, 2, 3]);
    expect(set.takeBetween(0, 10)).toEqual([4]);
    expect(set.takeBetween(0, 10)).toEqual([]);
    set.insert(5);
    expect(set.takeBetween(9, 0)).toEqual([]); // an empty interval
    expect(set.has(5)).toBe(true);
  });
});

