/**
 * IB-036 — when the three context pollers run (§10). Pure, so every rule below is a spec rather
 * than a timing test.
 *
 * - `/global` every **10 minutes** — forward-only, so the cadence is the resolution of a series
 *   that can never be re-collected;
 * - Fear & Greed daily at **00:05 UTC**, after the source's own midnight roll;
 * - per-coin caps daily at **00:10 UTC**, staggered five minutes behind so the two daily jobs do
 *   not spend CoinGecko's per-minute allowance at the same instant.
 */

export const GLOBAL_POLL_MS = 10 * 60_000;

/**
 * How soon a FAILED `/global` poll is retried. Short on purpose: the series is forward-only, so a
 * skipped slot is gone for ever, and a 429 clears in well under ten minutes.
 */
export const GLOBAL_RETRY_MS = 60_000;

/**
 * Spacing between the per-coin `market_chart` calls.
 *
 * **Measured 2026-09-28:** twenty calls back-to-back drew
 * `429 "You've exceeded the Rate Limit"` from CoinGecko, even though the collector's *daily*
 * average is ~0.11 requests/min. The average was never the constraint — the burst was, at roughly
 * 60/min instantaneous. At 6 s spacing the backfill runs at 10/min, inside the ~5-15/min keyless
 * allowance, and takes about two minutes for twenty coins, which nothing is waiting on.
 */
export const COIN_REQUEST_SPACING_MS = 6_000;
export const FNG_DAILY_UTC = { hour: 0, minute: 5 };
export const COINS_DAILY_UTC = { hour: 0, minute: 10 };

export type DailyTask = 'fear-greed' | 'coins';

/**
 * When the next `/global` poll is due, given how this one went. A failure is retried in a minute
 * rather than costing the whole ten-minute slot — the distinction that matters for a series with
 * no history endpoint to recover from.
 */
export function globalDueAfter(nowMs: number, outcome: 'ok' | 'failed'): number {
  return nowMs + (outcome === 'ok' ? GLOBAL_POLL_MS : GLOBAL_RETRY_MS);
}

function minutesOfDay(at: Date): number {
  return at.getUTCHours() * 60 + at.getUTCMinutes();
}

/**
 * Which daily tasks are due at `now`, given the last UTC day they ran (`''` = never).
 *
 * Due means "this UTC day, at or after the task's time, and not yet run today". A process that
 * was down at 00:05 and starts at 03:00 therefore still collects that day rather than skipping
 * to tomorrow — which matters because these two series are also the ones a missed day shows up
 * in permanently.
 */
export function dueDailyTasks(now: Date, lastRunDay: string): DailyTask[] {
  const today = now.toISOString().slice(0, 10);
  if (lastRunDay === today) return [];
  const minute = minutesOfDay(now);
  const due: DailyTask[] = [];
  if (minute >= FNG_DAILY_UTC.hour * 60 + FNG_DAILY_UTC.minute) due.push('fear-greed');
  if (minute >= COINS_DAILY_UTC.hour * 60 + COINS_DAILY_UTC.minute) due.push('coins');
  return due;
}
