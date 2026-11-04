import { z } from 'zod';
import { WebMarketPeriodSchema } from './market';

/**
 * IB-091 (market-page design, phase 2, cut 2026-11-03) — «Деривативы и потоки»:
 * `GET /api/web/market/flows?period=`. Four tiles, each from a source that keeps its own history
 * (D7: cache only, no table of ours):
 * - DVOL — Deribit's BTC implied-volatility index, change over the period (R8);
 * - put/call by open interest — OKX rubik's daily series (a tile, no rule — the cut);
 * - stablecoin supply — DefiLlama's daily total, 1-day / 7-day change (R9);
 * - Coinbase premium — Coinbase BTC-USD against Binance BTCUSDT spot, minute by minute (R10).
 *
 * Every tile states why it is empty rather than being empty: `unavailable` is set exactly when
 * its figure is null. A rarity is the D2 percentile within the tile's own sample, `sample` its size.
 */
const TimeSec = z.number().int().nonnegative();

/**
 * `insufficient_minutes` (D18): the Coinbase premium had fewer than R10's 45 valid minutes in the
 * last hour (a minute is valid only with all three 1m closes). The premium tile may then still
 * show its value — WITH that reason instead of a sign; every other reason means no figure.
 */
export const WebFlowsUnavailableSchema = z.enum(['source_unavailable', 'insufficient_history', 'insufficient_minutes']);
export type WebFlowsUnavailable = z.infer<typeof WebFlowsUnavailableSchema>;

export const WebFlowsPointSchema = z.object({ time: TimeSec, value: z.number() });
export type WebFlowsPoint = z.infer<typeof WebFlowsPointSchema>;

/** A change with its D2 rarity: `rarity` null with `unavailable` when the sample is too thin. */
export const WebFlowsChangeSchema = z.object({
  value: z.number(),
  rarity: z.number().min(0).max(1).nullable(),
  sample: z.number().int().nonnegative(),
  /** Days of the source's history the sample spans. */
  sampleDays: z.number().nonnegative(),
});
export type WebFlowsChange = z.infer<typeof WebFlowsChangeSchema>;

export const WebFlowsSourceSchema = z.object({ name: z.string(), url: z.string().url() });

const tile = <T extends z.ZodRawShape>(shape: T) => z.object({
  ...shape,
  unavailable: WebFlowsUnavailableSchema.nullable(),
  source: WebFlowsSourceSchema,
});

/** DVOL: the index now (points ≈ annualised % implied vol), its change over the period, the series for the mini-chart. */
export const WebFlowsDvolSchema = tile({
  currency: z.literal('BTC'),
  value: z.number().nullable(),
  change: WebFlowsChangeSchema.nullable(),
  series: z.array(WebFlowsPointSchema),
});

/** Put/call by OI (and by volume), daily, OKX options. A tile only: no rule reads it (the cut). */
export const WebFlowsPutCallSchema = tile({
  currency: z.literal('BTC'),
  /** The latest day's put/call ratio by open interest. */
  oiRatio: z.number().nonnegative().nullable(),
  volumeRatio: z.number().nonnegative().nullable(),
  /** The day the ratios are for (UTC day start). */
  asOf: TimeSec.nullable(),
  series: z.array(WebFlowsPointSchema),
});

/**
 * Total supply of USD-pegged stablecoins IN COINS (each counted at its $1 peg — DefiLlama
 * `totalCirculating`, not coins × price: a de-peg must never read as a burn, TL 2026-11-04) and its
 * change over 1 day or 7 days (7 days for the 7d page).
 */
export const WebFlowsStablecoinsSchema = tile({
  supplyUsd: z.number().nonnegative().nullable(),
  /** 1 or 7: which change this is. */
  changeDays: z.union([z.literal(1), z.literal(7)]),
  changeUsd: WebFlowsChangeSchema.nullable(),
  changePct: z.number().nullable(),
  series: z.array(WebFlowsPointSchema),
});

/**
 * Coinbase premium (D18), % against the DOLLAR with USDT divided out:
 * CB BTC-USD ÷ (BN BTCUSDT × CB USDT-USD) − 1, per minute, only on minutes with all three closes —
 * never the raw difference. The mean of the last hour's valid minutes, how many of them had that
 * sign (sustained = most of the hour), and the minute series.
 */
export const WebFlowsCoinbasePremiumSchema = tile({
  premiumPct: WebFlowsChangeSchema.nullable(),
  /** Minutes in the last hour with the same sign as the mean, of `minutes`. */
  sameSignMinutes: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  series: z.array(WebFlowsPointSchema),
});

export const WebFlowsResponseSchema = z.object({
  period: WebMarketPeriodSchema,
  asOf: TimeSec,
  dvol: WebFlowsDvolSchema,
  putCall: WebFlowsPutCallSchema,
  stablecoins: WebFlowsStablecoinsSchema,
  coinbasePremium: WebFlowsCoinbasePremiumSchema,
}).superRefine((r, ctx) => {
  const check = (path: string, empty: boolean, unavailable: unknown) => {
    if (empty !== (unavailable !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path, 'unavailable'], message: `${path}: unavailable is set exactly when its figure is null` });
    }
  };
  check('dvol', r.dvol.value === null, r.dvol.unavailable);
  check('putCall', r.putCall.oiRatio === null, r.putCall.unavailable);
  check('stablecoins', r.stablecoins.supplyUsd === null, r.stablecoins.unavailable);
  // D18: the premium may carry a value WITH `insufficient_minutes`; without a value it needs a reason
  const p = r.coinbasePremium;
  if (p.premiumPct === null ? p.unavailable === null : p.unavailable !== null && p.unavailable !== 'insufficient_minutes') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['coinbasePremium', 'unavailable'], message: 'coinbasePremium: a null figure needs a reason; a figure may carry only insufficient_minutes' });
  }
  for (const [path, unavailable] of [['dvol', r.dvol.unavailable], ['putCall', r.putCall.unavailable], ['stablecoins', r.stablecoins.unavailable]] as const) {
    if (unavailable === 'insufficient_minutes') ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path, 'unavailable'], message: `${path}: insufficient_minutes is the premium's reason only` });
  }
});
export type WebFlowsResponse = z.infer<typeof WebFlowsResponseSchema>;
