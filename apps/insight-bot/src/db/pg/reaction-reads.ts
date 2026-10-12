import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';
import type { Horizon } from '../../news/reaction';

/**
 * IB-027 — the reads behind `news_reactions`. SQL lives in `src/db/pg/` (IB-004).
 *
 * Every function here is scoped to **one venue, one market and that venue's own spelling**. The
 * asset tag is a canonical symbol and the price tables hold each venue's spelling, so a read
 * matching the canonical string is IB-BUG-011 for a third time.
 */

export interface PriceScope {
  /** The venue's own spelling, from `venueSpellings` — never the canonical id. */
  spelling: string;
  venue: string;
  market: Market;
}

/**
 * The last close at or before `at`, in that venue's own series.
 *
 * At-or-before rather than nearest: a reaction anchored at 12:00:30 must use the 12:00 bar, not the
 * 12:01 one, or the "before" price already contains part of the move being measured.
 */
export async function closeAtOrBefore(db: Db, scope: PriceScope, at: Date): Promise<number | null> {
  const rows = await db.query<{ close: string }>(
    `select close
       from candles_1m
      where venue = $1 and market = $2 and symbol = $3 and open_time <= $4
      order by open_time desc
      limit 1`,
    [scope.venue, scope.market, scope.spelling, at],
  );
  return rows.length === 0 ? null : Number(rows[0].close);
}

export interface WindowCoverage {
  /** Bars actually stored inside the window, for this venue and market. */
  present: number;
  /** Bars the window should contain: one per minute. */
  expected: number;
  covered: boolean;
}

/**
 * Whether the price series itself is whole across the window, **for this venue and market**.
 *
 * This counts the bars the reaction will actually read rather than consulting a global coverage
 * figure, which makes it per-venue by construction: a window covered on Bybit cannot vouch for one
 * measured on OKX. It also subsumes the collector's own gap records — a recorded gap means missing
 * bars, and an unrecorded hole still shows up here — so the check cannot pass on the strength of
 * bookkeeping that happens to be clean.
 *
 * Binance publishes a kline per minute whether or not anything traded, so `expected` is simply the
 * window's minutes; a venue that omits empty minutes would need its own rule, and none of the three
 * we collect does.
 */
export async function windowCoverage(
  db: Db,
  scope: PriceScope,
  from: Date,
  to: Date,
): Promise<WindowCoverage> {
  const expected = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const rows = await db.query<{ n: string }>(
    `select count(*) n
       from candles_1m
      where venue = $1 and market = $2 and symbol = $3
        and open_time >= $4 and open_time < $5`,
    [scope.venue, scope.market, scope.spelling, from, to],
  );
  const present = Number(rows[0]?.n ?? 0);
  return { present, expected, covered: expected > 0 && present >= expected };
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
