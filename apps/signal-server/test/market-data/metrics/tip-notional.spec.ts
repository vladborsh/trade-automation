import { MetricObservation } from '@trade-automation/contracts';
import {
  TIP_PRICE_MAX_AGE_MS,
  acceptTipPrice,
  tipPriceAt,
  withDerivedNotional,
} from '../../../src/market-data/metrics/tip-notional';

const MIN = 60_000;
const T = 1_800_000_000_000 - (1_800_000_000_000 % MIN); // a 1m boundary

/** architecture/chart-layouts.md §11.1 "The live tip" — the 120 s mark-price rule. */
describe('acceptTipPrice', () => {
  it('accepts a price stamped within 120 s either side of the snapshot', () => {
    expect(acceptTipPrice({ time: T + 1_500, price: 100 }, T)).toBe(100);
    expect(acceptTipPrice({ time: T - TIP_PRICE_MAX_AGE_MS, price: 100 }, T)).toBe(100);
    expect(acceptTipPrice({ time: T + TIP_PRICE_MAX_AGE_MS, price: 100 }, T)).toBe(100);
  });

  it('rejects a price stamped more than 120 s away', () => {
    expect(acceptTipPrice({ time: T - TIP_PRICE_MAX_AGE_MS - 1, price: 100 }, T)).toBeNull();
    expect(acceptTipPrice({ time: T + TIP_PRICE_MAX_AGE_MS + 1, price: 100 }, T)).toBeNull();
  });

  it('rejects no price and a non-positive / non-numeric price', () => {
    expect(acceptTipPrice(null, T)).toBeNull();
    expect(acceptTipPrice({ time: T, price: 0 }, T)).toBeNull();
    expect(acceptTipPrice({ time: T, price: Number.NaN }, T)).toBeNull();
  });
});

/** §11.1 "Legacy tip rows" — 1m mark bars stamped at their close. */
describe('tipPriceAt', () => {
  const points = [100, 101, 102, 103, 104].map((price, i) => ({ time: T - (4 - i) * MIN, price }));

  it('takes the point stamped exactly at the snapshot time', () => {
    expect(tipPriceAt(points, T)).toBe(104);
  });

  it('takes the latest point before the snapshot (row lands a few seconds after the boundary)', () => {
    expect(tipPriceAt(points, T + 2_500)).toBe(104);
  });

  it('never uses a point from after the snapshot', () => {
    expect(tipPriceAt(points, T - 1)).toBe(103);
  });

  it('accepts a point exactly 120 s before, rejects one older', () => {
    const only = [{ time: T, price: 102 }];
    expect(tipPriceAt(only, T + TIP_PRICE_MAX_AGE_MS)).toBe(102);
    expect(tipPriceAt(only, T + TIP_PRICE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('returns null with no points, or only points after the snapshot', () => {
    expect(tipPriceAt([], T)).toBeNull();
    expect(tipPriceAt([{ time: T + MIN, price: 105 }], T)).toBeNull();
  });
});

describe('withDerivedNotional', () => {
  it('sets notional = value × price with basis "derived", leaving the rest untouched', () => {
    const o: MetricObservation = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 1, value: 2.5, unit: 'base' };
    expect(withDerivedNotional(o, 40_000)).toEqual({ ...o, notional: 100_000, notionalBasis: 'derived' });
  });
});
