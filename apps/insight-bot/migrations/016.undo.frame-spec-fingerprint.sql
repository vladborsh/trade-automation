-- IB-049 undo.
--
-- Dropping the column does NOT restore what the `do` deleted, and cannot: the frames it removed
-- had no recorded fingerprint, which is why they were removed.
--
-- **The restore path is not this file.** Rebuild them under the current spec with:
--
--     npm run features -- --from <date> --to <date>
--
-- The `do` printed the range it deleted and that exact command before removing anything. An
-- undo that admits it cannot restore is honest; one that also says what to run instead is
-- useful, because whoever is reading this is already having a bad time.
drop index if exists feature_frames_fingerprint_idx;
alter table feature_frames drop column if exists spec_fingerprint;
