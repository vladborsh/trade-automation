-- Reverse of 004.do.contract-multiplier.sql. The warning multiple comes back at its old default.
alter table backtest_sessions
  add column notional_warn_multiple numeric(8,2) not null default 5;

alter table orders
  drop column contract_multiplier;
