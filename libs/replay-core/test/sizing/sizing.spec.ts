import { isStopTooClose, MIN_STOP_DISTANCE_FRACTION, positionSize } from '../../src/sizing';
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

describe('isStopTooClose — minimum stop distance (BUG-003 ruling)', () => {
  it('MIN_STOP_DISTANCE_FRACTION is 1e-5 (0.001 % of price)', () => {
    expect(MIN_STOP_DISTANCE_FRACTION).toBe(1e-5);
  });

  it('accepts a stop exactly at entry × 1e-5, refuses one just inside it, on either side', () => {
    expect(isStopTooClose(78_000, 77_999.22)).toBe(false); // 0.78 away: exactly the minimum
    expect(isStopTooClose(78_000, 78_000.78)).toBe(false); // short side
    expect(isStopTooClose(78_000, 77_999.2201)).toBe(true); // 0.7799 away
    expect(isStopTooClose(78_000, 78_000.7799)).toBe(true);
    expect(isStopTooClose(100, 99.999)).toBe(false); // 0.001 = 100 × 1e-5
    expect(isStopTooClose(100, 99.9990001)).toBe(true);
    expect(isStopTooClose(100, 100 - 1e-12)).toBe(true);
    expect(isStopTooClose(100, 99)).toBe(false);
  });
});
