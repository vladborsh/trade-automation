-- IB-049 undo.
--
-- Dropping the column does NOT restore what the `do` deleted, and cannot: the frames it removed
-- had no recorded fingerprint, which is why they were removed. Re-run
-- `npm run features -- --from <date> --to <date>` to rebuild them under the current spec.
drop index if exists feature_frames_fingerprint_idx;
alter table feature_frames drop column if exists spec_fingerprint;
