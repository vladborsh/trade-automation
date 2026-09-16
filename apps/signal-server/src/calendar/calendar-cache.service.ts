import { Injectable } from '@nestjs/common';
import { EconomicEvent } from '@trade-automation/contracts';

/**
 * architecture/economic-calendar.md §3, §4.3 — in-memory Map<id, EconomicEvent>, loaded from
 * the store at boot. The full lookback window (default 400 days, §4.3) is a few MB — every read
 * (REST, WS fan-out, next-previous backfill lookup) is served from here; the store is consulted
 * only for a range outside the cache window.
 */
@Injectable()
export class CalendarCache {
  private readonly events = new Map<string, EconomicEvent>();

  upsert(event: EconomicEvent): void {
    this.events.set(event.id, event);
  }

  get(id: string): EconomicEvent | null {
    return this.events.get(id) ?? null;
  }

  all(): EconomicEvent[] {
    return [...this.events.values()];
  }

  /** Ascending by scheduledAt; all statuses. */
  queryByScheduled(from: number, to: number): EconomicEvent[] {
    return this.all()
      .filter((e) => e.scheduledAt >= from && e.scheduledAt <= to)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  /**
   * architecture/economic-calendar.md §3.3 — "current = cache.inWindow(window) = stored events
   * whose scheduledAt ∈ window and status ≠ 'removed'", the diff's comparison set.
   */
  inWindow(from: number, to: number): EconomicEvent[] {
    return this.all().filter((e) => e.scheduledAt >= from && e.scheduledAt < to && e.status !== 'removed');
  }

  /** Ascending by scheduledAt — the actuals-backfill lookup (§3.5). */
  bySeriesId(seriesId: string): EconomicEvent[] {
    return this.all()
      .filter((e) => e.seriesId === seriesId)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  eventsInWindow(from: number, to: number): number {
    return this.queryByScheduled(from, to).length;
  }
}
