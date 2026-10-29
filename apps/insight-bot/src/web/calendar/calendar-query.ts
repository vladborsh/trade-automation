import {
  EventImpactSchema, WEB_CALENDAR_DEFAULT_CURRENCY, WEB_CALENDAR_DEFAULT_IMPACTS,
  WEB_MAX_CALENDAR_RANGE_DAYS, WEB_MAX_CALENDAR_UPCOMING_MIN,
} from '@trade-automation/contracts';

/**
 * IB-059 — the calendar endpoints' query parsing, pure so the refusals are specced without Nest.
 * Same rule as `series/range.ts`: a window that is too wide is refused, never trimmed.
 */
const DAY_MS = 86_400_000;
/** `/upcoming` reaches this far back, so an event that just fired is still in the answer. */
export const UPCOMING_LOOKBACK_MS = 5 * 60_000;

export interface CalendarWindow {
  fromMs: number;
  /** Inclusive — the SQL reads `event_time <= to`. */
  toMs: number;
  currency: string;
  impacts: string[];
}

export type CalendarQueryResult =
  | { ok: true; query: CalendarWindow }
  | { ok: false; code: 'BAD_REQUEST'; message: string }
  | { ok: false; code: 'RANGE_TOO_WIDE'; message: string; maxDays: number };

function filters(currency: string | undefined, impact: string | undefined):
  { ok: true; currency: string; impacts: string[] } | { ok: false; code: 'BAD_REQUEST'; message: string } {
  const cur = (currency || WEB_CALENDAR_DEFAULT_CURRENCY).toUpperCase();
  if (!/^[A-Z]{3}$|^ALL$/.test(cur)) return { ok: false, code: 'BAD_REQUEST', message: 'currency must be a 3-letter code' };
  const impacts = impact ? impact.split(',').map((s) => s.trim()).filter(Boolean) : [...WEB_CALENDAR_DEFAULT_IMPACTS];
  if (impacts.length === 0 || impacts.some((i) => !EventImpactSchema.safeParse(i).success)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'unknown impact' };
  }
  // the feed spells the all-currencies row `All`
  return { ok: true, currency: cur === 'ALL' ? 'All' : cur, impacts };
}

/** `from`/`to` epoch ms, `to` exclusive like every other `/api/web` range. */
export function parseCalendarWindow(from: string, to: string, currency?: string, impact?: string): CalendarQueryResult {
  const fromMs = Number(from);
  const toMs = Number(to);
  if (!from || !to || !Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'from and to must be epoch milliseconds' };
  }
  if (toMs <= fromMs) return { ok: false, code: 'BAD_REQUEST', message: 'to must be after from' };
  if (toMs - fromMs > WEB_MAX_CALENDAR_RANGE_DAYS * DAY_MS) {
    return {
      ok: false, code: 'RANGE_TOO_WIDE', maxDays: WEB_MAX_CALENDAR_RANGE_DAYS,
      message: `a calendar range may span at most ${WEB_MAX_CALENDAR_RANGE_DAYS} days`,
    };
  }
  const f = filters(currency, impact);
  if (!f.ok) return f;
  return { ok: true, query: { fromMs, toMs: toMs - 1, currency: f.currency, impacts: f.impacts } };
}

/**
 * `/upcoming`: from a little before `now` to `withinMin` ahead, high-impact USD unless told
 * otherwise (holidays have no instant to warn about).
 */
export function parseUpcoming(now: number, withinMin?: string, currency?: string, impact?: string): CalendarQueryResult {
  const minutes = withinMin === undefined || withinMin === '' ? 60 : Number(withinMin);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, code: 'BAD_REQUEST', message: 'withinMin must be a positive integer' };
  }
  if (minutes > WEB_MAX_CALENDAR_UPCOMING_MIN) {
    return {
      ok: false, code: 'RANGE_TOO_WIDE', maxDays: WEB_MAX_CALENDAR_UPCOMING_MIN / (24 * 60),
      message: `withinMin may be at most ${WEB_MAX_CALENDAR_UPCOMING_MIN}`,
    };
  }
  const f = filters(currency, impact || 'high');
  if (!f.ok) return f;
  return { ok: true, query: { fromMs: now - UPCOMING_LOOKBACK_MS, toMs: now + minutes * 60_000, currency: f.currency, impacts: f.impacts } };
}
