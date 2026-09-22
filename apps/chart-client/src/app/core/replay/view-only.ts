import type { Order, Timeframe } from '@trade-automation/contracts';
import { bucketStart } from './fold-on-step';
import type { PositionToolState } from '../../features/chart/overlay/position-tool.model';

const ONE_MINUTE_MS = 60_000;

/**
 * §9.3 "Show on chart": the cursor to view a trade at. `entryTimeMs` is the **open** of the 1m
 * candle whose close is the entry (a market fill) or that filled the limit, so `before =
 * entryTimeMs` would hide the very candle the trade entered on. One minute later that candle is
 * revealed — for a market order that is exactly the cursor it was placed at. An order that never
 * filled is viewed at the cursor it was placed at. Both are always <= the server cursor.
 */
export function viewAtFor(order: Pick<Order, 'entryTimeMs' | 'placedAtMs'>): number {
  return order.entryTimeMs === null ? order.placedAtMs : order.entryTimeMs + ONE_MINUTE_MS;
}

/**
 * §9.3 — the viewed order as a position tool (T-022's primitive): a `position` once it has filled,
 * a `pending` limit otherwise, anchored at the bar of `tf` that contains its fill (or placement) —
 * the chart places the tool only at a bar's open time (an entry at 09:59 has no x on a 5m chart;
 * the primitive would fall back to the left edge). Read-only: never active.
 */
export function orderTool(
  order: Pick<Order, 'id' | 'panelId' | 'side' | 'type' | 'status' | 'entryPrice' | 'limitPrice' | 'slCurrent' | 'tpCurrent' | 'entryTimeMs' | 'placedAtMs' | 'qty' | 'riskAmountCcy'>,
  tf: Timeframe,
): PositionToolState | null {
  const entry = order.entryPrice ?? order.limitPrice;
  if (entry === null) return null;
  return {
    id: `view-${order.id}`,
    orderId: order.id,
    side: order.side,
    mode: order.type,
    entry,
    sl: order.slCurrent,
    tp: order.tpCurrent,
    kind: order.entryPrice === null ? 'pending' : 'position',
    active: false,
    anchorTime: bucketStart(order.entryTimeMs ?? order.placedAtMs, tf),
    order: { qty: order.qty, riskAmount: order.riskAmountCcy }, // labelled with its own qty and R (T-023)
    readOnly: true, // T-033: live tools have stop/target handles; a viewed one never does
  };
}
