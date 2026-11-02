import type { WebLiquidationUptime, WebUptimeState, WebUptimeWindow } from '@trade-automation/contracts';
import { coveredMs, type Heartbeat } from '../collectors/uptime/uptime-gap';
import { STALE_AFTER_MS } from '../collectors/uptime/uptime.recorder';

const HOUR_MS = 3_600_000;
/** 24 h, then 7 days — the windows the row names. */
export const UPTIME_WINDOWS_H = [24, 168] as const;

const hours = (ms: number) => Math.round((ms / HOUR_MS) * 10) / 10;

export interface LiquidationActivity {
  lastRowAt: Date;
  rows24h: number;
  rows7d: number;
}

/**
 * WD-009 — pure: the liquidation collectors' three-state record (contract `WebUptimeState`), from
 * the heartbeats, the outage rows and what each venue wrote. Replaces the coverage page's
 * `collector-coverage.ts`, with one deliberate difference: `elapsedHours` is the wall-clock window,
 * so a collector younger than the window is NOT "fully covered" — the hours before it existed are
 * hours in which liquidations may have happened unrecorded.
 *
 * - rows in the window → `recorded`;
 * - no rows, and listening for the whole window → `no_events`;
 * - no rows otherwise → `not_recorded`. A stream with no heartbeat at all is never `no_events`.
 *
 * A heartbeat older than `STALE_AFTER_MS` means the collector is not listening NOW, and the stretch
 * since it is not yet a gap row (those are written on the next start), so it is subtracted here.
 */
export function liquidationUptime(
  streams: ReadonlyArray<{ stream: string; venue: string }>,
  beats: ReadonlyMap<string, Heartbeat>,
  gaps: ReadonlyArray<{ stream: string; gapFrom: Date; gapTo: Date }>,
  activity: ReadonlyMap<string, LiquidationActivity>,
  now: Date,
): WebLiquidationUptime[] {
  return streams.map(({ stream, venue }) => {
    const beat = beats.get(stream) ?? null;
    const mine = gaps.filter((g) => g.stream === stream);
    const act = activity.get(venue) ?? null;
    const windows = UPTIME_WINDOWS_H.map((h): WebUptimeWindow => {
      const from = new Date(now.getTime() - h * HOUR_MS);
      let covered = beat ? coveredMs({ from, to: now }, mine, beat.firstSeenAt) : 0;
      if (beat && now.getTime() - beat.lastSeenAt.getTime() > STALE_AFTER_MS) {
        covered -= now.getTime() - Math.max(beat.lastSeenAt.getTime(), from.getTime());
      }
      covered = Math.max(0, covered);
      const elapsed = h * HOUR_MS;
      const rows = act ? (h === 24 ? act.rows24h : act.rows7d) : 0;
      const outages = mine.filter((g) => g.gapTo > from && g.gapFrom < now).length;
      return { hours: h, state: stateOf(rows, covered, elapsed), coveredHours: hours(covered), elapsedHours: hours(elapsed), outages, rows };
    });
    return {
      stream,
      venue,
      instrumented: beat !== null,
      lastRowAt: act ? act.lastRowAt.getTime() : null,
      lastSeen: beat ? beat.lastSeenAt.getTime() : null,
      windows,
    };
  });
}

function stateOf(rows: number, coveredMs: number, elapsedMs: number): WebUptimeState {
  if (rows > 0) return 'recorded';
  return coveredMs >= elapsedMs ? 'no_events' : 'not_recorded';
}
