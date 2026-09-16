import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EconomicEvent, EventRevision } from '@trade-automation/contracts';
import { EVENT_STORE, EventStore } from '../storage/event-store.port';
import { CalendarCache } from './calendar-cache.service';
import { CalendarEventChangedEvent, CalendarEvents } from './calendar.events';

/**
 * architecture/economic-calendar.md §1.3, §3.5 — a provider-backed source would implement this
 * behind the same port, setting `actualSource: 'provider'`. Not built here: needs a user
 * decision on the provider and its key (§10 escalation pre-answer (c) — never add one on our
 * own initiative).
 */
export interface ActualsSource {
  readonly id: 'next-previous' | string;
  /** Called after every ingestion diff; returns actual values it can now assert on a PRIOR event. */
  resolve(
    changed: EconomicEvent[],
    lookup: (seriesId: string) => EconomicEvent[],
  ): Promise<Array<{ eventId: string; actual: string }>>;
}

/**
 * architecture/economic-calendar.md §3.5 — "when the next occurrence of series <n> appears, its
 * `previous` is the value released at the prior occurrence." Free, no credentials, no scraping;
 * the only source that costs nothing and keeps the history table self-consistent.
 */
export class NextPreviousActualsSource implements ActualsSource {
  readonly id = 'next-previous' as const;

  async resolve(
    changed: EconomicEvent[],
    lookup: (seriesId: string) => EconomicEvent[],
  ): Promise<Array<{ eventId: string; actual: string }>> {
    const updates: Array<{ eventId: string; actual: string }> = [];
    for (const e of changed) {
      if (!e.seriesId || e.previous === null) continue;
      const priorOccurrences = lookup(e.seriesId).filter((p) => p.scheduledAt < e.scheduledAt && p.status !== 'removed');
      if (priorOccurrences.length === 0) continue;
      const prior = priorOccurrences[priorOccurrences.length - 1]; // ascending order — latest prior
      const isRevision = prior.actualSource === 'next-previous' && prior.actual !== e.previous;
      if (prior.actual === null || isRevision) {
        updates.push({ eventId: prior.id, actual: e.previous });
      }
    }
    return updates;
  }
}

/**
 * architecture/economic-calendar.md §3.5 — runs every registered `ActualsSource` after each
 * ingestion diff and applies the results: never overwrites an `actual` whose source is `'feed'`
 * or `'provider'` (only ever revises its own `'next-previous'` writes).
 */
@Injectable()
export class ActualsBackfillService {
  private readonly sources: ActualsSource[] = [new NextPreviousActualsSource()];

  constructor(
    private readonly cache: CalendarCache,
    private readonly events: EventEmitter2,
    @Inject(EVENT_STORE) private readonly store: EventStore,
  ) {}

  async processChanged(changed: EconomicEvent[], now: number = Date.now()): Promise<void> {
    const toUpsert: EconomicEvent[] = [];
    const revisions: EventRevision[] = [];

    for (const source of this.sources) {
      const updates = await source.resolve(changed, (seriesId) => this.cache.bySeriesId(seriesId));
      for (const update of updates) {
        const prior = this.cache.get(update.eventId);
        if (!prior) continue;
        if (prior.actualSource === 'feed' || prior.actualSource === 'provider') continue; // never overwrite
        if (prior.actual === update.actual && prior.actualSource === source.id) continue; // no-op

        const applied: EconomicEvent = {
          ...prior,
          actual: update.actual,
          actualSource: source.id as EconomicEvent['actualSource'],
          actualAt: now,
          revision: prior.revision + 1,
        };
        this.cache.upsert(applied);
        toUpsert.push(applied);
        revisions.push({
          eventId: applied.id,
          revision: applied.revision,
          at: now,
          change: 'actual',
          before: { actual: prior.actual, actualSource: prior.actualSource },
          after: { actual: applied.actual, actualSource: applied.actualSource },
        });
        this.events.emit(CalendarEvents.EventChanged, new CalendarEventChangedEvent(applied, 'actual'));
      }
    }

    if (toUpsert.length > 0) {
      await this.store.upsert(toUpsert);
      await this.store.appendRevisions(revisions);
    }
  }
}
