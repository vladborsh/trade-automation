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
import { DbHandle } from '../../db/db.port';
import { NewModification, NewOrder, OrderClose, OrderFill, OrderLevelsUpdate, OrderRepository } from '../order.repository.port';
import { money, percent, rMultiple } from './numeric';

/** numeric/bigint columns arrive as `number` (PgDatabase type parsers); timestamptz as `Date`. */
interface OrderRow {
  id: string;
  session_id: string;
  seq: number;
  panel_id: string;
  instrument: InstrumentId;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  placed_at_ms: number;
  limit_price: number | null;
  entry_price: number | null;
  entry_time_ms: number | null;
  qty: number;
  contract_multiplier: number;
  risk_pct: number;
  risk_amount_ccy: number;
  sl_initial: number;
  sl_current: number;
  tp_initial: number | null;
  tp_current: number | null;
  exit_price: number | null;
  exit_time_ms: number | null;
  close_reason: CloseReason | null;
  fill_resolution: FillResolution | null;
  sl_tp_same_bar: boolean;
  commission_ccy: number;
  spread_cost_ccy: number;
  pnl_ccy: number | null;
  pnl_r: number | null;
  mae_price: number | null;
  mae_r: number | null;
  cancelled_at_ms: number | null;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = `id, session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, limit_price,
  entry_price, entry_time_ms, qty, contract_multiplier, risk_pct, risk_amount_ccy, sl_initial, sl_current, tp_initial,
  tp_current, exit_price, exit_time_ms, close_reason, fill_resolution, sl_tp_same_bar, commission_ccy,
  spread_cost_ccy, pnl_ccy, pnl_r, mae_price, mae_r, cancelled_at_ms, created_at, updated_at`;

export function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    sessionId: r.session_id,
    seq: r.seq,
    panelId: r.panel_id,
    instrument: r.instrument,
    side: r.side,
    type: r.type,
    status: r.status,
    placedAtMs: r.placed_at_ms,
    limitPrice: r.limit_price,
    entryPrice: r.entry_price,
    entryTimeMs: r.entry_time_ms,
    qty: r.qty,
    contractMultiplier: r.contract_multiplier,
    riskPct: r.risk_pct,
    riskAmountCcy: r.risk_amount_ccy,
    slInitial: r.sl_initial,
    slCurrent: r.sl_current,
    tpInitial: r.tp_initial,
    tpCurrent: r.tp_current,
    exitPrice: r.exit_price,
    exitTimeMs: r.exit_time_ms,
    closeReason: r.close_reason,
    fillResolution: r.fill_resolution,
    slTpSameBar: r.sl_tp_same_bar,
    commissionCcy: r.commission_ccy,
    spreadCostCcy: r.spread_cost_ccy,
    pnlCcy: r.pnl_ccy,
    pnlR: r.pnl_r,
    maePrice: r.mae_price,
    maeR: r.mae_r,
    cancelledAtMs: r.cancelled_at_ms,
    createdAt: r.created_at.getTime(),
    updatedAt: r.updated_at.getTime(),
  };
}

interface ModificationRow {
  id: number;
  order_id: string;
  cursor_ms: number;
  field: 'sl' | 'tp';
  old_value: number | null;
  new_value: number | null;
  created_at: Date;
}

const MODIFICATION_COLUMNS = 'id, order_id, cursor_ms, field, old_value, new_value, created_at';

function toModification(r: ModificationRow): OrderModification {
  return {
    id: r.id,
    orderId: r.order_id,
    cursorMs: r.cursor_ms,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    createdAt: r.created_at.getTime(),
  };
}

export class PgOrderRepository implements OrderRepository {
  constructor(private readonly db: DbHandle) {}

  async listClosedForStats(sessionId: string): Promise<StatsOrder[]> {
    const rows = await this.db.query<OrderRow>(
      `select id, seq, instrument, side, status, exit_time_ms, pnl_ccy, pnl_r, mae_r, fill_resolution, close_reason
         from orders where session_id = $1 and status = 'closed'
        order by seq`,
      [sessionId],
    );
    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      instrument: r.instrument,
      side: r.side,
      status: r.status,
      exitTimeMs: r.exit_time_ms,
      pnlCcy: r.pnl_ccy,
      pnlR: r.pnl_r,
      maeR: r.mae_r,
      fillResolution: r.fill_resolution,
      closeReason: r.close_reason,
    }));
  }

  async nextSeq(sessionId: string): Promise<number> {
    const [row] = await this.db.query<{ next: number }>(
      `select coalesce(max(seq), 0) + 1 as next from orders where session_id = $1`,
      [sessionId],
    );
    return row.next;
  }

  async insert(o: NewOrder): Promise<Order> {
    const [row] = await this.db.query<OrderRow>(
      `insert into orders
         (session_id, seq, panel_id, instrument, side, type, status, placed_at_ms, limit_price, entry_price,
          entry_time_ms, qty, risk_pct, risk_amount_ccy, sl_initial, sl_current, tp_initial, tp_current,
          fill_resolution, contract_multiplier)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $16, $17, $18)
       returning ${COLUMNS}`,
      [
        o.sessionId,
        o.seq,
        o.panelId,
        o.instrument,
        o.side,
        o.type,
        o.status,
        o.placedAtMs,
        money(o.limitPrice),
        money(o.entryPrice),
        o.entryTimeMs,
        money(o.qty),
        percent(o.riskPct),
        money(o.riskAmountCcy),
        money(o.sl),
        money(o.tp),
        o.fillResolution,
        money(o.contractMultiplier),
      ],
    );
    return toOrder(row);
  }

  async findById(sessionId: string, orderId: string, opts: { forUpdate?: boolean } = {}): Promise<Order | null> {
    const [row] = await this.db.query<OrderRow>(
      `select ${COLUMNS} from orders where id = $1 and session_id = $2${opts.forUpdate ? ' for update' : ''}`,
      [orderId, sessionId],
    );
    return row ? toOrder(row) : null;
  }

  async list(sessionId: string, statuses?: readonly OrderStatus[]): Promise<Order[]> {
    const rows = statuses
      ? await this.db.query<OrderRow>(
          `select ${COLUMNS} from orders where session_id = $1 and status = any($2::text[]) order by seq`,
          [sessionId, statuses],
        )
      : await this.db.query<OrderRow>(`select ${COLUMNS} from orders where session_id = $1 order by seq`, [sessionId]);
    return rows.map(toOrder);
  }

  async listModifications(orderId: string): Promise<OrderModification[]> {
    const rows = await this.db.query<ModificationRow>(
      `select ${MODIFICATION_COLUMNS} from order_modifications where order_id = $1 order by id`,
      [orderId],
    );
    return rows.map(toModification);
  }

  async updateLevels(sessionId: string, orderId: string, levels: OrderLevelsUpdate): Promise<Order | null> {
    const [row] = await this.db.query<OrderRow>(
      `update orders
          set sl_current = coalesce($3, sl_current), tp_current = coalesce($4, tp_current), updated_at = now()
        where id = $1 and session_id = $2 and status in ('pending', 'open')
       returning ${COLUMNS}`,
      [orderId, sessionId, money(levels.sl ?? null), money(levels.tp ?? null)],
    );
    return row ? toOrder(row) : null;
  }

  async insertModification(m: NewModification): Promise<OrderModification> {
    const [row] = await this.db.query<ModificationRow>(
      `insert into order_modifications (order_id, cursor_ms, field, old_value, new_value)
       values ($1, $2, $3, $4, $5)
       returning ${MODIFICATION_COLUMNS}`,
      [m.orderId, m.cursorMs, m.field, money(m.oldValue), money(m.newValue)],
    );
    return toModification(row);
  }

  async fill(sessionId: string, orderId: string, f: OrderFill): Promise<Order | null> {
    const [row] = await this.db.query<OrderRow>(
      `update orders set status = 'open', entry_price = $3, entry_time_ms = $4, fill_resolution = $5, updated_at = now()
        where id = $1 and session_id = $2 and status = 'pending'
       returning ${COLUMNS}`,
      [orderId, sessionId, money(f.entryPrice), f.entryTimeMs, f.fillResolution],
    );
    return row ? toOrder(row) : null;
  }

  async cancel(sessionId: string, orderId: string, cancelledAtMs: number): Promise<Order | null> {
    const [row] = await this.db.query<OrderRow>(
      `update orders set status = 'cancelled', cancelled_at_ms = $3, updated_at = now()
        where id = $1 and session_id = $2 and status = 'pending'
       returning ${COLUMNS}`,
      [orderId, sessionId, cancelledAtMs],
    );
    return row ? toOrder(row) : null;
  }

  async close(sessionId: string, orderId: string, c: OrderClose): Promise<Order | null> {
    const [row] = await this.db.query<OrderRow>(
      `update orders
          set status = 'closed', exit_price = $3, exit_time_ms = $4, close_reason = $5, fill_resolution = $6,
              commission_ccy = $7, spread_cost_ccy = $8, pnl_ccy = $9, pnl_r = $10, mae_price = $11, mae_r = $12,
              sl_tp_same_bar = $13, updated_at = now()
        where id = $1 and session_id = $2 and status = 'open'
       returning ${COLUMNS}`,
      [
        orderId,
        sessionId,
        money(c.exitPrice),
        c.exitTimeMs,
        c.closeReason,
        c.fillResolution,
        money(c.commissionCcy),
        money(c.spreadCostCcy),
        money(c.pnlCcy),
        rMultiple(c.pnlR),
        money(c.maePrice),
        rMultiple(c.maeR),
        c.slTpSameBar,
      ],
    );
    return row ? toOrder(row) : null;
  }
}
