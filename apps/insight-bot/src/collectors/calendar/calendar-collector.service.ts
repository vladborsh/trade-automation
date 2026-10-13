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
import { HARD_POLL_FLOOR_MS, isPollDue, PollCadenceConfig } from './poll-cadence';
import { neverReject } from '../../ops/never-reject';

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
 * Cadence is signal-server's, in `poll-cadence.ts`. signal-server rides its 1-minute `BarClock`;
 * this app has no bar clock, so the loop is its own 60 s timer — the same hard floor, and the
 * cadence function decides on each tick whether a poll is actually due.
 */
@Injectable()
export class CalendarCollectorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarCollectorService.name);
  private timer: NodeJS.Timeout | null = null;

  /** The events of the current window at their latest revision, by id — the diff's `existing`. */
  private readonly cache = new Map<string, EconomicEvent>();
  private lastEtag: { json: string | null; xml: string | null } = { json: null, xml: null };
  private lastPolledAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private consecutiveErrors = 0;

  constructor(
    private readonly config: AppConfigService,
    @Inject(FEED_CLIENT) private readonly feedClient: FeedClient,
    private readonly repo: CalendarRepository,
    private readonly writers: Writers,
    private readonly streams: StreamRegistry,
  ) {}

  private get cadence(): PollCadenceConfig {
    return {
      intervalMs: this.config.env.get('CALENDAR_POLL_INTERVAL_MS'),
      hotIntervalMs: this.config.env.get('CALENDAR_POLL_HOT_INTERVAL_MS'),
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.env.get('CALENDAR_ENABLED')) {
      this.logger.log('CALENDAR_ENABLED=false — calendar collector disabled');
      return;
    }
    this.streams.register(CALENDAR_STREAM_ID, 'forexfactory', Math.round(this.cadence.intervalMs / 1000));

    await this.seedCache();
    // §3.4: boot polls immediately, before the loop starts. The instant is read HERE, at the
    // origin, and passed down — see `poll`'s signature.
    await this.poll(Date.now());
    this.timer = setInterval(() => neverReject(this.logger, 'calendar tick', () => this.tick()), HARD_POLL_FLOOR_MS);
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

  private async tick(): Promise<void> {
    const now = Date.now();
    if (!isPollDue(now, this.lastPolledAt, [...this.cache.values()], this.consecutiveErrors, this.cadence)) return;
    // IB-051: the SAME instant the due-check used. It used to call `poll()` and let the default
    // fire, so the decision and the stamp came from two reads — and `lastPolledAt`, which the next
    // due-check compares against, was the second one. Microseconds apart in production and no
    // outcome I could construct changed, but it is the partial-threading shape, and `poll`'s
    // parameter is now required so the next caller cannot repeat it by omission.
    await this.poll(now);
  }

  async poll(now: number): Promise<void> {
    this.lastPolledAt = now;
    try {
      const result = await this.feedClient.fetch(this.lastEtag);
      if (!result.changed) {
        this.lastSuccessAt = now;
        this.consecutiveErrors = 0;
        this.streams.recordMessage(CALENDAR_STREAM_ID, now);
        return;
      }

      const drafts = mapFeedSnapshot(result.json, result.xml);
      const written = await this.applySnapshot(drafts, now);

      this.lastEtag = result.etag;
      this.lastSuccessAt = now;
      this.consecutiveErrors = 0;
      this.streams.recordMessage(CALENDAR_STREAM_ID, now);
      this.logger.log(`Calendar poll: ${drafts.length} rows in snapshot, ${written} revisions written`);
    } catch (err) {
      this.consecutiveErrors++;
      this.logger.warn(`Calendar poll failed (attempt ${this.consecutiveErrors}): ${(err as Error).message}`);
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
