import { EventEmitter2 } from '@nestjs/event-emitter';
import { Subject } from 'rxjs';
import { CalendarIngestionService } from '../../src/calendar/calendar-ingestion.service';
import { CalendarCache } from '../../src/calendar/calendar-cache.service';
import { ActualsBackfillService } from '../../src/calendar/actuals-backfill.service';
import { FeedFetchOutcome } from '@trade-automation/calendar-core';

function fakeConfig(env: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    CALENDAR_ENABLED: true,
    CALENDAR_POLL_INTERVAL_MS: 600_000,
    CALENDAR_POLL_HOT_INTERVAL_MS: 120_000,
    CALENDAR_CACHE_LOOKBACK_DAYS: 400,
  };
  return { env: { get: (key: string) => (key in env ? env[key] : defaults[key]) } } as never;
}

function fakeAppMetrics() {
  return {
    calendarPollsTotal: { inc: jest.fn() },
    calendarPollErrorsTotal: { inc: jest.fn() },
    calendarEventChangesTotal: { inc: jest.fn() },
    calendarUnjoinedRowsTotal: { inc: jest.fn() },
    calendarEventsInWindow: { set: jest.fn() },
  } as never;
}

function fakeStore() {
  return {
    queryByScheduled: jest.fn(async () => []),
    upsert: jest.fn(async () => undefined),
    appendRevisions: jest.fn(async () => undefined),
    get: jest.fn(async () => null),
    appendNotifications: jest.fn(async () => undefined),
    queryNotifications: jest.fn(async () => []),
    queryRevisions: jest.fn(async () => []),
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

function row(title: string, country: string, dateIso: string, impact = 'Low', forecast = '', previous = '') {
  return { title, country, date: dateIso, impact, forecast, previous };
}

describe('CalendarIngestionService (architecture/economic-calendar.md §3.2–3.4)', () => {
  it('CALENDAR_ENABLED=false: boot does nothing — no store read, no feed fetch', async () => {
    const feedClient = { fetch: jest.fn() };
    const store = fakeStore();
    const backfill = { processChanged: jest.fn() };

    const service = new CalendarIngestionService(
      fakeConfig({ CALENDAR_ENABLED: false }),
      new CalendarCache(),
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      fakeBarClock() as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();

    expect(feedClient.fetch).not.toHaveBeenCalled();
    expect(store.queryByScheduled).not.toHaveBeenCalled();
  });

  it('boot polls immediately, before subscribing to the bar clock', async () => {
    const feedClient = { fetch: jest.fn(async (): Promise<FeedFetchOutcome> => ({ changed: false })) };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const cache = new CalendarCache();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      cache,
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();

    expect(feedClient.fetch).toHaveBeenCalledTimes(1);
  });

  it('a 304 (changed: false) is a no-op: no diff, no store write, no emitted change', async () => {
    const feedClient = { fetch: jest.fn(async (): Promise<FeedFetchOutcome> => ({ changed: false })) };
    const store = fakeStore();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      new CalendarCache(),
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      fakeBarClock() as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();

    expect(store.upsert).not.toHaveBeenCalled();
    expect(backfill.processChanged).not.toHaveBeenCalled();
  });

  it('diffs two consecutive fixtures within the same week: create, update, remove', async () => {
    const now = Date.parse('2026-09-13T00:00:00-04:00'); // Sunday, before every event in this test
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const snapshot1 = [
      row('CPI m/m', 'CAD', '2026-09-14T08:30:00-04:00', 'High', '-0.1%', '0.5%'),
      row('Retail Sales m/m', 'USD', '2026-09-16T08:30:00-04:00', 'Medium', '0.8%', '-0.6%'),
    ];
    const xml1 = [
      { title: 'CPI m/m', country: 'CAD', date: '09-14-2026', time: '12:30pm', impact: 'High', forecast: '-0.1%', previous: '0.5%', url: 'https://www.forexfactory.com/calendar/9-ca-cpi-mm' },
      { title: 'Retail Sales m/m', country: 'USD', date: '09-16-2026', time: '12:30pm', impact: 'Medium', forecast: '0.8%', previous: '-0.6%', url: 'https://www.forexfactory.com/calendar/10-us-retail-sales-mm' },
    ];
    // Snapshot 2: CPI's forecast revised, Retail Sales disappeared (cancelled), a new row appears.
    const snapshot2 = [
      row('CPI m/m', 'CAD', '2026-09-14T08:30:00-04:00', 'High', '0.0%', '0.5%'),
      row('New Home Sales', 'USD', '2026-09-17T10:00:00-04:00', 'Low', '', ''),
    ];
    const xml2 = [
      xml1[0],
      { title: 'New Home Sales', country: 'USD', date: '09-17-2026', time: '2:00pm', impact: 'Low', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/11-us-new-home-sales' },
    ];

    let call = 0;
    const feedClient = {
      fetch: jest.fn(async (): Promise<FeedFetchOutcome> => {
        call++;
        return call === 1
          ? { changed: true, json: snapshot1, xml: xml1, etag: { json: 'e1', xml: 'e1' }, fetchedAt: Date.now() }
          : { changed: true, json: snapshot2, xml: xml2, etag: { json: 'e2', xml: 'e2' }, fetchedAt: Date.now() };
      }),
    };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const cache = new CalendarCache();
    const events = new EventEmitter2();
    const changes: string[] = [];
    events.on('calendar.event.changed', (e) => changes.push(`${e.change}:${e.event.title}`));
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      cache,
      events,
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();
    expect(changes).toEqual(expect.arrayContaining(['created:CPI m/m', 'created:Retail Sales m/m']));

    jest.spyOn(Date, 'now').mockReturnValue(now + 700_000); // past the default 600_000ms interval
    await barClock.tick(now + 700_000);

    expect(changes).toEqual(
      expect.arrayContaining(['updated:CPI m/m', 'removed:Retail Sales m/m', 'created:New Home Sales']),
    );
    const cpi = cache.all().find((e) => e.title === 'CPI m/m')!;
    expect(cpi.forecast).toBe('0.0%');
    expect(cpi.revision).toBe(2);
    const retail = cache.all().find((e) => e.title === 'Retail Sales m/m')!;
    expect(retail.status).toBe('removed');
    jest.restoreAllMocks();
  });

  it('week-roll: a snapshot from week N+1 never touches week N\'s stored rows', async () => {
    const now = Date.parse('2026-09-13T00:00:00-04:00'); // Sunday, before every event in this test
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const weekNRow = row('Old Week Event', 'USD', '2026-09-14T10:00:00-04:00');
    const weekNXml = [{ title: 'Old Week Event', country: 'USD', date: '09-14-2026', time: '2:00pm', impact: 'Low', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/20-old' }];
    const weekN1Row = row('New Week Event', 'USD', '2026-09-21T10:00:00-04:00'); // next Monday, week N+1
    const weekN1Xml = [{ title: 'New Week Event', country: 'USD', date: '09-21-2026', time: '2:00pm', impact: 'Low', forecast: '', previous: '', url: 'https://www.forexfactory.com/calendar/21-new' }];

    let call = 0;
    const feedClient = {
      fetch: jest.fn(async (): Promise<FeedFetchOutcome> => {
        call++;
        return call === 1
          ? { changed: true, json: [weekNRow], xml: weekNXml, etag: { json: 'e1', xml: 'e1' }, fetchedAt: Date.now() }
          : { changed: true, json: [weekN1Row], xml: weekN1Xml, etag: { json: 'e2', xml: 'e2' }, fetchedAt: Date.now() };
      }),
    };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const cache = new CalendarCache();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      cache,
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();
    const afterWeekN = cache.all().find((e) => e.title === 'Old Week Event')!;
    expect(afterWeekN.status).toBe('scheduled');
    expect(afterWeekN.revision).toBe(1);

    jest.spyOn(Date, 'now').mockReturnValue(now + 700_000);
    await barClock.tick(now + 700_000);

    const afterWeekN1 = cache.all().find((e) => e.title === 'Old Week Event')!;
    expect(afterWeekN1.status).toBe('scheduled'); // untouched — NOT removed despite being absent from week N+1's snapshot
    expect(afterWeekN1.revision).toBe(1); // untouched — no revision bump either
    expect(cache.all().find((e) => e.title === 'New Week Event')).toBeDefined();
    jest.restoreAllMocks();
  });

  it('is hot (2-minute cadence) when a high-impact event is within 20 minutes of now', async () => {
    const now = Date.parse('2026-09-16T00:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const cache = new CalendarCache();
    cache.upsert({
      id: 'ff:1:2026-09-16',
      source: 'forexfactory',
      seriesId: '1',
      sourceUrl: null,
      title: 'FOMC',
      country: 'USD',
      impact: 'high',
      scheduledAt: now + 10 * 60_000,
      scheduledDay: '2026-09-16',
      forecast: null,
      previous: null,
      actual: null,
      actualSource: null,
      actualAt: null,
      status: 'scheduled',
      firstSeenAt: now,
      lastSeenAt: now,
      revision: 1,
    });

    const feedClient = { fetch: jest.fn(async (): Promise<FeedFetchOutcome> => ({ changed: false })) };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      cache,
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();
    feedClient.fetch.mockClear();

    // Default interval is 600_000ms; a tick just 130s later would be skipped at the default
    // cadence but must poll under the 120_000ms hot cadence.
    jest.spyOn(Date, 'now').mockReturnValue(now + 130_000);
    await barClock.tick(now + 130_000);
    expect(feedClient.fetch).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('does not poll again before the default interval elapses when not hot', async () => {
    const feedClient = { fetch: jest.fn(async (): Promise<FeedFetchOutcome> => ({ changed: false })) };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      new CalendarCache(),
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      fakeAppMetrics(),
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap();
    feedClient.fetch.mockClear();

    await barClock.tick(Date.now() + 60_000); // well under the 600_000ms default interval
    expect(feedClient.fetch).not.toHaveBeenCalled();
  });

  it('backs off exponentially after a poll error, up to the 30-minute ceiling', async () => {
    const now = Date.parse('2026-09-16T00:00:00Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const feedClient = { fetch: jest.fn(async () => { throw new Error('502 Bad Gateway'); }) };
    const barClock = fakeBarClock();
    const store = fakeStore();
    const appMetrics = fakeAppMetrics();
    const backfill = { processChanged: jest.fn(async () => undefined) };

    const service = new CalendarIngestionService(
      fakeConfig(),
      new CalendarCache(),
      new EventEmitter2(),
      backfill as unknown as ActualsBackfillService,
      barClock as never,
      appMetrics,
      store as never,
      feedClient as never,
    );
    await service.onApplicationBootstrap(); // 1 failed attempt at boot
    expect((appMetrics as { calendarPollErrorsTotal: { inc: jest.Mock } }).calendarPollErrorsTotal.inc).toHaveBeenCalledTimes(1);

    // A tick 65s later must be skipped: after 1 error the backoff floor (120_000ms) is already past 65s.
    feedClient.fetch.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(now + 65_000);
    await barClock.tick(now + 65_000);
    expect(feedClient.fetch).not.toHaveBeenCalled();

    // Far enough out (past the 1st backoff step of 120_000ms), it should retry and fail again.
    jest.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000);
    await barClock.tick(now + 10 * 60_000);
    expect(feedClient.fetch).toHaveBeenCalledTimes(1);
    expect((appMetrics as { calendarPollErrorsTotal: { inc: jest.Mock } }).calendarPollErrorsTotal.inc).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
  });
});
