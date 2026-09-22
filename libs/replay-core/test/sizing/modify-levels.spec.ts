import { modifyLevelError, modifyReference } from '../../src/sizing';

const LONG_OPEN = { side: 'long', status: 'open', limitPrice: null } as const;
const SHORT_OPEN = { side: 'short', status: 'open', limitPrice: null } as const;
const LONG_PENDING = { side: 'long', status: 'pending', limitPrice: 95 } as const;
const SHORT_PENDING = { side: 'short', status: 'pending', limitPrice: 105 } as const;
const LAST = 100;

describe('modifyLevelError — T-033 (pending: against the limit; open: against the last close)', () => {
  it('the reference is the limit for a pending order, the last close for an open one', () => {
    expect(modifyReference(LONG_PENDING, LAST)).toBe(95);
    expect(modifyReference(LONG_OPEN, LAST)).toBe(100);
  });

  it('open long, entry 90 and now at 100: break-even (90) and a trailing stop in profit (98) are accepted', () => {
    expect(modifyLevelError(LONG_OPEN, { sl: 90 }, LAST)).toBeNull();
    expect(modifyLevelError(LONG_OPEN, { sl: 98 }, LAST)).toBeNull();
  });

  it('open short, entry 110 and now at 100: break-even (110) and a trailing stop in profit (102) are accepted', () => {
    expect(modifyLevelError(SHORT_OPEN, { sl: 110 }, LAST)).toBeNull();
    expect(modifyLevelError(SHORT_OPEN, { sl: 102 }, LAST)).toBeNull();
  });

  it('open: a stop at or through the last close is refused', () => {
    expect(modifyLevelError(LONG_OPEN, { sl: 100 }, LAST)).toBe('STOP_DISTANCE_ZERO');
    expect(modifyLevelError(LONG_OPEN, { sl: 101 }, LAST)).toBe('SL_ON_WRONG_SIDE');
    expect(modifyLevelError(SHORT_OPEN, { sl: 99 }, LAST)).toBe('SL_ON_WRONG_SIDE');
    expect(modifyLevelError(LONG_OPEN, { sl: 99.9999 }, LAST)).toBe('STOP_DISTANCE_ZERO'); // closer than 0.001 %
  });

  it('open: a target at or through the last close is refused', () => {
    expect(modifyLevelError(LONG_OPEN, { tp: 100 }, LAST)).toBe('TP_ON_WRONG_SIDE');
    expect(modifyLevelError(LONG_OPEN, { tp: 99 }, LAST)).toBe('TP_ON_WRONG_SIDE');
    expect(modifyLevelError(SHORT_OPEN, { tp: 101 }, LAST)).toBe('TP_ON_WRONG_SIDE');
    expect(modifyLevelError(LONG_OPEN, { tp: 120 }, LAST)).toBeNull();
  });

  it('pending: checked against the limit as at placement, whatever the last close', () => {
    expect(modifyLevelError(LONG_PENDING, { sl: 94 }, LAST)).toBeNull();
    expect(modifyLevelError(LONG_PENDING, { sl: 95 }, LAST)).toBe('STOP_DISTANCE_ZERO');
    expect(modifyLevelError(LONG_PENDING, { sl: 96 }, LAST)).toBe('SL_ON_WRONG_SIDE'); // below the market, above the limit
    expect(modifyLevelError(LONG_PENDING, { tp: 96 }, LAST)).toBeNull(); // below the market, above the limit
    expect(modifyLevelError(LONG_PENDING, { tp: 95 }, LAST)).toBe('TP_ON_WRONG_SIDE');
    expect(modifyLevelError(SHORT_PENDING, { sl: 104 }, LAST)).toBe('SL_ON_WRONG_SIDE');
    expect(modifyLevelError(SHORT_PENDING, { tp: 104 }, LAST)).toBeNull();
  });

  it('only the levels given are checked, the stop first', () => {
    expect(modifyLevelError(LONG_OPEN, {}, LAST)).toBeNull();
    expect(modifyLevelError(LONG_OPEN, { tp: 120 }, LAST)).toBeNull();
    expect(modifyLevelError(LONG_OPEN, { sl: 101, tp: 99 }, LAST)).toBe('SL_ON_WRONG_SIDE');
  });
});
