import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { MetricsService } from '../../ops/metrics.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { BinancePerpCollector, VENUE_LOGGER_NAME } from './perp-collector';
import { BinanceSocket } from '../binance-common/socket';
import { perpMarketWsBaseUrl } from './streams';
import { UptimeRecorder } from '../uptime/uptime.recorder';
import { BINANCE_LIQUIDATION_STREAM } from '../uptime/liquidation-streams';

/** One tick per second drives the dead-socket policy. */
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
    private readonly uptime: UptimeRecorder,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const symbols = this.config.symbols.map((s) => s.binance_perp);
    if (symbols.length === 0) {
      this.logger.warn('no universe symbols with a binance_perp mapping — collector idle');
      return;
    }

    const wsBaseUrl = this.config.env.get('BINANCE_FUTURES_WS_BASE_URL');
    // IB-BUG-012: markPrice/forceOrder are `/market` streams; the bare host's legacy `/stream` path
    // has carried none of them since 2026-04-23.
    const marketWsBaseUrl = perpMarketWsBaseUrl(wsBaseUrl);

    // WD-010: no REST client any more — nothing this collector keeps has a REST equivalent
    this.collector = new BinancePerpCollector({
      symbols,
      writers: this.writers,
      registry: this.registry,
      metrics: this.metrics,
      socketFactory: (handlers, streams) => new BinanceSocket({ wsBaseUrl: marketWsBaseUrl, streams, handlers }),
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    await this.collector.start();
    // WD-009: the liquidation stream's liveness, like Bybit's and OKX's (IB-BUG-010) — without it a
    // Binance outage leaves no gap row and "no liquidations" reads as a quiet market.
    await this.uptime.begin([{ stream: BINANCE_LIQUIDATION_STREAM, venue: 'binance', market: 'perp' }]);
    this.timer = setInterval(() => void this.collector?.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`binance-perp liquidation collector started (all USD-M symbols; liveness on ${symbols[0]}) on ${marketWsBaseUrl}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.collector?.stop();
    this.collector = null;
    await this.uptime.end();
  }
}
