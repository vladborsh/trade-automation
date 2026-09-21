-- Reverse of 003.do.op-fingerprint.sql.
alter table backtest_ops
  drop column fingerprint,
  drop column kind;
