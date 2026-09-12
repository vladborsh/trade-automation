import { Injectable } from '@nestjs/common';
import { IndicatorPoint, InstrumentId } from '@trade-automation/contracts';

const WARMUP_MARGIN_BARS = 50;
const DEFAULT_DEPTH = 1440 + WARMUP_MARGIN_BARS;

function key(strategyId: string, instrument: InstrumentId, seriesId: string): string {
  return `${strategyId}|${instrument}|${seriesId}`;
}

/**
 * architecture/live-signal-server.md §11.3 — in-memory ring per (strategyId, instrument,
 * seriesId). NOT persisted: an indicator point is a recomputable by-product of candles, and
 * replay rebuilds the ring from scratch. Depth mirrors CandleCache.setMinDepth (the strategy's
 * warmupBars[tf] + margin) — set by StrategyRegistryService at boot.
 */
@Injectable()
export class IndicatorCache {
  private readonly points = new Map<string, IndicatorPoint[]>();
  private readonly depth = new Map<string, number>();

  setMinDepth(strategyId: string, instrument: InstrumentId, seriesId: string, bars: number): void {
    const k = key(strategyId, instrument, seriesId);
    const wanted = bars + WARMUP_MARGIN_BARS;
    const current = this.depth.get(k) ?? wanted;
    this.depth.set(k, Math.max(current, wanted));
  }

  append(point: IndicatorPoint): void {
    const k = key(point.strategyId, point.instrument, point.seriesId);
    const list = this.points.get(k) ?? [];
    const idx = list.findIndex((p) => p.time === point.time);
    if (idx >= 0) {
      list[idx] = point;
    } else {
      list.push(point);
    }
    const maxDepth = this.depth.get(k) ?? DEFAULT_DEPTH;
    while (list.length > maxDepth) list.shift();
    this.points.set(k, list);
  }

  /** Ascending, filtered to [from, to]; optionally restricted to one strategy. */
  query(instrument: InstrumentId, from: number, to: number, strategyId?: string): IndicatorPoint[] {
    const out: IndicatorPoint[] = [];
    for (const [k, list] of this.points) {
      const [sId, inst] = k.split('|');
      if (inst !== instrument) continue;
      if (strategyId && sId !== strategyId) continue;
      for (const point of list) {
        if (point.time >= from && point.time <= to) out.push(point);
      }
    }
    out.sort((a, b) => a.time - b.time);
    return out;
  }
}
