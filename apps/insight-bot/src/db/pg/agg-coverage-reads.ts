/**
 * IB-056 — `candles_agg` against the 1m tape that feeds it, per `(symbol, market, tf)`.
 *
 * Its own file rather than an addition to `coverage-reads.ts`, per that file's own note: new reads
 * go in a new file so two developers touching the coverage surface do not collide.
 *
 * The question this answers is **derivable or unfetchable**, and the only place it can be answered
 * is here, across the two layers: a bucket with no `candles_agg` row has no `bars` column to read,
 * so the 1m rows have to be counted. That is why this is a join and not a count over `candles_agg`.
 *
 * Every query is lower-bounded on `open_time`. `feature-inputs.repo.ts` documents a measured
 * 2,216 ms full-partition scan for an unbounded `min(open_time)` on this table, and the same cost
 * applies here with a larger constant: the classification touches every 1m row in its span.
 */
import { bucketStart, TF_MINUTES } from '../../derive/bucket';
import type { AggTimeframe } from '../../collectors/writers/tables';
import type { DbHandle } from '../db.port';

/** One `(symbol, market, tf)` series' standing, as the SQL returns it. */
export interface AggCoverageRow {
  symbol: string;
  market: string;
  tf: AggTimeframe;
  /** Buckets `candles_agg` holds with `complete = true`. */
  held: number;
  /** Tape-complete buckets with no complete `candles_agg` row: a pass we have not run. */
  derivable: number;
  /** Buckets the 1m tape cannot support: the minutes are missing, so only the venue has them. */
  unfetchable: number;
  /** ms UTC of the oldest derivable bucket, or null when there is none. */
  oldestDerivableMs: number | null;
}

/**
 * `date_bin` needs an origin, and every timeframe here divides a UTC day, so any UTC midnight
 * works as one. This is the same flooring `bucketStart` does in `bucket.ts`; it is restated in SQL
 * rather than imported because the grouping has to happen in the database.
 */
const BIN_ORIGIN = '2020-01-06 00:00:00+00';

/**
 * Classify every bucket of every series holding 1m rows in `[fromMs, nowMs)`.
 *
 * **The live edge is excluded per timeframe, not once.** The bucket currently filling has a
 * partial tape through no fault of anyone's, and counting it would put a standing 1 in the
 * `unfetchable` column of every series — an alarm that cannot be cleared, which the frame-coverage
 * contract already explains stops being read. A single cutoff cannot do this: flooring to 15m
 * leaves today's `1d` bucket half-filled and therefore permanently "unfetchable", while flooring
 * to 1d throws away a day of 15m. So each timeframe carries its own boundary from `bucketStart`,
 * the same function `foldBucket` floors with.
 *
 * `complete` likewise comes from `TF_MINUTES` rather than a literal, so a timeframe added to that
 * record is classified correctly here with no edit.
 */
export async function aggCoverage(
  db: DbHandle,
  args: { fromMs: number; nowMs: number; venue: string; timeframes: readonly AggTimeframe[] },
): Promise<AggCoverageRow[]> {
  const { fromMs, nowMs, venue, timeframes } = args;
  if (timeframes.length === 0) return [];

  // (tf, minutes, cutoff) as a VALUES list, so one statement covers every timeframe and each
  // keeps its own live edge. The cutoff is the start of the bucket still filling: buckets at or
  // after it are not yet answerable and are left out entirely.
  const tfValues = timeframes
    .map((_, i) => `($${i * 3 + 4}::text, $${i * 3 + 5}::int, $${i * 3 + 6}::timestamptz)`)
    .join(', ');
  const tfParams = timeframes.flatMap((tf) => [tf, TF_MINUTES[tf], new Date(bucketStart(tf, nowMs))]);
  const toMsExclusive = nowMs;

  const rows = await db.query<{
    symbol: string;
    market: string;
    tf: string;
    held: string;
    derivable: string;
    unfetchable: string;
    oldest_derivable: Date | null;
  }>(
    `with tf(tf, mins, cutoff) as (values ${tfValues}),
          buckets as (
            select m.market, m.symbol, tf.tf, tf.mins, tf.cutoff,
                   date_bin(make_interval(mins => tf.mins), m.open_time, timestamptz '${BIN_ORIGIN}') as bucket,
                   count(*) as one_min_held
              from candles_1m m
              cross join tf
             where m.venue = $3
               and m.open_time >= $1
               and m.open_time < $2
             group by 1, 2, 3, 4, 5, 6
          ),
          classified as (
            select b.market, b.symbol, b.tf,
                   b.one_min_held >= b.mins as tape_complete,
                   (a.open_time is not null and a.complete) as agg_complete,
                   b.bucket
              from buckets b
              left join candles_agg a
                on a.venue = $3
               and a.market = b.market
               and a.symbol = b.symbol
               and a.tf = b.tf
               and a.open_time = b.bucket
               and a.open_time >= $1
               and a.open_time < $2
             where b.bucket < b.cutoff
          )
     select symbol, market, tf,
            count(*) filter (where agg_complete) as held,
            count(*) filter (where not agg_complete and tape_complete) as derivable,
            count(*) filter (where not agg_complete and not tape_complete) as unfetchable,
            min(bucket) filter (where not agg_complete and tape_complete) as oldest_derivable
       from classified
      group by 1, 2, 3
      order by symbol, market, tf`,
    [new Date(fromMs), new Date(toMsExclusive), venue, ...tfParams],
  );

  return rows.map((r) => ({
    symbol: r.symbol,
    market: r.market,
    tf: r.tf as AggTimeframe,
    held: Number(r.held),
    derivable: Number(r.derivable),
    unfetchable: Number(r.unfetchable),
    oldestDerivableMs: r.oldest_derivable === null ? null : r.oldest_derivable.getTime(),
  }));
}
