/**
 * IB-058 — the calendar is fetched once per UTC day, as a pure function so the rule is
 * unit-tested without timers or a database.
 *
 * The collector checks every `CALENDAR_CHECK_INTERVAL_MS` and fetches only when there is no
 * successful run recorded for today's UTC date (`calendar_fetch_runs`). That replaces the
 * signal-server cadence (10 min, 2 min around high-impact events, a hot Sunday rollover window):
 *
 * - **The weekly rollover needs no window.** Monday 00:00 UTC is Sunday 20:00 ET, after the feed
 *   has switched to the new week, so Monday's first fetch already sees the whole week.
 * - **`actual` values arrive a day late.** The feed fills them in after release; a day-old fetch
 *   (or the next-occurrence rule) carries them. Accepted by the user on 2026-10-29.
 * - **A failed fetch is retried at the next check**, because no row was written for the day.
 *
 * Budget: 2 requests per UTC day (the JSON and the XML), plus one JSON request per failed check.
 * No venue weight is involved.
 */
export const DAY_MS = 86_400_000;

/** The UTC calendar date of `now`, `YYYY-MM-DD` — the key of `calendar_fetch_runs`. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** True when no successful fetch has been recorded for the UTC day `now` falls in. */
export function isFetchDue(now: number, lastRunDay: string | null): boolean {
  if (lastRunDay === null) return true;
  return lastRunDay < utcDay(now);
}
