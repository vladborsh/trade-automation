import { featureParamNumber, type WebFeatureValue } from '@trade-automation/contracts';
import { volatilityFeatures } from '../../src/features/calculators/volatility';
import type { AtrBar } from '../../src/features/math/wilder-atr';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const bars = (n: number): AtrBar[] => Array.from({ length: n }, (_, i) => ({ high: 110 + i, low: 100 + i, close: 105 + i }));

/**
 * IB-052 — every count below is DERIVED from the registry, not written as a literal.
 *
 * The bug this spec failed to catch was that the calculator's window was whatever the caller
 * happened to pass. A spec that hard-codes `bars(20)` cannot notice that, because 20 is a number
 * it chose rather than a number the registry declared. `window()` makes the registry the only
 * source of the figure, so a changed `period` or `warmupBars` moves the boundary this spec
 * asserts at instead of silently leaving it behind.
 */
const window = (key: 'atr.1h.14' | 'atr.4h.14' | 'atr.1d.14') =>
  featureParamNumber(key, 'period') + 1 + featureParamNumber(key, 'warmupBars');

describe('ATR group', () => {
  it('computes Wilder ATR(14) when the declared window is filled', () => {
    // These bars have a constant true range of 10, so the ATR is 10 for any window length —
    // which is what lets the assertion survive the window changing, and is also why this one
    // assertion alone could never have caught IB-052. See recursive-window-invariance.spec.ts.
    expect(val(volatilityFeatures({ bars: { '4h': bars(window('atr.4h.14')) } })['atr.4h.14'])).toBeCloseTo(10, 6);
  });

  it('REFUSES rather than returning an ATR of a shorter window', () => {
    // One bar short of period+1+warmup. A number from fewer bars is a DIFFERENT ATR wearing
    // atr.1h.14's name: before IB-052 this returned a value computed over whatever arrived.
    expect(why(volatilityFeatures({ bars: { '1h': bars(window('atr.1h.14') - 1) } })['atr.1h.14'])).toBe('insufficient_history');
  });

  it('computes at EXACTLY the declared window, the boundary', () => {
    expect(val(volatilityFeatures({ bars: { '1h': bars(window('atr.1h.14')) } })['atr.1h.14'])).toBeDefined();
  });

  it('distinguishes no bars at all from too few', () => {
    expect(why(volatilityFeatures({ bars: {} })['atr.1d.14'])).toBe('no_data');
  });

  it('emits all three timeframes independently', () => {
    const f = volatilityFeatures({ bars: { '1h': bars(window('atr.1h.14')) } });
    expect(val(f['atr.1h.14'])).toBeDefined();
    expect(why(f['atr.4h.14'])).toBe('no_data');
    expect(Object.keys(f)).toHaveLength(3);
  });
});
