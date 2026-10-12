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
  'funding.binance.rate': { type: 'number', window: 'last settlement', def: 'last settled funding rate on binance' },
  'funding.bybit.rate': { type: 'number', window: 'last settlement', def: 'last settled funding rate on bybit' },
  'funding.okx.rate': { type: 'number', window: 'last settlement', def: 'last settled funding rate on okx' },
  'funding.binance.pct30d': { type: 'number', window: 'last 90 settlements, min_periods 45', def: 'percentile of the last settled rate among the venue last 90 settlements' },
  'funding.bybit.pct30d': { type: 'number', window: 'last 90 settlements, min_periods 45', def: 'percentile of the last settled rate among the venue last 90 settlements' },
  'funding.okx.pct30d': { type: 'number', window: 'last 90 settlements, min_periods 45', def: 'percentile of the last settled rate among the venue last 90 settlements' },
  'funding.extreme_hi_venues': { type: 'count', window: 'per venue', def: 'venues with pct30d >= 0.90 and rate >= +0.0003, of the venues that could be assessed' },
  'funding.extreme_lo_venues': { type: 'count', window: 'per venue', def: 'venues with pct30d <= 0.10 and rate <= -0.0003, of the venues that could be assessed' },
  'funding.predicted.binance': { type: 'number', window: 'latest', def: 'last predicted_funding_rate on binance' },
  // ---- open interest
  'oi.binance.now': { type: 'number', window: 'at frame close', def: 'binance open interest, base units, at the frame close' },
  'oi.d24h_pct': { type: 'number', window: '24h', def: 'percent change of open interest over 24 hours' },
  'oi.d4h_pct': { type: 'number', window: '4h', def: 'percent change of open interest over 4 hours' },
  'oi.at_7d_high': { type: 'boolean', window: '7d', def: 'open interest now is at or above its 7-day maximum' },
  // ---- long/short
  'ls.top_position': { type: 'number', window: 'latest 5m', def: 'latest top-position long/short ratio' },
  'ls.global_account': { type: 'number', window: 'latest 5m', def: 'latest global-account long/short ratio' },
  'ls.taker': { type: 'number', window: 'latest 5m', def: 'latest taker long/short ratio' },
  'ls.top_position.pct30d': { type: 'number', window: '30d, min_periods 45', def: 'percentile of the latest top-position ratio over 30 days' },
  'ls.global_account.pct30d': { type: 'number', window: '30d, min_periods 45', def: 'percentile of the latest global-account ratio over 30 days' },
  'ls.taker.pct30d': { type: 'number', window: '30d, min_periods 45', def: 'percentile of the latest taker ratio over 30 days' },
  // ---- CVD
  'cvd.spot.4h': { type: 'number', window: '4h', def: 'sum of (2*takerBuyVolume - volume) over 4 hours of spot 1m bars, base units' },
  'cvd.spot.24h': { type: 'number', window: '24h', def: 'sum of (2*takerBuyVolume - volume) over 24 hours of spot 1m bars, base units' },
  'cvd.perp.4h': { type: 'number', window: '4h', def: 'sum of (2*takerBuyVolume - volume) over 4 hours of perp 1m bars, base units' },
  'cvd.perp.24h': { type: 'number', window: '24h', def: 'sum of (2*takerBuyVolume - volume) over 24 hours of perp 1m bars, base units' },
  'cvd.spot.slope_4h': { type: 'number', window: '4h vs previous 4h', def: 'sign of the change in 4h spot CVD against the previous 4 hours' },
  'cvd.perp.slope_4h': { type: 'number', window: '4h vs previous 4h', def: 'sign of the change in 4h perp CVD against the previous 4 hours' },
  // ---- volatility
  'atr.1h.14': { type: 'number', window: '14 bars of 1h', def: 'WILDER ATR(14) on 1h candles_agg, not the arithmetic mean of true range' },
  'atr.4h.14': { type: 'number', window: '14 bars of 4h', def: 'WILDER ATR(14) on 4h candles_agg, not the arithmetic mean of true range' },
  'atr.1d.14': { type: 'number', window: '14 bars of 1d', def: 'WILDER ATR(14) on 1d candles_agg, not the arithmetic mean of true range' },
  // ---- structure
  'structure.swing_high_12h': { type: 'number', window: '12h of 15m bars', def: 'highest 3-bar pivot high over 12 hours of 15m bars' },
  'structure.swing_low_12h': { type: 'number', window: '12h of 15m bars', def: 'lowest 3-bar pivot low over 12 hours of 15m bars' },
  'structure.failed_highs_24h': { type: 'number', window: '24h', def: 'pivots within 0.5*ATR(1h) below the 24h high that did not close above it' },
  'structure.impulse_low_15m': { type: 'number', window: '12h of 15m bars', def: 'low of the last 15m impulse leg: the last swing low before the current high' },
  // ---- liquidations
  'liq.long.15m': { type: 'number', window: '15m', def: 'sum of notional of longs liquidated over 15 minutes' },
  'liq.long.60m': { type: 'number', window: '60m', def: 'sum of notional of longs liquidated over 60 minutes' },
  'liq.short.15m': { type: 'number', window: '15m', def: 'sum of notional of shorts liquidated over 15 minutes' },
  'liq.short.60m': { type: 'number', window: '60m', def: 'sum of notional of shorts liquidated over 60 minutes' },
  'liq.long.z60m': { type: 'number', window: '30d of 60m sums, min 14d', def: 'log1p z-score of the 60m long sum against the symbol own trailing 30 days of 60m sums' },
  'liq.short.z60m': { type: 'number', window: '30d of 60m sums, min 14d', def: 'log1p z-score of the 60m short sum against the symbol own trailing 30 days of 60m sums' },
  // ---- price context
  'px.ret_24h': { type: 'number', window: '24h', def: 'return over 24 hours' },
  'px.ret_4h': { type: 'number', window: '4h', def: 'return over 4 hours' },
  'px.drawdown_from_24h_high': { type: 'number', window: '24h', def: 'drawdown from the 24-hour high' },
  // ---- label
  'label.p4': { type: 'enum', window: 'frame', def: 'P4 label from design section 9.2', values: ['SPOT_LED', 'PERP_LED', 'ABSORPTION', 'DISTRIBUTION', 'NONE'] },
} as const;

export type WebFeatureKey = keyof typeof WEB_FEATURE_SPEC;
export const WEB_FEATURE_KEYS = Object.keys(WEB_FEATURE_SPEC) as WebFeatureKey[];

/**
 * A stable fingerprint of the key set AND of what each key means.
 *
 * The spec asserts this against a committed literal, so adding, removing, renaming, re-windowing
 * or re-defining a key fails the build until `WEB_FRAME_VERSION` is bumped. It is deliberately
 * computed from the `def` text too: a changed calculator with an unchanged `def` is the one
 * mistake this cannot catch, which is why the `def` is where the meaning is written down.
 */
export function featureSpecFingerprint(): string {
  const canonical = WEB_FEATURE_KEYS.map((key) => {
    const entry = WEB_FEATURE_SPEC[key] as { type: string; window: string; def: string; values?: readonly string[] };
    return [key, entry.type, entry.window, entry.def, (entry.values ?? []).join('|')].join('\u0000');
  }).join('\n');
  // FNV-1a, 32-bit: no crypto dependency in a contracts package, and collisions are not a
  // security property here — the spec compares the whole string's hash to a committed literal.
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
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
