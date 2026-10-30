import type {
  WebCandle, WebFundingResponse, WebLiquidationEvent, WebLiquidationsResponse, WebLongShortResponse,
} from '@trade-automation/contracts';
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
    extendsLater: false,
  };
}

/**
 * IB-066 — what one live-tail poll brought back. Every part is optional: the 5 s poll reads the
 * candles alone, the minute's poll the panes that come from the bot's database.
 */
export interface LaterTail {
  candles?: readonly WebCandle[];
  openInterest?: PaneData['openInterest'];
  funding?: WebFundingResponse;
  longShort?: WebLongShortResponse;
  liquidations?: WebLiquidationsResponse;
  liquidationEvents?: readonly WebLiquidationEvent[];
  liquidationVenues?: readonly string[];
  dailyCandles?: readonly WebCandle[];
}

/**
 * IB-066 — the live tail joined onto the window on screen, the mirror of `prependEarlier`.
 *
 * A tail overlaps the window by design: it is read from the last bar's open, because that bar is
 * still forming. So every series is merged BY TIME with the tail winning — the forming candle and
 * the liquidation bucket still filling are replaced, newer points are appended. Liquidation events
 * have no time of their own to key on (several can share a second), so they are one per
 * time + venue + side + size + price. A part the tail does not carry is left as it was.
 */
export function appendLater(current: PaneData, tail: LaterTail): PaneData {
  const out: PaneData = { ...current, extendsPrevious: false, extendsLater: true };
  if (tail.candles) {
    out.candles = { ...current.candles, candles: byTime([...current.candles.candles, ...tail.candles]) };
  }
  if (tail.openInterest) out.openInterest = byTime([...current.openInterest, ...tail.openInterest]);
  if (tail.funding) {
    out.funding = {
      ...current.funding,
      settled: mergeVenues(current.funding.settled, tail.funding.settled, (points) => byTime(points)),
      predicted: byTime([...current.funding.predicted, ...tail.funding.predicted]),
      downsampled: current.funding.downsampled || tail.funding.downsampled,
    };
  }
  if (tail.longShort) {
    out.longShort = { ...current.longShort, points: byTime([...current.longShort.points, ...tail.longShort.points]) };
  }
  if (tail.liquidations) {
    out.liquidations = {
      ...current.liquidations,
      bars: byTime([...current.liquidations.bars, ...tail.liquidations.bars]),
      venuesPresent: [...new Set([...current.liquidations.venuesPresent, ...tail.liquidations.venuesPresent])],
      undercounted: current.liquidations.undercounted || tail.liquidations.undercounted,
    };
  }
  if (tail.liquidationEvents) out.liquidationEvents = byEvent([...current.liquidationEvents, ...tail.liquidationEvents]);
  if (tail.liquidationVenues) out.liquidationVenues = [...new Set([...current.liquidationVenues, ...tail.liquidationVenues])];
  if (tail.dailyCandles) out.dailyCandles = byTime([...current.dailyCandles, ...tail.dailyCandles]);
  return out;
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

function byEvent(events: readonly WebLiquidationEvent[]): WebLiquidationEvent[] {
  const m = new Map<string, WebLiquidationEvent>();
  for (const e of events) m.set(`${e.time}|${e.venue}|${e.side}|${e.usd}|${e.price}`, e);
  return [...m.values()].sort((a, b) => a.time - b.time);
}

/** Per venue, `earlier` points then `later` ones, through `join` (plain concatenation by default). */
function mergeVenues<T extends { venue: string; points: Array<{ time: number }> }>(
  earlier: readonly T[], later: readonly T[], join: (points: T['points']) => T['points'] = (points) => points,
): T[] {
  const venues = [...new Set([...later.map((v) => v.venue), ...earlier.map((v) => v.venue)])];
  return venues.map((venue) => {
    const before = earlier.find((v) => v.venue === venue);
    const after = later.find((v) => v.venue === venue);
    const base = (after ?? before) as T;
    return { ...base, points: join([...(before?.points ?? []), ...(after?.points ?? [])]) };
  });
}
