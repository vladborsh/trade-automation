-- IB-028 — DEX pool snapshots (architecture/insight-bot-system-design.md §10, §13 p.4).
--
-- Migration 016, allocated by the Tech Lead, who now keeps the ledger. It was 013 and moved for a
-- reason worth recording, because it is the mirror of the hazard this file's sibling warned about:
-- numbers were allocated 012/013/014/015 in order, and then **015 merged before 013 and 014
-- existed**. Master now holds 001-012 and 015, so any database migrated from master reaches
-- version 15 and would never apply a later 013 or 014 — postgrator only runs versions ABOVE the
-- current one.
--
-- So allocating in order does not prevent the skip; only merging in order would, and merges are
-- not ordered. The invariant that actually holds is therefore **not contiguity** — 015 is merged
-- and the 013/014 hole is permanent — but: no duplicates, and no new migration numbered at or
-- below the highest version already on master. A number nothing will ever claim cannot be skipped,
-- which is why the hole is harmless and this renumber is not optional.
--
-- **Collection only. No filtering, no alerts, no scoring.** The point of this table is a history of
-- every candidate pool INCLUDING the ones a later filter would throw away, so that filter can be
-- evaluated against what it discarded. A snapshot that only kept the pools we currently think are
-- interesting could never answer "what did the rule miss", which is the one question it exists to
-- answer. Resist making it clever.
--
-- ## Absent is not zero, and the API hands us the case immediately
--
-- GeckoTerminal returns `market_cap_usd: null` on a real pool in the very first page of
-- `new_pools` — a token whose cap it does not know. GoPlus has not been asked about a token at
-- first sight. A holder count may simply be omitted. Each of those is **unknown**, and a `0` in its
-- place is a measurement that was never made: "this token has no holders" and "we have not asked"
-- would then be the same row.
--
-- So every numeric reading here is NULLABLE, and nothing defaults to 0. Where a zero is genuinely
-- meaningful (a pool with no transactions in the window) it is stored as 0 and is distinguishable
-- precisely because the unknown case is null.

create table dex_pools (
  -- GeckoTerminal's own id, `<network>_<address>`, kept verbatim: it is the join key back to the
  -- API and inventing our own would mean maintaining a mapping nobody asked for.
  pool_id        text        not null,
  network        text        not null check (network in ('solana','base','bsc','eth')),
  address        text        not null,
  dex            text,                       -- e.g. 'pump-fun'; null when the API omits it
  name           text,                       -- 'REPLY / SOL' as the venue writes it
  base_token_id  text,
  quote_token_id text,
  pool_created_at timestamptz,               -- the venue's claim about the pool, not our clock

  -- Which listing this snapshot came from. A pool can appear in both, and "it was trending" is a
  -- different fact from "it was new", so the source is recorded rather than merged away.
  listing        text        not null check (listing in ('new_pools','trending_pools')),
  observed_at    timestamptz not null,

  -- Readings. All nullable: see the note above.
  base_price_usd      numeric,
  fdv_usd             numeric,
  market_cap_usd      numeric,               -- null is COMMON here, not exceptional
  reserve_usd         numeric,
  volume_usd_h24      numeric,
  price_change_pct_h24 numeric,
  txns_h24_buys       integer,
  txns_h24_sells      integer,

  primary key (pool_id, listing, observed_at)
) partition by range (observed_at);

comment on table dex_pools is
  'IB-028. One row per pool per listing per poll — a history of candidates INCLUDING those a later '
  'filter would drop, so the filter can be judged against what it discarded. Every reading is '
  'nullable: absent is not zero.';

create index dex_pools_network_idx on dex_pools (network, observed_at desc);
create index dex_pools_address_idx on dex_pools (address, observed_at desc);

/*
 * Tokens, and what we have been told about their security.
 *
 * `first_seen_at` is ours and never the venue's, for the same reason `raw_news` keeps both: it is
 * the instant from which we are responsible for this token, and a venue's creation timestamp is a
 * claim about the chain.
 *
 * The GoPlus columns are a SNAPSHOT AT A TIME, not a verdict: §10 asks for the check at first
 * sight, then again at 6 h and 24 h, because the answer changes — a contract can be renounced, a
 * honeypot flag can appear. `checked_at` null means we have not asked yet, which is not the same as
 * "asked and told nothing", which is a row with `checked_at` set and the flags null.
 */
create table dex_tokens (
  token_id      text        primary key,     -- '<network>_<address>', GeckoTerminal's id
  network       text        not null,
  address       text        not null,
  symbol        text,
  name          text,
  first_seen_at timestamptz not null,
  unique (network, address)
);

/*
 * GoPlus answers in TWO INCOMPATIBLE SHAPES, measured 2026-10-12 against the live API, and the
 * schema says so rather than pretending one set of columns fits both:
 *
 *   solana  -> mintable, freezable, closable, balance_mutable_authority, metadata_mutable,
 *              transfer_fee, non_transferable, default_account_state, creators, total_supply
 *   evm     -> is_open_source, is_in_dex, buy_tax, sell_tax, holder_count, creator_address,
 *              creator_balance, creator_percent, cannot_buy, honeypot_with_same_creator,
 *              token_name, token_symbol, total_supply
 *
 * My first draft of this table had `is_honeypot`, `is_proxy` and `owner_can_change_balance`. **None
 * of those three appears in either response** for the tokens probed — they were taken from GoPlus
 * documentation rather than from the API, which is the mistake the live pass exists to catch.
 *
 * So:
 *
 * - **`raw` is the record.** Always stored, always complete. A field we do not model yet is kept
 *   rather than lost, and a disagreement later is audited against the source instead of our mapping.
 * - **`chain_family` says which shape to expect**, so a NULL in an EVM-only column for a Solana
 *   token reads as NOT APPLICABLE rather than NOT TOLD. Those are different facts and a reader
 *   cannot tell them apart without this column.
 * - **A field ABSENT from the response is not the same as one present and empty.** `buy_tax` comes
 *   back as the empty string `''` on a fresh EVM token, and `Number('')` is 0 — a 0 % tax claim
 *   where GoPlus said nothing at all. Every numeric column here is nullable and written through
 *   `numberOrNull`, which refuses `''`.
 */
create table dex_token_security (
  token_id     text        not null references dex_tokens (token_id) on delete cascade,
  -- which of the three §10 checks this is; the schedule is part of the measurement
  at_stage     text        not null check (at_stage in ('first_seen','h6','h24')),
  checked_at   timestamptz not null,
  chain_family text        not null check (chain_family in ('solana','evm')),

  -- solana shape; null on an EVM token means NOT APPLICABLE (see chain_family)
  mintable                  boolean,
  freezable                 boolean,
  closable                  boolean,
  metadata_mutable          boolean,
  balance_mutable_authority boolean,

  -- evm shape; null on a Solana token means NOT APPLICABLE
  is_open_source boolean,
  cannot_buy     boolean,
  buy_tax        numeric,
  sell_tax       numeric,
  holder_count   integer,

  -- both
  total_supply numeric,

  -- the whole response, always
  raw jsonb not null,
  primary key (token_id, at_stage)
);

comment on column dex_token_security.checked_at is
  'When GoPlus was asked. A row exists only once asked; "not yet asked" is the ABSENCE of a row, '
  'and "asked and told nothing" is a row with null flags. The two must not be confused.';
comment on column dex_token_security.chain_family is
  'Which response shape this row came from. Without it a NULL in buy_tax cannot be told apart from '
  '"this chain has no such concept", which is the difference between unknown and not applicable.';

create index dex_token_security_stage_idx on dex_token_security (at_stage, checked_at desc);
