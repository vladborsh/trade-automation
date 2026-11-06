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
      const covered = coveredInWindow(beat, mine, { from, to: now }, now);
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

/**
 * How much of `window` the collector was listening, in ms: `coveredMs` over its outage rows, minus the
 * stretch since a stale heartbeat (not listening NOW, and not yet a gap row). No heartbeat → 0.
 * IB-153: shared with the liquidation profile, whose window is the chart's, not 24 h / 7 d.
 */
export function coveredInWindow(
  beat: Heartbeat | null,
  gaps: ReadonlyArray<{ gapFrom: Date; gapTo: Date }>,
  window: { from: Date; to: Date },
  now: Date,
): number {
  if (!beat) return 0;
  let covered = coveredMs(window, gaps, beat.firstSeenAt);
  if (now.getTime() - beat.lastSeenAt.getTime() > STALE_AFTER_MS) {
    const staleFrom = Math.max(beat.lastSeenAt.getTime(), window.from.getTime());
    covered -= Math.max(0, Math.min(now.getTime(), window.to.getTime()) - staleFrom);
  }
  return Math.max(0, covered);
}

export function stateOf(rows: number, coveredMs: number, elapsedMs: number): WebUptimeState {
  if (rows > 0) return 'recorded';
  return coveredMs >= elapsedMs ? 'no_events' : 'not_recorded';
}
