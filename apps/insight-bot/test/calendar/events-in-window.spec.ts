import {
  buildEventsInWindow,
  buildHighImpactUsdWindow,
} from '../../src/collectors/calendar/events-in-window';

/**
 * §9.3, §16.7 — the one query the veto, the T−60 notice and the morning plan read the calendar
 * through. The two properties that make it correct are not enforced by the schema, so they are
 * asserted here.
 */
describe('buildEventsInWindow', () => {
  const from = new Date('2026-09-28T00:00:00Z');
  const to = new Date('2026-09-29T00:00:00Z');

  it('collapses each id to its newest revision before anything else looks at it', () => {
    const { sql } = buildEventsInWindow({ from, to });
    expect(sql).toContain('select distinct on (id)');
    expect(sql).toContain('order by id, revision desc');
  });

  it('applies the status filter OUTSIDE the distinct-on, so a cancelled latest revision hides the event', () => {
    const { sql } = buildEventsInWindow({ from, to });
    const distinctEnd = sql.indexOf(') latest');
    const statusFilter = sql.indexOf('where status =');
    expect(distinctEnd).toBeGreaterThan(-1);
    expect(statusFilter).toBeGreaterThan(distinctEnd); // outside the sub-select, not inside it
  });

  it("filters positively on 'scheduled' by default rather than excluding 'cancelled'", () => {
    const { sql, params } = buildEventsInWindow({ from, to });
    expect(params[params.length - 1]).toBe('scheduled');
    expect(sql).not.toContain('<>');
    expect(sql).not.toContain('!=');
  });

  it('numbers the parameters in the order it pushes them, whichever optional filters are present', () => {
    const none = buildEventsInWindow({ from, to });
    expect(none.params).toEqual([from, to, 'scheduled']);
    expect(none.sql).toContain('where status = $3');

    const both = buildEventsInWindow({ from, to, impact: 'high', currency: 'USD' });
    expect(both.params).toEqual([from, to, 'high', 'USD', 'scheduled']);
    expect(both.sql).toContain('impact = $3');
    expect(both.sql).toContain('currency = $4');
    expect(both.sql).toContain('where status = $5');

    const currencyOnly = buildEventsInWindow({ from, to, currency: 'EUR' });
    expect(currencyOnly.params).toEqual([from, to, 'EUR', 'scheduled']);
    expect(currencyOnly.sql).toContain('currency = $3');
  });

  it('bounds the window inclusively on event_time', () => {
    const { sql } = buildEventsInWindow({ from, to });
    expect(sql).toContain('event_time >= $1');
    expect(sql).toContain('event_time <= $2');
  });

  it('takes an explicit status when a caller wants the cancelled rows (the collector seeding its cache)', () => {
    const { params } = buildEventsInWindow({ from, to, status: 'cancelled' });
    expect(params[params.length - 1]).toBe('cancelled');
  });

  it('§9.3: the veto helper is high impact, USD, scheduled', () => {
    const { params } = buildHighImpactUsdWindow(from, to);
    expect(params).toEqual([from, to, 'high', 'USD', 'scheduled']);
  });

  it('orders the result by event_time so the caller can take the nearest event without sorting', () => {
    expect(buildEventsInWindow({ from, to }).sql).toContain('order by event_time, id');
  });
});
