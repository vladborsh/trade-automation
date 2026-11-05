import type { WebLiquidationLargeRow, WebLiquidationsLargeQuery, WebLiquidationsLargeResponse } from '@trade-automation/contracts';
import { seriesByIndex } from './block.assemble';
import type { FeedRow } from './pg/overview.repo';

/**
 * IB-120 (market-round2 design §4) — the /liquidations page from one read of the tape per period.
 *
 * The **period's base** is every crypto event ≥ $100K (the series threshold, and the lowest chip),
 * each with its series computed over that whole base. Every filter is then a pass over the base in
 * memory, so a chip click costs no query and no filter can split a cascade's count.
 */

/**
 * The base read is bounded too: on the coordinator's tape a 7d base was 1 216 events (2026-11-05,
 * one reading — a note, not a rule). 20 000 is ×16 that. Reaching it is logged by the service:
 * the series at the old edge and `total` then describe the newest 20 000 only.
 */
export const LARGE_PAGE_BASE_CAP = 20_000;

export interface LargeBase {
  asOf: number;
  from: number;
  /** Newest first, each with its series. */
  rows: WebLiquidationLargeRow[];
  /** The read hit `LARGE_PAGE_BASE_CAP`. */
  capped: boolean;
}

/** The base from the tape's rows (any order); the series are found oldest first, as on Market. */
export function largeBase(events: readonly FeedRow[], args: { nowMs: number; periodSec: number; cap: number }): LargeBase {
  const oldestFirst = [...events].sort((a, b) => a.timeSec - b.timeSec);
  const series = seriesByIndex(oldestFirst);
  const rows = oldestFirst.map((e, i): WebLiquidationLargeRow => {
    const s = series.get(String(i));
    return {
      time: e.timeSec,
      // an unmapped event keeps the venue's own spelling rather than vanishing (the feed's rule)
      symbol: e.symbolId ?? e.venueSymbol,
      base: e.base ?? e.venueSymbol,
      side: e.side,
      usd: e.usd,
      price: e.price,
      venue: e.venue,
      seriesId: s?.id ?? null,
      seriesCount: s?.count ?? 0,
      seriesSpanSec: s?.spanSec ?? 0,
    };
  });
  const asOf = Math.floor(args.nowMs / 1000);
  return { asOf, from: asOf - args.periodSec, rows: rows.reverse(), capped: events.length >= args.cap };
}

/** The answer for one filter set: matching rows, newest first, cut at `limit` and counted in `total`. */
export function largeAnswer(base: LargeBase, query: WebLiquidationsLargeQuery, limit: number): WebLiquidationsLargeResponse {
  const atMin = base.rows.filter((r) => r.usd >= query.minUsd);
  const matching = atMin.filter((r) =>
    (query.symbol === 'all' || r.symbol === query.symbol)
    && (query.side === 'all' || r.side === query.side)
    && (query.venue === 'all' || r.venue === query.venue));
  const coins = new Map<string, string>();
  for (const r of atMin) if (!coins.has(r.symbol)) coins.set(r.symbol, r.base);
  return {
    asOf: base.asOf,
    from: base.from,
    query,
    rows: matching.slice(0, limit),
    total: matching.length,
    truncated: matching.length > limit,
    coins: [...coins].map(([symbol, b]) => ({ symbol, base: b })).sort((a, b) => a.base.localeCompare(b.base) || a.symbol.localeCompare(b.symbol)),
  };
}
