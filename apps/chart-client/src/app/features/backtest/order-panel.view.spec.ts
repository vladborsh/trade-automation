import type { PositionToolState } from '../chart/overlay/position-tool.model';
import { orderPanelView } from './order-panel.view';

const draft = (over: Partial<PositionToolState> = {}): PositionToolState => ({
  id: 't1', side: 'long', mode: 'limit', entry: 100, sl: 99, tp: 102, kind: 'draft', active: true, anchorTime: 0, ...over,
});
const CTX = { balance: 10_000, riskPct: 1, lastClose: 100.5 };

describe('orderPanelView (T-023)', () => {
  it('size, 1R, R multiple and notional from replay-core positionSize', () => {
    // 1 % of 10 000 = 100 over a 1.0 stop → qty 100; notional 100 × 100 = 10 000
    expect(orderPanelView(draft(), CTX)).toEqual({
      side: 'long', mode: 'limit', entry: 100, qty: 100, riskAmount: 100, rMultiple: 2, notional: 10_000, problem: null,
    });
  });

  it('a market draft is sized at the last close', () => {
    expect(orderPanelView(draft({ mode: 'market', entry: 100.5, sl: 100 }), CTX)).toMatchObject({ entry: 100.5, qty: 200, riskAmount: 100 });
  });

  it('the notional is qty × entry; the flat notional warning is gone (D12, T-053: margin comes with T-054)', () => {
    const tight = orderPanelView(draft({ sl: 99.9 }), CTX); // a 0.1 stop → qty ≈ 1 000 → notional ≈ 100 000
    expect(tight.notional).toBeCloseTo(100_000, 3);
    expect('notionalWarning' in tight).toBe(false);
  });

  it('no size when positionSize cannot size it (zero stop, non-positive balance)', () => {
    expect(orderPanelView(draft({ sl: 100 }), CTX)).toMatchObject({ qty: null, problem: expect.stringMatching(/stop distance/) });
    expect(orderPanelView(draft(), { ...CTX, balance: 0 }).problem).toMatch(/balance/);
  });
});
