import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Writers } from '../collectors/writers/batch-writer';
import { DB, type Db } from '../db/db.port';
import { DeriveService } from './derive.service';

/** §8.1: the BarClock ticks at every UTC minute + 5 s grace, so the closing 1m row has landed. */
export const GRACE_MS = 5_000;
const MINUTE_MS = 60_000;

/**
 * IB-014 — the clock around `DeriveService`. Nest shell only: it aligns itself to the next UTC
 * minute + 5 s and asks the service what closed, so the timing lives in one place and the folding
 * stays pure and spec'd.
 */
@Injectable()
export class DeriveRunner implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DeriveRunner.name);
  private readonly service: DeriveService;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(@Inject(DB) db: Db, writers: Writers) {
    this.service = new DeriveService(db, writers);
  }

  onApplicationBootstrap(): void {
    this.scheduleNextTick();
    this.logger.log('derive job started (every UTC minute + 5 s grace)');
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Re-aligned every tick rather than on a fixed interval, so drift cannot walk off the boundary. */
  private scheduleNextTick(): void {
    if (this.stopped) return;
    const now = Date.now();
    const nextMinute = Math.floor(now / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
    this.timer = setTimeout(() => void this.tick(), nextMinute + GRACE_MS - now);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      // the grace is subtracted so a bucket that closed at HH:MM:00 is recognised at HH:MM:05
      const now = Date.now();
      await this.service.deriveClosedBuckets(now - GRACE_MS);
      // and look again at anything still short: a degraded-mode poll or a gap repair can deliver a
      // minute after the grace, and re-folding is idempotent (IB-014)
      await this.service.healIncomplete(now);
    } catch (error) {
      this.logger.warn(`derive tick failed: ${(error as Error).message}`);
    } finally {
      this.scheduleNextTick();
    }
  }
}
