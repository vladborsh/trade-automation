import { z } from 'zod';
import { LEVEL_SIDE_EVENTS, LevelBarSchema, type LevelEvent } from './level-alerts';
import { AlertSymbolSchema } from './oi-divergence-admin';

/**
 * IB-128 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4 P9) — the owner's own price levels, on top
 * of IB-126's level alerts. Migration 036 adds `alert_custom_levels` (soft delete: `deleted_at`).
 *
 * - Added and deleted on `/admin/alerts` and with the bot commands `/level BTC 72000 [note]`, `/level del <id>` and
 *   `/level` (the list); admins only.
 * - Evaluated on each 15m close by the level loop, **from both sides as an open is** (P9: a custom level is neither a
 *   high nor a low): breakout up/down and sweep above/below, no crossunder/crossover, no P10 state.
 * - **Repeats: one per (level, event) per UTC day**, the day of the bar's open (`customLevelDedupeKey`).
 * - Each level has its own four event switches (absent = on), so one level can keep its breakouts and drop its sweeps.
 * - Sending follows the level type's switch (`alert_type_settings('level').enabled`, default OFF) and the coin's level
 *   switch (`perCoin[symbol].enabled`): a custom level is one more level of that coin.
 */

/** P9: the events a custom level gets — an open's. */
export const CUSTOM_LEVEL_EVENTS = LEVEL_SIDE_EVENTS.open as readonly ['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below'];
export const CustomLevelEventSchema = z.enum(['breakout_up', 'breakout_down', 'sweep_above', 'sweep_below']);
export type CustomLevelEvent = z.infer<typeof CustomLevelEventSchema>;

export const isCustomLevelEvent = (e: LevelEvent): e is CustomLevelEvent => (CUSTOM_LEVEL_EVENTS as readonly LevelEvent[]).includes(e);

/** A level's switches: `false` switches that event off; absent is on. Stored as the exceptions only. */
export const CustomLevelEventSwitchesSchema = z.object({
  breakout_up: z.boolean().optional(),
  breakout_down: z.boolean().optional(),
  sweep_above: z.boolean().optional(),
  sweep_below: z.boolean().optional(),
}).strict();
export type CustomLevelEventSwitches = z.infer<typeof CustomLevelEventSwitchesSchema>;

export const customLevelEventOn = (events: CustomLevelEventSwitches, event: CustomLevelEvent): boolean => events[event] ?? true;

/** A note is the owner's own words for the level («range high»), shown in admin and in the message. */
export const CUSTOM_LEVEL_NOTE_MAX = 200;
/**
 * Active levels per coin. Not a cost bound (a level costs no venue call: the loop reads each coin's 15m bars once
 * either way) but a typo guard: twenty is more than anyone draws on one chart.
 */
export const CUSTOM_LEVELS_PER_COIN_MAX = 20;

export const CustomLevelPriceSchema = z.number().finite().positive();
const NoteSchema = z.string().trim().max(CUSTOM_LEVEL_NOTE_MAX);

/** P4 for P9: one message per (level, event) per UTC day. `dayStartMs` is the UTC midnight of the bar's open. */
export function customLevelDedupeKey(symbol: string, levelId: number, dayStartMs: number, event: CustomLevelEvent): string {
  return `level:${symbol}:custom-${levelId}:${dayStartMs}:${event}`;
}

/**
 * `market_alerts.details` for a custom level's event (`type = 'level'`, `event` one of CUSTOM_LEVEL_EVENTS). `kind`
 * tells it from the built-in kinds' details; `dayStartMs` is the day its once-key belongs to.
 */
export const CustomLevelAlertDetailsSchema = z.object({
  kind: z.literal('custom'),
  levelId: z.number().int().positive(),
  price: CustomLevelPriceSchema,
  note: z.string().nullable(),
  dayStartMs: z.number().int(),
  bar: LevelBarSchema,
  prevClose: z.number().finite(),
}).strict();
export type CustomLevelAlertDetails = z.infer<typeof CustomLevelAlertDetailsSchema>;

// ------------------------------------------------------------------------------------------------
// The admin page: `/api/web/admin/alerts/levels/custom`
// ------------------------------------------------------------------------------------------------

/** One active level as the admin page lists it. */
export const WebCustomLevelSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string(),
  base: z.string(),
  price: z.number().positive(),
  note: z.string().nullable(),
  /** The effective switches, all four events. */
  events: z.object({ breakout_up: z.boolean(), breakout_down: z.boolean(), sweep_above: z.boolean(), sweep_below: z.boolean() }).strict(),
  /** `users.id` of the admin who added it; null once that user is deleted. */
  createdBy: z.number().int().nullable(),
  /** Unix seconds. */
  createdAt: z.number().int(),
}).strict();
export type WebCustomLevel = z.infer<typeof WebCustomLevelSchema>;

/** `GET /api/web/admin/alerts/levels/custom`; every write answers with it. The active levels, by symbol, then price. */
export const WebCustomLevelsResponseSchema = z.object({
  levels: z.array(WebCustomLevelSchema),
}).strict();
export type WebCustomLevelsResponse = z.infer<typeof WebCustomLevelsResponseSchema>;

/** `POST /api/web/admin/alerts/levels/custom`. The coin must be on `alert_symbols`. Strict. */
export const WebCustomLevelCreateSchema = z.object({
  symbol: AlertSymbolSchema,
  price: CustomLevelPriceSchema,
  note: NoteSchema.optional(),
  events: CustomLevelEventSwitchesSchema.optional(),
}).strict();
export type WebCustomLevelCreate = z.infer<typeof WebCustomLevelCreateSchema>;

/** `PATCH /api/web/admin/alerts/levels/custom/:id`: the level's event switches, merged per event. Strict. */
export const WebCustomLevelPatchSchema = z.object({
  events: CustomLevelEventSwitchesSchema,
}).strict().refine((p) => Object.keys(p.events).length > 0, { message: 'nothing to change' });
export type WebCustomLevelPatch = z.infer<typeof WebCustomLevelPatchSchema>;

// ------------------------------------------------------------------------------------------------
// The instrument chart: `GET /api/web/series/custom-levels?symbol=` (admins only)
// ------------------------------------------------------------------------------------------------

/** One active level of the coin, a horizontal line on the price pane. */
export const WebChartCustomLevelSchema = z.object({
  id: z.number().int().positive(),
  price: z.number().positive(),
  note: z.string().nullable(),
}).strict();
export type WebChartCustomLevel = z.infer<typeof WebChartCustomLevelSchema>;

export const WebChartCustomLevelsResponseSchema = z.object({
  symbol: z.string(),
  levels: z.array(WebChartCustomLevelSchema).max(CUSTOM_LEVELS_PER_COIN_MAX),
}).strict();
export type WebChartCustomLevelsResponse = z.infer<typeof WebChartCustomLevelsResponseSchema>;
