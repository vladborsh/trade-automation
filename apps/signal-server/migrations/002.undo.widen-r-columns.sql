-- Reverse of 002.do.widen-r-columns.sql. Fails (numeric field overflow) if any stored value no
-- longer fits numeric(12,6); such rows must be dealt with before undoing.
alter table orders
  alter column pnl_r type numeric(12,6),
  alter column mae_r type numeric(12,6);

alter table backtest_sessions
  alter column pnl_r          type numeric(12,6),
  alter column max_drawdown_r type numeric(12,6),
  alter column avg_win_r      type numeric(12,6),
  alter column avg_loss_r     type numeric(12,6),
  alter column profit_factor  type numeric(12,6);
