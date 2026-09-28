import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Db, DB } from './db.port';
import { buildCreatePartition, monthsAhead, monthsBetween, partitionsFor } from './partitions';

/** D7 — the current month plus this many ahead are kept ready at all times. */
export const MONTHS_AHEAD = 3;
const DAILY_MS = 24 * 60 * 60 * 1000;

/**
 * architecture/insight-bot-system-design.md §3.1, D7 — "created by `db/partitions.ts` for the
 * current month plus three ahead on boot and daily; a write into a month with no partition is a
 * boot-time bug, so the maintenance job runs before collectors start. Backfill creates
 * partitions for every month it touches."
 *
 * `ensureAhead()` is therefore called from `DbModule.onModuleInit`, after the migrations and
 * before anything that writes, and the backfill calls `ensureRange()` for the window it is
 * about to import.
 */
@Injectable()
export class PartitionMaintenanceService implements OnModuleDestroy {
  private readonly logger = new Logger(PartitionMaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(DB) private readonly db: Db | null) {}

  /** The current month plus `MONTHS_AHEAD`; safe to call repeatedly (every statement is IF NOT EXISTS). */
  async ensureAhead(now = new Date()): Promise<number> {
    return this.ensureMonths(monthsAhead(now, MONTHS_AHEAD));
  }

  /** Every month `[from, to]` touches — what the archive backfill calls before importing a window. */
  async ensureRange(from: Date, to: Date): Promise<number> {
    return this.ensureMonths(monthsBetween(from, to));
  }

  private async ensureMonths(months: readonly string[]): Promise<number> {
    if (this.db === null) {
      throw new Error('PartitionMaintenanceService: no database. Set DATABASE_URL before writing time series.');
    }
    const partitions = partitionsFor(months);
    for (const partition of partitions) {
      await this.db.query(buildCreatePartition(partition));
    }
    return partitions.length;
  }

  /** Re-runs daily, so a month boundary never arrives without its partitions. */
  startDailyMaintenance(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.ensureAhead().catch((err) =>
        // Not fatal in the way a boot failure is: the partitions three months out still exist,
        // so there is time to notice and fix this before a write can fail.
        this.logger.error(`Daily partition maintenance failed: ${(err as Error).message}`),
      );
    }, DAILY_MS);
    this.timer.unref(); // never hold the process open on this alone
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
