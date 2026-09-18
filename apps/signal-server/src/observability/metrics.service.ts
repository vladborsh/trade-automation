import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

/**
 * architecture/live-signal-server.md §4.8 — "/metrics (Prometheus format) with: candles
 * received/closed per instrument, feed lag, gap count and repaired-bar count, strategy
 * evaluation duration and error count, WS clients and frames sent, storage flush latency."
 */
@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  readonly candlesReceived = new client.Counter({
    name: 'signal_server_candles_received_total',
    help: 'Candles received from a venue adapter (forming + closed)',
    labelNames: ['instrument', 'timeframe'],
    registers: [this.registry],
  });

  readonly candlesClosed = new client.Counter({
    name: 'signal_server_candles_closed_total',
    help: 'Closed candles forwarded downstream',
    labelNames: ['instrument', 'timeframe'],
    registers: [this.registry],
  });

  readonly feedLagMs = new client.Gauge({
    name: 'signal_server_feed_lag_ms',
    help: 'Milliseconds between a closed candle\'s openTime+timeframe and when it was processed',
    labelNames: ['instrument'],
    registers: [this.registry],
  });

  readonly gapCount = new client.Counter({
    name: 'signal_server_gap_count_total',
    help: 'Gaps detected in the 1m stream per instrument',
    labelNames: ['instrument'],
    registers: [this.registry],
  });

  readonly gapRepairedBars = new client.Counter({
    name: 'signal_server_gap_repaired_bars_total',
    help: 'Bars backfilled by GapRepair',
    labelNames: ['instrument'],
    registers: [this.registry],
  });

  readonly strategyEvalDurationMs = new client.Histogram({
    name: 'signal_server_strategy_eval_duration_ms',
    help: 'onCandle() duration',
    labelNames: ['strategyId', 'instrument'],
    buckets: [0.5, 1, 2, 5, 10, 25, 50, 100, 250],
    registers: [this.registry],
  });

  readonly strategyErrors = new client.Counter({
    name: 'signal_server_strategy_errors_total',
    help: 'Errors thrown by a strategy runner (caught, isolated)',
    labelNames: ['strategyId', 'instrument'],
    registers: [this.registry],
  });

  readonly wsClients = new client.Gauge({
    name: 'signal_server_ws_clients',
    help: 'Currently connected WebSocket clients',
    registers: [this.registry],
  });

  readonly wsFramesSent = new client.Counter({
    name: 'signal_server_ws_frames_sent_total',
    help: 'WebSocket frames sent to clients',
    labelNames: ['frameType'],
    registers: [this.registry],
  });

  readonly storageFlushLatencyMs = new client.Histogram({
    name: 'signal_server_storage_flush_latency_ms',
    help: 'WriteBuffer flush latency',
    buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [this.registry],
  });

  /**
   * architecture/live-signal-server.md §12.1/§12.5 item 3 — incremented whenever a resampled
   * and a venue-native bar exist for the same (instrument, timeframe, openTime) in the §12.1
   * overlap window and materially disagree. Diagnosable, never fatal: the resampled bar always
   * wins the cache slot regardless (`CandleCache`'s source-priority rule).
   */
  readonly venueNativeMismatchCount = new client.Counter({
    name: 'signal_server_venue_native_mismatch_count_total',
    help: 'Resampled vs venue-native bar disagreements at the same (instrument, timeframe, openTime)',
    labelNames: ['instrument', 'timeframe'],
    registers: [this.registry],
  });

  /** architecture/chart-layouts.md §4.4. */
  readonly metricObservationsTotal = new client.Counter({
    name: 'signal_server_metric_observations_total',
    help: 'Metric observations ingested (backfill + live poll)',
    labelNames: ['instrument', 'metric'],
    registers: [this.registry],
  });

  readonly metricPollErrorsTotal = new client.Counter({
    name: 'signal_server_metric_poll_errors_total',
    help: 'Errors from a MetricAdapter.fetchLatest poll',
    registers: [this.registry],
  });

  /**
   * architecture/chart-layouts.md §11.1 — a live snapshot stored without a derived notional
   * because no closed 1m candle of the instrument closed within 120 s before it.
   */
  readonly metricNotionalMissingTotal = new client.Counter({
    name: 'signal_server_metric_notional_missing_total',
    help: 'Live metric snapshots stored without notional (no fresh closed 1m candle price)',
    labelNames: ['instrument', 'metric'],
    registers: [this.registry],
  });

  /**
   * architecture/aggregate-oi.md §2 — a Bybit row whose legacy `openInterest` is not
   * 2 × `singleOpenInterest` (± 0.001): the venue changed a field's meaning.
   */
  readonly metricSidednessDriftTotal = new client.Counter({
    name: 'signal_server_metric_sidedness_drift_total',
    help: 'Venue rows whose two-sided open interest is not exactly 2x the one-sided figure',
    labelNames: ['source'],
    registers: [this.registry],
  });

  /** architecture/economic-calendar.md §8. */
  readonly calendarPollsTotal = new client.Counter({
    name: 'signal_server_calendar_polls_total',
    help: 'ForexFactory feed polls',
    labelNames: ['result'],
    registers: [this.registry],
  });

  readonly calendarPollErrorsTotal = new client.Counter({
    name: 'signal_server_calendar_poll_errors_total',
    help: 'ForexFactory feed poll errors',
    registers: [this.registry],
  });

  readonly calendarLastSuccessfulPollAgeSeconds = new client.Gauge({
    name: 'signal_server_calendar_last_successful_poll_age_seconds',
    help: 'Seconds since the last successful calendar feed poll',
    registers: [this.registry],
  });

  readonly calendarEventsInWindow = new client.Gauge({
    name: 'signal_server_calendar_events_in_window',
    help: 'Events currently in the calendar cache lookback window',
    registers: [this.registry],
  });

  readonly calendarEventChangesTotal = new client.Counter({
    name: 'signal_server_calendar_event_changes_total',
    help: 'Calendar events created/updated/removed/actual-backfilled',
    labelNames: ['change'],
    registers: [this.registry],
  });

  readonly calendarUnjoinedRowsTotal = new client.Counter({
    name: 'signal_server_calendar_unjoined_rows_total',
    help: 'Feed rows that could not be joined to a series id (ffx: fallback)',
    registers: [this.registry],
  });

  readonly calendarNotificationsTotal = new client.Counter({
    name: 'signal_server_calendar_notifications_total',
    help: 'Calendar notifications fired',
    labelNames: ['kind'],
    registers: [this.registry],
  });

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });
  }
}
