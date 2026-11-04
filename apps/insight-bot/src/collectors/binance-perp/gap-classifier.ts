/**
 * IB-104 — whose fault an open OI/LS gap is, so the health page can tell «биржа не публиковала»
 * (informational) from «мы не записали» (warning).
 *
 * After IB-BUG-020 the stream's open-gap count is honest: about 238 windows on the box, almost all
 * Binance not publishing OI for the TradFi perps (COPPER, XPT, XPD, NATGAS, SPY) while their markets
 * are closed. Shown as a warning for ever, that count trains the admin to ignore the row, and the
 * row then hides a real outage.
 *
 * **The rule, from evidence, with no session calendar.** For each slot of the window, count the
 * other universe symbols that have OI stored at that slot.
 * - **The venue's** when, in EVERY slot, at least half of the other active symbols have their row.
 *   Our poller was demonstrably running and writing then, and only this symbol came back empty.
 *   The crypto perps trade around the clock, so they are the control.
 * - **Ours** when ANY slot falls below that bar. That is the poller down or failing across the
 *   universe. A poller outage that also covers a closed session is therefore ours: its slots show
 *   the universe-wide hole, which is the case the spec pins.
 * - **Always ours, whatever the neighbours show:**
 *   - a row the 5-minute poll wrote because ITS request failed («poll failed…»). We know whose fault
 *     that was.
 *   - the whole-window «the venue returned no rows for this symbol». That is a symbol that has
 *     stopped working (renamed, delisted, a bad id), not a closed session, and someone must look.
 *
 * **Failure case, stated.** A partial outage, where our poller recorded at least half the universe
 * but not this symbol, reads as the venue's. For example, a rate limit hitting the tail of one
 * pass. The 5-minute loop records its own failed requests as «poll failed», which this rule always
 * counts as ours. So the misclassification needs the request to SUCCEED and return no row, which is
 * what a closed session looks like from here. The boot backfill's holes have no such marker, and
 * that is where this rule can be wrong.
 */
export type GapOwner = 'venue' | 'ours';

export interface OpenWindow {
  /** The `collector_gaps.error` text the window was registered with. */
  error: string | null;
  /** The fewest OTHER active symbols with OI stored at any one slot of the window. */
  minNeighboursStored: number;
}

/** At least this share of the other active symbols must be stored in every slot. */
export const NEIGHBOUR_SHARE = 0.5;

export function classifyGap(window: OpenWindow, otherActiveSymbols: number): GapOwner {
  const error = window.error ?? '';
  if (error.startsWith('poll failed') || error.includes('returned no rows')) return 'ours';
  if (otherActiveSymbols <= 0) return 'ours'; // no control to compare with: assume the worst
  return window.minNeighboursStored >= Math.ceil(otherActiveSymbols * NEIGHBOUR_SHARE) ? 'venue' : 'ours';
}

/** The health row's two numbers. */
export function splitOpen(windows: readonly OpenWindow[], otherActiveSymbols: number): { ours: number; venue: number } {
  let ours = 0;
  let venue = 0;
  for (const w of windows) (classifyGap(w, otherActiveSymbols) === 'venue' ? (venue += 1) : (ours += 1));
  return { ours, venue };
}
