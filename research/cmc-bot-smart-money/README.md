# cmc-bot smart-money ICT — **Stage 0** (reproduction and audit)

A two-stage, Architect-gated pass on the user's own pre-built bot
(`cmc-bot-main/`). **This package currently contains Stage 0 only.**

**Stage 0 result: both gates PASS, and the pass is clear to proceed to Stage 1
— with one correction the Architect needs before its thresholds are trusted.**

| | |
|---|---|
| bar-for-bar parity against the bot's TypeScript | **0 discrepancies**, 4 windows × ≥ 35 trading days, 4 symbols, 75 orders |
| prefix-causality, M1 path | **240/240**, 0 lookahead |
| machine checks | **13/13 PASS** |
| projected holdout trades (caps removed) | **694** — the gate is 150 |
| **new finding, not in ARCHITECT-NOTE §1.2** | the H1 bias reads the **in-progress hour as a finished candle** — up to 59 min of lookahead in the bot's own backtest. **18.8 % of signals exist only because of it.** See `PARITY.md` §4 |

Stage 0 computed **no** performance number. There is no R, no win rate, no
expectancy, no MFE/MAE and no forward lift anywhere in this package, and none
was calculated — ARCHITECT-NOTE §4 forbids them before the Architect has
reviewed this output.

## What the idea is

Continuation in the direction of an **H1 iFVG bias** (720-hour lookback),
triggered by an **M1 iFVG**, permitted only while price sits on the
bias-consistent side of both the **NY-AM true open (07:30 New York)** and the
**midpoint of a swing-anchored running range**, inside a **09:40–11:10
America/New_York** window, Mon–Fri, with a stop on that range's far extreme, a
fixed 2.7R target, a breakeven/+1R trail and a **forced flat at 11:10 NY**.

The mechanic is pinned in full, from the code, in
[`knowledge/smart-money-ict.md`](../../knowledge/smart-money-ict.md). This
bot's "iFVG" is a close through the gap's **proximal** edge — *not* the
far-edge definition `knowledge/session-liquidity.md` §5.1 uses. The shared word
is a trap.

## Read in this order

| file | what it is |
|---|---|
| `ARCHITECT-NOTE.md` | the **spec** — routing, the pre-registered Stage-1 numbers, the scope boundary. Written before any result existed |
| `PARITY.md` | **the Stage-0 gate document** — both proofs, and the disposition table for all 18 divergences found between the TypeScript's intent and its behaviour |
| `results/INVENTORY.md` | the signal inventory, the eligibility funnel per asset and per year, and the projected holdout trade count |
| `results/CHECKS.md` | the 13 machine checks |
| `HANDOFF.md` | Researcher → Architect routing note |
| `RUNBOOK.md` | how to re-run everything from an empty checkout |

## Code

| file | role |
|---|---|
| `fetch_1m.py` | the 1m pull — a thin wrapper over `research/intraday-mr-smc/fetch_data.py` (ARCHITECT-NOTE §5.3: *this project's* archive loader, never the bot's `npm run scrap`) |
| `common.py` | constants lifted from the bot's source, the data layer, and the New-York wall-clock layer |
| `engine.py` | **the port** — the FVG/iFVG state machine, the H1 bias, `Swings`(60) and the running range, the true-open comparison, the ATR gate, `adjustStopLoss`, and the order lifecycle. Numba-accelerated; ~6 s per symbol over four years |
| `reference.py` | a **deliberately slow, line-by-line transcription** of `indicatorScript`, including a faithful `ScriptVar`. Exists only so `checks.py` C1 can audit the fast path instead of trusting it |
| `ts_parity/dump_signals.ts` | the TypeScript side of the parity check — imports the bot's *unmodified* classes and reproduces `BacktestRunner`'s bar loop verbatim |
| `parity.py` | the diff, order by order |
| `tables.py` | the inventory, the funnel, the holdout count |
| `checks.py` | the 13 checks |

Nothing in `cmc-bot-main/` was edited by this pass.

## Data

Binance USD-M **perpetual** 1-minute klines, `data.binance.vision` public bulk
archive, 2022-08-01 .. 2026-07-31, BTCUSDT / ETHUSDT / SOLUSDT / BNBUSDT —
2,103,840 bars per symbol, no gaps. The 1h frame is resampled from it, never
pulled separately. `data/` is gitignored; `fetch_1m.py` reproduces it.

The declared deviation of ARCHITECT-NOTE §5.3 stands: our archive is USD-M
perpetual futures while the bot's `BinanceClient` may run spot.
