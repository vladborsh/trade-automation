import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subscription } from 'rxjs';
import { eventWeekWindowNY } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { MetricsService } from '../observability/metrics.service';
import { EVENT_STORE, EventStore } from '../storage/event-store.port';
import { BarClock } from '../market-data/bar-clock.service';
import { CalendarCache } from './calendar-cache.service';
import { ActualsBackfillService } from './actuals-backfill.service';
import { diffSnapshot } from './calendar-diff.service';
import { mapFeedSnapshot } from './feed/ff-feed.mapper';
import { FEED_CLIENT, FeedClient } from './feed/feed-client.token';
import { CalendarEventChangedEvent, CalendarEvents } from './calendar.events';

const HOT_HIGH_IMPACT_WINDOW_MS = 20 * 60_000;
const HARD_POLL_FLOOR_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export interface CalendarStatus {
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastEtag: string | null;
  weekWindow: { from: number; to: number };
  eventsInWindow: number;
  nextPollAt: number | null;
  hot: boolean;
}

/**
 * architecture/economic-calendar.md §3.2–3.4 — polls the ForexFactory feed on the existing
 * BarClock 1m tick (no second timer, mirroring MetricIngestionService), diffs each snapshot
 * against the events already in that snapshot's own week window, and never touches a prior
 * week's rows (D7 — the week-roll invariant).
 */
@Injectable()
export class CalendarIngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CalendarIngestionService.name);
  private subscription: Subscription | null = null;

  private lastEtag: { json: string | null; xml: string | null } = { json: null, xml: null };
  private lastPolledAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private consecutiveErrors = 0;
  private lastWindow = { from: 0, to: 0 };

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CalendarCache,
    private readonly events: EventEmitter2,
    private readonly backfill: ActualsBackfillService,
    private readonly barClock: BarClock,
    private readonly appMetrics: MetricsService,
    @Inject(EVENT_STORE) private readonly store: EventStore,
    @Inject(FEED_CLIENT) private readonly feedClient: FeedClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.env.get('CALENDAR_ENABLED')) {
      this.logger.log('CALENDAR_ENABLED=false — calendar ingestion disabled');
      return;
    }

    const lookbackMs = this.config.env.get('CALENDAR_CACHE_LOOKBACK_DAYS') * 24 * 60 * 60_000;
    const now = Date.now();
    const fromStorage = await this.store.queryByScheduled(now - lookbackMs, now + 14 * 24 * 60 * 60_000);
    for (const e of fromStorage) this.cache.upsert(e);

    // architecture/economic-calendar.md §3.4 — "boot immediately polls before anything else."
    await this.poll();

    this.subscription = this.barClock.tick$.subscribe(() => void this.maybePoll());
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private isSundayRolloverWindow(now: number): boolean {
    const d = new Date(now);
    return d.getUTCDay() === 0 && d.getUTCHours() >= 3 && d.getUTCHours() < 7;
  }

  private isHot(now: number): boolean {
    if (this.isSundayRolloverWindow(now)) return true;
    return this.cache
      .all()
      .some(
        (e) =>
          e.impact === 'high' &&
          e.scheduledAt >= now - HOT_HIGH_IMPACT_WINDOW_MS &&
          e.scheduledAt <= now + HOT_HIGH_IMPACT_WINDOW_MS,
      );
  }

  private currentIntervalMs(now: number): number {
    const hot = this.isHot(now);
    const base = hot
      ? this.config.env.get('CALENDAR_POLL_HOT_INTERVAL_MS')
      : this.config.env.get('CALENDAR_POLL_INTERVAL_MS');
    const backoff = this.consecutiveErrors > 0 ? Math.min(HARD_POLL_FLOOR_MS * 2 ** this.consecutiveErrors, MAX_BACKOFF_MS) : 0;
    return Math.max(base, backoff, HARD_POLL_FLOOR_MS);
  }

  private async maybePoll(): Promise<void> {
    const now = Date.now();
    const last = this.lastPolledAt ?? 0;
    if (now - last < this.currentIntervalMs(now)) return;
    await this.poll();
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    this.lastPolledAt = now;

    try {
      const result = await this.feedClient.fetch(this.lastEtag);
      if (!result.changed) {
        this.lastSuccessAt = now;
        this.consecutiveErrors = 0;
        this.appMetrics.calendarPollsTotal.inc({ result: 'not-modified' });
        return;
      }

      const drafts = mapFeedSnapshot(result.json, result.xml);
      const unjoined = drafts.filter((d) => d.seriesId === null).length;
      if (unjoined > 0) this.appMetrics.calendarUnjoinedRowsTotal.inc(unjoined);

      const minScheduledAt = Math.min(...drafts.map((d) => d.scheduledAt));
      const window = eventWeekWindowNY(minScheduledAt);
      this.lastWindow = window;
      const currentInWindow = this.cache.inWindow(window.from, window.to);

      const outcome = diffSnapshot(drafts, currentInWindow, (id) => this.cache.get(id), now);
      for (const e of outcome.toPersist) this.cache.upsert(e);
      await this.store.upsert(outcome.toPersist);
      await this.store.appendRevisions(outcome.revisions);

      const counts = { created: 0, updated: 0, removed: 0 };
      for (const { event, change } of outcome.changes) {
        if (change === 'created' || change === 'updated' || change === 'removed') counts[change]++;
        this.appMetrics.calendarEventChangesTotal.inc({ change });
        this.events.emit(CalendarEvents.EventChanged, new CalendarEventChangedEvent(event, change));
      }

      const nonRemoved = outcome.changes.filter((c) => c.change !== 'removed').map((c) => c.event);
      await this.backfill.processChanged(nonRemoved, now);

      this.lastEtag = result.etag;
      this.lastSuccessAt = now;
      this.consecutiveErrors = 0;
      this.appMetrics.calendarPollsTotal.inc({ result: 'ok' });
      this.appMetrics.calendarEventsInWindow.set(this.cache.eventsInWindow(now - 24 * 60 * 60_000, now + 30 * 24 * 60 * 60_000));
      this.logger.log(
        `Calendar poll: etag changed, ${JSON.stringify(counts)} (${drafts.length} rows in snapshot)`,
      );
    } catch (err) {
      this.consecutiveErrors++;
      this.appMetrics.calendarPollErrorsTotal.inc();
      this.appMetrics.calendarPollsTotal.inc({ result: 'error' });
      this.logger.error(`Calendar poll failed (attempt ${this.consecutiveErrors}): ${(err as Error).message}`);
    }
  }

  /** architecture/economic-calendar.md §6.1 — GET /api/calendar/status. */
  status(): CalendarStatus {
    const now = Date.now();
    return {
      lastPollAt: this.lastPolledAt,
      lastSuccessAt: this.lastSuccessAt,
      lastEtag: this.lastEtag.json,
      weekWindow: this.lastWindow,
      eventsInWindow: this.cache.eventsInWindow(this.lastWindow.from || 0, this.lastWindow.to || now),
      nextPollAt: this.lastPolledAt !== null ? this.lastPolledAt + this.currentIntervalMs(now) : null,
      hot: this.isHot(now),
    };
  }

  /** architecture/economic-calendar.md §6.1, §8 — backs GET /api/health's `calendar` field. */
  healthStatus(): { lastSuccessfulPollAge: number | null; eventsInWindow: number } {
    const now = Date.now();
    return {
      lastSuccessfulPollAge: this.lastSuccessAt !== null ? now - this.lastSuccessAt : null,
      eventsInWindow: this.cache.all().length,
    };
  }
}
