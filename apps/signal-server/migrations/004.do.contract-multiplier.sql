-- T-053, D12 (backtest-app-system-design.md §6 "Contract, sizing and margin", §3): each order
-- snapshots its instrument's contract multiplier at placement, so a later instruments.yaml change
-- cannot re-price a trade (notional = qty × multiplier × price). Every configured multiplier is 1,
-- so the default back-fills existing rows with the value they were priced at.
--
-- The flat notional warning (decision 25's `notionalWarnMultiple`) is replaced by the venue
-- minimum and margin checks, so its session column goes.
alter table orders
  add column contract_multiplier numeric(20,8) not null default 1;

alter table backtest_sessions
  drop column notional_warn_multiple;
