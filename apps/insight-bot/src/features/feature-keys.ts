/**
 * IB-015 — the feature frame's key set (design §8.2), fixed and versioned.
 *
 * **The windows here are not tuned and must not be.** §8.2 is explicit: they are the project's
 * conventions, and changing one is a new `frame_version`, not an edit. That is what makes a
 * stored frame admissible later as a point-in-time snapshot — a frame whose meaning drifted
 * with its definition cannot be used to judge a playbook after the fact.
 *
 * So this file is a contract, not a configuration: the key union, the version, and the windows
 * as named constants. A calculator imports the window from here rather than inlining a number,
 * so "what was `cvd.spot.4h` in frame_version 1" has one answer.
 */

/**
 * Bump when ANY key is added, removed, or its definition changes — including a window length.
 * Frames of different versions are never compared.
 */
export const FRAME_VERSION = 1;

export const FEATURE_KEYS = [
  // funding, per venue (§8.2)
  'funding.binance.rate', 'funding.bybit.rate', 'funding.okx.rate',
  'funding.binance.pct30d', 'funding.bybit.pct30d', 'funding.okx.pct30d',
  'funding.extreme_hi_venues', 'funding.extreme_lo_venues',
  'funding.predicted.binance',
  // open interest
  'oi.binance.now', 'oi.d24h_pct', 'oi.d4h_pct', 'oi.at_7d_high',
  // long/short, latest 5m value and its 30-day percentile
  'ls.top_position', 'ls.top_position.pct30d',
  'ls.global_account', 'ls.global_account.pct30d',
  'ls.taker', 'ls.taker.pct30d',
  // cumulative volume delta, base units, from candles_1m taker fields
  'cvd.spot.4h', 'cvd.spot.24h', 'cvd.perp.4h', 'cvd.perp.24h',
  'cvd.spot.slope_4h', 'cvd.perp.slope_4h',
  // volatility
  'atr.1h.14', 'atr.4h.14', 'atr.1d.14',
  // structure
  'structure.swing_high_12h', 'structure.swing_low_12h', 'structure.failed_highs_24h',
  'structure.impulse_low_15m',
  // liquidations
  'liq.long.15m', 'liq.long.60m', 'liq.short.15m', 'liq.short.60m',
  'liq.long.z60m', 'liq.short.z60m',
  // price context
  'px.ret_24h', 'px.ret_4h', 'px.drawdown_from_24h_high',
  // the §9.2 label
  'label.p4',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** The P4 label's values (§9.2). Kept here because it is part of the frame's contract. */
export const P4_LABELS = ['SPOT_LED', 'PERP_LED', 'ABSORPTION', 'DISTRIBUTION', 'NONE'] as const;
export type P4Label = (typeof P4_LABELS)[number];

/**
 * A frame's values. **`null` means "not computable from the data we have"** and is a first-class
 * outcome, never a zero: a symbol with no spot market has `null` CVD, and `liq.*.z60m` is null
 * until 14 days of liquidation history exist (§8.2). Zero would be a measurement; null is an
 * admission, and the two must not be confused by anything downstream.
 */
export type FeatureValue = number | boolean | P4Label | null;
export type FeatureFrameValues = Partial<Record<FeatureKey, FeatureValue>>;

/**
 * The windows and thresholds §8.2 fixes. Named, so a calculator never inlines one and a reader
 * can see the whole contract in one place.
 */
export const WINDOWS = {
  /** Percentiles: the project's 30-day convention, over the venue's last 90 settlements. */
  fundingPercentileSamples: 90,
  /** Below this many samples a percentile is null rather than a number off a short series. */
  fundingPercentileMinPeriods: 45,
  /** The funding-family "extreme" definition (§8.2). */
  extremeHiPct: 0.9,
  extremeHiRate: 0.0003,
  extremeLoPct: 0.1,
  extremeLoRate: -0.0003,
  /** OI deltas. */
  oiDelta24hMs: 24 * 3_600_000,
  oiDelta4hMs: 4 * 3_600_000,
  oi7dHighMs: 7 * 24 * 3_600_000,
  /** L/S percentiles, 30 days of 5-minute slots. */
  lsPercentileDays: 30,
  lsPercentileMinPeriods: 45,
  /** CVD windows, in milliseconds. */
  cvd4hMs: 4 * 3_600_000,
  cvd24hMs: 24 * 3_600_000,
  /** Wilder ATR period. */
  atrPeriod: 14,
  /** Structure, over 15m bars. */
  swingWindowMs: 12 * 3_600_000,
  failedHighWindowMs: 24 * 3_600_000,
  /** A pivot is a 3-bar high/low (§8.2). */
  pivotBars: 3,
  /** Liquidation sums. */
  liq15mMs: 15 * 60_000,
  liq60mMs: 60 * 60_000,
  /** The z-score's trailing sample, and the history below which it stays null. */
  liqZTrailingDays: 30,
  liqZMinHistoryDays: 14,
  /** Price context. */
  ret24hMs: 24 * 3_600_000,
  ret4hMs: 4 * 3_600_000,
  drawdownWindowMs: 24 * 3_600_000,
} as const;

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
