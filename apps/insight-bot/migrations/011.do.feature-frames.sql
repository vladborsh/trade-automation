-- IB-015 — the feature frames of design §8.2, and the mechanism that stops their meaning
-- drifting out from under them.
--
-- Three tables.
--
-- `feature_frames` is the §3.4 shape, APPEND-ONLY by revision: the keys as jsonb,
-- the basis it was computed over, and `complete`. A frame is written even when a key could not be
-- computed — a skipped frame is indistinguishable from "the feature pass was not running", which
-- is IB-BUG-010 one layer up. `complete` is an INDEX for "does this frame hold a non-computable
-- key", never a gate: arming is decided per key by the consumer, because a boolean is something a
-- consumer can forget to read and a per-key type is not.
--
-- `feature_frame_versions` records, for each `frame_version`, the spec fingerprint the FIRST frame
-- under it was written with. The writer compares the live fingerprint against that row on EVERY
-- write and fails hard on a mismatch. Without it, "bump the version when the meaning changes" is
-- a sentence in a contract file, and the person editing the spec six months after the first frame
-- lands will not read it. AGENTS.md's rule for a shape carrying a behavioural invariant is to
-- assert it at runtime rather than trust it; this is that rule applied to the frame's own
-- definition.

create table feature_frames (
  symbol        text        not null,
  tf            text        not null check (tf in ('15m','4h')),
  -- the bar's close, always UTC. The frame is stamped by its bar, never by the wall clock, so a
  -- late-completed frame still counts as that bar's decision (§8.1).
  close_time    timestamptz not null,
  frame_version int         not null,
  -- the §8.2 key set: each key is {"ok":true,"value":…} or {"ok":false,"why":…}. Never a bare
  -- null and never a zero standing in for "not computable".
  keys          jsonb       not null,
  -- what it was computed over: the venue set, and whether collector coverage was recorded at all
  -- (IB-BUG-010's vocabulary — "not recorded" is not "no events").
  basis         jsonb       not null,
  complete      boolean     not null,
  -- which bucket or slot was short, when one was. Empty when complete.
  incomplete_reason text[]  not null default '{}',
  -- When this revision was computed, as opposed to close_time, which is the bar it describes.
  computed_at   timestamptz not null default now(),
  -- Live pass at the close, or a backfill run over history.
  --
  -- NOT bookkeeping. Derive's heal pass fills short buckets after the fact, so a live frame
  -- refuses incomplete_input on a bucket that a backfill run executed later sees healed and
  -- computes from. A backfilled frame is therefore systematically better informed than the frame
  -- that actually existed at that close, in a direction that correlates with the data. Anything
  -- learning from frames or backtesting over them would train on information that did not exist
  -- at the moment it claims to model, and without this column nothing downstream could tell.
  --
  -- Per revision rather than per frame: a backfill pass amending a live frame is exactly that
  -- case, so revision 1 may be 'live' and revision 2 'backfill'.
  --
  -- No DEFAULT, deliberately. Every writer must say which it is; a default would let a new
  -- caller silently inherit 'live' and reintroduce the thing this column exists to make visible.
  computed_mode text        not null check (computed_mode in ('live','backfill')),
  -- APPEND-ONLY. revision 1 is the frame as first written; each amendment appends the next.
  revision      int         not null default 1,
  -- when this revision was written, and which keys moved from a refusal to a value in it. An
  -- amendment states itself rather than being inferred by diffing two rows.
  amended_at    timestamptz,
  amended_keys  text[]      not null default '{}',
  -- The partition key is in the primary key because Postgres requires it. `revision` is in it
  -- because "what did the frame at 15:00 actually say when something armed on it" must stay
  -- answerable for ever: a signal references a revision, and a reference is only meaningful if
  -- the thing referenced still exists.
  --
  -- §8.1's "idempotent on (symbol, tf, close_time)" is PRESERVED IN SUBSTANCE, not dropped: a
  -- re-check that produces identical values writes nothing at all. A new revision exists only
  -- when a refusal became a value. Without that rule append-only quietly becomes grows-forever.
  primary key (symbol, tf, close_time, revision)
) partition by range (close_time);

comment on table feature_frames is
  'Design 8.2, append-only by revision. Reads take the LATEST revision of a (symbol, tf, '
  'close_time); earlier revisions are the audit trail and a signal references the one it armed '
  'on. A frame is written even when keys are not computable: absence would be indistinguishable '
  'from the feature pass not running. complete is an index, not a gate — no consumer may arm on '
  'it; arming is decided per key.';

comment on column feature_frames.computed_mode is
  'live = written by the pass at the close; backfill = written by a later run over history. A '
  'backfilled frame is better informed than the live one for the same close, because derive '
  'healed its buckets in between — mixing the two when learning or backtesting is lookahead. '
  'Per revision: a backfill that amends a live frame writes a backfill revision.';

comment on column feature_frames.complete is
  'True when every key computed. An INDEX for finding frames with refusals, never a safety '
  'mechanism: a consumer decides per key, because a boolean can be forgotten and a typed value '
  'cannot.';

create index feature_frames_incomplete_idx on feature_frames (close_time) where not complete;
-- IB-017 and IB-023 read live frames over a window; without this they scan backfilled rows too.
create index feature_frames_live_idx on feature_frames (close_time) where computed_mode = 'live';

-- ---------------------------------------------------------------------------------------------
-- Rule 2: a re-check that would CHANGE an already-published value is a data defect, recorded and
-- counted, never applied. An input that moved under us is a finding about the collectors, not a
-- correction to a feature — and something may already have armed on the published answer.
--
-- Expected to be EMPTY in normal operation, which is what makes it worth counting: a counter
-- that is routinely non-zero tells nobody anything.
-- ---------------------------------------------------------------------------------------------

create table feature_value_conflicts (
  symbol       text        not null,
  tf           text        not null,
  close_time   timestamptz not null,
  -- the revision whose value stood; the recomputed one was discarded
  revision     int         not null,
  feature_key  text        not null,
  published    jsonb       not null,
  recomputed   jsonb       not null,
  seen_at      timestamptz not null default now(),
  primary key (symbol, tf, close_time, revision, feature_key, seen_at)
);

comment on table feature_value_conflicts is
  'IB-015 rule 2: a recompute that would change an already-published feature value. The published '
  'value STANDS and the attempt is recorded here. Non-empty means an input changed under us after '
  'publication, which is a collector finding, not a feature correction.';

-- ---------------------------------------------------------------------------------------------
-- The version guard. Tiny, not partitioned: one row per frame_version, ever.
-- ---------------------------------------------------------------------------------------------

create table feature_frame_versions (
  frame_version    int         primary key,
  -- the fingerprint over the whole key registry — names, types, windows, every meaning-defining
  -- parameter, and each key's definition text.
  spec_fingerprint text        not null,
  first_written_at timestamptz not null default now()
);

comment on table feature_frame_versions is
  'IB-015: the spec fingerprint the first frame of each version was written under. The writer '
  'compares the live fingerprint to this on every write and refuses on a mismatch, so changing '
  'what a key MEANS without bumping frame_version fails loudly instead of silently producing '
  'frames that cannot be compared with the ones already stored.';
