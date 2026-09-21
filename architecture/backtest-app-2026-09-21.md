# Backtest app — settled brief (input for the Architect)

**Date:** 2026-09-21
**Status:** Requirements settled with the user across a full grilling pass (39
decisions). **Not a system design.** This is the input the Architect works from:
it fixes *what* is being built and every constraint the user has already ruled
on, so the Architect can produce the system design and decompose it into
`tasks.jsonl` without re-litigating product questions.

**What the Architect still owns:** component boundaries, data model, API
surface, module layout, sequencing, and the task decomposition with priorities.
Nothing below prescribes those.

---

## 1. The product

A **manual, discretionary backtesting app**: the trader replays historical
candles forward one bar at a time, places orders by hand as the market unfolds,
and gets a journal and statistics out of it. It is a training instrument, not a
strategy backtester — the existing programmatic engines in `research/` and
`cmc-bot-main` serve that purpose and are unrelated to this app.

**Audience:** closed contour — the user and a small trusted circle, with a path
to a few dozen invited users. Not a public product. Tenancy boundaries
(user → sessions → orders) must be honest from day one so that growth does not
mean a rewrite, but nothing is designed for anonymous public traffic.

---

## 2. Facts established by a repository inventory

These were verified against the repo on 2026-09-21 and constrain the design.

**Reusable as-is**
- `libs/contracts` — zod schemas for `Candle`, `Instrument`, `Timeframe`/
  `TIMEFRAME_MS`, `Layout`/`Panel`, wire types. Extend additively.
- `apps/signal-server/src/storage/` — `CandleStore` port with `file/` and `s3/`
  implementations; `stream(instrument, tf, from, to)` is documented as ordered
  replay and is the natural server primitive for this app.
- `apps/signal-server/src/market-data/resampler.ts` — pure, UTC-anchored, folds
  1m into 5m/15m/1h/4h/1d **including forming bars** (commit `7d994ce`). This is
  exactly the primitive the cursor semantics in §5 depend on.
- `apps/chart-client` — Angular 22, `lightweight-charts` ^5.2.1, multi-panel CSS
  grid (one chart instance per panel, the v5 panes API is not used),
  `chart-sync.service.ts` for cross-panel range/crosshair sync,
  `chart-data.adapter.ts`, and `features/chart/overlay/shapes.primitive.ts` — a
  custom `ISeriesPrimitive` that canvas-draws rects/lines with labels. That
  primitive is the substrate for the entry/SL/TP reticle.
- Pure indicator implementations under
  `apps/signal-server/src/strategy-engine/strategies/vwap-band-reversal/indicators/`
  (ATR, VWAP, range, previous-hour, FVG).
- Design references for order lifecycle and statistics:
  `cmc-bot-main/src/strategy/order.ts` (note its existing
  `entryChartSnapshot`/`closeChartSnapshot` concept),
  `cmc-bot-main/src/backtesting/backtest-reporter.ts`; intrabar fill conventions
  in `research/orb-ny-open-exit/engine.py` and
  `research/cmc-bot-vwap/stage1_engine.py`.

**Does not exist anywhere in the repo and must be built**
- Any user model, authentication, or per-user persistence.
- Any database, migration tooling, or ORM (no pg/sqlite/prisma/typeorm/knex).
- Any write endpoint — `signal-server` is 100% read-only `GET` today.
- Any router in `chart-client` (`app.config.ts` has no `provideRouter`; `App`
  renders `TerminalShellComponent` directly).
- Any pointer interaction on the chart overlay — the primitives render, nothing
  listens for `pointerdown`.
- Client-side replay/scrub/cursor.
- Screenshot capture (no html2canvas, no puppeteer; Playwright exists only as a
  chart-client e2e devDependency).
- A TypeScript fill/PnL engine (existing ones are Python, or Node 16 TS in
  `cmc-bot-main`).

**Data on hand** (`apps/signal-server/data`, 753 MB): **BTCUSDT 1m is the only
deep contiguous tape — 2571 days, 2019-09-08 → 2026-09-21.** ETHUSDT 1m is 54
days; everything else is single-digit days at intraday resolution. Capital.com
has a hard vendor floor for intraday at 2024-01-02
(`CAP_COM_INTRADAY_FLOOR_MS`); daily bars go deeper (DXY to 2014).

**Monorepo:** npm workspaces (`apps/*`, `libs/*`), no nx; `libs/contracts` is the
only shared lib and is consumed as a built package, not via path aliases. Node
>= 22. Component rules and the per-slot port table are in `AGENTS.md`.

---

## 3. Users, auth, tenancy

| # | Decision |
|---|---|
| 1 | Closed contour: the user plus a trusted circle; designed to grow to a few dozen invited users without a rewrite. |
| 14 | **The whole application sits behind login.** The existing terminal becomes one route among the authenticated ones. |
| 8 | Built by **extending `chart-client`** (add router, auth, backtest screens) and **extending `signal-server`** (first write endpoints) — not as a separate app or a separate server. |
| 20 | Server-side sessions in an httpOnly cookie (client and API share a domain). Admin credentials come from environment variables — the admin is never created through the UI. Invite links are single-use and expire after 7 days; the invite flow ends in a set-password form. |
| 30 | The admin manages users and invites only, and **cannot see other users' sessions or journals**. If shared review is ever wanted it becomes an explicit "share session" feature, not a silent admin right. |

---

## 4. Market data

| # | Decision |
|---|---|
| 2 | Binance for crypto; Capital.com for indices and FX pairs. Deepest history the vendor allows. Everything fetched is persisted locally to avoid re-paying for API calls. |
| 15 | The Capital.com intraday floor of 2024-01-02 is **accepted** — ~2.6 years of intraday for indices/FX is enough for manual practice (this is training, not a statistical power exercise). The instrument list must be configuration, never code. |
| 9 | 1m backfill for the remaining instruments is a **separate task running in parallel with development**, not a blocker — provided the instrument list is not hardcoded. |
| 16 | **Bulk backfill ahead of time**, by a background process. A session can only be created on instruments already stored locally, so the instrument picker in the create-session form reflects reality. Per `AGENTS.md`, the backfill design must state its Binance weight per minute. |
| 5b | On session creation the user picks instruments from the list of what is actually available. |

---

## 5. Replay mechanics

| # | Decision |
|---|---|
| 3 | One synchronized timeframe across the layout's panels; a step advances all panels together. |
| 13 | The step is **calendar-time based** — each panel simply draws whatever it has at that time. |
| 19 | **Weekends are skipped entirely**; other empty stretches are auto-skipped (the cursor never stops where no panel has data). |
| 12 | The timeframe **can be changed mid-session**; the step then moves by one candle of the new timeframe. |
| 18 | The cursor is stored as **absolute time (ms)**. Changing timeframe keeps it exactly where it was, so the current bar of the new timeframe is shown **partially formed** — the existing resampler already produces this. No rounding forward or back. |
| 37 | **There is no step backwards.** Forward only. Irreversibility is what makes manual backtesting resemble trading; a back button silently becomes a replay-until-it-wins button. Returning to the past is possible only from the trade journal, in view-only mode (§8). |
| 39 | Maximum 4 panels / 4 instruments per session, all sharing one quote currency (§7). |
| 17 | The client caches ~500 candles ahead, refilling in the background at ~100 remaining. |
| 5 | **Hybrid authority.** The client computes and renders PnL as the user steps (a server round trip per candle would destroy the feel). The **server independently recomputes each trade on close, and the server's number is what enters the statistics** — a client bug must not silently corrupt a journal. The server serves candles ahead in batches. |
| 11 | Indicators are computed **on the client**, using pure functions lifted into `libs/` from the existing server implementations — one implementation, so client and server cannot disagree. Recomputing per step over a server round trip is not viable. |

---

## 6. Sessions and layouts

| # | Decision |
|---|---|
| 10 | `layouts.yaml` stays as a list of **presets** offered at session creation. From then on the layout is **a copy owned by the session**, editable inside it. A session reopened a year later looks exactly as it did. |
| — | Per the original brief: multiple sessions per user; create with instruments, period, layout, account size, default risk % (1%); delete a session from the main menu, which cascades to its orders (§8) and screenshots. |
| 28 | Reaching the session's end date **force-closes open positions at the last price** and marks them with an `end-of-session` close code; the session becomes complete and its statistics final. |
| 31 | Indicator catalogue: VWAP, ATR, range, previous-hour H/L, FVG (already implemented, to be lifted) plus EMA, SMA, RSI, MACD, Bollinger, Stochastic (to be written). Timeframes: all six the resampler supports (1m, 5m, 15m, 1h, 4h, 1d). |

---

## 7. Orders, execution, accounting

| # | Decision |
|---|---|
| 21 | **An order cannot be opened without a stop-loss** — position size is derived from risk % and stop distance, so without a stop the size is undefined. **Account size compounds** with PnL. Every trade is recorded **both in currency and in R**, so sessions remain comparable regardless of account size. |
| 22 | **Unlimited simultaneous positions**, including several on one instrument and opposing long/short. Total open risk is displayed on screen. |
| 23 | An unfilled limit order can be **cancelled**; SL/TP of an open position can be **moved**. Every modification is stored with the cursor time it happened at. A filled or closed trade can never be deleted — the "no deleting orders" rule protects journal honesty, not the trader's hands. |
| 4 | **SL/TP are resolved by walking the real 1m price path** inside the bar. Where 1m is unavailable for an instrument/period, fall back to the pessimistic convention (stop hit first) and flag those trades in the journal. |
| 24 | **Costs are modelled**: percentage commission on notional plus a fixed spread, both configurable per session and switchable off. Limit entries fill at the level; market entries and stop exits pay the spread adversely. Perpetual funding is out of scope for v1. |
| 25 | **No leverage or margin model** — margin is assumed sufficient, no liquidation. A warning is shown when notional exceeds the deposit by more than a configured multiple. |
| 35 | Floating PnL during replay is marked at the **last closed candle's close, adjusted for spread** — i.e. what closing right now would actually return. |
| 29 | Several position tools may sit on a panel; the **last created or clicked** one is active. The order hotkey pulls entry/SL/TP and the risk-derived size from it. **With no active tool the hotkey opens nothing** and shows a hint — never a guessed order, since orders cannot be deleted. On fill, the tool that produced the order is consumed and becomes the live position drawing. |
| 36 | **One quote currency per session.** The account currency is that quote currency, and the create-session form rejects mixing (USD-quoted crypto and indices group together; CHF-quoted FX forms its own group). No FX conversion, no cross-rate history. |
| 37b | Fixed hotkeys in v1 (proposal: `→` step forward, `B`/`S` place long/short tool, `Enter` open order from the active tool, `Esc` clear the tool). Rebinding comes later. |

---

## 8. Journal, statistics, screenshots

| # | Decision |
|---|---|
| 26 | Equity curve is built **from closed trades** (a step per close); drawdown is measured on that stepped curve. Because that hides a trade that went deeply against the trader and recovered, **maximum adverse excursion (MAE) per trade is reported as a separate number**, computed at close rather than on every step. All aggregates in both currency and R. Metrics per the brief: PnL, equity curve, profit factor, drawdown, average profit, average loss. |
| 38 | **Hybrid computation:** stored aggregates on the session row keep the sessions list instant; the detail screen recomputes in full from the trade table, which also catches any drift between the two. Per decision 5, the authoritative numbers are the server's. |
| 27 | Two canvas screenshots per trade: the first at the **moment the order is placed** (the picture the decision was made on — for a limit order that is placement, not activation), the second **automatically on close**, whatever closed it. Stop-outs during fast scrolling must not end up without a picture. |
| 6 | Screenshots are **canvas captures of the chart**, sent to the server and stored in **S3** (per the project's AWS requirement); the database holds only the key. Width is capped so a 200-trade session does not become gigabytes. |
| 32 | From a trade's detail view, **"show on chart" rewinds the session cursor to the entry, view-only** — the user may change timeframe and add indicators there but cannot trade in the past, and the session cannot be resumed from that point. |
| 30b | Deleting a session cascades to its orders **and its S3 screenshots** — orphaned objects are a bill that grows silently. |

---

## 9. Storage and infrastructure

| # | Decision |
|---|---|
| 7 | Users, sessions, orders and aggregates go in a **relational database behind an adapter** on the backend, so the provider is swappable. Locally: PostgreSQL in podman. **Candles stay in the existing file store** — many, immutable, read by range; that profile does not belong in a relational database. Note for the Architect: this is the first database in the repository, and the house pattern so far has been a `*-store.port.ts` with `file/`+`s3/` implementations. The relational choice is deliberate (cascading deletes, transactional trade close, aggregates), not an oversight. |
| 33 | **Production on AWS is deferred** until the app works locally — target shape is RDS PostgreSQL + containerised app + S3 — but schema and configuration are written so the move is an environment-variable change, not a refactor. Migrations use versioned SQL files with a lightweight runner, no ORM, so the database stays plain PostgreSQL. AWS credentials will be supplied by the user later. |

---

## 10. Priorities

Set by the user; the Architect turns these into `tasks.jsonl` entries with
`priority` and `depends_on`, and the Tech Lead schedules them.

- **P0 — without it there is no product:** auth and invites; session creation;
  replay by hotkey; position tool; market and limit orders; SL/TP resolution on
  the 1m path; **costs (commission + spread)**; trade close; trade journal;
  basic statistics.
- **P1 — immediately after:** screenshots; indicators; editing the layout inside
  a session; trade detail with return-to-chart.
- **P2:** 1m backfill for the remaining instruments; full statistics screens;
  stop-moving with modification history.

Costs were moved from P1 to P0 deliberately: a trader who practises for a week
without commission and spread learns the wrong stop size and has to unlearn it.
Screenshots stayed in P1 — valuable for review, but they do not block trading.
Backfill stayed in P2 only because BTCUSDT's seven years of 1m already make the
app fully usable.

---

## 11. Open items

- **Which FX pairs exactly.** The user named EURUSD and EURGBP; the store
  currently holds EURCHF and GBPCHF. To be confirmed before the backfill task is
  specified — and note that the pair choice interacts with decision 36, since
  EUR/GBP-vs-USD pairs are USD-quoted while the CHF crosses are not.
- **AWS credentials** — to be supplied by the user when production work starts
  (deferred per decision 33).
- **Warning multiple** for notional versus deposit (decision 25) — a number, not
  a decision; the Architect may pick one.
