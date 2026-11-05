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

/** D5 rule set v1; R8–R10 are phase 2's «Деривативы и потоки» (IB-091); R11 the OI divergence alert (IB-113, V16). */
export const WEB_INSIGHT_RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11'] as const;
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
 * - `insight.dvol_spike`       R8 {value, change}                     — BTC implied vol (DVOL) rose unusually over the period
 * - `insight.stablecoin_supply` R9 {usd, pct, days}                  — total stablecoin supply moved unusually in 1 or 7 days
 * - `insight.coinbase_premium` R10 {pct, minutes}                    — Coinbase BTC held a premium / discount most of the last hour
 * - `insight.oi_divergence`    R11 {symbol, tf, direction, kind, pricePct, oiPct, runLength} — the newest on-time OI divergence alert of the last 24 h (IB-113; `kind` regular | hidden since IB-144, V44)
 * - `insight.neutral`          the block line when nothing passes      {} (the reason is a field, not a param)
 */
export const WEB_INSIGHT_KEYS = [
  'insight.liq_surge', 'insight.liq_coin', 'insight.liq_cascade', 'insight.oi_vs_price',
  'insight.funding_extremes', 'insight.crowd_vs_top', 'insight.breadth',
  'insight.dvol_spike', 'insight.stablecoin_supply', 'insight.coinbase_premium', 'insight.oi_divergence', 'insight.neutral',
] as const;
export const WebInsightKeySchema = z.enum(WEB_INSIGHT_KEYS);
export type WebInsightKey = z.infer<typeof WebInsightKeySchema>;

/**
 * IB-BUG-028 — where a block's rules read from, so a line can say WHICH source it could not read:
 * `tape` is our own liquidation tape (Postgres); the rest are venues and data providers by name.
 */
export const WEB_INSIGHT_SOURCES = ['tape', 'binance', 'deribit', 'defillama', 'coinbase'] as const;
export const WebInsightSourceSchema = z.enum(WEB_INSIGHT_SOURCES);
export type WebInsightSource = z.infer<typeof WebInsightSourceSchema>;

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

/**
 * IB-119 (market round 2 §3) — the chart beside a «Главное сейчас» card: a real chart with an axis, a
 * reference line, a named span and the current value, replacing IB-107's 30-value spark (owner:
 * «не информативная инфографика»). Built by the server AFTER ranking, only for the statements the page
 * shows. Times are epoch seconds; values are in `unit`, already scaled for display:
 * - `pct`   percent (`-0.0332` is −0.0332 %): funding, OI/price change, Coinbase premium;
 * - `usd`   dollars: liquidations, stablecoin supply;
 * - `ratio` a plain ratio: long/short;
 * - `share` percent of coins, 0–100: breadth;
 * - `index` index points: DVOL.
 */
export const WEB_INSIGHT_CHART_KINDS = ['bars', 'lines', 'bars_mirror'] as const;
export const WEB_INSIGHT_CHART_UNITS = ['pct', 'usd', 'ratio', 'share', 'index'] as const;
/**
 * What a series is, so the client can name it in the legend: `long` / `short` liquidations (in
 * `bars_mirror` the FIRST series is drawn above zero, the second below — the page's convention, shorts
 * above), a coin's liquidations `usd`, `price` and `oi` (R4/R11: % from the first point), `funding`,
 * `ls_global` / `ls_top`, `up_share`, `dvol`, `stablecoins`, `premium`.
 */
export const WEB_INSIGHT_CHART_SERIES = [
  'long', 'short', 'usd', 'price', 'oi', 'funding', 'ls_global', 'ls_top', 'up_share', 'dvol', 'stablecoins', 'premium',
] as const;
/** The schema refuses a longer series: ≤ 2 × 300 points bounds a chart (≈ 10 per period response). */
export const WEB_INSIGHT_CHART_MAX_POINTS = 300;

const SpanSchema = z.object({ from: TimeSec, to: TimeSec }).refine((s) => s.from <= s.to, { message: 'from after to' });

export const WebInsightChartPointSchema = z.object({ time: TimeSec, value: z.number().finite() });
export type WebInsightChartPoint = z.infer<typeof WebInsightChartPointSchema>;

export const WebInsightChartSeriesSchema = z.object({
  key: z.enum(WEB_INSIGHT_CHART_SERIES),
  points: z.array(WebInsightChartPointSchema).min(1).max(WEB_INSIGHT_CHART_MAX_POINTS),
});
export type WebInsightChartSeries = z.infer<typeof WebInsightChartSeriesSchema>;

export const WebInsightChartSchema = z.object({
  kind: z.enum(WEB_INSIGHT_CHART_KINDS),
  unit: z.enum(WEB_INSIGHT_CHART_UNITS),
  /** The reference line: 0, 1.0 (L/S), 50 (breadth); null when the rule has none (R9's supply level). */
  ref: z.number().finite().nullable(),
  /**
   * The shaded "normal" strip, from THE SAME sample the rule's rarity used (R2, R5): a value outside it
   * is exactly a value the rule calls rare. Null when the rule measured no level band.
   */
  band: z.object({ lo: z.number().finite(), hi: z.number().finite() }).refine((b) => b.lo <= b.hi, { message: 'lo above hi' }).nullable(),
  /** One or two series (`bars_mirror` and `lines` with two: price/OI, crowd/top). */
  series: z.array(WebInsightChartSeriesSchema).min(1).max(2),
  /**
   * What the statement is about, as a time range (a single moment is `from === to`): the current hour
   * (R1), the cascade's minutes (R3), A … B of an OI divergence (R11), "now" (R2, R5). Null: nothing.
   */
  highlight: SpanSchema.nullable(),
  /** Moments marked on every line: R11's pivots A and B. Empty for every other rule. */
  marks: z.array(TimeSec).max(2),
  /** The x axis: the time range the chart covers, named on the axis («30д … сейчас»). */
  span: SpanSchema,
});
export type WebInsightChart = z.infer<typeof WebInsightChartSchema>;

export const WebInsightStatementSchema = z.object({
  ruleId: WebInsightRuleSchema,
  block: WebInsightBlockSchema,
  key: WebInsightKeySchema,
  params: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
  /**
   * D2: empirical percentile in the rule's own sample; only ≥ 0.90 is ever sent. **R11 sends 1**: an
   * OI divergence is an EVENT, not a percentile (OI divergence design V16) — the 1 only ranks it first,
   * and the rarity value is never rendered.
   */
  rarity: z.number().min(0).max(1),
  /** The rule's size for tie-breaking (USD, ×norm, %): ranks after rarity. */
  magnitude: z.number(),
  basis: WebInsightBasisSchema,
  link: WebInsightLinkSchema,
  /**
   * IB-119: the card's chart, built after ranking for the statements shown. Null is honest: the
   * series could not be read, or the statement is not displayed (the rules themselves emit null).
   */
  chart: WebInsightChartSchema.nullable(),
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
    // IB-091 (D18): R10 refuses with insufficient_minutes when the premium had < 45 valid minutes.
    // IB-BUG-028: source_unavailable — every rule of the block refused because its source did not
    // answer: the rules could not LOOK, which is not «nothing unusual».
    reason: z.enum(['nothing_unusual', 'insufficient_history', 'insufficient_minutes', 'source_unavailable', 'no_rules']),
    basis: WebInsightBasisSchema.nullable(),
    /** IB-BUG-028: the sources that did not answer — set exactly when the reason is `source_unavailable`. */
    sources: z.array(WebInsightSourceSchema).min(1).optional(),
  }).superRefine((n, ctx) => {
    if ((n.reason === 'source_unavailable') !== (n.sources !== undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sources'], message: 'sources is set exactly when the reason is source_unavailable' });
    }
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
