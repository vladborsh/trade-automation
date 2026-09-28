import type { Candle1mRow } from '../collectors/writers/tables';
import type { Db } from '../db/db.port';

/** IB-014 — the one read the derive job needs (SQL stays in `src/db/pg/`'s spirit: one place). */
export async function candles1mBetween(
  db: Db,
  venue: string,
  market: string,
  symbol: string,
  fromMs: number,
  toMsExclusive: number,
): Promise<Candle1mRow[]> {
  const rows = await db.query<{
    venue: string; market: string; symbol: string; open_time: Date;
    open: string; high: string; low: string; close: string; volume: string;
    quote_volume: string | null; trades: number | null;
    taker_buy_volume: string | null; taker_buy_quote_volume: string | null; source: string;
  }>(
    `select venue, market, symbol, open_time, open, high, low, close, volume,
            quote_volume, trades, taker_buy_volume, taker_buy_quote_volume, source
       from candles_1m
      where venue = $1 and market = $2 and symbol = $3
        and open_time >= $4 and open_time < $5
      order by open_time`,
    [venue, market, symbol, new Date(fromMs), new Date(toMsExclusive)],
  );

  // `numeric` comes back as a string from pg (it is wider than a JS number); Number() here is the
  // one place that conversion happens, so the fold works on numbers and the comparison against the
  // venue is like-for-like.
  return rows.map((r) => ({
    venue: r.venue,
    market: r.market as Candle1mRow['market'],
    symbol: r.symbol,
    openTime: new Date(r.open_time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    quoteVolume: r.quote_volume === null ? null : Number(r.quote_volume),
    trades: r.trades === null ? null : Number(r.trades),
    takerBuyVolume: r.taker_buy_volume === null ? null : Number(r.taker_buy_volume),
    takerBuyQuoteVolume: r.taker_buy_quote_volume === null ? null : Number(r.taker_buy_quote_volume),
    source: r.source as Candle1mRow['source'],
  }));
}

/** The symbols and markets that actually hold 1m rows in a window — what the job iterates. */
export async function seriesWithRows(
  db: Db,
  fromMs: number,
  toMsExclusive: number,
): Promise<Array<{ venue: string; market: string; symbol: string }>> {
  return db.query<{ venue: string; market: string; symbol: string }>(
    `select distinct venue, market, symbol from candles_1m
      where open_time >= $1 and open_time < $2 order by venue, market, symbol`,
    [new Date(fromMs), new Date(toMsExclusive)],
  );
}

/**
 * IB-014 — buckets still marked incomplete whose window has closed, newest first.
 *
 * Why this exists: the §8.1 grace is 5 s, which is right for the WS path, but §16.1's degraded REST
 * mode polls non-signal-set symbols every **15 s**, so their last 1m row lands after the grace and
 * the coarse bar is written one minute short. GapRepair filling a hole minutes later does the same.
 * Measured on a live run: 28 of 60 15m buckets were written at 14/15 bars, and all 15 rows were in
 * the table moments later. Re-folding is idempotent, so the fix is to look again rather than to
 * widen the grace and hope.
 */
export async function incompleteBuckets(
  db: Db,
  nowMs: number,
  lookbackMs: number,
): Promise<Array<{ venue: string; market: string; symbol: string; tf: string; openTime: Date }>> {
  return db.query(
    `select venue, market, symbol, tf, open_time as "openTime"
       from candles_agg
      where complete = false
        and open_time >= $1
        and open_time < $2
      order by open_time desc`,
    [new Date(nowMs - lookbackMs), new Date(nowMs)],
  );
}
