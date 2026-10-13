import type { Listing, Network } from './mappers';

/**
 * IB-028 — when each (network, listing) is fetched. Pure, so the cadence is a spec rather than a
 * timing test.
 *
 * ## The spacing is the rate limit, expressed as code
 *
 * Measured 2026-10-12 (see `README.md` for the full table): GeckoTerminal serves about **5 requests
 * a minute** however fast you ask, and refuses the **4th request inside 0.3 s** separately. So two
 * numbers matter, and only one of them is the per-minute rate:
 *
 * - the per-minute allowance decides how many calls a cycle may contain;
 * - the burst limit decides that they must be SPACED, not merely few.
 *
 * Eight calls fired together respect the first and violate the second: three of the four networks
 * would take a 429 and collect nothing, while the minute's budget was never exceeded. That failure
 * reads as "those networks have no new pools", which is the silent-zero shape again.
 */

export const NETWORKS: readonly Network[] = ['solana', 'base', 'bsc', 'eth'];
export const LISTINGS: readonly Listing[] = ['new_pools', 'trending_pools'];

/** §10: every ten minutes. */
export const CYCLE_MS = 10 * 60_000;

/**
 * 75 seconds between calls — 8 calls spread across a 10-minute cycle.
 *
 * = 0.8 requests/minute, **16 % of the measured clean ceiling of ~5/min**, and far enough apart
 * that the burst limit is never approached. The instruction was to stay under half; this is under
 * a fifth, deliberately, because the ceiling was measured on one day from one IP and a poller
 * sitting at half its measured limit has nowhere to go when the limit moves.
 */
export const CALL_SPACING_MS = 75_000;

export interface Call {
  network: Network;
  listing: Listing;
}

/** The eight calls of one cycle, interleaved so a cycle cut short still covers every network. */
export function cycleCalls(): Call[] {
  const calls: Call[] = [];
  // listing-major rather than network-major: if a cycle is interrupted after four calls we have
  // `new_pools` for all four networks rather than both listings for two networks and nothing for
  // the others. Partial coverage of everything beats full coverage of half.
  for (const listing of LISTINGS) {
    for (const network of NETWORKS) calls.push({ network, listing });
  }
  return calls;
}

export interface CallState {
  /** When this (network, listing) was last attempted. 0 = never. */
  lastAttemptAt: number;
  consecutiveFailures: number;
}

export const FRESH: CallState = { lastAttemptAt: 0, consecutiveFailures: 0 };

/** A 429 is not an error to retry hard; it is the venue saying the budget is spent. */
export const BACKOFF_BASE_MS = CYCLE_MS;
export const MAX_BACKOFF_MS = 60 * 60_000;

export function nextDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return CYCLE_MS;
  return Math.min(BACKOFF_BASE_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
}

/** Key for the state map; `${network}:${listing}` is unique per call. */
export const keyOf = (call: Call): string => `${call.network}:${call.listing}`;

/**
 * The next call due at `now`, or null.
 *
 * **One at a time, deliberately.** The caller invokes this on a short tick and makes at most one
 * request per return, which is what produces the spacing: a function returning the whole due list
 * would invite a caller to loop it and recreate the burst this exists to prevent.
 */
export function nextDue(
  now: number,
  state: ReadonlyMap<string, CallState>,
  lastCallAt: number,
): Call | null {
  // never two calls closer together than the spacing, whatever is due
  if (lastCallAt !== 0 && now - lastCallAt < CALL_SPACING_MS) return null;

  let best: { call: Call; waited: number } | null = null;
  for (const call of cycleCalls()) {
    const current = state.get(keyOf(call)) ?? FRESH;
    const due = current.lastAttemptAt === 0
      ? Number.POSITIVE_INFINITY // never fetched: the most overdue thing there is
      : now - current.lastAttemptAt - nextDelayMs(current.consecutiveFailures);
    if (due < 0) continue;
    // the one waiting longest, so a cycle cannot starve the last call in the list
    if (best === null || due > best.waited) best = { call, waited: due };
  }
  return best?.call ?? null;
}

export function afterAttempt(previous: CallState | undefined, now: number, ok: boolean): CallState {
  const base = previous ?? FRESH;
  return {
    lastAttemptAt: now,
    consecutiveFailures: ok ? 0 : base.consecutiveFailures + 1,
  };
}

/**
 * The three GoPlus looks at a token, as ONE table.
 *
 * §10 asks for a security check at first sight, +6 h and +24 h. First sight is offset 0 rather
 * than a separate code path: a token seen a second ago is immediately due, which is the same
 * sentence the other two stages say, and one query covers all three. The alternative — asking at
 * ingest and scheduling only the later two — needs a second place that can fail differently, and
 * the first look would be the one observation with no retry.
 */
export const SECURITY_STAGE_OFFSETS_MS = {
  first_seen: 0,
  h6: 6 * 3_600_000,
  h24: 24 * 3_600_000,
} as const;

export type SecurityStage = keyof typeof SECURITY_STAGE_OFFSETS_MS;

export const SECURITY_STAGES = Object.keys(SECURITY_STAGE_OFFSETS_MS) as readonly SecurityStage[];

