import { z } from 'zod';

/**
 * IB-015 — the feature frame's contract (design §8.2), shared so the writer, the dashboard and
 * the playbook engine cannot drift apart.
 *
 * Epoch SECONDS for every wire time, per the ruling in `series.ts`.
 */
const TimeSec = z.number().int().nonnegative();

/**
 * ============================ THE RULE THAT REPLACES A FLAG ============================
 *
 * **Arming is decided per KEY, never by `complete`.** A playbook names the keys it requires and
 * refuses when any of them is `ok: false`. `complete` is a cheap index meaning "this frame has
 * at least one non-computable key" — it is not a safety mechanism and must never be used as one.
 *
 * Why the frame is written at all when something is missing (Tech Lead ruling, 2026-10-12,
 * overturning an earlier preference for skipping it): **a skipped frame is indistinguishable
 * from "the feature pass was not running"**, which is IB-BUG-010 one layer up — absence cannot
 * tell you whether the thing was quiet or dead. A dense series of rows, some marked incomplete,
 * has no such ambiguity. Skipping also threw away the keys that WERE computable: a valid open
 * interest delta is not worth discarding because funding had no history.
 *
 * The protection therefore lives in the type of every value, where a consumer cannot step past
 * it, instead of in a boolean a consumer can forget to read. That is the whole of §8.1's
 * "no playbook may arm or trigger on an incomplete frame", enforced one level lower down.
 */

/** Why a key could not be computed. Four distinct facts, because they get conflated. */
export const WEB_FEATURE_UNAVAILABLE = [
  /** Nothing is stored for the window at all. */
  'no_data',
  /** Stored, but less than the definition demands — §8.2's 45 settlements, 14 days of liquidations. */
  'insufficient_history',
  /** A `candles_agg` bucket or the OI slot inside the window was not `complete = true` (§8.1/§16.10). */
  'incomplete_input',
  /** The key cannot exist for this symbol — a perp with no spot market has no `cvd.spot.*`. */
  'not_applicable',
] as const;
export const WebFeatureUnavailableSchema = z.enum(WEB_FEATURE_UNAVAILABLE);
export type WebFeatureUnavailable = z.infer<typeof WebFeatureUnavailableSchema>;

/**
 * A count that carries its own denominator — §8.2's `funding.extreme_*_venues`.
 *
 * Required by the Tech Lead's ruling, and it is dev-1's `coinsCounted` lesson restated: "3 of 20
 * venues extreme" and "3 of 3 venues extreme" are opposite facts behind the same number. `of` is
 * **the venues that actually reported**, never the venues we hope to collect — the same rule as
 * `venuesPresent` in `series.ts`.
 */
export const WebFeatureCountSchema = z.object({
  count: z.number().int().nonnegative(),
  of: z.number().int().nonnegative(),
});
export type WebFeatureCount = z.infer<typeof WebFeatureCountSchema>;

/**
 * One feature value: a measurement, or a stated refusal. **Never a nullable number.**
 *
 * A discriminated union rather than `number | null` so the two cannot be confused by accident:
 * `value ?? 0` does not yield a number here, and `FeatureValue * 2` does not compile. There is
 * no implicit unwrap — see `requireFeature` and `featureOr`, both of which make the decision
 * visible at the call site.
 *
 * `boolean` and `string` are in the value union because §8.2 is not all numbers:
 * `oi.at_7d_high` is a flag and `label.p4` is an enum. The declared type per key lives in
 * `WEB_FEATURE_SPEC` below, and a spec asserts every written value matches it.
 */
export const WebFeatureValueSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    // `{count, of}` is in the union because a count without its denominator is not a value this
    // contract is willing to carry — see `WebFeatureCountSchema`.
    value: z.union([z.number(), z.boolean(), z.string(), WebFeatureCountSchema]),
  }),
  z.object({ ok: z.literal(false), why: WebFeatureUnavailableSchema }),
]);
export type WebFeatureValue = z.infer<typeof WebFeatureValueSchema>;

/** What a frame was computed over. Not optional: a frame that cannot say what it saw is a claim. */
export const WebFrameBasisSchema = z.object({
  /** The venue set the funding and liquidation keys were computed over, sorted. */
  venues: z.array(z.string()),
  /**
   * IB-BUG-010's vocabulary. `not_recorded` is distinct from `no_events`: a collector that wrote
   * no heartbeats is not a quiet market, and dividing by elapsed hours instead of covered ones is
   * the mistake that ruling exists to prevent.
   */
  coverage: z.enum(['recorded', 'not_recorded', 'no_events']),
  /** Hours of collector uptime behind the windows; `null` when coverage is `not_recorded`. */
  coveredHours: z.number().nonnegative().nullable(),
});
export type WebFrameBasis = z.infer<typeof WebFrameBasisSchema>;

export const WebFrameTimeframeSchema = z.enum(['15m', '4h']);
export type WebFrameTimeframe = z.infer<typeof WebFrameTimeframeSchema>;

export const WebFeatureFrameSchema = z.object({
  symbol: z.string(),
  tf: WebFrameTimeframeSchema,
  /** The bar's close, epoch seconds, UTC. The frame is stamped by its bar, never by wall clock. */
  closeTime: TimeSec,
  frameVersion: z.number().int().positive(),
  /** Keyed by `WebFeatureKey`; every key in the spec is present, as a value or a refusal. */
  keys: z.record(z.string(), WebFeatureValueSchema),
  basis: WebFrameBasisSchema,
  /**
   * True when every key computed. **An index, not a gate** — see the rule at the top of this
   * file. Non-nullable: "we do not know whether it is complete" is not a state this can be in.
   */
  complete: z.boolean(),
  /** Which bucket or slot was short, when something was. Empty when `complete`. */
  incompleteReason: z.array(z.string()),
});
export type WebFeatureFrame = z.infer<typeof WebFeatureFrameSchema>;

/**
 * ================================ VERSIONING ================================
 *
 * Bumped on a change of MEANING, not only of shape: a new key, a removed key, a changed window,
 * or a changed definition. `WEB_FEATURE_SPEC` carries each key's window and definition text, and
 * a spec asserts a checksum over the whole registry against a committed literal — so a silent
 * change fails the build and the only way through is to bump this and update the literal.
 *
 * **Old frames are kept and read version-aware. They are never recomputed in place.** A stored
 * frame is the record of what a signal was actually armed on; rewriting it destroys the ability
 * to answer "was the signal wrong, or is the feature different now?". If a cross-version
 * comparison is ever needed, recompute into a separate set and compare — and note that
 * **mixing versions inside one comparison is an error a consumer must refuse**, not a footnote.
 */
export const WEB_FRAME_VERSION = 1;


/**
 * ============================= THE KEY SET (design §8.2) =============================
 *
 * **Fixed here and not tuned.** §8.2: "Windows are fixed here and are not tuned; a change is a
 * new `frame_version`." Each entry carries the key's declared `type`, its `window`, and a `def`
 * in words — the `def` is where a calculator's MEANING is written down, so changing a
 * calculator without changing its `def` is the reviewable mistake, and changing either moves the
 * checksum and fails the build until `WEB_FRAME_VERSION` is bumped.
 *
 * `count` keys are `{ count, of }` (see `WebFeatureCountSchema`); `enum` keys list their values.
 */
export const WEB_FEATURE_SPEC = {
  // ---- funding
  'funding.binance.rate': { type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on binance' },
  'funding.bybit.rate': { type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on bybit' },
  'funding.okx.rate': { type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on okx' },
  'funding.binance.pct30d': { type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45 }, def: 'percentile of the last settled rate among the venue last N settlements' },
  'funding.bybit.pct30d': { type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45 }, def: 'percentile of the last settled rate among the venue last N settlements' },
  'funding.okx.pct30d': { type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45 }, def: 'percentile of the last settled rate among the venue last N settlements' },
  'funding.extreme_hi_venues': { type: 'count', window: 'per venue', params: { percentile: 0.9, rate: 0.0003, denominator: 'venues_assessable' }, def: 'venues at or above the percentile AND at or above the rate, of the venues that could be assessed' },
  'funding.extreme_lo_venues': { type: 'count', window: 'per venue', params: { percentile: 0.1, rate: -0.0003, denominator: 'venues_assessable' }, def: 'venues at or below the percentile AND at or below the rate, of the venues that could be assessed' },
  'funding.predicted.binance': { type: 'number', window: 'latest', params: {}, def: 'last predicted_funding_rate on binance' },
  // ---- open interest
  'oi.binance.now': { type: 'number', window: 'at frame close', params: {}, def: 'binance open interest, base units, at the frame close' },
  'oi.d24h_pct': { type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'percent change of open interest over the window' },
  'oi.d4h_pct': { type: 'number', window: 'rolling hours', params: { hours: 4 }, def: 'percent change of open interest over the window' },
  'oi.at_7d_high': { type: 'boolean', window: 'rolling days', params: { days: 7 }, def: 'open interest now is at or above its maximum over the window' },
  // ---- long/short
  'ls.top_position': { type: 'number', window: 'latest 5m', params: {}, def: 'latest top-position long/short ratio' },
  'ls.global_account': { type: 'number', window: 'latest 5m', params: {}, def: 'latest global-account long/short ratio' },
  'ls.taker': { type: 'number', window: 'latest 5m', params: {}, def: 'latest taker long/short ratio' },
  'ls.top_position.pct30d': { type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest top-position ratio over the window' },
  'ls.global_account.pct30d': { type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest global-account ratio over the window' },
  'ls.taker.pct30d': { type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest taker ratio over the window' },
  // ---- CVD
  'cvd.spot.4h': { type: 'number', window: 'rolling hours', params: { hours: 4, market: 'spot' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.spot.24h': { type: 'number', window: 'rolling hours', params: { hours: 24, market: 'spot' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.perp.4h': { type: 'number', window: 'rolling hours', params: { hours: 4, market: 'perp' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.perp.24h': { type: 'number', window: 'rolling hours', params: { hours: 24, market: 'perp' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.spot.slope_4h': { type: 'number', window: 'window vs previous window', params: { hours: 4, previousHours: 4, market: 'spot' }, def: 'sign of the change in window CVD against the previous window' },
  'cvd.perp.slope_4h': { type: 'number', window: 'window vs previous window', params: { hours: 4, previousHours: 4, market: 'perp' }, def: 'sign of the change in window CVD against the previous window' },
  // ---- volatility
  'atr.1h.14': { type: 'number', window: 'N bars', params: { period: 14, barTf: '1h', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  'atr.4h.14': { type: 'number', window: 'N bars', params: { period: 14, barTf: '4h', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  'atr.1d.14': { type: 'number', window: 'N bars', params: { period: 14, barTf: '1d', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  // ---- structure
  'structure.swing_high_12h': { type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'highest pivot high over the window' },
  'structure.swing_low_12h': { type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'lowest pivot low over the window' },
  'structure.failed_highs_24h': { type: 'number', window: 'rolling hours', params: { hours: 24, atrMultiple: 0.5, atrTf: '1h', pivotBars: 3 }, def: 'pivots within the ATR multiple below the window high that did not close above it' },
  'structure.impulse_low_15m': { type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'low of the last impulse leg: the last swing low before the current high' },
  // ---- liquidations
  'liq.long.15m': { type: 'number', window: 'rolling minutes', params: { minutes: 15, side: 'long' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.long.60m': { type: 'number', window: 'rolling minutes', params: { minutes: 60, side: 'long' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.short.15m': { type: 'number', window: 'rolling minutes', params: { minutes: 15, side: 'short' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.short.60m': { type: 'number', window: 'rolling minutes', params: { minutes: 60, side: 'short' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.long.z60m': { type: 'number', window: 'window sums over a lookback', params: { windowMinutes: 60, lookbackDays: 30, minHistoryDays: 14, transform: 'log1p', side: 'long' }, def: 'z-score of the window sum against the symbol own trailing window sums, transformed as the transform parameter states' },
  'liq.short.z60m': { type: 'number', window: 'window sums over a lookback', params: { windowMinutes: 60, lookbackDays: 30, minHistoryDays: 14, transform: 'log1p', side: 'short' }, def: 'z-score of the window sum against the symbol own trailing window sums, transformed as the transform parameter states' },
  // ---- price context
  'px.ret_24h': { type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'return over the window' },
  'px.ret_4h': { type: 'number', window: 'rolling hours', params: { hours: 4 }, def: 'return over the window' },
  'px.drawdown_from_24h_high': { type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'drawdown from the window high' },
  // ---- label
  'label.p4': { type: 'enum', window: 'frame', params: { source: 'design 9.2' }, values: ['SPOT_LED', 'PERP_LED', 'ABSORPTION', 'DISTRIBUTION', 'NONE'], def: 'P4 label from the design section named in params' },
} as const;

export type WebFeatureKey = keyof typeof WEB_FEATURE_SPEC;
export const WEB_FEATURE_KEYS = Object.keys(WEB_FEATURE_SPEC) as WebFeatureKey[];

/** The shape of one registry entry. `params` is where MEANING lives, in numbers. */
export interface WebFeatureSpecEntry {
  type: string;
  window: string;
  /**
   * Every constant that decides what the key MEANS: window lengths, lookbacks, periods,
   * thresholds, the smoothing, the transform, the denominator rule. **Calculators read these
   * rather than declaring their own**, so there is one copy and it is inside the fingerprint.
   */
  params: Readonly<Record<string, string | number>>;
  def: string;
  values?: readonly string[];
}

/**
 * A stable fingerprint of the key set AND of what each key means.
 *
 * Asserted against a committed literal, so adding, removing, renaming, re-typing **or
 * re-parameterising** a key fails the build until `WEB_FRAME_VERSION` is bumped.
 *
 * **`params` is in here because names and types are not meaning** (Tech Lead, 2026-10-12). A
 * fingerprint over the key list alone would stay green while a percentile window went 90 → 60,
 * an ATR period 14 → 20, or the `of` denominator changed from the venues that could be assessed
 * to the venues we hope to collect — each of which changes the number a reader acts on while
 * every spec passes. That is IB-043's lesson restated: agreement is not correctness.
 *
 * The one hole this still cannot see is a calculator whose arithmetic changes while its `def`
 * and `params` do not. That is what the golden frame is for.
 */
export function featureSpecFingerprint(
  spec: Readonly<Record<string, WebFeatureSpecEntry>> = WEB_FEATURE_SPEC as never,
): string {
  const canonical = Object.keys(spec).map((key) => {
    const entry = spec[key] as WebFeatureSpecEntry;
    // params sorted by name, so object literal order cannot move the hash
    const params = Object.keys(entry.params)
      .sort()
      .map((name) => `${name}=${String(entry.params[name])}`)
      .join(',');
    return [key, entry.type, entry.window, params, entry.def, (entry.values ?? []).join('|')].join('\u0000');
  }).join('\n');
  // FNV-1a, 32-bit: no crypto dependency in a contracts package, and collisions are not a
  // security property here — the spec compares this to a committed literal.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The meaning-defining constants for one key, for a calculator to read instead of restate. */
export function featureParams(key: WebFeatureKey): Readonly<Record<string, string | number>> {
  return (WEB_FEATURE_SPEC[key] as WebFeatureSpecEntry).params;
}

/** A numeric parameter, or a throw — a missing window is a contract error, not a default. */
export function featureParamNumber(key: WebFeatureKey, name: string): number {
  const value = featureParams(key)[name];
  if (typeof value !== 'number') {
    throw new Error(`feature ${key} has no numeric param "${name}"`);
  }
  return value;
}

/** Whatever a computed key can hold. `{count, of}` is one of them, deliberately. */
export type WebFeatureScalar = number | boolean | string | WebFeatureCount;

/** Accessors. There is deliberately no implicit unwrap anywhere in this contract. */
export function requireFeature(value: WebFeatureValue, key: string): WebFeatureScalar {
  if (!value.ok) throw new Error(`feature ${key} is not computable: ${value.why}`);
  return value.value;
}

/** An explicit fallback, so substituting a value is a visible decision at the call site. */
export function featureOr<T extends WebFeatureScalar>(value: WebFeatureValue, fallback: T): T {
  return value.ok ? (value.value as T) : fallback;
}

/** Every key a playbook requires must be computable, or it does not arm (the rule, as code). */
export function canArm(frame: WebFeatureFrame, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((key) => frame.keys[key]?.ok === true);
}
