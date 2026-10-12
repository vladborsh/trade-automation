import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Db } from '../../db/db.port';
import { heartbeats, touchHeartbeat } from '../../db/pg/coverage-reads';
import { Writers } from '../writers/batch-writer';
import type { Market } from '../writers/tables';
import { uptimeGap } from './uptime-gap';

/** How often a connected stream persists its liveness. */
export const HEARTBEAT_MS = 30_000;
/**
 * How stale liveness has to be before the silence counts as downtime. Four heartbeats: a redeploy,
 * a slow boot or one missed tick is not an outage, and a row per restart would bury the real spells.
 */
export const STALE_AFTER_MS = HEARTBEAT_MS * 4;

export interface UptimeStream {
  stream: string;
  venue: string;
  market?: Market | null;
}

/**
 * IB-BUG-010 — records what the websocket liquidation collectors did and did not cover.
 *
 * Two jobs, and the order matters:
 *
 * 1. **On start, close the books on the previous run.** The heartbeat left behind by the last run
 *    is compared with the clock, and a stale one becomes a `collector_gaps` row for the window
 *    nobody was listening. This is the only way an outage the process did not live through gets
 *    recorded at all — see the reasoning in `uptime-gap.ts`.
 * 2. **While running, keep saying so.** A tick every `HEARTBEAT_MS` moves `last_seen_at` forward,
 *    independently of whether anything was liquidated. Liveness is never inferred from events: a
 *    quiet market must not read as downtime, or the ratio this exists to fix inflates again.
 *
 * With no database (`DB` is null in several tests and in the no-DB boot path) every method is a
 * no-op, exactly as the collectors themselves degrade.
 */
@Injectable()
export class UptimeRecorder {
  private readonly logger = new Logger('UptimeRecorder');
  private readonly streams = new Map<string, UptimeStream>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly writers: Writers,
    @Inject(DB) private readonly db: Db | null,
  ) {}

  /**
   * Registers the streams a collector is about to open, writes any gap its absence left, and starts
   * the heartbeat. Safe to call once per collector: the timer is shared.
   */
  async begin(streams: readonly UptimeStream[], now = new Date()): Promise<void> {
    for (const s of streams) this.streams.set(s.stream, s);
    if (!this.db) return;

    const known = await heartbeats(this.db);
    const gaps = streams
      .map((s) => uptimeGap({ ...s, heartbeat: known.get(s.stream) ?? null, now, staleAfterMs: STALE_AFTER_MS }))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (gaps.length > 0) {
      await this.writers.collectorGaps.write(gaps);
      for (const g of gaps) {
        const hours = ((g.gapTo.getTime() - g.gapFrom.getTime()) / 3_600_000).toFixed(1);
        this.logger.warn(`${g.stream}: ${hours}h not covered (${g.gapFrom.toISOString()} → ${g.gapTo.toISOString()})`);
      }
    }

    // mark alive immediately, so a crash seconds from now still has a recent mark to measure from
    await this.touchAll(now);
    if (!this.timer) {
      this.timer = setInterval(() => void this.touchAll(new Date()), HEARTBEAT_MS);
      this.timer.unref?.();
    }
  }

  /**
   * Stops the heartbeat and marks the streams alive one last time, so a graceful shutdown dates the
   * start of the outage at the moment we actually stopped rather than up to one heartbeat earlier.
   */
  async end(now = new Date()): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.touchAll(now);
  }

  private async touchAll(now: Date): Promise<void> {
    if (!this.db) return;
    for (const s of this.streams.values()) {
      try {
        await touchHeartbeat(this.db, s, now);
      } catch (error) {
        // a failed heartbeat must never take the collector down: the cost of losing one is an
        // over-stated gap on the next start, which is the safe direction to be wrong in
        this.logger.warn(`heartbeat failed for ${s.stream}: ${(error as Error).message}`);
      }
    }
  }
}
