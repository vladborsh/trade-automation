import type { NewsSource } from './sources';

/**
 * IB-027 — when each news source is polled (§10). Pure, so every rule here is a spec rather than a
 * timing test.
 *
 * Each source carries its own `pollMs` (5 min for the crypto outlets, 15 for SEC and CFTC, which
 * publish rarely). The two things this file adds on top are both about failure:
 *
 * - **A failing source backs off** rather than being retried at its normal cadence. A feed that
 *   is down, rate-limiting us or has moved does not become healthier for being asked every five
 *   minutes, and a tight retry on one dead source is how a polite client becomes an impolite one.
 * - **A failing source never blocks the others.** State is per source, so nine healthy feeds keep
 *   their cadence while the tenth backs off.
 *
 * Missing a poll is cheap here and that shapes the numbers: the feeds are a rolling window of
 * roughly three to four days (measured 2026-09-28), so a source re-serves everything we missed and
 * the dedupe collapses it. Only an outage longer than the window loses anything, which is why the
 * backoff below is allowed to grow to an hour rather than fighting to keep the five-minute slot.
 */

/** Doubling per consecutive failure, capped so a recovered feed is picked up within the hour. */
export const MAX_BACKOFF_MS = 60 * 60_000;

export interface SourceState {
  /** When this source was last attempted, successfully or not. 0 = never. */
  lastAttemptAt: number;
  consecutiveFailures: number;
}

export const FRESH_STATE: SourceState = { lastAttemptAt: 0, consecutiveFailures: 0 };

/**
 * How long after an attempt the next one is allowed.
 *
 * On success that is simply the source's cadence. On failure it is the cadence doubled per
 * consecutive failure and capped — so a feed that fails once is retried soon, and one that has
 * failed all morning is asked hourly.
 */
export function nextDelayMs(source: NewsSource, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return source.pollMs;
  const grown = source.pollMs * 2 ** consecutiveFailures;
  return Math.min(grown, MAX_BACKOFF_MS);
}

/**
 * The sources due at `now`.
 *
 * A source never attempted is due immediately: on a cold start everything is polled at once, which
 * is ten requests across ten different hosts and costs nobody anything.
 */
export function dueSources(
  now: number,
  sources: readonly NewsSource[],
  state: ReadonlyMap<string, SourceState>,
): NewsSource[] {
  return sources.filter((source) => {
    const current = state.get(source.id) ?? FRESH_STATE;
    if (current.lastAttemptAt === 0) return true;
    return now - current.lastAttemptAt >= nextDelayMs(source, current.consecutiveFailures);
  });
}

/** The state after an attempt. Failures accumulate; one success clears them. */
export function afterAttempt(previous: SourceState | undefined, now: number, ok: boolean): SourceState {
  const base = previous ?? FRESH_STATE;
  return {
    lastAttemptAt: now,
    // cleared on success rather than decremented: a feed that works is working, and decrementing
    // would keep a recovered source on a long delay for as many cycles as it had failed
    consecutiveFailures: ok ? 0 : base.consecutiveFailures + 1,
  };
}
