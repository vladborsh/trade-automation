import { EventEmitter2 } from '@nestjs/event-emitter';
import { EconomicEvent } from '@trade-automation/contracts';
import { ActualsBackfillService } from '../../src/calendar/actuals-backfill.service';
import { CalendarCache } from '../../src/calendar/calendar-cache.service';
import { CalendarEvents } from '../../src/calendar/calendar.events';

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:9:2026-08-14',
    source: 'forexfactory',
    seriesId: '9',
    sourceUrl: 'https://www.forexfactory.com/calendar/9-us-cpi',
    title: 'CPI m/m',
    country: 'USD',
    impact: 'high',
    scheduledAt: Date.parse('2026-08-14T08:30:00-04:00'),
    scheduledDay: '2026-08-14',
    forecast: '0.2%',
    previous: '0.1%',
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'released',
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
    ...overrides,
  };
}

function makeStore() {
  return { upsert: jest.fn(async () => undefined), appendRevisions: jest.fn(async () => undefined) };
}

describe('ActualsBackfillService (architecture/economic-calendar.md §3.5)', () => {
  it('two fixtures of the same series a month apart: the earlier event\'s actual equals the later\'s previous, provenance next-previous', async () => {
    const cache = new CalendarCache();
    const earlier = event(); // 2026-08-14, previous null (no actual yet)
    const later = event({
      id: 'ff:9:2026-09-14',
      scheduledDay: '2026-09-14',
      scheduledAt: Date.parse('2026-09-14T08:30:00-04:00'),
      previous: '0.3%', // this month's "previous" is last month's release
    });
    cache.upsert(earlier);
    cache.upsert(later);

    const store = makeStore();
    const events = new EventEmitter2();
    const fired: unknown[] = [];
    events.on(CalendarEvents.EventChanged, (e) => fired.push(e));

    const service = new ActualsBackfillService(cache, events, store as never);
    await service.processChanged([later], 5000);

    const updatedEarlier = cache.get(earlier.id)!;
    expect(updatedEarlier.actual).toBe('0.3%');
    expect(updatedEarlier.actualSource).toBe('next-previous');
    expect(updatedEarlier.actualAt).toBe(5000);
    expect(updatedEarlier.revision).toBe(earlier.revision + 1);

    expect(store.upsert).toHaveBeenCalledWith([expect.objectContaining({ id: earlier.id, actual: '0.3%' })]);
    expect(store.appendRevisions).toHaveBeenCalledWith([expect.objectContaining({ eventId: earlier.id, change: 'actual' })]);
    expect(fired).toHaveLength(1);
  });

  it('never overwrites an actual whose source is "feed"', async () => {
    const cache = new CalendarCache();
    const earlier = event({ actual: '0.15%', actualSource: 'feed', actualAt: 100 });
    const later = event({ id: 'ff:9:2026-09-14', scheduledDay: '2026-09-14', scheduledAt: Date.parse('2026-09-14T08:30:00-04:00'), previous: '0.3%' });
    cache.upsert(earlier);
    cache.upsert(later);

    const store = makeStore();
    const service = new ActualsBackfillService(cache, new EventEmitter2(), store as never);
    await service.processChanged([later], 5000);

    expect(cache.get(earlier.id)!.actual).toBe('0.15%');
    expect(cache.get(earlier.id)!.actualSource).toBe('feed');
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('never overwrites an actual whose source is "provider"', async () => {
    const cache = new CalendarCache();
    const earlier = event({ actual: '0.15%', actualSource: 'provider', actualAt: 100 });
    const later = event({ id: 'ff:9:2026-09-14', scheduledDay: '2026-09-14', scheduledAt: Date.parse('2026-09-14T08:30:00-04:00'), previous: '0.3%' });
    cache.upsert(earlier);
    cache.upsert(later);

    const store = makeStore();
    const service = new ActualsBackfillService(cache, new EventEmitter2(), store as never);
    await service.processChanged([later], 5000);

    expect(cache.get(earlier.id)!.actual).toBe('0.15%');
  });

  it('revises a previously next-previous-sourced actual when a later revision changes the value', async () => {
    const cache = new CalendarCache();
    const earlier = event({ actual: '0.2%', actualSource: 'next-previous', actualAt: 100, revision: 2 });
    const later = event({ id: 'ff:9:2026-09-14', scheduledDay: '2026-09-14', scheduledAt: Date.parse('2026-09-14T08:30:00-04:00'), previous: '0.25%' });
    cache.upsert(earlier);
    cache.upsert(later);

    const store = makeStore();
    const service = new ActualsBackfillService(cache, new EventEmitter2(), store as never);
    await service.processChanged([later], 6000);

    expect(cache.get(earlier.id)!.actual).toBe('0.25%');
    expect(cache.get(earlier.id)!.revision).toBe(3);
  });

  it('does nothing for a speech/meeting event with no numeric previous', async () => {
    const cache = new CalendarCache();
    const speech = event({ id: 'ff:9:2026-09-14', previous: null });
    cache.upsert(speech);

    const store = makeStore();
    const service = new ActualsBackfillService(cache, new EventEmitter2(), store as never);
    await service.processChanged([speech], 5000);

    expect(store.upsert).not.toHaveBeenCalled();
  });
});
