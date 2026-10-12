import type { WebFeatureValue } from '@trade-automation/contracts';
import { openInterestFeatures, type OiInput } from '../../src/features/calculators/open-interest';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const at = (t: number, value: number) => ({ timeSec: t, value });

const input = (over: Partial<OiInput> = {}): OiInput =>
  ({ now: at(100, 1000), ago24h: at(1, 800), ago4h: at(50, 900), sevenDays: [at(1, 800)], ...over });

describe('open interest', () => {
  it('reports the slot at the close and both deltas as percentages', () => {
    const f = openInterestFeatures(input());
    expect(val(f['oi.binance.now'])).toBe(1000);
    expect(val(f['oi.d24h_pct'])).toBeCloseTo(25, 10);   // 800 -> 1000
    expect(val(f['oi.d4h_pct'])).toBeCloseTo(11.111, 3); // 900 -> 1000
  });

  it('A DELTA ACROSS A COLLECTION GAP IS REFUSED, not measured from the nearest slot', () => {
    // The nearest slot on a day with an outage is an arbitrary distance away, and the resulting
    // percentage looks like an ordinary move.
    const f = openInterestFeatures(input({ ago24h: null }));
    expect(why(f['oi.d24h_pct'])).toBe('no_data');
    expect(val(f['oi.d4h_pct'])).toBeDefined(); // the other delta is unaffected
  });

  it('refuses a delta against a zero reference rather than dividing by it', () => {
    expect(why(openInterestFeatures(input({ ago4h: at(50, 0) }))['oi.d4h_pct']))
      .toBe('insufficient_history');
  });

  it('at_7d_high is inclusive, so the day it SETS the high reads true', () => {
    expect(val(openInterestFeatures(input({ now: at(100, 900), sevenDays: [at(1, 900), at(2, 500)] }))['oi.at_7d_high']))
      .toBe(true);
    expect(val(openInterestFeatures(input({ now: at(100, 899), sevenDays: [at(1, 900)] }))['oi.at_7d_high']))
      .toBe(false);
  });

  it('refuses everything when the close slot itself is missing', () => {
    const f = openInterestFeatures(input({ now: null }));
    for (const key of ['oi.binance.now', 'oi.d24h_pct', 'oi.d4h_pct', 'oi.at_7d_high'] as const) {
      expect(f[key]?.ok).toBe(false);
    }
  });
});
