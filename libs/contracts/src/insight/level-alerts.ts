import { z } from 'zod';
import { MARKET_ALERT_SOURCES } from './market-alerts';
import { AlertSymbolSchema } from './oi-divergence-admin';

/**
 * IB-126 — the price-level alerts (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4, P1–P7, P10), on
 * the generic tables of IB-122 (`market_alerts`, `market_alert_controls`, `alert_type_settings('level')`).
 * Migration 035 adds the settings row, `users.level_alerts` and `alert_level_state` (P10).
 *
 * The levels themselves are computed by `libs/market-data-core` (`prior-levels.ts`, P1), shared with the dashboard.
 */

/**
 * P2: the level kinds. Ids are what the messages print (C3: level names stay English). `WO` / `MO` are the weekly and
 * monthly open; the messages spell them «weekly open» / «monthly open» (`LEVEL_KIND_LABEL`).
 */
export const LEVEL_KINDS = ['PWH', 'PWL', 'PMH', 'PML', 'WO', 'MO', 'PDH', 'PDL'] as const;
export const LevelKindSchema = z.enum(LEVEL_KINDS);
export type LevelKind = z.infer<typeof LevelKindSchema>;

/** C3: what a message calls each kind. */
export const LEVEL_KIND_LABEL: Record<LevelKind, string> = {
  PWH: 'PWH', PWL: 'PWL', PMH: 'PMH', PML: 'PML', WO: 'weekly open', MO: 'monthly open', PDH: 'PDH', PDL: 'PDL',
};

/** P3: which side a kind is evaluated from. A high level from below, a low one from above, an open from both. */
export const LEVEL_KIND_SIDE: Record<LevelKind, 'high' | 'low' | 'open'> = {
  PWH: 'high', PMH: 'high', PDH: 'high', PWL: 'low', PML: 'low', PDL: 'low', WO: 'open', MO: 'open',
};

/** P4: the period a kind is in force for (and its dedupe period). */
export const LEVEL_KIND_PERIOD: Record<LevelKind, 'day' | 'week' | 'month'> = {
  PDH: 'day', PDL: 'day', PWH: 'week', PWL: 'week', WO: 'week', PMH: 'month', PML: 'month', MO: 'month',
};

/** P2: PDH/PDL are off by default and switched on per coin (`perCoin[symbol].daily`). */
export const LEVEL_DAILY_KINDS: readonly LevelKind[] = ['PDH', 'PDL'];

/** P3/P4: the events, named by direction (the dedupe key's last part). */
export const LEVEL_EVENTS = ['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below', 'crossunder', 'crossover'] as const;
export const LevelEventSchema = z.enum(LEVEL_EVENTS);
export type LevelEvent = z.infer<typeof LevelEventSchema>;

/**
 * P3 «Which side each level is evaluated from»: a high level gets breakout up, sweep above and crossunder; a low level
 * breakout down, sweep below and crossover; an open breakout up/down and sweep above/below, with no crossunder/crossover.
 */
export const LEVEL_SIDE_EVENTS: Record<'high' | 'low' | 'open', readonly LevelEvent[]> = {
  high: ['breakout_up', 'sweep_above', 'crossunder'],
  low: ['breakout_down', 'sweep_below', 'crossover'],
  open: ['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below'],
};
export const levelKindEvents = (kind: LevelKind): readonly LevelEvent[] => LEVEL_SIDE_EVENTS[LEVEL_KIND_SIDE[kind]];

/**
 * The journal's `direction`: the side of L the bar CLOSED on, as a fact, no forecast (D20). Above → `bullish`
 * (breakout up, sweep below, crossover), below → `bearish` (breakout down, sweep above, crossunder).
 */
export const LEVEL_EVENT_DIRECTION: Record<LevelEvent, 'bullish' | 'bearish'> = {
  breakout_up: 'bullish', sweep_below: 'bullish', crossover: 'bullish',
  breakout_down: 'bearish', sweep_above: 'bearish', crossunder: 'bearish',
};

/** P3: evaluated on each 15m close, the bar closed + 5 s settle. §1 «Link»: the instrument page opens on 15m. */
export const LEVEL_ALERT_TF = '15m';
export const LEVEL_BAR_SEC = 900;
export const LEVEL_SETTLE_SEC = 5;
/** P5: a 15m close older than this when it is evaluated is journalled `late`, never sent. */
export const LEVEL_LATE_SEC = 1_200;
/** P2: 1d bars per coin, re-read once a UTC day (weight 1 at limit < 100). Covers the previous month whole. */
export const LEVEL_DAILY_BARS = 70;
/** P10: at most this many coins are seeded per minute (≤ 2 pages × weight 10 each). */
export const LEVEL_SEED_COINS_PER_MIN = 1;
/** P7: random 15m bars recorded per coin and UTC day. */
export const LEVEL_RANDOM_PER_DAY = 2;
/**
 * P7 `touch`: a bar whose near-side extreme came within this fraction of L without going beyond it. The design names
 * no width; with exact equality a touch would almost never exist. 0.1 % is the default, editable on /admin/alerts.
 */
export const LEVEL_TOUCH_BAND_DEFAULT = 0.001;

/** P2: a coin's switch, and whether its PDH/PDL are on. */
export const LevelCoinParamsSchema = z.object({
  enabled: z.boolean(),
  daily: z.boolean(),
}).strict();
export type LevelCoinParams = z.infer<typeof LevelCoinParamsSchema>;

/** P2: `events[kind][event] = false` switches that one off; anything absent is ON wherever the level itself is on. */
export const LevelEventSwitchesSchema = z.record(LevelKindSchema, z.record(LevelEventSchema, z.boolean()));
export type LevelEventSwitches = z.infer<typeof LevelEventSwitchesSchema>;

/**
 * `alert_type_settings.params` for `level`. **A coin missing from `perCoin` is ON with PDH/PDL off** (P2: the levels
 * fit any coin, being its own).
 */
export const LevelParamsSchema = z.object({
  touchBand: z.number().positive().max(0.05),
  events: LevelEventSwitchesSchema,
  perCoin: z.record(AlertSymbolSchema, LevelCoinParamsSchema),
}).strict();
export type LevelParams = z.infer<typeof LevelParamsSchema>;

/** Seeded by migration 035 (a spec holds the two equal). */
export const LEVEL_DEFAULT_PARAMS: LevelParams = { touchBand: LEVEL_TOUCH_BAND_DEFAULT, events: {}, perCoin: {} };

/** Whether `event` of `kind` is switched on (absent = on). Does not check that the event applies to the kind. */
export function levelEventOn(params: Pick<LevelParams, 'events'>, kind: LevelKind, event: LevelEvent): boolean {
  return params.events[kind]?.[event] ?? true;
}

/** One 15m bar as the rows record it; times epoch MS. */
export const LevelBarSchema = z.object({
  openMs: z.number().int(),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
}).strict();
export type LevelBar = z.infer<typeof LevelBarSchema>;

/** A level in force: its kind, price, and the period `[startMs, endMs)` it is in force for. */
export const LevelInForceSchema = z.object({
  kind: LevelKindSchema,
  price: z.number().finite().positive(),
  periodStartMs: z.number().int(),
  periodEndMs: z.number().int(),
}).strict();
export type LevelInForce = z.infer<typeof LevelInForceSchema>;

/**
 * `market_alerts.details` for `type = 'level'`. The row's `at` is the bar's open (the link's `at`), its `event` one of
 * LEVEL_EVENTS. `prevClose` is the previous 15m close; `firstBeyondAtMs` is P10's, for crossunder/crossover only: the
 * close moment of the first close beyond L in the period (P6's «… закрывалась с {время}»).
 */
export const LevelAlertDetailsSchema = LevelInForceSchema.extend({
  bar: LevelBarSchema,
  prevClose: z.number().finite(),
  firstBeyondAtMs: z.number().int().nullable(),
}).strict();
export type LevelAlertDetails = z.infer<typeof LevelAlertDetailsSchema>;

/** P7 `touch`: a bar that came within the band of L from `from` without going beyond. One per level and UTC day. */
export const LevelTouchDetailsSchema = LevelInForceSchema.extend({
  bar: LevelBarSchema,
  from: z.enum(['below', 'above']),
  /** |extreme − L| / L, ≤ the band. */
  distance: z.number().nonnegative(),
  touchBand: z.number().positive(),
}).strict();
export type LevelTouchDetails = z.infer<typeof LevelTouchDetailsSchema>;

/** P7 `random`: a hash-picked 15m bar of the coin's UTC day, with the levels in force at it. */
export const LevelRandomDetailsSchema = z.object({
  bar: LevelBarSchema,
  levels: z.array(LevelInForceSchema),
}).strict();
export type LevelRandomDetails = z.infer<typeof LevelRandomDetailsSchema>;

/** P10: the side of the last non-touch 15m close of the period, relative to L. */
export const LEVEL_STATE_SIDES = ['above', 'below'] as const;
export type LevelStateSide = (typeof LEVEL_STATE_SIDES)[number];

// ------------------------------------------------------------------------------------------------
// The admin page's «Levels» section
// ------------------------------------------------------------------------------------------------

/** One journal row as the admin page lists it. */
export const WebLevelAlertRowSchema = z.object({
  id: z.number().int(),
  source: z.enum(MARKET_ALERT_SOURCES),
  event: LevelEventSchema,
  symbol: z.string(),
  kind: LevelKindSchema,
  price: z.number(),
  /** Unix seconds: the bar's open. */
  at: z.number().int(),
  close: z.number(),
  firedAt: z.number().int().nullable(),
  late: z.boolean(),
  recipients: z.number().int(),
});
export type WebLevelAlertRow = z.infer<typeof WebLevelAlertRowSchema>;

/** One coin of `alert_symbols` and its level setting. */
export const WebLevelCoinSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  /** The coin's own switch in `alert_symbols` (shared with the other alert types). */
  listed: z.boolean(),
  enabled: z.boolean(),
  /** PDH/PDL on for this coin (P2, default off). */
  daily: z.boolean(),
  /** P10: how many of its state rows exist for the current periods; 0 while it waits for its seed. */
  stateRows: z.number().int().nonnegative(),
});
export type WebLevelCoin = z.infer<typeof WebLevelCoinSchema>;

/** `GET /api/web/admin/alerts/levels`; every write answers with it. */
export const WebLevelAlertsAdminResponseSchema = z.object({
  settings: z.object({
    /** Sending to Telegram. Default OFF; evaluation, state and the journal run either way. */
    enabled: z.boolean(),
    /** Members may see and change their own toggle. Default OFF. */
    membersVisible: z.boolean(),
    params: LevelParamsSchema,
    updatedAt: z.number().int(),
  }),
  /** The effective event switches, every kind and every event that applies to it. */
  events: z.record(LevelKindSchema, z.record(LevelEventSchema, z.boolean())),
  coins: z.array(WebLevelCoinSchema),
  /** The last 50 journal rows, newest first. */
  alerts: z.array(WebLevelAlertRowSchema).max(50),
});
export type WebLevelAlertsAdminResponse = z.infer<typeof WebLevelAlertsAdminResponseSchema>;

/**
 * `PATCH /api/web/admin/alerts/levels`: the switches, the touch band, event switches (merged per kind and event; an
 * event that does not apply to its kind is refused) and/or coins (merged per coin). At least one field. Strict.
 */
export const WebLevelAlertSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  membersVisible: z.boolean().optional(),
  touchBand: z.number().positive().max(0.05).optional(),
  events: LevelEventSwitchesSchema.optional(),
  perCoin: z.record(AlertSymbolSchema, LevelCoinParamsSchema).optional(),
}).strict()
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: 'nothing to change' })
  .refine(
    (p) => Object.entries(p.events ?? {}).every(([kind, ev]) => Object.keys(ev ?? {}).every((e) => levelKindEvents(kind as LevelKind).includes(e as LevelEvent))),
    { message: 'an event that does not apply to its level kind' },
  );
export type WebLevelAlertSettingsPatch = z.infer<typeof WebLevelAlertSettingsPatchSchema>;
