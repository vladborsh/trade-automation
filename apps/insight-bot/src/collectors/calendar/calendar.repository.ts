import { Inject, Injectable } from '@nestjs/common';
import { EconomicEvent } from '@trade-automation/contracts';
import { Db, DB } from '../../db/db.port';
import { economicEventFromRow } from './calendar-row';
import { buildEventsInWindow, EventInWindow, EventWindowFilter } from './events-in-window';

/**
 * architecture/insight-bot-system-design.md §2.1 ("no SQL outside src/db/pg and the writers
 * module … every other module calls through a repository port"), §9.3 — the read side of
 * `calendar_events`. The SQL itself is built by the pure `events-in-window.ts`; this class only
 * runs it and maps rows.
 *
 * Writes go the other way, through `Writers.calendarEvents`, so the idempotent batching rule
 * (D12) holds for the calendar exactly as for every other table.
 */
@Injectable()
export class CalendarRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** §9.3's read, and the T−60 notice's and the morning plan's: one query, one status rule. */
  async eventsInWindow(filter: EventWindowFilter): Promise<EventInWindow[]> {
    const { sql, params } = buildEventsInWindow(filter);
    return this.db.query<EventInWindow>(sql, params);
  }

  /** §9.3: high-impact USD events whose latest revision is still `scheduled`. */
  async highImpactUsd(from: Date, to: Date): Promise<EventInWindow[]> {
    return this.eventsInWindow({ from, to, impact: 'high', currency: 'USD' });
  }

  /**
   * The collector's boot seed: every event in the window at its latest revision, **including
   * cancelled ones**, rehydrated into the `EconomicEvent` shape the lifted `diffSnapshot`
   * compares against. Cancelled rows have to come back too — without them a withdrawn event that
   * is still absent from the feed would be "removed" again on every poll, minting a revision a
   * minute.
   */
  async latestInWindow(from: Date, to: Date, now = Date.now()): Promise<EconomicEvent[]> {
    const scheduled = await this.eventsInWindow({ from, to, status: 'scheduled' });
    const cancelled = await this.eventsInWindow({ from, to, status: 'cancelled' });
    return [...scheduled, ...cancelled].map((row) => economicEventFromRow(row, now));
  }

  /** IB-058: the latest UTC day with a successful fetch, and when it ran; null before the first. */
  async lastFetchRun(): Promise<FetchRun | null> {
    const rows = await this.db.query<{ day: string; fetched_at: Date; events: number }>(
      `select to_char(day, 'YYYY-MM-DD') as day, fetched_at, events from calendar_fetch_runs order by day desc limit 1`,
    );
    const row = rows[0];
    return row ? { day: row.day, fetchedAt: row.fetched_at.getTime(), events: row.events } : null;
  }

  /** IB-058: marks `day` collected. A second fetch the same day (manual, or a race) overwrites. */
  async recordFetchRun(run: FetchRun): Promise<void> {
    await this.db.query(
      `insert into calendar_fetch_runs (day, fetched_at, events) values ($1::date, $2, $3)
       on conflict (day) do update set fetched_at = excluded.fetched_at, events = excluded.events`,
      [run.day, new Date(run.fetchedAt), run.events],
    );
  }
}

export interface FetchRun {
  /** UTC date, `YYYY-MM-DD`. */
  day: string;
  fetchedAt: number;
  events: number;
}
