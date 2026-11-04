import { slotOf } from './slot-grid';

/**
 * IB-BUG-020 — what the OI/LS boot backfill writes to `collector_gaps`, given what is already there.
 *
 * **The defect it replaces.** Every boot's backfill re-walks the venue's 30-day window and wrote a
 * row for every hole it found, whether or not an earlier boot had already written that hole. On
 * the box, the holes are Binance not publishing OI for the TradFi perps (COPPER, XPT, XPD, NATGAS,
 * SPY) while their markets are closed, so no later boot can fill them. Each one was registered
 * once per boot: 2 368 rows for 238 windows in 36 hours, 154 of them 11 times. Nothing ever set
 * `repaired` either. A QQQUSDT slot that a later poll stored still read `repaired = 0`.
 *
 * **The rule.**
 * - A hole is written once: a found range overlapping any row already registered for the symbol
 *   is not written again. Overlap, not equality, for two reasons. A hole the venue later served
 *   in part comes back as smaller pieces of the same registered row. And the whole-window "the
 *   venue returned no rows" range moves with every boot's `now`.
 * - A registered row whose slots are now stored is repaired: `repaired` rises to the number of
 *   its slots present, never above `expected` and never down.
 * - A real new outage is a range overlapping nothing registered, so it is still written. Hiding
 *   it would be the opposite failure, and the spec pins both.
 *
 * **Known limit, accepted (Tech Lead, IB-BUG-020 review).** An outage contiguous with a hole
 * already registered for the same symbol overlaps that row and is not written for that symbol.
 * The same happens to any later outage on a symbol whose registered row is the moving
 * whole-window range. Accepted because a poller outage hits every symbol, and the crypto ones,
 * which have no closed sessions, still record it.
 */
export interface GapRange {
  from: number;
  to: number;
  expected: number;
}

export interface RegisteredGap {
  id: string;
  detectedAt: Date;
  gapFrom: number;
  gapTo: number;
  expected: number;
  repaired: number;
}

export interface GapPlan {
  /** Ranges no registered row covers: write these. */
  insert: GapRange[];
  /** Registered rows whose `repaired` should rise, with the new count. */
  repairs: Array<{ id: string; detectedAt: Date; repaired: number }>;
  /** Distinct windows still open after the plan (a window registered twice counts once). */
  open: number;
}

export function planGaps(found: readonly GapRange[], registered: readonly RegisteredGap[], storedMs: readonly number[]): GapPlan {
  const stored = new Set(storedMs.map((ms) => slotOf(ms)));
  const overlaps = (r: GapRange, g: RegisteredGap) => r.from <= g.gapTo && r.to >= g.gapFrom;
  const insert = found.filter((r) => !registered.some((g) => overlaps(r, g)));

  const repairs: GapPlan['repairs'] = [];
  const openWindows = new Set<string>();
  for (const g of registered) {
    const present = Math.min(g.expected, presentSlots(g.gapFrom, g.gapTo, stored));
    if (present > g.repaired) repairs.push({ id: g.id, detectedAt: g.detectedAt, repaired: present });
    if (Math.max(present, g.repaired) < g.expected) openWindows.add(`${g.gapFrom}|${g.gapTo}`);
  }
  for (const r of insert) openWindows.add(`${r.from}|${r.to}`);
  return { insert, repairs, open: openWindows.size };
}

/** Stored 5-minute slots inside `[from, to]`, both ends inclusive. */
function presentSlots(from: number, to: number, stored: ReadonlySet<number>): number {
  let n = 0;
  for (const slot of stored) if (slot >= from && slot <= to) n += 1;
  return n;
}
