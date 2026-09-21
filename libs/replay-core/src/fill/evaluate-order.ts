import { Costs, FillResolution, OrderSide } from '@trade-automation/contracts';
import { marketExitPrice, stopExitPrice, takeProfitExitPrice } from '../costs';
import { EngineFillEvent, EvaluableOrder, PathBar } from './types';

/**
 * architecture/backtest-app-system-design.md §6 — the fill engine's single entry point. Walks a
 * chronological 1m `path` for one order and returns what happened on it: nothing, a limit fill,
 * an exit, or a fill followed by an exit. At most one of each; the walk stops at the exit.
 *
 * - `pending` limit: fills on the first candle that trades through the level (long `low <=
 *   limit`, short `high >= limit`), at the level. Exits are then evaluated on that same candle,
 *   stop first, **at their levels** — the position opened inside the candle, so its open cannot
 *   gap through anything (see `stopExitPrice(open = null)`).
 * - `open`: exits on the first candle that touches the stop (long `low <= sl`, short `high >= sl`)
 *   or the target (long `high >= tp`, short `low <= tp`), with gap-through at the candle's open;
 *   both in one candle → stop, flagged `slTpSameBar`. Candles opening before `entryTimeMs` are
 *   skipped, so a caller may pass a path that starts earlier.
 * - `closed` / `cancelled`: nothing.
 *
 * Every event carries `time = openTime` of the candle that produced it and `resolution: '1m'`.
 * A `pending` market order is not a state the engine accepts — market orders fill at placement
 * with `marketFillPrice` — and throws, as does an `open` order without `entryPrice`.
 */
export function evaluateOrder(order: EvaluableOrder, path: readonly PathBar[], costs: Costs): EngineFillEvent[] {
  return walk(order, path, costs, '1m');
}

/**
 * §6 "Pessimistic fallback" (decision 4): the same table applied to bars of the session timeframe
 * when the span has no 1m. The table's stop-first rule is what makes it pessimistic; every event
 * is flagged `resolution: 'pessimistic-bar'` so the journal can mark the trade.
 */
export function walkBarsPessimistic(
  order: EvaluableOrder,
  bars: readonly PathBar[],
  costs: Costs,
): EngineFillEvent[] {
  return walk(order, bars, costs, 'pessimistic-bar');
}

/**
 * §6 "Manual close / end of session": a market exit at the last revealed candle's close, paying
 * the half-spread adversely (long `lastClose - half`, short `lastClose + half`). `time` is that
 * candle's `openTime`, the same convention as every other event.
 */
export function marketExitEvent(
  order: Pick<EvaluableOrder, 'id' | 'side'>,
  lastBar: PathBar,
  reason: 'manual' | 'end-of-session',
  costs: Costs,
  resolution: FillResolution = '1m',
): EngineFillEvent {
  return {
    orderId: order.id,
    kind: 'exit',
    time: lastBar.openTime,
    price: marketExitPrice(order.side, lastBar.close, costs),
    reason,
    resolution,
  };
}

function walk(
  order: EvaluableOrder,
  bars: readonly PathBar[],
  costs: Costs,
  resolution: FillResolution,
): EngineFillEvent[] {
  if (order.status === 'closed' || order.status === 'cancelled') return [];

  const exitAt = (bar: PathBar, open: number | null) =>
    exitOn(order, bar, open, costs, resolution);

  if (order.status === 'pending') {
    if (order.type !== 'limit' || order.limitPrice === null) {
      throw new Error(`order ${order.id}: only limit orders can be pending (market orders fill at placement)`);
    }
    const limit = order.limitPrice;
    const at = bars.findIndex((b) => (order.side === 'long' ? b.low <= limit : b.high >= limit));
    if (at < 0) return [];

    const fillBar = bars[at];
    const fill: EngineFillEvent = { orderId: order.id, kind: 'fill', time: fillBar.openTime, price: limit, resolution };
    const sameBarExit = exitAt(fillBar, null);
    if (sameBarExit) return [fill, sameBarExit];
    const laterExit = firstExit(bars.slice(at + 1), exitAt);
    return laterExit ? [fill, laterExit] : [fill];
  }

  if (order.entryPrice === null) throw new Error(`order ${order.id}: open order without entryPrice`);
  const from = order.entryTimeMs;
  const exit = firstExit(from === null ? bars : bars.filter((b) => b.openTime >= from), exitAt);
  return exit ? [exit] : [];
}

function firstExit(
  bars: readonly PathBar[],
  exitAt: (bar: PathBar, open: number | null) => EngineFillEvent | null,
): EngineFillEvent | null {
  for (const bar of bars) {
    const exit = exitAt(bar, bar.open);
    if (exit) return exit;
  }
  return null;
}

/** §6 stop / take-profit rows for one candle; stop first when both touch. */
function exitOn(
  order: EvaluableOrder,
  bar: PathBar,
  open: number | null,
  costs: Costs,
  resolution: FillResolution,
): EngineFillEvent | null {
  const { side, slCurrent: sl, tpCurrent: tp } = order;
  const slHit = touches(side, 'adverse', bar, sl);
  const tpHit = tp !== null && touches(side, 'favourable', bar, tp);
  const base = { orderId: order.id, kind: 'exit' as const, time: bar.openTime, resolution };

  if (slHit) {
    const stop: EngineFillEvent = { ...base, price: stopExitPrice(side, sl, open, costs), reason: 'stop' };
    return tpHit ? { ...stop, slTpSameBar: true } : stop;
  }
  if (tpHit) return { ...base, price: takeProfitExitPrice(side, tp, open), reason: 'take-profit' };
  return null;
}

/** Adverse = against the position (long: price down to `level`); favourable = with it. */
function touches(side: OrderSide, way: 'adverse' | 'favourable', bar: PathBar, level: number): boolean {
  const down = (side === 'long') === (way === 'adverse');
  return down ? bar.low <= level : bar.high >= level;
}
