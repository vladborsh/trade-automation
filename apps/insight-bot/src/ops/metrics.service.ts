import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';
import { cacheSnapshot } from './cache-registry';
import { StreamRegistry } from './stream-registry';

/**
 * architecture/insight-bot-system-design.md §6.1 — the six metrics `/metrics` exposes, named
 * exactly as that section lists them. Counters are incremented by the collectors and writers
 * (IB-005 onwards); the two gauges are computed at scrape time from the `StreamRegistry` and
 * the Binance weight tracker, so they cannot drift from what the admin health page (`/api/web/health/streams`) reports.
 */
@Injectable()
export class MetricsService {
  readonly registry = new client.Registry();

  /**
   * §4.5 — the REST weight used in the trailing minute, against Binance's 2400/min budget.
   *
   * A **live source**, not a value pushed in on each poll: a pushed figure goes stale the moment
   * the poll ends and then misreports for the whole gap until the next one. Measured on IB-007's
   * acceptance run — the gauge sat at 150 for five minutes after a pass whose calls had long
   * since aged out of the trailing minute. The collector registers its tracker here at boot and
   * both `/metrics` and the admin health page (`/api/web/health/streams`) read it at the instant they are asked.
   */
  private weightSource: (() => number) | null = null;
  private binanceWeightUsed1m = 0;
  /** IB-006: spot's own trailing-minute weight, against its own 6000/min ceiling (§4.5). */
  private binanceSpotWeightUsed1m = 0;

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

  /**
   * IB-BUG-018 — liquidation events deliberately NOT stored, per venue and reason. Binance's
   * `!forceOrder@arr` also carries COIN-M (inverse, sized in USD contracts), delivery, stablecoin-
   * and BTC-quoted contracts; storing them as price × qty inflated totals ~760×. They are counted
   * here so "skipped" is a number, never a silence.
   */
  readonly liquidationsSkipped = new client.Counter({
    name: 'ib_liquidations_skipped_total',
    help: 'Liquidation events not stored because the contract cannot be priced as USDT-linear, per venue and reason',
    labelNames: ['venue', 'reason'],
    registers: [this.registry],
  });

  constructor(private readonly streams: StreamRegistry) {
    new client.Gauge({
      name: 'ib_stream_last_message_age_seconds',
      help: 'Seconds since the last message on a stream',
      labelNames: ['stream'],
      registers: [this.registry],
      collect() {
        // A stream with no message yet is reported as null by the admin health page; a gauge has no null, so
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
        this.set(self.getBinanceWeightUsed1m());
      },
    });

    // IB-096: where the memory is — the process split and each cache's entries, read at scrape time
    new client.Gauge({
      name: 'ib_process_memory_bytes',
      help: 'process.memoryUsage(): rss, heap_total, heap_used, external, array_buffers',
      labelNames: ['kind'],
      registers: [this.registry],
      collect() {
        const m = process.memoryUsage();
        this.set({ kind: 'rss' }, m.rss);
        this.set({ kind: 'heap_total' }, m.heapTotal);
        this.set({ kind: 'heap_used' }, m.heapUsed);
        this.set({ kind: 'external' }, m.external);
        this.set({ kind: 'array_buffers' }, m.arrayBuffers);
      },
    });
    new client.Gauge({
      name: 'ib_cache_entries',
      help: 'Entries held per in-memory cache and key family; state=expired are past their TTL but not yet dropped',
      labelNames: ['cache', 'family', 'state'],
      registers: [this.registry],
      collect() {
        this.reset();
        for (const s of cacheSnapshot()) {
          this.set({ cache: s.cache, family: s.family, state: 'live' }, s.entries - s.expired);
          this.set({ cache: s.cache, family: s.family, state: 'expired' }, s.expired);
        }
      },
    });

    // A separate series, never added to the futures gauge: the venue meters `api.binance.com` and
    // `fapi.binance.com` apart, so each number is only meaningful against its own ceiling (§6.1).
    new client.Gauge({
      name: 'ib_binance_spot_weight_used_1m',
      help: 'Binance SPOT REST weight used in the trailing minute (budget 6000/min, §4.2)',
      registers: [this.registry],
      collect() {
        this.set(self.getBinanceSpotWeightUsed1m());
      },
    });
  }

  /** Registers the live reader. The collector calls this once, at boot. */
  setBinanceWeightSource(source: () => number): void {
    this.weightSource = source;
  }

  /** Fallback for a process with no collector running (the scaffold's 0). */
  setBinanceWeightUsed1m(weight: number): void {
    this.binanceWeightUsed1m = weight;
  }

  getBinanceWeightUsed1m(): number {
    return this.weightSource !== null ? this.weightSource() : this.binanceWeightUsed1m;
  }

  /** IB-006: the spot collector reports its `x-mbx-used-weight-1m` here, and nowhere else. */
  setBinanceSpotWeightUsed1m(weight: number): void {
    this.binanceSpotWeightUsed1m = weight;
  }

  getBinanceSpotWeightUsed1m(): number {
    return this.binanceSpotWeightUsed1m;
  }
}
