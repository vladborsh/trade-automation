import { dateTime, zoneLabel, type Zone } from '../../shared/time-format';
import type { EconomicEvent } from '@trade-automation/contracts';
import type { StringKey } from '../../i18n/keys';
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

/**
 * IB-067 — how long until an upcoming event, for its tooltip: «через 45 мин», «через 2 ч 15 мин»,
 * «через 2 д 3 ч». Null once it is due: a past event's tooltip has its actual figure instead.
 * Minutes round up, so «через 1 мин» shows until the minute it is due, never «через 0 мин».
 */
export function untilLabel(
  eventMs: number, nowMs: number, t: (key: StringKey, params?: Record<string, string | number>) => string,
): string | null {
  if (eventMs <= nowMs) return null;
  const minutes = Math.ceil((eventMs - nowMs) / 60_000);
  if (minutes < 60) return t('calendar.until.minutes', { m: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return t('calendar.until.daysHours', { d: Math.floor(hours / 24), h: hours % 24 });
  return minutes % 60 === 0 ? t('calendar.until.hours', { h: hours }) : t('calendar.until.hoursMinutes', { h: hours, m: minutes % 60 });
}

/** The tooltip's widest (its `max-width`), and its gap from the crosshair. */
export const TOOLTIP_MAX_WIDTH = 280;
const TOOLTIP_GAP = 12;

/**
 * IB-067 — where the tooltip sits beside the crosshair at `x` in a container `width` wide: to the
 * right, unless its widest would run past the edge — then to the left, hugging the crosshair from
 * that side (`right`). Upcoming events are at the right edge by construction, where a tooltip
 * opening rightwards covered the price scale and the context column. A width of 0 is unknown (not
 * laid out): right, as before.
 */
export function tooltipSide(x: number, width: number): { left: number | null; right: number | null } {
  if (width > 0 && x + TOOLTIP_GAP + TOOLTIP_MAX_WIDTH > width) return { left: null, right: width - x + TOOLTIP_GAP };
  return { left: x + TOOLTIP_GAP, right: null };
}

/** `28.10 14:30 UTC+2` — the tooltip's time (IB-152): the viewer's zone, named, the same in both languages. */
export function eventTimeLabel(ms: number, zone?: Zone): string {
  return `${dateTime(ms / 1000, zone)} ${zoneLabel(ms / 1000, zone)}`;
}
