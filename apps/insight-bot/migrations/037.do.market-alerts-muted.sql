-- IB-151 — record everything; an admin switch only mutes sending (owner ruling 2026-11-06 B: «пускай все пишется.
-- если отключу в админке оно продолжит фиксировать в базу но не будет уведомлять»). Number 037 checked free on every
-- ref before commit (183 refs; 036 is IB-128's).
--
-- The liq, funding and level loops now evaluate and journal every coin, kind and event; a switch below the type's own
-- `enabled` decides only whether the row is sent, and this column says which switch kept it back:
--   coin          perCoin[symbol].enabled = false (liq, funding, level and the coin's custom levels)
--   daily         a PDH/PDL level on a coin whose perCoin[symbol].daily is off (level)
--   event         events[kind][event] = false (level)
--   custom_event  the custom level's own switch for that event is off (level)
-- Null = no switch muted the row. It may still be unsent: the type's `enabled` off, late, or a history row — those
-- were journalled before IB-151 and keep meaning what they meant.
-- A column, not a `details` field: `details` is validated by per-event strict schemas (eight of them), and a column can
-- carry the rule «a muted row is never sent» as a constraint. Not part of any once-key: a muted row has a key of its
-- own (`…:muted`), so turning the switch back on mid-period finds the sending key free, as before IB-151.
alter table market_alerts add column muted_by text
  check (muted_by in ('coin', 'daily', 'event', 'custom_event'));
alter table market_alerts add constraint market_alerts_muted_unsent
  check (muted_by is null or (fired_at is null and recipients = 0));
comment on column market_alerts.muted_by is
  'IB-151: the admin switch that kept this row from being sent (coin | daily | event | custom_event); null = none. The type''s own enabled switch is not named here.';
