import type { CollectorGapRow } from '../writers/tables';
import type { Market } from '../writers/tables';

/**
 * IB-BUG-010 — turn "the collector was not running" into a `collector_gaps` row.
 *
 * ## Why this exists
 *
 * Measured on `insight_coord`: only 9 of the 226 hours since 2026-09-28 hold any liquidation,
 * because the collectors were down through the pause — and nothing in the data said which hours
 * were covered. Any statistic over that tape therefore reads downtime as a quiet market, which
 * drags the median down and inflates every later ratio. A consumer needs to divide by **covered**
 * hours, and for that the uncovered hours have to be written down.
 *
 * ## Why the existing mechanism cannot do it
 *
 * The Binance path (`binance-perp/degraded-gaps.ts`) writes its row when a degraded spell **ends**
 * — every `binance-perp:forceOrder` row on the tape has `gap_to = detected_at`. That works for an
 * outage the process lives through, and it is structurally unable to record one it did not: a
 * process that is not running writes nothing, and `collector_gaps.gap_to` is NOT NULL so there is
 * no "down since T, still down" row to leave behind. Hence a heartbeat: while a stream is
 * connected its liveness is persisted, and the next start compares that mark against the clock.
 *
 * ## The decision this file makes, and the one trap in it
 *
 * **Never infer coverage from event timestamps.** The tempting version of this feature is "the last
 * liquidation we stored is how far coverage reaches", and it is wrong in the direction that matters:
 * a genuinely quiet market would be recorded as downtime, so covered hours would shrink and the
 * ratio this task exists to make honest would inflate again — the same confident-wrong-number
 * family as IB-BUG-011. Liveness is therefore a positive signal written by a connected socket,
 * independent of whether anything was liquidated.
 */

/** A stream's persisted liveness. One row per stream in `collector_heartbeats`. */
export interface Heartbeat {
  stream: string;
  venue: string;
  market?: Market | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface UptimeGapInput {
  stream: string;
  venue: string;
  market?: Market | null;
  /** The stream's heartbeat as found at startup, or null when this stream has never run. */
  heartbeat: Heartbeat | null;
  /** Now, as the caller sees it. */
  now: Date;
  /**
   * How stale a heartbeat has to be before the silence counts as downtime. This must be larger
   * than the heartbeat write interval or an ordinary tick boundary would produce a gap row of a few
   * seconds on every restart, burying the real outages in noise.
   */
  staleAfterMs: number;
}

/**
 * The window that was NOT covered, or null when there is nothing to record.
 *
 * Returns null in two different cases, and they are not the same thing:
 * - **never ran** (`heartbeat === null`) — we cannot claim an outage over a period we were never
 *   responsible for. The absence of a gap row for last year does not mean we were collecting last
 *   year; it means we did not exist. `firstSeenAt` is what a consumer uses to avoid claiming that.
 * - **came straight back** — the heartbeat is fresher than `staleAfterMs`, so this was a restart
 *   inside the noise floor, not an outage.
 */
export function uptimeGap(input: UptimeGapInput): CollectorGapRow | null {
  const { heartbeat, now, staleAfterMs } = input;
  if (heartbeat === null) return null;

  const downForMs = now.getTime() - heartbeat.lastSeenAt.getTime();
  if (downForMs <= staleAfterMs) return null;

  // A clock that went backwards (NTP step, a restored snapshot, a laptop waking up) would otherwise
  // produce a row whose window runs backwards, and `gap_from > gap_to` is a silently poisonous row
  // for anything that sums durations.
  if (downForMs <= 0) return null;

  return {
    stream: input.stream,
    venue: input.venue,
    market: input.market ?? null,
    // all-symbols stream, like the Binance liquidation rows on the tape
    symbol: null,
    gapFrom: heartbeat.lastSeenAt,
    gapTo: now,
    // `expected` is a count of units the repair path could recover, and a websocket-only
    // liquidation feed has no REST equivalent on any of the three venues: nothing can be
    // backfilled, so nothing was expected and nothing was repaired. Same as the Binance rows.
    expected: 0,
    repaired: 0,
    error: `collector not running: ${input.stream} recorded no liveness for ${Math.round(downForMs / 1000)}s, liquidations in this window are lost`,
    detectedAt: now,
  };
}

/**
 * Covered milliseconds inside `[from, to)`, given the gap rows overlapping it.
 *
 * This is the number a statistic should divide by. Three properties worth stating because each is
 * a way the naive version gets it wrong:
 * - gaps are **clipped** to the window, so a gap that started before `from` only subtracts its
 *   overlapping part;
 * - gaps are **merged**, so two streams down over the same hour subtract that hour once rather
 *   than twice and leave a negative covered figure;
 * - time before `firstSeenAt` is **not** counted as covered, because we were not there.
 */
export function coveredMs(
  window: { from: Date; to: Date },
  gaps: ReadonlyArray<{ gapFrom: Date; gapTo: Date }>,
  firstSeenAt: Date | null,
): number {
  const windowFrom = window.from.getTime();
  const windowTo = window.to.getTime();
  // nothing is claimed before we existed
  const from = firstSeenAt === null ? windowTo : Math.max(windowFrom, firstSeenAt.getTime());
  if (from >= windowTo) return 0;

  const clipped = gaps
    .map((g) => ({ start: Math.max(g.gapFrom.getTime(), from), end: Math.min(g.gapTo.getTime(), windowTo) }))
    .filter((g) => g.end > g.start)
    .sort((a, b) => a.start - b.start);

  let uncovered = 0;
  let mergedStart = -1;
  let mergedEnd = -1;
  for (const g of clipped) {
    if (mergedEnd < g.start) {
      if (mergedEnd > mergedStart) uncovered += mergedEnd - mergedStart;
      mergedStart = g.start;
      mergedEnd = g.end;
    } else if (g.end > mergedEnd) {
      mergedEnd = g.end;
    }
  }
  if (mergedEnd > mergedStart) uncovered += mergedEnd - mergedStart;

  return windowTo - from - uncovered;
}
