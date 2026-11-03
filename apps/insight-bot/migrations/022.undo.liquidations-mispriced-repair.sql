-- IB-BUG-018 undo: the deleted rows cannot be restored (their stored notional was wrong anyway, and
-- the true contract size was never recorded). Undoing this migration changes nothing.
select 1;
