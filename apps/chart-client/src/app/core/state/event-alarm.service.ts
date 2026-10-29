import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { CalendarWeekResponse, EconomicEvent } from '../contracts/calendar';
import { CHIME } from '../audio/chime';
import { CalendarFiltersStore, passesFilters } from './calendar-filters.store';
import { mergeEvent } from './calendar.store';
import { NotificationsStore } from './notifications.store';
import { eventGroupLabel } from './calendar-labels';
import { dueAlerts, pruneFired, type DueAlert } from '@trade-automation/calendar-core/due-alerts';

export const FIRED_KEY = 'chart-client:calendar-alerts-fired';
/** Background tabs throttle timers to ~1/min, so an alert can be up to ~1 min late there (§11.5). */
export const ALARM_CHECK_MS = 15_000;
const UPCOMING_KEEP_PAST_MS = 60 * 60 * 1000;

/**
 * architecture/economic-calendar.md §11.5 — audible pre-event alert.
 *
 * Deliberately does NOT read `CalendarStore`: that store is replaced
 * wholesale when the user browses to another week, which would silently
 * disarm every upcoming alert. The alarm keeps its own upcoming set, seeded
 * from the *current* week fetch (`CalendarFeedService.boot()` /
 * `healAfterReconnect()`) and merged from live `calendarEvent` frames. No
 * polling of our server or any venue — the 15 s timer only reads memory.
 */
@Injectable({ providedIn: 'root' })
export class EventAlarmService {
  private readonly settings = inject(CalendarFiltersStore);
  private readonly notifications = inject(NotificationsStore);
  private readonly chime = inject(CHIME);

  private readonly upcomingMap = signal<Map<string, EconomicEvent>>(new Map());
  private fired: Record<string, number> = readFired();
  private timer: ReturnType<typeof setInterval> | null = null;
  private armListening = false;
  private readonly onGesture = (): void => void this.chime.arm();

  readonly upcoming = computed(() => [...this.upcomingMap().values()]);
  readonly enabled = computed(() => this.settings.alert().enabled);
  readonly armed = computed(() => this.chime.state() === 'running');
  /** Preference on but the audio context not running: the bell shows it, and the next gesture arms. */
  readonly needsArming = computed(() => this.enabled() && this.chime.state() === 'suspended');

  constructor() {
    effect(() => (this.needsArming() ? this.listenForGesture() : this.stopListening()));
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.check(), ALARM_CHECK_MS);
    this.check();
  }

  /** The current week, freshly fetched: replaces the set, keeping later events that arrived live. */
  seedWeek(week: CalendarWeekResponse): void {
    const next = new Map<string, EconomicEvent>();
    for (const event of this.upcomingMap().values()) {
      if (event.scheduledAt >= week.to) {
        next.set(event.id, event);
      }
    }
    for (const event of week.events) {
      next.set(event.id, event);
    }
    this.upcomingMap.set(next);
  }

  mergeLive(event: EconomicEvent): void {
    this.upcomingMap.update((current) => mergeEvent(current, event));
  }

  /** The 15 s tick. Returns what fired (for tests). */
  check(now = Date.now()): DueAlert[] {
    this.pruneUpcoming(now);
    if (!this.enabled()) {
      return [];
    }
    this.fired = pruneFired(this.fired, now);
    const leadMs = this.settings.alert().leadMinutes * 60_000;
    const filters = this.settings.filters();
    const due = dueAlerts(this.upcomingMap().values(), (e) => passesFilters(e, filters), leadMs, now, new Set(Object.keys(this.fired)));
    if (due.length === 0) {
      return due;
    }
    for (const alert of due) {
      this.fired[alert.key] = now;
    }
    writeFired(this.fired);
    for (const alert of due) {
      this.fire(alert, now);
    }
    return due;
  }

  /** The "Sound alerts" toggle — a click, so turning it on arms audio and plays the chime as confirmation. */
  setEnabled(enabled: boolean): void {
    this.settings.setAlertEnabled(enabled);
    if (enabled) {
      this.testSound();
    }
  }

  testSound(): void {
    void this.chime.arm().then(() => this.chime.play());
  }

  private fire(alert: DueAlert, now: number): void {
    const minutes = Math.round((alert.scheduledAt - now) / 60_000);
    const title = `${minutes > 0 ? `In ${minutes} min` : 'Now'}: ${eventGroupLabel(alert.events)}`;
    this.chime.play();
    this.notifications.pushAlert(alert.key, alert.events, title, now);
    if (this.notifications.desktopNotificationsEnabled() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { tag: alert.key });
      } catch {
        // some platforms only allow notifications from a service worker — the toast still shows
      }
    }
  }

  private pruneUpcoming(now: number): void {
    const stale = [...this.upcomingMap().values()].filter((e) => e.scheduledAt < now - UPCOMING_KEEP_PAST_MS);
    if (stale.length > 0) {
      this.upcomingMap.update((current) => {
        const next = new Map(current);
        stale.forEach((e) => next.delete(e.id));
        return next;
      });
    }
  }

  private listenForGesture(): void {
    if (this.armListening || typeof document === 'undefined') {
      return;
    }
    this.armListening = true;
    document.addEventListener('pointerdown', this.onGesture, true);
    document.addEventListener('keydown', this.onGesture, true);
  }

  private stopListening(): void {
    if (!this.armListening) {
      return;
    }
    this.armListening = false;
    document.removeEventListener('pointerdown', this.onGesture, true);
    document.removeEventListener('keydown', this.onGesture, true);
  }
}

function readFired(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? pruneFired(parsed as Record<string, number>, Date.now()) : {};
  } catch {
    return {};
  }
}

function writeFired(ledger: Record<string, number>): void {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(ledger));
  } catch {
    // localStorage unavailable — the in-memory ledger still prevents repeats this session
  }
}
