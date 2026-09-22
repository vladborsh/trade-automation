import type { ContractSpec } from '@trade-automation/contracts';
import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { type OrderPanelContext, orderPanelView, sizeText } from './order-panel.view';

const BTC: ContractSpec = { unit: 'BTC', multiplier: 1, minQty: 0.001, qtyStep: 0.001, minNotional: 100, maxLeverage: 125 };
const EUR: ContractSpec = { unit: 'EUR', multiplier: 1, minQty: 1000, qtyStep: 1000, maxLeverage: 30, displayLot: 100_000 };
const US100: ContractSpec = { unit: 'contracts', multiplier: 1, minQty: 0.1, qtyStep: 0.1, maxLeverage: 20 };

const draft = (over: Partial<PositionToolState> = {}): PositionToolState => ({
  id: 't1', side: 'long', mode: 'limit', entry: 65_000, sl: 64_000, tp: 67_000, kind: 'draft', active: true, anchorTime: 0, ...over,
});
const CTX: OrderPanelContext = { balance: 10_000, riskPct: 1, lastClose: 65_500, contract: BTC, account: { equity: 10_000, usedMargin: 0, available: 10_000 }, currency: 'USD' };

describe('orderPanelView (T-023, T-054)', () => {
  it('the size on the venue step in its unit, 1R, effective vs requested risk, R, notional, margin, leverage vs cap', () => {
    const v = orderPanelView(draft({ sl: 63_700 }), CTX); // 100 / 1300 = 0.0769… → 0.076 BTC
    expect(v).toMatchObject({ side: 'long', mode: 'limit', entry: 65_000, sizeText: '0.076 BTC', requestedRiskPct: 1, amber: false, problem: null });
    expect(v.sizing!.effectiveRiskPct).toBeCloseTo(0.988, 9);
    expect(v.sizing!.marginRequired).toBeCloseTo(39.52, 9);
    expect(v.leverageText).toBe('0.5x of 125x'); // 4 940 / 10 000
    expect(v.rMultiple).toBeCloseTo(2 / 1.3, 9);
  });

  it('a market draft is sized at the last close', () => {
    expect(orderPanelView(draft({ mode: 'market', sl: 64_500 }), CTX)).toMatchObject({ entry: 65_500, sizeText: '0.100 BTC' });
  });

  it('SIZE_BELOW_MINIMUM: Confirm-blocking problem naming the risk % needed', () => {
    const v = orderPanelView(draft(), { ...CTX, riskPct: 0.005 });
    expect(v.sizing!.refusal).toBe('SIZE_BELOW_MINIMUM');
    expect(v.problem).toMatch(/needs a risk of at least 0\.02 %/);
  });

  it('INSUFFICIENT_MARGIN: the problem says what is needed and what is free', () => {
    const v = orderPanelView(draft(), { ...CTX, account: { equity: 10_000, usedMargin: 9_990, available: 10 } });
    expect(v.problem).toBe('Not enough margin: this order needs 52.00 USD and 10.00 USD is available.');
    expect(v.amber).toBe(true); // (9 990 + 52) / 10 000 — above 80 % too
  });

  it('amber above 80 % utilisation after the order, not at or below it', () => {
    expect(orderPanelView(draft(), { ...CTX, account: { equity: 10_000, usedMargin: 7_948, available: 2_052 } }).amber).toBe(false); // exactly 0.8
    expect(orderPanelView(draft(), { ...CTX, account: { equity: 10_000, usedMargin: 7_949, available: 2_051 } }).amber).toBe(true);
  });

  it('no size when replay-core cannot size it (a stop at the entry, a non-positive balance)', () => {
    expect(orderPanelView(draft({ sl: 65_000 }), CTX)).toMatchObject({ sizing: null, sizeText: null, problem: expect.stringMatching(/stop distance/) });
    expect(orderPanelView(draft(), { ...CTX, balance: 0 }).problem).toMatch(/balance/);
  });
});

describe('sizeText (T-054)', () => {
  it('the unit, the venue step’s decimals, and lots for FX', () => {
    expect(sizeText(0.076, BTC)).toBe('0.076 BTC');
    expect(sizeText(20_000, EUR)).toBe('20,000 EUR (0.20 lots)');
    expect(sizeText(2.5, US100)).toBe('2.5 contracts');
    expect(sizeText(0.07692307, null)).toBe('0.0769231');
  });
});
