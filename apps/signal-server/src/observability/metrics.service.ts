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

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });
  }
}
