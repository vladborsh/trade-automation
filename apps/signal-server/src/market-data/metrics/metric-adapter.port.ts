import { Instrument, MetricKind, MetricObservation, Venue } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §4.4 — a separate port from VenueAdapter, not a method on it.
 * Capital.com has no open interest; forcing every venue adapter to implement (or throw from)
 * metric methods is the "is this really a candle instrument?" smell one layer down. Only
 * venues that actually expose a metric implement this port.
 */
export interface MetricAdapter {
  readonly venue: Venue;
  readonly supports: readonly MetricKind[];

  /** REST history, paginated internally, ascending, at the source's native granularity. */
  fetchObservations(
    instrument: Instrument,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]>;

  /** One snapshot per call; the ingestion service owns the polling cadence. */
  fetchLatest(instrument: Instrument, metric: MetricKind): Promise<MetricObservation>;
}

export const METRIC_ADAPTERS = Symbol('METRIC_ADAPTERS');
