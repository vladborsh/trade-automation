import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import { CalendarNotification, EconomicEvent } from '@trade-automation/contracts';
import { NotificationSchedulerService } from '../../src/calendar/notification-scheduler.service';
import { CalendarCache } from '../../src/calendar/calendar-cache.service';
import { CalendarEvents } from '../../src/calendar/calendar.events';

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:1:2026-09-16',
    source: 'forexfactory',
    seriesId: '1',
    sourceUrl: null,
    title: 'Federal Funds Rate',
    country: 'USD',
    impact: 'high',
    scheduledAt: Date.parse('2026-09-16T14:00:00-04:00'), // 18:00Z
    scheduledDay: '2026-09-16',
    forecast: '4.00%',
    previous: '3.75%',
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 0,
    lastSeenAt: 0,
    revision: 1,
    ...overrides,
  };
}

function fakeConfig(env: Record<string, unknown>) {
  const defaults: Record<string, unknown> = {
    CALENDAR_ENABLED: true,
    CALENDAR_DIGEST_TIME: '00:00',
    CALENDAR_DIGEST_TZ: 'America/New_York',
    CALENDAR_NOTIFY_MIN_IMPACT: 'low',
    CALENDAR_NOTIFY_COUNTRIES: '',
    CALENDAR_DUE_CATCHUP_MS: 900_000,
  };
  return { env: { get: (key: string) => (key in env ? env[key] : defaults[key]) } } as never;
}

function fakeAppMetrics() {
  return { calendarNotificationsTotal: { inc: jest.fn() } } as never;
}

function makeStore(ledger: CalendarNotification[] = []) {
  const rows = [...ledger];
  return {
    queryNotifications: jest.fn(async (from: number, to: number) => rows.filter((n) => n.at >= from && n.at <= to)),
    appendNotifications: jest.fn(async (ns: CalendarNotification[]) => {
      rows.push(...ns);
    }),
    upsert: jest.fn(async () => undefined),
    appendRevisions: jest.fn(async () => undefined),
    rows,
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeBarClock() {
  const subject = new Subject<number>();
  return {
    tick$: subject.asObservable(),
    tick: async (t: number) => {
      subject.next(t);
      await flush();
    },
  };
}

describe('NotificationSchedulerService (architecture/economic-calendar.md §5)', () => {
  it('fires the daily digest once per ET day, including a boot catch-up when the digest time already passed', async () => {
    const cache = new CalendarCache();
    cache.upsert(event({ status: 'released' }));
    const store = makeStore();
    const barClock = fakeBarClock();
    const events = new EventEmitter2();
    const fired: unknown[] = [];
    events.on(CalendarEvents.NotificationFired, (e) => fired.push(e));

    // Boot at 10:00 ET on 2026-09-16 — well after the 00:00 digest time for that day.
    const bootAt = Date.parse('2026-09-16T10:00:00-04:00');
    jest.spyOn(Date, 'now').mockReturnValue(bootAt);

    const service = new NotificationSchedulerService(
      fakeConfig({}),
      cache,
      events,
      barClock as never,
      fakeAppMetrics(),
      store as never,
    );
    await service.onApplicationBootstrap();

    const digests = store.rows.filter((n) => n.kind === 'daily-digest');
    expect(digests).toHaveLength(1);
    expect(digests[0].id).toBe('digest:2026-09-16');

    // A subsequent tick on the same ET day must not fire a second digest.
    await barClock.tick(bootAt + 60_000);
    expect(store.rows.filter((n) => n.kind === 'daily-digest')).toHaveLength(1);

    jest.restoreAllMocks();
  });

  it('groups events sharing the same scheduledAt (FOMC: 3 rows) into one event-due notification', async () => {
    const scheduledAt = Date.parse('2026-09-16T14:00:00-04:00');
    const cache = new CalendarCache();
    cache.upsert(event({ id: 'ff:1:2026-09-16', title: 'Federal Funds Rate', scheduledAt }));
    cache.upsert(event({ id: 'ff:2:2026-09-16', title: 'FOMC Economic Projections', scheduledAt, seriesId: '2' }));
    cache.upsert(event({ id: 'ff:3:2026-09-16', title: 'FOMC Statement', scheduledAt, seriesId: '3' }));

    const store = makeStore();
    const barClock = fakeBarClock();
    const events = new EventEmitter2();

    jest.spyOn(Date, 'now').mockReturnValue(scheduledAt - 24 * 60 * 60_000); // boot well before, no digest race
    const service = new NotificationSchedulerService(fakeConfig({}), cache, events, barClock as never, fakeAppMetrics(), store as never);
    await service.onApplicationBootstrap();
    jest.restoreAllMocks();

    await barClock.tick(scheduledAt); // exactly due

    const due = store.rows.filter((n) => n.kind === 'event-due');
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe(`due:${scheduledAt}`);
    expect(due[0].events).toHaveLength(3);
    expect(due[0].title).toBe('USD · High · Federal Funds Rate (+2)');

    // All three events must now be released.
    expect(cache.get('ff:1:2026-09-16')!.status).toBe('released');
    expect(cache.get('ff:2:2026-09-16')!.status).toBe('released');
    expect(cache.get('ff:3:2026-09-16')!.status).toBe('released');
  });

  it('catch-up: marks a stale scheduled event released without notifying once past CALENDAR_DUE_CATCHUP_MS', async () => {
    const scheduledAt = Date.parse('2026-09-16T14:00:00-04:00');
    const cache = new CalendarCache();
    cache.upsert(event({ scheduledAt }));

    const store = makeStore();
    const barClock = fakeBarClock();
    const events = new EventEmitter2();

    jest.spyOn(Date, 'now').mockReturnValue(scheduledAt - 24 * 60 * 60_000);
    const service = new NotificationSchedulerService(fakeConfig({ CALENDAR_DUE_CATCHUP_MS: 900_000 }), cache, events, barClock as never, fakeAppMetrics(), store as never);
    await service.onApplicationBootstrap();
    jest.restoreAllMocks();

    // The process was "down" — the first tick after restart is 20 minutes past the event, beyond the 15-minute catch-up window.
    await barClock.tick(scheduledAt + 20 * 60_000);

    expect(store.rows.filter((n) => n.kind === 'event-due')).toHaveLength(0);
    expect(cache.get(event().id)!.status).toBe('released');
  });

  it('catch-up: still notifies for a stale event within CALENDAR_DUE_CATCHUP_MS', async () => {
    const scheduledAt = Date.parse('2026-09-16T14:00:00-04:00');
    const cache = new CalendarCache();
    cache.upsert(event({ scheduledAt }));

    const store = makeStore();
    const barClock = fakeBarClock();
    const events = new EventEmitter2();

    jest.spyOn(Date, 'now').mockReturnValue(scheduledAt - 24 * 60 * 60_000);
    const service = new NotificationSchedulerService(fakeConfig({ CALENDAR_DUE_CATCHUP_MS: 900_000 }), cache, events, barClock as never, fakeAppMetrics(), store as never);
    await service.onApplicationBootstrap();
    jest.restoreAllMocks();

    await barClock.tick(scheduledAt + 10 * 60_000); // 10 min late — within the 15-minute catch-up window

    expect(store.rows.filter((n) => n.kind === 'event-due')).toHaveLength(1);
  });

  it('ledger dedupe survives a simulated restart: a second scheduler seeded from the same store ledger does not re-fire an already-fired digest', async () => {
    const cache1 = new CalendarCache();
    cache1.upsert(event({ status: 'released' }));
    const store = makeStore();
    const barClock1 = fakeBarClock();
    const bootAt = Date.parse('2026-09-16T10:00:00-04:00');

    jest.spyOn(Date, 'now').mockReturnValue(bootAt);
    const service1 = new NotificationSchedulerService(fakeConfig({}), cache1, new EventEmitter2(), barClock1 as never, fakeAppMetrics(), store as never);
    await service1.onApplicationBootstrap();
    jest.restoreAllMocks();
    expect(store.rows.filter((n) => n.kind === 'daily-digest')).toHaveLength(1);

    // "Restart": a brand-new service instance, same underlying store (ledger persists), same day.
    const cache2 = new CalendarCache();
    cache2.upsert(event({ status: 'released' }));
    const barClock2 = fakeBarClock();
    jest.spyOn(Date, 'now').mockReturnValue(bootAt + 5 * 60_000);
    const service2 = new NotificationSchedulerService(fakeConfig({}), cache2, new EventEmitter2(), barClock2 as never, fakeAppMetrics(), store as never);
    await service2.onApplicationBootstrap();
    jest.restoreAllMocks();

    expect(store.rows.filter((n) => n.kind === 'daily-digest')).toHaveLength(1); // still exactly one
  });

  it('fires a zero-event digest with an unambiguous title on an empty day', async () => {
    const cache = new CalendarCache(); // no events at all
    const store = makeStore();
    const barClock = fakeBarClock();
    const bootAt = Date.parse('2026-09-20T10:00:00-04:00'); // Saturday, no scheduled releases

    jest.spyOn(Date, 'now').mockReturnValue(bootAt);
    const service = new NotificationSchedulerService(fakeConfig({}), cache, new EventEmitter2(), barClock as never, fakeAppMetrics(), store as never);
    await service.onApplicationBootstrap();
    jest.restoreAllMocks();

    expect(store.rows[0].title).toBe('Today: no scheduled events');
    expect(store.rows[0].events).toEqual([]);
  });
});
