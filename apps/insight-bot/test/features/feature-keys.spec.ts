import {
  FEATURE_KEYS, FRAME_VERSION, isFeatureKey, P4_LABELS, WINDOWS, type FeatureKey,
} from '../../src/features/feature-keys';

/**
 * IB-015 — the frame's contract (§8.2).
 *
 * These are not "does the array contain what I typed" tests. The frame is meant to be readable
 * years later as a point-in-time snapshot, which only holds if the key set and the windows are
 * fixed and versioned. So what is pinned here is: the set does not drift silently, the windows
 * are the conventions §8.2 names, and a change forces a version bump to be a deliberate act.
 */

describe('the key set', () => {
  it('covers every group §8.2 lists', () => {
    const groups = ['funding.', 'oi.', 'ls.', 'cvd.', 'atr.', 'structure.', 'liq.', 'px.', 'label.'];
    for (const group of groups) {
      expect(FEATURE_KEYS.some((k) => k.startsWith(group))).toBe(true);
    }
  });

  it('expands §8.2\'s shorthand for all three venues and both percentile forms', () => {
    // the design writes "funding.binance.rate, .bybit.rate, .okx.rate" and "each with .pct30d";
    // the expansion is this file's job, and getting it wrong loses a venue silently
    for (const venue of ['binance', 'bybit', 'okx']) {
      expect(FEATURE_KEYS).toContain(`funding.${venue}.rate` as FeatureKey);
      expect(FEATURE_KEYS).toContain(`funding.${venue}.pct30d` as FeatureKey);
    }
    for (const kind of ['top_position', 'global_account', 'taker']) {
      expect(FEATURE_KEYS).toContain(`ls.${kind}` as FeatureKey);
      expect(FEATURE_KEYS).toContain(`ls.${kind}.pct30d` as FeatureKey);
    }
    for (const side of ['long', 'short']) {
      for (const w of ['15m', '60m']) expect(FEATURE_KEYS).toContain(`liq.${side}.${w}` as FeatureKey);
      expect(FEATURE_KEYS).toContain(`liq.${side}.z60m` as FeatureKey);
    }
  });

  it('has no duplicates — a repeated key would silently overwrite a value', () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });

  it('is 42 keys at frame_version 1 — change this deliberately, with a version bump', () => {
    // a failing count is the point: it makes an accidental addition impossible to miss
    expect(FEATURE_KEYS).toHaveLength(42);
    expect(FRAME_VERSION).toBe(1);
  });

  it('isFeatureKey accepts only members of the set', () => {
    expect(isFeatureKey('atr.1h.14')).toBe(true);
    expect(isFeatureKey('atr.2h.14')).toBe(false);
    expect(isFeatureKey('')).toBe(false);
  });
});

describe('the windows are §8.2\'s conventions, not tuning', () => {
  it('funding percentiles: 90 settlements, min_periods 45', () => {
    expect(WINDOWS.fundingPercentileSamples).toBe(90);
    expect(WINDOWS.fundingPercentileMinPeriods).toBe(45);
  });

  it('the funding-family extreme definition', () => {
    expect(WINDOWS.extremeHiPct).toBe(0.9);
    expect(WINDOWS.extremeHiRate).toBe(0.0003);
    expect(WINDOWS.extremeLoPct).toBe(0.1);
    expect(WINDOWS.extremeLoRate).toBe(-0.0003);
  });

  it('ATR is Wilder 14, and the liquidation z-score is null below 14 days of history', () => {
    expect(WINDOWS.atrPeriod).toBe(14);
    expect(WINDOWS.liqZTrailingDays).toBe(30);
    expect(WINDOWS.liqZMinHistoryDays).toBe(14);
  });

  it('the time windows are the hours §8.2 states, in milliseconds', () => {
    expect(WINDOWS.cvd4hMs).toBe(4 * 3_600_000);
    expect(WINDOWS.cvd24hMs).toBe(24 * 3_600_000);
    expect(WINDOWS.oiDelta4hMs).toBe(4 * 3_600_000);
    expect(WINDOWS.oiDelta24hMs).toBe(24 * 3_600_000);
    expect(WINDOWS.oi7dHighMs).toBe(7 * 24 * 3_600_000);
    expect(WINDOWS.swingWindowMs).toBe(12 * 3_600_000);
    expect(WINDOWS.failedHighWindowMs).toBe(24 * 3_600_000);
    expect(WINDOWS.liq15mMs).toBe(15 * 60_000);
    expect(WINDOWS.liq60mMs).toBe(60 * 60_000);
  });
});

describe('the P4 label', () => {
  it('is §9.2\'s five values, NONE included', () => {
    expect(P4_LABELS).toEqual(['SPOT_LED', 'PERP_LED', 'ABSORPTION', 'DISTRIBUTION', 'NONE']);
  });
});
