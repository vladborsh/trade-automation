import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';
import { StreamRegistry } from './stream-registry';

/**
 * architecture/insight-bot-system-design.md §6.1 — the six metrics `/metrics` exposes, named
 * exactly as that section lists them. Counters are incremented by the collectors and writers
 * (IB-005 onwards); the two gauges are computed at scrape time from the `StreamRegistry` and
 * the Binance weight tracker, so they cannot drift from what `/health` reports.
 */
@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  /** §4.5 — the REST weight used in the trailing minute, against Binance's 2400/min budget. */
  private binanceWeightUsed1m = 0;

  readonly rowsWritten = new client.Counter({
    name: 'ib_rows_written_total',
    help: 'Rows written per table by the writers module',
    labelNames: ['table'],
    registers: [this.registry],
  });

  readonly gapsDetected = new client.Counter({
    name: 'ib_gaps_detected_total',
    help: 'Gaps detected per stream',
    labelNames: ['stream'],
    registers: [this.registry],
  });

  readonly gapsUnrepaired = new client.Counter({
    name: 'ib_gaps_unrepaired_total',
    help: 'Gaps a repair attempt could not fill, per stream',
    labelNames: ['stream'],
    registers: [this.registry],
  });

  readonly wsReconnects = new client.Counter({
    name: 'ib_ws_reconnects_total',
    help: 'WebSocket reconnects per stream',
    labelNames: ['stream'],
    registers: [this.registry],
  });

  constructor(private readonly streams: StreamRegistry) {
    new client.Gauge({
      name: 'ib_stream_last_message_age_seconds',
      help: 'Seconds since the last message on a stream',
      labelNames: ['stream'],
      registers: [this.registry],
      collect() {
        // A stream with no message yet is reported as null by /health; a gauge has no null, so
        // it is simply not sampled until its first message — an absent series, which is what an
        // alert rule on "older than N seconds" needs (§6.2).
        for (const s of streams.snapshot()) {
          if (s.lastMessageAgeSec !== null) this.set({ stream: s.id }, s.lastMessageAgeSec);
        }
      },
    });

    const self = this;
    new client.Gauge({
      name: 'ib_binance_weight_used_1m',
      help: 'Binance REST weight used in the trailing minute (budget 2400/min, §4.5)',
      registers: [this.registry],
      collect() {
        this.set(self.binanceWeightUsed1m);
      },
    });
  }

  /** Called by the Binance REST client's weight tracker (IB-005); 0 until one exists. */
  setBinanceWeightUsed1m(weight: number): void {
    this.binanceWeightUsed1m = weight;
  }

  getBinanceWeightUsed1m(): number {
    return this.binanceWeightUsed1m;
  }
}
