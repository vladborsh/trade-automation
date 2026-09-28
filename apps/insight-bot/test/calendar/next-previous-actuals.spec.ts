import { EconomicEvent } from '@trade-automation/contracts';
import { nextPreviousActuals } from '../../src/collectors/calendar/next-previous-actuals';

const SEPT = Date.UTC(2026, 8, 4, 12, 30);
const OCT = Date.UTC(2026, 9, 2, 12, 30);
const NOW = OCT;

function occurrence(scheduledAt: number, overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: `ff:832:${new Date(scheduledAt).toISOString().slice(0, 10)}`,
    source: 'forexfactory', seriesId: '832', sourceUrl: null,
    title: 'Non-Farm Employment Change', country: 'USD', impact: 'high',
    scheduledAt, scheduledDay: new Date(scheduledAt).toISOString().slice(0, 10),
    forecast: null, previous: null, actual: null, actualSource: null, actualAt: null,
    status: 'scheduled', firstSeenAt: scheduledAt, lastSeenAt: scheduledAt, revision: 1,
    ...overrides,
  };
}

/**
 * architecture/economic-calendar.md §3.5 — "when the next occurrence of series n appears, its
 * `previous` is the value released at the prior occurrence".
 */
describe('nextPreviousActuals', () => {
  it("asserts the new occurrence's previous as the prior occurrence's actual, bumping its revision", () => {
    const prior = occurrence(SEPT);
    const next = occurrence(OCT, { previous: '151K' });

    const [applied] = nextPreviousActuals([next], () => [prior, next], NOW);

    expect(applied.id).toBe(prior.id);
    expect(applied.actual).toBe('151K');
    expect(applied.actualSource).toBe('next-previous');
    expect(applied.actualAt).toBe(NOW);
    expect(applied.revision).toBe(2);
  });

  it('never overwrites an actual the feed or a provider asserted', () => {
    for (const source of ['feed', 'provider'] as const) {
      const prior = occurrence(SEPT, { actual: '148K', actualSource: source });
      const next = occurrence(OCT, { previous: '151K' });
      expect(nextPreviousActuals([next], () => [prior, next], NOW)).toEqual([]);
    }
  });

  it('revises its OWN earlier value when the feed later disagrees with it', () => {
    const prior = occurrence(SEPT, { actual: '148K', actualSource: 'next-previous', revision: 2 });
    const next = occurrence(OCT, { previous: '151K' });

    const [applied] = nextPreviousActuals([next], () => [prior, next], NOW);
    expect(applied.actual).toBe('151K');
    expect(applied.revision).toBe(3);
  });

  it('is a no-op when it would write the same value again — no revision churn', () => {
    const prior = occurrence(SEPT, { actual: '151K', actualSource: 'next-previous' });
    const next = occurrence(OCT, { previous: '151K' });
    expect(nextPreviousActuals([next], () => [prior, next], NOW)).toEqual([]);
  });

  it('picks the LATEST prior occurrence, not the first', () => {
    const july = occurrence(Date.UTC(2026, 6, 3, 12, 30));
    const august = occurrence(Date.UTC(2026, 7, 7, 12, 30));
    const next = occurrence(OCT, { previous: '151K' });

    // deliberately unsorted, the way a Map's values arrive
    const [applied] = nextPreviousActuals([next], () => [next, july, august], NOW);
    expect(applied.id).toBe(august.id);
  });

  it('skips a removed prior occurrence and an event with no series or no previous', () => {
    const removedPrior = occurrence(SEPT, { status: 'removed' });
    const next = occurrence(OCT, { previous: '151K' });
    expect(nextPreviousActuals([next], () => [removedPrior, next], NOW)).toEqual([]);

    expect(nextPreviousActuals([occurrence(OCT, { previous: null })], () => [occurrence(SEPT)], NOW)).toEqual([]);
    expect(
      nextPreviousActuals([occurrence(OCT, { seriesId: null, previous: '151K' })], () => [occurrence(SEPT)], NOW),
    ).toEqual([]);
  });

  it('bumps the prior event once even when the same change is seen twice in one snapshot', () => {
    const prior = occurrence(SEPT);
    const next = occurrence(OCT, { previous: '151K' });

    const applied = nextPreviousActuals([next, next], () => [prior, next], NOW);
    expect(applied).toHaveLength(1);
    expect(applied[0].revision).toBe(2); // not 3 — one bump, not one per caller
  });
});
