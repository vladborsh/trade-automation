import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { BinanceWeightTracker } from '../venues/binance/binance-weight.tracker';
import { DB, type Db } from '../db/db.port';
import { gapsForDay, saveGapReport, slotCoverage } from '../db/pg/collector-reads';
import { buildGapReport, renderGapReport, type GapReport } from './gap-report';
import { TelegramSender } from '../delivery/telegram-sender';

const DAY_MS = 86_400_000;
/** §6.2: "at 00:10 UTC" — ten minutes of slack so the last minute's writes have landed. */
export const REPORT_MINUTE_UTC = 10;
const CHECK_MS = 60_000;

/**
 * IB-011 — the daily gap report job (design §6.2). At 00:10 UTC it builds the previous UTC day's
 * report, stores it in `gap_reports` and posts it to the service chat.
 *
 * Stored first, sent second, and on purpose: the row is the evidence the Tester reads for the
 * stage-0 criterion, so a Telegram outage must not cost a day of it.
 */
@Injectable()
export class GapReportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GapReportService.name);
  private readonly silenceMin: number;
  /** IB-094: false (the default) logs the report instead of posting it; it is stored either way. */
  private readonly pushToTelegram: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDayRun: string | null = null;

  constructor(
    config: AppConfigService,
    @Inject(DB) private readonly db: Db | null,
    private readonly telegram: TelegramSender,
    private readonly weight: BinanceWeightTracker,
  ) {
    this.silenceMin = Number(config.env.get('WATCHDOG_SILENCE_MIN'));
    this.pushToTelegram = config.env.get('OPS_TELEGRAM_ALERTS') === true;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.maybeRun(), CHECK_MS);
    this.timer.unref?.();
  }

  /** Runs the job when the clock says 00:10 UTC and it has not run for that day yet. */
  async maybeRun(now = new Date()): Promise<GapReport | null> {
    if (now.getUTCHours() !== 0 || now.getUTCMinutes() < REPORT_MINUTE_UTC) return null;
    const day = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
    if (this.lastDayRun === day) return null;
    this.lastDayRun = day;
    return this.runForDay(day, now.getTime());
  }

  /** Builds, stores and posts the report for one UTC day. Public: the CLI and specs call it. */
  async runForDay(day: string, generatedAtMs = Date.now()): Promise<GapReport | null> {
    if (!this.db) {
      this.logger.warn('no database — the gap report cannot be built');
      return null;
    }
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    // Clamped to "now" so a report re-run DURING the day does not count minutes that have not
    // happened yet as missing. The scheduled 00:10 run is always past the day's end, so it is
    // unaffected; only the CLI re-run is, and there this is the difference between a real hole
    // and the clock.
    const dayEnd = new Date(Math.min(dayStart.getTime() + DAY_MS, generatedAtMs));

    const [openInterest, longShort, gaps] = await Promise.all([
      slotCoverage(this.db, 'open_interest_5m', dayStart, dayEnd),
      slotCoverage(this.db, 'long_short_5m', dayStart, dayEnd),
      gapsForDay(this.db, dayStart, dayEnd),
    ]);

    const report = buildGapReport(
      {
        day, openInterest, longShort, gaps,
        binanceWeightPeak: this.weight.peak1m(),
        binanceWeightIsEstimate: this.weight.isEstimate(),
        silenceThresholdMin: this.silenceMin,
      },
      generatedAtMs,
    );

    // stored before sent: the row is the Tester's evidence, Telegram is a convenience
    await saveGapReport(this.db, day, report, report.clean);
    this.weight.resetPeak();
    const text = renderGapReport(report);
    this.logger.log(`gap report ${day}: ${report.clean ? 'clean' : 'NOT clean'}`);
    if (this.pushToTelegram) await this.telegram.send(text);
    else this.logger.log(`OPS_TELEGRAM_ALERTS=false — would have sent to Telegram: ${text.replace(/\n/g, ' | ')}`);
    return report;
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
