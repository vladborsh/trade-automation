import type { Candle } from '@trade-automation/contracts';
import type { Candle1mRow, CollectorGapRow, Market, Source } from '../writers/tables';
import { VENUE } from './venue';

/**
 * IB-005 — the last pure step before the writers: a `Candle` from the lifted Binance mappers (with
 * IB-002's taker fields) becomes a `candles_1m` row, and a `GapRepair` gap becomes a
 * `collector_gaps` row.
 *
 * `Candle.instrument` is the signal-server's `venue:SYMBOL` id; the insight-bot schema keys on
 * `(venue, market, symbol, open_time)` instead, so the symbol is taken from the id's tail.
 */

/** `binance:BTCUSDT` → `BTCUSDT`; a bare symbol is returned unchanged. */
export function symbolOf(instrumentId: string): string {
  const colon = instrumentId.indexOf(':');
  return colon === -1 ? instrumentId : instrumentId.slice(colon + 1);
}

export function candleRow(candle: Candle, market: Market, source: Source): Candle1mRow {
  return {
    venue: VENUE,
    market,
    symbol: symbolOf(candle.instrument),
    openTime: new Date(candle.openTime),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    // IB-002: absent stays absent — null, never 0 (a bar with no taker buys is not the same as
    // a payload that did not report them).
    quoteVolume: candle.quoteVolume ?? null,
    trades: candle.trades ?? null,
    takerBuyVolume: candle.takerBuyVolume ?? null,
    takerBuyQuoteVolume: candle.takerBuyQuoteVolume ?? null,
    source,
  };
}

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

/** How many 1m bars a [from, to] range should hold, both ends inclusive. */
export function expectedBars(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 60_000) + 1);
}
