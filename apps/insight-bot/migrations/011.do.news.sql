-- IB-027 — stage-2 news ingest (architecture/insight-bot-system-design.md §10).
--
-- Migration 011. It was written as 009 and renumbered on 2026-10-12: while this branch sat idle,
-- 009 was taken by `symbols-coingecko-id` and 010 by `collector-heartbeats`. **Git did not
-- complain** — two new files with different names merge cleanly — so the rebase was silent and
-- only `ls migrations` showed two 009s. Two migrations sharing a version makes postgrator refuse
-- to run AT ALL, failing every DB suite rather than just the clashing pair; it cost 6 suites /
-- 52 tests during IB-036, and this is the same trap one branch later. Check every ref, not just
-- the obvious branches, before taking a number.
--
-- **Collection window.** Unlike `market_cap_global`, which has no history endpoint at all, the
-- news feeds are a ROLLING window: measured 2026-09-28, the crypto sources carry roughly three
-- to four days (cointelegraph 30 items / 73.7 h, decrypt 36 / 96.0 h, theblock 20 / 80.2 h),
-- while SEC and CFTC reach back weeks because they publish rarely. So a short outage or a
-- restart costs nothing — the next poll re-reads the same items and the dedupe collapses them —
-- and only a gap longer than the window loses anything. The retry and alerting thresholds
-- downstream are set from that, deliberately far slacker than a venue socket's.

create extension if not exists pg_trgm;

create table raw_news (
  id           text primary key,          -- source-scoped: '<source>:<url_hash>'
  source       text not null,
  url          text not null,
  title        text not null,
  body         text,
  published_at timestamptz not null,      -- the source's own stamp, never our clock (§3.1)
  fetched_at   timestamptz not null default now(),
  -- Exact dedupe. Both are sha256 hex of the NORMALISED value, so a tracking parameter or a
  -- capitalisation change does not create a second row (see `normalise.ts`).
  url_hash     text not null,
  title_hash   text not null
);

comment on table raw_news is
  'IB-027. One row per article as published. `published_at` is the source''s stamp; `fetched_at` '
  'is ours, and the two differ by the poll interval plus the feed''s own lag — keep both, since '
  'only the first is usable for a reaction window.';

-- Exact dedupe: the same article re-read on the next poll, or syndicated to a second URL.
create unique index raw_news_url_hash_idx on raw_news (source, url_hash);
create index raw_news_title_hash_idx on raw_news (title_hash);
-- The reaction job and the 24 h clustering window both scan by time.
create index raw_news_published_idx on raw_news (published_at desc);
-- Trigram similarity over normalised titles, for the near-duplicate clustering below.
create index raw_news_title_trgm_idx on raw_news using gin (title gin_trgm_ops);

/*
 * Near-duplicate clustering: the same story from several outlets inside 24 h. `confirmations` is
 * how many sources carried it, which is the signal — one outlet is a report, five is an event.
 */
create table news_clusters (
  id            bigserial primary key,
  first_news_id text not null references raw_news (id) on delete cascade,
  confirmations int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table news_cluster_members (
  cluster_id bigint not null references news_clusters (id) on delete cascade,
  news_id    text not null references raw_news (id) on delete cascade,
  similarity real,                        -- trigram similarity to the cluster's first title
  primary key (cluster_id, news_id)
);

create index news_cluster_members_news_idx on news_cluster_members (news_id);

/*
 * The dictionary prefilter's output: which universe assets an article plausibly concerns. A
 * candidate is a guess from a ticker or name match, NOT a claim about relevance — no AI runs in
 * this task, and nothing here feeds a playbook.
 */
create table news_assets (
  news_id text not null references raw_news (id) on delete cascade,
  symbol  text not null,                  -- universe.yaml id, e.g. BTCUSDT
  matched text not null,                  -- what actually matched: the ticker, the name, an address
  primary key (news_id, symbol)
);

/*
 * Price reaction after an article, filled by a job once the bars exist. Null is "not computable
 * yet or not available" and never zero: a return of 0 % is a real measurement and must not be
 * confusable with a missing bar (§2.3's rule).
 */
create table news_reactions (
  news_id    text not null references raw_news (id) on delete cascade,
  symbol     text not null,
  horizon    text not null check (horizon in ('15m','1h','4h')),
  return_pct double precision,
  computed_at timestamptz not null default now(),
  primary key (news_id, symbol, horizon)
);

create index news_reactions_symbol_idx on news_reactions (symbol, horizon);
