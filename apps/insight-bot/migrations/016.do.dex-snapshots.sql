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

/*
 * ## ONE canonical stored form per chain, enforced rather than agreed
 *
 * The addresses here are join keys, and a join key with two spellings is the defect this file
 * already fixes at ingest: GeckoTerminal lower-cases EVM addresses, DexScreener returns them
 * EIP-55 checksummed, and an exact-string join silently drops 10-15 % of EVM pairs (measured
 * 2026-10-12; see `src/dex/dexscreener.ts`).
 *
 * Fixing the join left the STORED form open, and that hole is worse, because `dex_tokens` carries
 * `unique (network, address)` and **a unique index cannot see case-equivalence**: two spellings of
 * one EVM address satisfy it and give two rows for one token. It holds today only because every
 * address arrives from GeckoTerminal; it breaks silently the first time one arrives from
 * DexScreener, from GoPlus's echo, or from a hand-typed query.
 *
 * So every address and id column below carries
 *
 *     check (network = 'solana' or <col> = lower(<col>))
 *
 * A non-canonical EVM value cannot be stored, `unique (network, address)` starts meaning what it
 * claims, and the next person to write a join does not need to know EIP-55 exists.
 *
 * **Solana is exempt, and that is not laziness.** Base58 is case-SENSITIVE — `A` and `a` are
 * different digits of different addresses — so there is no canonical form to move to and folding
 * would be a correctness bug. Canonicalising is LOSSLESS on EVM, which is the only reason this is
 * available here: hex case carries no information, EIP-55 is a typo detector layered on a
 * case-insensitive string, and the venue's own spelling is kept in `raw` regardless.
 */

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

  primary key (pool_id, listing, observed_at),
  -- see the canonical-form note above; EVM only, because base58 case is meaningful
  constraint dex_pools_canonical_address
    check (network = 'solana' or (address = lower(address) and pool_id = lower(pool_id)))
) partition by range (observed_at);

comment on table dex_pools is
  'IB-028. One row per pool per listing per poll — a history of candidates INCLUDING those a later '
  'filter would drop, so the filter can be judged against what it discarded. Every reading is '
  'nullable: absent is not zero.';

comment on column dex_pools.address is
  'Canonical form: lower-case on EVM, verbatim on Solana (base58 is case-sensitive). Enforced by '
  'dex_pools_canonical_address; see the note above the table.';
comment on column dex_pools.market_cap_usd is
  'ABSENT IS NOT ZERO. All 20 pools of the recorded new_pools page carry market_cap_usd: null — '
  'GeckoTerminal does not know the cap of a token minted minutes ago, so unknown is the NORM here. '
  'A coalesce(…, 0) would report twenty tokens worth nothing.';

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
 * honeypot flag can appear. The four states "never asked / the ask failed / asked and told nothing
 * / asked and told" are spelled out on `dex_token_security` below.
 */
create table dex_tokens (
  token_id      text        primary key,     -- '<network>_<address>', GeckoTerminal's id
  network       text        not null,
  address       text        not null,
  symbol        text,
  name          text,
  first_seen_at timestamptz not null,
  unique (network, address),
  -- without this the unique index above cannot do its job: two spellings of one EVM address would
  -- satisfy it and we would hold two token rows, two first_seen_at instants and two GoPlus budgets
  constraint dex_tokens_canonical_address
    check (network = 'solana' or (address = lower(address) and token_id = lower(token_id)))
);

comment on column dex_tokens.address is
  'Canonical form: lower-case on EVM, verbatim on Solana (base58 is case-sensitive). Enforced by '
  'dex_tokens_canonical_address, because unique (network, address) cannot see case-equivalence.';

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

  /*
   * **FOUR states, not three**, and conflating any pair of them costs something different:
   *
   *   1. not asked                  -> no row at all
   *   2. the ask FAILED             -> row, answered = false, failure_reason set
   *   3. asked, venue said nothing  -> row, answered = true,  flags all null
   *   4. asked, venue answered      -> row, answered = true,  flags set
   *
   * (2) and (3) are the pair that matters. If a failed ask were written as an answer with null
   * flags it would be indistinguishable from "the venue told us nothing", the token would never be
   * retried, and we would be **permanently ignorant about that token's security** — silently,
   * which is worse than the infinite re-queue it mirrors. If a failure wrote no row at all the
   * token looks un-asked and retries for ever, burning the rate budget on a token that cannot be
   * answered.
   *
   * So a failure is a recorded ATTEMPT that is not an ANSWER, and every "has this been done" test
   * keys on `answered`, never on a row existing.
   */
  answered       boolean not null,
  failure_reason text,
  attempts       integer not null default 1,
  constraint dex_token_security_answer_or_reason
    check ((answered and failure_reason is null) or (not answered and failure_reason is not null)),

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

  /*
   * Which fields of this family the response did not carry FOR THIS TOKEN.
   *
   * GoPlus omits an attribute it has nothing to say about, per token, routinely — measured
   * 2026-10-12: `metadata_mutable` on 1 of 12 Solana tokens, `is_open_source` on 4 of 9 BSC
   * tokens, `cannot_buy` and `total_supply` on EVM besides. That is "not told", not a shape
   * change, so it is a null in the column and a name in here rather than a failed ask.
   *
   * Recording it is what the earlier hard failure was standing in for: if a field starts appearing
   * here for EVERY token, that IS the shape change, and it is then a query over stored rows
   * instead of a guess — and it needs no release to ask.
   */
  absent_fields text[] not null default '{}',

  -- the whole response, always
  raw jsonb not null,
  primary key (token_id, at_stage)
);

comment on column dex_token_security.answered is
  'FOUR states: no row = never asked; answered=false with a reason = the ask FAILED and the token '
  'is still due; answered=true with null flags = asked and the venue told us nothing; answered=true '
  'with flags = asked and told. Every "has this been done" test keys on this column, never on a '
  'row existing, or a failure silently becomes a permanent answer.';
comment on column dex_token_security.attempts is
  'Failed asks at this stage. Bounds the retry so a token GoPlus can never answer about stops '
  'consuming the rate budget, and records what the stage cost; an answer clears the reason but '
  'not the count.';
comment on column dex_token_security.checked_at is
  'When GoPlus was last asked — on a failure too, which is why it cannot carry the "has it been '
  'answered" meaning; see the answered column.';
comment on column dex_token_security.chain_family is
  'Which response shape this row came from. Without it a NULL in buy_tax cannot be told apart from '
  '"this chain has no such concept", which is the difference between unknown and not applicable.';

create index dex_token_security_stage_idx on dex_token_security (at_stage, checked_at desc);

/*
 * DexScreener's reading of the same pools (§10: "pair details for each pool seen").
 *
 * A SEPARATE table rather than more columns on `dex_pools`, because it is a different venue's
 * answer at a different instant. Merging them would make "GeckoTerminal said the reserve was X"
 * and "DexScreener said the liquidity was Y" one row that implies a single observation, and when
 * they disagree — which is the interesting case — there would be nothing left to compare.
 *
 * ## Absence is a MISSING ROW, and here that is routine
 *
 * Measured 2026-10-12 against the live API, two occasions ~20 minutes apart: a batch of 20 pool
 * addresses taken straight from GeckoTerminal's `new_pools` came back with 19 and then 20 pairs on
 * Solana. A pool GeckoTerminal lists may simply not be known to DexScreener, so there is **no row**
 * for it — not a row of zeros, and not a row of nulls either, since we were never told anything at
 * all about that pair.
 *
 * `liquidity` is absent from the pair object far more often than not on Solana (1 of 20, and 6 of
 * 19 on the earlier occasion; 19 of 20 both times on Base). It is the field §10 names first, so a
 * `coalesce(liquidity_usd, 0)` anywhere downstream would report most new Solana pools as having no
 * liquidity. Nullable, like everything else here.
 */
create table dex_pair_snapshots (
  -- '<network>_<address>', built the same way GeckoTerminal builds its pool id, so this joins to
  -- dex_pools.pool_id without a mapping table
  pool_id     text        not null,
  network     text        not null check (network in ('solana','base','bsc','eth')),
  address     text        not null,   -- as DexScreener spells it; see the casing note in dexscreener.ts
  observed_at timestamptz not null,

  dex            text,
  pair_created_at timestamptz,

  price_usd     numeric,
  price_native  numeric,
  liquidity_usd numeric,              -- absent on most new Solana pairs: see above
  fdv_usd       numeric,
  market_cap_usd numeric,

  volume_usd_m5  numeric,
  volume_usd_h1  numeric,
  volume_usd_h6  numeric,
  volume_usd_h24 numeric,

  txns_h1_buys  integer,
  txns_h1_sells integer,
  txns_h24_buys  integer,
  txns_h24_sells integer,

  price_change_pct_h1  numeric,
  price_change_pct_h24 numeric,

  raw jsonb not null,
  primary key (pool_id, observed_at),
  -- DexScreener is the venue that spells EVM addresses differently, so this is the column where a
  -- non-canonical value would actually have arrived; `raw` keeps the venue's own spelling
  constraint dex_pair_snapshots_canonical_address
    check (network = 'solana' or (address = lower(address) and pool_id = lower(pool_id)))
) partition by range (observed_at);

comment on table dex_pair_snapshots is
  'IB-028. DexScreener''s reading of a pool, one row per pool per poll. Separate from dex_pools '
  'because it is a different venue at a different instant, and their disagreement is the point. '
  'A pool DexScreener does not know has NO ROW — absence is not a row of zeros.';

comment on column dex_pair_snapshots.liquidity_usd is
  'ABSENT IS NOT ZERO, and absent is the common case: measured 2026-10-12, only 1 of 20 and 6 of '
  '19 new Solana pairs carried a liquidity object at all (19 of 20 on Base). A coalesce(…, 0) here '
  'would report most new Solana pools as having no liquidity. It is the field §10 names first.';
comment on column dex_pair_snapshots.address is
  'Canonical form: lower-case on EVM, verbatim on Solana. DexScreener sends EIP-55 checksummed '
  'addresses; its own spelling is kept in raw.';

create index dex_pair_snapshots_network_idx on dex_pair_snapshots (network, observed_at desc);

