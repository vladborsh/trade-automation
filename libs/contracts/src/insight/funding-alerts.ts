import { z } from 'zod';
import { MARKET_ALERT_SOURCES, MarketAlertMutedBySchema } from './market-alerts';
import { AlertSymbolSchema } from './oi-divergence-admin';

/**
 * IB-124 — the funding alerts (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3, F1–F8), on the
 * generic tables of IB-122 (`market_alerts`, `market_alert_controls`, `alert_type_settings('funding')`).
 * Migration 034 adds the settings row, `users.funding_alerts` and `alert_funding_state` (F6).
 *
 * **The floor is not declared here.** Its default is `FUNDING_FLOOR_PER_8H` in the bot's `insights/thresholds.ts`
 * (IB-135, shared with R5). A coin's `floorPer8h` only overrides it, and the admin page reads the default from
 * the server (`defaultFloorPer8h`). That keeps one constant (F3).
 */

/** F3: the extreme side. `high` = longs pay shorts, `low` = shorts pay longs (IB-135's `FundingExtreme`). */
export const FUNDING_SIDES = ['high', 'low'] as const;
export const FundingSideSchema = z.enum(FUNDING_SIDES);
export type FundingSide = z.infer<typeof FundingSideSchema>;

/**
 * F8: `direction` on the journal and controls is the crowded side as it is, with no forecast. When longs pay
 * (`high`) the crowding is long, stored as `bearish`; when shorts pay (`low`) it is stored as `bullish`.
 */
export const FUNDING_SIDE_DIRECTION: Record<FundingSide, 'bullish' | 'bearish'> = { high: 'bearish', low: 'bullish' };

/** F1: one check every 5 min (premiumIndex per coin, weight 1 each). */
export const FUNDING_CHECK_SEC = 300;
/** F1: the 30-day settled history per coin is re-read hourly (fundingRate, weight 1). */
export const FUNDING_HISTORY_REFRESH_SEC = 3_600;
/** F4: an extreme side re-arms after this many checks in a row outside the extreme (15 min). */
export const FUNDING_REARM_CHECKS = 3;
/** F5: the opposite sign must hold for this many checks in a row to count as a flip. */
export const FUNDING_FLIP_CHECKS = 3;
/**
 * F7: a check whose rate is older than this gives no signal and does not move the state. Two checks further
 * apart than this are not consecutive, so the F4/F5 streaks restart (downtime breaks "in a row").
 */
export const FUNDING_LATE_SEC = 900;
/** §1 «Link»: the instrument page opens on 1h for a funding alert. */
export const FUNDING_ALERT_TF = '1h';
/** F8: random checks recorded per coin and UTC day. */
export const FUNDING_RANDOM_PER_DAY = 2;

/** F3: a coin's switch and its own floor, as a FRACTION per 8 h (0.0003 = 0.03 %). Absent floor = the shared default. */
export const FundingCoinParamsSchema = z.object({
  enabled: z.boolean(),
  floorPer8h: z.number().finite().positive().max(0.01).optional(),
}).strict();
export type FundingCoinParams = z.infer<typeof FundingCoinParamsSchema>;

/**
 * `alert_type_settings.params` for `funding`. **A coin missing from `perCoin` is ON at the shared floor** (§1:
 * "a coin missing from perCoin takes the type's defaults"). Unlike a liquidation threshold, the funding floor
 * has a default that fits any coin, because the band is the coin's own.
 */
export const FundingParamsSchema = z.object({
  /** F5: an episode at least this long can be followed by a flip. */
  minEpisodeHours: z.number().positive().max(720),
  /** F5: the flip must start within this long after the episode's end. */
  flipWithinHours: z.number().positive().max(720),
  perCoin: z.record(AlertSymbolSchema, FundingCoinParamsSchema),
}).strict();
export type FundingParams = z.infer<typeof FundingParamsSchema>;

/** F5's two bounds; seeded by migration 034 (a spec holds the two equal). */
export const FUNDING_DEFAULT_PARAMS: FundingParams = { minEpisodeHours: 24, flipWithinHours: 72, perCoin: {} };

/** One check's facts, as every funding row records them. Rates are FRACTIONS (0.0001 = 0.01 %). */
export const FundingFactsSchema = z.object({
  /** The venue's own predicted rate for the running interval (`premiumIndex.lastFundingRate`). */
  rate: z.number().finite(),
  /** The venue's interval in hours (median of the last 3 settlement spacings); null = unknown, counted as 8 h. */
  intervalH: z.number().int().positive().nullable(),
  /** `rate × 8 / intervalH`: what the floor is compared with (F2). */
  ratePer8h: z.number().finite(),
  /** Two-sided rarity of `rate` within the coin's 30-day settled rates (`levelRarity`, as R5). */
  rarity: z.number().min(0).max(1),
  /** R5's band on the same sample (`levelBand` at RARITY_SHOW), in raw rate units: outside it is rare. */
  band: z.object({ lo: z.number().finite(), hi: z.number().finite() }).strict(),
  /** Settlements in the sample. */
  sample: z.number().int().positive(),
  /** The floor in force for this coin, per 8 h. */
  floorPer8h: z.number().positive(),
  /** The venue's timestamp of the rate (`premiumIndex.time`), epoch ms. */
  rateTimeMs: z.number().int(),
  /** The next settlement (`premiumIndex.nextFundingTime`), epoch ms. */
  nextFundingTimeMs: z.number().int(),
}).strict();
export type FundingFacts = z.infer<typeof FundingFactsSchema>;

/** `market_alerts.details` for `type = 'funding'`, `event = 'enter'` (F4). The row's `at` = the episode start. */
export const FundingEnterDetailsSchema = FundingFactsSchema.extend({
  side: FundingSideSchema,
  episodeStartMs: z.number().int(),
}).strict();
export type FundingEnterDetails = z.infer<typeof FundingEnterDetailsSchema>;

/**
 * `event = 'flip'` (F5): after an episode of ≥ `minEpisodeHours`, the rate's sign was the opposite for
 * `FUNDING_FLIP_CHECKS` checks in a row, starting within `flipWithinHours` of the episode's end. The row's `at`
 * is `flipSinceMs`, the first opposite check. The facts are those of the confirming check.
 */
export const FundingFlipDetailsSchema = FundingFactsSchema.extend({
  /** The EPISODE's side; the new sign is the opposite. */
  side: FundingSideSchema,
  episodeStartMs: z.number().int(),
  /** The first check outside the extreme (the start of the re-arming streak). */
  episodeEndMs: z.number().int(),
  episodeHours: z.number().nonnegative(),
  flipSinceMs: z.number().int(),
}).strict();
export type FundingFlipDetails = z.infer<typeof FundingFlipDetailsSchema>;

export const FUNDING_ALERT_EVENTS = ['enter', 'flip'] as const;
export type FundingAlertEvent = (typeof FUNDING_ALERT_EVENTS)[number];

/**
 * F8 `near_miss`: a check that met ONE of the two conditions, at most one per coin, side and UTC day.
 * `failed: 'floor'` = rare for the coin but inside the floor; `'band'` = beyond the floor but not rare.
 * The side is the rate's sign (positive = `high`).
 */
export const FUNDING_NEAR_MISS_FAILED = ['floor', 'band'] as const;
export const FundingNearMissDetailsSchema = FundingFactsSchema.extend({
  side: FundingSideSchema,
  failed: z.enum(FUNDING_NEAR_MISS_FAILED),
}).strict();
export type FundingNearMissDetails = z.infer<typeof FundingNearMissDetailsSchema>;

/** F8 `random`: a hash-picked check of the coin's UTC day, its rate and band recorded. */
export const FundingRandomDetailsSchema = FundingFactsSchema;
export type FundingRandomDetails = z.infer<typeof FundingRandomDetailsSchema>;

// ------------------------------------------------------------------------------------------------
// The admin page's «Funding» section
// ------------------------------------------------------------------------------------------------

/** One journal row as the admin page lists it. */
export const WebFundingAlertRowSchema = z.object({
  id: z.number().int(),
  source: z.enum(MARKET_ALERT_SOURCES),
  event: z.enum(FUNDING_ALERT_EVENTS),
  symbol: z.string(),
  side: FundingSideSchema,
  /** Unix seconds: the row's `at` (episode start for `enter`, the first opposite check for `flip`). */
  at: z.number().int(),
  rate: z.number(),
  intervalH: z.number().int().nullable(),
  ratePer8h: z.number(),
  /** `flip` only: how long the episode lasted. */
  episodeHours: z.number().nullable(),
  firedAt: z.number().int().nullable(),
  late: z.boolean(),
  recipients: z.number().int(),
  /** IB-151: the switch that muted it; null = none did. */
  mutedBy: MarketAlertMutedBySchema.nullable(),
});
export type WebFundingAlertRow = z.infer<typeof WebFundingAlertRowSchema>;

/** One coin of `alert_symbols` and its funding setting. */
export const WebFundingCoinSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  /** The coin's own switch in `alert_symbols` (shared with OI and liquidations). */
  listed: z.boolean(),
  enabled: z.boolean(),
  /** The coin's own floor; null = the shared default. */
  floorPer8h: z.number().positive().nullable(),
});
export type WebFundingCoin = z.infer<typeof WebFundingCoinSchema>;

/** `GET /api/web/admin/alerts/funding`; every write answers with it. */
export const WebFundingAlertsAdminResponseSchema = z.object({
  settings: z.object({
    /** Sending to Telegram. Default OFF; checks, state and the journal run either way. */
    enabled: z.boolean(),
    /** Members may see and change their own toggle. Default OFF. */
    membersVisible: z.boolean(),
    params: FundingParamsSchema,
    updatedAt: z.number().int(),
  }),
  /** The shared floor (`FUNDING_FLOOR_PER_8H`, IB-135) that a coin without its own floor uses. */
  defaultFloorPer8h: z.number().positive(),
  coins: z.array(WebFundingCoinSchema),
  /** The last 50 journal rows, newest first. */
  alerts: z.array(WebFundingAlertRowSchema).max(50),
});
export type WebFundingAlertsAdminResponse = z.infer<typeof WebFundingAlertsAdminResponseSchema>;

/** A coin's edit: `floorPer8h: null` returns it to the shared default. */
export const WebFundingCoinPatchSchema = z.object({
  enabled: z.boolean(),
  floorPer8h: z.number().finite().positive().max(0.01).nullable(),
}).strict();
export type WebFundingCoinPatch = z.infer<typeof WebFundingCoinPatchSchema>;

/**
 * `PATCH /api/web/admin/alerts/funding`: the switches, F5's two bounds and/or coins (merged per coin). At least
 * one field. Strict.
 */
export const WebFundingAlertSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  membersVisible: z.boolean().optional(),
  minEpisodeHours: z.number().positive().max(720).optional(),
  flipWithinHours: z.number().positive().max(720).optional(),
  perCoin: z.record(AlertSymbolSchema, WebFundingCoinPatchSchema).optional(),
}).strict().refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'nothing to change' });
export type WebFundingAlertSettingsPatch = z.infer<typeof WebFundingAlertSettingsPatchSchema>;
