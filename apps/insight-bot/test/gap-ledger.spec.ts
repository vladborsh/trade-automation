import { planGaps, RegisteredGap } from '../src/collectors/binance-perp/gap-ledger';

/**
 * IB-BUG-020 — the backfill's gap bookkeeping. Each case is built so the bug, or its over-correction,
 * would fail it: a re-registered hole, a real new outage swallowed, a repair that goes down or past
 * `expected`, a duplicate counted twice as open.
 */
const SLOT = 300_000;
const T0 = Date.UTC(2026, 10, 1, 0, 0);
const at = (n: number) => T0 + n * SLOT;
const reg = (id: string, from: number, to: number, over: Partial<RegisteredGap> = {}): RegisteredGap =>
  ({ id, detectedAt: new Date(at(1000)), gapFrom: at(from), gapTo: at(to), expected: to - from + 1, repaired: 0, ...over });

describe('planGaps', () => {
  it('a hole nobody registered is written', () => {
    const plan = planGaps([{ from: at(10), to: at(12), expected: 3 }], [], []);
    expect(plan.insert).toEqual([{ from: at(10), to: at(12), expected: 3 }]);
    expect(plan.open).toBe(1);
  });

  it('the same hole on the next boot is NOT written again (the bug: one row per boot)', () => {
    const plan = planGaps([{ from: at(10), to: at(12), expected: 3 }], [reg('1', 10, 12)], []);
    expect(plan.insert).toEqual([]);
    expect(plan.repairs).toEqual([]);
    expect(plan.open).toBe(1); // still open: the venue has not served it
  });

  it('a REAL new outage beside an old hole is still written (not hidden by the dedupe)', () => {
    const plan = planGaps(
      [{ from: at(10), to: at(12), expected: 3 }, { from: at(20), to: at(20), expected: 1 }],
      [reg('1', 10, 12)],
      [],
    );
    expect(plan.insert).toEqual([{ from: at(20), to: at(20), expected: 1 }]);
    expect(plan.open).toBe(2);
  });

  it('pieces of a hole the venue later served in part are the same registered hole, not new ones', () => {
    // registered 10..14; the venue now served 12, so the walk finds 10..11 and 13..14
    const plan = planGaps(
      [{ from: at(10), to: at(11), expected: 2 }, { from: at(13), to: at(14), expected: 2 }],
      [reg('1', 10, 14)],
      [at(12)],
    );
    expect(plan.insert).toEqual([]);
    expect(plan.repairs).toEqual([{ id: '1', detectedAt: new Date(at(1000)), repaired: 1 }]);
    expect(plan.open).toBe(1);
  });

  it('the whole-window "no rows" range moves with `now`; an overlapping earlier one stands for it', () => {
    const plan = planGaps([{ from: at(5), to: at(8645), expected: 8641 }], [reg('1', 0, 8640)], []);
    expect(plan.insert).toEqual([]);
  });

  it('a registered hole whose slots are now stored is repaired, in full (QQQUSDT on the box)', () => {
    const plan = planGaps([], [reg('7', 30, 30)], [at(30)]);
    expect(plan.repairs).toEqual([{ id: '7', detectedAt: new Date(at(1000)), repaired: 1 }]);
    expect(plan.open).toBe(0);
  });

  it('repaired never goes down, and never past expected', () => {
    // already marked 2 of 3; the stored read now shows 1 (a narrower read): no update
    expect(planGaps([], [reg('1', 10, 12, { repaired: 2 })], [at(10)]).repairs).toEqual([]);
    // stored slots outside the gap do not count toward it
    expect(planGaps([], [reg('1', 10, 10)], [at(9), at(10), at(11)]).repairs[0].repaired).toBe(1);
  });

  it('a window registered several times (the rows already on the box) is ONE open window, and every copy is repaired', () => {
    const copies = [reg('1', 10, 10), reg('2', 10, 10), reg('3', 10, 10)];
    expect(planGaps([], copies, []).open).toBe(1);
    expect(planGaps([], copies, [at(10)]).repairs.map((r) => r.id)).toEqual(['1', '2', '3']);
  });
});
