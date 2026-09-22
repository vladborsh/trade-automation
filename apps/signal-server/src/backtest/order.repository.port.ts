import type {
  CloseReason,
  FillResolution,
  InstrumentId,
  Order,
  OrderModification,
  OrderSide,
  OrderStatus,
  OrderType,
} from '@trade-automation/contracts';
import type { StatsOrder } from '@trade-automation/replay-core';

/** What POST …/orders writes (§7.2): a pending limit, or a market order already filled. */
export interface NewOrder {
  sessionId: string;
  seq: number;
  panelId: string;
  instrument: InstrumentId;
  side: OrderSide;
  type: OrderType;
  status: 'pending' | 'open';
  placedAtMs: number;
  limitPrice: number | null;
  entryPrice: number | null;
  entryTimeMs: number | null;
  qty: number;
  /** D12: the instrument's contract multiplier at placement, snapshotted on the row. */
  contractMultiplier: number;
  riskPct: number;
  riskAmountCcy: number;
  sl: number;
  tp: number | null;
  fillResolution: FillResolution | null;
}

/** T-033: the levels a stop/target move sets; an absent one is left as it is. */
export interface OrderLevelsUpdate {
  sl?: number;
  tp?: number;
}

/** Decision 23: one `order_modifications` row — a field's old and new value at the cursor. */
export interface NewModification {
  orderId: string;
  cursorMs: number;
  field: 'sl' | 'tp';
  oldValue: number | null;
  newValue: number | null;
}

/** The fields a close writes (§3, §6): exit, reason, costs, PnL in currency and R, MAE. */
export interface OrderClose {
  exitPrice: number;
  exitTimeMs: number;
  closeReason: CloseReason;
  fillResolution: FillResolution;
  /** §6: the exit candle touched both stop and target and the stop was taken. */
  slTpSameBar: boolean;
  commissionCcy: number;
  spreadCostCcy: number;
  pnlCcy: number;
  pnlR: number;
  maePrice: number;
  maeR: number;
}

/** What a limit fill writes (§5.5 step 3). */
export interface OrderFill {
  entryPrice: number;
  entryTimeMs: number;
  fillResolution: FillResolution;
}

/**
 * architecture/backtest-app-system-design.md §3, §4 — `orders` and `order_modifications`.
 *
 * Tenancy: methods take a `sessionId` the caller has already resolved for the cookie user through
 * `SessionRepository.findById(userId, …)`; this port never sees a session id straight from a URL.
 * Every write returns the row as stored (numeric columns rounded to their scale at this
 * boundary, §12.9), so callers build responses from what the database holds.
 */
export interface OrderRepository {
  /** The session's closed orders, with just the fields `computeStats` reads. Ordered by `seq`. */
  listClosedForStats(sessionId: string): Promise<StatsOrder[]>;
  /** `max(seq) + 1` for the session, 1 for the first order. Call under the session row lock. */
  nextSeq(sessionId: string): Promise<number>;
  insert(order: NewOrder): Promise<Order>;
  /** `forUpdate` row-locks it for the rest of the enclosing transaction. */
  findById(sessionId: string, orderId: string, opts?: { forUpdate?: boolean }): Promise<Order | null>;
  /** Ordered by `seq` (the journal); `statuses` filters when given. */
  list(sessionId: string, statuses?: readonly OrderStatus[]): Promise<Order[]>;
  /** Oldest first. */
  listModifications(orderId: string): Promise<OrderModification[]>;
  /** pending → open; null when no pending order with that id. */
  fill(sessionId: string, orderId: string, fill: OrderFill): Promise<Order | null>;
  /** pending → cancelled; null when no pending order with that id. */
  cancel(sessionId: string, orderId: string, cancelledAtMs: number): Promise<Order | null>;
  /** open → closed; null when no open order with that id. */
  close(sessionId: string, orderId: string, close: OrderClose): Promise<Order | null>;
  /**
   * T-033: `sl_current` / `tp_current` of a pending or open order; `sl_initial`, `tp_initial` and
   * `risk_amount_ccy` never change (R stays anchored to the placement risk). Null when no pending
   * or open order with that id.
   */
  updateLevels(sessionId: string, orderId: string, levels: OrderLevelsUpdate): Promise<Order | null>;
  /** Decision 23: appends one modification row, as stored. */
  insertModification(m: NewModification): Promise<OrderModification>;
}
