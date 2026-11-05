import type { Db } from '../../../db/db.port';
import type { EpisodePrint } from '../episodes.group';
import { keysFilter, keysParams, mapCte, type SymbolAlias } from './overview.repo';

/**
 * IB-133 — the prints episodes (and their norm) are grouped from: crypto (D6 keys, IB-BUG-025
 * aliases, the Market block's population), ≥ `minUsd`, with the tape's exact timestamps (the 180 s
 * gap is measured in ms, not on rounded seconds).
 *
 * **COIN-M is excluded in the query itself** (IB-BUG-039): migration 022's two patterns, verbatim.
 * The box has no such rows and ingest skips them since IB-BUG-018, but a database that missed 022
 * or ran a pre-fix dist (insight_coord did) holds `BTCUSD_PERP` prints priced ~758× too high; one of
 * them would set the norm on its own. A spec reads 022's file and pins these strings to it.
 */
export const COIN_M_PATTERNS = ['^[A-Z0-9]+USD_(PERP|[0-9]{6})$', '^[A-Z0-9]+(BTC|ETH|BNB)$'] as const;

const NOT_COIN_M = `not (l.venue = 'binance' and (l.symbol ~ '${COIN_M_PATTERNS[0]}' or l.symbol ~ '${COIN_M_PATTERNS[1]}'))`;

export async function episodePrints(
  db: Db,
  q: { fromMs: number; toMs: number; minUsd: number; limit: number; keys: readonly string[]; aliases?: readonly SymbolAlias[] },
): Promise<EpisodePrint[]> {
  const params = keysParams([new Date(q.fromMs), new Date(q.toMs), q.minUsd, q.limit], q.keys);
  const map = mapCte(params, q.aliases);
  const rows = await db.query<{
    ts: Date; symbol_id: string | null; venue_symbol: string; base: string | null; side: 'long' | 'short'; notional: string; venue: string;
  }>(
    `with ${map}
     select l.ts, m.id as symbol_id, l.symbol as venue_symbol, m.base, l.side, l.notional, l.venue
       from liquidations l
       left join map m on m.venue = l.venue and m.sym = l.symbol
      where l.ts >= $1 and l.ts < $2 and l.notional >= $3 ${keysFilter(q.keys, 5)}
        and ${NOT_COIN_M}
      order by l.ts desc
      limit $4`,
    params,
  );
  return rows.map((r) => ({
    timeMs: new Date(r.ts).getTime(),
    side: r.side,
    usd: Number(r.notional),
    // an unmapped print keeps the venue's spelling rather than vanishing (the feed's rule)
    symbol: r.symbol_id ?? r.venue_symbol,
    base: r.base ?? r.venue_symbol,
    venue: r.venue,
  }));
}
