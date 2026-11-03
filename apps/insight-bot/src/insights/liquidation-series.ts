import { SERIES_MAX_SPAN_SEC, SERIES_MIN_EVENTS, SERIES_MIN_USD } from './thresholds';

/**
 * D5 R3 / D8(c) — liquidation cascades: at least `SERIES_MIN_EVENTS` events of ONE side, each at
 * least `SERIES_MIN_USD`, the first and the last within `SERIES_MAX_SPAN_SEC`. Pure and exported:
 * the liquidation block marks its large events with it (IB-084) and rule R3 says "серия: 4 за 9
 * минут" from it (IB-086), so the two can never disagree about what a series is.
 *
 * Greedy, per side, oldest first: a series starts at the oldest event not yet in one and takes every
 * later same-side event inside the span from that start. Too few → the start event is not a series
 * and the scan moves to the next event. Market-wide, not per coin: a cascade is the market moving.
 */
export interface SeriesEvent {
  /** Stable identity of the event within the caller's list (an index or a key). */
  key: string;
  timeSec: number;
  side: 'long' | 'short';
  usd: number;
}

export interface Series {
  id: string;
  side: 'long' | 'short';
  keys: string[];
  count: number;
  /** Last event time − first event time. */
  spanSec: number;
  startSec: number;
}

export function groupSeries(events: readonly SeriesEvent[]): Series[] {
  const out: Series[] = [];
  for (const side of ['long', 'short'] as const) {
    const big = events
      .filter((e) => e.side === side && e.usd >= SERIES_MIN_USD)
      .sort((a, b) => a.timeSec - b.timeSec || a.key.localeCompare(b.key));
    let i = 0;
    while (i < big.length) {
      const start = big[i] as SeriesEvent;
      let j = i;
      while (j + 1 < big.length && (big[j + 1] as SeriesEvent).timeSec - start.timeSec <= SERIES_MAX_SPAN_SEC) j++;
      const members = big.slice(i, j + 1);
      if (members.length >= SERIES_MIN_EVENTS) {
        out.push({
          id: `${side}-${start.timeSec}`,
          side,
          keys: members.map((e) => e.key),
          count: members.length,
          spanSec: (members[members.length - 1] as SeriesEvent).timeSec - start.timeSec,
          startSec: start.timeSec,
        });
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}
