import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { FUNDING_CHECK_SEC } from '@trade-automation/contracts';
import { FundingAlertLoop, type FundingTickReport, type FundingVenuePort } from '../alerts/funding/funding-alert-loop';
import { PgFundingAlertStore } from '../alerts/funding/pg/funding-alerts.repo';
import { AppConfigService } from '../config/config.service';
import { DB, type Db } from '../db/db.port';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { PerpRest } from '../venues/binance/perp.rest';
import { binanceFundingPoints } from '../web/market/funding-points';
import { FUNDING_CALL_WEIGHT, PREMIUM_INDEX_CALL_WEIGHT } from '../web/market/funding.service';
import { WEIGHT_CEILING_1M } from '../web/market/universe-summary.service';
import { TelegramSender } from './telegram-sender';

/**
 * IB-124 (architecture/alerts-liq-funding-levels-design-2026-11-05.md §3) — schedules `FundingAlertLoop` every
 * FUNDING_CHECK_SEC (5 min), beside the OI and liquidation loops (same sender, same DB).
 *
 * **Weight (F1):** per coin, `premiumIndex?symbol=` 1 every 5 min and `fundingRate` 1 an hour, so 5 coins ≈ 1 + 5/12
 * ≈ 1.4 per 5 min ≈ **0.3 / min**. Every call goes into the shared `BinanceWeightTracker`, and none is made while the
 * IP's last minute is above `WEIGHT_CEILING_1M` (the coin's check fails that tick and is retried at the next).
 * Nothing is sent until the admin page's 'funding' switch is on (default off).
 */
@Injectable()
export class FundingAlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FundingAlertsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly loop: FundingAlertLoop | null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(DB) db: Db | null,
    telegram: TelegramSender,
    @Optional() perp?: PerpRest,
    @Optional() weight?: BinanceWeightTracker,
  ) {
    if (!db || !perp || !weight) {
      this.loop = null;
      return;
    }
    this.loop = new FundingAlertLoop({
      store: new PgFundingAlertStore(db),
      venue: binanceFundingVenue(perp, weight),
      send: (chatId, text) => telegram.sendTo(chatId, text),
      webBaseUrl: String(config.env.get('WEB_BASE_URL') ?? ''),
      build: config.env.get('BUILD_SHA'),
      source: 'live',
      log: { warn: (m) => this.logger.warn(m), log: (m) => this.logger.log(m) },
    });
  }

  onApplicationBootstrap(): void {
    if (!this.loop || !this.config.env.get('FUNDING_ALERTS_LOOP_ENABLED')) return;
    this.timer = setInterval(() => void this.tick(), FUNDING_CHECK_SEC * 1_000);
    this.timer.unref?.();
    this.logger.log(`funding alerts loop on: every ${FUNDING_CHECK_SEC} s`);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One check; `nowMs` is the seam. One info line per tick (12 an hour), so a live run is provable from the log. */
  async tick(nowMs = Date.now()): Promise<FundingTickReport | null> {
    if (!this.loop) return null;
    try {
      const r = await this.loop.tick(nowMs);
      if (r) this.logger.log(fundingTickLine(r));
      return r;
    } catch (error) {
      this.logger.warn(`funding alerts tick failed: ${(error as Error).message}`);
      return null;
    }
  }
}

/** The loop's venue port over PerpRest, every call weighed and refused above the shared ceiling. */
export function binanceFundingVenue(perp: PerpRest, weight: BinanceWeightTracker, now: () => number = Date.now): FundingVenuePort {
  const spend = (w: number): void => {
    const used = weight.used1m(now());
    if (used > WEIGHT_CEILING_1M) throw new Error(`Binance weight ${used} above ${WEIGHT_CEILING_1M}/min; not adding to it`);
    weight.recordCall(w, now());
  };
  return {
    async premiumIndex(symbol) {
      spend(PREMIUM_INDEX_CALL_WEIGHT);
      const row = await perp.premiumIndexOf(symbol);
      const rate = Number(row.lastFundingRate);
      if (row.lastFundingRate === '' || !Number.isFinite(rate)) throw new Error(`premiumIndex ${symbol}: lastFundingRate is not a number`);
      if (!Number.isFinite(row.time) || !Number.isFinite(row.nextFundingTime)) throw new Error(`premiumIndex ${symbol}: time / nextFundingTime missing`);
      return { rate, timeMs: row.time, nextFundingTimeMs: row.nextFundingTime };
    },
    async settled(symbol, fromMs, toMs) {
      spend(FUNDING_CALL_WEIGHT);
      return binanceFundingPoints(await perp.fundingRateRange(symbol, fromMs, toMs), fromMs, toMs);
    },
  };
}

/** «funding alerts @…: 5 coins, calls 6, stale 0, insufficient 0, enter 0, flip 0, sent 0, controls 1» */
export function fundingTickLine(r: FundingTickReport): string {
  return `funding alerts @${new Date(r.atMs).toISOString()}: ${r.coins} coins, calls ${r.calls}, stale ${r.stale}, insufficient ${r.insufficient}, `
    + `enter ${r.enters}, flip ${r.flips}, sent ${r.sent}, controls ${r.controls}${r.failed.length ? `, failed ${r.failed.join(',')}` : ''}`;
}
