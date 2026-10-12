import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { DB, type Db } from '../../db/db.port';
import { earliestFundingTimes } from '../../db/pg/collector-reads';
import { StreamRegistry } from '../../ops/stream-registry';
import { UptimeRecorder } from '../uptime/uptime.recorder';
import { Writers } from '../writers/batch-writer';
import { BybitCollector, STREAM_LIQUIDATION } from './bybit-collector';
import { BybitSocket } from './bybit-socket';
import { VENUE } from './mappers';
import { BybitRest } from './rest';

/** One tick a second: the silence watchdog and the minute boundary. */
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

  constructor(
    private readonly config: AppConfigService,
    private readonly writers: Writers,
    private readonly registry: StreamRegistry,
    private readonly uptime: UptimeRecorder,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // §4.3: only the universe symbols that actually have a Bybit linear contract.
    const symbols = this.config.symbols.map((s) => s.bybit_linear).filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (symbols.length === 0) {
      this.logger.warn('no universe symbol carries bybit_linear — collector idle');
      return;
    }
    const url = this.config.env.get('BYBIT_WS_URL');
    const rest = new BybitRest();

    this.collector = new BybitCollector({
      symbols,
      signalSet: this.config.signalSet,
      writers: this.writers,
      registry: this.registry,
      rest,
      socketFactory: (handlers, topics) => new BybitSocket({ url, topics, handlers }),
      earliestFundingTimes: this.db ? () => earliestFundingTimes(this.db as Db, VENUE) : undefined,
      logger: { log: (m) => this.logger.log(m), warn: (m) => this.logger.warn(m) },
    });

    await this.collector.start();
    // IB-BUG-010: this writes a collector_gaps row for however long we were NOT running, then
    // starts the heartbeat. After start(), so the window closes when the socket is actually up.
    await this.uptime.begin([{ stream: STREAM_LIQUIDATION, venue: VENUE, market: 'perp' }]);
    this.timer = setInterval(() => void this.collector?.tick(), TICK_MS);
    this.timer.unref?.();
    this.logger.log(`bybit collector started for ${symbols.length} symbols`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.collector?.stop();
    this.collector = null;
    // a last heartbeat, so the outage is dated from when we stopped rather than up to one
    // heartbeat interval earlier
    await this.uptime.end();
  }
}
