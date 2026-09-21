import { floatingPnl, openRisk } from '../../src/mark';
import { FIXTURE_COSTS_ON, FLOATING_PNL_FIXTURES, OPEN_RISK_FIXTURES } from '../../src/fixtures';

describe('floatingPnl — §6 "Floating mark" (decision 35)', () => {
  it.each(FLOATING_PNL_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(floatingPnl(f.position, f.lastClose, f.costs)).toBeCloseTo(f.expected, 9);
  });

  it('refuses a position with no entry price (a pending order)', () => {
    const f = FLOATING_PNL_FIXTURES[0];
    expect(() => floatingPnl({ ...f.position, entryPrice: null }, 1000, FIXTURE_COSTS_ON)).toThrow(/entryPrice/);
  });
});

describe('openRisk — §6 (decision 22)', () => {
  it.each(OPEN_RISK_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(openRisk(f.positions)).toBeCloseTo(f.expected, 9);
  });
});
