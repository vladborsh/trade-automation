# HANDOFF — Researcher → Architect, `cmc-bot` VWAP band-reversal, Stage 0

**Status:** Stage 0 complete, both gates PASS. **No performance number was
computed.** Stage 1 not started; it needs your go-ahead and three decisions
below.

## What was done

- Pulled Capital.com 1-minute history for US100, US500, EURCHF, GBPCHF through
  the bot's own `CapitalComSession` with the request `CapitalComClient` sends —
  3.93 M bars, **2024-01-01 .. 2026-09-11 for all four** (the API has no
  1-minute data before 2024-01-01; bisected). No gaps beyond market closures;
  holidays itemised in `results/COVERAGE.md`.
- Bug-faithful Python port (`engine.py`) of `VWapStrategy` + `StrategyTemplate`
  + `RiskManager` + `Order` + the backtest bar loop.
- **Gate 1:** diffed against the bot's unmodified TypeScript over **every month
  of all four instruments' whole history** — 200,322 evaluated bars with every
  intermediate value bit-identical, 2,322 orders identical in every lifecycle
  field, 0 discrepancies (`PARITY.md` §1).
- **Gate 2:** prefix-causality 600/600 on a truncated tape (`PARITY.md` §2).
- Signal inventory and funnel, counts only (`results/INVENTORY.md`).

## What you need to decide before Stage 1

1. **Which tape — D-01.** The bot's candle timestamps are broker-local time
   (UTC+2/+3) parsed as UTC. The *live* bot still trades the right bars; the
   bot's *own backtest* on scraped files trades bars 2–3 h earlier (indices:
   06:xx–09:xx NY, pre-cash-open; forex: 00:xx–01:xx NY) and shares
   essentially no orders with the live stream (0/895, 3/947, 0/239, 0/241).
   I keyed this pass's tape by `snapshotTimeUTC` = the live bot. Recommend
   pinning that. Also worth telling the user: any past backtest/grid search
   of this strategy on Capital.com data was measuring different hours than
   the labels said.
2. **Backtest bar or live bar as primary — L-01.** Live reads the bar that
   opened at T−1 at clock minute T (the API's `max: 720` truncation and the
   not-yet-served forming minute both point the same way); the backtest reads
   the bar that opened at T. 92–98 % of orders coincide. The difference is
   small; the primary should still be named in `DESIGN.md`. `engine.run(live_like=True)` exists.
3. **Split and the forex legs — §5.** History starts 2024-01-01 (32.3 months).
   Projected orders per 12 months, caps off: US100 ≈ 427, US500 ≈ 482,
   **EURCHF ≈ 89, GBPCHF ≈ 90**. `n_holdout ≥ 150` is easy for the indices and
   needs a ≥ 20-month holdout for the forex pairs, leaving ≤ 12 months of fit.
   By the precedent's stop rule the forex legs are **underpowered** under any
   conventional split. Options: indices only; forex with a long holdout and
   thin fit; or forex as descriptive-only. Your call.

## Findings that change pinned knowledge

- **D-03 — `getLastIfvg` is asymmetric.** `lastIFVG` is undefined only when the
  *bullish* iFVG list is empty; an empty *bearish* list returns a valid
  element. Both `knowledge/vwap-band-reversal-ict.md` §3 and
  `knowledge/smart-money-ict.md` §1.3 say "either list". I corrected the VWAP
  file. **I did not touch `smart-money-ict.md` or the smart-money Stage-0 WIP
  (unmerged `429b0db`)**, whose port encodes the symmetric reading — that
  package's owner should re-check it. Verified directly against the bot's
  `calculateFVG` (`ts_parity/unit_last_ifvg.ts`).
- D-05 (the bias compares the bar's **open** to the band), D-06 (the 200-bar
  range excludes the current bar), D-07 (VWAP from 00:01 UTC, population
  stdev, broker tick volume), D-18 (`VWAP([])` throws on forex holidays — the
  bot's own backtest CLI would crash there). All added to the knowledge file.
- L-02: live US500 bias VWAP double-counts a chunk-boundary bar whenever the
  12h tape has a missing minute (59 % of US500 evaluations). L-03: the live
  request fails outright if the host clock leads Capital.com's by more than
  the firing latency (reproduced the rejection). Neither is reproducible
  bar-exactly; both are listed, not modelled.

## For Stage 1 (if routed)

- Everything needed is in place: `engine.run(P, lo, hi, daily_caps=..., live_like=...)`
  returns orders with entry/stop/target/exit; `results/signals_*.parquet`
  (as-deployed and caps-off) are ready but **deliberately unsummarised**.
- The raw pull keeps bid/ask; `spread_close` per bar is in the parquet, so the
  cost model can use Capital.com's actual historical spread (ARCHITECT-NOTE §4).
- Exit mechanics (close-only, clamped fills, forced flat at 14:30 / 04:00 /
  05:00 NY) are the bot's; a realistic-fill template would need to be added,
  as in the smart-money ruling.
- ~38 % of index `processCharts` signals are swallowed by an already-open
  same-direction order — the caps-off population is still path-dependent
  through that rule.

## Software Engineer guidelines (only on a REAL EDGE verdict)

A build must fix, not inherit, D-01 (map `snapshotTimeUTC`), decide
deliberately on D-03 and L-01, catch D-18, and guard L-03 (subtract a clock
margin from `to`). None of these should be silently "improved" in the
research primary.

## Pros / cons as I understand the idea (no outcome information)

- Pro: fully specified, deterministic, reproducible to the bit; runs on data
  the user actually trades; indices give enough trades to test.
- Con: three ingredients each with a standing null in this project (proximal
  iFVG, prior-level sweep, now a VWAP stretch); hand-tuned thresholds; forex
  legs too sparse to test; broker CFD tape and tick volume; the user's past
  evidence for it (if any came from the bot's backtest on Capital.com data)
  was measured on the wrong hours (D-01).
