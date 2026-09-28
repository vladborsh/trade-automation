import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { BinanceAdapter } from '@trade-automation/binance-client';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { lastCandleOpenTimes } from '../../db/pg/collector-reads';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { BinancePerpCollector, MARKET, VENUE_LOGGER_NAME } from './perp-collector';
import { PerpSocket } from './perp-socket';
import { PerpRest } from './rest';

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
    const rest = new PerpRest({ baseUrl: restBaseUrl, onWeight: (w) => this.metrics.setBinanceWeightUsed1m(w) });
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
      socketFactory: (handlers, streams) => new PerpSocket({ wsBaseUrl, streams, handlers }),
      lastOpenTimes: this.db ? () => lastCandleOpenTimes(this.db as Db, 'binance', MARKET) : undefined,
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    await this.collector.start();
    this.timer = setInterval(() => void this.collector?.tick(), TICK_MS);
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
