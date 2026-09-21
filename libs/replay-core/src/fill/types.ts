import { Candle, CompactCandleTuple, FillEvent, Order } from '@trade-automation/contracts';

/**
 * One bar of the price path the engine walks: a 1m candle (§6) or, for the pessimistic fallback,
 * a bar of the session timeframe. A `Candle` satisfies it structurally; `pathFromTuples` adapts
 * the compact ahead-cache tuples (§5.3), so both sides feed the engine the same numbers.
 */
export type PathBar = Pick<Candle, 'openTime' | 'open' | 'high' | 'low' | 'close'>;

/** `[openTime, o, h, l, c, v]` → `PathBar`. */
export function pathFromTuples(tuples: readonly CompactCandleTuple[]): PathBar[] {
  return tuples.map(([openTime, open, high, low, close]) => ({ openTime, open, high, low, close }));
}

/** The `Order` fields `evaluateOrder` reads. A contract `Order` is assignable as is. */
export type EvaluableOrder = Pick<
  Order,
  'id' | 'side' | 'type' | 'status' | 'limitPrice' | 'entryPrice' | 'entryTimeMs' | 'slCurrent' | 'tpCurrent'
>;

/**
 * A contract `FillEvent` plus the one fact the §3 `orders.sl_tp_same_bar` column needs that the
 * wire event does not carry: set to `true` on a stop exit whose candle also touched the target
 * (§6 "stop first"). Absent otherwise. Assignable to `FillEvent`; zod parsing strips it.
 */
export type EngineFillEvent = FillEvent & { slTpSameBar?: true };
