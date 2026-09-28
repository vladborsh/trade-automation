import { EconomicEvent } from '@trade-automation/contracts';
import { calendarEventRow, economicEventFromRow } from '../../src/collectors/calendar/calendar-row';
import { EventInWindow } from '../../src/collectors/calendar/events-in-window';

const NFP_AT = Date.UTC(2026, 8, 4, 12, 30);

function event(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:832:2026-09-04',
    source: 'forexfactory',
    seriesId: '832',
    sourceUrl: 'https://www.forexfactory.com/calendar/832-usd-non-farm',
    title: 'Non-Farm Employment Change',
    country: 'USD',
    impact: 'high',
    scheduledAt: NFP_AT,
    scheduledDay: '2026-09-04',
    forecast: '165K',
    previous: '142K',
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: NFP_AT - 86_400_000,
    lastSeenAt: NFP_AT,
    revision: 1,
    ...overrides,
  };
}

describe('calendarEventRow (§3.3, §16.7 projection)', () => {
  it('maps the event onto the row, currency taken from the feed’s country field', () => {
    const row = calendarEventRow(event(), NFP_AT);
    expect(row).toEqual({
      id: 'ff:832:2026-09-04',
      revision: 1,
      source: 'forexfactory',
      seriesId: '832',
      eventTime: new Date(NFP_AT),
      currency: 'USD', // EventCountrySchema is already a currency code
      title: 'Non-Farm Employment Change',
      impact: 'high',
      status: 'scheduled',
      forecast: '165K',
      previous: '142K',
      actual: null,
      actualSource: null,
      fetchedAt: new Date(NFP_AT),
    });
  });

  it('keeps a RELEASED event as status scheduled — §9.3 vetoes for an hour AFTER the event', () => {
    expect(calendarEventRow(event({ status: 'released' }), NFP_AT).status).toBe('scheduled');
  });

  it('writes a removed event as cancelled, which is what takes it out of the veto', () => {
    expect(calendarEventRow(event({ status: 'removed', revision: 2 }), NFP_AT).status).toBe('cancelled');
  });

  it('carries seriesId and actualSource, the two columns the actuals rule needs', () => {
    const row = calendarEventRow(event({ actual: '151K', actualSource: 'next-previous' }), NFP_AT);
    expect(row.seriesId).toBe('832');
    expect(row.actual).toBe('151K');
    expect(row.actualSource).toBe('next-previous');
  });

  it('leaves seriesId null for a synthetic ffx: id (the JSON/XML join failed)', () => {
    expect(calendarEventRow(event({ id: 'ffx:abc', seriesId: null }), NFP_AT).seriesId).toBeNull();
  });
});

describe('economicEventFromRow (the reverse projection the collector seeds its diff with)', () => {
  function row(overrides: Partial<EventInWindow> = {}): EventInWindow {
    return {
      id: 'ff:832:2026-09-04',
      revision: 3,
      series_id: '832',
      event_time: new Date(NFP_AT),
      currency: 'USD',
      title: 'Non-Farm Employment Change',
      impact: 'high',
      status: 'scheduled',
      forecast: '165K',
      previous: '142K',
      actual: null,
      actual_source: null,
      fetched_at: new Date(NFP_AT),
      ...overrides,
    };
  }

  it('round-trips every field the diff compares', () => {
    const before = event({ revision: 3 });
    const back = economicEventFromRow(row(), NFP_AT - 1);
    for (const field of ['title', 'country', 'impact', 'scheduledAt', 'forecast', 'previous', 'revision'] as const) {
      expect(back[field]).toEqual(before[field]);
    }
  });

  it('restores the ET scheduledDay the id is built from', () => {
    expect(economicEventFromRow(row(), NFP_AT).scheduledDay).toBe('2026-09-04');
  });

  it('un-maps cancelled back to removed, so a withdrawn event is not re-created next poll', () => {
    expect(economicEventFromRow(row({ status: 'cancelled' }), NFP_AT).status).toBe('removed');
  });

  it('calls a scheduled row released once its time has passed, as the diff would have', () => {
    expect(economicEventFromRow(row(), NFP_AT - 1).status).toBe('scheduled');
    expect(economicEventFromRow(row(), NFP_AT + 1).status).toBe('released');
  });

  it('keeps actualSource, so the guard that never overwrites a feed actual survives a restart', () => {
    const back = economicEventFromRow(row({ actual: '151K', actual_source: 'feed' }), NFP_AT);
    expect(back.actual).toBe('151K');
    expect(back.actualSource).toBe('feed');
  });
});
