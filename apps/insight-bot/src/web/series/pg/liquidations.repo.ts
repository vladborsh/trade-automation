import type { Db } from '../../../db/db.port';

/**
 * IB-031 — the instrument view's LIQUIDATION reads (SQL under a `pg/` directory, IB-004's rule).
 *
 * WD-009: this was `series.repo.ts`. Candles, funding, open interest, long-short and the universe
 * list now come from the venues on demand (`web/market/*`), so their queries are gone; the
 * liquidation reads stay because liquidations have no REST history at any venue — the tape is the
 * only record (member-access design §3).
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

export interface LiquidationEventBucketRow {
  time: number; side: 'long' | 'short'; usd: number; price: number; venue: string; count: number; maxUsd: number;
}

/**
 * IB-068 — the markers' events grouped per chart bar, one row per (bar start, side, venue).
 *
 * The bar start is `floorToGrid` done in SQL: the caller passes the bar width and the grid offset
 * (`timeframeMs` / `gridOffsetMs`, so a week opens on Monday) and the database floors with the
 * same arithmetic. Price is the USD-weighted mean; a bucket of zero-USD events falls back to the
 * plain mean rather than dividing by zero. `limit` is the caller's bound plus one, so a window over
 * it is seen and refused, never cut.
 */
export async function liquidationEventBuckets(
  db: Db,
  q: Omit<RangeQuery, 'stride'> & { minUsd: number; spanMs: number; offsetMs: number; limit: number },
): Promise<LiquidationEventBucketRow[]> {
  const spellings = await venueSpellings(db, q.symbol);
  if (spellings.length === 0) return [];
  const rows = await db.query<{
    bar_ms: string; side: 'long' | 'short'; usd: string; price: string; venue: string; n: string; max_usd: string;
  }>(
    `select floor((extract(epoch from ts) * 1000 - $5::bigint) / $6::bigint)::bigint * $6::bigint + $5::bigint as bar_ms,
            side, venue,
            sum(notional) as usd,
            coalesce(sum(price * notional) / nullif(sum(notional), 0), avg(price)) as price,
            count(*) as n,
            max(notional) as max_usd
       from liquidations
      where symbol = any($1::text[]) and ts >= $2 and ts < $3 and notional >= $4
      group by 1, side, venue
      order by 1, side, venue
      limit $7`,
    [spellings, asDate(q.fromMs), asDate(q.toMs), q.minUsd, q.offsetMs, q.spanMs, q.limit + 1],
  );
  return rows.map((r) => ({
    time: Math.floor(Number(r.bar_ms) / 1000),
    side: r.side,
    usd: Number(r.usd),
    price: Number(r.price),
    venue: r.venue,
    count: Number(r.n),
    maxUsd: Number(r.max_usd),
  }));
}
