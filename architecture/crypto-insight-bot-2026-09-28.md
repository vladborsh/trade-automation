# Crypto Insight Bot — settled brief (input for the Architect)

**Date:** 2026-09-28
**Status:** Requirements settled with the user in a full grilling pass (25
decisions) over the user's draft `crypto-insight-bot-architecture.md` v0.1
(kept outside the repo; the parts that survive are restated here). **Not a
system design.** This fixes *what* is built and every constraint the user has
ruled on, so the Architect can produce the system design and decompose it into
`tasks/insight-bot.jsonl` without re-litigating product questions.

**What the Architect still owns:** component boundaries, data model details,
module layout, the exact feature/playbook maths, sequencing, and the task
decomposition. Where this brief names a table or a module it is describing the
draft's intent, not prescribing the schema.

---

## 1. The product

A **Telegram bot plus a Node service** that watches crypto derivatives for
situations where part of the market is *forced* to act (liquidation cascades,
over-levered crowding, funding pressure, token unlocks, scheduled macro
events) and, when a pre-described **playbook** fires, sends a concrete trade
plan: direction, trigger, stop, targets, size, invalidation, plus the
playbook's honest track record. Silence is a normal outcome; the only
unconditional message is a short morning plan.

**Principles carried over from the draft, unchanged:**
1. Playbook first, data second — the bot checks pre-described mechanics, it
   does not mine data for meaning.
2. Deterministic core, AI at the edges. Direction, levels, size and the
   decision to signal are code. AI classifies news, phrases messages, checks
   for contradictions, answers chat. A signal is never blocked by an AI
   failure (template fallback).
3. Every signal is logged with a point-in-time feature snapshot and scored
   automatically (outcome in R, MFE/MAE, fees). Negative expectancy over the
   last 20 signals → the playbook drops to `SHADOW` automatically; back to
   `live` only by a human.
4. Attention budget: 0–3 trade alerts/day, dedupe, cooldown per
   (asset, playbook), BTC/ETH/SOL same-direction = one idea.
5. Data collection starts before any logic (§3).

**Audience (Q1, Q13):** the user (admin) and a small group of companions,
admitted by **single-use invite deep links** (`/invite` →
`t.me/<bot>?start=<code>`). Signals go to each member's **private chat** with
the bot. Per user: deposit, risk %, language, `[Taken]/[Skipped]` actions,
daily loss limit, personal stats. Shared: the signal itself and its objective
outcome (tracker). The bot has its own `users` in its own database; reuse the
backtest app's invite *approach*, not its web-session tables.

**Execution (Q14):** stage 4 (button → order with SL/TP on Binance, later auto)
is for the **admin's own account only**. Companions only ever receive
signals; the service never holds anyone else's trade keys.

**DEX contour P9 (Q16):** informational alerts only, opt-in per user,
default off, labelled as a lottery with a fixed size (≤0.5 % of deposit).

**Language (Q23):** bot messages in **plain Russian** (per the `PROJECT.md`
user-facing rule — no unexplained jargon). Commands, playbook codes (`P1`…),
tickers, and all log/DB fields in English. Language is a per-user setting,
`ru` by default.

**Admin surface (Q24):** no web admin in stages 0–2. Admin bot commands:
`/invite`, `/users`, `/playbook <P#> shadow|live|off`, `/stats`, `/health`.
Thresholds live in a versioned `playbook_config`; changed by migration or by
an admin command that bumps the version (a version change resets that
version's live stats). A dashboard in `apps/chart-client` is a stage-3 task,
only if commands become cramped.

**Not in scope:** `cmc-bot-main` stays untouched (Q25) — this is a separate
product; nothing is migrated from it.

---

## 2. Facts established by a repository inventory (2026-09-28)

**Reusable**
- `apps/signal-server` (NestJS 10, pino, zod, pg + postgrator, prom-client):
  Binance USD-M WS `kline_1m`, REST backfill and gap repair, native
  5m…1d fetch (`src/market-data/binance/`); OI via `openInterestHist` + 60 s
  poll of `/fapi/v1/openInterest`; ForexFactory calendar module
  (`src/calendar/`, poll/diff/actuals backfill/notifications).
- `libs/contracts` — zod schemas; `MetricKindSchema` is `['openInterest']`
  with an "extensible" comment.
- Postgres 16 (`apps/signal-server/docker-compose.yml`), one DB per slot.

**Missing — the new app must add it**
- Binance **spot**, **Bybit**, **OKX**: none ingested.
- Taker buy volume: present in the raw kline row (`binance.mapper.ts` l.14–15)
  but **not mapped** into `Candle`.
- Funding rate / predicted funding, long/short ratios, liquidations
  (`forceOrder`): none ingested.
- No Redis/BullMQ, no cron library (loops are `setInterval`), no Telegram.
- Nothing is hosted: `architecture/live-signal-server-infra.md` pins ECS
  Fargate but nothing is provisioned.

**Prior research that constrains the playbooks** (see §5)
- `research/funding-rate-signals/REPORT.md`: all four arms killed on the fit
  period (mean netR −0.129R … +0.085R).
- deriv-positioning (OI, top-trader L/S, taker ratio; fit 2022-08 → 2025-04):
  crowding-squeeze arm **significantly negative** (−58.4 bp at 24 h,
  t = −4.56); taker-imbalance continuation −19.8 bp (t = −2.86); OI-tercile
  conditioning dominated by its price shadow. `IDEAS-BACKLOG.md`: "The squeeze
  shape is now closed on both sensors."
- **Never researched:** liquidation-feed signals; spot-vs-perp CVD
  (the "spot-lead confirmation" arm (b) of the *Spot–perp basis* entry in
  `IDEAS-BACKLOG.md` is parked, undispatched).
- Scheduled-macro reaction: downgraded to a fit-only probe (post-release
  continuation absent after bar 5 on MNQ; BTC reaction contemporaneous).
- Ruling in `research/_surveys/2026-09-lightgbm-role.md` §3.2: **no standalone
  regime classifier**; conditioning on context is legitimate only as a
  pre-registered rule on one mechanistically motivated observable, tested as
  an arm against the unconditional version with a price shadow.
- OI / L-S history: REST gives ~30 days, but `data.binance.vision` daily
  `metrics` archives gave ~4 years (1,461/1,461 days, 8 symbols). **Truly
  unrecoverable later:** liquidations, predicted funding, Bybit/OKX
  equivalents.

---

## 3. Data collection — starts immediately (Q3, Q6)

**Collect wide, trade narrow.** Collectors cover the top-30 USD-M perps by
volume (static list in config, revised by hand monthly); stage-1 signals are
BTC/ETH/SOL only.

First cluster, priority above any new backtest-app work (Q15/Q19):
- liquidations over WS: Binance `!forceOrder@arr`, Bybit, OKX (Binance
  snapshots ≤1 event/s/symbol — undercount accepted and documented);
- `markPrice` stream: mark price + predicted funding; settled funding
  history (REST, three venues);
- 1m candles **spot and perp** with taker buy volume (spot/perp CVD);
- OI and L/S (global account, top position, taker) at 5 m, forward; history
  back-filled from `data.binance.vision` `metrics` archives;
- ForexFactory calendar (reuse the signal-server module's logic).

Operational: reconnect with backoff, heartbeat, gap detection with REST
backfill, alert to a service Telegram chat when a stream is down > N min.
Stage-0 exit criterion from the draft: two weeks of continuous data without
holes. Any polling loop states its Binance weight/min (budget 2400, we use
~1 %); streams over WS carry no REST weight.

Data of later stages (news + price reactions for AI-1 calibration, DEX pool
snapshots for P9) also starts collecting as soon as it is reached in the
backlog, **ungated** (Q22).

---

## 4. Platform (Q8–Q11, Q20)

- **Code:** `apps/insight-bot` in this monorepo, NestJS 10. Code shared with
  signal-server (Binance REST/WS client, backfill, gap repair) is extracted
  into `libs/` by **mechanical** tasks; both apps import it. signal-server
  keeps its own ingestion — a second WS connection costs nothing.
- **Storage:** plain Postgres 16, database `insight` (per slot:
  `insight_coord`, `insight_dev1…3`, `insight_tester`), native monthly
  partitions on time series, postgrator migrations. No TimescaleDB for now;
  moving to it later is a superset, not a rewrite. Candles for this app live
  in SQL (features and the tracker need them), not in the file/S3 store.
  Expected volume ≈ 50–70 M rows/year.
- **No Redis/BullMQ in stages 0–1.** Loops like signal-server. Signal
  idempotency key (`playbook, symbol, trigger_ts`), cooldowns and alert budget
  are unique keys / TTL columns in Postgres. Redis may arrive in stage 2 if
  AI calls need a queue.
- **Hosting:** one EC2 `t4g.small` in `ap-northeast-1` (Tokyo — Binance
  refuses US IPs), docker compose (Postgres + insight-bot), daily `pg_dump`
  to S3, secrets outside the image. AWS per `PROJECT.md`; a later move to
  Fargate/RDS is a dump-and-restore. This is the DevOps task in the first
  cluster.
- **Slots:** insight-bot port `:30x5` (coord `:3005`, dev-1 `:3015`, dev-2
  `:3025`, dev-3 `:3035`, tester `:3045`); a separate test Telegram bot per
  slot, token in the slot's `.env`; one production bot. `AGENTS.md` port
  table to be extended accordingly.
- **Telegram library:** grammY (the draft's choice).

---

## 5. Playbooks and the research gate (Q4, Q5, Q12)

**Hybrid validation.** History first where the data exists, live `SHADOW`
where it does not. The draft's "n ≥ 30 live" success bar is replaced by a
historical pass under the project's usual protocol (fit/holdout, costs and
funding in P&L, baseline and price shadow) plus 4+ weeks of live `SHADOW`
not contradicting it in sign.

| # | Playbook | Role | Gate before engineering | Trigger TF |
|---|---|---|---|---|
| P1 | Long squeeze | entry (short) | **Researcher gate**: full draft form (funding p90 on ≥2 venues, OI +5 %/24 h at 7-day high, ≥2 failed highs, spot CVD not confirming, 15m/4h structure break) on 2020+ history. The simpler shape is already significantly negative; build only if the extra filters demonstrably rescue it. | 4h, 1–5 day hold |
| P2 | Short squeeze | entry (long) | **Researcher gate**, same as P1 (mirror) | 4h, 1–5 day hold |
| P3 | Post-cascade reversal | entry | none; history only exists live → build, run in `SHADOW`, validate on collected data. Mandatory news veto once P10 exists. | 15m |
| P4 | Spot vs perp CVD label | filter (`SPOT_LED`/`PERP_LED`/`ABSORPTION`/`DISTRIBUTION`) | Researcher pass on 2020+ spot+perp klines (= dispatch parked arm (b) of the *Spot–perp basis* backlog entry); the engineering of the label is not blocked by it | per consumer |
| P5 | Macro event | **veto only** (`EVENT_RISK` ±60 min) | none; the trading half stays out (see §2) | — |
| P6 | Token unlocks | entry (short alts) | Researcher pass when reached (stage 2) | 4h, 1–5 day hold |
| P7 | Stablecoin liquidity | bias | stage 2 | — |
| P8 | Hyperliquid whales | targets / info | stage 3, experimental | — |
| P9 | DEX survivors | info alerts only, opt-in | stage 2, last | — |
| P10 | News shock | veto / urgent alert | stage 2 | — |

**Timeframe is per playbook (Q5):** the feature pipeline computes on both the
15m and the 4h close.

**Regime:** the draft's regime classifier must respect the 2026-09
**no-standalone-regime-classifier** ruling. Regime axes (trend, vol,
leverage, event window) may be computed and shown as context, but any use as
a gate inside a playbook is a pre-registered single-observable rule, tested
as an arm against the unconditional version. The Architect decides the exact
shape.

---

## 6. Stages and what gates what (Q2, Q22)

Everything goes into the backlog in order; nothing is dropped. **Collection
is ungated; consumers are gated.**

| Stage | Content | Gate |
|---|---|---|
| 0 | collectors, EC2, gap monitoring | none — start now |
| 1 | features, regime context, P3, P4 label, P5 veto, P1/P2 behind research gate, alert gate, **template messages without AI**, `signal_log`, tracker, buttons, invites, admin commands | none for engineering; playbooks go `live` only after their validation |
| 2 | news pipeline + AI-1 classifier, AI-2 composer + validator, AI-4 morning plan, P10, P7, P6, P9 | news/DEX **collection** ungated; AI composer and morning plan **gated**: ≥1 playbook passed history and 4+ weeks `SHADOW` agreeing in sign |
| 3 | chat agent AI-5, weekly review AI-6, backtest runner on the live playbook code, Coinbase premium, P8, paid sources if earned | same gate as stage-2 consumers |
| 4 | semi-auto execution (admin account only), then auto | n ≥ 50 and positive expectancy after costs per playbook; risk limits and kill-switch inside the execution service |

## 7. AI (Q21)

Anthropic only:
- **AI-1 news classifier:** `claude-haiku-4-5-20251001`.
- **AI-2 composer and AI-4 morning plan:** `claude-sonnet-5`.
- **AI-5 chat agent and AI-6 weekly review:** `claude-opus-5-5`.

The draft's structured-output, validator, stop-list and template-fallback
rules stand. News semantic dedupe uses `pg_trgm` title similarity in the same
Postgres; there is no embedding provider. **Budget cap $0.7/day**, with an
alert to the service chat when it is exceeded. The chat agent cannot place
orders.

## 8. Process (Q7, Q17–Q19)

- **Task files per stream:** `tasks/<stream>.jsonl`. The existing
  `tasks.jsonl` moves to `tasks/backtest-app.jsonl` in one mechanical commit
  that also updates every reference (`PROJECT.md`, `agents/roles/architect.md`,
  `tech-lead.md`, `tester.md`, `software-engineer.md`,
  `integration-engineer.md`, `devops-engineer.md`). The row schema is
  unchanged. This stream's file is `tasks/insight-bot.jsonl`.
- **Ids:** `IB-001`, `IB-BUG-001` for this stream. The backtest app keeps
  `T-`/`BUG-`; its history is not rewritten.
- **One Tech Lead, shared dev pool** (dev-1…3, tester). P0 (red `master`) is
  global across streams. The insight-bot collectors + hosting cluster ranks
  above any *new* backtest-app work. In-flight T-026/T-033 finish first.
- Flow: Architect → system design + `tasks/insight-bot.jsonl` → Tech Lead
  dispatches. Research-gate tasks (P1/P2 full form, P4 spot-lead) go to the
  Researcher through the research contour as usual.
