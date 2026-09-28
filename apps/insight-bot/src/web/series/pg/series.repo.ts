import type { Db } from '../../../db/db.port';

/**
 * IB-031 — the instrument view's reads (SQL under a `pg/` directory, IB-004's rule).
 *
 * **Thinning happens in Postgres, not in Node.** Every query that can exceed the point cap
 * carries a `stride` and filters with `row_number() % stride = 0`, so a 90-day 1-minute window
 * returns ~5,000 rows rather than 129,600. Pulling them all into the process to throw most away
 * is precisely what the cap exists to prevent on a 1 GB box.
 */

export interface RangeQuery {
  symbol: string;
  fromMs: number;
  toMs: number;
  stride: number;
}

const asDate = (ms: number) => new Date(ms);
const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

export interface CandleRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number | null;
}

/**
 * 1m candles from `candles_1m`; coarser frames from `candles_agg`, which IB-014 fills. Both are
 * read through the same shape so the controller does not branch on storage.
 */
export async function candles(
  db: Db,
  q: RangeQuery & { venue: string; market: string; timeframe: string },
): Promise<CandleRow[]> {
  const oneMinute = q.timeframe === '1m';
  const table = oneMinute ? 'candles_1m' : 'candles_agg';
  const tfFilter = oneMinute ? '' : 'and tf = $6';
  const params: unknown[] = [q.venue, q.market, q.symbol, asDate(q.fromMs), asDate(q.toMs)];
  if (!oneMinute) params.push(q.timeframe);
  params.push(q.stride);
  const strideParam = `$${params.length}`;

  const rows = await db.query<{
    open_time: Date; open: string; high: string; low: string; close: string;
    volume: string; taker_buy_volume: string | null;
  }>(
    `with ordered as (
       select open_time, open, high, low, close, volume, taker_buy_volume,
              row_number() over (order by open_time) as rn
         from ${table}
        where venue = $1 and market = $2 and symbol = $3
          and open_time >= $4 and open_time < $5 ${tfFilter}
     )
     select open_time, open, high, low, close, volume, taker_buy_volume
       from ordered
      where ${strideParam} = 1 or rn %% ${strideParam} = 1
      order by open_time`.replace(/%%/g, '%'),
    params,
  );

  return rows.map((r) => ({
    time: sec(r.open_time),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume),
    takerBuyVolume: r.taker_buy_volume === null ? null : Number(r.taker_buy_volume),
  }));
}

export interface FundingPointRow { venue: string; time: number; rate: number }

/** Settled funding per venue — steps, so every row matters and there is no thinning. */
export async function settledFunding(db: Db, q: Omit<RangeQuery, 'stride'>): Promise<FundingPointRow[]> {
  const rows = await db.query<{ venue: string; funding_time: Date; rate: string }>(
    `select venue, funding_time, rate
       from funding_settlements
      where symbol = $1 and funding_time >= $2 and funding_time < $3
      order by funding_time`,
    [q.symbol, asDate(q.fromMs), asDate(q.toMs)],
  );
  return rows.map((r) => ({ venue: r.venue, time: sec(r.funding_time), rate: Number(r.rate) }));
}

/** Predicted funding is sampled per minute (D5), so this one is thinned. */
export async function predictedFunding(db: Db, q: RangeQuery & { venue: string }): Promise<Array<{ time: number; rate: number }>> {
  const rows = await db.query<{ ts: Date; predicted_funding_rate: string | null }>(
    `with ordered as (
       select ts, predicted_funding_rate, row_number() over (order by ts) as rn
         from mark_funding_1m
        where venue = $1 and symbol = $2 and ts >= $3 and ts < $4
          and predicted_funding_rate is not null
     )
     select ts, predicted_funding_rate from ordered
      where $5 = 1 or rn % $5 = 1
      order by ts`,
    [q.venue, q.symbol, asDate(q.fromMs), asDate(q.toMs), q.stride],
  );
  return rows.map((r) => ({ time: sec(r.ts), rate: Number(r.predicted_funding_rate) }));
}

export interface OiRow { time: number; value: number; notional: number | null }

export async function openInterest(db: Db, q: RangeQuery & { venue: string }): Promise<OiRow[]> {
  const rows = await db.query<{ ts: Date; oi_base: string; oi_quote: string | null }>(
    `with ordered as (
       select ts, oi_base, oi_quote, row_number() over (order by ts) as rn
         from open_interest_5m
        where venue = $1 and symbol = $2 and ts >= $3 and ts < $4
     )
     select ts, oi_base, oi_quote from ordered
      where $5 = 1 or rn % $5 = 1
      order by ts`,
    [q.venue, q.symbol, asDate(q.fromMs), asDate(q.toMs), q.stride],
  );
  return rows.map((r) => ({
    time: sec(r.ts),
    value: Number(r.oi_base),
    notional: r.oi_quote === null ? null : Number(r.oi_quote),
  }));
}

export async function longShort(db: Db, q: RangeQuery & { venue: string; kind: string }): Promise<Array<{ time: number; ratio: number }>> {
  const rows = await db.query<{ ts: Date; ratio: string | null }>(
    `with ordered as (
       select ts, ratio, row_number() over (order by ts) as rn
         from long_short_5m
        where venue = $1 and symbol = $2 and kind = $3 and ts >= $4 and ts < $5
          and ratio is not null
     )
     select ts, ratio from ordered
      where $6 = 1 or rn % $6 = 1
      order by ts`,
    [q.venue, q.symbol, q.kind, asDate(q.fromMs), asDate(q.toMs), q.stride],
  );
  return rows.map((r) => ({ time: sec(r.ts), ratio: Number(r.ratio) }));
}

export interface LiquidationRowDb { ts: number; side: 'long' | 'short'; notional: number; venue: string; price: number; qty: number }

/**
 * Raw liquidations for the window. Not thinned: they are bucketed afterwards, and thinning
 * before bucketing would drop events out of the histogram's counts.
 */
export async function liquidations(
  db: Db,
  q: Omit<RangeQuery, 'stride'> & { venue: string | null },
): Promise<LiquidationRowDb[]> {
  const params: unknown[] = [q.symbol, asDate(q.fromMs), asDate(q.toMs)];
  let venueFilter = '';
  if (q.venue) {
    params.push(q.venue);
    venueFilter = `and venue = $${params.length}`;
  }
  const rows = await db.query<{ ts: Date; side: 'long' | 'short'; price: string; qty: string; notional: string | null; venue: string }>(
    `select ts, side, price, qty, notional, venue
       from liquidations
      where symbol = $1 and ts >= $2 and ts < $3 ${venueFilter}
      order by ts`,
    params,
  );
  return rows.map((r) => ({
    ts: new Date(r.ts).getTime(),
    side: r.side,
    venue: r.venue,
    price: Number(r.price),
    qty: Number(r.qty),
    // older rows may not carry a stored notional; price × qty is the same number
    notional: r.notional === null ? Number(r.price) * Number(r.qty) : Number(r.notional),
  }));
}

export interface UniverseRow {
  id: string; base: string; quote: string; volumeRank: number | null; inSignalSet: boolean;
  binancePerp: boolean; binanceSpot: boolean; bybitLinear: boolean; okxSwap: boolean;
}

/** The picker's list: ranked symbols first, unranked after, never inactive ones. */
export async function topSymbols(db: Db, n: number): Promise<UniverseRow[]> {
  const rows = await db.query<{
    id: string; base: string; quote: string; volume_rank: number | null; in_signal_set: boolean;
    binance_perp: string | null; binance_spot: string | null; bybit_linear: string | null; okx_swap: string | null;
  }>(
    `select id, base, quote, volume_rank, in_signal_set, binance_perp, binance_spot, bybit_linear, okx_swap
       from symbols
      where active
      order by volume_rank nulls last, id
      limit $1`,
    [n],
  );
  return rows.map((r) => ({
    id: r.id, base: r.base, quote: r.quote, volumeRank: r.volume_rank, inSignalSet: r.in_signal_set,
    binancePerp: r.binance_perp !== null, binanceSpot: r.binance_spot !== null,
    bybitLinear: r.bybit_linear !== null, okxSwap: r.okx_swap !== null,
  }));
}
