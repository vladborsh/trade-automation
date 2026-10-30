import { WEB_MAX_CALENDAR_RANGE_DAYS, type EconomicEvent } from '@trade-automation/contracts';
import { isMarkedEvent } from './calendar-marks';
import type { PaneData } from './pane-data';
import { barSeconds, snapTime } from './time-grid';

/**
 * IB-067 — room on the chart to the right of the current bar, so the week's upcoming events can be
 * drawn there (user, 2026-10-29: "upcoming calendar events must be visible on the chart, right of
 * the current candle").
 *
 * lightweight-charts gives a time no coordinate past the last bar of the data, so an event line
 * there had nothing to sit on. The price series therefore carries **whitespace bars** (`{ time }`,
 * no prices) into the future, one per bar of the timeframe, and every mark is placed on these
 * slots exactly as on the candles' (time-grid.ts).
 *
 * How far: to the bar of the latest marked event (high-impact USD) within `FUTURE_HORIZON_DAYS`
 * of the last candle's close, and never more than `MAX_FUTURE_BARS`. With no such event, no future bars:
 * an empty stretch on the right would only squeeze the candles. The cap is what it costs per frame:
 * 1m ≈ 3 h 20 min, 15m ≈ 50 h, 1h ≈ 8 days (all 7 days fit), 4h and up are capped by the 7 days.
 *
 * Measured from the last CANDLE, not the wall clock: the window always ends at the live bar, and a
 * pure function of the data is one the spec can pin. ForexFactory's feed holds the current week
 * only, so next week's events appear on Monday (IB-058).
 */

export const FUTURE_HORIZON_DAYS = 7;
export const MAX_FUTURE_BARS = 200;

/** The future slots for `data`: ascending candle-grid times after its last candle; [] without candles or events. */
export function futureSlots(data: Pick<PaneData, 'timeframe' | 'candles' | 'calendarEvents'>): number[] {
  const last = data.candles.candles.at(-1)?.time;
  if (last === undefined) return [];
  return futureTimes(last, barSeconds(data.timeframe), data.calendarEvents);
}

export function futureTimes(lastSec: number, stepSec: number, events: readonly EconomicEvent[]): number[] {
  // from the last bar's CLOSE: on 1m that is now; on 1W it is the end of this week, else a weekly
  // chart, whose forming bar opened up to 7 days ago, could never reach past its own bar
  const horizon = lastSec + stepSec + FUTURE_HORIZON_DAYS * 86_400;
  let latest = -Infinity;
  for (const e of events) {
    const at = Math.floor(e.scheduledAt / 1000);
    if (isMarkedEvent(e) && at >= lastSec + stepSec && at < horizon && at > latest) latest = at;
  }
  if (latest === -Infinity) return [];
  const until = snapTime(latest, stepSec);
  const out: number[] = [];
  // stepping by a week from a Monday open stays on Mondays (IB-065's grid)
  for (let t = lastSec + stepSec; t <= until && out.length < MAX_FUTURE_BARS; t += stepSec) out.push(t);
  return out;
}

/**
 * The calendar read for a window: on into the future by the horizon, and its start moved up if
 * that would make it wider than the server serves (`WEB_MAX_CALENDAR_RANGE_DAYS`) — the 1W
 * window's side reads are already 90 days.
 */
export function calendarWindow(fromMs: number, toMs: number): { fromMs: number; toMs: number } {
  const to = toMs + FUTURE_HORIZON_DAYS * 86_400_000;
  return { fromMs: Math.max(fromMs, to - WEB_MAX_CALENDAR_RANGE_DAYS * 86_400_000), toMs: to };
}
