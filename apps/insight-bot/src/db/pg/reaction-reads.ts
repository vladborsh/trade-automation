import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';
import type { Horizon } from '../../news/reaction';

/**
 * IB-027 — the reads behind `news_reactions`. SQL lives in `src/db/pg/` (IB-004).
 *
 * IB-097: the PRICE reads are gone from here. Reactions take their prices from Binance 1m klines on
 * demand (`news/reaction-prices.ts`); what stays is news-only SQL. `PriceScope` stays as the
 * venue / market / spelling stamp the stored row carries.
 */

export interface PriceScope {
  /** The venue's own spelling, from `venueSpellings` — never the canonical id. */
  spelling: string;
  venue: string;
  market: Market;
}

/**
 * How many OTHER tagged stories for this symbol have their anchor inside the window.
 *
 * Anchored on `fetched_at`, matching the reaction's default anchor: the question is how many
 * stories we *became aware of* during the window, since those are what could have moved the price
 * alongside this one.
 */
export async function othersInWindow(
  db: Db,
  symbol: string,
  newsId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `select count(*) n
       from news_assets a
       join raw_news n on n.id = a.news_id
      where a.symbol = $1 and a.news_id <> $2
        and n.fetched_at >= $3 and n.fetched_at < $4`,
    [symbol, newsId, from, to],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface PendingReaction {
  newsId: string;
  symbol: string;
  publishedAt: Date;
  firstSeenAt: Date;
}

/**
 * Tagged articles whose reaction for `horizon` is missing or still refused as an open window.
 *
 * A refusal is deliberately re-offered: `window_not_closed` is the one refusal that time alone
 * resolves, so the row is replaced by a measurement on a later pass. Every other refusal stands —
 * re-running them would churn rows that nothing can fix.
 */
export async function pendingReactions(
  db: Db,
  horizon: Horizon,
  limit = 500,
): Promise<PendingReaction[]> {
  const rows = await db.query<{ news_id: string; symbol: string; published_at: Date; fetched_at: Date }>(
    `select a.news_id, a.symbol, n.published_at, n.fetched_at
       from news_assets a
       join raw_news n on n.id = a.news_id
       left join news_reactions r
              on r.news_id = a.news_id and r.symbol = a.symbol and r.horizon = $1
      where r.news_id is null or r.refused = 'window_not_closed'
      order by n.fetched_at
      limit $2`,
    [horizon, limit],
  );
  return rows.map((r) => ({
    newsId: r.news_id,
    symbol: r.symbol,
    publishedAt: new Date(r.published_at),
    firstSeenAt: new Date(r.fetched_at),
  }));
}

/** Stores a reaction, replacing an earlier row for the same (news, symbol, horizon). */
export async function saveReaction(
  db: Db,
  newsId: string,
  symbol: string,
  scope: PriceScope,
  reaction: {
    horizon: Horizon;
    anchor: string;
    anchorAt: Date;
    anchorSkewSec: number;
    returnPct: number | null;
    refused: string | null;
    othersInWindow: number;
    ofWindowItems: number;
  },
): Promise<void> {
  await db.query(
    `insert into news_reactions
       (news_id, symbol, horizon, anchor, anchor_at, anchor_skew_sec, venue, market, symbol_spelling,
        return_pct, refused, others_in_window, of_window_items, computed_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     on conflict (news_id, symbol, horizon) do update set
       anchor = excluded.anchor, anchor_at = excluded.anchor_at,
       anchor_skew_sec = excluded.anchor_skew_sec,
       venue = excluded.venue, market = excluded.market, symbol_spelling = excluded.symbol_spelling,
       return_pct = excluded.return_pct, refused = excluded.refused,
       others_in_window = excluded.others_in_window, of_window_items = excluded.of_window_items,
       computed_at = now()`,
    [
      newsId, symbol, reaction.horizon, reaction.anchor, reaction.anchorAt, reaction.anchorSkewSec,
      scope.venue, scope.market, scope.spelling,
      reaction.returnPct, reaction.refused, reaction.othersInWindow, reaction.ofWindowItems,
    ],
  );
}
