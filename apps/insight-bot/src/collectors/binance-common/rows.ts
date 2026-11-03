import type { CollectorGapRow, Market } from '../writers/tables';
import { VENUE } from './venue';

/**
 * IB-005 — the last pure step before the writers: a `GapRepair` gap becomes a `collector_gaps` row.
 * (The 1m candle row went with the candle tape in WD-010.)
 *
 * The signal-server's ids are `venue:SYMBOL`; the insight-bot schema keys on venue, market and
 * symbol instead, so the symbol is taken from the id's tail.
 */

/** What `GapRepair` reports about one hole, as a `collector_gaps` row (§3.3, §6.2). */
export function gapRow(input: {
  stream: string;
  market: Market | null;
  symbol: string | null;
  from: number;
  to: number;
  expected: number;
  repaired: number;
  error?: string;
  detectedAt: Date;
}): CollectorGapRow {
  return {
    stream: input.stream,
    venue: VENUE,
    market: input.market,
    symbol: input.symbol,
    gapFrom: new Date(input.from),
    gapTo: new Date(input.to),
    expected: input.expected,
    repaired: input.repaired,
    error: input.error ?? null,
    detectedAt: input.detectedAt,
  };
}

