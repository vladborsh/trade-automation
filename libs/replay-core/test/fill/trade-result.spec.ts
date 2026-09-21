import { computeTradeResult } from '../../src/fill';
import { FIXTURE_COSTS_ON, TRADE_RESULT_FIXTURES } from '../../src/fixtures';

describe('computeTradeResult — §6 "Costs" (architecture/backtest-app-system-design.md §6)', () => {
  it.each(TRADE_RESULT_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const r = computeTradeResult(f.order, f.exitEvent, f.costs);
    expect(r.commissionCcy).toBeCloseTo(f.expected.commissionCcy, 9);
    expect(r.spreadCostCcy).toBeCloseTo(f.expected.spreadCostCcy, 9);
    expect(r.pnlCcy).toBeCloseTo(f.expected.pnlCcy, 9);
    expect(r.pnlR).toBeCloseTo(f.expected.pnlR, 9);
  });

  it('rejects a fill event and an order without entryPrice', () => {
    const f = TRADE_RESULT_FIXTURES[0];
    expect(() => computeTradeResult(f.order, { ...f.exitEvent, kind: 'fill', reason: undefined }, FIXTURE_COSTS_ON)).toThrow(/exit/);
    expect(() => computeTradeResult({ ...f.order, entryPrice: null }, f.exitEvent, FIXTURE_COSTS_ON)).toThrow(/entryPrice/);
  });
});
