import type { Db } from '../../../db/db.port';

/**
 * IB-038 — the liquidations overview's reads (SQL under a `pg/` directory, IB-004's rule).
 *
 * **The venue→coin map is a CTE, not a chain of ORs.** `liquidations` stores each venue's own
 * symbol (`BTCUSDT` on Bybit, `BTC-USDT-SWAP` on OKX — IB-BUG-011), so every query here has to
 * canonicalise. Unpivoting `symbols` into one `(venue, venue_symbol) → (id, base)` row set turns
 * that into a plain equi-join the planner understands, and — the reason it is a `left` join —
 * makes an unmapped row **visible as a null** instead of silently absent. A venue listing
 * something before `symbols` knows about it must show up as a number, not as a quieter market.
 */

/** `(venue, venue_symbol) → (canonical id, base)`, built from the three per-venue columns. */
const MAP_ROWS = `
    select id, base, 'binance'::text as venue, binance_perp as sym from symbols where binance_perp is not null
    union all
    select id, base, 'bybit'::text,            bybit_linear       from symbols where bybit_linear is not null
    union all
    select id, base, 'okx'::text,              okx_swap           from symbols where okx_swap is not null`;

/** IB-BUG-025: a Binance contract counted in a universe coin's row (BTCUSDC → BTCUSDT). */
export interface SymbolAlias {
  symbol: string;
  id: string;
}

/**
 * The `map` CTE, with the aliases (if any) as two array parameters appended to `params` — after
 * every other parameter, so no query's existing `$n` moves. An alias is never a `symbols`
 * spelling (`aliasTable` guarantees it), so the join stays one row per liquidation.
 */
function mapCte(params: unknown[], aliases: readonly SymbolAlias[] | undefined): string {
  if (!aliases || aliases.length === 0) return `map as (${MAP_ROWS}\n  )`;
  params.push(aliases.map((a) => a.symbol), aliases.map((a) => a.id));
  const syms = params.length - 1;
  return `map as (${MAP_ROWS}
    union all
    select s.id, s.base, 'binance'::text, x.sym
      from unnest($${syms}::text[], $${syms + 1}::text[]) as x(sym, id) join symbols s on s.id = x.id
  )`;
}

const asDate = (ms: number) => new Date(ms);

/**
 * IB-084 (design D6): restricts a read to one asset class, given as the `venue:symbol` keys the
 * classifier assigned to it. Omitted = every row (the IB-038 behaviour). An EMPTY list matches
 * nothing — a class with no symbols has no rows, it does not fall back to all of them.
 */
function keysFilter(keys: readonly string[] | undefined, param: number): string {
  return keys === undefined ? '' : `and (l.venue || ':' || l.symbol) = any($${param}::text[])`;
}
function keysParams(params: unknown[], keys: readonly string[] | undefined): unknown[] {
  return keys === undefined ? params : [...params, [...keys]];
}

/** IB-084: every `venue:symbol` that wrote a row in the range — what the classifier must class. */
export async function distinctKeys(db: Db, q: { fromMs: number; toMs: number }): Promise<Array<{ venue: string; symbol: string }>> {
  return db.query<{ venue: string; symbol: string }>(
    'select distinct venue, symbol from liquidations where ts >= $1 and ts < $2',
    [asDate(q.fromMs), asDate(q.toMs)],
  );
}

/** IB-084 D8(c): the median single-event USD over the range, for one class's keys; null when none. */
export async function medianEventUsd(db: Db, q: { fromMs: number; toMs: number; keys: readonly string[] }): Promise<number | null> {
  const rows = await db.query<{ median: string | null }>(
    `select percentile_cont(0.5) within group (order by l.notional) as median
       from liquidations l
      where l.ts >= $1 and l.ts < $2 ${keysFilter(q.keys, 3)}`,
    keysParams([asDate(q.fromMs), asDate(q.toMs)], q.keys),
  );
  const m = rows[0]?.median;
  return m === null || m === undefined ? null : Number(m);
}

export interface BucketRow {
  /** Canonical symbol, or null when the venue's symbol is in no `symbols` row. */
  symbolId: string | null;
  side: 'long' | 'short';
  /** Start of the boundary-aligned window, epoch ms. */
  bucketMs: number;
  usd: number;
}

/**
 * Σ USD per (coin, side, boundary-aligned window) over the norm period — **one pass per window
 * size**, which is the budget §12.3 sets.
 *
 * Alignment is `floor(epoch / W) * W`, i.e. anchored to the Unix epoch, which for 1 h, 4 h and
 * 24 h means UTC hour, UTC 4-hour and UTC midnight boundaries. The same expression is used for
 * every window size so the three cannot drift apart.
 *
 * Empty windows are NOT returned — there is no row to return. The caller fills the grid with
 * zeros, because a quiet window is a real zero and belongs in the median (`norm.ts`).
 */
export async function alignedBuckets(
  db: Db,
  q: { windowSec: number; fromMs: number; toMs: number; keys?: readonly string[]; aliases?: readonly SymbolAlias[] },
): Promise<BucketRow[]> {
  const params = keysParams([q.windowSec, asDate(q.fromMs), asDate(q.toMs)], q.keys);
  const map = mapCte(params, q.aliases);
  const rows = await db.query<{ symbol_id: string | null; side: 'long' | 'short'; bucket: string; usd: string }>(
    `with ${map}
     select m.id as symbol_id,
            l.side,
            floor(extract(epoch from l.ts) / $1) * $1 as bucket,
            sum(l.notional) as usd
       from liquidations l
       left join map m on m.venue = l.venue and m.sym = l.symbol
      where l.ts >= $2 and l.ts < $3 ${keysFilter(q.keys, 4)}
      group by 1, 2, 3`,
    params,
  );
  return rows.map((r) => ({
    symbolId: r.symbol_id,
    side: r.side,
    bucketMs: Number(r.bucket) * 1000,
    usd: Number(r.usd),
  }));
}

export interface TrailingRow {
  symbolId: string | null;
  /** IB-BUG-025: `venue:symbol` when `symbolId` is null, so the rows of unlisted coins can be told apart. */
  venueKey: string | null;
  side: 'long' | 'short';
  /** USD in each trailing window, keyed by the window's length in seconds. */
  usdByWindow: Record<number, number>;
  eventsByWindow: Record<number, number>;
}

/**
 * Σ USD and event counts for every trailing window in one pass.
 *
 * The trailing window is `(now - W, now]` and is deliberately **not** boundary-aligned: the card
 * answers "what is happening now", and an aligned window would answer "what happened since the
 * last hour mark", which at 12:01 is one minute of data presented as an hour.
 */
export async function trailingSums(
  db: Db,
  q: { nowMs: number; windowsSec: readonly number[]; keys?: readonly string[]; aliases?: readonly SymbolAlias[] },
): Promise<TrailingRow[]> {
  const widest = Math.max(...q.windowsSec);
  const params: unknown[] = [asDate(q.nowMs - widest * 1000), asDate(q.nowMs)];
  const sums = q.windowsSec.map((sec) => {
    params.push(asDate(q.nowMs - sec * 1000));
    const p = `$${params.length}`;
    return `coalesce(sum(l.notional) filter (where l.ts >= ${p}), 0) as usd_${sec},
            count(*) filter (where l.ts >= ${p}) as events_${sec}`;
  });

  const keyFilter = keysFilter(q.keys, params.length + 1);
  const all = keysParams(params, q.keys);
  const map = mapCte(all, q.aliases);
  const rows = await db.query<Record<string, string | null>>(
    `with ${map}
     select m.id as symbol_id, l.side,
            case when m.id is null then l.venue || ':' || l.symbol end as venue_key,
            ${sums.join(', ')}
       from liquidations l
       left join map m on m.venue = l.venue and m.sym = l.symbol
      where l.ts >= $1 and l.ts < $2 ${keyFilter}
      group by 1, 2, 3`,
    all,
  );

  return rows.map((r) => {
    const usdByWindow: Record<number, number> = {};
    const eventsByWindow: Record<number, number> = {};
    for (const sec of q.windowsSec) {
      usdByWindow[sec] = Number(r[`usd_${sec}`] ?? 0);
      eventsByWindow[sec] = Number(r[`events_${sec}`] ?? 0);
    }
    return {
      symbolId: (r.symbol_id as string | null) ?? null, venueKey: (r.venue_key as string | null) ?? null,
      side: r.side as 'long' | 'short', usdByWindow, eventsByWindow,
    };
  });
}

/**
 * When each venue was first seen, per scope, within the norm period.
 *
 * Bounded to the period on purpose: a venue whose first row predates it is capped there anyway
 * (`normPeriodStart`), so scanning all history to learn that would be work with no answer in it.
 * `symbolId: null` carries the market-wide first-seen, which is the min over every venue row.
 */
export async function venueFirstSeen(
  db: Db,
  q: { fromMs: number; toMs: number; keys?: readonly string[]; aliases?: readonly SymbolAlias[] },
): Promise<Array<{ symbolId: string | null; venue: string; firstSeenMs: number }>> {
  const params = keysParams([asDate(q.fromMs), asDate(q.toMs)], q.keys);
  const map = mapCte(params, q.aliases);
  const rows = await db.query<{ symbol_id: string | null; venue: string; first_seen: Date }>(
    `with ${map}
     select m.id as symbol_id, l.venue, min(l.ts) as first_seen
       from liquidations l
       left join map m on m.venue = l.venue and m.sym = l.symbol
      where l.ts >= $1 and l.ts < $2 ${keysFilter(q.keys, 3)}
      group by 1, 2`,
    params,
  );
  return rows.map((r) => ({
    symbolId: r.symbol_id,
    venue: r.venue,
    firstSeenMs: new Date(r.first_seen).getTime(),
  }));
}

export interface FeedRow {
  timeSec: number;
  symbolId: string | null;
  /** The venue's own symbol, kept so an unmapped event is still nameable in the feed. */
  venueSymbol: string;
  base: string | null;
  side: 'long' | 'short';
  usd: number;
  price: number;
  venue: string;
}

/** The newest events above the threshold, biggest-first order being the feed's job, not SQL's. */
export async function feed(
  db: Db,
  q: { fromMs: number; toMs: number; minUsd: number; limit: number; keys?: readonly string[]; order?: 'newest' | 'oldest'; aliases?: readonly SymbolAlias[] },
): Promise<FeedRow[]> {
  const params = keysParams([asDate(q.fromMs), asDate(q.toMs), q.minUsd, q.limit], q.keys);
  const map = mapCte(params, q.aliases);
  const rows = await db.query<{
    ts: Date; symbol_id: string | null; venue_symbol: string; base: string | null;
    side: 'long' | 'short'; notional: string; price: string; venue: string;
  }>(
    `with ${map}
     select l.ts, m.id as symbol_id, l.symbol as venue_symbol, m.base, l.side, l.notional, l.price, l.venue
       from liquidations l
       left join map m on m.venue = l.venue and m.sym = l.symbol
      where l.ts >= $1 and l.ts < $2 and l.notional >= $3 ${keysFilter(q.keys, 5)}
      order by l.ts ${q.order === 'oldest' ? 'asc' : 'desc'}
      limit $4`,
    params,
  );
  return rows.map((r) => ({
    timeSec: Math.floor(new Date(r.ts).getTime() / 1000),
    symbolId: r.symbol_id,
    venueSymbol: r.venue_symbol,
    base: r.base,
    side: r.side,
    usd: Number(r.notional),
    price: Number(r.price),
    venue: r.venue,
  }));
}

/** The venues that wrote anything in the window. Evidence, not configuration. */
export async function venuesWithRows(db: Db, q: { fromMs: number; toMs: number; keys?: readonly string[] }): Promise<string[]> {
  const rows = await db.query<{ venue: string }>(
    `select distinct l.venue from liquidations l where l.ts >= $1 and l.ts < $2 ${keysFilter(q.keys, 3)} order by l.venue`,
    keysParams([asDate(q.fromMs), asDate(q.toMs)], q.keys),
  );
  return rows.map((r) => r.venue);
}

/** Top-N canonical symbols by volume rank — the rows of «Где ликвидируют». */
export async function rankedSymbols(db: Db, n: number): Promise<Array<{ id: string; base: string }>> {
  const rows = await db.query<{ id: string; base: string }>(
    `select id, base from symbols where active order by volume_rank nulls last, id limit $1`,
    [n],
  );
  return rows.map((r) => ({ id: r.id, base: r.base }));
}
