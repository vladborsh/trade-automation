import type { ContractSpec } from '@trade-automation/contracts';
import { MARGIN_AMBER_UTILISATION, sizeOrder, type SizingInput } from './order-sizing';

const BTC: ContractSpec = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 100, maxLeverage: 125 };
const FLAT = { equity: 10_000, usedMargin: 0, available: 10_000 };
const base = (over: Partial<SizingInput> = {}): SizingInput => ({
  mode: 'limit', entry: 65_000, sl: 64_000, lastClose: 65_500, balance: 10_000, riskPct: 1, contract: BTC, account: FLAT, currency: 'USD', ...over,
});

describe('sizeOrder (T-054, design §6 D12)', () => {
  it('sizes from risk at the planned entry and rounds DOWN to the venue step; 1R is what is really at risk', () => {
    const s = sizeOrder(base({ sl: 63_700 })); // distance 1300: raw 100 / 1300 = 0.07692… → 0.076
    expect(s.qty).toBe(0.076);
    expect(s.riskAmount).toBeCloseTo(98.8, 9); // 0.076 × 1300
    expect(s.effectiveRiskPct).toBeCloseTo(0.988, 9); // below the 1 % asked for, never above
    expect(s.notional).toBeCloseTo(4940, 9); // 0.076 × 65 000
    expect(s.marginRequired).toBeCloseTo(39.52, 9); // ÷ 125
    expect(s.availableAfter).toBeCloseTo(10_000 - 39.52, 9);
    expect(s.impliedLeverage).toBeCloseTo(0.494, 9); // 4 940 / 10 000
    expect(s.maxLeverage).toBe(125);
    expect(s.refusal).toBeNull();
  });

  it('a market order is sized at the last close', () => {
    const s = sizeOrder(base({ mode: 'market', sl: 64_500 })); // entry 65 500, distance 1000 → 0.1
    expect(s.entry).toBe(65_500);
    expect(s.qty).toBe(0.1);
  });

  it('SIZE_BELOW_MINIMUM when the size rounds under minQty — the message names the minimum and the risk % it needs', () => {
    const s = sizeOrder(base({ riskPct: 0.005 })); // 0.5 / 1000 = 0.0005 → 0
    expect(s.refusal).toBe('SIZE_BELOW_MINIMUM');
    expect(s.qty).toBe(0);
    expect(s.refusalMessage).toMatch(/smallest order is 0\.002 BTC \(at least 100 notional\), which needs a risk of at least 0\.02 %/);
  });

  it('SIZE_BELOW_MINIMUM on the notional floor even at minQty or above', () => {
    const s = sizeOrder(base({ riskPct: 0.01 })); // 1 / 1000 = 0.001 BTC ≥ minQty, but 65 notional < 100
    expect(s.qty).toBe(0.001);
    expect(s.refusal).toBe('SIZE_BELOW_MINIMUM');
  });

  it('INSUFFICIENT_MARGIN when the initial margin exceeds the free margin', () => {
    const s = sizeOrder(base({ account: { equity: 10_000, usedMargin: 9_990, available: 10 } })); // 0.1 BTC: 6 500 / 125 = 52 > 10
    expect(s.refusal).toBe('INSUFFICIENT_MARGIN');
    expect(s.refusalMessage).toBe('Not enough margin: this order needs 52.00 USD and 10.00 USD is available.');
    expect(s.availableAfter).toBeCloseTo(-42, 9);
  });

  it('utilisation after the order, against the amber threshold', () => {
    const calm = sizeOrder(base({ account: { equity: 10_000, usedMargin: 7_900, available: 2_100 } })); // (7 900 + 52) / 10 000
    expect(calm.utilisation).toBeCloseTo(0.7952, 9);
    expect(calm.utilisation! > MARGIN_AMBER_UTILISATION).toBe(false);
    const amber = sizeOrder(base({ account: { equity: 10_000, usedMargin: 7_960, available: 2_040 } })); // 0.8012
    expect(amber.utilisation! > MARGIN_AMBER_UTILISATION).toBe(true);
    expect(amber.refusal).toBeNull();
  });

  it('without a contract: unrounded as before D12, no margin, no refusal (the server refuses such an instrument)', () => {
    const s = sizeOrder(base({ contract: null, sl: 63_700 }));
    expect(s.qty).toBeCloseTo(100 / 1300, 12);
    expect(s.marginRequired).toBeNull();
    expect(s.refusal).toBeNull();
  });

  it('without an account (a position cannot be marked): the venue minimum is still checked, the margin is left to the server', () => {
    const s = sizeOrder(base({ account: null }));
    expect(s.availableAfter).toBeNull();
    expect(s.utilisation).toBeNull();
    expect(s.refusal).toBeNull();
    expect(sizeOrder(base({ account: null, riskPct: 0.005 })).refusal).toBe('SIZE_BELOW_MINIMUM');
  });

  it('a stop at the entry cannot be sized: replay-core’s RangeError', () => {
    expect(() => sizeOrder(base({ sl: 65_000 }))).toThrow(RangeError);
  });
});
