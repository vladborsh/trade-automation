import { UniverseFile } from '../config/universe.schema';
import { DbHandle } from './db.port';

export interface UniverseSyncResult {
  /** Rows inserted or updated by this run — i.e. every symbol in the file. */
  upserted: number;
  /** Ids that were in `symbols` but are no longer in the file, and were deactivated. */
  deactivated: string[];
}

/**
 * architecture/insight-bot-system-design.md §3.2 — `symbols` is "loaded from universe.yaml on
 * boot". Idempotent: one `INSERT … ON CONFLICT (id) DO UPDATE` per symbol (§3.1's rule for
 * every write), so a boot with an unchanged file is a no-op in effect.
 *
 * A symbol that leaves the file is **deactivated, never deleted** — the market data, features
 * and signals already collected for it reference it, and the archive backfill keeps its
 * history. `active = false` is what the collectors read (§4).
 */
export async function syncUniverse(db: DbHandle, universe: UniverseFile): Promise<UniverseSyncResult> {
  const signalSet = new Set(universe.signal_set);
  for (const [index, s] of universe.symbols.entries()) {
    // IB-031: the file is ordered by 30-day quote volume by construction, so position IS the
    // rank unless the revision states one. Derived rather than hand-maintained, so the order
    // the file reads in and the order the picker shows can never disagree.
    const volumeRank = s.volume_rank ?? index + 1;
    await db.query(
      `insert into symbols (id, base, quote, binance_perp, binance_spot, bybit_linear, okx_swap,
                            listed_perp, in_signal_set, active, volume_rank, coingecko_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
       on conflict (id) do update set
         base          = excluded.base,
         quote         = excluded.quote,
         binance_perp  = excluded.binance_perp,
         binance_spot  = excluded.binance_spot,
         bybit_linear  = excluded.bybit_linear,
         okx_swap      = excluded.okx_swap,
         listed_perp   = excluded.listed_perp,
         in_signal_set = excluded.in_signal_set,
         active        = true,
         volume_rank   = excluded.volume_rank,
         coingecko_id  = excluded.coingecko_id`,
      [
        s.id,
        s.base,
        s.quote,
        s.binance_perp,
        s.binance_spot ?? null,
        s.bybit_linear ?? null,
        s.okx_swap ?? null,
        s.listed_perp,
        signalSet.has(s.id),
        volumeRank,
        s.coingecko_id ?? null,
      ],
    );
  }

  const ids = universe.symbols.map((s) => s.id);
  const deactivated = await db.query<{ id: string }>(
    `update symbols set active = false, in_signal_set = false
      where active and not (id = any($1::text[]))
      returning id`,
    [ids],
  );
  return { upserted: universe.symbols.length, deactivated: deactivated.map((r) => r.id) };
}
