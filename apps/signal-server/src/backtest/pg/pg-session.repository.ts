import { SessionAggregates, SessionLayout, SessionStatus, SessionSummary, Timeframe } from '@trade-automation/contracts';
import { DbHandle } from '../../db/db.port';
import { NewSession, SessionRepository } from '../session.repository.port';
import { money, rMultiple } from './numeric';

/** numeric/bigint columns arrive as `number` (PgDatabase type parsers); timestamptz as `Date`. */
interface SessionRow {
  id: string;
  name: string;
  status: SessionStatus;
  session_currency: string;
  timeframe: Timeframe;
  period_from_ms: number;
  period_to_ms: number;
  cursor_ms: number;
  initial_balance: number;
  balance: number;
  default_risk_pct: number;
  costs_enabled: boolean;
  commission_pct: number;
  spread: number;
  skip_weekends: boolean;
  notional_warn_multiple: number;
  layout: SessionLayout;
  trades_count: number;
  wins_count: number;
  losses_count: number;
  pnl_ccy: number;
  pnl_r: number;
  profit_factor: number | null;
  max_drawdown_ccy: number;
  max_drawdown_r: number;
  avg_win_ccy: number | null;
  avg_win_r: number | null;
  avg_loss_ccy: number | null;
  avg_loss_r: number | null;
  stats_computed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

const COLUMNS = `id, name, status, session_currency, timeframe, period_from_ms, period_to_ms, cursor_ms,
  initial_balance, balance, default_risk_pct, costs_enabled, commission_pct, spread, skip_weekends,
  notional_warn_multiple, layout, trades_count, wins_count, losses_count, pnl_ccy, pnl_r,
  profit_factor, max_drawdown_ccy, max_drawdown_r, avg_win_ccy, avg_win_r, avg_loss_ccy,
  avg_loss_r, stats_computed_at, created_at, updated_at, completed_at`;

const ms = (d: Date | null) => (d ? d.getTime() : null);

export function toSessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    sessionCurrency: row.session_currency,
    timeframe: row.timeframe,
    periodFromMs: row.period_from_ms,
    periodToMs: row.period_to_ms,
    cursorMs: row.cursor_ms,
    initialBalance: row.initial_balance,
    balance: row.balance,
    defaultRiskPct: row.default_risk_pct,
    costs: { enabled: row.costs_enabled, commissionPct: row.commission_pct, spread: row.spread },
    skipWeekends: row.skip_weekends,
    notionalWarnMultiple: row.notional_warn_multiple,
    layout: row.layout,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    completedAt: ms(row.completed_at),
    tradesCount: row.trades_count,
    winsCount: row.wins_count,
    lossesCount: row.losses_count,
    pnlCcy: row.pnl_ccy,
    pnlR: row.pnl_r,
    profitFactor: row.profit_factor,
    maxDrawdownCcy: row.max_drawdown_ccy,
    maxDrawdownR: row.max_drawdown_r,
    avgWinCcy: row.avg_win_ccy,
    avgWinR: row.avg_win_r,
    avgLossCcy: row.avg_loss_ccy,
    avgLossR: row.avg_loss_r,
    statsComputedAt: ms(row.stats_computed_at),
  };
}

export class PgSessionRepository implements SessionRepository {
  constructor(private readonly db: DbHandle) {}

  async insert(userId: string, s: NewSession): Promise<SessionSummary> {
    const [row] = await this.db.query<SessionRow>(
      `insert into backtest_sessions
         (user_id, name, status, session_currency, timeframe, period_from_ms, period_to_ms, cursor_ms,
          initial_balance, balance, default_risk_pct, costs_enabled, commission_pct, spread,
          skip_weekends, notional_warn_multiple, layout)
       values ($1, $2, 'active', $3, $4, $5, $6, $5, $7, $7, $8, $9, $10, $11, $12, $13, $14)
       returning ${COLUMNS}`,
      [
        userId,
        s.name,
        s.sessionCurrency,
        s.timeframe,
        s.periodFromMs,
        s.periodToMs,
        s.initialBalance,
        s.defaultRiskPct,
        s.costs.enabled,
        s.costs.commissionPct,
        s.costs.spread,
        s.skipWeekends,
        s.notionalWarnMultiple,
        JSON.stringify(s.layout),
      ],
    );
    return toSessionSummary(row);
  }

  async listByUser(userId: string): Promise<SessionSummary[]> {
    const rows = await this.db.query<SessionRow>(
      `select ${COLUMNS} from backtest_sessions where user_id = $1 order by created_at desc, id`,
      [userId],
    );
    return rows.map(toSessionSummary);
  }

  async findById(userId: string, id: string, opts: { forUpdate?: boolean } = {}): Promise<SessionSummary | null> {
    const [row] = await this.db.query<SessionRow>(
      `select ${COLUMNS} from backtest_sessions where id = $1 and user_id = $2${opts.forUpdate ? ' for update' : ''}`,
      [id, userId],
    );
    return row ? toSessionSummary(row) : null;
  }

  async update(userId: string, id: string, patch: { name?: string; timeframe?: Timeframe; layout?: SessionLayout }): Promise<SessionSummary | null> {
    const [row] = await this.db.query<SessionRow>(
      `update backtest_sessions
          set name = coalesce($3, name), timeframe = coalesce($4, timeframe),
              layout = coalesce($5::jsonb, layout), updated_at = now()
        where id = $1 and user_id = $2
       returning ${COLUMNS}`,
      [id, userId, patch.name ?? null, patch.timeframe ?? null, patch.layout ? JSON.stringify(patch.layout) : null],
    );
    return row ? toSessionSummary(row) : null;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `delete from backtest_sessions where id = $1 and user_id = $2 returning id`,
      [id, userId],
    );
    return rows.length > 0;
  }

  async applyTradeClose(
    userId: string,
    id: string,
    balance: number,
    a: SessionAggregates,
  ): Promise<SessionSummary | null> {
    const [row] = await this.db.query<SessionRow>(
      `update backtest_sessions
          set balance = $3, trades_count = $4, wins_count = $5, losses_count = $6, pnl_ccy = $7, pnl_r = $8,
              profit_factor = $9, max_drawdown_ccy = $10, max_drawdown_r = $11, avg_win_ccy = $12,
              avg_win_r = $13, avg_loss_ccy = $14, avg_loss_r = $15, stats_computed_at = to_timestamp($16 / 1000.0),
              updated_at = now()
        where id = $1 and user_id = $2
       returning ${COLUMNS}`,
      [
        id,
        userId,
        money(balance),
        a.tradesCount,
        a.winsCount,
        a.lossesCount,
        money(a.pnlCcy),
        rMultiple(a.pnlR),
        rMultiple(a.profitFactor),
        money(a.maxDrawdownCcy),
        rMultiple(a.maxDrawdownR),
        money(a.avgWinCcy),
        rMultiple(a.avgWinR),
        money(a.avgLossCcy),
        rMultiple(a.avgLossR),
        a.statsComputedAt,
      ],
    );
    return row ? toSessionSummary(row) : null;
  }

  async advanceCursor(userId: string, id: string, cursorMs: number, complete: boolean): Promise<SessionSummary | null> {
    const [row] = await this.db.query<SessionRow>(
      `update backtest_sessions
          set cursor_ms = $3,
              status = case when $4 then 'complete' else status end,
              completed_at = case when $4 then now() else completed_at end,
              updated_at = now()
        where id = $1 and user_id = $2
       returning ${COLUMNS}`,
      [id, userId, cursorMs, complete],
    );
    return row ? toSessionSummary(row) : null;
  }
}
