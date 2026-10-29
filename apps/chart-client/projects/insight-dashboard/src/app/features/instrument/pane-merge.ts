import type { PaneData } from './pane-data';

/**
 * Earlier history joined onto the window on screen (2026-10-24: scrolling left loaded nothing).
 *
 * Pure, so the joins are specced: every series is a concatenation, earlier first. Duplicates at
 * the seam (the venue's bar on the boundary can come back in both reads) are left to the chart
 * adapters, which already de-duplicate by time with the later read winning. What is NOT a
 * concatenation is stated where it happens: the predicted funding rate is "now" and stays the
 * current window's; a flag that says "something was thinned or missed" holds if either read says so.
 */
export function prependEarlier(current: PaneData, earlier: PaneData): PaneData {
  return {
    ...current,
    candles: {
      ...current.candles,
      candles: [...earlier.candles.candles, ...current.candles.candles],
      downsampled: current.candles.downsampled || earlier.candles.downsampled,
    },
    openInterest: [...earlier.openInterest, ...current.openInterest],
    funding: {
      ...current.funding,
      settled: mergeVenues(earlier.funding.settled, current.funding.settled),
    },
    longShort: { ...current.longShort, points: [...earlier.longShort.points, ...current.longShort.points] },
    liquidations: {
      ...current.liquidations,
      bars: [...earlier.liquidations.bars, ...current.liquidations.bars],
      undercounted: current.liquidations.undercounted || earlier.liquidations.undercounted,
      downsampled: current.liquidations.downsampled || earlier.liquidations.downsampled,
    },
    liquidationEvents: [...earlier.liquidationEvents, ...current.liquidationEvents],
    liquidationVenues: [...new Set([...earlier.liquidationVenues, ...current.liquidationVenues])],
    // The two reads' daily candles overlap by the two-week lookback; one bar per day, the
    // current read winning, because the overlap's last day can still have been forming earlier.
    dailyCandles: byTime([...earlier.dailyCandles, ...current.dailyCandles]),
    // Calendar windows meet at the seam, and an event exactly on it can come back in both: one per
    // id, the current read winning (it may carry a later revision).
    calendarEvents: byId([...earlier.calendarEvents, ...current.calendarEvents]),
    extendsPrevious: true,
  };
}

/** True when an earlier read found no candles at all: the venue's history starts after it. */
export function isBeforeHistory(earlier: PaneData): boolean {
  return earlier.candles.candles.length === 0;
}

function byTime<T extends { time: number }>(points: readonly T[]): T[] {
  const m = new Map<number, T>();
  for (const p of points) m.set(p.time, p);
  return [...m.values()].sort((a, b) => a.time - b.time);
}

function byId<T extends { id: string; scheduledAt: number }>(events: readonly T[]): T[] {
  const m = new Map<string, T>();
  for (const e of events) m.set(e.id, e);
  return [...m.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
}

function mergeVenues<T extends { venue: string; points: unknown[] }>(earlier: readonly T[], current: readonly T[]): T[] {
  const venues = [...new Set([...current.map((v) => v.venue), ...earlier.map((v) => v.venue)])];
  return venues.map((venue) => {
    const before = earlier.find((v) => v.venue === venue);
    const now = current.find((v) => v.venue === venue);
    const base = (now ?? before) as T;
    return { ...base, points: [...(before?.points ?? []), ...(now?.points ?? [])] };
  });
}
