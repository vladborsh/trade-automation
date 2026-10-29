import { alertKey, dueAlerts as dueAlertsWith, pruneFired, FIRED_RETENTION_MS } from '@trade-automation/calendar-core/due-alerts';
import { passesFilters, type CalendarFilters } from './calendar-filters.store';
import { testEvent } from './calendar-test-events';

const AT = 1_790_000_000_000;
const LEAD = 5 * 60_000;
const FILTERS: CalendarFilters = { impacts: ['medium', 'high', 'holiday'], countries: ['USD', 'EUR', 'GBP'], hideRemoved: false };
const NONE = new Set<string>();

// IB-061: the rule moved to @trade-automation/calendar-core with the filter as a parameter; this
// spec keeps testing it through the SPA's own filters, unchanged.
const dueAlerts = (events: Iterable<ReturnType<typeof testEvent>>, filters: CalendarFilters, lead: number, now: number, fired: ReadonlySet<string>) =>
  dueAlertsWith(events, (e) => passesFilters(e, filters), lead, now, fired);

describe('dueAlerts (§11.5)', () => {
  it('is due from scheduledAt − lead, not before', () => {
    const events = [testEvent({ scheduledAt: AT })];
    expect(dueAlerts(events, FILTERS, LEAD, AT - LEAD - 1, NONE)).toEqual([]);
    expect(dueAlerts(events, FILTERS, LEAD, AT - LEAD, NONE)).toHaveLength(1);
  });

  it('late: still due up to +60 s, dropped silently after', () => {
    const events = [testEvent({ scheduledAt: AT })];
    expect(dueAlerts(events, FILTERS, LEAD, AT + 60_000, NONE)).toHaveLength(1);
    expect(dueAlerts(events, FILTERS, LEAD, AT + 60_001, NONE)).toEqual([]);
  });

  it('events sharing a scheduledAt ring once, keyed by the instant', () => {
    const events = [
      testEvent({ id: 'b', scheduledAt: AT }),
      testEvent({ id: 'a', scheduledAt: AT }),
      testEvent({ id: 'c', scheduledAt: AT + 60 * 60_000 }),
    ];
    const due = dueAlerts(events, FILTERS, LEAD, AT - 60_000, NONE);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(`alert:${AT}`);
    expect(due[0].events.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('a fired key never rings again', () => {
    const events = [testEvent({ id: 'a', scheduledAt: AT })];
    expect(dueAlerts(events, FILTERS, LEAD, AT - 60_000, new Set([alertKey(AT)]))).toEqual([]);
  });

  it('a time revision is a new key, so the moved event rings again', () => {
    const fired = new Set([alertKey(AT)]);
    const moved = [testEvent({ id: 'a', scheduledAt: AT + 30 * 60_000, revision: 2 })];
    const due = dueAlerts(moved, FILTERS, LEAD, AT + 26 * 60_000, fired);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(alertKey(AT + 30 * 60_000));
  });

  it('a filter change inside the lead window does not re-ring the same instant', () => {
    const events = [testEvent({ id: 'usd' }), testEvent({ id: 'jpy', country: 'JPY' })];
    const [first] = dueAlerts(events, FILTERS, LEAD, AT - 4 * 60_000, NONE);
    expect(first.events.map((e) => e.id)).toEqual(['usd']);
    const fired = new Set([first.key]);

    const widened: CalendarFilters = { ...FILTERS, countries: [...FILTERS.countries, 'JPY'] };
    expect(dueAlerts(events, widened, LEAD, AT - 3 * 60_000, fired)).toEqual([]);
    const narrowed: CalendarFilters = { ...FILTERS, countries: ['USD'] };
    expect(dueAlerts(events, narrowed, LEAD, AT - 2 * 60_000, fired)).toEqual([]);
  });

  it('only scheduled events passing the filters ring', () => {
    const events = [
      testEvent({ id: 'released', status: 'released' }),
      testEvent({ id: 'removed', status: 'removed' }),
      testEvent({ id: 'low', impact: 'low' }),
      testEvent({ id: 'jpy', country: 'JPY' }),
    ];
    expect(dueAlerts(events, FILTERS, LEAD, AT - 60_000, NONE)).toEqual([]);
  });

  it('the group holds only the passing events of that time', () => {
    const events = [testEvent({ id: 'usd' }), testEvent({ id: 'jpy', country: 'JPY' })];
    const [due] = dueAlerts(events, FILTERS, LEAD, AT - 60_000, NONE);
    expect(due.key).toBe(alertKey(AT));
  });
});

describe('pruneFired', () => {
  it('keeps the last 48 h only', () => {
    const now = AT;
    expect(pruneFired({ old: now - FIRED_RETENTION_MS - 1, recent: now - 1000 }, now)).toEqual({ recent: now - 1000 });
  });
});
