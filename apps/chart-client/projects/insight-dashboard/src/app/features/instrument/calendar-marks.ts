import type { EconomicEvent } from '@trade-automation/contracts';
import { barsWithin, snapTime } from './time-grid';

/**
 * IB-060 — high-impact USD events as vertical lines on the price pane, one per bar that holds
 * any (the FOMC statement and its press conference in one 15m bar are one line, two rows in the
 * tooltip).
 *
 * Pure: which bar a line goes on. Drawing is `time-marks.primitive.ts`, the tooltip
 * `calendar-tooltip.component.ts`. A line sits on the bar the event's instant falls in, and only
 * on a bar the candles have (time-grid.ts: an off-grid time would open a gap between candles), so
 * an event in a data hole or beyond the last candle draws nothing.
 */

/** The colour of an event line and its legend swatch: apart from the sessions' blue and amber. */
export const EVENT_LINE_COLOUR = '#d2a8ff';

export interface CalendarMark {
  /** The candle time (epoch seconds) the line is drawn on. */
  time: number;
  /** The events in that bar, in time order. */
  events: EconomicEvent[];
}

/** The events the chart marks: high impact, US dollar, not withdrawn. Holidays are bands, not lines. */
export function isMarkedEvent(e: EconomicEvent): boolean {
  return e.country === 'USD' && e.impact === 'high' && e.status !== 'removed';
}

export function calendarMarks(events: readonly EconomicEvent[], times: readonly number[], stepSec: number): CalendarMark[] {
  const byBar = new Map<number, EconomicEvent[]>();
  for (const e of events) {
    if (!isMarkedEvent(e)) continue;
    const open = snapTime(Math.floor(e.scheduledAt / 1000), stepSec);
    const bar = barsWithin(times, open, open + stepSec);
    if (!bar) continue;
    byBar.set(bar.first, [...(byBar.get(bar.first) ?? []), e]);
  }
  return [...byBar.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, list]) => ({ time, events: [...list].sort((a, b) => a.scheduledAt - b.scheduledAt || a.title.localeCompare(b.title)) }));
}

/** The mark on the bar at `time`, for the tooltip; null between marks. */
export function markAt(marks: readonly CalendarMark[], time: number | null): CalendarMark | null {
  if (time === null) return null;
  return marks.find((m) => m.time === time) ?? null;
}

/** `2026-10-28 12:30 UTC` — the tooltip's time: the feed's own clock, the same in both languages. */
export function eventTimeLabel(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
