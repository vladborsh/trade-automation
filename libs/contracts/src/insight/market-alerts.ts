import { z } from 'zod';
import { AlertSymbolSchema } from './oi-divergence-admin';

/**
 * IB-122 — the generic alert journal for the large-liquidation, funding and price-level alerts
 * (architecture/alerts-liq-funding-levels-design-2026-11-05.md §1, C1–C5; liquidations §2, L1–L8).
 *
 * One journal (`market_alerts`), one controls table (`market_alert_controls`) and one settings row per
 * type (`alert_type_settings`), shared by the three types; each type brings its own params and details
 * schemas below. Migration 031 creates the tables. The OI divergence tables stay as they are.
 */

/** C1: the three types, in the order they are built (§7). */
export const MARKET_ALERT_TYPES = ['liq', 'funding', 'level'] as const;
export const MarketAlertTypeSchema = z.enum(MARKET_ALERT_TYPES);
export type MarketAlertType = z.infer<typeof MarketAlertTypeSchema>;

/** V30 for the generic tables: the live loop, or a history run (IB-123). No default anywhere. */
export const MARKET_ALERT_SOURCES = ['live', 'backfill'] as const;
export type MarketAlertSource = (typeof MARKET_ALERT_SOURCES)[number];

/**
 * IB-151 (owner ruling 2026-11-06 B: «пускай все пишется … в админке … не будет уведомлять») — every admin switch
 * below the type's own `enabled` only MUTES: the row is journalled whatever it says, with `market_alerts.muted_by`
 * naming the switch that kept it from being sent (migration 037). Null = no switch muted it (it may still be unsent:
 * the type is off, it was late, or it is a history row).
 * - `coin`: the coin's `perCoin[symbol].enabled` is false (liq, funding, level — a custom level too);
 * - `daily`: a PDH/PDL level on a coin whose `perCoin[symbol].daily` is off (level);
 * - `event`: `events[kind][event]` is false (level);
 * - `custom_event`: the custom level's own switch for that event is off (level, IB-128).
 * When several apply, the first in this order is named.
 */
export const MARKET_ALERT_MUTED_BY = ['coin', 'daily', 'event', 'custom_event'] as const;
export const MarketAlertMutedBySchema = z.enum(MARKET_ALERT_MUTED_BY);
export type MarketAlertMutedBy = z.infer<typeof MarketAlertMutedBySchema>;

/**
 * IB-151: a muted row's once-key — the type's own key plus `:muted`, so it never takes the key a sent row would use.
 * Turning a switch back on mid-period then sends what would have been sent had the muted row never been written.
 */
export function mutedDedupeKey(dedupeKey: string): string {
  return `${dedupeKey}:muted`;
}

/** Controls (L8, F8, P7): what a control row is. Liquidations use `random` and `near_miss`. */
export const MARKET_ALERT_CONTROL_KINDS = ['random', 'near_miss', 'touch'] as const;
export type MarketAlertControlKind = (typeof MARKET_ALERT_CONTROL_KINDS)[number];

// ------------------------------------------------------------------------------------------------
// Liquidations (§2)
// ------------------------------------------------------------------------------------------------

/** The side that was LIQUIDATED, as `liquidations.side` stores it (D6). */
export const LIQ_SIDES = ['long', 'short'] as const;
export const LiqSideSchema = z.enum(LIQ_SIDES);
export type LiqSide = z.infer<typeof LiqSideSchema>;

/** The venues summed (L3), in the order the message names them. */
export const LIQ_VENUES = ['binance', 'bybit', 'okx'] as const;
export const LiqVenueSchema = z.enum(LIQ_VENUES);
export type LiqVenue = z.infer<typeof LiqVenueSchema>;

/** L1: the window is 5 minutes, sliding. L14 (IB-143): the loop evaluates every 10 s (was 30 s). */
export const LIQ_WINDOW_SEC = 300;
export const LIQ_TICK_SEC = 10;
/**
 * L2: quiet for 30 min from `at` per (coin, side). The per-coin 2× continuation (`LIQ_CONTINUATION_MULT`) was
 * replaced by the event's continuation (L13, IB-143); the constant stays for the old `continuing` rows' meaning.
 */
export const LIQ_QUIET_SEC = 1_800;
export const LIQ_CONTINUATION_MULT = 2;
/** L11 (IB-143): an event's first message goes after this long without a member print ("settled")… */
export const LIQ_SETTLE_SEC = 60;
/** …but at the latest this long after the event's first crossing T0 ("cap"). */
export const LIQ_SEND_CAP_SEC = 180;
/** L11: an event closes at the latest this long after T0 (= the quiet of its first coin). */
export const LIQ_EVENT_MAX_SEC = LIQ_QUIET_SEC;
/**
 * L16 (IB-148): an event is "small" when it has one member whose sum at S is below this × its own threshold. Only a
 * small event is ever held back or merged.
 */
export const LIQ_SMALL_MULT = 3;
/** L16: another event takes a small one in when its `totalUsd` is at least this × the small one's sum. */
export const LIQ_MERGE_RATIO = 10;
/**
 * L16–L18: the merge window, inclusive, both ways: a small event whose T0 is ≤ this after a large close is
 * absorbed (L17); a small event is held this long after its S for a large one to open (L18).
 */
export const LIQ_MERGE_SEC = 120;
/** L6: an `at` older than this when it is found is journalled `late` and never sent. */
export const LIQ_LATE_SEC = 300;
/** L8: a near-miss is the hour's largest window sum at ≥ this × the threshold that fired nothing. */
export const LIQ_NEAR_MISS_RATIO = 0.5;
/** L8: random 5-minute windows per coin and UTC day. */
export const LIQ_RANDOM_PER_DAY = 2;
/** C1 / §1 «Link»: the instrument page opens on 5m for a liquidation alert. */
export const LIQ_ALERT_TF = '5m';
/** L5: a venue that has collected a coin for less than this is named as not collected. */
export const LIQ_COVERAGE_WARMUP_SEC = 300;

/** L4: one coin's switch and threshold, in USD over 5 minutes, all venues summed. */
export const LiqCoinParamsSchema = z.object({
  enabled: z.boolean(),
  thresholdUsd: z.number().finite().positive().max(1e12),
}).strict();
export type LiqCoinParams = z.infer<typeof LiqCoinParamsSchema>;

/**
 * `alert_type_settings.params` for `liq`. Keyed by the `alert_symbols` symbol. **A coin missing here is
 * OFF** (L4): no default fits an arbitrary coin, and a wrong default is spam or silence.
 */
export const LiqParamsSchema = z.object({
  perCoin: z.record(AlertSymbolSchema, LiqCoinParamsSchema),
}).strict();
export type LiqParams = z.infer<typeof LiqParamsSchema>;

/** L4: the owner's defaults, seeded by migration 031 (a spec holds the two equal). */
export const LIQ_DEFAULT_PARAMS: LiqParams = {
  perCoin: {
    BTCUSDT: { enabled: true, thresholdUsd: 5_000_000 },
    ETHUSDT: { enabled: true, thresholdUsd: 3_000_000 },
    SOLUSDT: { enabled: true, thresholdUsd: 1_000_000 },
    BNBUSDT: { enabled: true, thresholdUsd: 300_000 },
    TRXUSDT: { enabled: true, thresholdUsd: 300_000 },
  },
};

/** USD per venue; a venue that wrote nothing in the window reads 0 here and is judged by `silentVenues`. */
export const LiqByVenueSchema = z.object({ binance: z.number(), bybit: z.number(), okx: z.number() }).strict();
export type LiqByVenue = z.infer<typeof LiqByVenueSchema>;

/**
 * L3: why a venue is named as having no data in the window (never shown as $0):
 * - `stream_silent`: its collector's heartbeat is stale, or a collector gap overlaps the window;
 * - `not_collected`: the coin is not on that venue's list, or joined it less than 5 min before (L5);
 * - `not_listed`: the venue has no contract the mapper can name for this coin.
 */
export const LIQ_SILENT_REASONS = ['stream_silent', 'not_collected', 'not_listed'] as const;
export type LiqSilentReason = (typeof LIQ_SILENT_REASONS)[number];
export const LiqSilentVenueSchema = z.object({ venue: LiqVenueSchema, reason: z.enum(LIQ_SILENT_REASONS) }).strict();
export type LiqSilentVenue = z.infer<typeof LiqSilentVenueSchema>;

/** `market_alerts.details` for `type = 'liq'`, `event = 'alert'`. Window times are epoch MS, as the tape's. */
export const LiqAlertDetailsSchema = z.object({
  side: LiqSideSchema,
  /** `at − 5 min`, epoch ms: the window is (windowStartMs, at]. */
  windowStartMs: z.number().int(),
  sumUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
  byVenue: LiqByVenueSchema,
  count: z.number().int().nonnegative(),
  largest: z.object({ usd: z.number().nonnegative(), venue: LiqVenueSchema }).strict(),
  silentVenues: z.array(LiqSilentVenueSchema),
  /** The Binance one-per-second footnote went with this message (the first of its UTC day). */
  binanceFootnote: z.boolean(),
  /**
   * L10 (IB-143): the T0 of the market event this crossing belongs to, epoch ms. Absent on rows journalled
   * before IB-143 (the loop then assigns them in time order).
   */
  eventAt: z.number().int().optional(),
}).strict();
export type LiqAlertDetails = z.infer<typeof LiqAlertDetailsSchema>;

/** `event = 'continuing'`: the running sum since the alert's window start reached 2× (L2). */
export const LiqContinuationDetailsSchema = z.object({
  side: LiqSideSchema,
  alertId: z.number().int().positive(),
  /** The alert's window start, epoch ms: the running sum is over (windowStartMs, at]. */
  windowStartMs: z.number().int(),
  sumUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
}).strict();
export type LiqContinuationDetails = z.infer<typeof LiqContinuationDetailsSchema>;

/** L11: how the first message's moment S came: 60 s without a member print, or T0 + 3 min. */
export const LIQ_EVENT_SETTLED = ['quiet', 'cap'] as const;
/** L11: how an event that hit the cap closed: 60 s without a member print, or T0 + 30 min. */
export const LIQ_EVENT_CLOSED_BY = ['quiet', 'max'] as const;

/** L12: one member coin of a market event; its sum runs from its own window start to the message's moment. */
export const LiqEventCoinSchema = z.object({
  symbol: z.string(),
  /** The coin's crossing (its `alert` row's `at`), epoch ms. */
  crossedAt: z.number().int(),
  /** `crossedAt − 5 min`, epoch ms: the coin's sum is over (windowStartMs, the message's moment]. */
  windowStartMs: z.number().int(),
  sumUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
  byVenue: LiqByVenueSchema,
  count: z.number().int().nonnegative(),
  largest: z.object({ usd: z.number().nonnegative(), venue: LiqVenueSchema }).strict(),
  silentVenues: z.array(LiqSilentVenueSchema),
}).strict();
export type LiqEventCoin = z.infer<typeof LiqEventCoinSchema>;

const liqEventShape = {
  side: LiqSideSchema,
  /** T0: the event's first crossing, epoch ms. */
  eventAt: z.number().int(),
  /** S: the first message's moment, epoch ms. */
  sentAt: z.number().int(),
  /** Largest sum first. */
  coins: z.array(LiqEventCoinSchema).min(1),
  totalUsd: z.number().nonnegative(),
  count: z.number().int().nonnegative(),
  largest: z.object({ usd: z.number().nonnegative(), venue: LiqVenueSchema, symbol: z.string() }).strict(),
  binanceFootnote: z.boolean(),
};

/** L17 / L18 (IB-148): how a small event was merged: after a large event's close, or folded into the next one. */
export const LIQ_MERGE_HOW = ['after', 'before'] as const;

/** `event = 'event'` (L12): the first message of a market event, at S. The row's `at` is S. */
export const LiqEventDetailsSchema = z.object({
  ...liqEventShape,
  settled: z.enum(LIQ_EVENT_SETTLED),
  /**
   * L18 (IB-148): a small event held back after S, then sent: the moment its message was due (S + 120 s, or the S
   * of the same-side event that opened during the hold and did not take it in). `sentAt` stays S, the event's own
   * settle moment, which the grouping reads. Absent: not held.
   */
  heldUntil: z.number().int().optional(),
  /** L17 / L18: a small event taken in by the same-side event with this T0; journalled, never sent. */
  mergedInto: z.object({ eventAt: z.number().int(), how: z.enum(LIQ_MERGE_HOW) }).strict().optional(),
  /** L19: the small events this one took in (its text gains «Перед этим: …»); absent when none. */
  merged: z.array(z.object({ symbol: z.string(), eventAt: z.number().int(), sumUsd: z.number().nonnegative(), how: z.enum(LIQ_MERGE_HOW) }).strict()).min(1).optional(),
}).strict();
export type LiqEventDetails = z.infer<typeof LiqEventDetailsSchema>;

/**
 * `event = 'event_continuing'` (L13): an event that hit the cap, at its close (the row's `at`). Written for every
 * such event so its final size is journalled; **sent only when `news`**: a coin joined after S (`newCoins`) or a
 * member added at least its own threshold between S and the close (`addedCoins`).
 */
export const LiqEventContinuingDetailsSchema = z.object({
  ...liqEventShape,
  closedAt: z.number().int(),
  closedBy: z.enum(LIQ_EVENT_CLOSED_BY),
  firstMessageId: z.number().int().positive(),
  newCoins: z.array(z.string()),
  addedCoins: z.array(z.string()),
  news: z.boolean(),
}).strict();
export type LiqEventContinuingDetails = z.infer<typeof LiqEventContinuingDetailsSchema>;

/** `continuing` is IB-122's per-coin 2× row, no longer written (L13); old rows keep the name. */
export const LIQ_ALERT_EVENTS = ['alert', 'continuing', 'event', 'event_continuing'] as const;
export type LiqAlertEvent = (typeof LIQ_ALERT_EVENTS)[number];

/** `market_alert_controls.details`, `kind = 'near_miss'` (L8): the hour's largest window that fired nothing. */
export const LiqNearMissDetailsSchema = z.object({
  side: LiqSideSchema,
  windowStartMs: z.number().int(),
  sumUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
  /** sum / threshold, in [0.5, 1). */
  ratio: z.number().min(LIQ_NEAR_MISS_RATIO).lt(1),
  /** The UTC hour it is the largest of (unix seconds). */
  hour: z.number().int(),
}).strict();
export type LiqNearMissDetails = z.infer<typeof LiqNearMissDetailsSchema>;

/** `kind = 'random'` (L8): a hash-picked 5-minute window, both sides. */
export const LiqRandomDetailsSchema = z.object({
  windowStartMs: z.number().int(),
  longUsd: z.number().nonnegative(),
  shortUsd: z.number().nonnegative(),
  thresholdUsd: z.number().positive(),
}).strict();
export type LiqRandomDetails = z.infer<typeof LiqRandomDetailsSchema>;

// ------------------------------------------------------------------------------------------------
// The admin page's «Ликвидации» section (L4, §1 Settings)
// ------------------------------------------------------------------------------------------------

/** One journal row as the admin page lists it. */
export const WebLiqAlertRowSchema = z.object({
  id: z.number().int(),
  source: z.enum(MARKET_ALERT_SOURCES),
  event: z.enum(LIQ_ALERT_EVENTS),
  symbol: z.string(),
  side: LiqSideSchema,
  /** Unix seconds: the crossing moment (the link's `at`); for `event` rows S, for `event_continuing` the close. */
  at: z.number().int(),
  sumUsd: z.number(),
  /** Null on event rows: each member has its own (IB-143). */
  thresholdUsd: z.number().nullable(),
  /** Event rows (IB-143): the members, largest first; new coins of a continuation prefixed «+». Else `[symbol]`. */
  coins: z.array(z.string()),
  /**
   * False = journalled only, never sent: an `event_continuing` with nothing new after S (L13), or an `event` taken
   * in by a larger same-side event (L17 / L18, IB-148). True elsewhere.
   */
  news: z.boolean(),
  firedAt: z.number().int().nullable(),
  late: z.boolean(),
  recipients: z.number().int(),
  /** IB-151: the switch that muted it; null = none did. */
  mutedBy: MarketAlertMutedBySchema.nullable(),
});
export type WebLiqAlertRow = z.infer<typeof WebLiqAlertRowSchema>;

/** One coin of `alert_symbols` and its liquidation setting; `thresholdUsd: null` = no threshold, so off. */
export const WebLiqCoinSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  /** The coin's own switch in `alert_symbols` (shared with OI). */
  listed: z.boolean(),
  enabled: z.boolean(),
  thresholdUsd: z.number().positive().nullable(),
});
export type WebLiqCoin = z.infer<typeof WebLiqCoinSchema>;

/** `GET /api/web/admin/alerts/liq`; every write answers with it. */
export const WebLiqAlertsAdminResponseSchema = z.object({
  settings: z.object({
    /** Sending to Telegram. Default OFF; detection and the journal run either way. */
    enabled: z.boolean(),
    /** Members may see and change their own toggle. Default OFF. */
    membersVisible: z.boolean(),
    params: LiqParamsSchema,
    updatedAt: z.number().int(),
  }),
  coins: z.array(WebLiqCoinSchema),
  /** The last 50 journal rows, newest first. */
  alerts: z.array(WebLiqAlertRowSchema).max(50),
});
export type WebLiqAlertsAdminResponse = z.infer<typeof WebLiqAlertsAdminResponseSchema>;

/**
 * `PATCH /api/web/admin/alerts/liq`: the two switches and/or coins' settings (merged into `perCoin`
 * per coin, so one coin's edit does not need the others). At least one field. Strict.
 */
export const WebLiqAlertSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  membersVisible: z.boolean().optional(),
  perCoin: z.record(AlertSymbolSchema, LiqCoinParamsSchema).optional(),
}).strict().refine((p) => p.enabled !== undefined || p.membersVisible !== undefined || p.perCoin !== undefined, {
  message: 'nothing to change',
});
export type WebLiqAlertSettingsPatch = z.infer<typeof WebLiqAlertSettingsPatchSchema>;
