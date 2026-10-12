import {
  crowdedSideAxis, eventWindowAxis, leverageAxis, trendAxis, volAxis, type PercentileRank,
} from '../../src/regime/axes';
import type { WebFeatureUnavailable, WebFeatureValue } from '@trade-automation/contracts';
import { REGIME_SPEC } from '../../src/regime/regime-spec';

/**
 * IB-016 — the axes, on hand-built numbers with the arithmetic written out.
 *
 * The refusal path is spec'd as carefully as the happy one, because what an axis is wrong about
 * when it is wrong is never the market — it is whether it should have answered at all.
 */

/**
 * IB-015's definition, restated HERE ONLY so the spec can drive the calculators while the
 * production code owns no second copy: rank-based, ties at-or-below, `null` under `minPeriods`.
 * The wiring passes `percentileOf` itself once IB-015 merges.
 */
const percentileRank: PercentileRank = (sample, value, minPeriods) => {
  if (sample.length < minPeriods) return null;
  let atOrBelow = 0;
  for (const x of sample) if (x <= value) atOrBelow += 1;
  return atOrBelow / sample.length;
};

const value = (n: number): WebFeatureValue => ({ ok: true, value: n });
const refused = (why: WebFeatureUnavailable): WebFeatureValue => ({ ok: false, why });

/** `n` ascending values, so a percentile is easy to check by hand. */
const ramp = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

describe('trendAxis', () => {
  // every input is a FRAME KEY (Tech Lead ruling): regime computes no EMAs of its own
  const trend = (fastNow: number, fastThen: number | null, slow: number, price: number) =>
    trendAxis({
      fastNow: value(fastNow),
      fastThen: fastThen === null ? null : value(fastThen),
      slow: value(slow),
      price: value(price),
    });

  it('is UP only when the slope and the 200-day side agree', () => {
    expect(trend(106, 100, 90, 100)).toEqual({ ok: true, value: 'UP' });
  });

  it('is DOWN only when both point down', () => {
    expect(trend(100, 106, 110, 100)).toEqual({ ok: true, value: 'DOWN' });
  });

  it('is RANGE when the two halves disagree — a finding, not a default', () => {
    expect(trend(106, 100, 110, 100)).toEqual({ ok: true, value: 'RANGE' }); // rising, but under the 1d line
    expect(trend(100, 106, 90, 100)).toEqual({ ok: true, value: 'RANGE' }); // falling, but over it
  });

  it('is RANGE on a flat EMA, because the sign decides and zero has no sign', () => {
    expect(trend(100, 100, 90, 100)).toEqual({ ok: true, value: 'RANGE' });
    expect(REGIME_SPEC.trend.params.slopeMinimum).toBe(0);
  });

  it('refuses when the frame `slopeBars` back does not exist yet', () => {
    // short history, not a broken input — the series reaches back far enough on its own
    expect(trend(106, null, 90, 100)).toEqual({ ok: false, why: 'insufficient_history' });
    expect(REGIME_SPEC.trend.params.slopeBars).toBe(6);
  });

  it('carries each key’s own refusal — never a RANGE that means “unknown”', () => {
    const base = { fastNow: value(106), fastThen: value(100), slow: value(90), price: value(100) };
    expect(trendAxis({ ...base, fastNow: refused('incomplete_input') })).toEqual({
      ok: false,
      why: 'incomplete_input',
    });
    expect(trendAxis({ ...base, fastThen: refused('incomplete_input') })).toEqual({
      ok: false,
      why: 'incomplete_input',
    });
    // ema.1d.200 needs 200 daily bars where candles_agg holds ~10: the expected state until the
    // archive backfill lands, and it must read as "not measured" rather than as RANGE
    expect(trendAxis({ ...base, slow: refused('insufficient_history') })).toEqual({
      ok: false,
      why: 'insufficient_history',
    });
    expect(trendAxis({ ...base, price: refused('no_data') })).toEqual({ ok: false, why: 'no_data' });
  });
});

describe('volAxis', () => {
  const history = ramp(100); // 1..100, so a value of v sits at percentile v/100

  it('reads §8.3’s bands with the middle closed on both sides', () => {
    expect(volAxis(value(29), history, percentileRank)).toEqual({ ok: true, value: 'LOW' });
    expect(volAxis(value(30), history, percentileRank)).toEqual({ ok: true, value: 'NORMAL' }); // 0.30 exactly
    expect(volAxis(value(80), history, percentileRank)).toEqual({ ok: true, value: 'NORMAL' }); // 0.80 exactly
    expect(volAxis(value(81), history, percentileRank)).toEqual({ ok: true, value: 'HIGH' });
  });

  it('carries the key’s own refusal — ATR unknown is not volatility NORMAL', () => {
    expect(volAxis(refused('incomplete_input'), history, percentileRank)).toEqual({
      ok: false,
      why: 'incomplete_input',
    });
    expect(volAxis(refused('insufficient_history'), history, percentileRank)).toEqual({
      ok: false,
      why: 'insufficient_history',
    });
  });

  it('refuses when the sample is too small to be the percentile §8.3 means', () => {
    expect(volAxis(value(10), ramp(44), percentileRank)).toEqual({ ok: false, why: 'insufficient_history' });
    expect(volAxis(value(10), ramp(45), percentileRank).ok).toBe(true);
    expect(REGIME_SPEC.vol.params.minPeriods).toBe(45);
  });
});

describe('leverageAxis — directionless, the OI percentile alone', () => {
  const history = ramp(100);

  it('is LEVERED at or above the high band, DELEVERED at or below the low one', () => {
    expect(leverageAxis(value(80), history, percentileRank)).toEqual({ ok: true, value: 'LEVERED' });
    expect(leverageAxis(value(30), history, percentileRank)).toEqual({ ok: true, value: 'DELEVERED' });
    expect(leverageAxis(value(50), history, percentileRank)).toEqual({ ok: true, value: 'NEUTRAL' });
  });

  it('takes no funding argument at all, so levered shorts cannot be hidden', () => {
    // Ruling 2026-10-12: a crowded short book cascades upward exactly as a crowded long book
    // cascades down. An axis that called high-OI-with-negative-funding NEUTRAL would hide them —
    // the signature itself now makes that combination unexpressible.
    expect(leverageAxis).toHaveLength(3);
  });

  it('carries the OI key’s refusal through', () => {
    expect(leverageAxis(refused('no_data'), history, percentileRank)).toEqual({ ok: false, why: 'no_data' });
  });

  it('refuses on a short percentile sample', () => {
    expect(leverageAxis(value(85), ramp(10), percentileRank)).toEqual({
      ok: false,
      why: 'insufficient_history',
    });
  });
});

describe('crowdedSideAxis — the other half of the sentence, as its own fact', () => {
  it('reads the SIGN of the mean, not the latest print', () => {
    expect(crowdedSideAxis([0.0001, 0.0002, 0.0003])).toEqual({ ok: true, value: 'LONGS' });
    expect(crowdedSideAxis([-0.0001, -0.0002, -0.0003])).toEqual({ ok: true, value: 'SHORTS' });
    // two positive prints and a larger negative one: the mean is negative although the last is not
    expect(crowdedSideAxis([0.0001, 0.0001, -0.0005])).toEqual({ ok: true, value: 'SHORTS' });
  });

  it('calls an exactly balanced book BALANCED — a measurement, not the bucket for “unknown”', () => {
    expect(crowdedSideAxis([0.0002, -0.0002, 0])).toEqual({ ok: true, value: 'BALANCED' });
  });

  it('refuses on too few settlements rather than calling one print a three-day mean', () => {
    expect(crowdedSideAxis([0.0001, 0.0002])).toEqual({ ok: false, why: 'insufficient_history' });
    expect(REGIME_SPEC.crowdedSide.params.minSettlements).toBe(3);
  });
});

describe('eventWindowAxis', () => {
  const noon = Date.UTC(2026, 9, 12, 12, 0) / 1000;
  const usdHigh = (offsetMin: number) => ({ timeSec: noon + offsetMin * 60, impact: 'High', currency: 'USD' });

  it('is EVENT_RISK inside the window, on either side of the event', () => {
    expect(eventWindowAxis(noon, [usdHigh(59)], true)).toEqual({ ok: true, value: 'EVENT_RISK' });
    expect(eventWindowAxis(noon, [usdHigh(-59)], true)).toEqual({ ok: true, value: 'EVENT_RISK' });
    expect(eventWindowAxis(noon, [usdHigh(60)], true)).toEqual({ ok: true, value: 'EVENT_RISK' }); // inclusive
  });

  it('is CLEAR outside it, and ignores events that are not high-impact USD', () => {
    expect(eventWindowAxis(noon, [usdHigh(61)], true)).toEqual({ ok: true, value: 'CLEAR' });
    expect(eventWindowAxis(noon, [{ ...usdHigh(0), impact: 'medium' }], true)).toEqual({ ok: true, value: 'CLEAR' });
    expect(eventWindowAxis(noon, [{ ...usdHigh(0), currency: 'EUR' }], true)).toEqual({ ok: true, value: 'CLEAR' });
  });

  it('matches the venue’s casing however it sends it', () => {
    expect(eventWindowAxis(noon, [{ ...usdHigh(0), impact: 'HIGH', currency: 'usd' }], true)).toEqual({
      ok: true,
      value: 'EVENT_RISK',
    });
  });

  it('REFUSES when the calendar is not known to be loaded — never CLEAR on an empty table', () => {
    // an empty list is what a quiet hour looks like AND what a collector that never ran looks like;
    // this axis feeds a veto, so the one way it must never fail is silently permissive
    expect(eventWindowAxis(noon, [], false)).toEqual({ ok: false, why: 'no_data' });
    expect(eventWindowAxis(noon, [], true)).toEqual({ ok: true, value: 'CLEAR' });
  });
});
