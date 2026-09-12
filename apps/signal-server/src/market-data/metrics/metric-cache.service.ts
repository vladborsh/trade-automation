import { Injectable } from '@nestjs/common';
import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';

// architecture/chart-layouts.md §4.4 — "MetricCache ... 30 days default [depth]", matching the
// venue's own openInterestHist retention (binance-metrics.adapter.ts) so the cache can hold
// everything backfill will ever bring in one pass.
const DEFAULT_DEPTH_MS = 30 * 24 * 60 * 60_000;

function key(instrument: InstrumentId, metric: MetricKind): string {
  return `${instrument}|${metric}`;
}

/**
 * architecture/chart-layouts.md §4.4 — in-memory ring buffer per (instrument, metric) of raw
 * observations (not yet bucketed to a timeframe — that happens at read time via
 * `bucketObservations`, mirroring how CandleCache holds closed bars and the resampler derives
 * coarser ones on demand).
 */
@Injectable()
export class MetricCache {
  private readonly observations = new Map<string, MetricObservation[]>();
  private readonly depthMs = DEFAULT_DEPTH_MS;

  /** Upserts by (instrument, metric, time), keeping ascending order; trims beyond the depth window. */
  upsert(observation: MetricObservation): void {
    const k = key(observation.instrument, observation.metric);
    const list = this.observations.get(k) ?? [];
    const idx = list.findIndex((o) => o.time === observation.time);
    if (idx >= 0) {
      list[idx] = observation;
    } else {
      let insertAt = list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].time < observation.time) {
          insertAt = i + 1;
          break;
        }
        if (i === 0) insertAt = 0;
      }
      list.splice(insertAt, 0, observation);
    }
    const cutoff = observation.time - this.depthMs;
    while (list.length > 0 && list[0].time < cutoff) list.shift();
    this.observations.set(k, list);
  }

  window(instrument: InstrumentId, metric: MetricKind): readonly MetricObservation[] {
    return this.observations.get(key(instrument, metric)) ?? [];
  }

  query(instrument: InstrumentId, metric: MetricKind, from: number, to: number): MetricObservation[] {
    return this.window(instrument, metric).filter((o) => o.time >= from && o.time <= to);
  }

  latest(instrument: InstrumentId, metric: MetricKind): MetricObservation | null {
    const list = this.window(instrument, metric);
    return list.length > 0 ? list[list.length - 1] : null;
  }

  /** Whether an in-window request is fully covered by what the cache currently holds. */
  covers(instrument: InstrumentId, metric: MetricKind, from: number): boolean {
    const list = this.window(instrument, metric);
    return list.length > 0 && list[0].time <= from;
  }
}
