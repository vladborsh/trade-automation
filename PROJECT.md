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
Implementation specifically (see the Direct dispatch authority section of
`agents/roles/architect.md`); generalizing the pattern to other role pairs is
a future extension, not a current capability.

## Roles

| Role | Model | Charter |
|---|---|---|
| [Researcher](agents/roles/researcher.md) | Opus 5 | Explores a raw idea: historical data, exploratory/protocol-driven analytics, feasibility, pros/cons, documentation. |
| [Architect](agents/roles/architect.md) | Claude Fable 5 | Entry point, orchestrator, and quality gate. Designs the approach, routes work, and judges results (ship/rework/kill) — absorbed the former Critique & Refinement role. |
| [Implementation](agents/roles/implementation.md) | Sonnet 5 | Builds the strategy/automation logic. |
| [Backtesting](agents/roles/backtesting.md) | Sonnet 5 | Independently re-validates *implemented, shipped* strategy code against historical data — distinct from the Researcher's protocol-driven validation of the idea itself. |
| [Live-Signal Development](agents/roles/live-signal-development.md) | Sonnet 5 | Turns a shipped strategy into deployable rules (position-sizing, execution logic) and builds/runs the real-time pipeline that emits live signals from them — absorbed the former Strategy-Application role. |
| [DevOps Engineer](agents/roles/devops-engineer.md) | Sonnet 5 | Owns hosting and data storage on AWS. |

Models are defaults, not hard requirements — swap per-role if a specific idea's
complexity or budget calls for it.

## Status

Roles and this context document are the current deliverable. Actual strategy
implementation, the trading-idea intake format, and specific AWS service choices
are deliberately **not** decided yet — that work starts once the team receives its
first trading idea.
