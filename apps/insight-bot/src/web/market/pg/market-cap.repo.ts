import type { DbHandle } from '../../../db/db.port';

/**
 * IB-118 — `market_cap_total` (migration 029): the total crypto market cap as we recorded it, one row
 * per CoinGecko refresh. SQL lives under a `pg/` directory (IB-004's rule).
 */
export interface MarketCapRow {
  /** CoinGecko's own `updated_at`, ms. */
  tsMs: number;
  totalUsd: number;
  /**
   * IB-130 (migration 030): BTC's and ETH's share of the total cap, PERCENT (0..100), from the same
   * `/global` payload. Each is independently null — absent or invalid in the payload, or a row written
   * before 030 (never backfilled: no source has them).
   */
  btcPct: number | null;
  ethPct: number | null;
}

/**
 * Writes one observation. Keyed on CoinGecko's `updated_at`: a second poll of the same refresh is the
 * same row, and the FIRST observation stands (its `fetched_at` says when we first saw it) — a re-read
 * of a cached or stale `/global` neither duplicates a row nor moves one. True when a row was added.
 */
export async function recordMarketCap(db: DbHandle, row: MarketCapRow, fetchedAt: Date): Promise<boolean> {
  const inserted = await db.query<{ ts: Date }>(
    `insert into market_cap_total (ts, total_usd, btc_pct, eth_pct, fetched_at) values ($1, $2, $3, $4, $5)
     on conflict (ts) do nothing returning ts`,
    [new Date(row.tsMs), row.totalUsd, row.btcPct, row.ethPct, fetchedAt],
  );
  return inserted.length > 0;
}

/**
 * The rows with `ts > sinceMs`, oldest first. ≤ 1 008 for a 7-day read at one row per 10 min. The cap
 * and both dominance shares come back in this one query (IB-130: no second read for the dominance tile).
 */
export async function marketCapSince(db: DbHandle, sinceMs: number): Promise<MarketCapRow[]> {
  const rows = await db.query<{ ts: Date; total_usd: number; btc_pct: number | null; eth_pct: number | null }>(
    'select ts, total_usd, btc_pct, eth_pct from market_cap_total where ts > $1 order by ts',
    [new Date(sinceMs)],
  );
  return rows.map((r) => ({
    tsMs: r.ts.getTime(),
    totalUsd: Number(r.total_usd),
    btcPct: r.btc_pct === null ? null : Number(r.btc_pct),
    ethPct: r.eth_pct === null ? null : Number(r.eth_pct),
  }));
}
