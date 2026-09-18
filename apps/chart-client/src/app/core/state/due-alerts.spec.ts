import { alertKey, dueAlerts, pruneFired, FIRED_RETENTION_MS } from './due-alerts';
import type { CalendarFilters } from './calendar-filters.store';
import { testEvent } from './calendar-test-events';

const AT = 1_790_000_000_000;
const LEAD = 5 * 60_000;
const FILTERS: CalendarFilters = { impacts: ['medium', 'high', 'holiday'], countries: ['USD', 'EUR', 'GBP'], hideRemoved: false };
const NONE = new Set<string>();

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

  it('events sharing a scheduledAt ring once, keyed by sorted ids', () => {
    const events = [
      testEvent({ id: 'b', scheduledAt: AT }),
      testEvent({ id: 'a', scheduledAt: AT }),
      testEvent({ id: 'c', scheduledAt: AT + 60 * 60_000 }),
    ];
    const due = dueAlerts(events, FILTERS, LEAD, AT - 60_000, NONE);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(`alert:${AT}:a,b`);
    expect(due[0].events.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('a fired key never rings again', () => {
    const events = [testEvent({ id: 'a', scheduledAt: AT })];
    expect(dueAlerts(events, FILTERS, LEAD, AT - 60_000, new Set([alertKey(AT, ['a'])]))).toEqual([]);
  });

  it('a time revision is a new key, so the moved event rings again', () => {
    const fired = new Set([alertKey(AT, ['a'])]);
    const moved = [testEvent({ id: 'a', scheduledAt: AT + 30 * 60_000, revision: 2 })];
    const due = dueAlerts(moved, FILTERS, LEAD, AT + 26 * 60_000, fired);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(alertKey(AT + 30 * 60_000, ['a']));
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
    expect(due.key).toBe(alertKey(AT, ['usd']));
  });
});

describe('pruneFired', () => {
  it('keeps the last 48 h only', () => {
    const now = AT;
    expect(pruneFired({ old: now - FIRED_RETENTION_MS - 1, recent: now - 1000 }, now)).toEqual({ recent: now - 1000 });
  });
});
