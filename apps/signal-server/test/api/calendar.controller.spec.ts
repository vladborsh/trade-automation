import { ServiceUnavailableException } from '@nestjs/common';
import { EconomicEvent } from '@trade-automation/contracts';
import { CalendarController } from '../../src/api/rest/calendar.controller';
import { CalendarCache } from '../../src/calendar/calendar-cache.service';

function fakeConfig(enabled: boolean) {
  return { env: { get: (key: string) => (key === 'CALENDAR_ENABLED' ? enabled : undefined) } } as never;
}

function fakeIngestion() {
  return {
    status: () => ({ lastPollAt: null, lastSuccessAt: null, lastEtag: null, weekWindow: { from: 0, to: 0 }, eventsInWindow: 0, nextPollAt: null, hot: false }),
  } as never;
}

function fakeStore() {
  return {
    queryByScheduled: jest.fn(async () => []),
    get: jest.fn(async () => null),
    queryRevisions: jest.fn(async () => []),
    queryNotifications: jest.fn(async () => []),
  };
}

function event(): EconomicEvent {
  return {
    id: 'ff:1:2026-09-16',
    source: 'forexfactory',
    seriesId: '1',
    sourceUrl: null,
    title: 'X',
    country: 'USD',
    impact: 'high',
    scheduledAt: Date.now(),
    scheduledDay: '2026-09-16',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 0,
    lastSeenAt: 0,
    revision: 1,
  };
}

/**
 * architecture/economic-calendar.md §6.1, §8, §10 — "CALENDAR_ENABLED=false ... endpoints
 * 404 -> return 503 calendar disabled."
 */
describe('CalendarController (architecture/economic-calendar.md §6.1, §8)', () => {
  it('CALENDAR_ENABLED=false: every route throws 503 "calendar disabled"', async () => {
    const controller = new CalendarController(fakeConfig(false), new CalendarCache(), fakeIngestion(), fakeStore() as never);

    await expect(controller.events({ from: 0, to: 1, limit: 2000 })).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.week({})).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.notifications({ limit: 50 })).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.status()).rejects.toThrow(ServiceUnavailableException);
    await expect(controller.eventDetail('ff:1:2026-09-16')).rejects.toThrow(ServiceUnavailableException);
  });

  it('CALENDAR_ENABLED=true: events() serves from the cache and filters removed rows by default', async () => {
    const cache = new CalendarCache();
    cache.upsert(event());
    const store = fakeStore();
    const controller = new CalendarController(fakeConfig(true), cache, fakeIngestion(), store as never);

    const events = await controller.events({ from: 0, to: Date.now() + 1e9, limit: 2000 });
    expect(events).toHaveLength(1);
    expect(store.queryByScheduled).not.toHaveBeenCalled(); // served from cache, not the store
  });

  it('eventDetail() returns 404 for an unknown id', async () => {
    const controller = new CalendarController(fakeConfig(true), new CalendarCache(), fakeIngestion(), fakeStore() as never);
    await expect(controller.eventDetail('ff:999:2026-09-16')).rejects.toThrow('No calendar event with id ff:999:2026-09-16');
  });
});
