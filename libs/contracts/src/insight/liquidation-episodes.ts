import { z } from 'zod';
import { WebLiquidationsLargeQuerySchema } from './liquidations-large';

/** Unix seconds; module-private, as in every insight contract module. */
const TimeSec = z.number().int().nonnegative();
const Usd = z.number().nonnegative();

/**
 * IB-133 (architecture/liquidation-episodes-design-2026-11-05.md E1–E8) —
 * `GET /api/web/liquidations/episodes`, the /liquidations page as «episodes».
 *
 * An **episode** is a run of liquidation prints, each ≥ $100K, all on one side, market-wide (every
 * crypto coin, every venue we collect), neighbours less than 180 s apart (E1). It is shown only when
 * its sum clears the norm `T` (E2): the level the trailing ≤ 30 days would have cleared about 7.5
 * times a week, never below $1M. Episodes are computed once per period over the whole market and
 * filtered after, so a filter never splits one (E5).
 */

/** E3: at most this many cards per period, the largest by sum; the rest are counted in `folded`. */
export const WEB_LIQUIDATION_EPISODES_CAP = { '24h': 5, '7d': 10 } as const;

/** E6: at most this many prints per episode, the largest first, after the `minUsd` filter. */
export const WEB_LIQUIDATION_EPISODE_PRINTS = 20;

/**
 * The query: the SAME parsing as `/large` (period, symbol, minUsd, side, venue; closed sets except
 * the coin; an unknown value is a 400). `minUsd` applies to `prints` only — it never changes which
 * episodes exist (E5).
 */
export const WebLiquidationEpisodesQuerySchema = WebLiquidationsLargeQuerySchema;
export type WebLiquidationEpisodesQuery = z.output<typeof WebLiquidationEpisodesQuerySchema>;

/**
 * E2: the norm. `ready` once the tape has held at least a day: `T = max($1M, the k-th largest
 * candidate sum over the trailing heldDays)`, `k = max(1, round(targetPerWeek × heldDays / 7))`.
 * `collecting` under a day: no episodes, the page shows the flat list and «копим историю: {h} ч».
 */
export const WebLiquidationEpisodeNormSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    thresholdUsd: Usd,
    /** The norm window in days (≤ 30), one decimal. Under 7 the page says «норма по {d} дн.». */
    heldDays: z.number().nonnegative(),
    k: z.number().int().positive(),
    targetPerWeek: z.number().positive(),
  }),
  z.object({
    status: z.literal('collecting'),
    /** Whole hours of tape held so far (< 24). */
    collectingHours: z.number().int().nonnegative(),
  }),
]);
export type WebLiquidationEpisodeNorm = z.infer<typeof WebLiquidationEpisodeNormSchema>;

/**
 * E8: the price path of the episode's largest coin — Binance perp 1-minute CLOSES from
 * `from − 60 min` to `to + 240 min`, closed minutes only. Facts about the past, no forecast (D20).
 */
export const WebLiquidationEpisodePriceSchema = z.object({
  /** The Binance perp symbol the closes are of (`BTCUSDT`); the same coin as `coins[0]`. */
  symbol: z.string(),
  points: z.array(z.object({ time: TimeSec, close: z.number().positive() })),
  /** The open of `from`'s minute — «во время: {startOpen} → {endClose}». */
  startOpen: z.number().positive(),
  /** The close of `to`'s minute. */
  endClose: z.number().positive(),
  /** The close of the minute at `to + 4 h`; null until that minute has closed («ещё не прошло»). */
  after4hClose: z.number().positive().nullable(),
});
export type WebLiquidationEpisodePrice = z.infer<typeof WebLiquidationEpisodePriceSchema>;

export const WebLiquidationEpisodeSchema = z.object({
  /** `${side}-${from}`: stable while the episode exists. */
  id: z.string(),
  side: z.enum(['long', 'short']),
  /** The first print's time. */
  from: TimeSec,
  /** The last print's time (= `from` for a single print). */
  to: TimeSec,
  count: z.number().int().positive(),
  usd: Usd,
  /**
   * Every coin of the episode, by canonical symbol across venues (aliases folded in, IB-BUG-025),
   * largest first. An unmapped venue symbol is its own coin, as on the flat list.
   */
  coins: z.array(z.object({ base: z.string(), symbol: z.string(), usd: Usd })).min(1),
  /** Each venue's share of `usd` in whole percent, largest remainder, summing to exactly 100. */
  venues: z.array(z.object({ venue: z.string(), pct: z.number().int().min(0).max(100) })).min(1),
  /** USD per minute of the episode (minute start, sec), oldest first; minutes with no print are absent. */
  perMinute: z.array(z.object({ time: TimeSec, usd: Usd })).min(1),
  /** Null when the coin has no Binance perp in the universe or the read failed (soft: «нет цены»). */
  price: WebLiquidationEpisodePriceSchema.nullable(),
  /** At most 20, largest first, at or above the query's `minUsd`; may be empty («нет ликвидаций от $1M»). */
  prints: z.array(z.object({ time: TimeSec, base: z.string(), venue: z.string(), usd: Usd })).max(WEB_LIQUIDATION_EPISODE_PRINTS),
}).superRefine((e, ctx) => {
  if (e.to < e.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to cannot precede from' });
  if (e.id !== `${e.side}-${e.from}`) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['id'], message: 'id must be `${side}-${from}`' });
  const pct = e.venues.reduce((s, v) => s + v.pct, 0);
  if (pct !== 100) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['venues'], message: `venue shares must sum to 100, got ${pct}` });
});
export type WebLiquidationEpisode = z.infer<typeof WebLiquidationEpisodeSchema>;

export const WebLiquidationEpisodesResponseSchema = z.object({
  asOf: TimeSec,
  /** The filters this answer is for, defaults filled in (a page drops an answer for filters it has left). */
  query: WebLiquidationEpisodesQuerySchema,
  norm: WebLiquidationEpisodeNormSchema,
  /**
   * Over every episode ≥ T that passes the side/coin/venue filters, BEFORE the cap (E4).
   * `largestId` is the largest by sum, always among `episodes` when not null.
   */
  summary: z.object({
    count: z.number().int().nonnegative(),
    shorts: z.number().int().nonnegative(),
    longs: z.number().int().nonnegative(),
    largestId: z.string().nullable(),
  }),
  /** At most 5 (24h) / 10 (7d), by `usd` desc. Empty while the norm is collecting. */
  episodes: z.array(WebLiquidationEpisodeSchema),
  /** Episodes ≥ T that pass the filters but are not shown: `summary.count − episodes.length`. */
  folded: z.number().int().nonnegative(),
}).superRefine((r, ctx) => {
  const cap = WEB_LIQUIDATION_EPISODES_CAP[r.query.period];
  if (r.episodes.length > cap) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['episodes'], message: `at most ${cap} episodes for ${r.query.period}` });
  if (r.summary.count !== r.episodes.length + r.folded) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['folded'], message: 'summary.count must equal episodes.length + folded' });
  }
  if (r.summary.shorts + r.summary.longs !== r.summary.count) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary'], message: 'shorts + longs must equal count' });
  }
  for (let i = 1; i < r.episodes.length; i += 1) {
    if ((r.episodes[i] as { usd: number }).usd > (r.episodes[i - 1] as { usd: number }).usd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['episodes', i], message: 'episodes must be ordered by usd desc' });
      break;
    }
  }
  if (r.summary.largestId !== (r.episodes[0]?.id ?? null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['summary', 'largestId'], message: 'largestId must be the first episode' });
  }
  if (r.norm.status === 'collecting' && r.summary.count > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['norm'], message: 'no episodes while the norm is collecting' });
  }
  if (r.norm.status === 'ready') {
    const t = r.norm.thresholdUsd;
    if (r.episodes.some((e) => e.usd < t)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['episodes'], message: 'every episode clears thresholdUsd' });
  }
});
export type WebLiquidationEpisodesResponse = z.infer<typeof WebLiquidationEpisodesResponseSchema>;
