import { InstrumentId, MetricKind, MetricObservation } from '@trade-automation/contracts';

/** architecture/chart-layouts.md §4.4. */
export interface MetricStore {
  /** Idempotent on (instrument, metric, time). */
  upsert(observations: MetricObservation[]): Promise<void>;
  /** Ascending. */
  query(instrument: InstrumentId, metric: MetricKind, from: number, to: number): Promise<MetricObservation[]>;
  latestTime(instrument: InstrumentId, metric: MetricKind): Promise<number | null>;
}

export const METRIC_STORE = Symbol('METRIC_STORE');
