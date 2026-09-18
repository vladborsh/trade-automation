import type { EconomicEvent } from '../contracts/calendar';

/** Spec helper: a scheduled USD high-impact event, overridable field by field. */
export function testEvent(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ev-1',
    source: 'forexfactory',
    seriesId: null,
    sourceUrl: null,
    title: 'CPI m/m',
    country: 'USD',
    impact: 'high',
    scheduledAt: 1_790_000_000_000,
    scheduledDay: '2026-09-22',
    forecast: null,
    previous: null,
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
