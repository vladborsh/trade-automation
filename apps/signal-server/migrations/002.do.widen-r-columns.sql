-- BUG-002/BUG-003 follow-up (Tech Lead ruling, 2026-09-21): widen every R column and the profit
-- factor from numeric(12,6) (max 999 999.999999) to numeric(20,6) (max < 1e14). A stop-out cannot
-- be refused, so a close whose R multiple exceeded the old range answered 500 and rolled back —
-- and an advance hitting it again would wedge the session. The scale stays 6, so the server's
-- rMultiple rounding and the T-018 drift comparison are unchanged.
alter table orders
  alter column pnl_r type numeric(20,6),
  alter column mae_r type numeric(20,6);

alter table backtest_sessions
  alter column pnl_r          type numeric(20,6),
  alter column max_drawdown_r type numeric(20,6),
  alter column avg_win_r      type numeric(20,6),
  alter column avg_loss_r     type numeric(20,6),
  alter column profit_factor  type numeric(20,6);
