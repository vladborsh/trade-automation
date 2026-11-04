import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { OiAlertLoop } from '../alerts/oi-divergence/oi-alert-loop';
import { PgOiAlertStore } from '../alerts/oi-divergence/pg/oi-alerts.repo';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { OiWindowReader } from '../insights/divergence/oi-window.reader';
import { CandlesService } from '../web/market/candles.service';
import { TelegramSender } from './telegram-sender';

const CHECK_MS = 60_000;

/**
 * IB-112 (architecture/oi-divergence-design-2026-11-04.md V9–V13) — schedules `OiAlertLoop` once a
 * minute, beside the calendar notifier (it needs the same sender and DB). The loop decides what is
 * due; this class only wires its ports to the real world:
 * - klines: `CandlesService` (perp, cached, every response's weight into the shared tracker; the
 *   loop's 100–499-bar reads are 2 weight each);
 * - OI: dev-1's `OiWindowReader` over `open_interest_5m` and the IB-104 ledger;
 * - delivery: `TelegramSender.sendTo` — NOT behind `OPS_TELEGRAM_ALERTS` (V13), and still nothing
 *   is sent until the admin page's `enabled` (default off).
 */
@Injectable()
export class OiAlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OiAlertsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly loop: OiAlertLoop | null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    telegram: TelegramSender,
    @Optional() candles?: CandlesService,
  ) {
    if (!db || !candles) {
      this.loop = null;
      return;
    }
    const reader = new OiWindowReader(db);
    this.loop = new OiAlertLoop({
      store: new PgOiAlertStore(db),
      klines: async (symbol, tf, from, to) => candles.candles('perp', symbol, tf, from * 1000, to * 1000),
      oiWindow: (symbol, from, to) => reader.read(symbol, from, to),
      closeAt: async (symbol, at) => (await candles.candles('perp', symbol, '1m', at * 1000, (at + 60) * 1000))[0]?.close ?? null,
      send: (chatId, text) => telegram.sendTo(chatId, text),
      webBaseUrl: String(config.env.get('WEB_BASE_URL') ?? ''),
      log: { warn: (m) => this.logger.warn(m) },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.loop || !this.config.env.get('OI_ALERTS_LOOP_ENABLED')) return;
    this.timer = setInterval(() => void this.tick(), CHECK_MS);
    this.timer.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    try {
      for (const r of (await this.loop?.tick(Math.floor(Date.now() / 1000))) ?? []) {
        if (r.journalled > 0 || r.skips > 0 || r.failed.length > 0) {
          this.logger.log(`oi alerts ${r.tf} @${new Date(r.barClose * 1000).toISOString()}: journalled ${r.journalled} (late ${r.late}), sent ${r.sent}, skips ${r.skips}${r.failed.length ? `, failed ${r.failed.join(',')}` : ''}`);
        }
      }
    } catch (error) {
      this.logger.warn(`oi alerts tick failed: ${(error as Error).message}`);
    }
  }
}
