import { MetricSource, MetricKind, MetricObservation, Venue } from '@trade-automation/contracts';

/**
 * architecture/chart-layouts.md §11.1 — a price of the instrument in its quoteCurrency, stamped
 * with the venue's `time` (ms UTC), used to derive a notional where the venue publishes none.
 */
export interface TipPrice {
  time: number;
  price: number;
}

/**
 * architecture/chart-layouts.md §4.4 — a separate port from VenueAdapter, not a method on it.
 * Capital.com has no open interest; forcing every venue adapter to implement (or throw from)
 * metric methods is the "is this really a candle instrument?" smell one layer down. Only
 * venues that actually expose a metric implement this port.
 *
 * architecture/aggregate-oi.md §3.2 — methods take a `MetricSource` ({id, venue, symbol,
 * quoteCurrency}), not an `Instrument`: aggregate legs (Bybit, Hyperliquid) are not chart
 * instruments. An `Instrument` satisfies `MetricSource` structurally.
 */
export interface MetricAdapter {
  readonly venue: Venue;
  readonly supports: readonly MetricKind[];

  /** REST history, paginated internally, ascending, at the source's native granularity. */
  fetchObservations(
    instrument: MetricSource,
    metric: MetricKind,
    from: number,
    to: number,
  ): Promise<MetricObservation[]>;

  /** One snapshot per call; the ingestion service owns the polling cadence. */
  fetchLatest(instrument: MetricSource, metric: MetricKind): Promise<MetricObservation>;

  /**
   * §11.1 — the price the venue's own notional uses, now; fetched in the same poll as
   * `fetchLatest`. Optional: without it, live snapshots simply carry no notional.
   */
  fetchTipPrice?(instrument: MetricSource): Promise<TipPrice>;

  /**
   * §11.1 legacy-row repair — ascending 1m price history (each point stamped at its bar's
   * close) covering `[t − 120 s, t]` for every `t` in `times` (ascending). Paginated and paced
   * internally.
   */
  fetchTipPriceHistory?(instrument: MetricSource, times: readonly number[]): Promise<TipPrice[]>;
}

export const METRIC_ADAPTERS = Symbol('METRIC_ADAPTERS');
