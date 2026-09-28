/**
 * The 5-minute slot grid the OI and long/short series live on (§4.1), and what is missing from
 * it. Pure; the poller and the gap bookkeeping both read from here.
 */

export const SLOT_MS = 5 * 60_000;

/** The slot a timestamp belongs to — the 5-minute boundary at or before it, in UTC. */
export function slotOf(at: Date | number): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  return Math.floor(ms / SLOT_MS) * SLOT_MS;
}

/**
 * Every slot in `[from, to]`, inclusive of both ends' slots. Returns epoch ms so the callers can
 * compare against stored timestamps without allocating Dates.
 */
export function slotsBetween(from: Date | number, to: Date | number): number[] {
  const first = slotOf(from);
  const last = slotOf(to);
  if (last < first) return [];
  const slots: number[] = [];
  for (let slot = first; slot <= last; slot += SLOT_MS) slots.push(slot);
  return slots;
}

/**
 * The slots in `[from, to]` that `present` does not cover. `present` may hold anything —
 * duplicates, values outside the range, values off the grid — and is normalised to slots first,
 * so a caller can pass stored timestamps straight from a query.
 */
export function missingSlots(from: Date | number, to: Date | number, present: readonly (Date | number)[]): number[] {
  const have = new Set(present.map((p) => slotOf(p)));
  return slotsBetween(from, to).filter((slot) => !have.has(slot));
}

/**
 * Contiguous runs of missing slots, as `[fromMs, toMs]` pairs inclusive — one `collector_gaps`
 * row each, rather than one row per missing slot (§6.2 counts gaps, not slots).
 */
export function missingRanges(
  from: Date | number,
  to: Date | number,
  present: readonly (Date | number)[],
): Array<{ from: number; to: number; expected: number }> {
  const missing = missingSlots(from, to, present);
  const ranges: Array<{ from: number; to: number; expected: number }> = [];
  for (const slot of missing) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && slot === last.to + SLOT_MS) {
      last.to = slot;
      last.expected += 1;
    } else {
      ranges.push({ from: slot, to: slot, expected: 1 });
    }
  }
  return ranges;
}

/**
 * §4.1 — the poller fires at each 5-minute boundary **+ 20 s**, because the venue publishes on
 * the boundary with a lag. Returns the next such instant strictly after `now`, so calling it
 * from the timer it scheduled never returns the same instant twice.
 */
export const POLL_OFFSET_MS = 20_000;

export function nextPollAt(now: Date | number): number {
  const ms = typeof now === 'number' ? now : now.getTime();
  const candidate = slotOf(ms) + POLL_OFFSET_MS;
  return candidate > ms ? candidate : candidate + SLOT_MS;
}

/**
 * The slot a poll fired at `pollAt` is collecting: the boundary it belongs to. A poll at
 * 12:05:20 collects the 12:05 slot — `limit=1` returns the newest published row, which at
 * boundary + 20 s is that one.
 */
export function slotForPoll(pollAt: Date | number): number {
  return slotOf(pollAt);
}
