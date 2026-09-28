# Trade Automation

## Mission

Build and operate a portfolio of algorithmic trading strategies and supporting
automations, spanning:

- **Chart-driven strategies** — decisions based purely on price/volume/indicator data.
- **News-driven strategies** — shallow analysis of news/headlines feeding into signals.
- **Intraday signal generators** — automations that produce intraday trading signals.
- **Analytics/reporting automations** — summarize signals, performance, and system
  health into high-level overviews for a human to consume.

Not every strategy needs every capability above — a chart-only strategy has no news
component, a pure summarizer never places a trade. The team and its workflow are
built to route each idea through only the roles it actually needs.

## Domain scope

- **Asset classes**: crypto and equities to start. Other asset classes (forex,
  futures, options) may be added later once the crypto/equities pipeline is proven.
- **Timeframe**: intraday-first. Swing/longer-horizon strategies are a possible
  future expansion, not a current requirement.

### User rulings, 2026-09-16 (in response to `research/_surveys/2026-09-red-team.md` §8 items 5 and 6)

The red team established that this project's binding constraint is **statistical
power, not cost or mechanic**: a one-year holdout of ~220 trades on one
instrument can only certify an annualised Sharpe of roughly 2+, while the best
published single-instrument intraday mechanics sit at 0.87–1.73. Two scope
questions followed from that and were put to the user. Both are now decided and
are binding on every future design until the user revises them.

1. **Paid index history: NO.** The user declined the ~$100 CME/FirstRate ES
   minute tape (2008+). Consequence, accepted knowingly: **the single-instrument
   index line (US100/US500 on the Capital.com 2024-01+ tape) is closed** — not
   because its mechanics are disproven, but because on 2.6 years of tape it
   cannot produce a certifiable result for *any* honestly-sized edge. Do not
   register a new single-instrument index family without first reopening this
   decision. Index tapes remain in use for *engine calibration* (the
   `_calibration` package) and as descriptive/control rows, which is unaffected.
2. **Horizon: opened to 1–5 days.** The "intraday only" framing is **no longer a
   hard constraint** — the user is willing to consider multi-day holds. This
   matters mechanically, not cosmetically: cost is roughly fixed per round trip
   while the move scales with horizon, so a 0.15R cost at an intraday stop
   becomes ≈0.05R at a 3× wider multi-day stop, and on the 2020+ crypto tape a
   longer horizon also supplies the sample size intraday lacks. Intraday remains
   welcome; it is no longer mandatory, and a design that chooses intraday should
   now say *why* rather than assume it.

**Net effect on where work goes:** crypto, where history is free to 2020 and the
universe is 400+ instruments, is now the primary tape; horizon is a free design
variable. The two families in flight (cross-sectional instruments-in-play;
funding-rate signals) are both already crypto and both unaffected.

## Infrastructure

- Hosting and runtime infrastructure **must be built on AWS**. Specific services
  (compute, storage, messaging, etc.) are not pinned yet — that's owned by the
  DevOps Engineer role.
- Persistent storage is a hard requirement for market data, generated signals, and
  backtest results. No specific storage technology is chosen yet.

## Team model

This project uses **Orca ADE** to run the team: each role is a separate agent
session working in its own isolated git worktree, not a single session dispatching
sub-agents. Because of that, every role is defined as a **self-contained brief**
under `agents/roles/*.md` — each brief carries everything that role needs to work
cold, including who it hands its output to next.

The team is split into two contours, and nobody works in both.

**The research contour — the Architect's.** An idea arrives, gets logged to
`IDEAS-BACKLOG.md`, and the Architect decides what it needs: a Researcher pass,
a Backtesting re-validation, or neither. There is no fixed pipeline here — a
chart-only strategy may never touch news analysis. The contour ends when the
Architect decomposes an approved design into tasks in `tasks.jsonl`.

**The delivery contour — the Tech Lead's.** Everything downstream of that
decomposition: Software Engineer (2–3 standing slots), Tester, Integration
Engineer, DevOps Engineer. The Tech Lead takes tasks off the backlog, assigns
them, reviews every diff, and approves every merge. The Architect is pulled back
in for exactly two things: a decision that changes a contract between components
or adds/removes a component, and the architectural confirmation of a finished
cluster.

**Dispatch is the Tech Lead's monopoly.** The Architect previously held a
"direct dispatch authority" to start Software Engineer workers itself for
trivial work; that is withdrawn. The Tech Lead's merge and acceptance calls are
only sound if `tasks.jsonl` is the complete truth about who is building what, so
there is no bypass, however small the task. Urgency is expressed as priority in
the backlog, not as a side channel.

### How a cluster gets accepted

The Tech Lead tags related tasks with a shared `cluster` **when scheduling
them**, not retroactively. When the last task of a cluster is merged:

1. **Tester first** — exercises the cluster, files bugs as bug tasks in
   `tasks.jsonl` (status `new`, unassigned) linked via `source_task`.
2. Bugs are assigned by the Tech Lead above ordinary work; the cluster goes back
   through the Tester until green.
3. **Architect last** — confirms the merged, tested implementation matches the
   intended architecture.

Tester before Architect is deliberate: an architectural review of broken code is
thrown-away work, and the Architect (Fable 5) is the most expensive seat in the
chain — it gets called once, on green.

### Merging

Branches are local to the repository and visible from every worktree, so review
needs no remote and no pull request: the Tech Lead reads
`git diff master..<branch>` from the coordinator's checkout. Consequences, binding
on everyone who writes product code:

- **Commit before requesting review.** Uncommitted work is invisible to the
  reviewer and is sent back unread.
- **The author merges, not the reviewer.** The Tech Lead approves; the developer
  merges.
- **Rebase onto current `master` and get a green run before merging.** If the
  rebase changed the code, the approval is void and needs a second look.
- **A red `master` outranks every task in the backlog**, and is fixed by whoever
  merged last.
- **Two rejections are the ceiling** on one task. A third round is forbidden:
  the Tech Lead either returns the task to the Architect as badly specified or
  splits it into sub-tasks.
- After a merge the branch is deleted; the worktree stays — developer slots are
  standing sessions, not per-task checkouts.

The Tester is the one exception to review: e2e tests are merged by the Tester
without review, and in exchange the Tester owns suite health and fixes or
deletes flaky tests the day they appear. The rebase-and-green rule still applies.

## Roles

| Role | Model | Charter |
|---|---|---|
| [Researcher](agents/roles/researcher.md) | Opus 5 | Explores a raw idea: historical data, exploratory/protocol-driven analytics, feasibility, pros/cons, documentation. |
| [Architect](agents/roles/architect.md) | Claude Fable 5 | Entry point for ideas and designer of the system. Designs the approach, judges results (ship/rework/kill), decomposes approved designs into `tasks.jsonl`, and confirms finished clusters against the architecture. Owns the research contour. |
| [Tech Lead](agents/roles/tech-lead.md) | Opus 5 | Owns the delivery contour. Schedules tasks out of `tasks.jsonl`, assigns developers, reviews every diff, approves every merge, and runs the cluster acceptance gate. Does not implement. |
| [Software Engineer](agents/roles/software-engineer.md) | Sonnet 5 | Builds the strategy/automation logic, one backlog task at a time. 2–3 standing slots. |
| [Tester](agents/roles/tester.md) | Sonnet 5 | Tests the API and writes e2e tests for critical flows only; files bugs into the backlog. Never touches production code; talks only to the Tech Lead. |
| [Backtesting](agents/roles/backtesting.md) | Sonnet 5 | Independently re-validates *implemented, shipped* strategy code against historical data — distinct from the Researcher's protocol-driven validation of the idea itself. |
| [Integration Engineer](agents/roles/integration-engineer.md) | Sonnet 5 | Turns a shipped strategy into deployable rules (position-sizing, execution logic) and builds/runs the real-time pipeline that emits live signals from them — absorbed the former Strategy-Application role. |
| [DevOps Engineer](agents/roles/devops-engineer.md) | Sonnet 5 | Owns hosting and data storage on AWS. |

Models are defaults, not hard requirements — swap per-role if a specific idea's
complexity or budget calls for it.

## Communicating with the user

Anything written **for the user to read directly** — a presentation/artifact,
a RUNBOOK.md, a summary handed up a chain of Architects back to them, chart
captions — is not the same audience as `REPORT.md`/`HANDOFF.md` (those are
role-to-role, technical detail is the point). For user-facing material:

- **Plain language, in Russian.** Explain what a chart shows and what a
  number means in terms a trader who is not a statistician already
  understands — not "the uncontaminated comparison" or "the most
  decision-relevant number," just what it is and why it matters for a trade.
- **No unexplained statistics jargon.** If a statistical term is genuinely
  necessary (t-stat, percentile, CDF, confidence), define it inline in one
  plain sentence the first time it's used on that page — don't assume the
  reader already knows what a permutation null or a p90 is. Every paragraph
  and every chart should be understandable standalone, without needing to
  have read the underlying `REPORT.md`.
- This is not "dumb it down" — the numbers and the honesty (caveats,
  descriptive-vs-tested, what a proxy metric isn't) stay exactly as rigorous.
  Only the vocabulary changes.

## Task backlog

The **delivery queue** is **one `.jsonl` file per stream** — one JSON object
per line, one line per task. Streams today: the manual backtesting app (ids
`T-`/`BUG-`) in **`tasks.jsonl` at the repo root** — its move to
`tasks/backtest-app.jsonl` is decided (brief
`architecture/crypto-insight-bot-2026-09-28.md` §8) and **pending** as one
mechanical commit; until it lands the root file is the backtest stream's
queue — and the crypto insight bot (ids `IB-`/`IB-BUG-`) in
**`tasks/insight-bot.jsonl`**. A new stream gets a new file under `tasks/` and
its own id prefix; the row schema below is the same in every file. One Tech Lead schedules across all files with one shared
developer pool; `P0` (red `master`) is global across streams. The queue is
deliberately machine-readable rather than prose — the Tech Lead answers "what
is unblocked", "who is busy", "what depends on this" many times a day, and
`IDEAS-BACKLOG.md` already shows where a 100 KB prose log ends up. Keep it
distinct from `IDEAS-BACKLOG.md`, which holds *ideas* upstream of any design.

**Two writers, split by field — never by line.** The Architect owns `title`,
`description`, `depends_on`. The Tech Lead owns `priority`, `assignee`,
`status`, `branch`, `cluster`. The Tester writes whole new bug lines
(`status: "new"`, `assignee: null`) and nothing else.

| Field | Owner | Meaning |
|---|---|---|
| `id` | creator | Stream prefix + number: `T-017` / `BUG-004` (backtest app), `IB-012` / `IB-BUG-001` (insight bot). Never reused. |
| `title` | Architect | One line, imperative. |
| `description` | Architect | What to build and what "done" means. For a bug: reproduction steps. |
| `depends_on` | Architect | Task ids that must be `merged` before this can start. `[]` if none. |
| `cluster` | Tech Lead | Shared tag for tasks that are only meaningful to verify together. Set when scheduling. |
| `priority` | Tech Lead | `P0` (red master / blocking bug) · `P1` · `P2`. |
| `assignee` | Tech Lead | `dev-1` … `dev-3`, `tester`, `integration`, `devops`, or `null`. |
| `status` | Tech Lead | `new` → `assigned` → `in_review` → `approved` → `merged`; also `blocked`. |
| `branch` | Tech Lead | Branch the assignee works on. |
| `rejections` | Tech Lead | Review rejections so far. At `2` the task cannot be sent back a third time. |
| `source_task` | Tester | Bug tasks only: the task whose merge introduced the bug. |
| `created_by`, `created_at` | creator | Role name and ISO date. |

Example line:

```json
{"id":"T-017","title":"Expose VWAP bands over the signal API","description":"Add GET /api/vwap/bands returning the current band set per instrument. Done when the endpoint serves live values and is covered by unit tests.","depends_on":["T-015"],"cluster":"vwap-api","priority":"P1","assignee":"dev-2","status":"in_review","branch":"vwap-bands-api","rejections":0,"created_by":"architect","created_at":"2026-09-21"}
```

## Logging conventions

Two append-only logs at the repo root track the team's work; a role skipping
either one is a process gap, not a shortcut. (`tasks.jsonl` is not one of them —
it is a live queue, not a log, and is described under "Task backlog" above.)

- **`IDEAS-BACKLOG.md`** — every trading idea, logged **before** it is
  dispatched to Researcher, whether raw or already grilled/designed. Each
  entry: Status, Idea, relevant framing (instrument/risk/data), open
  questions. The Architect reads this at each decision gate to decide
  whether/when to route an entry, rather than treating backlog entries as
  pre-committed work.
- **`RESEARCH-LOG.md`** — one numbered "Запись N" per completed Researcher (or
  Architect) pass, **regardless of outcome** — a kill is as much a result as a
  ship. Chronological, project-wide (not per-package). Each entry: Дата,
  Статус, **1. Идея**, **2. Исследование** (who/method/link to the package's
  REPORT.md), **3. Результат** (bulleted findings). Old entries are never
  rewritten; a changed verdict gets a new status line or a follow-up entry.
- Individual research packages under `research/<package>/` additionally carry
  their own `HANDOFF.md` (Researcher → Architect routing note) — see existing
  packages for the format. That's package-scoped detail; the two root logs
  are the durable, project-wide record and must stay in sync with what
  actually happened (update backlog status alongside logging a result, not
  just the log).

## Knowledge base

Durable domain concepts — market mechanisms, indicator definitions, jargon
this team will reference across multiple ideas/packages — live under
`knowledge/*.md`, one file per concept area, not scattered across chat
history or buried in a single research package's README. Write one when a
grilling session or design pass establishes a concept (e.g. how a specific
pivot/structure/liquidity indicator is defined) that later work will need to
recall precisely. Update in place as understanding sharpens; these are
reference documents, not a log — no dated entries, just the current best
understanding, with pointers to the research package(s) that established or
tested it. Embed/point to real chart images from the research packages where
one exists — a picture of a real worked example is worth keeping alongside
the prose definition, for whoever reads this next.

| File | Covers |
|---|---|
| [`session-liquidity.md`](knowledge/session-liquidity.md) | Session definitions, session liquidity, sweep detection (iFVG, BoS), PDH/PDL, measurement conventions |
| [`smc.md`](knowledge/smc.md) | Order block, FVG, CHoCH, BoS mechanics; three tested entry-encodings, all closed |
| [`derivatives-positioning.md`](knowledge/derivatives-positioning.md) | OI/top-trader-ratio/taker-flow definitions; redundancy-control methodology; all three hypotheses closed |
| [`smart-money-ict.md`](knowledge/smart-money-ict.md) | ICT true-open levels, premium/discount, proximal-edge iFVG; the `cmc-bot` H1-bias → M1-iFVG strategy as coded |
| [`opening-range-breakout.md`](knowledge/opening-range-breakout.md) | Opening-range breakout at the NY cash open: OR/trigger/stop/exit definitions, eligibility calendar, the imported crypto anchor; measurement conventions of the `orb-ny-open` pass |
| [`venue-contract-specs.md`](knowledge/venue-contract-specs.md) | Binance perp and Capital.com CFD contract specs: quantity unit, multiplier, minimum/step, leverage cap per regulated entity (EU/UK retail chosen), sources, and the API request that confirms them; feeds `instruments.yaml` `contract:` blocks |
| [`forced-flow.md`](knowledge/forced-flow.md) | Liquidation feeds (side convention, Binance 1 event/s undercount, no history), settled vs predicted funding and the multi-venue extreme count, CVD from taker-buy volume and the spot-vs-perp labels; the spot-vs-perp label tested and killed 2026-09-28 (`research/spot-lead/`), the rest untested, with a pointer to the open squeeze pass |

## Architecture

System-design notes for **infrastructure** (as opposed to trading ideas, which
live in `IDEAS-BACKLOG.md` / `research/`) live under `architecture/*.md`, one
note per system. They are role-to-role technical material.

| File | Covers |
|---|---|
| [`live-signal-server.md`](architecture/live-signal-server.md) | Live signal-generation server (NestJS) + chart terminal client (Angular); shared contracts; candle storage/backup requirements and S3 recommendation; routing to Software Engineer / DevOps / Integration Engineer |
| [`vwap-band-reversal-plugin.md`](architecture/vwap-band-reversal-plugin.md) | The `cmc-bot` VWAP band-reversal strategy as a **research-tier, unvalidated, visualization-only** plug-in of the signal server; strategy tiers, indicator series, warm-up for session-anchored indicators; routing to Software Engineer |
| [`chart-layouts.md`](architecture/chart-layouts.md) | Multi-panel layout-setups for the chart terminal (`layouts.yaml`, `GET /api/layouts`), open-interest ingestion as a metric series (`MetricAdapter`, `GET /api/metrics`, WS `metrics` topic), time-range panel sync, per-panel signal visibility; DXY epic (`DXY`, Capital.com) confirmed; routing to Software Engineer |
| [`economic-calendar.md`](architecture/economic-calendar.md) | Economic calendar / news events: ForexFactory weekly feed ingestion (`ff_calendar_thisweek`, no actuals in the feed — next-occurrence backfill), `EventStore` (File/S3 JSONL, indefinite retention), `GET /api/calendar/*`, WS `calendar` topic, daily digest + at-event-time in-app notifications, calendar view in the chart terminal; infrastructure that unblocks the backlog's "Scheduled-macro-event reaction" idea; routing to Software Engineer |
| [`four-streams-2026-09-18.md`](architecture/four-streams-2026-09-18.md) | Routing for four streams: OI in USD + OI candles (`chart-layouts.md` §11.1–11.2), horizontal/collapsible panels (§11.3), calendar filter set/flags/sound (`economic-calendar.md` §11), component-file rule (`AGENTS.md`) and its migration |
| [`backtest-app-2026-09-21.md`](architecture/backtest-app-2026-09-21.md) | **Settled brief** for the manual backtesting app (39 product decisions taken with the user, plus a repository reuse inventory). Requirements only — not a design. |
| [`backtest-app-system-design.md`](architecture/backtest-app-system-design.md) | System design for the manual backtesting app: `libs/indicators` + `libs/replay-core`, the relational model behind repository ports (first database in the repo), the first write endpoints, replay cursor/fill engine, position-tool interaction layer, screenshots to S3, cookie auth with env admin and single-use invites; decomposed into `tasks.jsonl` |
| [`crypto-insight-bot-2026-09-28.md`](architecture/crypto-insight-bot-2026-09-28.md) | **Settled brief** for the crypto insight bot (25 product decisions taken with the user: collectors first, EC2 Tokyo, plain Postgres, grammY, research gates for P1/P2/P4, Anthropic-only AI at the edges, per-stream task files). Requirements only — not a design. |
| [`insight-bot-system-design.md`](architecture/insight-bot-system-design.md) | System design for `apps/insight-bot`: three lifted libs (`binance-client`, `market-data-core`, `calendar-core`), partitioned time-series schema in database `insight`, four venue collectors + archive backfill, watchdog and the stage-0 exit criterion, EC2 hosting requirements, the stage-1 feature frame / twin-arm playbook engine (how the no-standalone-regime-classifier ruling is enforced structurally) / gate / Telegram delivery / tracker; decomposed into `tasks/insight-bot.jsonl` |

## Status

Roles and this context document were the first deliverable. Since then:

- **Research pipeline is live** — see `RESEARCH-LOG.md` (Записи 1–19) and
  `IDEAS-BACKLOG.md`. No strategy has shipped; two `cmc-bot` strategies are
  mid-pre-registration (smart-money ICT, VWAP band reversal).
- **Live infrastructure design started 2026-09-12** —
  `architecture/live-signal-server.md`: NestJS signal server + Angular chart
  terminal + candle backup. Designed as strategy-agnostic plumbing with a
  plug-in slot; Software Engineer scaffold and DevOps storage/hosting pin are
  the next steps. Specific AWS service choices remain DevOps Engineer's.
- **First strategy plug-in designed 2026-09-12, at research tier** —
  `architecture/vwap-band-reversal-plugin.md`: the VWAP band-reversal
  mechanic ported into the server for chart visualization only, labelled
  unvalidated end to end; its Stage-1 verdict is still pending and is not
  affected by the build.
- **Chart layout-setups designed 2026-09-12** —
  `architecture/chart-layouts.md`: named multi-panel layouts (crypto: BTC/ETH/
  BTC open interest/DXY; US indices: US100/US500/DXY) with one shared
  timeframe and synchronized scrolling; open interest ingested as a new
  metric series. Capital.com DXY epic confirmed (`DXY`); Software Engineer
  build is the next step, sequenced after the VWAP plug-in build since both
  touch the chart client's terminal shell/overlay layer.
- **Economic calendar designed 2026-09-16** —
  `architecture/economic-calendar.md`: ForexFactory weekly feed polled into a
  persistent `EventStore` (every event and every revision kept forever; the
  feed carries no actuals, so results are backfilled from the next
  occurrence's `previous` until a provider is chosen), weekly calendar view
  and in-app daily/at-event notifications over the existing WebSocket.
  Infrastructure only — it makes the backlog's scheduled-macro-event idea
  testable later; Software Engineer build is the next step.
- **ORB line closed and post-ORB directions surveyed 2026-09-16** —
  22 pre-registered ORB arms (four families, three axes, two anchors) closed
  with no edge; `research/_surveys/2026-09-intraday-directions.md` answers
  why the published ORB papers find an edge this project did not (cross-
  section + costs, regime, no holdout discipline) and ranks four candidate
  directions: a cross-sectional "instruments in play" package on a wide
  crypto perp universe first, the prioritised funding-rate family second,
  two fit-only probes (market intraday momentum; macro-event continuation)
  after. VWAP mean reversion and any ORB form are not proposed.
- **Second product stream opened 2026-09-28 — the crypto insight bot**
  (`architecture/crypto-insight-bot-2026-09-28.md` brief,
  `architecture/insight-bot-system-design.md` design, `tasks/insight-bot.jsonl`
  IB-001…IB-028). Collectors + EC2 hosting are the first cluster and rank above
  any new backtest-app work because liquidations, predicted funding and
  Bybit/OKX data are lost for every day they are not collected. Two research
  gates dispatched in parallel: the full-form long/short squeeze (P1/P2,
  `research/squeeze-full-form/`) and spot-lead confirmation (P4,
  `research/spot-lead/`).
- The trading-idea intake format is still informal (backlog entry → Architect
  grilling → research package).
