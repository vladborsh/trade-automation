import type { WebFeatureValue } from '@trade-automation/contracts';
import { longShortFeatures } from '../../src/features/calculators/long-short';

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);
const series = (last: number, n = 60) => [...Array.from({ length: n - 1 }, () => 1), last];

describe('long/short', () => {
  it('reports the latest ratio and its percentile per kind', () => {
    const f = longShortFeatures({ series: { taker: series(9) } });
    expect(val(f['ls.taker'])).toBe(9);
    expect(val(f['ls.taker.pct30d'])).toBeCloseTo(1, 10);
  });

  it('NEVER SUBSTITUTES ONE KIND FOR ANOTHER', () => {
    // Three different populations: top accounts by position, all accounts, taker flow. A kind
    // the venue did not report is absent, not the value of its neighbour.
    const f = longShortFeatures({ series: { taker: series(9) } });
    expect(why(f['ls.top_position'])).toBe('no_data');
    expect(why(f['ls.global_account'])).toBe('no_data');
    expect(val(f['ls.taker'])).toBe(9);
  });

  it('gives a ratio but refuses its percentile when history is short', () => {
    const f = longShortFeatures({ series: { taker: [1, 2, 3] } });
    expect(val(f['ls.taker'])).toBe(3);
    expect(why(f['ls.taker.pct30d'])).toBe('insufficient_history');
  });

  it('emits all six keys', () => {
    expect(Object.keys(longShortFeatures({ series: {} }))).toHaveLength(6);
  });
});
