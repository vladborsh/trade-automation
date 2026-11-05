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

/** L1: the window is 5 minutes, sliding; the loop evaluates every 30 s. */
export const LIQ_WINDOW_SEC = 300;
export const LIQ_TICK_SEC = 30;
/** L2: quiet for 30 min from `at`; one continuation when the running sum from the window's start reaches 2×. */
export const LIQ_QUIET_SEC = 1_800;
export const LIQ_CONTINUATION_MULT = 2;
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

export const LIQ_ALERT_EVENTS = ['alert', 'continuing'] as const;
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
  /** Unix seconds: the crossing moment (the link's `at`). */
  at: z.number().int(),
  sumUsd: z.number(),
  thresholdUsd: z.number(),
  firedAt: z.number().int().nullable(),
  late: z.boolean(),
  recipients: z.number().int(),
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
