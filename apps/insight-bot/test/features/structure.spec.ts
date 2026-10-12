import type { WebFeatureValue } from '@trade-automation/contracts';
import { structureFeatures, type StructureInput } from '../../src/features/calculators/structure';
import type { PivotBar } from '../../src/features/math/pivots';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const T0 = Date.UTC(2026, 9, 12, 0, 0, 0);
const bar = (i: number, high: number, low: number): PivotBar => ({ time: T0 + i * 900_000, high, low });

const input = (over: Partial<StructureInput> = {}): StructureInput => ({
  bars12h: [bar(0, 5, 3), bar(1, 9, 1), bar(2, 4, 2)],
  bars24h: [bar(0, 5, 3), bar(1, 9, 1), bar(2, 4, 2)],
  closes24h: [4, 6, 3],
  atr1h: 2,
  ...over,
});

describe('structure', () => {
  it('reports the pivot extremes of the window', () => {
    const f = structureFeatures(input());
    expect(val(f['structure.swing_high_12h'])).toBe(9);
    expect(val(f['structure.swing_low_12h'])).toBe(1);
  });

  it('A MONOTONIC WINDOW HAS NO SWING, and says so rather than naming its last bar', () => {
    // A playbook reading "swing high" expects a level the market turned at, not whatever was
    // highest. `insufficient_history`, not `no_data`: the bars exist, they never turned.
    const rising = Array.from({ length: 8 }, (_, i) => bar(i, 10 + i, 9 + i));
    const f = structureFeatures(input({ bars12h: rising }));
    expect(why(f['structure.swing_high_12h'])).toBe('insufficient_history');
    expect(why(f['structure.impulse_low_15m'])).toBe('insufficient_history');
  });

  it('counts a failed high: a pivot inside the ATR band that did not CLOSE above the high', () => {
    // window high 9; band 0.5 * atr1h(2) = 1, so pivots >= 8 qualify; the pivot at 9 closed at
    // 6, below the high, so it failed.
    expect(val(structureFeatures(input())['structure.failed_highs_24h'])).toBe(1);
  });

  it('does not count a pivot that closed above the window high', () => {
    expect(val(structureFeatures(input({ closes24h: [4, 9, 3] }))['structure.failed_highs_24h'])).toBe(0);
  });

  it('does not count a pivot far below the high, however it closed', () => {
    const f = structureFeatures(input({ atr1h: 0.1 })); // band 0.05, the pivot at 9 is the high
    expect(val(f['structure.failed_highs_24h'])).toBe(1);
    const narrow = structureFeatures(input({ bars24h: [bar(0, 5, 3), bar(1, 6, 1), bar(2, 9, 2)], closes24h: [4, 5, 8], atr1h: 0.1 }));
    expect(val(narrow['structure.failed_highs_24h'])).toBe(0); // the 6 pivot is outside the band
  });

  it('REFUSES the failed-high count without an ATR, because the band is defined by it', () => {
    expect(why(structureFeatures(input({ atr1h: null }))['structure.failed_highs_24h']))
      .toBe('insufficient_history');
  });

  it('refuses when the closes do not line up with the bars, rather than mis-indexing', () => {
    expect(why(structureFeatures(input({ closes24h: [1] }))['structure.failed_highs_24h'])).toBe('no_data');
  });
});
