import type { WebFeatureValue } from '@trade-automation/contracts';
import { volatilityFeatures } from '../../src/features/calculators/volatility';
import type { AtrBar } from '../../src/features/math/wilder-atr';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const bars = (n: number): AtrBar[] => Array.from({ length: n }, (_, i) => ({ high: 110 + i, low: 100 + i, close: 105 + i }));

describe('ATR group', () => {
  it('computes Wilder ATR(14) when there are enough bars', () => {
    const f = volatilityFeatures({ bars: { '4h': bars(20) } });
    expect(val(f['atr.4h.14'])).toBeCloseTo(10, 6);
  });

  it('REFUSES rather than returning an ATR of a shorter period', () => {
    // 14 periods needs 15 bars. A number from fewer is ATR(n) wearing ATR(14)'s name.
    expect(why(volatilityFeatures({ bars: { '1h': bars(14) } })['atr.1h.14'])).toBe('insufficient_history');
  });

  it('distinguishes no bars at all from too few', () => {
    expect(why(volatilityFeatures({ bars: {} })['atr.1d.14'])).toBe('no_data');
  });

  it('emits all three timeframes independently', () => {
    const f = volatilityFeatures({ bars: { '1h': bars(20) } });
    expect(val(f['atr.1h.14'])).toBeDefined();
    expect(why(f['atr.4h.14'])).toBe('no_data');
    expect(Object.keys(f)).toHaveLength(3);
  });
});
