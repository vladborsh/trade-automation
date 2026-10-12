-- IB-BUG-010 — undo. The gap rows this mechanism wrote stay in `collector_gaps`: they are
-- observations about what was and was not collected, and dropping the heartbeat table does not make
-- those windows covered.
drop table if exists collector_heartbeats;
