import type { WebFeatureValue } from '@trade-automation/contracts';
import { liquidationFeatures, type LiqInput } from '../../src/features/calculators/liquidations';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);

const input = (over: Partial<LiqInput> = {}): LiqInput => ({
  sums: { long: { m15: 1000, m60: 5000 }, short: { m15: 0, m60: 0 } },
  history: { long: [], short: [] },
  hasAnyHistory: true,
  ...over,
});

describe('liquidation features', () => {
  it('A QUIET WINDOW IS A REAL ZERO and is reported', () => {
    expect(val(liquidationFeatures(input())['liq.short.15m'])).toBe(0);
  });

  it('but a symbol with NO liquidation history at all is absent, not zero', () => {
    expect(why(liquidationFeatures(input({ hasAnyHistory: false }))['liq.short.15m'])).toBe('no_data');
  });

  it('REFUSES the z-score until 14 days of history exist, per §8.2', () => {
    // 336 hourly samples. On the current tape most symbols will refuse this for weeks, which is
    // the product-readiness number and not a defect.
    expect(why(liquidationFeatures(input({ history: { long: [1, 2, 3], short: [] } }))['liq.long.z60m']))
      .toBe('insufficient_history');
  });

  it('computes the z-score once there is enough history', () => {
    const history = Array.from({ length: 400 }, (_, i) => i * 10);
    const f = liquidationFeatures(input({ history: { long: history, short: history } }));
    expect(typeof val(f['liq.long.z60m'])).toBe('number');
  });

  it('refuses the z-score on a flat history rather than reporting "exactly normal"', () => {
    const flat = Array.from({ length: 400 }, () => 100);
    expect(why(liquidationFeatures(input({ history: { long: flat, short: flat } }))['liq.long.z60m']))
      .toBe('insufficient_history');
  });

  it('emits all six keys', () => {
    expect(Object.keys(liquidationFeatures(input()))).toHaveLength(6);
  });
});
