import { CalendarEventStatus } from '../writers/tables';

/**
 * architecture/insight-bot-system-design.md §9.3, §16.7 — **the one query** the EVENT_RISK veto,
 * the T−60 notice and the morning plan all read the calendar through. Pure SQL text plus params,
 * so the shape is unit-tested without a database, exactly like `upsert.ts`'s builders.
 *
 * Two things it must get right, neither of which the schema enforces:
 *
 * 1. **Latest revision per id.** Every revision is kept (PK `id, revision`), so a plain filter
 *    returns a rescheduled or corrected event once per revision. `distinct on (id) … order by id,
 *    revision desc` collapses each id to its newest row *before* anything else looks at it.
 * 2. **Positive status filter.** §9.3 reads `status = 'scheduled'` on that latest revision — not
 *    `<> 'cancelled'` — so a value nobody has taught the veto about (a future `rescheduled`)
 *    cannot fire it by default.
 *
 * The filters run inside the sub-select, so the index
 * `calendar_events (impact, currency, event_time)` serves it directly.
 */
export interface EventWindowFilter {
  /** Inclusive lower bound on `event_time`. */
  from: Date;
  /** Inclusive upper bound on `event_time`. */
  to: Date;
  /** `'high'` for the veto. Omit for every impact. */
  impact?: string;
  /** IB-059: any of several impacts (the dashboard reads `high` and `holiday`). Ignored when `impact` is set. */
  impacts?: readonly string[];
  /** `'USD'` for the veto. Omit for every currency. */
  currency?: string;
  /** Defaults to `'scheduled'` — §9.3's positive filter. */
  status?: CalendarEventStatus;
}

export interface EventInWindow {
  id: string;
  revision: number;
  series_id: string | null;
  event_time: Date;
  currency: string | null;
  title: string | null;
  impact: string | null;
  status: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  actual_source: string | null;
  fetched_at: Date;
}

const SELECTED = [
  'id',
  'revision',
  'series_id',
  'event_time',
  'currency',
  'title',
  'impact',
  'status',
  'forecast',
  'previous',
  'actual',
  'actual_source',
  'fetched_at',
].join(', ');

export function buildEventsInWindow(filter: EventWindowFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [filter.from, filter.to];
  const conditions = ['event_time >= $1', 'event_time <= $2'];

  if (filter.impact !== undefined) {
    params.push(filter.impact);
    conditions.push(`impact = $${params.length}`);
  } else if (filter.impacts !== undefined) {
    params.push([...filter.impacts]);
    conditions.push(`impact = any($${params.length}::text[])`);
  }
  if (filter.currency !== undefined) {
    params.push(filter.currency);
    conditions.push(`currency = $${params.length}`);
  }
  params.push(filter.status ?? 'scheduled');
  const statusParam = params.length;

  // The status filter sits OUTSIDE the distinct-on: an event whose latest revision cancelled it
  // must disappear, not fall back to its previous, still-'scheduled' revision.
  const sql =
    `select ${SELECTED} from (` +
    `select distinct on (id) ${SELECTED} from calendar_events` +
    ` where ${conditions.join(' and ')}` +
    ` order by id, revision desc` +
    `) latest where status = $${statusParam} order by event_time, id`;

  return { sql, params };
}

/** §9.3's own call: high-impact USD events whose latest revision is still scheduled. */
export function buildHighImpactUsdWindow(from: Date, to: Date): { sql: string; params: unknown[] } {
  return buildEventsInWindow({ from, to, impact: 'high', currency: 'USD' });
}
