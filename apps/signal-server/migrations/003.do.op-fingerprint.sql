-- BUG-004 (Tech Lead brief): a reused opId replayed the stored response for ANY request carrying
-- it, whatever its operation or body. Each op row now records the operation kind (place, cancel,
-- close, advance, later modify) and a fingerprint (sha256 of the kind + the canonical JSON of the
-- request without the opId + the target order id where there is one); a reuse with a different
-- kind or fingerprint answers 409.
--
-- No backfill: rows written before this migration keep NULL in both columns, and a replay against
-- a NULL-fingerprint row behaves exactly as before (the stored response is replayed).
alter table backtest_ops
  add column kind text,
  add column fingerprint text;
