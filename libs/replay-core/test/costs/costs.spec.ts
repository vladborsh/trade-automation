import {
  fee,
  halfSpread,
  marketExitPrice,
  marketFillPrice,
  spreadCost,
  stopExitPrice,
  takeProfitExitPrice,
} from '../../src/costs';
import { FIXTURE_COSTS_OFF as OFF, FIXTURE_COSTS_ON as ON, MARKET_ENTRY_FIXTURES } from '../../src/fixtures';

describe('costs — §6 conventions', () => {
  it('half-spread is spread / 2 when enabled, 0 when switched off', () => {
    expect(halfSpread(ON)).toBe(1);
    expect(halfSpread(OFF)).toBe(0);
  });

  it('fee is commissionPct % of notional when enabled, 0 when switched off', () => {
    expect(fee(10_000, ON)).toBeCloseTo(10, 12);
    expect(fee(10_000, OFF)).toBe(0);
  });

  it.each(MARKET_ENTRY_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(marketFillPrice(f.side, f.lastClose, f.costs)).toBe(f.expected);
  });

  it('market exit pays the half-spread against the position', () => {
    expect(marketExitPrice('long', 1000, ON)).toBe(999);
    expect(marketExitPrice('short', 1000, ON)).toBe(1001);
    expect(marketExitPrice('long', 1000, OFF)).toBe(1000);
  });

  it('stop exit: level ∓ half, gap-through at the open, no gap when open is null', () => {
    expect(stopExitPrice('long', 990, 995, ON)).toBe(989);
    expect(stopExitPrice('long', 990, 985, ON)).toBe(984);
    expect(stopExitPrice('long', 990, null, ON)).toBe(989);
    expect(stopExitPrice('short', 1010, 1005, ON)).toBe(1011);
    expect(stopExitPrice('short', 1010, 1015, ON)).toBe(1016);
    expect(stopExitPrice('short', 1010, 1015, OFF)).toBe(1015);
  });

  it('take-profit: at the level, gap-through at the open in the trader’s favour, never a spread', () => {
    expect(takeProfitExitPrice('long', 1020, 1010)).toBe(1020);
    expect(takeProfitExitPrice('long', 1020, 1025)).toBe(1025);
    expect(takeProfitExitPrice('short', 980, 990)).toBe(980);
    expect(takeProfitExitPrice('short', 980, 975)).toBe(975);
    expect(takeProfitExitPrice('long', 1020, null)).toBe(1020);
  });

  it('spread cost = half * qty * sides that paid it', () => {
    expect(spreadCost(10, 2, ON)).toBe(20);
    expect(spreadCost(10, 1, ON)).toBe(10);
    expect(spreadCost(10, 0, ON)).toBe(0);
    expect(spreadCost(10, 2, OFF)).toBe(0);
  });
});
