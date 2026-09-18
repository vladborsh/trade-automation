import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { RestClient } from '../api/rest.client';
import { LiveSocket } from '../api/live.socket';
import { CHIME } from '../audio/chime';
import type { CalendarNotification, CalendarWeekResponse, WsCalendarEventFrame, WsNotificationFrame } from '../contracts/calendar';
import { CalendarFeedService } from './calendar-feed.service';
import { CalendarFiltersStore } from './calendar-filters.store';
import { CalendarStore } from './calendar.store';
import { EventAlarmService } from './event-alarm.service';
import { NotificationsStore } from './notifications.store';
import { FakeChime } from './fake-chime';
import { testEvent } from './calendar-test-events';

const NOW = 1_790_000_000_000;
const DAY = 86_400_000;

const thisWeek: CalendarWeekResponse = {
  from: NOW - 3 * DAY,
  to: NOW + 4 * DAY,
  day: [],
  events: [testEvent({ id: 'nfp', scheduledAt: NOW + 3 * 60_000 })],
};
const lastWeek: CalendarWeekResponse = {
  from: NOW - 10 * DAY,
  to: NOW - 3 * DAY,
  day: [],
  events: [testEvent({ id: 'old', scheduledAt: NOW - 7 * DAY, status: 'released' })],
};

function setup() {
  const socket = {
    calendarEventFrames$: new Subject<WsCalendarEventFrame>(),
    notificationFrames$: new Subject<WsNotificationFrame>(),
    reconnected: new Subject<void>(),
    subscribeCalendar: () => undefined,
  };
  const rest = {
    getCalendarWeek: (at?: number) => Promise.resolve(at === undefined ? thisWeek : lastWeek),
    getCalendarNotifications: () => Promise.resolve([] as CalendarNotification[]),
  };
  const chime = new FakeChime();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: RestClient, useValue: rest },
      { provide: LiveSocket, useValue: socket },
      { provide: CHIME, useValue: chime },
    ],
  });
  return {
    feed: TestBed.inject(CalendarFeedService),
    calendar: TestBed.inject(CalendarStore),
    alarm: TestBed.inject(EventAlarmService),
    settings: TestBed.inject(CalendarFiltersStore),
    notifications: TestBed.inject(NotificationsStore),
    socket,
    chime,
  };
}

describe('CalendarFeedService × EventAlarmService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('the alarm is independent of week navigation (§11.5)', async () => {
    const { feed, calendar, alarm, settings, chime } = setup();
    settings.setAlertEnabled(true);
    await chime.arm();
    vi.setSystemTime(NOW - 30 * 60_000);
    await feed.boot();
    expect(alarm.check()).toEqual([]); // 33 min out, lead 5 min

    await feed.loadWeek(NOW - 7 * DAY); // the user browses to last week
    expect(calendar.events().map((e) => e.id)).toEqual(['old']);
    expect(alarm.upcoming().map((e) => e.id)).toEqual(['nfp']);

    vi.setSystemTime(NOW); // 3 min before NFP
    expect(alarm.check().map((a) => a.key)).toEqual([`alert:${NOW + 3 * 60_000}`]);
    expect(chime.plays).toBe(1);
  });

  it('the 15 s timer rings without anyone calling check()', async () => {
    const { feed, settings, notifications, chime } = setup();
    settings.setAlertEnabled(true);
    await chime.arm();
    vi.setSystemTime(NOW - 10 * 60_000);
    await feed.boot();
    expect(notifications.toastQueue()).toEqual([]);

    vi.advanceTimersByTime(8 * 60_000 + 15_000);
    expect(notifications.toastQueue().filter((t) => t.alert)).toHaveLength(1);
  });

  it('live calendarEvent frames reach both the week view and the alarm', async () => {
    const { feed, calendar, alarm, socket } = setup();
    await feed.boot();
    socket.calendarEventFrames$.next({ type: 'calendarEvent', event: testEvent({ id: 'new' }), change: 'created' });
    expect(calendar.get('new')).toBeTruthy();
    expect(alarm.upcoming().map((e) => e.id)).toContain('new');
  });

  it('live notifications toast only if they pass the filters; the centre keeps all', async () => {
    const { feed, notifications, socket } = setup();
    await feed.boot();
    const jpy: CalendarNotification = { id: 'due:1', kind: 'event-due', at: NOW, events: [testEvent({ country: 'JPY' })], title: 'JPY · High · BoJ' };
    socket.notificationFrames$.next({ type: 'notification', notification: jpy });
    expect(notifications.notifications()).toHaveLength(1);
    expect(notifications.toastQueue()).toEqual([]);
  });
});
