import { mergeEvent, CalendarStore } from './calendar.store';
import type { CalendarWeekResponse, EconomicEvent } from '../contracts/calendar';

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:832:2026-09-16',
    source: 'forexfactory',
    seriesId: '832',
    sourceUrl: 'https://www.forexfactory.com/calendar/832-ecb-president-lagarde-speaks',
    title: 'ECB President Lagarde Speaks',
    country: 'EUR',
    impact: 'high',
    scheduledAt: 1_726_500_000_000,
    scheduledDay: '2026-09-16',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 1,
    lastSeenAt: 1,
    revision: 1,
    ...overrides,
  };
}

describe('mergeEvent', () => {
  it('adds a new event by id', () => {
    const result = mergeEvent(new Map(), event());
    expect(result.get('ff:832:2026-09-16')?.title).toBe('ECB President Lagarde Speaks');
  });

  it('replaces the stored event when the incoming revision is newer', () => {
    const stored = new Map([['ff:832:2026-09-16', event({ revision: 1, title: 'stale' })]]);
    const result = mergeEvent(stored, event({ revision: 2, title: 'fresh' }));
    expect(result.get('ff:832:2026-09-16')?.title).toBe('fresh');
  });

  it('replaces when revisions are equal (idempotent re-delivery)', () => {
    const stored = new Map([['ff:832:2026-09-16', event({ revision: 2, title: 'first' })]]);
    const result = mergeEvent(stored, event({ revision: 2, title: 'second' }));
    expect(result.get('ff:832:2026-09-16')?.title).toBe('second');
  });

  it('ignores a stale frame whose revision is behind the stored one', () => {
    const stored = new Map([['ff:832:2026-09-16', event({ revision: 3, title: 'latest' })]]);
    const result = mergeEvent(stored, event({ revision: 2, title: 'stale-late-arrival' }));
    expect(result.get('ff:832:2026-09-16')?.title).toBe('latest');
  });
});

describe('CalendarStore', () => {
  function weekResponse(): CalendarWeekResponse {
    return {
      from: 1_726_000_000_000,
      to: 1_726_600_000_000,
      day: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'],
      events: [event({ id: 'a', scheduledDay: '2026-09-16', scheduledAt: 2000 }), event({ id: 'b', scheduledDay: '2026-09-14', scheduledAt: 1000 })],
    };
  }

  it('sets the week window and groups events by scheduledDay', () => {
    const store = new CalendarStore();
    store.setWeek(weekResponse());

    expect(store.window()).toEqual({
      from: 1_726_000_000_000,
      to: 1_726_600_000_000,
      days: ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'],
    });
    expect(store.eventsByDay().get('2026-09-16')?.map((e) => e.id)).toEqual(['a']);
    expect(store.eventsByDay().get('2026-09-14')?.map((e) => e.id)).toEqual(['b']);
    // ascending by scheduledAt across the whole week
    expect(store.events().map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('mergeLive applies the same revision rule as mergeEvent, on top of a set week', () => {
    const store = new CalendarStore();
    store.setWeek(weekResponse());

    store.mergeLive(event({ id: 'a', scheduledDay: '2026-09-16', scheduledAt: 2000, revision: 2, title: 'revised' }));
    expect(store.get('a')?.title).toBe('revised');

    store.mergeLive(event({ id: 'a', scheduledDay: '2026-09-16', scheduledAt: 2000, revision: 1, title: 'stale' }));
    expect(store.get('a')?.title).toBe('revised');
  });
});
