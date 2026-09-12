import { Injectable } from '@nestjs/common';
import { Candle, InstrumentId, Timeframe } from '@trade-automation/contracts';

/**
 * architecture/live-signal-server.md §4.1 — in-memory ring buffer per (instrument, timeframe).
 * Default depths: 1m -> 3 days, 5m -> 10 days, 1h -> 45 days. Sized from strategies'
 * `warmupBars` at boot by `setMinDepth` (the cache must hold max(warmupBars) + margin).
 */
const DEFAULT_DEPTH_BARS: Record<Timeframe, number> = {
  '1m': 3 * 24 * 60, // 4320
  '5m': 10 * 24 * 12, // 2880
  '15m': 10 * 24 * 4, // 960
  '1h': 45 * 24, // 1080
  '4h': 45 * 6, // 270
  '1d': 400,
};

const WARMUP_MARGIN_BARS = 50;

function key(instrument: InstrumentId, tf: Timeframe): string {
  return `${instrument}|${tf}`;
}

@Injectable()
export class CandleCache {
  private readonly bars = new Map<string, Candle[]>();
  private readonly depth = new Map<string, number>();

  setMinDepth(instrument: InstrumentId, tf: Timeframe, bars: number): void {
    const k = key(instrument, tf);
    const wanted = bars + WARMUP_MARGIN_BARS;
    const current = this.depth.get(k) ?? DEFAULT_DEPTH_BARS[tf];
    this.depth.set(k, Math.max(current, wanted));
  }

  private depthFor(instrument: InstrumentId, tf: Timeframe): number {
    return this.depth.get(key(instrument, tf)) ?? DEFAULT_DEPTH_BARS[tf];
  }

  /** Upserts a closed candle by (instrument, timeframe, openTime), keeping ascending order. */
  upsert(candle: Candle): void {
    const k = key(candle.instrument, candle.timeframe);
    const list = this.bars.get(k) ?? [];
    const idx = list.findIndex((c) => c.openTime === candle.openTime);
    if (idx >= 0) {
      list[idx] = candle;
    } else {
      let insertAt = list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].openTime < candle.openTime) {
          insertAt = i + 1;
          break;
        }
        if (i === 0) insertAt = 0;
      }
      list.splice(insertAt, 0, candle);
    }
    const maxDepth = this.depthFor(candle.instrument, candle.timeframe);
    while (list.length > maxDepth) list.shift();
    this.bars.set(k, list);
  }

  window(instrument: InstrumentId, tf: Timeframe, limit?: number): readonly Candle[] {
    const list = this.bars.get(key(instrument, tf)) ?? [];
    return limit ? list.slice(Math.max(0, list.length - limit)) : list;
  }

  query(instrument: InstrumentId, tf: Timeframe, from: number, to: number): Candle[] {
    return (this.bars.get(key(instrument, tf)) ?? []).filter(
      (c) => c.openTime >= from && c.openTime <= to,
    );
  }

  latest(instrument: InstrumentId, tf: Timeframe): Candle | null {
    const list = this.bars.get(key(instrument, tf)) ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
  }

  /** Whether an in-window request is fully covered by what the cache currently holds. */
  covers(instrument: InstrumentId, tf: Timeframe, from: number): boolean {
    const list = this.bars.get(key(instrument, tf)) ?? [];
    return list.length > 0 && list[0].openTime <= from;
  }
}
