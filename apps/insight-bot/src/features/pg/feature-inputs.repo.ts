import type { DbHandle } from '../../db/db.port';

/**
 * IB-015 — everything the §8.2 calculators read, and nothing else.
 *
 * SQL under a `pg/` directory, IB-004's rule.
 *
 * Two conventions run through every function here, both of them load-bearing:
 *
 * 1. **A symbol is matched by the venue's own spelling, never by the canonical id.** IB-BUG-011
 *    was exactly this mistake — `where symbol = $1` against a multi-venue table returned
 *    Binance's rows and silently dropped the rest, and the page reported a tenth of the money as
 *    "all venues". The spellings are resolved once per pass and passed in as an array.
 * 2. **A count is returned next to the thing counted.** `bars`, `complete` and minute counts come
 *    back with the data rather than being inferred from the row count, because "I received 238
 *    rows" cannot distinguish a short window from a thinned one.
 */

const asDate = (ms: number) => new Date(ms);
const sec = (d: Date) => Math.floor(new Date(d).getTime() / 1000);

export interface AggBar {
  openTimeSec: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number | null;
  /** 1m rows folded in, and whether that was the full count the timeframe expects. */
  bars: number;
  complete: boolean;
}

/**
 * Aggregated bars for one timeframe.
 *
 * **Returns incomplete buckets too, deliberately.** Filtering them out here would hand the
 * calculators a shorter window that looks whole, and the refusal path would never fire: §8.1's
 * rule is that an incomplete bucket makes the frame refuse, which requires somebody to see that
 * it was incomplete. The caller counts them and decides.
 */
export async function aggBars(
  db: DbHandle,
  q: { venue: string; market: string; symbols: readonly string[]; tf: string; fromMs: number; toMsExclusive: number },
): Promise<AggBar[]> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{
    open_time: Date; open: string; high: string; low: string; close: string;
    volume: string; taker_buy_volume: string | null; bars: number; complete: boolean;
  }>(
    `select open_time, open, high, low, close, volume, taker_buy_volume, bars, complete
       from candles_agg
      where venue = $1 and market = $2 and symbol = any($3::text[]) and tf = $4
        and open_time >= $5 and open_time < $6
      order by open_time`,
    [q.venue, q.market, q.symbols, q.tf, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  return rows.map((r) => ({
    openTimeSec: sec(r.open_time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    takerBuyVolume: r.taker_buy_volume === null ? null : Number(r.taker_buy_volume),
    bars: r.bars,
    complete: r.complete,
  }));
}

/**
 * The earliest aggregated bucket at or after `fromMs`, or null when the window holds none.
 *
 * The completeness check needs it to tell two absences apart. A window asking for 200 daily bars
 * against a table holding ten is not a collection failure — nobody has backfilled the archive
 * yet — and reporting it as `incomplete_input` would put a permanent, unfixable entry in the
 * unhealed-gap counter for every symbol. Clamped to this, the shortfall disappears and the
 * calculator refuses with `insufficient_history`, which is both true and not anyone's alarm.
 *
 * **Bounded by `fromMs`, which is the difference between 2 s and nothing.** The unbounded form
 * — `min(open_time)` with no lower bound — has to visit every partition `candles_agg` has, back
 * to 2020, because the minimum could be in any of them. Measured on `insight_dev2`: 2,216 ms
 * cold and 2,029 ms WARM, every time, because there is nothing to warm up about a full scan.
 * Four timeframes per symbol made that the single largest cost in the pass.
 *
 * The bound costs nothing in meaning: the clamp only ever needs `max(fromMs, firstBucket)`, so
 * a bucket older than `fromMs` could not change the answer.
 */
export async function firstAggBucketMs(
  db: DbHandle,
  q: { venue: string; market: string; symbols: readonly string[]; tf: string; fromMs: number },
): Promise<number | null> {
  if (q.symbols.length === 0) return null;
  const rows = await db.query<{ first: Date | null }>(
    `select min(open_time) as first
       from candles_agg
      where venue = $1 and market = $2 and symbol = any($3::text[]) and tf = $4
        and open_time >= $5`,
    [q.venue, q.market, q.symbols, q.tf, asDate(q.fromMs)],
  );
  const first = rows[0]?.first;
  return first === undefined || first === null ? null : new Date(first).getTime();
}

export interface MinuteBar {
  openTimeSec: number;
  close: number;
  volume: number;
  takerBuyVolume: number | null;
}

/**
 * 1m bars, for the CVD keys that §8.2 computes straight from them.
 *
 * `candles_1m` has no `complete` flag — there is nothing for it to be complete of — so the
 * caller's completeness check is a count against `hours × 60`. That is why this returns the
 * bars and `minuteCount` exists separately: asking for 240 bars and receiving 238 tells you the
 * window was short only if you knew to expect 240.
 */
export async function minuteBars(
  db: DbHandle,
  q: { venue: string; market: string; symbols: readonly string[]; fromMs: number; toMsExclusive: number },
): Promise<MinuteBar[]> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{ open_time: Date; close: string; volume: string; taker_buy_volume: string | null }>(
    `select open_time, close, volume, taker_buy_volume
       from candles_1m
      where venue = $1 and market = $2 and symbol = any($3::text[])
        and open_time >= $4 and open_time < $5
      order by open_time`,
    [q.venue, q.market, q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  return rows.map((r) => ({
    openTimeSec: sec(r.open_time),
    close: Number(r.close),
    volume: Number(r.volume),
    takerBuyVolume: r.taker_buy_volume === null ? null : Number(r.taker_buy_volume),
  }));
}

/** Distinct minutes stored in a window — the completeness denominator for `candles_1m`. */
export async function minuteCount(
  db: DbHandle,
  q: { venue: string; market: string; symbols: readonly string[]; fromMs: number; toMsExclusive: number },
): Promise<number> {
  if (q.symbols.length === 0) return 0;
  const rows = await db.query<{ n: string }>(
    `select count(distinct open_time) as n
       from candles_1m
      where venue = $1 and market = $2 and symbol = any($3::text[])
        and open_time >= $4 and open_time < $5`,
    [q.venue, q.market, q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  return Number(rows[0]?.n ?? 0);
}

export interface OiSlot { timeSec: number; value: number }

/** Open-interest slots in a window, oldest first. 5-minute cadence, so a 7-day read is ~2,000 rows. */
export async function oiSlots(
  db: DbHandle,
  q: { venue: string; symbols: readonly string[]; fromMs: number; toMsExclusive: number },
): Promise<OiSlot[]> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{ ts: Date; oi_base: string }>(
    `select ts, oi_base
       from open_interest_5m
      where venue = $1 and symbol = any($2::text[]) and ts >= $3 and ts < $4
      order by ts`,
    [q.venue, q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  return rows.map((r) => ({ timeSec: sec(r.ts), value: Number(r.oi_base) }));
}

export interface SettlementRow { venue: string; timeSec: number; rate: number }

/**
 * The last `limit` settlements per venue, newest-first in SQL and returned oldest-first.
 *
 * `funding.binance.pct30d` is a percentile over the venue's last 90 SETTLEMENTS, not over a
 * calendar window — the two differ whenever a venue's interval is not 8 h, which is the
 * convention `matchesSettlementConvention` checks before the key is allowed to claim "30d".
 */
export async function recentSettlements(
  db: DbHandle,
  q: { symbols: readonly string[]; beforeMs: number; limitPerVenue: number },
): Promise<SettlementRow[]> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{ venue: string; funding_time: Date; rate: number }>(
    `select venue, funding_time, rate from (
       select venue, funding_time, rate,
              row_number() over (partition by venue order by funding_time desc) as rn
         from funding_settlements
        where symbol = any($1::text[]) and funding_time <= $2
     ) ranked
      where rn <= $3
      order by venue, funding_time`,
    [q.symbols, asDate(q.beforeMs), q.limitPerVenue],
  );
  return rows.map((r) => ({ venue: r.venue, timeSec: sec(r.funding_time), rate: Number(r.rate) }));
}

/** The most recent predicted funding rate at or before an instant, from `mark_funding_1m`. */
export async function predictedFundingAt(
  db: DbHandle,
  q: { venue: string; symbols: readonly string[]; atMs: number; withinMs: number },
): Promise<number | null> {
  if (q.symbols.length === 0) return null;
  const rows = await db.query<{ predicted_funding_rate: number | null }>(
    `select predicted_funding_rate
       from mark_funding_1m
      where venue = $1 and symbol = any($2::text[])
        and ts <= $3 and ts > $4 and predicted_funding_rate is not null
      order by ts desc
      limit 1`,
    [q.venue, q.symbols, asDate(q.atMs), asDate(q.atMs - q.withinMs)],
  );
  const value = rows[0]?.predicted_funding_rate;
  return value === undefined || value === null ? null : Number(value);
}

/** Long/short ratios per kind in a window, oldest first. */
export async function longShortSeries(
  db: DbHandle,
  q: { venue: string; symbols: readonly string[]; fromMs: number; toMsExclusive: number },
): Promise<Array<{ kind: string; timeSec: number; ratio: number }>> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{ kind: string; ts: Date; ratio: number | null }>(
    `select kind, ts, ratio
       from long_short_5m
      where venue = $1 and symbol = any($2::text[]) and ts >= $3 and ts < $4
        and ratio is not null
      order by kind, ts`,
    [q.venue, q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  return rows.map((r) => ({ kind: r.kind, timeSec: sec(r.ts), ratio: Number(r.ratio) }));
}

/**
 * Liquidation notional per side, bucketed to a fixed width — one query for both the frame's own
 * windows and the trailing history the z-score needs.
 *
 * Buckets are epoch-anchored with `to_timestamp(floor(extract(epoch from ts) / w) * w)`, the
 * same anchoring `src/derive/bucket.ts` uses, so a bucket here lines up with a bucket there.
 * **Every venue, no venue filter**: §8.2's liquidation keys are market-wide and restricting
 * them to one venue is the IB-BUG-011 shape again.
 */
export async function liquidationBuckets(
  db: DbHandle,
  q: { symbols: readonly string[]; fromMs: number; toMsExclusive: number; widthSec: number },
): Promise<Array<{ bucketSec: number; side: string; usd: number }>> {
  if (q.symbols.length === 0) return [];
  const rows = await db.query<{ bucket: Date; side: string; usd: string }>(
    `select to_timestamp(floor(extract(epoch from ts) / $4) * $4) as bucket,
            side,
            sum(notional) as usd
       from liquidations
      where symbol = any($1::text[]) and ts >= $2 and ts < $3
      group by bucket, side
      order by bucket`,
    [q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive), q.widthSec],
  );
  return rows.map((r) => ({ bucketSec: sec(r.bucket), side: r.side, usd: Number(r.usd) }));
}

/**
 * When the liquidation table starts — the z-score's history floor, asked ONCE per pass.
 *
 * **Deliberately not per symbol, for two reasons.**
 *
 * *Correctness:* "do we have fourteen days of liquidation history" is a question about when the
 * collectors started, not about whether this particular coin happened to liquidate. A per-symbol
 * floor tells a genuinely quiet coin it has insufficient history, which is a different claim and
 * a false one. (`collector_heartbeats.first_seen_at` would be the ideal source and is not usable
 * yet: migration 010 is recent, so it reads 2026-10-12 while the data itself reaches back to
 * 2026-09-28 — it would refuse a fortnight of real history.)
 *
 * *Cost:* a secondary argument, and worth stating precisely because a single probe made it look
 * like the main one. Five runs of each shape on `insight_dev2`, 2026-10-12: symbol-filtered
 * `min(ts)` 1,919 / 37 / 30 / 26 / 30 ms; `ts < cutoff … limit 1` 19 / 15 / 14 / 26 / 13 ms;
 * unfiltered `min(ts)` 26 / 26 / 86 / 36 / 32 ms. **Warm, all three shapes are the same tens of
 * milliseconds** — the only large number anywhere is the first touch of the partitions, which
 * costs ~1.3–1.9 s whichever query pays it. An earlier revision of this comment read a single
 * cold probe as proof that the per-symbol shape was 1.2 s and the fix was 7 ms. Both numbers
 * were wrong, in opposite directions.
 *
 * So cost does not decide this; correctness does, and once per pass is still the cheaper of two
 * acceptable options.
 *
 * Returns null when the table is empty.
 */
export async function liquidationHistoryStartMs(db: DbHandle): Promise<number | null> {
  const rows = await db.query<{ first: Date | null }>(`select min(ts) as first from liquidations`);
  const first = rows[0]?.first;
  return first === undefined || first === null ? null : new Date(first).getTime();
}

/**
 * Minutes inside a window already recorded as not collected.
 *
 * This is the evidence that turns a chaseable `incomplete_input` into a permanent
 * `explained_absence`: the data is gone, it is counted ONCE in `collector_gaps`, and counting it
 * again per frame would keep an alarm lit that nobody can clear.
 *
 * Overlap is clipped to the window — a gap that starts before it or ends after it contributes
 * only the minutes actually inside, because a four-hour outage straddling a 15-minute close did
 * not cost that close four hours.
 */
export async function recordedGapMinutes(
  db: DbHandle,
  q: { stream: string; symbols: readonly string[]; fromMs: number; toMsExclusive: number },
): Promise<number> {
  const rows = await db.query<{ minutes: string | null }>(
    `select sum(
              extract(epoch from (least(gap_to, $4) - greatest(gap_from, $3))) / 60
            ) as minutes
       from collector_gaps
      where stream = $1
        and (symbol is null or symbol = any($2::text[]))
        and gap_from < $4 and gap_to > $3`,
    [q.stream, q.symbols, asDate(q.fromMs), asDate(q.toMsExclusive)],
  );
  const minutes = rows[0]?.minutes;
  return minutes === undefined || minutes === null ? 0 : Math.max(0, Math.round(Number(minutes)));
}

/**
 * When the perp listed, as ms UTC.
 *
 * Minutes before it are minutes the venue never produced: not a collection failure, not
 * chaseable, and not something a counter should ever ask anyone to fix.
 */
export async function listedPerpMs(db: DbHandle, symbolId: string): Promise<number | null> {
  const rows = await db.query<{ listed_perp: Date }>(
    `select listed_perp from symbols where id = $1`,
    [symbolId],
  );
  const listed = rows[0]?.listed_perp;
  return listed === undefined ? null : new Date(listed).getTime();
}

export interface SymbolIdentity {
  /** The perp spelling at every venue, de-duplicated. Empty when the symbol is unknown. */
  perpSpellings: string[];
  /** Binance's own perp spelling, for the single-venue reads. Empty when it has none. */
  binancePerp: string[];
  /** Binance's spot spelling, or null when the symbol has no spot market. */
  binanceSpot: string | null;
  /** When the perp listed, ms UTC. Minutes before it are minutes the venue never produced. */
  listedPerpMs: number | null;
}

/**
 * Everything the pass needs from the `symbols` row, in ONE read.
 *
 * It replaces four separate queries per symbol — `venueSpellings` twice, `spotSpelling` and
 * `listedPerpMs` — all hitting the same row of the same small table. Thirty symbols made that
 * 120 round trips per pass to answer a question that has one answer per symbol.
 *
 * The venue mapping is the same one `venueSpellings` applies (IB-BUG-011): canonical id ->
 * each venue's own spelling, and an unknown symbol yields an EMPTY list, never a fallback to
 * the raw string — a silent fallback is how that bug read as a quiet market.
 */
export async function symbolIdentity(db: DbHandle, symbolId: string): Promise<SymbolIdentity> {
  const rows = await db.query<{
    binance_perp: string | null; bybit_linear: string | null; okx_swap: string | null;
    binance_spot: string | null; listed_perp: Date | null;
  }>(
    `select binance_perp, bybit_linear, okx_swap, binance_spot, listed_perp
       from symbols where id = $1`,
    [symbolId],
  );
  const row = rows[0];
  if (!row) {
    return { perpSpellings: [], binancePerp: [], binanceSpot: null, listedPerpMs: null };
  }
  const nonEmpty = (s: string | null): s is string => s !== null && s.length > 0;
  return {
    perpSpellings: [...new Set([row.binance_perp, row.bybit_linear, row.okx_swap].filter(nonEmpty))],
    binancePerp: nonEmpty(row.binance_perp) ? [row.binance_perp] : [],
    binanceSpot: nonEmpty(row.binance_spot) ? row.binance_spot : null,
    listedPerpMs: row.listed_perp === null ? null : new Date(row.listed_perp).getTime(),
  };
}

/**
 * The venue's spelling of the SPOT listing, or null when the symbol has no spot market.
 *
 * `venueSpellings` resolves perpetual contracts only (`binance_perp`, `bybit_linear`,
 * `okx_swap`), so the CVD spot keys need this. Null is a real answer and not a failure: a
 * perp-only symbol has no spot CVD, and the calculator refuses rather than substituting the
 * perp's — which would put one market's flow under the other's name.
 */
export async function spotSpelling(db: DbHandle, symbolId: string): Promise<string | null> {
  const rows = await db.query<{ binance_spot: string | null }>(
    `select binance_spot from symbols where id = $1`,
    [symbolId],
  );
  const spot = rows[0]?.binance_spot;
  return spot === undefined || spot === null || spot.length === 0 ? null : spot;
}

/** The signal set, in rank order — the symbols the pass runs for. */
export async function signalSetSymbols(db: DbHandle): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from symbols
      where in_signal_set and active
      order by volume_rank nulls last, id`,
  );
  return rows.map((r) => r.id);
}
