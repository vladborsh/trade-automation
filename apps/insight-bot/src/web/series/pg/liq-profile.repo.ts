import type { LiqProfileGroup } from '@trade-automation/contracts';
import type { Db } from '../../../db/db.port';

/**
 * IB-153 — the liquidation profile's read: every liquidation of the coin in [from, to), all venues,
 * grouped in Postgres by (price band, side, venue). Nothing is thinned or capped before grouping, so the
 * bands are the whole tape's, never a top-N.
 *
 * - **Banded in SQL**, `floor(price / step)` on `numeric` (exact: a print on an edge goes to the band
 *   above, as `bandOf` in the contract does). `step` is passed as its decimal text, never as a float.
 * - **Clamped to the cover ± 1**, so a mispriced print far away cannot multiply the groups: everything
 *   below lands in `coverLo − 1`, everything above in `coverHi`, which `foldProfile` sums as below/above.
 *   At most (cover bands + 2) × 2 sides × 3 venues rows come back.
 * - **Matched per (venue, its own spelling) pair**, as an OR of `venue = … and symbol = …`: exact (one
 *   venue's spelling never matches another venue's rows), and each pair is a range on the
 *   `(venue, symbol, ts, …)` unique key, so the planner BitmapOrs three index scans instead of seq-scanning
 *   the month partition (EXPLAIN on a box-tape copy, 2026-11-06, one probe of three runs).
 */
export async function liqProfileGroups(
  db: Db,
  q: { pairs: ReadonlyArray<{ venue: string; symbol: string }>; fromMs: number; toMs: number; stepText: string; coverLo: number; coverHi: number },
): Promise<LiqProfileGroup[]> {
  if (q.pairs.length === 0) return [];
  const params: unknown[] = [new Date(q.fromMs), new Date(q.toMs), q.stepText, q.coverLo, q.coverHi];
  const match = q.pairs.map(({ venue, symbol }) => {
    params.push(venue, symbol);
    return `(venue = $${params.length - 1} and symbol = $${params.length})`;
  }).join(' or ');
  const rows = await db.query<{ band: string; side: 'long' | 'short'; venue: string; usd: string; n: string }>(
    `select greatest(least(floor(price / $3::numeric), $5::numeric), $4::numeric - 1)::bigint as band,
            side, venue,
            sum(coalesce(notional, price * qty)) as usd,
            count(*) as n
       from liquidations
      where (${match}) and ts >= $1 and ts < $2
      group by 1, 2, 3`,
    params,
  );
  return rows.map((r) => ({ band: Number(r.band), side: r.side, venue: r.venue, usd: Number(r.usd), count: Number(r.n) }));
}

/**
 * The coin's symbol on each venue (IB-BUG-011: each venue's own spelling), null where the venue does not
 * list it. Empty when the coin is unknown.
 */
export async function venueSymbols(db: Db, symbolId: string): Promise<Record<'binance' | 'bybit' | 'okx', string | null> | null> {
  const rows = await db.query<{ binance_perp: string | null; bybit_linear: string | null; okx_swap: string | null }>(
    `select binance_perp, bybit_linear, okx_swap from symbols where id = $1`,
    [symbolId],
  );
  const row = rows[0];
  if (!row) return null;
  const listed = (s: string | null) => (s !== null && s.length > 0 ? s : null);
  return { binance: listed(row.binance_perp), bybit: listed(row.bybit_linear), okx: listed(row.okx_swap) };
}
