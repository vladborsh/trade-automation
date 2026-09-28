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

/**
 * IB-008: the earliest settlement stored per symbol for a venue, so the boot funding backfill can
 * stop as soon as it reaches known rows instead of paging the venue's whole depth every restart.
 */
export async function earliestFundingTimes(db: Db, venue: string): Promise<Map<string, number>> {
  const rows = await db.query<{ symbol: string; funding_time: Date }>(
    `select symbol, min(funding_time) as funding_time
       from funding_settlements
      where venue = $1
      group by symbol`,
    [venue],
  );
  return new Map(rows.map((row) => [row.symbol, new Date(row.funding_time).getTime()]));
}
