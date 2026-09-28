import { EconomicEvent } from '@trade-automation/contracts';

/**
 * architecture/economic-calendar.md §3.5, IB-010 ("reuse the next-occurrence actuals backfill
 * rule") — "when the next occurrence of series n appears, its `previous` is the value released at
 * the prior occurrence". Free, no provider, no scraping.
 *
 * Pure: it takes the events that just changed and a lookup of the occurrences of a series, and
 * returns the **prior** events it can now assert an `actual` on, each already carrying its bumped
 * revision. The caller writes them as ordinary revision rows.
 *
 * The guard is the one signal-server's `ActualsBackfillService` applies, and it is the reason
 * `actual_source` had to become a column (§16.7): a value this rule wrote may be revised by a
 * later, better value from the same rule, but an `actual` that came from the feed or a provider
 * is **never** overwritten.
 */
export function nextPreviousActuals(
  changed: readonly EconomicEvent[],
  occurrencesOf: (seriesId: string) => readonly EconomicEvent[],
  now: number,
): EconomicEvent[] {
  const applied = new Map<string, EconomicEvent>();

  for (const event of changed) {
    if (!event.seriesId || event.previous === null) continue;

    const prior = [...occurrencesOf(event.seriesId)]
      .filter((p) => p.scheduledAt < event.scheduledAt && p.status !== 'removed')
      .sort((a, b) => a.scheduledAt - b.scheduledAt)
      .pop();
    if (!prior) continue;

    const current = applied.get(prior.id) ?? prior;
    if (current.actualSource === 'feed' || current.actualSource === 'provider') continue;
    if (current.actual === event.previous && current.actualSource === 'next-previous') continue;

    applied.set(prior.id, {
      ...current,
      actual: event.previous,
      actualSource: 'next-previous',
      actualAt: now,
      revision: current.revision + 1,
    });
  }

  return [...applied.values()];
}
