import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { lastCandleOpenTimes } from '../../db/pg/collector-reads';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { BinanceSocket } from '../binance-common/socket';
import { BinanceSpotCollector, MARKET, VENUE_LOGGER_NAME } from './spot-collector';
import { SpotCandleSource } from './spot-candles';
import { SpotRest } from './rest';

/** One tick per second drives the mode policy and the degraded poller. */
export const TICK_MS = 1_000;

/**
 * IB-006 — the Nest shell around `BinanceSpotCollector`: it builds the real ports and runs the
 * clock. Symbols without a `binance_spot` mapping are filtered out here (§2.3: no spot market is
 * a fact, not a fault) and `/health` lists them under `noSpot`.
 */
@Injectable()
export class BinanceSpotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VENUE_LOGGER_NAME);
  private collector: BinanceSpotCollector | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly metrics: MetricsService,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const mapped = this.config.symbols.filter((s) => s.binance_spot);
    const symbols = mapped.map((s) => s.binance_spot as string);
    const noSpot = this.config.symbols.filter((s) => !s.binance_spot).map((s) => s.id);
    if (noSpot.length > 0) this.logger.log(`no binance_spot mapping for ${noSpot.join(', ')} — skipped, and listed in /health`);
    if (symbols.length === 0) {
      this.logger.warn('no universe symbols with a binance_spot mapping — collector idle');
      return;
    }

    const restBaseUrl = this.config.env.get('BINANCE_SPOT_REST_BASE_URL');
    const wsBaseUrl = this.config.env.get('BINANCE_SPOT_WS_BASE_URL');
    // spot's weight is metered by the venue against its own 6000/min ceiling, so it goes to its
    // own gauge and never into the futures one (§4.5, §6.1)
    const rest = new SpotRest({ baseUrl: restBaseUrl, onWeight: (w) => this.metrics.setBinanceSpotWeightUsed1m(w) });

    // the signal set is named by universe id; the collector works in venue symbols
    const spotSignalSet = mapped.filter((s) => this.config.signalSet.includes(s.id)).map((s) => s.binance_spot as string);

    this.collector = new BinanceSpotCollector({
      symbols,
      signalSet: spotSignalSet,
      writers: this.writers,
      registry: this.registry,
      metrics: this.metrics,
      rest,
      candles: new SpotCandleSource(rest),
      socketFactory: (handlers, streams) => new BinanceSocket({ wsBaseUrl, streams, handlers }),
      lastOpenTimes: this.db ? () => lastCandleOpenTimes(this.db as Db, 'binance', MARKET) : undefined,
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    await this.collector.start();
    this.timer = setInterval(() => void this.collector?.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`binance-spot collector started for ${symbols.length} symbols`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.collector?.stop();
    this.collector = null;
  }
}
