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
  /**
   * A venue convention the key's definition depends on no longer holds, so the number would be
   * measuring something other than what its name says.
   *
   * The case this exists for: `funding.*.pct30d` is thirty days **because** a settlement is eight
   * hours on these venues. That is a venue convention, not an invariant — at 4-hourly, ninety
   * settlements is fifteen days, the name becomes a lie and the number stays plausible. AGENTS.md
   * requires a behavioural invariant carried by a venue's shape to be asserted at runtime rather
   * than trusted, so the interval is measured and the key refuses when it has moved.
   */
  'convention_changed',
  /**
   * The input is short and **the absence is evidenced**, so it will never heal.
   *
   * Two sub-cases, deliberately under one reason because both are permanent and neither is a
   * fresh defect: a `collector_gaps` row already records that we were not collecting (the data
   * is gone and is counted once, there), or the venue never produced the minute at all — a halt,
   * a maintenance window, or a timestamp before the symbol's listing date.
   *
   * It exists because `hours * 60` cannot tell "nobody has collected it yet" from "it never
   * existed", and conflating them leaves a key refusing for ever behind an unhealed-gap counter
   * that never drains. That is the stale-apology shape: an alarm that cannot be cleared stops
   * being read. **Permanent and expected — explicitly NOT counted as an unhealed gap.**
   */
  'explained_absence',
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

/**
 * Reasons that will never resolve, however long the heal pass runs.
 *
 * The split matters because the alarm must only ring for something somebody can fix: a frame
 * still carrying `incomplete_input` after the heal window has closed is an **unhealed gap** and
 * is counted; one carrying any of these is working as intended and is not.
 */
export const WEB_FEATURE_PERMANENT_REASONS: readonly WebFeatureUnavailable[] = [
  'insufficient_history',
  'not_applicable',
  'convention_changed',
  'explained_absence',
];

export function isPermanentRefusal(value: WebFeatureValue): boolean {
  return !value.ok && WEB_FEATURE_PERMANENT_REASONS.includes(value.why);
}

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
  /**
   * 1 for the frame as first written, incremented by each AMENDMENT.
   *
   * Frames are **append-only**: `(symbol, tf, close_time, revision)` is the key, and an earlier
   * revision is never rewritten. §8.1's idempotency is preserved in substance — a re-check that
   * produces identical values writes NOTHING — while the question "what did this frame actually
   * say when something armed on it?" stays answerable for ever. A signal references the
   * revision, not just the bar.
   */
  revision: z.number().int().positive(),
  /** When this revision was written, if it amended an earlier one. Null on revision 1. */
  amendedAt: TimeSec.nullable(),
  /**
   * Which keys moved from a refusal to a value in THIS revision. An amendment states itself
   * rather than being inferred by diffing two rows.
   */
  amendedKeys: z.array(z.string()),
  /**
   * Whether THIS revision was computed by the live pass at the close, or by a backfill run over
   * history (`npm run features -- --from --to`).
   *
   * **Not bookkeeping — it is the only thing that makes lookahead detectable.** The two are not
   * "the same rules at different times". Derive's heal pass fills short buckets after the fact,
   * so a live frame refuses `incomplete_input` on a bucket that a backfill run, executed later,
   * sees healed and computes a value from. The backfilled frame is therefore systematically
   * better informed than the frame that actually existed at that close, and better informed in
   * a direction that correlates with the data. Anything learning from frames, or backtesting
   * over them, would train on information that did not exist at the moment it claims to model —
   * and without this field nothing downstream could tell.
   *
   * **Per revision, not per frame**, because a backfill pass amending a live frame is precisely
   * that case: revision 1 may be `live` and revision 2 `backfill`. `latestRevisions()` can
   * therefore hand back a backfilled answer for a bar that was armed on a live one; a consumer
   * reconstructing what was knowable at the close must filter on this field first.
   */
  computedMode: z.enum(['live', 'backfill']),
  /**
   * When this revision was computed — the wall clock, as opposed to `closeTime`, which is the
   * bar it describes. A backfilled frame's `computedAt` is far later than its `closeTime`, and
   * the distance between the two is how much healing it could have benefited from.
   */
  computedAt: TimeSec,
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
 * **The version freezes at the first persisted frame, and that is ENFORCED rather than stated.**
 *
 * Migration 011's `feature_frame_versions` records the fingerprint the first frame under each
 * version was written with, and `assertFrameVersionFingerprint` in the insight-bot checks the
 * live fingerprint against it on every write, throwing and naming the fix on a mismatch.
 *
 * This replaced a `WEB_FRAME_VERSION_FROZEN_FROM_FIRST_WRITE = true` constant (Tech Lead,
 * 2026-10-12): a boolean documents a boundary and enforces nothing, and the person changing the
 * spec six months after the first frame lands will not read it. A spec protects the repository;
 * only the stored row protects the database, because a test and the thing it tests get edited in
 * the same commit.
 */


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
  'funding.binance.rate': { inputs: ['funding'], type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on binance' },
  'funding.bybit.rate': { inputs: ['funding'], type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on bybit' },
  'funding.okx.rate': { inputs: ['funding'], type: 'number', window: 'last settlement', params: {}, def: 'last settled funding rate on okx' },
  // The name says 30d; the window is 90 SETTLEMENTS (§8.2). Those are the same thing only while a
  // settlement is 8 hours, which is a venue convention and not an invariant — so the interval is
  // measured and the key refuses with convention_changed when it has moved. See `settlementHours`.
  'funding.binance.pct30d': { inputs: ['funding'], type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45, settlementHours: 8, intervalTolerance: 0.25 }, def: 'percentile of the last settled rate among the venue last N settlements; the 30d in the key name is an equivalence that holds only at the stated settlement interval, which is asserted' },
  'funding.bybit.pct30d': { inputs: ['funding'], type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45, settlementHours: 8, intervalTolerance: 0.25 }, def: 'percentile of the last settled rate among the venue last N settlements; the 30d in the key name is an equivalence that holds only at the stated settlement interval, which is asserted' },
  'funding.okx.pct30d': { inputs: ['funding'], type: 'number', window: 'last N settlements', params: { settlements: 90, minPeriods: 45, settlementHours: 8, intervalTolerance: 0.25 }, def: 'percentile of the last settled rate among the venue last N settlements; the 30d in the key name is an equivalence that holds only at the stated settlement interval, which is asserted' },
  'funding.extreme_hi_venues': { inputs: ['funding'], type: 'count', window: 'per venue', params: { percentile: 0.9, rate: 0.0003, denominator: 'venues_assessable' }, def: 'venues at or above the percentile AND at or above the rate, of the venues that could be assessed' },
  'funding.extreme_lo_venues': { inputs: ['funding'], type: 'count', window: 'per venue', params: { percentile: 0.1, rate: -0.0003, denominator: 'venues_assessable' }, def: 'venues at or below the percentile AND at or below the rate, of the venues that could be assessed' },
  'funding.predicted.binance': { inputs: ['funding'], type: 'number', window: 'latest', params: {}, def: 'last predicted_funding_rate on binance' },
  // ---- open interest
  'oi.binance.now': { inputs: ['oi'], type: 'number', window: 'at frame close', params: {}, def: 'binance open interest, base units, at the frame close' },
  'oi.d24h_pct': { inputs: ['oi'], type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'percent change of open interest over the window' },
  'oi.d4h_pct': { inputs: ['oi'], type: 'number', window: 'rolling hours', params: { hours: 4 }, def: 'percent change of open interest over the window' },
  'oi.at_7d_high': { inputs: ['oi'], type: 'boolean', window: 'rolling days', params: { days: 7 }, def: 'open interest now is at or above its maximum over the window' },
  // ---- long/short
  'ls.top_position': { inputs: ['ls'], type: 'number', window: 'latest 5m', params: {}, def: 'latest top-position long/short ratio' },
  'ls.global_account': { inputs: ['ls'], type: 'number', window: 'latest 5m', params: {}, def: 'latest global-account long/short ratio' },
  'ls.taker': { inputs: ['ls'], type: 'number', window: 'latest 5m', params: {}, def: 'latest taker long/short ratio' },
  'ls.top_position.pct30d': { inputs: ['ls'], type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest top-position ratio over the window' },
  'ls.global_account.pct30d': { inputs: ['ls'], type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest global-account ratio over the window' },
  'ls.taker.pct30d': { inputs: ['ls'], type: 'number', window: 'rolling days', params: { days: 30, minPeriods: 45 }, def: 'percentile of the latest taker ratio over the window' },
  // ---- CVD
  'cvd.spot.4h': { inputs: ['candles1m:spot'], type: 'number', window: 'rolling hours', params: { hours: 4, market: 'spot' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.spot.24h': { inputs: ['candles1m:spot'], type: 'number', window: 'rolling hours', params: { hours: 24, market: 'spot' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.perp.4h': { inputs: ['candles1m:perp'], type: 'number', window: 'rolling hours', params: { hours: 4, market: 'perp' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.perp.24h': { inputs: ['candles1m:perp'], type: 'number', window: 'rolling hours', params: { hours: 24, market: 'perp' }, def: 'sum of (2*takerBuyVolume - volume) over the window of 1m bars, base units' },
  'cvd.spot.slope_4h': { inputs: ['candles1m:spot'], type: 'number', window: 'window vs previous window', params: { hours: 4, previousHours: 4, market: 'spot' }, def: 'sign of the change in window CVD against the previous window' },
  'cvd.perp.slope_4h': { inputs: ['candles1m:perp'], type: 'number', window: 'window vs previous window', params: { hours: 4, previousHours: 4, market: 'perp' }, def: 'sign of the change in window CVD against the previous window' },
  // ---- volatility
  'atr.1h.14': { inputs: ['agg:1h'], type: 'number', window: 'N bars', params: { period: 14, barTf: '1h', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  'atr.4h.14': { inputs: ['agg:4h'], type: 'number', window: 'N bars', params: { period: 14, barTf: '4h', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  'atr.1d.14': { inputs: ['agg:1d'], type: 'number', window: 'N bars', params: { period: 14, barTf: '1d', smoothing: 'wilder' }, def: 'average true range on candles_agg, smoothed as the smoothing parameter states' },
  // ---- structure
  'structure.swing_high_12h': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'highest pivot high over the window' },
  'structure.swing_low_12h': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'lowest pivot low over the window' },
  'structure.failed_highs_24h': { inputs: ['agg:15m', 'agg:1h'], type: 'number', window: 'rolling hours', params: { hours: 24, atrMultiple: 0.5, atrTf: '1h', pivotBars: 3 }, def: 'pivots within the ATR multiple below the window high that did not close above it' },
  'structure.impulse_low_15m': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours of bars', params: { hours: 12, barTf: '15m', pivotBars: 3 }, def: 'low of the last impulse leg: the last swing low before the current high' },
  // ---- liquidations
  'liq.long.15m': { inputs: ['liq'], type: 'number', window: 'rolling minutes', params: { minutes: 15, side: 'long' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.long.60m': { inputs: ['liq'], type: 'number', window: 'rolling minutes', params: { minutes: 60, side: 'long' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.short.15m': { inputs: ['liq'], type: 'number', window: 'rolling minutes', params: { minutes: 15, side: 'short' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.short.60m': { inputs: ['liq'], type: 'number', window: 'rolling minutes', params: { minutes: 60, side: 'short' }, def: 'sum of notional liquidated on the side over the window' },
  'liq.long.z60m': { inputs: ['liq'], type: 'number', window: 'window sums over a lookback', params: { windowMinutes: 60, lookbackDays: 30, minHistoryDays: 14, transform: 'log1p', side: 'long', spreadEpsilonRelative: 1e-9 }, def: 'z-score of the window sum against the symbol own trailing window sums, transformed as the transform parameter states; refused when the sample standard deviation is below spreadEpsilonRelative times the mean, which is floating-point residue rather than spread' },
  'liq.short.z60m': { inputs: ['liq'], type: 'number', window: 'window sums over a lookback', params: { windowMinutes: 60, lookbackDays: 30, minHistoryDays: 14, transform: 'log1p', side: 'short', spreadEpsilonRelative: 1e-9 }, def: 'z-score of the window sum against the symbol own trailing window sums, transformed as the transform parameter states; refused when the sample standard deviation is below spreadEpsilonRelative times the mean, which is floating-point residue rather than spread' },
  // ---- price context
  'px.ret_24h': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'return over the window' },
  'px.ret_4h': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours', params: { hours: 4 }, def: 'return over the window' },
  'px.drawdown_from_24h_high': { inputs: ['agg:15m'], type: 'number', window: 'rolling hours', params: { hours: 24 }, def: 'drawdown from the window high' },
  // The close as a KEY, not as a value carried beside the frame (IB-016, dev-1's option 1,
  // ruled by the Tech Lead 2026-10-12). Every other price key is derived FROM a close that was
  // never itself a key, which left the one input a trend decision rests on outside the
  // completeness rule. As a key it inherits the refusal rules for free, and a stored frame can
  // answer "what was the price when this armed" without joining back to the candles.
  //
  // Sourced from agg:15m on BOTH timeframes, which dev-1 measured rather than assumed: a 4h bar
  // closes at the same instant as the 15m bar opening +3h45m into it, and on this tape all 1235
  // complete pairs were identical to the cent (joined on venue, market AND symbol — the first
  // run omitted venue and market and compared a perp 4h close against a spot 15m close).
  //
  // The caveat, recorded because a future key could trip on it: this makes px.close's refusal
  // track the 15m bucket's completeness, not the 4h one's. A 4h frame whose EARLIER 15m buckets
  // were short still has a true px.close — that is genuinely the bar's close — but px.close is
  // then not evidence that the 4h bar is whole. `trend` is safe because it also reads
  // ema.4h.50, which refuses on short agg:4h buckets; a key reading px.close ALONE on a 4h
  // frame would not have that protection.
  'px.close': { inputs: ['agg:15m'], type: 'number', window: 'frame bar', params: { source: 'close', barTf: '15m' }, def: 'close of the bar the frame is stamped by: for a 15m frame its own 15m bar, for a 4h frame the 15m bar whose close coincides with the 4h close (the one opening 3h45m into it)' },
  // IB-018: the frame bar's high and low, for P3's stop, both trigger forms and T1.
  //
  // **The `def` deliberately does NOT reuse px.close's wording, and the difference is not
  // pedantry.** px.close can honestly say "the 15m bar whose close coincides with the 4h close"
  // because a 4h close IS its last 15m close — one bar, same number. A 4h HIGH is the maximum
  // over the sixteen 15m bars of that window, which is a different derivation from the same
  // input group. Borrow the close's phrasing and the next reader simplifies it to the final
  // bar's high.
  //
  // **What that costs, measured rather than asserted.** On a real 4h frame (BTCUSDT,
  // 2026-10-12T00:00Z) the correct max over sixteen bars was 83997 and the final 15m bar's high
  // was 83634.9 — **$362 out on one bar**. Against ATR(1h) on BTCUSDT over the preceding seven
  // days, measured independently on two slots: mean **$327–359**, median **$269–290**.
  //
  // The range is two slots, not noise in the estimator: `insight_dev1` gave $327 and
  // `insight_dev2` $359 over nominally the same window, because they hold different sets of
  // COMPLETE bars. The ATR of Bitcoin does not depend on which database you ask — every figure
  // we can produce does, so neither number is "the" ATR and the pair is quoted deliberately.
  //
  // The query, so a reader can re-measure rather than trust the pair:
  //
  //   with b as (
  //     select high, low, lag(close) over (order by open_time) as prev_close
  //       from candles_agg
  //      where tf='1h' and symbol='BTCUSDT' and venue='binance' and market='perp' and complete
  //        and open_time >= now() - interval '7 days'
  //   )
  //   select count(*), avg(tr), percentile_cont(0.5) within group (order by tr)
  //     from (select greatest(high-low, abs(high-prev_close), abs(low-prev_close)) as tr
  //             from b where prev_close is not null) t;
  //
  // `and complete` is the clause that makes the two slots differ, and leaving it out would give
  // a third number that is not the ATR either.
  //
  // So the error is roughly ONE ATR(1h) — and P3's stop is `cascade low − 0.1·ATR`, a buffer of
  // about $27–36. The simplification would therefore move the stop by **an order of magnitude
  // more than the buffer the design puts there on purpose**, and a `px.low` that is too high
  // puts the stop INSIDE the cascade it was meant to sit under. Every test would stay green,
  // because the levels are computed from whatever the key returns.
  //
  // The numbers live in this comment rather than in the `def` on purpose: `def` is inside the
  // spec fingerprint, so prose added to it would move the hash and make a documentation edit
  // look like a change of meaning — blunting the one signal that exists to flag real ones.
  'px.high': { inputs: ['agg:15m'], type: 'number', window: 'frame bar', params: { source: 'high', barTf: '15m', aggregation: 'max' }, def: 'high of the bar the frame is stamped by: for a 15m frame its own bar high, and for a 4h frame the MAXIMUM high across the sixteen 15m bars of that 4h window — not the final 15m bar high, which coincides with the 4h value only for the close' },
  'px.low': { inputs: ['agg:15m'], type: 'number', window: 'frame bar', params: { source: 'low', barTf: '15m', aggregation: 'min' }, def: 'low of the bar the frame is stamped by: for a 15m frame its own bar low, and for a 4h frame the MINIMUM low across the sixteen 15m bars of that 4h window — not the final 15m bar low, which coincides with the 4h value only for the close' },
  // ---- trend (IB-016). `seed` is in params because it is MEANING: an EMA seeded with the first
  // close and one seeded with the SMA of the first `length` closes disagree for roughly `length`
  // bars and then converge, so two readers of "EMA200" get different numbers for 200 days and
  // identical ones afterwards — the hardest kind of disagreement to notice.
  'ema.4h.50': { inputs: ['agg:4h'], type: 'number', window: 'N bars', params: { length: 50, barTf: '4h', source: 'close', seed: 'sma' }, def: 'exponential moving average of the close over the last N bars of candles_agg, alpha = 2/(length+1), seeded with the SMA of the first N closes' },
  'ema.1d.200': { inputs: ['agg:1d'], type: 'number', window: 'N bars', params: { length: 200, barTf: '1d', source: 'close', seed: 'sma' }, def: 'exponential moving average of the close over the last N bars of candles_agg, alpha = 2/(length+1), seeded with the SMA of the first N closes' },
  // ---- label
  'label.p4': { inputs: ['agg:15m', 'candles1m:perp', 'candles1m:spot'], type: 'enum', window: 'frame', params: { source: 'design 9.2' }, values: ['SPOT_LED', 'PERP_LED', 'ABSORPTION', 'DISTRIBUTION', 'NONE'], def: 'P4 label from the design section named in params' },
} as const;

export type WebFeatureKey = keyof typeof WEB_FEATURE_SPEC;
export const WEB_FEATURE_KEYS = Object.keys(WEB_FEATURE_SPEC) as WebFeatureKey[];

/** The shape of one registry entry. `params` is where MEANING lives, in numbers. */
export interface WebFeatureSpecEntry {
  /**
   * The input groups this key is computed from. **This is what the refusal path reads**: when a
   * `candles_agg` bucket inside a window is not `complete = true`, every key naming that group
   * refuses with `incomplete_input` and the rest of the frame is still written.
   *
   * It is in the fingerprint because it is meaning: a key that quietly starts reading 1h bars
   * instead of 15m ones is a different key, and it would also start surviving a different set of
   * incomplete buckets.
   */
  inputs: readonly string[];
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
    return [
      key, entry.inputs.join('+'), entry.type, entry.window, params, entry.def,
      (entry.values ?? []).join('|'),
    ].join('\u0000');
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

/**
 * The latest revision of each `close_time` — the default read.
 *
 * Reads take the latest revision; a consumer may ask for a specific one, and an audit read that
 * wants the history asks for it by name. The easy path is the correct one, because a reader that
 * forgets gets several rows for one bar.
 */
export function latestRevisions(frames: readonly WebFeatureFrame[]): WebFeatureFrame[] {
  const best = new Map<string, WebFeatureFrame>();
  for (const frame of frames) {
    const key = `${frame.symbol}\u0000${frame.tf}\u0000${frame.closeTime}`;
    const held = best.get(key);
    if (!held || frame.revision > held.revision) best.set(key, frame);
  }
  return [...best.values()].sort((a, b) => a.closeTime - b.closeTime || a.symbol.localeCompare(b.symbol));
}

/**
 * Frames computed live, discarding backfilled revisions.
 *
 * What a consumer reconstructing "what was knowable at this close" must use. Note it filters
 * BEFORE picking the latest revision — a bar whose revision 2 was written by a backfill falls
 * back to its live revision 1, rather than disappearing or silently returning the better-informed
 * answer.
 */
export function liveRevisions(frames: readonly WebFeatureFrame[]): WebFeatureFrame[] {
  return latestRevisions(frames.filter((f) => f.computedMode === 'live'));
}

/**
 * Refuses a set that mixes live and backfilled frames.
 *
 * IB-017's arming and IB-023's outcome tracking must not compute over a mixture: some bars would
 * carry answers informed by healing that had not happened yet at their own close, and the
 * resulting statistic would be better than anything achievable in real time, by an amount nobody
 * can measure. Throwing is deliberate — a boolean would be a flag a caller can forget to read,
 * and the whole frame design is built on typed refusals rather than flags.
 */
export function assertSingleComputedMode(frames: readonly WebFeatureFrame[]): void {
  const modes = new Set(frames.map((f) => f.computedMode));
  if (modes.size > 1) {
    throw new Error(
      'mixed computed modes in one frame set: live and backfill. A backfilled frame is ' +
      'systematically better informed than the live frame for the same close, because derive ' +
      'healed its buckets in between — comparing or learning across the two is lookahead. ' +
      'Take liveRevisions() first, or work with backfilled frames deliberately and alone.',
    );
  }
}

/**
 * A comparison across frames must not mix revisions of one bar, exactly as it must not mix
 * versions — the two are the same mistake at different scales. Throws rather than returning a
 * flag, because a caller that wanted to know would have called `latestRevisions` first.
 */
export function assertSingleRevisionPerClose(frames: readonly WebFeatureFrame[]): void {
  const seen = new Map<string, number>();
  for (const frame of frames) {
    const key = `${frame.symbol} ${frame.tf} ${frame.closeTime}`;
    const held = seen.get(key);
    if (held !== undefined && held !== frame.revision) {
      throw new Error(
        `mixed frame revisions for ${key}: ${held} and ${frame.revision}. ` +
        'Take latestRevisions() first, or compare one revision deliberately — a comparison across ' +
        'revisions compares two different answers to the same bar.',
      );
    }
    seen.set(key, frame.revision);
  }
  const versions = new Set(frames.map((f) => f.frameVersion));
  if (versions.size > 1) {
    throw new Error(
      `mixed frame_versions in one comparison: ${[...versions].join(', ')}. ` +
      'Frames written under different versions mean different things and must not be compared.',
    );
  }
}

/** Every key a playbook requires must be computable, or it does not arm (the rule, as code). */
export function canArm(frame: WebFeatureFrame, requiredKeys: readonly string[]): boolean {
  return requiredKeys.every((key) => frame.keys[key]?.ok === true);
}
