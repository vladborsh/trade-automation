import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { LIQ_TICK_SEC } from '@trade-automation/contracts';
import { LiqAlertLoop, type LiqTickReport } from '../alerts/liquidations/liq-alert-loop';
import { PgLiqAlertStore } from '../alerts/liquidations/pg/liq-alerts.repo';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { TelegramSender } from './telegram-sender';

/**
 * IB-122 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §2) — schedules `LiqAlertLoop` every
 * 30 s, beside the OI loop (same sender, same DB). Venue weight 0: the loop reads our liquidation tape.
 * Price paths of its rows are measured by the OI loop's measurer (one queue, IB-115).
 * Nothing is sent until the admin page's 'liq' switch is on (default off).
 */
@Injectable()
export class LiqAlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LiqAlertsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly loop: LiqAlertLoop | null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    telegram: TelegramSender,
  ) {
    if (!db) {
      this.loop = null;
      return;
    }
    this.loop = new LiqAlertLoop({
      store: new PgLiqAlertStore(db),
      universe: config.symbols,
      send: (chatId, text) => telegram.sendTo(chatId, text),
      webBaseUrl: String(config.env.get('WEB_BASE_URL') ?? ''),
      build: config.env.get('BUILD_SHA'),
      source: 'live',
      log: { warn: (m) => this.logger.warn(m), log: (m) => this.logger.log(m) },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.loop || !this.config.env.get('LIQ_ALERTS_LOOP_ENABLED')) return;
    this.timer = setInterval(() => void this.tick(), LIQ_TICK_SEC * 1_000);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check; `nowMs` is the seam. Logs only a tick that journalled something or failed (every 30 s otherwise). */
  async tick(nowMs = Date.now()): Promise<LiqTickReport | null> {
    try {
      const r = (await this.loop?.tick(nowMs)) ?? null;
      if (r && (r.alerts + r.continuations + r.controls > 0 || r.failed.length > 0)) this.logger.log(liqTickLine(r));
      return r;
    } catch (error) {
      this.logger.warn(`liq alerts tick failed: ${(error as Error).message}`);
      return null;
    }
  }
}

/** «liq alerts (…→…]: 5 coins, 1 alert, 0 continuing (late 0), sent 0, controls 2, reads 7, prints ≤ 312» */
export function liqTickLine(r: LiqTickReport): string {
  return `liq alerts (${new Date(r.fromMs).toISOString()} → ${new Date(r.toMs).toISOString()}]: ${r.coins} coins, ${r.alerts} alert(s), `
    + `${r.continuations} continuing (late ${r.late}), sent ${r.sent}, controls ${r.controls}, reads ${r.reads}, prints ≤ ${r.maxPrints}`
    + `${r.failed.length ? `, failed ${r.failed.join(',')}` : ''}`;
}
