/**
 * §7.1 — times render in the browser's local zone; the ET instant is shown
 * in a tooltip since that's what the feed and every news site show. Plain
 * `Intl`, no date library (per the note's "no new dependency" instruction).
 */
export function etDayString(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function etTimeLabel(ms: number): string {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ms));
  return `${time} ET`;
}

export function localTimeLabel(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function dayHeaderLabel(day: string): string {
  // day is 'YYYY-MM-DD' (ET calendar day) — render as e.g. 'Sun 09-13' without
  // re-parsing through the local zone (a plain UTC-noon anchor avoids any
  // date rolling back a day near midnight in zones west of ET).
  const [year, month, date] = day.split('-').map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, date, 12));
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(anchor);
  return `${weekday} ${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}
