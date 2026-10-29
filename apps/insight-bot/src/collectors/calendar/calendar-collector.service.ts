import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EconomicEvent, eventWeekWindowNY } from '@trade-automation/contracts';
import { diffSnapshot, mapFeedSnapshot, MappedEventDraft } from '@trade-automation/calendar-core';
import { AppConfigService } from '../../config/config.service';
import { StreamRegistry } from '../../ops/stream-registry';
import { Writers } from '../writers/batch-writer';
import { CalendarRepository } from './calendar.repository';
import { FEED_CLIENT, FeedClient } from './feed-client.token';
import { calendarEventRow } from './calendar-row';
import { nextPreviousActuals } from './next-previous-actuals';
import { DAY_MS, isFetchDue, utcDay } from './fetch-schedule';

export const CALENDAR_STREAM_ID = 'calendar/forexfactory';

/**
 * architecture/insight-bot-system-design.md §2.1 (`collectors/calendar`), §3.3 — the
 * ForexFactory weekly feed into `calendar_events`, every event and every revision.
 *
 * The feed client, the mapper and the snapshot diff are the ones signal-server runs, imported
 * from `@trade-automation/calendar-core` (IB-010 part 1). What is new here is only the storage
 * side: signal-server keeps events in a File/S3 `EventStore` and a cache, this writes SQL rows
 * through `Writers.calendarEvents` and keeps the same in-memory picture seeded from the table.
 *
 * Cadence (IB-058): **once per UTC day**, see `fetch-schedule.ts`. A timer checks every
 * `CALENDAR_CHECK_INTERVAL_MS`; it fetches only when `calendar_fetch_runs` has no row for today,
 * so a restart on a day already collected makes no request at all.
 */
@Injectable()
export class CalendarCollectorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarCollectorService.name);
  private timer: NodeJS.Timeout | null = null;

  /** The events of the current window at their latest revision, by id — the diff's `existing`. */
  private readonly cache = new Map<string, EconomicEvent>();
  private lastEtag: { json: string | null; xml: string | null } = { json: null, xml: null };
  /** UTC day of the last successful fetch, mirrored from `calendar_fetch_runs`. */
  private lastRunDay: string | null = null;
  /** Snapshot size of the last changed fetch — what a 304 day records as its `events`. */
  private lastSnapshotSize = 0;
  private lastSuccessAt: number | null = null;
  private consecutiveErrors = 0;
  private fetching = false;
  private skipAnnouncedFor: string | null = null;

  constructor(
    private readonly config: AppConfigService,
    @Inject(FEED_CLIENT) private readonly feedClient: FeedClient,
    private readonly repo: CalendarRepository,
    private readonly writers: Writers,
    private readonly streams: StreamRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.env.get('CALENDAR_ENABLED')) {
      this.logger.log('CALENDAR_ENABLED=false — calendar collector disabled');
      return;
    }
    // The stream speaks once a day; the watchdog judges it against that, not against minutes.
    this.streams.register(CALENDAR_STREAM_ID, 'forexfactory', DAY_MS / 1000);

    await this.seedCache();
    const last = await this.repo.lastFetchRun();
    if (last) {
      this.lastRunDay = last.day;
      this.lastSnapshotSize = last.events;
      this.lastSuccessAt = last.fetchedAt;
      this.streams.recordMessage(CALENDAR_STREAM_ID, last.fetchedAt);
    }
    // The instant is read HERE, at the origin, and passed down (IB-051).
    await this.tick(Date.now());
    const checkMs = this.config.env.get('CALENDAR_CHECK_INTERVAL_MS');
    this.timer = setInterval(() => void this.tick(Date.now()), checkMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Seeds the diff's picture from the table so a restart does not re-create every event. */
  private async seedCache(now = Date.now()): Promise<void> {
    const lookbackMs = this.config.env.get('CALENDAR_CACHE_LOOKBACK_DAYS') * 24 * 60 * 60_000;
    const stored = await this.repo.latestInWindow(
      new Date(now - lookbackMs),
      new Date(now + 14 * 24 * 60 * 60_000),
      now,
    );
    for (const e of stored) this.cache.set(e.id, e);
    this.logger.log(`Calendar cache seeded with ${stored.length} stored events`);
  }

  /** One check: fetch if today has no successful run yet, otherwise do nothing. */
  async tick(now: number): Promise<void> {
    if (this.fetching) return;
    if (!isFetchDue(now, this.lastRunDay)) {
      // Said once per collected day, so a restart's log shows why no request was made.
      if (this.skipAnnouncedFor !== this.lastRunDay) {
        this.skipAnnouncedFor = this.lastRunDay;
        this.logger.log(`Calendar already collected for ${this.lastRunDay} — skipping fetch`);
      }
      return;
    }
    this.fetching = true;
    try {
      await this.poll(now);
    } finally {
      this.fetching = false;
    }
  }

  /**
   * One fetch of the feed. Records the day in `calendar_fetch_runs` only on success; a failure
   * leaves the day uncollected, so the next check retries.
   */
  async poll(now: number): Promise<void> {
    try {
      const result = await this.feedClient.fetch(this.lastEtag);
      let written = 0;
      if (result.changed) {
        const drafts = mapFeedSnapshot(result.json, result.xml);
        written = await this.applySnapshot(drafts, now);
        this.lastEtag = result.etag;
        this.lastSnapshotSize = drafts.length;
      }

      const day = utcDay(now);
      await this.repo.recordFetchRun({ day, fetchedAt: now, events: this.lastSnapshotSize });
      this.lastRunDay = day;
      this.lastSuccessAt = now;
      this.consecutiveErrors = 0;
      this.streams.recordMessage(CALENDAR_STREAM_ID, now);
      this.logger.log(
        result.changed
          ? `Calendar fetch for ${day}: ${this.lastSnapshotSize} rows in snapshot, ${written} revisions written`
          : `Calendar fetch for ${day}: feed unchanged (304)`,
      );
    } catch (err) {
      this.consecutiveErrors++;
      this.logger.warn(`Calendar fetch failed (attempt ${this.consecutiveErrors}): ${(err as Error).message}`);
    }
  }

  /**
   * One snapshot: diff it against the window's current picture, write every changed event as a
   * new revision row, then let the next-occurrence rule assert actuals on prior occurrences and
   * write those as revisions too.
   *
   * Only `outcome.changes` are written, not `outcome.toPersist`: an event the feed re-sends
   * unchanged has no new revision, so writing it would either be a no-op upsert of the same
   * `(id, revision)` or — worse — churn. Every revision the diff *does* produce is kept, which
   * is §3.3's rule.
   */
  private async applySnapshot(drafts: MappedEventDraft[], now: number): Promise<number> {
    const window = eventWeekWindowNY(Math.min(...drafts.map((d) => d.scheduledAt)));
    const currentInWindow = [...this.cache.values()].filter(
      (e) => e.scheduledAt >= window.from && e.scheduledAt <= window.to && e.status !== 'removed',
    );

    const outcome = diffSnapshot(drafts, currentInWindow, (id) => this.cache.get(id) ?? null, now);
    for (const e of outcome.toPersist) this.cache.set(e.id, e);

    const rows = outcome.changes.map(({ event }) => calendarEventRow(event, now));

    const actuals = nextPreviousActuals(
      outcome.changes.filter((c) => c.change !== 'removed').map((c) => c.event),
      (seriesId) => [...this.cache.values()].filter((e) => e.seriesId === seriesId),
      now,
    );
    for (const applied of actuals) {
      this.cache.set(applied.id, applied);
      rows.push(calendarEventRow(applied, now));
    }

    await this.writers.calendarEvents.write(rows);
    return rows.length;
  }

  /** Backs `/health`'s calendar field: how stale the feed is and how much of it we hold. */
  healthStatus(): { lastSuccessfulPollAge: number | null; eventsHeld: number } {
    return {
      lastSuccessfulPollAge: this.lastSuccessAt === null ? null : Date.now() - this.lastSuccessAt,
      eventsHeld: this.cache.size,
    };
  }
}
