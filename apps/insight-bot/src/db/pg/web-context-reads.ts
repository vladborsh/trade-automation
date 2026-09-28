import type { WebDominancePoint, WebFearGreedPoint } from '@trade-automation/contracts';
import type { CoinCapRow } from '../../web/context/market-shares';
import type { Db } from '../db.port';

/**
 * IB-037 — the market-context reads (SQL stays in `src/db/pg/`, IB-004's rule).
 *
 * These return **stored rows only**. Every ratio the page draws is derived from them at read time
 * by `web/context/market-shares.ts`, which is pure and spec'd; no share is computed in SQL, so
 * there is one implementation of "BTC's share of the top 20" rather than one here and one there.
 */

/** A `date` column comes back as a Date or a string depending on the driver's parser. */
function toDay(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** Fear & Greed points in `[fromDay, toDay]`, oldest first. */
export async function fearGreedBetween(db: Db, fromDay: string, toDay_: string): Promise<WebFearGreedPoint[]> {
  const rows = await db.query<{ day: Date | string; value: number; classification: string }>(
    `select day, value, classification from fear_greed where day between $1 and $2 order by day`,
    [fromDay, toDay_],
  );
  return rows.map((row) => ({ day: toDay(row.day), value: Number(row.value), classification: row.classification }));
}

/** The newest Fear & Greed point in the whole series, whatever window was asked for. */
export async function latestFearGreed(db: Db): Promise<WebFearGreedPoint | null> {
  const [row] = await db.query<{ day: Date | string; value: number; classification: string }>(
    `select day, value, classification from fear_greed order by day desc limit 1`,
  );
  return row ? { day: toDay(row.day), value: Number(row.value), classification: row.classification } : null;
}

/** `/global` samples in `[fromMs, toMs]`, oldest first — the forward-collected dominance line. */
export async function dominanceBetween(db: Db, fromMs: number, toMs: number): Promise<WebDominancePoint[]> {
  const rows = await db.query<{ ts: Date; total_usd: string | number; btc_pct: number | null; eth_pct: number | null }>(
    `select ts, total_usd, btc_pct, eth_pct from market_cap_global where ts between $1 and $2 order by ts`,
    [new Date(fromMs), new Date(toMs)],
  );
  return rows.map((row) => ({
    ts: row.ts.getTime(),
    totalUsd: Number(row.total_usd),
    // null means "the venue omitted this coin", never 0 (§10) — Number(null) would be 0.
    btcPct: row.btc_pct === null ? null : Number(row.btc_pct),
    ethPct: row.eth_pct === null ? null : Number(row.eth_pct),
  }));
}

/** When `/global` collection actually began: the page shows this rather than implying more. */
export async function dominanceStart(db: Db): Promise<number | null> {
  const [row] = await db.query<{ ts: Date }>(`select ts from market_cap_global order by ts limit 1`);
  return row ? row.ts.getTime() : null;
}

/** Per-coin caps in `[fromDay, toDay]` for `coins`, oldest first. */
export async function coinCapsBetween(db: Db, coins: readonly string[], fromDay: string, toDay_: string): Promise<CoinCapRow[]> {
  if (coins.length === 0) return [];
  const rows = await db.query<{ day: Date | string; coin: string; cap_usd: string | number | null; price_usd: string | number | null }>(
    `select day, coin, cap_usd, price_usd from market_cap_coin
      where coin = any($1::text[]) and day between $2 and $3
      order by day, coin`,
    [[...coins], fromDay, toDay_],
  );
  return rows.map((row) => ({
    day: toDay(row.day),
    coin: row.coin,
    capUsd: row.cap_usd === null ? null : Number(row.cap_usd),
    priceUsd: row.price_usd === null ? null : Number(row.price_usd),
  }));
}
