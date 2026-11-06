import type { EconomicEvent } from '@trade-automation/contracts';
import { describe, expect, it } from 'vitest';
import { badgeKey, pinAfter, sameBadges } from './calendar-badge-key';
import type { CalendarMark } from './calendar-marks';

function ev(over: Partial<EconomicEvent>): EconomicEvent {
  return {
    id: 'ff:1:2026-10-28', source: 'forexfactory', seriesId: '1', sourceUrl: null, title: 'CPI m/m',
    country: 'USD', impact: 'high', scheduledAt: 1_793_190_600_000, scheduledDay: '2026-10-28',
    forecast: '0.3%', previous: '0.2%', actual: null, actualSource: null, actualAt: null, status: 'scheduled',
    firstSeenAt: 0, lastSeenAt: 0, revision: 1, ...over,
  };
}
const mark = (time: number, ...events: EconomicEvent[]): CalendarMark => ({ time, events });

/** IB-BUG-050 — the badges are rebuilt only when what they draw changed. */
describe('sameBadges', () => {
  it('a fresh answer with equal marks (new objects, new arrays) draws the same badges', () => {
    expect(sameBadges([mark(100, ev({}))], [mark(100, ev({}))])).toBe(true);
    expect(sameBadges([], [])).toBe(true);
  });
  it('the figures and the revision are the tooltip\'s, not the badge\'s', () => {
    expect(sameBadges([mark(100, ev({}))], [mark(100, ev({ actual: '0.4%', actualAt: 5, revision: 2 }))])).toBe(true);
  });
  it('a different bar, event, title, flag country, count or order is a rebuild', () => {
    const a = [mark(100, ev({})), mark(200, ev({ id: 'b' }))];
    expect(sameBadges(a, [mark(160, ev({})), a[1]])).toBe(false);
    expect(sameBadges(a, [mark(100, ev({ id: 'x' })), a[1]])).toBe(false);
    expect(sameBadges(a, [mark(100, ev({ title: 'Core CPI m/m' })), a[1]])).toBe(false);
    expect(sameBadges(a, [mark(100, ev({ country: 'EUR' })), a[1]])).toBe(false);
    expect(sameBadges(a, [a[0]])).toBe(false);
    expect(sameBadges(a, [a[1], a[0]])).toBe(false);
    expect(sameBadges([mark(100, ev({}))], [mark(100, ev({}), ev({ id: 'b' }))])).toBe(false);
  });
  it('the key cannot be fooled by a separator inside a title', () => {
    expect(badgeKey(mark(1, ev({ title: 'a","b' })))).not.toBe(badgeKey(mark(1, ev({ title: 'a' }), ev({ id: 'b' }))));
  });
});

describe('pinAfter', () => {
  const marks = [mark(100, ev({})), mark(200, ev({ id: 'b' }))];
  it('keeps the pin on a bar that still has a mark', () => expect(pinAfter(200, marks)).toBe(200));
  it('drops it when that bar has no mark any more', () => expect(pinAfter(300, marks)).toBeNull());
  it('nothing pinned stays nothing', () => expect(pinAfter(null, marks)).toBeNull());
});
