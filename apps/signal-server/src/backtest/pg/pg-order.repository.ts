import type { StatsOrder } from '@trade-automation/replay-core';
import { DbHandle } from '../../db/db.port';
import { OrderRepository } from '../order.repository.port';

/** numeric/bigint columns arrive as `number` (PgDatabase type parsers). */
interface StatsOrderRow {
  id: string;
  seq: number;
  instrument: StatsOrder['instrument'];
  side: StatsOrder['side'];
  status: StatsOrder['status'];
  exit_time_ms: number | null;
  pnl_ccy: number | null;
  pnl_r: number | null;
  mae_r: number | null;
  fill_resolution: StatsOrder['fillResolution'];
  close_reason: StatsOrder['closeReason'];
}

export class PgOrderRepository implements OrderRepository {
  constructor(private readonly db: DbHandle) {}

  async listClosedForStats(sessionId: string): Promise<StatsOrder[]> {
    const rows = await this.db.query<StatsOrderRow>(
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
}
