import { Inject, Injectable, Logger } from '@nestjs/common';
import { Candle, InstrumentId, ReplayHistoryResponse, TIMEFRAME_MS, Timeframe } from '@trade-automation/contracts';
import { foldOneMinute } from '@trade-automation/replay-core';
import { CANDLE_STORE, CandleStore } from '../storage/candle-store.port';
import { Range, closedBarsEnd, formingRange, mergeBars, rangesToFold } from './replay-window';

/**
 * architecture/backtest-app-system-design.md §5.1, §7.2 — GET …/candles: the last `limit`
 * closed `tf` bars with `openTime + tfMs <= before`, plus the bar forming at `before`.
 *
 * Closed bars come from the store's persisted `tf` (venue and T-012 `resampled` bars alike).
 * Where the persisted `tf` does not reach (before its first or after its last bar) they are
 * folded on demand from 1m with replay-core's `foldOneMinute`, logged at `warn` so the derive job
 * can be run. The forming bar is always `foldOneMinute` over the 1m in its bucket, the same fold
 * the client runs (§5.4), so both sides build it bit for bit.
 *
 * The cursor guard (`before <= cursor_ms`) is the caller's; this service serves any `before`.
 */
@Injectable()
export class ReplayHistoryService {
  private readonly logger = new Logger(ReplayHistoryService.name);

  constructor(@Inject(CANDLE_STORE) private readonly store: CandleStore) {}

  async history(instrument: InstrumentId, tf: Timeframe, before: number, limit: number): Promise<ReplayHistoryResponse> {
    const [bars, forming] = await Promise.all([
      this.closedBars(instrument, tf, closedBarsEnd(before, tf), limit),
      this.formingBar(instrument, tf, before),
    ]);
    return { bars, forming };
  }

  private async formingBar(instrument: InstrumentId, tf: Timeframe, before: number): Promise<Candle | null> {
    const range = formingRange(before, tf);
    if (!range) return null;
    const bars1m = await this.store.query(instrument, '1m', range.from, range.to - 1);
    return foldOneMinute(bars1m, tf, before).forming;
  }

  /**
   * Walks backwards from `end` in windows that double in size, so a gap in the tape (a weekend,
   * a market holiday, an instrument that starts later) costs a few extra reads, not a scan.
   * Stops at `limit` bars or at the earliest bar the store holds for `tf` or 1m.
   */
  private async closedBars(instrument: InstrumentId, tf: Timeframe, end: number, limit: number): Promise<Candle[]> {
    const tfMs = TIMEFRAME_MS[tf];
    const [persisted, coverage1m] = await Promise.all([
      this.store.coverage(instrument, tf),
      tf === '1m' ? Promise.resolve(null) : this.store.coverage(instrument, '1m'),
    ]);
    const starts = [persisted?.from, coverage1m?.from].filter((v): v is number => v !== undefined);
    if (starts.length === 0) return [];
    const earliest = Math.floor(Math.min(...starts) / tfMs) * tfMs;

    let collected: Candle[] = [];
    const folded: Range[] = [];
    let windowEnd = end;
    let span = limit * tfMs;
    while (collected.length < limit && windowEnd > earliest) {
      const windowStart = Math.max(windowEnd - span, earliest);
      const stored = persisted ? await this.store.query(instrument, tf, windowStart, windowEnd - 1) : [];
      const fromOneMinute: Candle[] = [];
      if (tf !== '1m' && coverage1m) {
        for (const range of rangesToFold({ from: windowStart, to: windowEnd }, persisted, tf)) {
          if (range.to <= coverage1m.from || range.from > coverage1m.to) continue;
          const bars1m = await this.store.query(instrument, '1m', range.from, range.to - 1);
          if (bars1m.length === 0) continue;
          // Fold up to the close of the last bucket that has 1m, not up to range.to: past a gap,
          // foldOneMinute drops that bucket instead of closing it (reported to the Tech Lead).
          // Every 1m in the range is revealed, so this upToMs gives the same closed bars.
          const upTo = Math.min(range.to, Math.floor(bars1m[bars1m.length - 1].openTime / tfMs) * tfMs + tfMs);
          fromOneMinute.push(
            ...foldOneMinute(bars1m, tf, upTo).closed.filter((c) => c.openTime >= range.from && c.openTime + tfMs <= range.to),
          );
          folded.push(range);
        }
      }
      collected = [...mergeBars(stored, fromOneMinute), ...collected];
      windowEnd = windowStart;
      span *= 2;
    }

    if (folded.length > 0) {
      const from = new Date(Math.min(...folded.map((r) => r.from))).toISOString();
      const to = new Date(Math.max(...folded.map((r) => r.to))).toISOString();
      this.logger.warn(
        `${instrument} ${tf}: no persisted bars for [${from}, ${to}) — folded from 1m on demand; run the derive-timeframes job.`,
      );
    }
    return collected.slice(-limit);
  }
}
