import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DB, type Db } from '../db/db.port';
import { FeaturePassService } from './feature-pass.service';
import { type Attempt, isAttemptStillDue, nextAttempt } from './recheck-schedule';
import { neverReject } from '../ops/never-reject';

/**
 * IB-015 — the clock around `FeaturePassService` (design §8.1).
 *
 * Nest shell only. It asks `recheck-schedule.ts` when the next look is due, sleeps until then,
 * and asks the service to run it; the schedule is pure and spec'd, and nothing about what a
 * frame says is decided here.
 *
 * **Re-aligned from the epoch after every attempt, never chained off the last one.** A runner
 * that sets a fixed 15-second interval drifts, and a drifting feature pass writes frames stamped
 * with closes they do not belong to — slowly, and without failing.
 */
@Injectable()
export class FeaturesRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FeaturesRunner.name);
  private readonly service: FeaturePassService;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(@Inject(DB) db: Db) {
    this.service = new FeaturePassService(db);
  }

  onApplicationBootstrap(): void {
    this.scheduleNext();
    this.logger.log(
      `feature pass started (15m and 4h closes, +15 s grace then +30 s and +60 s re-checks; ` +
      `spec ${FeaturePassService.fingerprint()})`,
    );
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const now = Date.now();
    const attempt = nextAttempt(now);
    this.timer = setTimeout(
      () => neverReject(this.logger, 'feature pass', () => this.run(attempt)),
      Math.max(0, attempt.atMs - now),
    );
    this.timer.unref?.();
  }

  private async run(attempt: Attempt): Promise<void> {
    try {
      const now = Date.now();
      if (!isAttemptStillDue(attempt, now)) {
        // The process was asleep long enough that the next bar has closed. Writing this one now
        // would stamp a frame as that bar's when it was computed from a later market.
        this.logger.warn(
          `skipped ${attempt.tf} ${new Date(attempt.closeMs).toISOString()} attempt ` +
          `${attempt.attempt}: woke ${Math.round((now - attempt.atMs) / 1000)} s late, past the bar`,
        );
        return;
      }
      // 'live' always, including a late wake: the mode records WHO wrote the frame, not how
      // timely it was. `isAttemptStillDue` above already refuses a wake so late that the bar has
      // been succeeded.
      const summary = await this.service.runPass(
        attempt.tf, attempt.closeMs, now, 'live', attempt.attempt === 0 ? 'all' : 'awaiting-heal',
      );
      if (summary.written + summary.amended + summary.failed.length > 0) {
        this.logger.log(
          `${attempt.tf} ${new Date(attempt.closeMs).toISOString()} +${(attempt.atMs - attempt.closeMs) / 1000}s: ` +
          `${summary.written} written, ${summary.amended} amended, ${summary.unchanged} unchanged` +
          (summary.conflicts > 0 ? `, ${summary.conflicts} CONFLICTS` : '') +
          (summary.failed.length > 0 ? `, ${summary.failed.length} failed` : ''),
        );
      }
      for (const failure of summary.failed) {
        this.logger.warn(`feature pass failed for ${failure.symbol}: ${failure.error}`);
      }
    } catch (error) {
      // A whole-pass failure is the version guard or the database. Logged, never fatal: the next
      // close gets its own attempt.
      this.logger.warn(`feature pass tick failed: ${(error as Error).message}`);
    } finally {
      this.scheduleNext();
    }
  }
}
