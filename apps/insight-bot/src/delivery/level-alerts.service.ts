import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { LEVEL_BAR_SEC, LEVEL_DAILY_BARS, LEVEL_SETTLE_SEC, type LevelBar } from '@trade-automation/contracts';
import { LevelAlertLoop, type LevelTickReport, type LevelVenuePort } from '../alerts/levels/level-alert-loop';
import { PgLevelAlertStore } from '../alerts/levels/pg/level-alerts.repo';
import { PgCustomLevelStore } from '../alerts/levels/pg/custom-levels.repo';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { klinesWeight } from '../news/reaction-prices';
import { CandlesService } from '../web/market/candles.service';
import { TelegramSender } from './telegram-sender';
import { SpendsWeightAs } from '../venues/binance/weight-caller';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;

/** Logged once at bootstrap when the loop is on. The deploy watch checks the heartbeat only for an image that says this. */
export const LEVEL_LOOP_ON_LINE = `level alerts loop on: tick 60 s, a line per 15m close`;

/**
 * IB-126 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §4) — schedules `LevelAlertLoop` once a minute,
 * 5 s past it (the 15m bar's settle, P3), beside the OI, liquidation and funding loops (same sender, same DB).
 *
 * **Weight (P5, P2, P10):** per coin, `klines 15m limit=2` (weight 1) per 15 min and `klines 1d limit=70` (weight 1) per
 * UTC day, so 5 coins ≈ 20 per hour + 5 a day ≈ **0.34 / min**. A P10 seed is ≤ 2 pages of 1 500 bars (weight 10 each)
 * for one coin a minute, once per coin (go-live, a new coin, a gap longer than 99 bars). Every call goes through
 * `CandlesService`: into the shared `BinanceWeightTracker`, and refused while the IP's last minute is above the ceiling.
 * Nothing is sent until the admin page's 'level' switch is on (default off).
 *
 * **Heartbeat:** the first completed tick that evaluates a new 15m close logs one line, «level alerts @<close>: …»,
 * even when it found nothing, so a dead or stuck loop is visible to the deploy watch (`level_loop_missing`).
 */
@Injectable()
export class LevelAlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LevelAlertsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;
  private lastLogged: number | null = null;
  readonly loop: LevelAlertLoop | null;

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
    this.loop = new LevelAlertLoop({
      store: new PgLevelAlertStore(db),
      venue: candlesLevelVenue(candles),
      weightOf: klinesWeight,
      send: (chatId, text) => telegram.sendTo(chatId, text),
      webBaseUrl: String(config.env.get('WEB_BASE_URL') ?? ''),
      build: config.env.get('BUILD_SHA'),
      source: 'live',
      // IB-128 (P9): the owner's custom levels, heard by admins only
      custom: new PgCustomLevelStore(db),
      log: { warn: (m) => this.logger.warn(m) },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.loop || !this.config.env.get('LEVEL_ALERTS_LOOP_ENABLED')) return;
    this.logger.log(LEVEL_LOOP_ON_LINE);
    this.schedule();
  }

  /** The first tick 5 s past the next minute, then every minute; and one at once (the boot tick). */
  private schedule(nowMs = Date.now()): void {
    const toNext = TICK_MS - ((nowMs - LEVEL_SETTLE_SEC * 1_000) % TICK_MS);
    this.first = setTimeout(() => {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref?.();
      void this.tick();
    }, toNext);
    this.first.unref?.();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  /** One tick; `nowMs` is the seam. The heartbeat line once per 15m close; a seed line when a coin was seeded. */
  @SpendsWeightAs('level_alerts')
  async tick(nowMs = Date.now()): Promise<LevelTickReport | null> {
    if (!this.loop) return null;
    try {
      const r = await this.loop.tick(nowMs);
      if (!r) return null;
      if (this.lastLogged !== r.dueBarMs) {
        this.lastLogged = r.dueBarMs;
        this.logger.log(levelTickLine(r));
      } else if (r.seeded.length > 0 || r.failed.length > 0) {
        this.logger.log(levelSeedLine(r));
      }
      return r;
    } catch (error) {
      this.logger.warn(`level alerts tick failed: ${(error as Error).message}`);
      return null;
    }
  }
}

/** The loop's venue port over `CandlesService`: closed 15m bars at the exact limit, and the 1d tail at weight 1. */
export function candlesLevelVenue(candles: Pick<CandlesService, 'closedKlines' | 'candles'>): LevelVenuePort {
  return {
    async bars15m(symbol, fromMs, limit): Promise<LevelBar[]> {
      const rows = await candles.closedKlines(symbol, '15m', fromMs, limit);
      return rows.map((c) => ({ openMs: c.time * 1000, open: c.open, high: c.high, low: c.low, close: c.close }));
    },
    // 70 bars ending with today's forming one: below TAIL_LIMIT, so ONE uncached request at weight 1 (IB-066)
    daily: (symbol, dayStartMs) => candles.candles('perp', symbol, '1d', dayStartMs - (LEVEL_DAILY_BARS - 1) * DAY_MS, dayStartMs + DAY_MS),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** «level alerts @2026-11-06T03:15:00.000Z: 5 coins, 5 bars, calls 5 (weight 5), alerts 0 (late 0), sent 0, controls 1, seeded -, pending 4» */
export function levelTickLine(r: LevelTickReport): string {
  return `level alerts @${iso(r.dueBarMs + LEVEL_BAR_SEC * 1_000)}: ${r.coins} coins, ${r.bars} bars, calls ${r.calls} (weight ${r.weight}), `
    + `alerts ${r.alerts} (late ${r.late}), sent ${r.sent}, controls ${r.controls}, seeded ${r.seeded.join(',') || '-'}, pending ${r.pendingSeed}`
    + `${r.failed.length ? `, failed ${r.failed.join(',')}` : ''}`;
}

/** Between closes: «level alerts seed @…: seeded ETHUSDT, calls 2 (weight 15), pending 3». */
export function levelSeedLine(r: LevelTickReport): string {
  return `level alerts seed @${iso(r.atMs)}: seeded ${r.seeded.join(',') || '-'}, calls ${r.calls} (weight ${r.weight}), pending ${r.pendingSeed}`
    + `${r.failed.length ? `, failed ${r.failed.join(',')}` : ''}`;
}
