import { Candle, MetricObservation } from '@trade-automation/contracts';
import {
  TIP_PRICE_MAX_AGE_MS,
  tipPriceAt,
  withDerivedNotional,
} from '../../../src/market-data/metrics/tip-notional';

const MIN = 60_000;

function bar(openTime: number, close: number, closed = true): Candle {
  return {
    instrument: 'binance:BTCUSDT',
    timeframe: '1m',
    openTime,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    closed,
    source: 'venue-stream',
  };
}

/** architecture/chart-layouts.md §11.1 "The live tip" — the closed-1m-candle price rule. */
describe('tipPriceAt', () => {
  const T = 1_800_000_000_000 - (1_800_000_000_000 % MIN); // a 1m boundary
  const bars = [bar(T - 5 * MIN, 100), bar(T - 4 * MIN, 101), bar(T - 3 * MIN, 102), bar(T - 2 * MIN, 103), bar(T - MIN, 104)];

  it('takes the bar that closed exactly at the snapshot time', () => {
    expect(tipPriceAt(bars, T)).toBe(104);
  });

  it('takes the latest bar that closed before the snapshot (poll lands a few seconds after the boundary)', () => {
    expect(tipPriceAt(bars, T + 2_500)).toBe(104);
  });

  it('never uses a bar that closes after the snapshot time', () => {
    expect(tipPriceAt(bars, T - 1)).toBe(103);
  });

  it('accepts a bar that closed exactly 120 s before, rejects one older', () => {
    const only = [bar(T - 3 * MIN, 102)]; // closes at T − 2 min
    expect(tipPriceAt(only, T - 2 * MIN + TIP_PRICE_MAX_AGE_MS)).toBe(102);
    expect(tipPriceAt(only, T - 2 * MIN + TIP_PRICE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('skips a not-yet-closed bar and falls back to an earlier closed one inside the window', () => {
    expect(tipPriceAt([bar(T - 2 * MIN, 103), bar(T - MIN, 999, false)], T)).toBe(103);
  });

  it('returns null with no candles, or only candles after the snapshot', () => {
    expect(tipPriceAt([], T)).toBeNull();
    expect(tipPriceAt([bar(T, 105)], T)).toBeNull();
  });
});

describe('withDerivedNotional', () => {
  it('sets notional = value × price with basis "derived", leaving the rest untouched', () => {
    const o: MetricObservation = { metric: 'openInterest', instrument: 'binance:BTCUSDT', time: 1, value: 2.5, unit: 'base' };
    expect(withDerivedNotional(o, 40_000)).toEqual({ ...o, notional: 100_000, notionalBasis: 'derived' });
  });
});
