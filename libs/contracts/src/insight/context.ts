import { z } from 'zod';

/**
 * architecture/insight-bot-web-dashboard.md §2, §4, §10 — the market-context page's two reads:
 * `GET /api/web/context/fear-greed` and `GET /api/web/context/market-cap`, both behind the
 * session guard.
 *
 * **Every derived share is computed at read time and never stored** (§10). The stored rows are
 * what the venues sent (`fear_greed`, `market_cap_global`, `market_cap_coin`); a ratio is a view
 * of them. Storing it would create a second truth that silently drifts when a coin enters or
 * leaves the top 20 — the denominator changes, and every historical row would have to be
 * rewritten to stay consistent.
 */

/** A UTC day, `YYYY-MM-DD` — the grain both of these series are published at. */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------------------------------------
// Fear & Greed (alternative.me, one value per UTC day, full history since 2018-02-01)
// ---------------------------------------------------------------------------------------------

export const WebFearGreedPointSchema = z.object({
  day: Day,
  value: z.number().int().min(0).max(100),
  /** The venue's own wording ("Extreme Fear", "Greed", …) — kept verbatim, never re-derived. */
  classification: z.string().min(1),
});
export type WebFearGreedPoint = z.infer<typeof WebFearGreedPointSchema>;

export const WebFearGreedResponseSchema = z.object({
  points: z.array(WebFearGreedPointSchema),
  /**
   * The newest point in the WHOLE series, even when the requested window ends earlier — the gauge
   * shows "today" and a range picker must not be able to make it lie by showing an old value as
   * current. Null only when nothing has ever been collected.
   */
  latest: WebFearGreedPointSchema.nullable(),
  /** True when the server thinned the points; the page says so rather than implying full grain. */
  downsampled: z.boolean(),
});
export type WebFearGreedResponse = z.infer<typeof WebFearGreedResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Market cap: global dominance (forward-collected) and the top-20 per-coin caps (365 days)
// ---------------------------------------------------------------------------------------------

/** One `/global` sample: BTC's share of the WHOLE market, as CoinGecko computes it. */
export const WebDominancePointSchema = z.object({
  /** ms UTC. */
  ts: z.number().int().nonnegative(),
  totalUsd: z.number(),
  /** Null when the venue omitted the coin from `market_cap_percentage` — never 0 (§10). */
  btcPct: z.number().nullable(),
  ethPct: z.number().nullable(),
});
export type WebDominancePoint = z.infer<typeof WebDominancePointSchema>;

/** One coin's slice of one day, as a fraction of Σ of the top-20 caps held for that day. */
export const WebCoinShareSchema = z.object({
  coin: z.string().min(1),
  capUsd: z.number().nullable(),
  /** 0..1 of Σ top-20 that day; null when this coin has no cap that day (it is not 0 % — §10). */
  share: z.number().min(0).max(1).nullable(),
});
export type WebCoinShare = z.infer<typeof WebCoinShareSchema>;

export const WebMarketCapDaySchema = z.object({
  day: Day,
  /** Σ of the top-20 caps held for this day — the denominator of every `share` in `coins`. */
  totalUsd: z.number(),
  /** How many of the top 20 actually had a cap that day: the denominator's honesty. */
  coinsCounted: z.number().int().nonnegative(),
  coins: z.array(WebCoinShareSchema),
  /** BTC's share of Σ top-20 — the ratio §10 asks for, which is NOT `/global`'s dominance. */
  btcShare: z.number().min(0).max(1).nullable(),
});
export type WebMarketCapDay = z.infer<typeof WebMarketCapDaySchema>;

/** The table row: where a coin stands now, and how it moved. */
export const WebMarketCapCurrentSchema = z.object({
  coin: z.string().min(1),
  capUsd: z.number().nullable(),
  priceUsd: z.number().nullable(),
  /** Fractional change, e.g. -0.031 for -3.1 %; null when the comparison day is not held. */
  change24h: z.number().nullable(),
  change7d: z.number().nullable(),
  share: z.number().min(0).max(1).nullable(),
});
export type WebMarketCapCurrent = z.infer<typeof WebMarketCapCurrentSchema>;

export const WebMarketCapResponseSchema = z.object({
  /** The stacked-share history: one entry per day held, oldest first. */
  days: z.array(WebMarketCapDaySchema),
  /** The current table, ordered by cap, largest first. */
  current: z.array(WebMarketCapCurrentSchema),
  /** `/global` samples in the window — the forward-collected dominance line. */
  dominance: z.array(WebDominancePointSchema),
  /**
   * The first `/global` sample ever stored. §10: that series is forward-only, because the
   * historical endpoint is paid — so the line has a real start date and the page must show it
   * rather than letting a reader assume the data goes back as far as the axis does.
   */
  dominanceStart: z.number().int().nonnegative().nullable(),
  downsampled: z.boolean(),
});
export type WebMarketCapResponse = z.infer<typeof WebMarketCapResponseSchema>;

// ---------------------------------------------------------------------------------------------
// The market CARDS (§12.1, ruling 2026-10-07: information cards, not charts)
// ---------------------------------------------------------------------------------------------

/**
 * One endpoint whose payload **is** what the cards show. The client renders it and derives nothing:
 * every figure arrives with its unit, the instant it was measured and the venue it came from,
 * because a number on a card with no stated basis is a confident claim that may be wrong
 * (the IB-BUG-011 lesson in its general form).
 *
 * Deltas are nullable on purpose and are *not* zero when unknown. `market_cap_global` is collected
 * forward only, so a young database genuinely cannot say what dominance did over 7 days — the card
 * says how long it has been collecting instead of inventing a move.
 */
export const WebCardSourceSchema = z.enum(['alternative.me', 'coingecko']);
export type WebCardSource = z.infer<typeof WebCardSourceSchema>;

export const WebFearGreedReadingSchema = z.object({
  day: Day,
  value: z.number().int().min(0).max(100),
  /** The venue's own wording, verbatim. */
  classification: z.string().min(1),
});
export type WebFearGreedReading = z.infer<typeof WebFearGreedReadingSchema>;

export const WebFearGreedCardSchema = z.object({
  now: WebFearGreedReadingSchema,
  /** The previous published day, for the card's sentence. Null when only one day is held. */
  previous: WebFearGreedReadingSchema.nullable().default(null),
  /** Seven published days back, when held. */
  weekAgo: WebFearGreedReadingSchema.nullable().default(null),
  source: WebCardSourceSchema,
});
export type WebFearGreedCard = z.infer<typeof WebFearGreedCardSchema>;

export const WebDominanceCardSchema = z.object({
  /** Percent of total market cap, as the venue reports it. */
  btcPct: z.number(),
  ethPct: z.number().nullable().default(null),
  /** Total market cap in USD at the same sample. */
  totalUsd: z.number().nullable().default(null),
  /** ms UTC of the sample these figures come from — never "now". */
  atMs: z.number().int(),
  changePct24h: z.number().nullable().default(null),
  changePct7d: z.number().nullable().default(null),
  totalChangePct24h: z.number().nullable().default(null),
  /**
   * Whole days of collection behind this series. The card says «данных пока за N дней» instead of a
   * delta it cannot compute: this series is forward-only and cannot be backfilled (§10).
   */
  coverageDays: z.number().int().nonnegative(),
  source: WebCardSourceSchema,
});
export type WebDominanceCard = z.infer<typeof WebDominanceCardSchema>;

export const WebBtcVsTopCardSchema = z.object({
  /** BTC's share of the top-20 caps actually held for `day` — not of the whole market. */
  sharePct: z.number(),
  day: Day,
  /**
   * The denominator, stated: how many of the top 20 had a cap that day. A share of three coins is
   * not a share of twenty, and a card that prints the percentage without this is wrong.
   */
  coinsCounted: z.number().int().nonnegative(),
  coinsExpected: z.number().int().nonnegative(),
  changePct7d: z.number().nullable().default(null),
  changePct30d: z.number().nullable().default(null),
  source: WebCardSourceSchema,
});
export type WebBtcVsTopCard = z.infer<typeof WebBtcVsTopCardSchema>;

export const WebMarketCardsResponseSchema = z.object({
  fearGreed: WebFearGreedCardSchema.nullable().default(null),
  dominance: WebDominanceCardSchema.nullable().default(null),
  btcVsTop: WebBtcVsTopCardSchema.nullable().default(null),
  /** The newest caps, largest first — the card's small table, not a series. */
  caps: z.array(WebMarketCapCurrentSchema).default([]),
  /** The day `caps` describes, so the table can say when it was measured. */
  capsDay: Day.nullable().default(null),
});
export type WebMarketCardsResponse = z.infer<typeof WebMarketCardsResponseSchema>;
