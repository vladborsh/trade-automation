import { positionSize } from '../../src/sizing';
import { SIZING_FIXTURES } from '../../src/fixtures';

describe('positionSize — §6 "Sizing" (decision 21)', () => {
  it.each(SIZING_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const r = positionSize(f.balance, f.riskPct, f.plannedEntry, f.sl);
    expect(r.qty).toBeCloseTo(f.expected.qty, 9);
    expect(r.riskAmount).toBeCloseTo(f.expected.riskAmount, 9);
  });

  it('a full stop-out at the planned levels loses exactly 1R, spread aside', () => {
    const { qty, riskAmount } = positionSize(10_000, 1, 1000, 990);
    expect((1000 - 990) * qty).toBeCloseTo(riskAmount, 9);
  });

  it('refuses to size a zero stop distance, a non-positive balance or risk %', () => {
    expect(() => positionSize(10_000, 1, 1000, 1000)).toThrow(RangeError);
    expect(() => positionSize(0, 1, 1000, 990)).toThrow(RangeError);
    expect(() => positionSize(-50, 1, 1000, 990)).toThrow(RangeError);
    expect(() => positionSize(10_000, 0, 1000, 990)).toThrow(RangeError);
  });
});
