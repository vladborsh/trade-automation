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
tested it.

## Status

Roles and this context document are the current deliverable. Actual strategy
implementation, the trading-idea intake format, and specific AWS service choices
are deliberately **not** decided yet — that work starts once the team receives its
first trading idea.
