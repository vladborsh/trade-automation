import { orderLevelError, placementOverflows, plannedEntry } from '../../src/backtest/order-validation';

describe('orderLevelError (design §7.2 level checks; lastClose 100)', () => {
  const long = { side: 'long' as const, type: 'market' as const };
  const short = { side: 'short' as const, type: 'market' as const };

  it('accepts sane levels for both sides and both types', () => {
    expect(orderLevelError({ ...long, sl: 99, tp: 102 }, 100)).toBeNull();
    expect(orderLevelError({ ...short, sl: 101, tp: 98 }, 100)).toBeNull();
    expect(orderLevelError({ side: 'long', type: 'limit', limitPrice: 99, sl: 98, tp: 100.5 }, 100)).toBeNull();
    expect(orderLevelError({ side: 'short', type: 'limit', limitPrice: 101, sl: 102 }, 100)).toBeNull();
  });

  it('LIMIT_ON_WRONG_SIDE: a long limit at or above lastClose, a short at or below', () => {
    expect(orderLevelError({ side: 'long', type: 'limit', limitPrice: 100, sl: 99 }, 100)).toBe('LIMIT_ON_WRONG_SIDE');
    expect(orderLevelError({ side: 'long', type: 'limit', limitPrice: 101, sl: 99 }, 100)).toBe('LIMIT_ON_WRONG_SIDE');
    expect(orderLevelError({ side: 'short', type: 'limit', limitPrice: 99, sl: 101 }, 100)).toBe('LIMIT_ON_WRONG_SIDE');
  });

  it('STOP_DISTANCE_ZERO: the stop is at the planned entry', () => {
    expect(orderLevelError({ ...long, sl: 100 }, 100)).toBe('STOP_DISTANCE_ZERO');
    expect(orderLevelError({ side: 'short', type: 'limit', limitPrice: 101, sl: 101 }, 100)).toBe('STOP_DISTANCE_ZERO');
  });

  it('SL_ON_WRONG_SIDE: a long stop above the entry, a short stop below', () => {
    expect(orderLevelError({ ...long, sl: 101 }, 100)).toBe('SL_ON_WRONG_SIDE');
    expect(orderLevelError({ ...short, sl: 99 }, 100)).toBe('SL_ON_WRONG_SIDE');
    // against the limit level, not lastClose
    expect(orderLevelError({ side: 'long', type: 'limit', limitPrice: 95, sl: 96 }, 100)).toBe('SL_ON_WRONG_SIDE');
  });

  it('TP_ON_WRONG_SIDE: a long target at or below the entry, a short at or above', () => {
    expect(orderLevelError({ ...long, sl: 99, tp: 100 }, 100)).toBe('TP_ON_WRONG_SIDE');
    expect(orderLevelError({ ...short, sl: 101, tp: 100.5 }, 100)).toBe('TP_ON_WRONG_SIDE');
  });

  it('checks in order: limit side before stop before target', () => {
    expect(orderLevelError({ side: 'long', type: 'limit', limitPrice: 101, sl: 102, tp: 90 }, 100)).toBe('LIMIT_ON_WRONG_SIDE');
    expect(orderLevelError({ ...long, sl: 101, tp: 90 }, 100)).toBe('SL_ON_WRONG_SIDE');
  });

  it('plannedEntry is the limit level for a limit, lastClose for a market order', () => {
    expect(plannedEntry({ type: 'limit', limitPrice: 95 }, 100)).toBe(95);
    expect(plannedEntry({ type: 'market' }, 100)).toBe(100);
  });

  it('BUG-003: a stop closer than 0.001 % of the entry, or equal at column precision, is STOP_DISTANCE_ZERO', () => {
    // entry 100 → minimum distance 0.001
    expect(orderLevelError({ ...long, sl: 99.999 }, 100)).toBeNull();
    expect(orderLevelError({ ...long, sl: 99.9990001 }, 100)).toBe('STOP_DISTANCE_ZERO');
    expect(orderLevelError({ ...short, sl: 100.001 }, 100)).toBeNull();
    expect(orderLevelError({ ...short, sl: 100.0009 }, 100)).toBe('STOP_DISTANCE_ZERO');
    expect(orderLevelError({ ...long, sl: 100 - 1e-12 }, 100)).toBe('STOP_DISTANCE_ZERO'); // rounds to the entry at 8 decimals
    // a stop on the wrong side reports its side, even when it is also very close
    expect(orderLevelError({ ...long, sl: 100.0000001 }, 100)).toBe('SL_ON_WRONG_SIDE');
    expect(orderLevelError({ ...long, sl: 100.5 }, 100)).toBe('SL_ON_WRONG_SIDE');
  });
});

describe('placementOverflows (BUG-003 backstop)', () => {
  it('flags any computed value at or beyond 1e12 or not finite', () => {
    expect(placementOverflows({ qty: 999_999_999_999.99, riskAmount: 100, entryPrice: 100 })).toBe(false);
    expect(placementOverflows({ qty: 1e12, riskAmount: 100, entryPrice: null })).toBe(true);
    expect(placementOverflows({ qty: 1, riskAmount: 1e12, entryPrice: null })).toBe(true);
    expect(placementOverflows({ qty: 1, riskAmount: 1, entryPrice: 1e12 })).toBe(true);
    expect(placementOverflows({ qty: Infinity, riskAmount: 1, entryPrice: null })).toBe(true);
  });
});
