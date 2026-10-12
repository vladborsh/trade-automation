import type { WebFeatureValue } from '@trade-automation/contracts';
import { cvdFeatures, cvdOf, slopeSign, type CvdBar, type CvdWindows } from '../../src/features/calculators/cvd';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const bar = (volume: number, takerBuyVolume: number | null): CvdBar => ({ volume, takerBuyVolume });
const windows = (over: Partial<CvdWindows> = {}): CvdWindows =>
  ({ last4h: [bar(10, 7)], last24h: [bar(10, 7)], previous4h: [bar(10, 3)], ...over });

describe('cvdOf', () => {
  it('is the sum of 2*taker - volume', () => {
    // buy-dominated: 2*7 - 10 = +4 ; sell-dominated: 2*3 - 10 = -4
    expect(cvdOf([bar(10, 7), bar(10, 3)])).toBe(0);
    expect(cvdOf([bar(10, 7)])).toBe(4);
  });

  it('A NULL TAKER SPLIT BREAKS THE WINDOW rather than counting as zero', () => {
    // takerBuyVolume is nullable. Treating null as 0 would make the bar read 0 - volume, i.e.
    // maximum selling, invented out of a missing field.
    expect(cvdOf([bar(10, 7), bar(10, null)])).toBeNull();
  });

  it('is null for an empty window', () => {
    expect(cvdOf([])).toBeNull();
  });
});

describe('slopeSign', () => {
  it('is the SIGN, never the delta', () => {
    expect(slopeSign(100, 1)).toBe(1);
    expect(slopeSign(1, 100)).toBe(-1);
    expect(slopeSign(5, 5)).toBe(0);
  });
});

describe('cvdFeatures', () => {
  it('A SYMBOL WITH NO SPOT MARKET IS not_applicable, NEVER ZERO', () => {
    // §8.2 is explicit. A zero spot CVD on a perp-only listing reads as perfectly balanced spot
    // flow — a claim about a market that does not exist.
    const f = cvdFeatures({ perp: windows(), spot: null });
    for (const key of ['cvd.spot.4h', 'cvd.spot.24h', 'cvd.spot.slope_4h'] as const) {
      expect(why(f[key])).toBe('not_applicable');
    }
    expect(val(f['cvd.perp.4h'])).toBe(4); // the perp side is unaffected
  });

  it('distinguishes "no spot market" from "an empty spot window"', () => {
    const f = cvdFeatures({ perp: windows(), spot: windows({ last4h: [], last24h: [], previous4h: [] }) });
    expect(why(f['cvd.spot.4h'])).toBe('no_data'); // the market exists; the window is empty
  });

  it('refuses the slope when either window is unusable', () => {
    const f = cvdFeatures({ perp: windows({ previous4h: [bar(10, null)] }), spot: null });
    expect(why(f['cvd.perp.slope_4h'])).toBe('no_data');
    expect(val(f['cvd.perp.4h'])).toBe(4); // the level still computes
  });

  it('emits all six keys', () => {
    expect(Object.keys(cvdFeatures({ perp: windows(), spot: null }))).toHaveLength(6);
  });
});
