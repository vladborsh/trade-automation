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

There is no single fixed pipeline every idea passes through. The **Architect**
role is the entry point and orchestrator: it receives a trading idea and decides
which of the other roles actually need to engage, and in what order, based on what
kind of idea it is (chart-only, news-based, intraday-signal, analytics/summary,
etc.).

Routing is not always coordinator-mediated. A role with orchestration access
may directly dispatch trivial, fully-specified downstream work itself instead
of only producing a routing note for the coordinator to act on — this reduces
round-trips for the unambiguous case. Currently this applies to Architect →
Software Engineer specifically (see the Direct dispatch authority section of
`agents/roles/architect.md`); generalizing the pattern to other role pairs is
a future extension, not a current capability.

## Roles

| Role | Model | Charter |
|---|---|---|
| [Researcher](agents/roles/researcher.md) | Opus 5 | Explores a raw idea: historical data, exploratory/protocol-driven analytics, feasibility, pros/cons, documentation. |
| [Architect](agents/roles/architect.md) | Claude Fable 5 | Entry point, orchestrator, and quality gate. Designs the approach, routes work, and judges results (ship/rework/kill) — absorbed the former Critique & Refinement role. |
| [Software Engineer](agents/roles/software-engineer.md) | Sonnet 5 | Builds the strategy/automation logic. |
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

## Logging conventions

Two append-only logs at the repo root track the team's work; a role skipping
either one is a process gap, not a shortcut.

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

## Architecture

System-design notes for **infrastructure** (as opposed to trading ideas, which
live in `IDEAS-BACKLOG.md` / `research/`) live under `architecture/*.md`, one
note per system. They are role-to-role technical material.

| File | Covers |
|---|---|
| [`live-signal-server.md`](architecture/live-signal-server.md) | Live signal-generation server (NestJS) + chart terminal client (Angular); shared contracts; candle storage/backup requirements and S3 recommendation; routing to Software Engineer / DevOps / Integration Engineer |
| [`vwap-band-reversal-plugin.md`](architecture/vwap-band-reversal-plugin.md) | The `cmc-bot` VWAP band-reversal strategy as a **research-tier, unvalidated, visualization-only** plug-in of the signal server; strategy tiers, indicator series, warm-up for session-anchored indicators; routing to Software Engineer |

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
- The trading-idea intake format is still informal (backlog entry → Architect
  grilling → research package).
