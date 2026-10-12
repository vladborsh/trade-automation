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

/**
 * IB-015 — the frame must not contradict itself.
 *
 * Found on the first real run against `insight_dev2`: one frame published
 * `liq.long.60m: {ok:false, why:'no_data'}` and `liq.long.z60m: {ok:true, value:3.91}` — a
 * standard-deviation score of a quantity the same frame had just said it did not have. A
 * consumer reading per key, which is exactly what `canArm` asks it to do, would have armed on
 * the z-score.
 */
describe('a z-score cannot outlive the sum it scores', () => {
  const history = Array.from({ length: 400 }, (_, i) => 1000 + i * 10);

  it('refuses the z-score whenever it refuses the sum', () => {
    const out = liquidationFeatures({
      sums: { long: { m15: 0, m60: 5000 }, short: { m15: 0, m60: 0 } },
      history: { long: history, short: history },
      hasAnyHistory: false,
    });
    expect(out['liq.long.60m']).toEqual({ ok: false, why: 'no_data' });
    expect(out['liq.long.z60m']).toEqual({ ok: false, why: 'insufficient_history' });
  });

  it('computes both once the history floor is cleared', () => {
    // The same sample and the same sum: the ONLY thing that changed is whether the history
    // exists, which is what the gate is for.
    const out = liquidationFeatures({
      sums: { long: { m15: 0, m60: 5000 }, short: { m15: 0, m60: 0 } },
      history: { long: history, short: history },
      hasAnyHistory: true,
    });
    expect(out['liq.long.60m']).toEqual({ ok: true, value: 5000 });
    expect(out['liq.long.z60m']?.ok).toBe(true);
  });

  it('never publishes a z-score beside a refused sum, for either side', () => {
    for (const hasAnyHistory of [true, false]) {
      const out = liquidationFeatures({
        sums: { long: { m15: 1, m60: 2 }, short: { m15: 3, m60: 4 } },
        history: { long: history, short: history },
        hasAnyHistory,
      });
      for (const side of ['long', 'short'] as const) {
        const sum = out[`liq.${side}.60m`];
        const z = out[`liq.${side}.z60m`];
        if (sum && !sum.ok) expect(z?.ok).toBe(false);
      }
    }
  });
});
