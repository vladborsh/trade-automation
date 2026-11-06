import type { CalendarMark } from './calendar-marks';

/**
 * IB-BUG-050 — whether the calendar badges must be built again. The live tail answers about every
 * 5 s with the same marks; rebuilding the buttons each time put a NEW button under a press, and a
 * press on the old one with the release on the new one is no click: the member's tap was lost.
 *
 * Two lists draw the same badges when each mark has the same bar time and the same events, by id,
 * with what the button shows of them (the titles in its label, the first event's country as its
 * flag). An event's other fields (its figures, its revision) are the tooltip's, read from the marks
 * at hover time, not the button's.
 */
export function badgeKey(m: CalendarMark): string {
  return JSON.stringify([m.time, m.events.map((e) => [e.id, e.title, e.country])]);
}

export function sameBadges(a: readonly CalendarMark[], b: readonly CalendarMark[]): boolean {
  return a.length === b.length && a.every((m, i) => badgeKey(m) === badgeKey(b[i]));
}

/** After a rebuild the pin stays on its bar if that bar still has a mark; otherwise nothing is pinned. */
export function pinAfter(pinned: number | null, marks: readonly CalendarMark[]): number | null {
  return pinned !== null && marks.some((m) => m.time === pinned) ? pinned : null;
}
