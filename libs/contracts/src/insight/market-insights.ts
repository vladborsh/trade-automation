import { z } from 'zod';
import { WebMarketPeriodSchema } from './market';

/**
 * IB-086 — «Главное сейчас»: server-side, rule-based statements (architecture/market-page-design
 * D1–D5, D15). The server sends `{ key, params, basis, rarity, link }`; the CLIENT words it (D4), so
 * every sentence key is listed here as an enum — a key the dashboard has no translation for fails
 * its build, not a member's screen.
 */
const TimeSec = z.number().int().nonnegative();

/** D15: the blocks a statement can belong to; each block ends with one conclusion line. */
export const WEB_INSIGHT_BLOCKS = ['liquidations', 'positioning', 'caps', 'flows', 'sentiment'] as const;
export const WebInsightBlockSchema = z.enum(WEB_INSIGHT_BLOCKS);
export type WebInsightBlock = z.infer<typeof WebInsightBlockSchema>;

/** D5 rule set v1. */
export const WEB_INSIGHT_RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'] as const;
export const WebInsightRuleSchema = z.enum(WEB_INSIGHT_RULES);

/**
 * The sentence keys and the params each carries (numbers/sides/symbols — never words):
 * - `insight.liq_surge`        R1 {side, usd, ratio}                 — market-wide liquidations of one side × norm
 * - `insight.liq_coin`         R2 {symbol, usd, ratio | null}        — the coin with the most unusual liquidations
 * - `insight.liq_cascade`      R3 {side, count, minutes, usd, symbol} — a series: N same-side events within M minutes
 * - `insight.oi_vs_price`      R4 {symbol, quadrant, oiPct, pricePct} — OI moved unusually while price did not
 * - `insight.funding_extremes` R5 {count, total, symbol, rate}        — coins with funding beyond their own p95/p5
 * - `insight.crowd_vs_top`     R6 {symbol, global, top}              — crowd and top traders on opposite sides
 * - `insight.breadth`          R7 {upPct, altGapPct, fngBand}         — share of coins up / alts vs BTC, with F&G
 * - `insight.neutral`          the block line when nothing passes      {} (the reason is a field, not a param)
 */
export const WEB_INSIGHT_KEYS = [
  'insight.liq_surge', 'insight.liq_coin', 'insight.liq_cascade', 'insight.oi_vs_price',
  'insight.funding_extremes', 'insight.crowd_vs_top', 'insight.breadth', 'insight.neutral',
] as const;
export const WebInsightKeySchema = z.enum(WEB_INSIGHT_KEYS);
export type WebInsightKey = z.infer<typeof WebInsightKeySchema>;

/** D3: what a statement stands on. The client renders it ("за 24ч · Binance+Bybit+OKX · норма: 30 дн., 22 из 30"). */
export const WebInsightBasisSchema = z.object({
  window: WebMarketPeriodSchema,
  venues: z.array(z.string()),
  /** Windows in the reference sample. */
  sampleWindows: z.number().int().nonnegative(),
  /** Of them, how many hold data (for liquidations: any event) — the honest denominator. */
  observedWindows: z.number().int().nonnegative(),
  /** Where the reference sample starts. */
  from: TimeSec.nullable(),
});
export type WebInsightBasis = z.infer<typeof WebInsightBasisSchema>;

/** D4: where a statement points — the instrument at a moment, or a block of the page. */
export const WebInsightLinkSchema = z.union([
  z.object({ route: z.literal('instrument'), symbol: z.string(), timeSec: TimeSec.nullable() }),
  z.object({ anchor: WebInsightBlockSchema }),
]);

export const WebInsightStatementSchema = z.object({
  ruleId: WebInsightRuleSchema,
  block: WebInsightBlockSchema,
  key: WebInsightKeySchema,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  /** D2: empirical percentile in the rule's own sample; only ≥ 0.90 is ever sent. */
  rarity: z.number().min(0).max(1),
  /** The rule's size for tie-breaking (USD, ×norm, %): ranks after rarity. */
  magnitude: z.number(),
  basis: WebInsightBasisSchema,
  link: WebInsightLinkSchema,
});
export type WebInsightStatement = z.infer<typeof WebInsightStatementSchema>;

/**
 * D15: one line per block — its best statement, or a neutral line saying WHY there is none:
 * `nothing_unusual` (rules ran on a sufficient basis and nothing passed), `insufficient_history`
 * (the block's rules refused for a thin basis — e.g. liquidations in the box's first week), or
 * `no_rules` (phase 2: caps and flows have none yet).
 */
export const WebInsightBlockLineSchema = z.object({
  block: WebInsightBlockSchema,
  statement: WebInsightStatementSchema.nullable(),
  neutral: z.object({
    key: z.literal('insight.neutral'),
    reason: z.enum(['nothing_unusual', 'insufficient_history', 'no_rules']),
    basis: WebInsightBasisSchema.nullable(),
  }).nullable(),
});
export type WebInsightBlockLine = z.infer<typeof WebInsightBlockLineSchema>;

export const WebInsightsResponseSchema = z.object({
  period: WebMarketPeriodSchema,
  asOf: TimeSec,
  /** At most 5, ranked by rarity then |magnitude|. */
  top: z.array(WebInsightStatementSchema).max(5),
  /** Always five, in `WEB_INSIGHT_BLOCKS` order. */
  blocks: z.array(WebInsightBlockLineSchema).length(WEB_INSIGHT_BLOCKS.length),
});
export type WebInsightsResponse = z.infer<typeof WebInsightsResponseSchema>;
