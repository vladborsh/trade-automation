-- IB-049 — every frame records the spec fingerprint it was computed under.
--
-- Number taken immediately before the merge, per the policy change of 2026-10-12: a migration
-- number must be greater than master's highest AT MERGE TIME, and nobody controls merge order.
-- Allocating at build time is what burned 013 and 014.
--
-- ---------------------------------------------------------------------------------------------
-- Why the column exists
--
-- `frame_version` is the WEAK identifier: a human-assigned integer we deliberately did not bump
-- while the registry was still unpersisted. `spec_fingerprint` is the STRONG one — it is derived
-- from the key set itself, so it cannot be forgotten the way a version bump can.
--
-- Without it, a frame records only the number somebody chose, and the claim table is the sole
-- record of what produced it. That made IB-049 possible to misread in both directions: dev-1's
-- slot held 905 frames whose key sets had to be INFERRED (903 at 45 keys, 2 at 47) because
-- nothing on the row said. With this column the mixture is a select, the claim table becomes a
-- cross-check rather than the only witness, and a retroactive claim cannot be made quietly
-- because the rows contradict it.
--
-- Same principle as `venuesPresent`, the ratio basis, `computed_mode` and `frame_revision`:
-- **a derived row carries what it was derived from.**
--
-- NO DEFAULT, deliberately — as with `computed_mode` and `frame_revision`. A writer that omits
-- it must fail loudly rather than inherit a value claiming the frame was computed under a spec
-- it may not have been. That is the exact defect this column exists to make impossible.
-- ---------------------------------------------------------------------------------------------

-- The existing rows cannot be given a truthful value: nothing recorded which spec produced them,
-- and inventing one is the retroactive legitimisation this whole task is about refusing. Frames
-- are DERIVED data, reproducible from the raw tables by `npm run features -- --from --to` in
-- minutes, so they are dropped rather than back-filled with a guess.
--
-- The claims go with them: a claim describes frames, and keeping one whose frames are gone would
-- certify the next write against a fingerprint nothing was ever written under.
-- Say what is being destroyed BEFORE destroying it.
--
-- Today's whole diagnosis rested on a shape that existed only in these rows — "903 frames at 45
-- keys, 2 at 47" — and a migration that deletes them silently removes the ability to know what
-- was there. That is the same loss we spent the day preventing in the product, so the census is
-- printed first: how many, which key-set sizes, over what range, and what the claims said.
do $$
declare
  n        bigint;
  lo       timestamptz;
  hi       timestamptz;
  sizes    text;
  claims   text;
begin
  select count(*), min(close_time), max(close_time) into n, lo, hi from feature_frames;
  if n = 0 then
    raise notice '016: no feature_frames to remove.';
  else
    select string_agg(t.k || ' keys x ' || t.c, '; ' order by t.k) into sizes
      from (select (select count(*) from jsonb_object_keys(f.keys)) as k, count(*) as c
              from feature_frames f group by 1) t;
    select string_agg(frame_version || '=' || spec_fingerprint, ', ' order by frame_version)
      into claims from feature_frame_versions;
    raise notice '016: deleting % feature_frames (%) spanning % .. %; claims were [%]',
      n, coalesce(sizes, 'unknown key sets'), lo, hi, coalesce(claims, 'NONE');
    raise notice '016: they are derived data — rebuild with: npm run features -- --from % --to %',
      to_char(lo, 'YYYY-MM-DD'), to_char(hi + interval '1 day', 'YYYY-MM-DD');
  end if;
end $$;

delete from feature_frames;
delete from feature_frame_versions;

alter table feature_frames add column spec_fingerprint text not null;

comment on column feature_frames.spec_fingerprint is
  'The spec fingerprint the key registry hashed to when this frame was computed. The STRONG '
  'identifier — frame_version is a number a human assigns and can forget to change, this is '
  'derived from the key set. No default: a writer that omits it must fail loudly rather than '
  'claim a spec it may not have run under.';

-- The read a mixture is diagnosed with, so it is one query rather than an inference from key
-- counts (which is how IB-049 had to be diagnosed).
create index feature_frames_fingerprint_idx on feature_frames (spec_fingerprint, close_time);
