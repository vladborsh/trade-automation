import type { WebCollectorCoverage } from '@trade-automation/contracts';
import { coveredMs, type Heartbeat } from '../collectors/uptime/uptime-gap';

const HOUR_MS = 3_600_000;

/** Rounded to one decimal: an hours figure claiming millisecond precision invites false confidence. */
const hours = (ms: number) => Math.round((ms / HOUR_MS) * 10) / 10;

/**
 * IB-BUG-010 — pure: turn heartbeats and gap rows into the per-stream coverage the page shows and
 * a statistic divides by.
 *
 * **Only streams that actually have a heartbeat are reported.** A stream with no heartbeat is not
 * "0 % covered", it is *not instrumented*, and the two must not look alike: showing Binance at 0
 * covered hours would be a confident wrong number about a collector that was in fact running, which
 * is the exact failure this task exists to remove. When a stream is instrumented later it appears
 * here on its own.
 */
export function collectorCoverage(
  streams: ReadonlyMap<string, Heartbeat>,
  gaps: ReadonlyArray<{ stream: string; gapFrom: Date; gapTo: Date }>,
  window: { from: Date; to: Date },
): WebCollectorCoverage[] {
  return [...streams.values()]
    .map((beat) => {
      const mine = gaps.filter((g) => g.stream === beat.stream);
      const covered = coveredMs(window, mine, beat.firstSeenAt);
      // elapsed is clipped to firstSeenAt too, so covered/elapsed is a fraction of the time we
      // were responsible for rather than of all history
      const elapsedFrom = Math.max(window.from.getTime(), beat.firstSeenAt.getTime());
      const elapsed = Math.max(0, window.to.getTime() - elapsedFrom);
      return {
        stream: beat.stream,
        venue: beat.venue,
        coveredHours: hours(covered),
        elapsedHours: hours(elapsed),
        firstSeen: beat.firstSeenAt.getTime(),
        lastSeen: beat.lastSeenAt.getTime(),
        outages: mine.length,
      };
    })
    .sort((a, b) => a.stream.localeCompare(b.stream));
}
