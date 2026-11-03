import type { CollectorGapRow, Market } from '../writers/tables';
import { VENUE } from './venue';

/**
 * IB-005 — the last pure step before the writers: a `Candle` from the lifted Binance mappers (with
 * IB-002's taker fields) becomes a `candles_1m` row, and a `GapRepair` gap becomes a
 * `collector_gaps` row.
 *
 * `Candle.instrument` is the signal-server's `venue:SYMBOL` id; the insight-bot schema keys on
 * `(venue, market, symbol, open_time)` instead, so the symbol is taken from the id's tail.
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

