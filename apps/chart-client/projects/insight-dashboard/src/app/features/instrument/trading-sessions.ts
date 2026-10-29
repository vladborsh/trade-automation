import type { StringKey } from '../../i18n/keys';
import { barsWithin, snapTime } from './time-grid';

/**
 * The London and New York trading sessions as bands on the price pane (2026-10-24, §13).
 *
 * **Local exchange hours, so daylight saving is the time zone's, not ours.** London's cash session
 * is 08:00–16:30 `Europe/London` and New York's 09:30–16:00 `America/New_York`; in UTC both move by
 * an hour twice a year, on different dates (the US switches about three weeks before the UK in
 * spring and one week after it in autumn), which a fixed UTC table gets wrong for a month a year.
 * The conversion asks `Intl` for the zone's offset at that instant. Weekdays only, by the LOCAL
 * calendar. Exchange holidays are not modelled: a band on a holiday is a session that did not
 * trade, not a data error.
 */

export interface SessionDef {
  key: 'london' | 'newYork';
  labelKey: StringKey;
  timeZone: string;
  /** Local wall time, minutes after midnight. */
  openMin: number;
  closeMin: number;
  /** The band's fill; muted and translucent so candles read through it. */
  colour: string;
  /** The same hue, opaque, for the legend's swatch: a 7 % fill is invisible at 8 px. */
  swatch: string;
}

/** The one definition of the sessions: hours, zones and colours. */
export const SESSIONS: readonly SessionDef[] = [
  { key: 'london', labelKey: 'instrument.legend.london', timeZone: 'Europe/London', openMin: 8 * 60, closeMin: 16 * 60 + 30, colour: 'rgba(88, 166, 255, 0.07)', swatch: '#58a6ff' },
  { key: 'newYork', labelKey: 'instrument.legend.newYork', timeZone: 'America/New_York', openMin: 9 * 60 + 30, closeMin: 16 * 60, colour: 'rgba(210, 153, 34, 0.08)', swatch: '#d29922' },
];

/** Off on 4h and 1d: a session is narrower than one bar there. */
export function showsSessions(timeframe: string): boolean {
  return timeframe === '1m' || timeframe === '15m' || timeframe === '1h';
}

const DAY_SEC = 86_400;

/** A zone's offset from UTC at an instant, in seconds (positive east of Greenwich). */
export function zoneOffsetSec(timeZone: string, utcSec: number): number {
  const parts = formatter(timeZone).formatToParts(new Date(utcSec * 1000));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round(asUtc / 1000 - utcSec);
}

/**
 * The UTC instant of a local wall time in a zone. Two passes: the offset at the naive guess, then
 * at the corrected instant, which settles every hour except the ones a DST switch skips or repeats,
 * and no session opens or closes in those (they are at night).
 */
export function zonedTimeToUtc(timeZone: string, dayUtcSec: number, minuteOfDay: number): number {
  const naive = dayUtcSec + minuteOfDay * 60;
  const first = naive - zoneOffsetSec(timeZone, naive);
  return naive - zoneOffsetSec(timeZone, first);
}

export interface SessionBand {
  key: SessionDef['key'];
  colour: string;
  /** First and last candle time inside the session: the band is drawn on real bars. */
  first: number;
  last: number;
}

/**
 * Every session band over the candles `times` (ascending, `stepSec` apart), from the bar the open
 * falls in to the last bar starting before the close: New York's 09:30 open is the 13:00 bar on a
 * 1h chart in summer, not the 14:00 one. A session with no bars (a gap, the weekend, the window's
 * edge) has no band.
 */
export function sessionBands(times: readonly number[], stepSec: number, sessions: readonly SessionDef[] = SESSIONS): SessionBand[] {
  if (times.length === 0) return [];
  const out: SessionBand[] = [];
  const firstDay = Math.floor(times[0] / DAY_SEC) * DAY_SEC - DAY_SEC;
  const lastDay = Math.floor(times[times.length - 1] / DAY_SEC) * DAY_SEC + DAY_SEC;
  for (let day = firstDay; day <= lastDay; day += DAY_SEC) {
    const weekday = new Date(day * 1000).getUTCDay(); // the calendar date `day` names, read as local
    if (weekday === 0 || weekday === 6) continue;
    for (const s of sessions) {
      const open = snapTime(zonedTimeToUtc(s.timeZone, day, s.openMin), stepSec);
      const bars = barsWithin(times, open, zonedTimeToUtc(s.timeZone, day, s.closeMin));
      if (bars) out.push({ key: s.key, colour: s.colour, ...bars });
    }
  }
  return out;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}
