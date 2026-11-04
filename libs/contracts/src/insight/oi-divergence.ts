import { z } from 'zod';

/**
 * IB-109 — price vs open-interest divergence alerts (architecture/oi-divergence-design-2026-11-04.md,
 * V1–V17): the shapes the chart (IB-110), the alert loop and the admin page (IB-112) share.
 *
 * - **Bullish**, on lows: price makes a lower low and OI a higher low.
 * - **Bearish**, on highs: price makes a higher high and OI a lower high.
 *
 * Every time is unix SECONDS. A bar is named by its OPEN time, as the venue's klines are.
 */
const TimeSec = z.number().int().nonnegative();

export const OI_DIVERGENCE_TFS = ['15m', '1h', '4h'] as const;
export const OiDivergenceTfSchema = z.enum(OI_DIVERGENCE_TFS);
export type OiDivergenceTf = z.infer<typeof OiDivergenceTfSchema>;
export const OI_DIVERGENCE_TF_SEC: Record<OiDivergenceTf, number> = { '15m': 900, '1h': 3_600, '4h': 14_400 };

export const OI_DIVERGENCE_DIRECTIONS = ['bullish', 'bearish'] as const;
export const OiDivergenceDirectionSchema = z.enum(OI_DIVERGENCE_DIRECTIONS);
export type OiDivergenceDirection = z.infer<typeof OiDivergenceDirectionSchema>;

// -------------------------------------------------------------------------------------------------
// Params (V5–V7): editable in the admin page, kept with every journal row

/** Per TF: pivot reach N (bars each side), pairing reach k (±bars), lookback W (bars from B back to A). */
export const OiDivergenceTfParamsSchema = z.object({
  n: z.number().int().min(1).max(50),
  k: z.number().int().min(0).max(20),
  w: z.number().int().min(2).max(1_000),
});
export type OiDivergenceTfParams = z.infer<typeof OiDivergenceTfParamsSchema>;

/** V18: a line tolerance multiplier. 0 is the round-1 rule (no crossing at all). */
const LineTolSchema = z.number().nonnegative().max(5);

const paramsShape = {
  perTf: z.object({ '15m': OiDivergenceTfParamsSchema, '1h': OiDivergenceTfParamsSchema, '4h': OiDivergenceTfParamsSchema }),
  /** δp = atrMult × ATR14 at B: the price must be worse by more than this. */
  atrMult: z.number().nonnegative(),
  /** δoi = oiMedianMult × median |ΔOI per bar| over the 100 bars before B: OI must be better by more than this. */
  oiMedianMult: z.number().nonnegative(),
  /**
   * V18: a wick between A and B may cross the A–B price line by up to this × ATR14 **at that bar**
   * (on the boundary it passes). 0 = no crossing allowed (round 1).
   */
  priceLineTolAtrMult: LineTolSchema,
  /**
   * V18: a per-bar OI between the two OI pivots may cross the OI line by up to this × the SAME median
   * |ΔOI per bar| as δoi (the 100 bars before B). 0 = no crossing allowed (round 1).
   */
  oiLineTolMedianMult: LineTolSchema,
};

/** `alert_settings.params` and the admin's writes: every key required (V19 — migration 026 adds the two tolerances). */
export const OiDivergenceParamsSchema = z.object(paramsShape);
export type OiDivergenceParams = z.infer<typeof OiDivergenceParamsSchema>;

/**
 * V20 — a journal row's `params`, as READ. Rows written before migration 026 lack the two tolerances;
 * they were found under the round-1 rule, so an absent tolerance reads as **0**, never as today's
 * default (a hit rate split by params would otherwise credit the new rule with the old signals).
 * The output type is `OiDivergenceParams`: what the API sends always carries both keys.
 */
export const OiDivergenceJournalParamsSchema = z.object({
  ...paramsShape,
  priceLineTolAtrMult: LineTolSchema.default(0),
  oiLineTolMedianMult: LineTolSchema.default(0),
});

/**
 * V5–V7's defaults: N = 6 on every TF (owner: "n > 5"), k = 3 (half of N), W = 24 h on 15m, **7 days
 * on 1h** (owner, round 2, V19; was 5), 15 days on 4h. Line tolerances 0.25 × ATR14 and 0.5 × the
 * median (owner, round 2, V18). **Starting values, not measured**: IB-111 / IB-114 report counts with
 * them and the owner judges. Migration 025 seeded round 1's values; 026 brings an untouched row to
 * exactly this (`migration-026.integration.spec.ts` compares the end of the chain with it).
 */
export const OI_DIVERGENCE_DEFAULT_PARAMS: OiDivergenceParams = {
  perTf: { '15m': { n: 6, k: 3, w: 96 }, '1h': { n: 6, k: 3, w: 168 }, '4h': { n: 6, k: 3, w: 90 } },
  atrMult: 0.25,
  oiMedianMult: 0.5,
  priceLineTolAtrMult: 0.25,
  oiLineTolMedianMult: 0.5,
};

// -------------------------------------------------------------------------------------------------
// A detected divergence, as a chart draws it (V11) and the journal stores it (V12)

/** One end of the line: the price pivot (bar open time, wick low/high) and the OI pivot paired with it. */
export const WebOiDivergencePointSchema = z.object({
  time: TimeSec,
  price: z.number().positive(),
  oiTime: TimeSec,
  /** OI in contracts (base units): the per-bar min for lows, the max for highs (V4). */
  oi: z.number().nonnegative(),
});
export type WebOiDivergencePoint = z.infer<typeof WebOiDivergencePointSchema>;

export const WebOiDivergenceLineSchema = z.object({
  direction: OiDivergenceDirectionSchema,
  a: WebOiDivergencePointSchema,
  b: WebOiDivergencePointSchema,
  /** When the pair at B was confirmed: the close of bar max(B price, B OI) + N. */
  confirmedAt: TimeSec,
  /** B against A, in percent: price (negative for a bullish one) and OI. */
  pricePct: z.number(),
  oiPct: z.number(),
  /**
   * V8: null for the first line of a run. A repeat (A–C after A–B) carries the run's length in
   * pivots (3 = «третий минимум подряд») and the B of the run's first line.
   */
  repeat: z.object({ runLength: z.number().int().min(3), firstBTime: TimeSec }).nullable(),
  /** V11: when this line was sent as an alert (from the journal); null when it never was. */
  firedAt: TimeSec.nullable(),
});
export type WebOiDivergenceLine = z.infer<typeof WebOiDivergenceLineSchema>;

/** V9: an evaluation skipped because the OI series had a hole that the venue did not cause. */
export const OI_DIVERGENCE_SKIP_REASONS = ['no_oi_data'] as const;
export const WebOiDivergenceSkipSchema = z.object({
  /** The bar whose pivot was being evaluated (B's price pivot). */
  barTime: TimeSec,
  reason: z.enum(OI_DIVERGENCE_SKIP_REASONS),
  /** The first missing 5 m slot and the last of the same hole. */
  holeFrom: TimeSec,
  holeTo: TimeSec,
});
export type WebOiDivergenceSkip = z.infer<typeof WebOiDivergenceSkipSchema>;

/** V11: `GET /api/web/series/oi-divergences?symbol&tf` — computed on open over the stored OI. */
export const WebOiDivergenceSeriesResponseSchema = z.object({
  symbol: z.string().min(1),
  tf: OiDivergenceTfSchema,
  /** The span the detector ran over: OI's coverage start (15m capped at 90 days) to now. */
  from: TimeSec,
  to: TimeSec,
  params: OiDivergenceParamsSchema,
  lines: z.array(WebOiDivergenceLineSchema),
  skips: z.array(WebOiDivergenceSkipSchema),
});
export type WebOiDivergenceSeriesResponse = z.infer<typeof WebOiDivergenceSeriesResponseSchema>;

// -------------------------------------------------------------------------------------------------
// The admin page (V17) and the journal (V12)

/** V2: a coin on the alert list. Binance USD-M symbol (`TRXUSDT`); not the universe's `symbols`. */
export const WebAlertSymbolSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9]{2,30}$/),
  base: z.string().min(1),
  enabled: z.boolean(),
  addedAt: TimeSec,
  /** Null for the coins migration 025 seeded. */
  addedBy: z.number().int().positive().nullable(),
});
export type WebAlertSymbol = z.infer<typeof WebAlertSymbolSchema>;

/** V13, V17: the one settings row. Both switches default OFF. */
export const WebAlertSettingsSchema = z.object({
  enabled: z.boolean(),
  membersVisible: z.boolean(),
  params: OiDivergenceParamsSchema,
  updatedBy: z.number().int().positive().nullable(),
  updatedAt: TimeSec,
});
export type WebAlertSettings = z.infer<typeof WebAlertSettingsSchema>;

/** V12: one journal row, late ones included (`late = true` were never sent). */
export const WebOiDivergenceAlertSchema = z.object({
  id: z.number().int().positive(),
  symbol: z.string().min(1),
  tf: OiDivergenceTfSchema,
  direction: OiDivergenceDirectionSchema,
  a: WebOiDivergencePointSchema,
  b: WebOiDivergencePointSchema,
  /** The run's first alert, for a repeat; null otherwise. */
  runOf: z.number().int().positive().nullable(),
  /** Pivots in the run: 2 for a first alert, 3 for «третий … подряд». */
  runLength: z.number().int().min(2),
  /**
   * The params this row was detected with: a hit rate is meaningless if they changed under it. Read
   * with V20's schema: a row from before 026 has tolerance 0.
   */
  params: OiDivergenceJournalParamsSchema,
  confirmedAt: TimeSec,
  firedAt: TimeSec.nullable(),
  late: z.boolean(),
  recipients: z.number().int().nonnegative(),
  priceAtFire: z.number().positive().nullable(),
  price4h: z.number().positive().nullable(),
  price24h: z.number().positive().nullable(),
  outcomeAt: TimeSec.nullable(),
});
export type WebOiDivergenceAlert = z.infer<typeof WebOiDivergenceAlertSchema>;

export const WebOiDivergenceSkipRowSchema = WebOiDivergenceSkipSchema.extend({
  symbol: z.string().min(1),
  tf: OiDivergenceTfSchema,
  /** When the loop logged it. */
  at: TimeSec,
});
export type WebOiDivergenceSkipRow = z.infer<typeof WebOiDivergenceSkipRowSchema>;

/** `/admin/alerts` (V17): everything the page shows in one read. */
export const WebAlertsAdminResponseSchema = z.object({
  settings: WebAlertSettingsSchema,
  symbols: z.array(WebAlertSymbolSchema),
  /** The last 50 journal rows, newest first. */
  alerts: z.array(WebOiDivergenceAlertSchema).max(50),
  skips: z.array(WebOiDivergenceSkipRowSchema).max(50),
});
export type WebAlertsAdminResponse = z.infer<typeof WebAlertsAdminResponseSchema>;
