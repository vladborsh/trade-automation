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
