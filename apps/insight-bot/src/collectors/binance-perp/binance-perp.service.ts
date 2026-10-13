import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BinanceAdapter } from '@trade-automation/binance-client';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { lastCandleOpenTimes } from '../../db/pg/collector-reads';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { BinanceWeightTracker } from './binance-weight.tracker';
import { BinancePerpCollector, MARKET, VENUE_LOGGER_NAME } from './perp-collector';
import { BinanceSocket } from '../binance-common/socket';
import { PerpRest } from './rest';
import { neverReject } from '../../ops/never-reject';

/** One tick per second drives the mode policy, the minute boundary and the degraded pollers. */
export const TICK_MS = 1_000;

/**
 * IB-005 — the Nest shell around `BinancePerpCollector`: it builds the real ports (socket, REST,
 * writers, registry) and runs the clock. All behaviour lives in the collector and the pure
 * modules beside it, which is why this file has no logic worth testing on its own.
 */
@Injectable()
export class BinancePerpService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VENUE_LOGGER_NAME);
  private collector: BinancePerpCollector | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
    private readonly weight: BinanceWeightTracker,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const symbols = this.config.symbols.map((s) => s.binance_perp);
    if (symbols.length === 0) {
      this.logger.warn('no universe symbols with a binance_perp mapping — collector idle');
      return;
    }

    const restBaseUrl = this.config.env.get('BINANCE_FUTURES_REST_BASE_URL');
    const wsBaseUrl = this.config.env.get('BINANCE_FUTURES_WS_BASE_URL');
    // IB-007: both Binance loops share one IP budget, so they share one tracker rather than each
    // pushing its own number at the gauge. This one is the authoritative half — /fapi/* answers
    // carry `x-mbx-used-weight-1m`, and a header always beats the poller's local estimate (the
    // /futures/data/* endpoints send no header at all, measured 2026-09-28).
    const rest = new PerpRest({ baseUrl: restBaseUrl, onWeight: (w) => this.weight.recordHeader(w) });
    const adapter = new BinanceAdapter(restBaseUrl, wsBaseUrl, {
      log: (m) => this.logger.log(m),
      warn: (m) => this.logger.warn(m),
    });

    this.collector = new BinancePerpCollector({
      symbols,
      signalSet: this.config.signalSet,
      writers: this.writers,
      registry: this.registry,
      metrics: this.metrics,
      rest,
      candles: adapter,
      socketFactory: (handlers, streams) => new BinanceSocket({ wsBaseUrl, streams, handlers }),
      lastOpenTimes: this.db ? () => lastCandleOpenTimes(this.db as Db, 'binance', MARKET) : undefined,
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    await this.collector.start();
    this.timer = setInterval(() => neverReject(this.logger, 'binance-perp tick', async () => this.collector?.tick()), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`binance-perp collector started for ${symbols.length} symbols`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.collector?.stop();
    this.collector = null;
  }
}
