import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { Subscription } from 'rxjs';
import { CalendarNotification, EconomicEvent, EventImpact } from '@trade-automation/contracts';
import { AppConfigService } from '../config/config.service';
import { MetricsService } from '../observability/metrics.service';
import { EVENT_STORE, EventStore } from '../storage/event-store.port';
import { BarClock } from '../market-data/bar-clock.service';
import { CalendarCache } from './calendar-cache.service';
import { CalendarEvents, CalendarNotificationFiredEvent } from './calendar.events';

const IMPACT_RANK: Record<EventImpact, number> = { low: 0, medium: 1, high: 2, holiday: 0, unknown: 0 };

function tzDay(ms: number, tz: string): string {
  const zoned = toZonedTime(new Date(ms), tz);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayBoundsUtc(day: string, tz: string): { from: number; to: number } {
  const [y, m, d] = day.split('-').map(Number);
  const localMidnight = new Date(y, m - 1, d, 0, 0, 0, 0);
  const from = fromZonedTime(localMidnight, tz).getTime();
  return { from, to: from + 24 * 60 * 60_000 };
}

/**
 * architecture/economic-calendar.md §5 — two triggers, one mechanism: server computes them,
 * persists a ledger (idempotency across restart, §5.4), emits `CalendarNotificationFired`. The
 * WS gateway fans it out on the existing `calendar` topic; no new channel.
 */
@Injectable()
export class NotificationSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private subscription: Subscription | null = null;
  private readonly fired = new Set<string>();

  constructor(
    private readonly config: AppConfigService,
    private readonly cache: CalendarCache,
    private readonly events: EventEmitter2,
    private readonly barClock: BarClock,
    private readonly appMetrics: MetricsService,
    @Inject(EVENT_STORE) private readonly store: EventStore,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.env.get('CALENDAR_ENABLED')) return;

    const now = Date.now();
    const ledger = await this.store.queryNotifications(now - 2 * 24 * 60 * 60_000, now);
    for (const n of ledger) this.fired.add(n.id);

    await this.tick(now); // §5.2 boot catch-up: today's digest if the digest time already passed

    this.subscription = this.barClock.tick$.subscribe((t) => void this.tick(t));
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  private minImpact(): EventImpact {
    return this.config.env.get('CALENDAR_NOTIFY_MIN_IMPACT');
  }

  private countryFilter(): string[] {
    const raw = this.config.env.get('CALENDAR_NOTIFY_COUNTRIES');
    return raw
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  private passesFilters(e: EconomicEvent): boolean {
    if (IMPACT_RANK[e.impact] < IMPACT_RANK[this.minImpact()]) return false;
    const countries = this.countryFilter();
    if (countries.length > 0 && !countries.includes(e.country)) return false;
    return true;
  }

  private titleForDigest(events: EconomicEvent[]): string {
    if (events.length === 0) return 'Today: no scheduled events';
    const highs = events.filter((e) => e.impact === 'high');
    if (highs.length === 0) return `Today: ${events.length} events`;
    const countries = [...new Set(highs.map((e) => e.country))];
    return `Today: ${events.length} events · ${highs.length} high (${countries.join(', ')})`;
  }

  private titleForDue(events: EconomicEvent[]): string {
    const primary = events[0];
    const impactLabel = primary.impact.charAt(0).toUpperCase() + primary.impact.slice(1);
    const extra = events.length - 1;
    return `${primary.country} · ${impactLabel} · ${primary.title}${extra > 0 ? ` (+${extra})` : ''}`;
  }

  private async fire(notification: CalendarNotification): Promise<void> {
    if (this.fired.has(notification.id)) return;
    this.fired.add(notification.id);
    await this.store.appendNotifications([notification]);
    this.appMetrics.calendarNotificationsTotal.inc({ kind: notification.kind });
    this.events.emit(CalendarEvents.NotificationFired, new CalendarNotificationFiredEvent(notification));
  }

  private async maybeFireDigest(now: number): Promise<void> {
    const tz = this.config.env.get('CALENDAR_DIGEST_TZ');
    const day = tzDay(now, tz);
    const id = `digest:${day}`;
    if (this.fired.has(id)) return;

    const [digestHour, digestMinute] = this.config.env.get('CALENDAR_DIGEST_TIME').split(':').map(Number);
    const zonedNow = toZonedTime(new Date(now), tz);
    const nowMinutes = zonedNow.getHours() * 60 + zonedNow.getMinutes();
    if (nowMinutes < digestHour * 60 + digestMinute) return;

    const { from, to } = dayBoundsUtc(day, tz);
    const events = this.cache
      .queryByScheduled(from, to - 1)
      .filter((e) => e.status !== 'removed' && this.passesFilters(e))
      .sort((a, b) => a.scheduledAt - b.scheduledAt);

    await this.fire({ id, kind: 'daily-digest', at: now, day, events, title: this.titleForDigest(events) });
  }

  private async processDueEvents(now: number): Promise<EconomicEvent[]> {
    const catchupMs = this.config.env.get('CALENDAR_DUE_CATCHUP_MS');
    const dueCandidates = this.cache.all().filter((e) => e.status === 'scheduled' && e.scheduledAt <= now);
    const byInstant = new Map<number, EconomicEvent[]>();
    for (const e of dueCandidates) {
      const list = byInstant.get(e.scheduledAt) ?? [];
      list.push(e);
      byInstant.set(e.scheduledAt, list);
    }

    const released: EconomicEvent[] = [];
    for (const [scheduledAt, group] of byInstant) {
      const age = now - scheduledAt;
      const isFreshDue = age < 60_000;
      const shouldNotify = isFreshDue || age <= catchupMs;

      for (const e of group) {
        released.push({ ...e, status: 'released', lastSeenAt: now, revision: e.revision + 1 });
      }

      if (shouldNotify) {
        const filtered = group.filter((e) => this.passesFilters(e));
        if (filtered.length > 0) {
          await this.fire({
            id: `due:${scheduledAt}`,
            kind: 'event-due',
            at: now,
            events: filtered,
            title: this.titleForDue(filtered),
          });
        }
      }
    }
    return released;
  }

  private async tick(now: number): Promise<void> {
    try {
      await this.maybeFireDigest(now);

      const released = await this.processDueEvents(now);
      if (released.length > 0) {
        for (const e of released) this.cache.upsert(e);
        await this.store.upsert(released);
        await this.store.appendRevisions(
          released.map((e) => ({
            eventId: e.id,
            revision: e.revision,
            at: now,
            change: 'updated' as const,
            before: { status: 'scheduled' as const },
            after: { status: 'released' as const },
          })),
        );
      }
    } catch (err) {
      this.logger.error(`Notification scheduler tick failed: ${(err as Error).message}`);
    }
  }
}
