import { z } from 'zod';
import { WebMarketPeriodSchema } from './market';

/**
 * IB-085 — the market page's positioning table and KPI strip
 * (architecture/market-page-design-2026-11-03.md D2, D3, D9, D10).
 */
const TimeSec = z.number().int().nonnegative();

// -------------------------------------------------------------------------------------------------
// D9: GET /api/web/market/positioning?period=

/**
 * Why a cell has no value or no rarity. A missing number is never a 0.
 * - `insufficient_history` — under 20 days of the coin's own history for that series (D3), or a 7d
 *   change (30 days hold four 7-day windows, as D14 rules for liquidations).
 * - `venue_unavailable` — the venue did not answer (or the weight ceiling refused the read).
 * - `not_listed` — the venue has no such series for this coin.
 */
export const WEB_POSITIONING_UNAVAILABLE = ['insufficient_history', 'venue_unavailable', 'not_listed'] as const;
export const WebPositioningUnavailableSchema = z.enum(WEB_POSITIONING_UNAVAILABLE);

/**
 * One cell. `rarity` is TWO-SIDED, so every cell sorts on one scale (D2): the mid-rank percentile of
 * how far the current figure is from typical, within the coin's own 30-day history of the same
 * quantity — |change| for the change cells, |level − median| for the level cells (funding, L/S).
 * 0.5 typical, ≥ 0.90 shown as unusual. The direction is in `value`'s sign.
 */
export const WebPositioningCellSchema = z.object({
  value: z.number().nullable(),
  rarity: z.number().min(0).max(1).nullable(),
  /** Set whenever `value` or `rarity` is null; null when both are present. */
  unavailable: WebPositioningUnavailableSchema.nullable(),
  /** How many past observations the rarity was measured against. */
  sample: z.number().int().nonnegative(),
});
export type WebPositioningCell = z.infer<typeof WebPositioningCellSchema>;

/**
 * Price × OI quadrant (D9), from the SIGNS of the period's changes:
 * price ↑ OI ↑ `new_longs` · price ↓ OI ↑ `new_shorts` · price ↑ OI ↓ `short_closing` ·
 * price ↓ OI ↓ `long_closing` · both within the flat band `flat`. With a flat price and a moving OI,
 * the side is read from the sign of funding (who pays is who is crowding in).
 */
export const WEB_POSITIONING_QUADRANTS = ['new_longs', 'new_shorts', 'long_closing', 'short_closing', 'flat'] as const;
export const WebPositioningQuadrantSchema = z.enum(WEB_POSITIONING_QUADRANTS);
export type WebPositioningQuadrant = z.infer<typeof WebPositioningQuadrantSchema>;

/**
 * The one-word read of a row — a CLOSED vocabulary, so every word is reviewable and translatable
 * (the rule for each lives in the server module's header). Null = nothing worth a word.
 */
export const WEB_POSITIONING_SIGNALS = ['squeeze', 'capitulation', 'crowded_long', 'crowded_short', 'quiet'] as const;
export const WebPositioningSignalSchema = z.enum(WEB_POSITIONING_SIGNALS);
export type WebPositioningSignal = z.infer<typeof WebPositioningSignalSchema>;

export const WebPositioningRowSchema = z.object({
  symbol: z.string(),
  base: z.string(),
  /** Price change over the period, in PERCENT. */
  priceChangePct: WebPositioningCellSchema,
  /** Open-interest change over the period, in PERCENT. */
  oiChangePct: WebPositioningCellSchema,
  /** The current funding rate as the venue states it (a fraction per settlement, 0.0001 = 0.01 %). */
  fundingRate: WebPositioningCellSchema,
  /** Global account long/short ratio, current. */
  lsGlobal: WebPositioningCellSchema,
  /** Top-trader POSITION long/short ratio, current. */
  lsTopPosition: WebPositioningCellSchema,
  /** USD liquidated over the period (crypto rows, our tape). */
  liqUsd: WebPositioningCellSchema,
  /**
   * IB-090: the coin's CURRENT open interest in USD (Binance `sumOpenInterestValue`, the last point
   * of the period's series) — the quadrant sizes its dot by it. Null when the venue did not answer;
   * a level, so it has no rarity and is not a cell.
   */
  oiUsd: z.number().nonnegative().nullable(),
  quadrant: WebPositioningQuadrantSchema.nullable(),
  signal: WebPositioningSignalSchema.nullable(),
});
export type WebPositioningRow = z.infer<typeof WebPositioningRowSchema>;

export const WebPositioningResponseSchema = z.object({
  period: WebMarketPeriodSchema,
  asOf: TimeSec,
  /** When the hourly baselines were last rebuilt (cached an hour, D9). */
  baselinesAsOf: TimeSec.nullable(),
  /** One row per CRYPTO universe coin (D6), in universe order. */
  rows: z.array(WebPositioningRowSchema),
});
export type WebPositioningResponse = z.infer<typeof WebPositioningResponseSchema>;

// -------------------------------------------------------------------------------------------------
// D10: GET /api/web/market/kpis

export const WEB_KPI_IDS = ['market_cap', 'btc_dominance', 'fear_greed', 'liquidations_24h', 'btc_oi', 'btc_funding'] as const;
export const WebKpiIdSchema = z.enum(WEB_KPI_IDS);
export type WebKpiId = z.infer<typeof WebKpiIdSchema>;

/** The tile's sentence, worded by the client (D4): a closed key set plus typed params. */
export const WEB_KPI_CONTEXT_KEYS = [
  'kpi.ctx.change',          // {deltaPct}: "+2.1 % за 24ч"
  'kpi.ctx.fng_band',        // {band}: extreme_fear | fear | neutral | greed | extreme_greed
  'kpi.ctx.liq_side',        // {side, sharePct}: "70 % — лонги"
  'kpi.ctx.funding_side',    // {side}: longs_pay | shorts_pay | flat
] as const;
export const WebKpiContextKeySchema = z.enum(WEB_KPI_CONTEXT_KEYS);

/**
 * IB-106 (design §7.5, D25) — the tile's small muted note under its bar: a fact the tile does not
 * otherwise carry. A closed key set worded by the client, as `context`. Null = no note (the tile has
 * none, or its read failed: a soft read never empties a tile).
 */
export const WEB_KPI_NOTE_KEYS = [
  'kpi.note.eth_share',      // {ethPct}: "ETH 10.6%" (btc_dominance; CoinGecko /global, the same fetch)
  'kpi.note.fng_history',    // {yesterday, weekAgo}: "вчера 37 · неделю назад 48" (fear_greed); a null half is omitted
  'kpi.note.ls_accounts',    // {ratio}: "лонги/шорты по счетам 2.62" (btc_funding; Binance global-account L/S, last point)
] as const;
export const WebKpiNoteKeySchema = z.enum(WEB_KPI_NOTE_KEYS);
export type WebKpiNoteKey = z.infer<typeof WebKpiNoteKeySchema>;

export const WebKpiTileSchema = z.object({
  id: WebKpiIdSchema,
  /** USD for cap / liquidations / OI-notional; percent for dominance; index 0–100 for F&G; a fraction for funding. */
  value: z.number().nullable(),
  /** Change over `deltaBasis`, in the same unit as `value` (percent points for dominance, index points for F&G). */
  delta: z.number().nullable(),
  deltaBasis: z.enum(['24h', '7d']),
  /** Long/short split, liquidations only. */
  split: z.object({ long: z.number().nonnegative(), short: z.number().nonnegative() }).nullable(),
  context: z.object({ key: WebKpiContextKeySchema, params: z.record(z.string(), z.union([z.number(), z.string()])) }).nullable(),
  /** IB-106: the note under the bar (§7.5). Required, so a server that forgets it fails the parse rather than hiding it. */
  note: z.object({ key: WebKpiNoteKeySchema, params: z.record(z.string(), z.number().nullable()) }).nullable(),
  /** Attribution the tile must show (§5: alternative.me requires it for F&G). */
  source: z.object({ name: z.string(), url: z.string().url().nullable() }),
  /** Why `value` is null, when it is. */
  unavailable: z.enum(['venue_unavailable', 'insufficient_history']).nullable(),
  asOf: TimeSec.nullable(),
});
export type WebKpiTile = z.infer<typeof WebKpiTileSchema>;

export const WebKpisResponseSchema = z.object({
  asOf: TimeSec,
  /** Always the six tiles, in `WEB_KPI_IDS` order — an unavailable one says so rather than vanishing. */
  tiles: z.array(WebKpiTileSchema).length(WEB_KPI_IDS.length),
});
export type WebKpisResponse = z.infer<typeof WebKpisResponseSchema>;
