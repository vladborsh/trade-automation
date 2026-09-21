-- Reverse of 001.do.init.sql, dropped in dependency order (children before parents).
drop table if exists backtest_ops;
drop table if exists screenshots;
drop table if exists order_modifications;
drop table if exists orders;
drop table if exists backtest_sessions;
drop table if exists auth_sessions;
drop table if exists invites;
drop table if exists users;
drop extension if exists citext;
