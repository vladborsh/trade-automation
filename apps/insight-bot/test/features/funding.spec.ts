import type { WebFeatureCount, WebFeatureValue } from '@trade-automation/contracts';
import {
  FUNDING_EXTREME, fundingFeatures, matchesSettlementConvention, settlementIntervalHours,
  type FundingInput, type Settlement,
} from '../../src/features/calculators/funding';

/** 8-hourly settlements ending at a fixed UTC instant, oldest first. */
const T_END = Date.UTC(2026, 9, 12, 0, 0, 0) / 1000;
const every = (rates: readonly number[], hours = 8): Settlement[] =>
  rates.map((rate, i) => ({ timeSec: T_END - (rates.length - 1 - i) * hours * 3600, rate }));

/**
 * IB-015 §8.2 — the funding group. The interesting cases are the refusals and the denominator.
 */

/** A venue history whose last value sits at a chosen percentile of a 90-long window. */
const ratesEndingAt = (last: number, others: number): Settlement[] => every([
  ...Array.from({ length: FUNDING_EXTREME.window - 1 }, () => others),
  last,
]);

const input = (over: Partial<FundingInput> = {}): FundingInput => ({
  settled: {}, predictedBinance: null, ...over,
});

const val = (v: WebFeatureValue | undefined) => (v?.ok === true ? v.value : undefined);
const why = (v: WebFeatureValue | undefined) => (v?.ok === false ? v.why : undefined);

describe('per-venue rate and percentile', () => {
  it('reports the LAST settled rate and its percentile', () => {
    // 89 settlements at -0.0001 and the newest at +0.001: it is the maximum, so pct = 1.0
    const f = fundingFeatures(input({ settled: { binance: ratesEndingAt(0.001, -0.0001) } }));
    expect(val(f['funding.binance.rate'])).toBeCloseTo(0.001, 10);
    expect(val(f['funding.binance.pct30d'])).toBeCloseTo(1, 10);
  });

  it('DISTINGUISHES "no settlements" from "not enough settlements"', () => {
    // These are different facts and only one of them means "go look for a collector".
    const none = fundingFeatures(input({ settled: {} }));
    expect(why(none['funding.okx.rate'])).toBe('no_data');
    expect(why(none['funding.okx.pct30d'])).toBe('no_data');

    const few = fundingFeatures(input({ settled: { okx: every([0.0001, 0.0002, 0.0003]) } }));
    expect(val(few['funding.okx.rate'])).toBeCloseTo(0.0003, 10); // the rate is perfectly good
    expect(why(few['funding.okx.pct30d'])).toBe('insufficient_history');
  });

  it('never reports a rate of zero for a venue that said nothing', () => {
    const f = fundingFeatures(input({ settled: { binance: every([0.0001]) } }));
    expect(f['funding.bybit.rate']?.ok).toBe(false);
    expect(val(f['funding.bybit.rate'])).toBeUndefined();
  });

  it('uses only the last 90 settlements even when more are handed over', () => {
    // 200 old highs then 90 lows ending at the lowest: within the window it is the minimum.
    const rates = every([...Array.from({ length: 200 }, () => 9), ...Array.from({ length: 90 }, () => 1)]);
    const f = fundingFeatures(input({ settled: { binance: rates } }));
    expect(val(f['funding.binance.pct30d'])).toBeCloseTo(1, 10); // all 90 in-window equal 1 -> ties count
  });
});

describe('the extreme-venue counts carry their denominator', () => {
  it('counts only venues meeting BOTH halves of the §8.2 condition', () => {
    const f = fundingFeatures(input({
      settled: {
        binance: ratesEndingAt(0.001, -0.0001),  // top percentile AND rate >= +0.0003 -> counts
        bybit: ratesEndingAt(0.0001, -0.0001),   // top percentile but rate below +0.0003 -> no
        okx: ratesEndingAt(-0.001, 0.0005),      // lowest percentile and rate <= -0.0003 -> lo
      },
    }));
    expect(val(f['funding.extreme_hi_venues']) as WebFeatureCount).toEqual({ count: 1, of: 3 });
    expect(val(f['funding.extreme_lo_venues']) as WebFeatureCount).toEqual({ count: 1, of: 3 });
  });

  it('EXCLUDES a venue it could not assess from the denominator, not just the numerator', () => {
    // bybit has a rate but too little history for a percentile, so §8.2's two-part test cannot
    // be applied to it at all. "1 of 2" is the honest answer; "1 of 3" would imply bybit was
    // tested and found calm.
    const f = fundingFeatures(input({
      settled: {
        binance: ratesEndingAt(0.001, -0.0001),
        bybit: every([0.002, 0.002, 0.002]),
        okx: ratesEndingAt(0.0001, 0.0001),
      },
    }));
    expect(val(f['funding.extreme_hi_venues']) as WebFeatureCount).toEqual({ count: 1, of: 2 });
  });

  it('§8.2 thresholds are INCLUSIVE: exactly on the boundary counts', () => {
    // 81 of 90 settlements at or below the last one is a percentile of exactly 0.90, and the
    // rate is exactly +0.0003 — both halves of the condition sit on their boundary. §8.2 says
    // ">= 0.90" and ">= +0.0003", so this venue counts. A `>` would silently drop it and no
    // parameter or definition would reveal the change; this and the golden are what catch it.
    const onBoundary = every([
      ...Array.from({ length: 80 }, () => -0.001),
      ...Array.from({ length: 9 }, () => 0.001),
      FUNDING_EXTREME.hiRate,
    ]);
    const f = fundingFeatures(input({ settled: { binance: onBoundary } }));
    expect(val(f['funding.binance.pct30d'])).toBeCloseTo(FUNDING_EXTREME.hiPercentile, 10);
    expect(val(f['funding.extreme_hi_venues']) as WebFeatureCount).toEqual({ count: 1, of: 1 });
  });

  it('the lo threshold is inclusive too, at exactly -0.0003 and percentile 0.10', () => {
    const onBoundary = every([
      ...Array.from({ length: 81 }, () => 0.001),  // above
      ...Array.from({ length: 8 }, () => -0.002),  // below
      FUNDING_EXTREME.loRate,                      // 9 of 90 are <= it -> pct 0.10
    ]);
    const f = fundingFeatures(input({ settled: { okx: onBoundary } }));
    expect(val(f['funding.okx.pct30d'])).toBeCloseTo(FUNDING_EXTREME.loPercentile, 10);
    expect(val(f['funding.extreme_lo_venues']) as WebFeatureCount).toEqual({ count: 1, of: 1 });
  });

  it('reads its constants from the contract registry, not from its own literals', () => {
    // One copy of each meaning-defining number, and it is the copy inside the fingerprint.
    expect(FUNDING_EXTREME.window).toBe(90);
    expect(FUNDING_EXTREME.minPeriods).toBe(45);
    expect(FUNDING_EXTREME.hiPercentile).toBe(0.9);
    expect(FUNDING_EXTREME.hiRate).toBe(0.0003);
  });

  it('REFUSES rather than reporting "0 of 0" when nothing could be assessed', () => {
    // A ratio with an empty denominator reads as calm and measures nothing — the same defect as
    // the 0-of-0 basis line on the coverage page.
    const f = fundingFeatures(input({ settled: { bybit: every([0.001]) } }));
    expect(why(f['funding.extreme_hi_venues'])).toBe('insufficient_history');
    expect(why(f['funding.extreme_lo_venues'])).toBe('insufficient_history');
  });

  it('a count of zero out of three IS a measurement and is reported', () => {
    const calm = ratesEndingAt(0.0001, 0.0001);
    const f = fundingFeatures(input({ settled: { binance: calm, bybit: calm, okx: calm } }));
    expect(val(f['funding.extreme_hi_venues']) as WebFeatureCount).toEqual({ count: 0, of: 3 });
  });
});

describe('predicted funding', () => {
  it('is reported when stored and refused when absent', () => {
    expect(val(fundingFeatures(input({ predictedBinance: -0.00002 }))['funding.predicted.binance']))
      .toBeCloseTo(-0.00002, 10);
    expect(why(fundingFeatures(input())['funding.predicted.binance'])).toBe('no_data');
  });

  it('reports a stored ZERO as a value, not as absence', () => {
    // A predicted rate of exactly zero is a measurement; `?? null` on the read would lose it.
    expect(val(fundingFeatures(input({ predictedBinance: 0 }))['funding.predicted.binance'])).toBe(0);
  });
});

describe('determinism', () => {
  it('is byte-identical across repeated computation', () => {
    const i = input({ settled: { binance: ratesEndingAt(0.001, -0.0001), okx: every([1, 2, 3]) }, predictedBinance: 0.1 });
    expect(JSON.stringify(fundingFeatures(i))).toBe(JSON.stringify(fundingFeatures(i)));
  });

  it('emits every one of its nine keys, as a value or a refusal', () => {
    const f = fundingFeatures(input());
    expect(Object.keys(f).sort()).toEqual([
      'funding.binance.pct30d', 'funding.binance.rate',
      'funding.bybit.pct30d', 'funding.bybit.rate',
      'funding.extreme_hi_venues', 'funding.extreme_lo_venues',
      'funding.okx.pct30d', 'funding.okx.rate',
      'funding.predicted.binance',
    ]);
  });
});

describe('the 8-hourly convention the key NAME depends on', () => {
  it('measures the interval from the MEDIAN gap, so one missed settlement does not reclassify a venue', () => {
    const eightly = every([1, 2, 3, 4, 5]);
    expect(settlementIntervalHours(eightly)).toBeCloseTo(8, 10);

    // drop one settlement: a single 16h gap among 8h gaps. A mean would read 9.6h.
    const withGap = [eightly[0], eightly[1], eightly[3], eightly[4]] as Settlement[];
    expect(settlementIntervalHours(withGap)).toBeCloseTo(8, 10);
    expect(matchesSettlementConvention(withGap)).toBe(true);
  });

  it('REFUSES pct30d when a venue moves to 4-hourly, because 90 settlements is then 15 days', () => {
    // The defect this prevents: the number stays plausible and measures half the window its name
    // claims. The rate is still reported — the interval changes nothing about what it is.
    const fourly = every(Array.from({ length: FUNDING_EXTREME.window }, (_, i) => i / 100000), 4);
    const f = fundingFeatures(input({ settled: { binance: fourly } }));
    expect(f['funding.binance.rate']?.ok).toBe(true);
    expect(why(f['funding.binance.pct30d'])).toBe('convention_changed');
  });

  it('drops that venue from the `of` denominator, keeping the cross-venue count unmixed', () => {
    // Otherwise `extreme_hi_venues` would compare a 15-day percentile against 30-day ones.
    const f = fundingFeatures(input({
      settled: {
        binance: ratesEndingAt(0.001, -0.0001),                                   // 8h, assessable
        okx: every(Array.from({ length: FUNDING_EXTREME.window }, () => 0.001), 4), // 4h, refused
      },
    }));
    expect((val(f['funding.extreme_hi_venues']) as WebFeatureCount).of).toBe(1);
  });

  it('tolerates a small drift rather than refusing on a few seconds', () => {
    // Funding times shift; the tolerance is a parameter and is inside the fingerprint.
    const slightly = every(Array.from({ length: 10 }, (_, i) => i / 100000), 8 * (1 + FUNDING_EXTREME.intervalTolerance / 2));
    expect(matchesSettlementConvention(slightly)).toBe(true);
  });

  it('cannot measure an interval from a single settlement, and does not pretend to', () => {
    expect(settlementIntervalHours(every([0.001]))).toBeNull();
    expect(matchesSettlementConvention(every([0.001]))).toBe(true); // the sample refusal covers it
  });
});
