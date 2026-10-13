import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { StreamRegistry } from './stream-registry';
import { TelegramSender } from '../delivery/telegram-sender';
import { Watchdog, renderAlert } from './watchdog';
import { neverReject } from './never-reject';

/** §6.2: "the watchdog (every 30 s)". */
export const WATCHDOG_TICK_MS = 30_000;

/**
 * IB-011 — the Nest shell around the pure `Watchdog`: it ticks, renders and sends. Every decision
 * (what counts as silent, the 30-minute rate limit, degraded streams, recovery) is in `watchdog.ts`.
 */
@Injectable()
export class WatchdogService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WatchdogService.name);
  private readonly silenceMin: number;
  private readonly watchdog: Watchdog;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: AppConfigService,
    private readonly streams: StreamRegistry,
    private readonly telegram: TelegramSender,
  ) {
    this.silenceMin = Number(config.env.get('WATCHDOG_SILENCE_MIN'));
    this.watchdog = new Watchdog({ silenceMin: this.silenceMin });
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => neverReject(this.logger, 'watchdog tick', () => this.tick()), WATCHDOG_TICK_MS);
    this.timer.unref?.();
    this.logger.log(`watchdog started (threshold ${this.silenceMin} min, one alert per stream per 30 min)`);
  }

  /** One pass. Public so a spec — and the live check — can drive it without waiting 30 s. */
  async tick(now = Date.now()): Promise<void> {
    for (const alert of this.watchdog.check(this.streams.snapshot(now), now)) {
      const text = renderAlert(alert, this.silenceMin);
      this.logger[alert.kind === 'silent' ? 'warn' : 'log'](text.split('\n')[0]);
      await this.telegram.send(text);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
