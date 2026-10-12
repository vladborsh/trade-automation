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

/**
 * IB-BUG-011 — the venue spellings of one canonical symbol.
 *
 * **Every multi-venue table stores each venue's OWN symbol string**, because that is what the
 * venue sends and rewriting it on ingest would make the row unverifiable against the source.
 * `BTCUSDT` on Binance and Bybit is `BTC-USDT-SWAP` on OKX; Bybit's `1000PEPEUSDT` is OKX's
 * `PEPE-USDT-SWAP`. The dashboard, correctly, asks for the canonical `symbols.id`.
 *
 * Matching the caller's string directly — which is what `liquidations` and `settledFunding` did
 * until now — therefore returns whichever venues happen to spell the symbol that way and drops
 * the rest, **while the response still says `venue: 'all'`**. Measured on the local tape when
 * this was found: BTC's last 24 h held 27 250 USD of Bybit liquidations and 236 565 USD of OKX
 * ones, and the instrument page showed the first and labelled it «все биржи» — 10 % of the money
 * under a label claiming all of it. Nothing threw, nothing was blank; the number was simply
 * wrong and confident. Funding had the same hole: 318 OKX BTC settlements never reached the
 * panel.
 *
 * Returns the spellings to match. Empty when the symbol is unknown — the caller returns no rows
 * rather than falling back to the raw string, because a silent fallback is how this bug reads as
 * a quiet market.
 */
export async function venueSpellings(db: Db, symbolId: string, venue?: string | null): Promise<string[]> {
  const rows = await db.query<{ binance_perp: string | null; bybit_linear: string | null; okx_swap: string | null }>(
    `select binance_perp, bybit_linear, okx_swap from symbols where id = $1`,
    [symbolId],
  );
  const row = rows[0];
  if (!row) return [];
  const byVenue: Record<string, string | null> = {
    binance: row.binance_perp,
    bybit: row.bybit_linear,
    okx: row.okx_swap,
  };
  const wanted = venue ? [byVenue[venue] ?? null] : Object.values(byVenue);
  // de-duplicated: Binance and Bybit usually spell it the same, and `= any([x, x])` is wasteful
  return [...new Set(wanted.filter((s): s is string => s !== null && s.length > 0))];
}

export interface FundingPointRow { venue: string; time: number; rate: number }

/**
 * Settled funding per venue — steps, so every row matters and there is no thinning.
 *
 * IB-BUG-011: matched on the canonical symbol's venue spellings, so OKX's settlements stop being
 * invisible on a page that lists its venues.
 */
export async function settledFunding(db: Db, q: Omit<RangeQuery, 'stride'>): Promise<FundingPointRow[]> {
  const spellings = await venueSpellings(db, q.symbol);
  if (spellings.length === 0) return [];
  const rows = await db.query<{ venue: string; funding_time: Date; rate: string }>(
    `select venue, funding_time, rate
       from funding_settlements
      where symbol = any($1::text[]) and funding_time >= $2 and funding_time < $3
      order by funding_time`,
    [spellings, asDate(q.fromMs), asDate(q.toMs)],
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
 *
 * IB-BUG-011: matched on the canonical symbol's **venue spellings**, not on the string the caller
 * typed — see `venueSpellings`.
 */
export async function liquidations(
  db: Db,
  q: Omit<RangeQuery, 'stride'> & { venue: string | null },
): Promise<LiquidationRowDb[]> {
  const spellings = await venueSpellings(db, q.symbol, q.venue);
  if (spellings.length === 0) return [];

  const params: unknown[] = [spellings, asDate(q.fromMs), asDate(q.toMs)];
  let venueFilter = '';
  if (q.venue) {
    params.push(q.venue);
    venueFilter = `and venue = $${params.length}`;
  }
  const rows = await db.query<{ ts: Date; side: 'long' | 'short'; price: string; qty: string; notional: string | null; venue: string }>(
    `select ts, side, price, qty, notional, venue
       from liquidations
      where symbol = any($1::text[]) and ts >= $2 and ts < $3 ${venueFilter}
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

/**
 * IB-039 — individual liquidation events for the price chart's markers (§12.5).
 *
 * Asks for **one more row than the cap** so the caller can tell "exactly at the limit" from
 * "more than we will send" without a second count query. A silently truncated list would draw a
 * chart that looks calm after the two-thousandth event, which is the same failure as showing one
 * venue and calling it all of them.
 *
 * Ordered by size, not by time: when a window holds more than the cap, the events worth seeing
 * are the big ones. The client sorts back into time order to draw.
 */
export async function liquidationEvents(
  db: Db,
  q: Omit<RangeQuery, 'stride'> & { minUsd: number; limit: number },
): Promise<Array<{ time: number; side: 'long' | 'short'; usd: number; price: number; venue: string }>> {
  const spellings = await venueSpellings(db, q.symbol);
  if (spellings.length === 0) return [];
  const rows = await db.query<{ ts: Date; side: 'long' | 'short'; notional: string; price: string; venue: string }>(
    `select ts, side, notional, price, venue
       from liquidations
      where symbol = any($1::text[]) and ts >= $2 and ts < $3 and notional >= $4
      order by notional desc
      limit $5`,
    [spellings, asDate(q.fromMs), asDate(q.toMs), q.minUsd, q.limit + 1],
  );
  return rows.map((r) => ({
    time: sec(r.ts),
    side: r.side,
    usd: Number(r.notional),
    price: Number(r.price),
    venue: r.venue,
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
