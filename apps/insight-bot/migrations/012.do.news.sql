-- IB-027 — stage-2 news ingest (architecture/insight-bot-system-design.md §10).
--
-- Migration 012, and this number has moved twice in one day. Written as 009; renumbered to 011 on
-- 2026-10-12 when 009 (`symbols-coingecko-id`) and 010 (`collector-heartbeats`) were found taken;
-- renumbered again to 012 hours later because dev-2's unmerged `ib-feature-frame` already holds
-- 011. Master's highest was 010, so two branches independently read 011 as free.
--
-- **Git will never show you this.** Two new files with different names merge without a conflict, so
-- the working tree is the only place a duplicate version is visible — and only once both branches
-- are in it. Postgrator then refuses to run AT ALL, failing every database suite rather than the
-- clashing pair; that cost 6 suites / 52 tests in IB-036.
--
-- So picking a number with `ls migrations` is not enough: it shows one branch. Check every ref,
-- including unmerged ones. `test/db/migration-versions.spec.ts` now fails the build on a duplicate,
-- which turns the next occurrence into a red test at merge time instead of a silent refusal at boot.
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
 *
 * **A member must match the cluster's REPRESENTATIVE** (`first_news_id`'s title), not merely some
 * existing member. Matching any member makes a cluster the transitive closure of pairwise
 * similarity: A~B, B~C, and A and C unrelated collapses two stories into one blob, and once merged
 * nothing records that it was wrong. The representative rule bounds the cluster — every member is
 * within the threshold of one fixed title — at the cost of occasionally splitting a story whose
 * wording drifted, which is the failure that stays visible.
 *
 * **Consequence: cluster identity depends on ARRIVAL order, and a replay is NOT expected to
 * reproduce it.** Because the representative is whichever telling was ingested first, the property
 * is precisely:
 *
 *   - *within one pass* — deterministic: items are ordered by `published_at` before planning, so
 *     the earliest telling founds the cluster (ties keep input order, which is source order);
 *   - *across passes* — the representative is the first INGESTED, not the earliest PUBLISHED. A
 *     story whose earliest telling arrives in a later poll joins the existing cluster instead of
 *     founding one, and cannot retroactively become the representative.
 *
 * So a backfill that reads the same sources in one pass will systematically differ from what live
 * polling built: same `raw_news`, different cluster composition. The divergence is systematic, not
 * random, which makes it easy to mistake for a change in the news rather than in the order.
 *
 * **What is reproducible:** `raw_news` — `id` is `<source>:<url_hash>` over a normalised URL, so
 * the same inputs always produce the same rows. **What is not:** `news_clusters` and
 * `news_cluster_members`. Do not compare cluster composition between two runs and read a
 * difference as signal. If reproducible clusters are ever needed, the answer is to re-derive them
 * from `raw_news` in `published_at` order as a batch, not to tighten the live path — that is a
 * deliberate decision not taken here, because live polling has no ordering to preserve.
 *
 * ---
 *
 * **READ THIS BEFORE WRITING ANY RETENTION POLICY FOR `raw_news`.**
 *
 * The line above makes `raw_news` the system of record for clustering: clusters are derived data
 * and the articles are the only thing they can be derived FROM. Deleting old articles to save
 * space therefore costs more than the rows deleted, in two ways, and the second is immediate:
 *
 * 1. **Re-derivation becomes impossible.** Once an article is gone, no batch can rebuild the
 *    cluster it belonged to. The ability named above quietly stops existing.
 * 2. **Deleting a representative is REFUSED, by the schema.** `news_clusters.first_news_id` is
 *    `on delete restrict`. It was `cascade`, which meant deleting a cluster's representative
 *    deleted the cluster row and cascaded again to `news_cluster_members` — a cluster whose first
 *    telling is old but whose other members are recent lost its identity and its `confirmations`,
 *    and the survivors were stranded: still in `raw_news`, in no cluster, and never re-clustered
 *    because they are not new. A comment asking people not to do that is prose they may not read;
 *    RESTRICT fails the delete at the moment it is attempted and forces the choice. If it blocks a
 *    single-article delete you actually want, that is correct — re-point or drop the cluster first.
 *
 *    Note that `news_assets` and `news_reactions` still cascade with their article, deliberately:
 *    they are *about* that article and mean nothing without it, unlike a cluster, which is about a
 *    story and outlives any one telling of it.
 *
 * None of these tables is partitioned (unlike `candles_1m` and friends), so retention here would be
 * a `DELETE`, not a partition drop — there is no cheap "drop the old month" and no version of it
 * that avoids the cascades above.
 *
 * If space genuinely becomes the problem, the options that do not destroy the record are: drop
 * `body` while keeping the row, or archive whole articles out to S3 before deleting. Deleting
 * `raw_news` rows in place is not a space optimisation, it is a decision to lose the news history
 * and every cluster that touches it. Bring it to the Tech Lead.
 *
 * **`confirmations` counts DISTINCT SOURCES, not member rows**, and `of_sources` carries what it is
 * counted out of. One chatty outlet publishing an RSS copy and an API copy is two members and one
 * confirmation; counting rows would make it look like corroboration, which is a venue count without
 * its denominator. Both are recomputed from the rows on every write, never incremented: an
 * incremented counter drifts from the thing it counts the moment a write is skipped.
 */
create table news_clusters (
  id            bigserial primary key,
  -- RESTRICT, not CASCADE: see the retention warning above. Deleting a cluster's representative
  -- would delete the cluster and its memberships, stranding articles that still exist. This turns
  -- that into a loud failure at the moment it is attempted, so whoever wrote the delete must pick
  -- a non-destructive option instead of discovering the loss later. A legitimate single-article
  -- delete is still possible — re-point or remove the cluster first, deliberately.
  first_news_id text not null references raw_news (id) on delete restrict,
  confirmations int not null default 1,     -- distinct sources carrying this story
  of_sources    int not null default 0,     -- sources being polled when it was last updated
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
/*
 * IB-027 — the dictionary prefilter's candidate symbols. Candidates, not a classification: AI-1
 * decides later.
 *
 * **Every tag records WHY.** `via` is the rule that fired and `matched` is the text that fired it,
 * because this feeds `news_reactions` — a false tag becomes a price move attributed to a story that
 * never mentioned the asset, and when a reaction looks spurious the only way to tell whether the
 * matcher or the market was wrong is to know what tagged it.
 *
 * The three rules, strongest first:
 *   - `cashtag`  — `$BTC`. Unambiguous by construction; nobody writes `$NEAR` meaning "near".
 *   - `name`     — `bitcoin`, `bitcoin cash`. Matched LONGEST FIRST and claiming its span, because
 *                  "Bitcoin Cash" contains "bitcoin" and every BCH story was tagging BTC.
 *   - `ticker`   — a bare upper-case `BTC`, and only for tickers that are not also ordinary words.
 *
 * **Ambiguous terms, and the basis for the judgement** (`AMBIGUOUS_TERMS` in `news/assets.ts`): a
 * term is ambiguous when it is an ordinary English word, a common abbreviation, or a proper noun
 * that appears in news unrelated to the token. In the current universe that is ONE, NEAR, LINK,
 * ARB, DASH, HYPE, PUMP, UNI, SOL, TAO, ENA, FIL — plus TRUMP, a surname in political coverage
 * several times a day. It applies to NAMES as well as tickers: NEAR's coingecko id is literally
 * `near`, and ONE's is `harmony`. An ambiguous term never tags on the bare form; it needs a
 * cashtag. The list FAILS OPEN — a word-like ticker missing from it tags prose — so it is reviewed
 * whenever `universe.yaml` is revised, which is monthly and by hand.
 */
create table news_assets (
  news_id text not null references raw_news (id) on delete cascade,
  symbol  text not null,                  -- universe.yaml id, e.g. BTCUSDT
  via     text not null check (via in ('cashtag', 'name', 'ticker')),
  matched text not null,                  -- the text that fired the rule
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
