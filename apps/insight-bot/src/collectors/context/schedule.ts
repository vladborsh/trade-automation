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
 * **A venue's published rate is a claim; the rate measured under sustained load is the fact.**
 * The design's ~5-15/min for keyless CoinGecko came from a one-off probe, not from a sustained
 * run, which is why the numbers below disagree with it.
 *
 * Measured 2026-09-28, in two steps:
 *
 * 1. Twenty `market_chart` calls back-to-back drew `429 "You've exceeded the Rate Limit"`. The
 *    collector's *daily average* is ~0.11 requests/min — the average was never the constraint,
 *    the burst was, at roughly 60/min instantaneously.
 * 2. Spacing them 6 s apart (10/min) was **still too fast**. Eight probe calls at that spacing,
 *    immediately after a backfill, returned `429, 429, 429, 429, 429, 429, 200, 200` — the
 *    allowance only cleared about 65 s after the last backfill request. The backfill itself ran
 *    at **27 s/coin** (540 s for 20 coins) because the 60 s back-off was absorbing the excess:
 *    it completed correctly, but spent most of its wall time waiting rather than working.
 *
 * So the sustainable keyless rate here is **~2-3 requests/min**, not 10. At 30 s spacing the
 * twenty coins take ten minutes — free, for a once-a-day job nothing waits on — and the job runs
 * at its stated pace instead of living in back-off. When a 429 does occur it is now logged
 * (`onRetry`), because a silent retry hides exactly this.
 */
export const COIN_REQUEST_SPACING_MS = 30_000;
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
