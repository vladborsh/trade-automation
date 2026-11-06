import { WEB_LIQUIDATION_VENUES, type WebLiqProfileResponse } from '@trade-automation/contracts';
import type { Heartbeat } from '../../collectors/uptime/uptime-gap';
import { coveredInWindow, stateOf } from '../liquidation-uptime';

type VenueStates = WebLiqProfileResponse['venues'];

/**
 * IB-153, IB-BUG-011 — each venue's state over the profile's window, so a venue that was not listening
 * shows as «нет данных», never as $0:
 * - `not_listed` — the coin has no symbol on that venue;
 * - `recorded` — it has prints in the window;
 * - `no_events` — no prints, and its collector was listening the whole window (a real $0);
 * - `not_recorded` — no prints, and it was not listening for all of it.
 *
 * WD-009's rule (`stateOf`) and coverage (`coveredInWindow`) unchanged; only the window is the chart's.
 * A window reaching past `now` is judged up to `now`: the future cannot have been missed.
 */
export function profileVenueStates(input: {
  listed: Readonly<Record<string, string | null>>;
  streamOf: Readonly<Record<string, string>>;
  beats: ReadonlyMap<string, Heartbeat>;
  gaps: ReadonlyArray<{ stream: string; gapFrom: Date; gapTo: Date }>;
  rowsByVenue: ReadonlyMap<string, number>;
  fromMs: number;
  toMs: number;
  nowMs: number;
}): VenueStates {
  const to = Math.min(input.toMs, input.nowMs);
  const window = { from: new Date(input.fromMs), to: new Date(Math.max(input.fromMs, to)) };
  const elapsed = window.to.getTime() - window.from.getTime();
  return WEB_LIQUIDATION_VENUES.map((venue) => {
    if (!input.listed[venue]) return { venue, state: 'not_listed' as const };
    const stream = input.streamOf[venue];
    const beat = stream ? input.beats.get(stream) ?? null : null;
    const gaps = input.gaps.filter((g) => g.stream === stream);
    const covered = coveredInWindow(beat, gaps, window, new Date(input.nowMs));
    return { venue, state: stateOf(input.rowsByVenue.get(venue) ?? 0, covered, elapsed) };
  });
}
