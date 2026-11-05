import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { LiquidationTracking, TRACK_REFRESH_MS } from '../liquidation-tracking/pg/liquidation-tracking.repo';
import { StreamRegistry } from '../../ops/stream-registry';
import { UptimeRecorder } from '../uptime/uptime.recorder';
import { Writers } from '../writers/batch-writer';
import { BybitCollector, STREAM_LIQUIDATION } from './bybit-collector';
import { BybitSocket } from './bybit-socket';
import { VENUE } from './mappers';

/** One tick a second: the silence watchdog. */
export const TICK_MS = 1_000;

/**
 * IB-008 — the Nest shell around `BybitCollector`. Behaviour lives in the collector and the pure
 * modules beside it; this builds the real ports and runs the clock.
 */
@Injectable()
export class BybitService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('BybitCollector');
  private collector: BybitCollector | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private trackTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tracking: LiquidationTracking;

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly uptime: UptimeRecorder,
    @Optional() @Inject(DB) db?: Db | null,
  ) {
    this.tracking = new LiquidationTracking(db ?? null, config.symbols, { warn: (m) => this.logger.warn(m) });
  }

  async onApplicationBootstrap(): Promise<void> {
    // §4.3: the universe symbols that have a Bybit linear contract, and (IB-122, L5) the enabled alert coins.
    const symbols = await this.tracking.symbols('bybit');
    if (symbols.length === 0) {
      this.logger.warn('no universe symbol carries bybit_linear — collector idle');
      return;
    }
    const url = this.config.env.get('BYBIT_WS_URL');

    this.collector = new BybitCollector({
      symbols,
      writers: this.writers,
      registry: this.registry,
      socketFactory: (handlers, topics) => new BybitSocket({ url, topics, handlers }),
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    this.collector.start();
    // IB-BUG-010: this writes a collector_gaps row for however long we were NOT running, then
    // starts the heartbeat. After start(), so the window closes when the socket is actually up.
    await this.uptime.begin([{ stream: STREAM_LIQUIDATION, venue: VENUE, market: 'perp' }]);
    this.timer = setInterval(() => void this.collector?.tick(), TICK_MS);
    this.timer.unref?.();
    // IB-122 (L5): the alert list is re-read every 5 min; new coins are subscribed on the open socket
    this.trackTimer = setInterval(() => void this.refreshSymbols(), TRACK_REFRESH_MS);
    this.trackTimer.unref?.();
    this.logger.log(`bybit liquidation collector started for ${symbols.length} symbols (liveness on tickers.${symbols[0]})`);
  }

  async refreshSymbols(): Promise<void> {
    try {
      this.collector?.setSymbols(await this.tracking.symbols('bybit'));
    } catch (error) {
      this.logger.warn(`bybit symbol refresh failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.trackTimer) clearInterval(this.trackTimer);
    this.trackTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.collector?.stop();
    this.collector = null;
    // a last heartbeat, so the outage is dated from when we stopped rather than up to one
    // heartbeat interval earlier
    await this.uptime.end();
  }
}
