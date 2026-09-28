import { EconomicEvent, EventRevision } from '@trade-automation/contracts';
import { MappedEventDraft } from './ff-feed.mapper';
import { CalendarEventChange } from './calendar-change';

export interface DiffOutcome {
  /** Every event that must be written to the store/cache this poll (created, updated, removed, and unchanged-but-refreshed). */
  toPersist: EconomicEvent[];
  /** Only the (created, updated, removed) subset, each paired with the change kind, for emit + the actuals backfill pass. */
  changes: Array<{ event: EconomicEvent; change: CalendarEventChange }>;
  revisions: EventRevision[];
}

const DIFF_FIELDS = ['title', 'country', 'impact', 'scheduledAt', 'forecast', 'previous'] as const;
type DiffField = (typeof DIFF_FIELDS)[number];

function diffedFields(existing: EconomicEvent, draft: MappedEventDraft): Partial<EconomicEvent> {
  const out: Partial<EconomicEvent> = {};
  for (const field of DIFF_FIELDS) {
    if (existing[field] !== draft[field]) (out as Record<DiffField, unknown>)[field] = draft[field];
  }
  // A future feed-supplied `actual` (§1.3 item 1, §3.5) is diffed too, but never lets a
  // next-previous/provider value get silently clobbered by an absent draft.actual.
  if (draft.actual !== null && draft.actualSource === 'feed' && existing.actual !== draft.actual) {
    out.actual = draft.actual;
    out.actualSource = 'feed';
  }
  return out;
}

/**
 * architecture/economic-calendar.md §3.3 — one snapshot's diff against the events already in the
 * snapshot's own week window (D7). Pure and unit-tested independent of polling/timing.
 */
export function diffSnapshot(
  drafts: MappedEventDraft[],
  currentInWindow: EconomicEvent[],
  existingById: (id: string) => EconomicEvent | null,
  now: number,
): DiffOutcome {
  const toPersist: EconomicEvent[] = [];
  const changes: Array<{ event: EconomicEvent; change: CalendarEventChange }> = [];
  const revisions: EventRevision[] = [];
  const seenIds = new Set<string>();

  for (const draft of drafts) {
    seenIds.add(draft.id);
    const existing = existingById(draft.id);

    if (!existing) {
      const created: EconomicEvent = {
        id: draft.id,
        source: 'forexfactory',
        seriesId: draft.seriesId,
        sourceUrl: draft.sourceUrl,
        title: draft.title,
        country: draft.country,
        impact: draft.impact,
        scheduledAt: draft.scheduledAt,
        scheduledDay: draft.scheduledDay,
        forecast: draft.forecast,
        previous: draft.previous,
        actual: draft.actual,
        actualSource: draft.actualSource,
        actualAt: draft.actual !== null ? now : null,
        status: draft.scheduledAt <= now ? 'released' : 'scheduled',
        firstSeenAt: now,
        lastSeenAt: now,
        revision: 1,
      };
      toPersist.push(created);
      changes.push({ event: created, change: 'created' });
      revisions.push({ eventId: created.id, revision: 1, at: now, change: 'created', before: null, after: created });
      continue;
    }

    const diff = diffedFields(existing, draft);
    if (Object.keys(diff).length > 0) {
      const updated: EconomicEvent = { ...existing, ...diff, lastSeenAt: now, revision: existing.revision + 1 };
      toPersist.push(updated);
      changes.push({ event: updated, change: 'updated' });
      const before: Partial<EconomicEvent> = {};
      const after: Partial<EconomicEvent> = {};
      for (const key of Object.keys(diff) as (keyof EconomicEvent)[]) {
        (before as Record<string, unknown>)[key] = existing[key];
        (after as Record<string, unknown>)[key] = updated[key];
      }
      revisions.push({ eventId: updated.id, revision: updated.revision, at: now, change: 'updated', before, after });
    } else {
      toPersist.push({ ...existing, lastSeenAt: now });
    }
  }

  for (const ev of currentInWindow) {
    if (seenIds.has(ev.id)) continue;
    const removed: EconomicEvent = { ...ev, status: 'removed', lastSeenAt: now, revision: ev.revision + 1 };
    toPersist.push(removed);
    changes.push({ event: removed, change: 'removed' });
    revisions.push({
      eventId: removed.id,
      revision: removed.revision,
      at: now,
      change: 'removed',
      before: { status: ev.status },
      after: { status: 'removed' },
    });
  }

  return { toPersist, changes, revisions };
}
