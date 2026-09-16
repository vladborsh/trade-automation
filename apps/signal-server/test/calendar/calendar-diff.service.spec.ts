import { EconomicEvent } from '@trade-automation/contracts';
import { diffSnapshot } from '../../src/calendar/calendar-diff.service';
import { MappedEventDraft } from '../../src/calendar/feed/ff-feed.mapper';

function draft(overrides: Partial<MappedEventDraft> = {}): MappedEventDraft {
  return {
    id: 'ff:1:2026-09-14',
    seriesId: '1',
    sourceUrl: 'https://www.forexfactory.com/calendar/1-x',
    title: 'X',
    country: 'USD',
    impact: 'medium',
    scheduledAt: Date.parse('2026-09-14T10:00:00-04:00'),
    scheduledDay: '2026-09-14',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    ...overrides,
  };
}

function existing(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    id: 'ff:1:2026-09-14',
    source: 'forexfactory',
    seriesId: '1',
    sourceUrl: 'https://www.forexfactory.com/calendar/1-x',
    title: 'X',
    country: 'USD',
    impact: 'medium',
    scheduledAt: Date.parse('2026-09-14T10:00:00-04:00'),
    scheduledDay: '2026-09-14',
    forecast: null,
    previous: null,
    actual: null,
    actualSource: null,
    actualAt: null,
    status: 'scheduled',
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    revision: 1,
    ...overrides,
  };
}

describe('diffSnapshot (architecture/economic-calendar.md §3.3)', () => {
  it('creates a new event, revision 1, status scheduled when scheduledAt is in the future', () => {
    const now = Date.parse('2026-09-13T00:00:00Z');
    const outcome = diffSnapshot([draft()], [], () => null, now);

    expect(outcome.changes).toEqual([{ event: expect.objectContaining({ id: 'ff:1:2026-09-14', revision: 1, status: 'scheduled' }), change: 'created' }]);
    expect(outcome.revisions).toHaveLength(1);
    expect(outcome.revisions[0]).toMatchObject({ change: 'created', revision: 1, before: null });
  });

  it('creates a new event with status released when scheduledAt has already passed', () => {
    const now = Date.parse('2026-09-15T00:00:00Z'); // after 2026-09-14T14:00Z scheduledAt
    const outcome = diffSnapshot([draft()], [], () => null, now);
    expect(outcome.changes[0].event.status).toBe('released');
  });

  it('updates a changed field (forecast) and bumps revision, recording only the changed field in before/after', () => {
    const prior = existing({ forecast: '1.0%', revision: 3 });
    const now = 5000;
    const outcome = diffSnapshot([draft({ forecast: '2.0%' })], [prior], (id) => (id === prior.id ? prior : null), now);

    expect(outcome.changes).toEqual([{ event: expect.objectContaining({ forecast: '2.0%', revision: 4 }), change: 'updated' }]);
    expect(outcome.revisions[0]).toMatchObject({
      change: 'updated',
      revision: 4,
      before: { forecast: '1.0%' },
      after: { forecast: '2.0%' },
    });
    // country was unchanged — must not appear in before/after.
    expect(outcome.revisions[0].before).not.toHaveProperty('country');
  });

  it('an unchanged row bumps lastSeenAt in the persisted batch but produces no revision or emitted change', () => {
    const prior = existing({ lastSeenAt: 1000 });
    const now = 9000;
    const outcome = diffSnapshot([draft()], [prior], (id) => (id === prior.id ? prior : null), now);

    expect(outcome.changes).toHaveLength(0);
    expect(outcome.revisions).toHaveLength(0);
    expect(outcome.toPersist).toEqual([expect.objectContaining({ id: prior.id, lastSeenAt: 9000 })]);
  });

  it('marks a row that disappeared from its own week window as removed, keeping the record', () => {
    const prior = existing();
    const now = 9000;
    // The snapshot no longer contains `prior` at all.
    const outcome = diffSnapshot([], [prior], (id) => (id === prior.id ? prior : null), now);

    expect(outcome.changes).toEqual([{ event: expect.objectContaining({ id: prior.id, status: 'removed', revision: 2 }), change: 'removed' }]);
    expect(outcome.revisions[0]).toMatchObject({ change: 'removed', before: { status: 'scheduled' }, after: { status: 'removed' } });
  });

  it('week-roll isolation: a row from a PRIOR week not present in currentInWindow is left completely untouched', () => {
    // architecture/economic-calendar.md §3.4 — the diff only ever compares against
    // `currentInWindow` (the snapshot's own week window); a previous week's row that the caller
    // never included in `currentInWindow` must not be touched, removed, or appear in the output
    // at all, even though `existingById` can still resolve it (e.g. for id collisions).
    const priorWeekEvent = existing({ id: 'ff:1:2026-09-07', scheduledDay: '2026-09-07' });
    const now = Date.parse('2026-09-15T00:00:00Z');
    const outcome = diffSnapshot([draft()], [], (id) => (id === priorWeekEvent.id ? priorWeekEvent : null), now);

    expect(outcome.changes.some((c) => c.event.id === priorWeekEvent.id)).toBe(false);
    expect(outcome.toPersist.some((e) => e.id === priorWeekEvent.id)).toBe(false);
  });
});
