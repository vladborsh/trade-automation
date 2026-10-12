-- IB-017 — the playbook engine's tables (design §3.4, D9, D10, D12).
--
-- Migration number 015 taken from the Tech Lead's ledger, not chosen: 012/013 are dev-3's news
-- and DEX, 014 is dev-1's regime. Two migrations sharing a version makes postgrator refuse the
-- whole chain, which fails every DB suite in the app rather than only the colliding one.
--
-- Four tables. `outcomes`, `deliveries`, `user_actions` and `alert_budget` are also §3.4 but are
-- NOT created here: their shapes belong to IB-022 and IB-023, and a table I do not write with a
-- vocabulary I guessed is a stub that pretends rather than a seam.
--
-- ---------------------------------------------------------------------------------------------
-- The thread running through all four: `source_mode`.
--
-- §8.4 says the stage-3 backtest runner is *the same function over historical frames*. That one
-- sentence means every table here has two writers producing rows about the same instants, and
-- every natural key in §3.4 was written as though it had one. Without the discriminator a
-- backtest would collide with live rows and `on conflict do nothing` would silently drop
-- whichever ran second — a backtest that discards its own rows exactly where live signals exist
-- reports BETTER-than-real performance, and the error presents as a good strategy.
-- ---------------------------------------------------------------------------------------------

create type playbook_source_mode as enum ('live', 'backtest');

-- ---------------------------------------------------------------------------------------------
-- Current state per (playbook, symbol, arm). Overwritten, not append-only: the audit trail of
-- what was decided at each close lives in `playbook_evaluations` below, and the signals a
-- consumer armed on are immutable in `signals`.
-- ---------------------------------------------------------------------------------------------

create table playbook_state (
  playbook     text not null,
  symbol       text not null,
  -- D9's two arms. `gated` has the playbook's one declared context_gate applied and may go
  -- live; `unconditional` runs identical thresholds with no gate and is always shadow.
  arm          text not null check (arm in ('gated','unconditional')),
  source_mode  playbook_source_mode not null,
  state        text not null check (state in ('IDLE','ARMED','TRIGGERED','CLOSED')),
  -- The playbook_config version this setup ARMED under. A setup keeps it until it closes: a new
  -- version applies to new arms only, or thresholds change underneath a live setup and the
  -- signal's recorded params are not the ones that produced it.
  version      int  not null,
  setup        jsonb,
  armed_at     timestamptz,
  expires_at   timestamptz,
  updated_at   timestamptz not null default now(),
  -- source_mode is IN the key: a backtest must never clobber the live engine's current state.
  primary key (playbook, symbol, arm, source_mode)
);

comment on table playbook_state is
  'IB-017: current setup state per playbook x symbol x arm x source_mode. TRIGGERED -> CLOSED is '
  'written by the tracker (IB-023), not by the engine; until IB-023 exists nothing leaves '
  'TRIGGERED and that is deliberate — a timeout here would be an invented number.';

-- ---------------------------------------------------------------------------------------------
-- Signals. D12's idempotency key, plus the two timestamps ruled on 2026-10-12.
-- ---------------------------------------------------------------------------------------------

create table signals (
  id               uuid primary key,
  playbook         text not null,
  version          int  not null,
  arm              text not null check (arm in ('gated','unconditional')),
  source_mode      playbook_source_mode not null,
  symbol           text not null,
  direction        text not null check (direction in ('long','short')),
  -- The BAR CLOSE the trigger fired at — not the moment we noticed. D12's anchor, so a replay
  -- of the same bar cannot duplicate a signal however late it runs.
  trigger_ts       timestamptz not null,
  -- When the runner actually evaluated it, and the signed difference.
  --
  -- Two facts, two fields. Stamping a trigger with the instant we evaluated it carries today's
  -- price into a decision that belongs to an earlier bar: the news path's anchor-skew defect
  -- arriving where it costs money rather than a correlation. Signed, because a negative value
  -- is a clock problem and a column that cannot hold it cannot report it.
  detected_at      timestamptz not null,
  detection_skew_sec int not null,
  tf               text not null check (tf in ('15m','4h')),
  setup            jsonb not null,
  -- The whole frame as it stood, so a signal can be re-read without trusting that the frame
  -- table still says what it said.
  feature_snapshot jsonb not null,
  regime           jsonb,
  score            real,
  vetoes           text[] not null default '{}',
  -- live | shadow | off at the time, so a later config change cannot rewrite history.
  status_at_signal text not null,
  delivered        boolean not null default false,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  -- D12, with source_mode added. See the header.
  unique (playbook, symbol, trigger_ts, arm, source_mode)
);

comment on column signals.trigger_ts is
  'The bar close the trigger fired at, never the instant it was evaluated — see detected_at. '
  'D12 keys on this so a late replay of the same bar is idempotent rather than duplicated.';

create index signals_symbol_ts_idx on signals (symbol, trigger_ts desc);
create index signals_live_idx on signals (trigger_ts desc) where source_mode = 'live';

-- ---------------------------------------------------------------------------------------------
-- The per-close audit row. One per (playbook, symbol, arm, close_time, source_mode).
--
-- **Why this is RECORDED and not DERIVED**, since it looks redundant: evaluability is in
-- principle recomputable from the stored frame plus the playbook's key list. But a derivation is
-- a RECONSTRUCTION, and a later recomputation is not what happened at the time — the code may
-- have moved, the config version may have moved, and the buckets may have healed. Deriving
-- evaluability after the fact is computing it in backfill mode and calling it history. It is the
-- `computed_mode` argument one level up.
--
-- **Why it cannot live on the signal row:** a gated arm that never armed produces no signal, so
-- an absent row would be ambiguous between "evaluated and declined" and "could not evaluate" —
-- the exact ambiguity every ruling on this engine has been about.
--
-- Size, measured rather than guessed: P3 at 15m over 3 symbols x 2 arms x 96 closes = 576
-- rows/day, ~210k/year.
-- ---------------------------------------------------------------------------------------------

create table playbook_evaluations (
  playbook     text not null,
  -- The version is on the row because the required-key list and the gate observable are
  -- versioned: "did not arm" is meaningless without the rules it did not arm under.
  version      int  not null,
  symbol       text not null,
  arm          text not null check (arm in ('gated','unconditional')),
  source_mode  playbook_source_mode not null,
  close_time   timestamptz not null,
  -- What happened, as a closed vocabulary rather than free text.
  outcome      text not null check (outcome in
                 ('armed','triggered','invalidated','expired','expired_unevaluable',
                  'declined','refused','held')),
  -- Set only when the engine declined to DECIDE, as opposed to deciding not to arm. Null on
  -- 'declined', which is a statement about the market. The two are never summed.
  -- `late_detection` is here with the others but is not a gap in the data: the evaluation
  -- succeeded and the trigger fired, we simply noticed too long afterwards to act. A rising
  -- count of it means the pass is running late, which is a fact about us, not the market.
  refusal      text check (refusal in
                 ('insufficient_features','blind_while_armed','window_not_contiguous',
                  'late_detection')),
  -- The context gate's three-state answer, for the gated arm. Null when no gate is declared.
  gate_status  text check (gate_status in ('pass','blocked','unavailable')),
  gate_refusal text check (gate_refusal in
                 ('calendar_unknown','gate_key_unavailable','gate_axis_unavailable')),
  -- True when this close must be dropped from BOTH arms before they are compared.
  --
  -- A close where the gate could not be answered is evidence about our plumbing and nothing
  -- about the gate. Counted as "the gated arm did not arm", a fortnight of our own outage reads
  -- as "the gate costs performance" — a number that is right about the wrong population, in the
  -- one place where it decides whether a playbook ships.
  exclude_from_comparison boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (playbook, symbol, arm, close_time, source_mode)
) partition by range (close_time);

comment on table playbook_evaluations is
  'IB-017: one row per playbook x symbol x arm x close, recording what the engine decided and — '
  'when it declined to decide — why. Recorded rather than derived: a later recomputation is a '
  'reconstruction under code, config and healed buckets that did not exist at the time.';

create index playbook_evaluations_excluded_idx
  on playbook_evaluations (playbook, symbol, close_time) where exclude_from_comparison;

-- ---------------------------------------------------------------------------------------------
-- Cooldowns (§8.5 item 4, 12 h per playbook x symbol after CLOSED). The gate (IB-020) owns the
-- policy; the engine only reads whether one blocks a new arm.
-- ---------------------------------------------------------------------------------------------

create table cooldowns (
  playbook    text not null,
  symbol      text not null,
  source_mode playbook_source_mode not null,
  until       timestamptz not null,
  primary key (playbook, symbol, source_mode)
);
