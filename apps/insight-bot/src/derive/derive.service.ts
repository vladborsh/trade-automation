import { Injectable, Logger } from '@nestjs/common';
import type { AggTimeframe, CandleAggRow } from '../collectors/writers/tables';
import type { Db } from '../db/db.port';
import { Writers } from '../collectors/writers/batch-writer';
import { AGG_TIMEFRAMES, bucketStart, foldAll, foldBucket, justClosedBucket, MINUTE_MS, TF_MINUTES } from './bucket';
import { candles1mBetween, incompleteBuckets, seriesWithRows } from './derive.reads';

/**
 * IB-014 — folds 1m rows into `candles_agg` (design §8.1, D4).
 *
 * Two entry points over one pure fold: `deriveClosedBuckets` for the clock (every tf whose bucket
 * just closed) and `deriveRange` for `npm run derive -- --from --to`. Both write through
 * `Writers.candlesAgg`, whose upsert is keyed on (venue, market, symbol, tf, open_time), so
 * re-running either is idempotent — a re-derived bar replaces itself rather than duplicating.
 */
@Injectable()
export class DeriveService {
  private readonly logger = new Logger(DeriveService.name);

  constructor(
    private readonly db: Db,
    private readonly writers: Writers,
  ) {}

  /**
   * Every bucket that closed at `now`, for every series holding rows in it. Called on the minute
   * tick; a minute that closes no bucket does nothing and costs one map lookup.
   */
  async deriveClosedBuckets(now: number): Promise<number> {
    const closing = AGG_TIMEFRAMES.map((tf) => ({ tf, start: justClosedBucket(tf, now) })).filter(
      (c): c is { tf: AggTimeframe; start: number } => c.start !== null,
    );
    if (closing.length === 0) return 0;

    let written = 0;
    for (const { tf, start } of closing) {
      const span = TF_MINUTES[tf] * MINUTE_MS;
      const series = await seriesWithRows(this.db, start, start + span);
      const rows: CandleAggRow[] = [];
      for (const s of series) {
        const minutes = await candles1mBetween(this.db, s.venue, s.market, s.symbol, start, start + span);
        const bar = foldBucket(minutes, tf, start);
        if (bar) rows.push(bar);
      }
      if (rows.length > 0) {
        await this.writers.candlesAgg.write(rows);
        written += rows.length;
        const incomplete = rows.filter((r) => !r.complete).length;
        this.logger.log(
          `derived ${rows.length} ${tf} bars for ${new Date(start).toISOString()}` +
            (incomplete > 0 ? ` (${incomplete} incomplete)` : ''),
        );
      }
    }
    return written;
  }

  /**
   * Looks again at buckets still marked incomplete, and re-folds any whose missing minutes have
   * since arrived. Called every tick; bounded by `lookbackMs`, and idempotent because the upsert is
   * keyed on the bucket.
   *
   * This is what keeps a late 1m row from leaving a wrong bar on a chart for good: degraded-mode
   * REST polling (§16.1) can deliver the closing minute ~15 s after close, past §8.1's 5 s grace,
   * and GapRepair can fill a hole minutes later. Both are normal; a permanently short coarse bar is
   * not.
   */
  async healIncomplete(now: number, lookbackMs = 2 * 3_600_000): Promise<number> {
    const stale = await incompleteBuckets(this.db, now, lookbackMs);
    let healed = 0;
    for (const bucket of stale) {
      const tf = bucket.tf as AggTimeframe;
      const span = TF_MINUTES[tf] * MINUTE_MS;
      const start = bucket.openTime.getTime();
      if (start + span > now) continue; // still open: not late, just not finished
      const minutes = await candles1mBetween(this.db, bucket.venue, bucket.market, bucket.symbol, start, start + span);
      const bar = foldBucket(minutes, tf, start);
      if (!bar || bar.bars === 0) continue;
      await this.writers.candlesAgg.write([bar]);
      if (bar.complete) {
        healed++;
        this.logger.log(`${bucket.market} ${bucket.symbol} ${tf}@${bucket.openTime.toISOString()} is complete now (${bar.bars} bars)`);
      }
    }
    return healed;
  }

  /**
   * Re-derives every bucket touched by [fromMs, toMs). Used by the history command and safe to
   * re-run: the same 1m rows always fold to the same coarse bar.
   *
   * The window is widened to whole buckets, because a bar half of whose minutes sit outside the
   * requested range would otherwise be written as incomplete and *stay* that way — a derived hole
   * caused by how someone typed the command, which is the kind of wrong number that ends up on a
   * chart.
   */
  async deriveRange(fromMs: number, toMs: number, timeframes: readonly AggTimeframe[] = AGG_TIMEFRAMES): Promise<number> {
    let written = 0;
    for (const tf of timeframes) {
      const span = TF_MINUTES[tf] * MINUTE_MS;
      const from = bucketStart(tf, fromMs);
      const to = bucketStart(tf, toMs - 1) + span;
      const series = await seriesWithRows(this.db, from, to);
      for (const s of series) {
        const minutes = await candles1mBetween(this.db, s.venue, s.market, s.symbol, from, to);
        const bars = foldAll(minutes, tf);
        if (bars.length === 0) continue;
        await this.writers.candlesAgg.write(bars);
        written += bars.length;
        const incomplete = bars.filter((b) => !b.complete).length;
        this.logger.log(
          `${s.market} ${s.symbol} ${tf}: ${bars.length} bars` + (incomplete > 0 ? `, ${incomplete} incomplete` : ''),
        );
      }
    }
    return written;
  }
}
