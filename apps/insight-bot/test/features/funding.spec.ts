import { computeFunding, isExtremeHigh, isExtremeLow, type VenueFunding } from '../../src/features/calc/funding';
import { WINDOWS } from '../../src/features/feature-keys';

/**
 * IB-015 — the funding group (§8.2), on hand-built history.
 *
 * The count of extreme venues is the observable the squeeze family was built on and the one the
 * Researcher found never co-occurred across two venues in a holdout year (§16.5). It is still
 * computed: a count of zero is evidence, and the frame is a record.
 */

/** 90 settlements rising from 0.00001 to 0.0009, so a percentile is well defined. */
const HISTORY = Array.from({ length: 90 }, (_, i) => (i + 1) / 100_000);

const venue = (over: Partial<VenueFunding> = {}): VenueFunding => ({
  venue: 'binance', rate: 0.0005, history: HISTORY, ...over,
});

describe('the extreme definition (§8.2: percentile AND absolute rate)', () => {
  it('needs both halves — a high percentile on a tiny rate is not extreme', () => {
    expect(isExtremeHigh(0.99, 0.00001)).toBe(false); // percentile yes, rate no
    expect(isExtremeHigh(0.5, 0.01)).toBe(false); // rate yes, percentile no
    expect(isExtremeHigh(0.99, 0.01)).toBe(true);
  });

  it('is inclusive at the stated boundaries', () => {
    expect(isExtremeHigh(WINDOWS.extremeHiPct, WINDOWS.extremeHiRate)).toBe(true);
    expect(isExtremeLow(WINDOWS.extremeLoPct, WINDOWS.extremeLoRate)).toBe(true);
  });

  it('the low side needs a NEGATIVE rate, not merely a small one', () => {
    expect(isExtremeLow(0.05, 0.0001)).toBe(false);
    expect(isExtremeLow(0.05, -0.0005)).toBe(true);
  });

  it('an unknown percentile is never extreme — null is not "not extreme", it is unknown', () => {
    expect(isExtremeHigh(null, 0.01)).toBe(false);
    expect(isExtremeLow(null, -0.01)).toBe(false);
  });
});

describe('computeFunding', () => {
  it('emits a rate and a percentile per venue, and the predicted rate', () => {
    const out = computeFunding({
      venues: [venue({ venue: 'binance' }), venue({ venue: 'bybit', rate: 0.0001 })],
      predictedBinance: 0.00012,
    });
    expect(out['funding.binance.rate']).toBe(0.0005);
    expect(out['funding.bybit.rate']).toBe(0.0001);
    expect(out['funding.predicted.binance']).toBe(0.00012);
    // 0.0005 is the 50th of 90 rising samples → 50/90
    expect(out['funding.binance.pct30d']).toBeCloseTo(50 / 90, 10);
  });

  it('counts the venues at each extreme', () => {
    const out = computeFunding({
      venues: [
        venue({ venue: 'binance', rate: 0.0009 }), // top of the series, ≥ 0.0003 → extreme high
        venue({ venue: 'bybit', rate: 0.0009 }),
        venue({ venue: 'okx', rate: 0.0002 }), // mid-series, not extreme
      ],
      predictedBinance: null,
    });
    expect(out['funding.extreme_hi_venues']).toBe(2);
    expect(out['funding.extreme_lo_venues']).toBe(0);
  });

  it('a venue with too LITTLE history contributes nothing, not a zero', () => {
    // a newly listed venue would otherwise be silently counted as "not extreme", understating
    // the count exactly when the venue is new
    const out = computeFunding({
      venues: [venue({ venue: 'okx', rate: 0.01, history: [0.0001, 0.0002] })],
      predictedBinance: null,
    });
    expect(out['funding.okx.pct30d']).toBeNull();
    expect(out['funding.extreme_hi_venues']).toBe(0);
  });

  it('a venue with no settled rate yields nulls, never 0', () => {
    const out = computeFunding({
      venues: [venue({ venue: 'okx', rate: null })],
      predictedBinance: null,
    });
    expect(out['funding.okx.rate']).toBeNull();
    expect(out['funding.okx.pct30d']).toBeNull();
  });

  it('counts the low extreme on a negative series', () => {
    const negative = Array.from({ length: 90 }, (_, i) => -(i + 1) / 100_000);
    const out = computeFunding({
      venues: [venue({ venue: 'binance', rate: -0.0009, history: negative })],
      predictedBinance: null,
    });
    expect(out['funding.extreme_lo_venues']).toBe(1);
    expect(out['funding.extreme_hi_venues']).toBe(0);
  });

  it('zero venues is a valid frame, not a crash', () => {
    const out = computeFunding({ venues: [], predictedBinance: null });
    expect(out['funding.extreme_hi_venues']).toBe(0);
    expect(out['funding.predicted.binance']).toBeNull();
  });
});
