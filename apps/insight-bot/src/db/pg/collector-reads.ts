import type { Db } from '../db.port';
import type { Market } from '../../collectors/writers/tables';

/**
 * The one read the collectors need, kept here because SQL lives in `src/db/pg/` and the writers
 * module only (IB-004's rule): on boot a collector seeds `GapRepair` from the newest stored bar
 * per symbol and REST-fills the interval to now, so a restart never leaves a hole (§4.1, D12).
 */
export async function lastCandleOpenTimes(db: Db, venue: string, market: Market): Promise<Map<string, number>> {
  const rows = await db.query<{ symbol: string; open_time: Date }>(
    `select symbol, max(open_time) as open_time
       from candles_1m
      where venue = $1 and market = $2
      group by symbol`,
    [venue, market],
  );
  return new Map(rows.map((row) => [row.symbol, new Date(row.open_time).getTime()]));
}
