# Hand-off: Researcher → Architect (v2)

**Continues:** `research/intraday-mr-smc/` (that package is untouched and
read-only here — its `indicators.py` / `strategies.py` / `backtest.py` /
`fetch_data.py` are imported unchanged, and its BTC/ETH/SOL numbers reproduce
exactly in `results/summary_assets.csv`).

**Read first:** `research/intraday-mr-smc-v2/REPORT.md` §0 (bottom line), then
§4 (the parameter/target trade-off) and §5 (routing). `README.md` covers how to
rerun everything.

## What was tested in this pass

Three threads on top of v1, all with the unchanged 1%-per-trade sizing and
2%-of-day circuit breaker, all out-of-sample-disciplined
(fit `2022-08 → 2025-04`, holdout `2025-04 → 2026-08`, split fixed in advance):

1. **Hour-of-day / day-of-week filters** — 52 filter evaluations across 5
   candidates × 2 intervals on BTC/ETH/SOL, plus a 200-draw permutation null of
   random allow-lists per candidate.
2. **Five more liquid perps** — BNB / XRP / DOGE / ADA / LINK, same 48 months,
   same public Binance archive, no per-asset tuning.
3. **Equity index products** — SPY, QQQ, ^GSPC, ^NDX at 1h (regular session) and
   1d, via Yahoo's anonymous chart endpoint. **No credentials were needed and
   none were used; nothing synthetic.** (stooq.com is now behind a JS
   proof-of-work page, so it was dropped rather than worked around.)

Plus a 144-configuration parameter scan of the momentum-inversion family that
v1's §8 recommended.

## Bottom line for your routing decision

* **Nothing meets the targets.** Zero out-of-sample cells reach PF > 1.2 and
  win rate > 50% on a credible sample — across 52 time filters, 144 parameter
  configurations, 48 crypto candidate×asset cells and 24 index cells.
* **Relaxing PF to > 1.1 with win rate > 50% intact does NOT work.** The two
  targets trade directly against each other through reward:risk. Best profit
  factor across 144 configurations *with the win-rate constraint on* is
  **1.066 in-sample, 0.96 out-of-sample.**
* **Time-of-day / day-of-week is a dead end**, with a number attached:
  correlation between in-sample and out-of-sample filter improvement is
  **−0.49** over 52 evaluations. Showcase failure: hybrid 1h goes fit PF 4.07 →
  holdout PF 0.66 on its best 6-hour allow-list. A permutation null shows most
  filters do no better than a random allow-list of the same size.
* **The absent-edge finding generalises to five more perps and to indices** for
  mean reversion (net PF 0.76–0.86 on 8/8 perps, 0.55 on SPY) and SMC (0.71–0.91
  on 8/8 perps, 0.67–0.80 on all four index products).
* **One positive: the momentum inversion v1 recommended.** `momentum_breakout`
  at 1h has **gross PF > 1.0 on 8 of 8 perps** (1.07–1.19), net PF 0.97–1.11,
  and — uniquely in either package — **does not decay out of sample**
  (fit PF 1.039 → holdout PF 1.031, 2,258 holdout trades, 5/8 assets positive).
  Net edge ≈ **+0.019 R/trade against ≈ 0.037 R/trade of cost**. The sign is
  right; the magnitude is about one round-trip fee.
* **A design finding:** the hybrid's gate stack is structurally unusable on a
  session-gapped tape — 3 signals in 35 months on SPY (REPORT §3.3).

## My recommendation to you

1. **Retire pure mean reversion, and retire the hybrid as specified.** MR is
   negative gross on 8/8 perps and on SPY. The hybrid is not refuted (sample too
   small) but it is the most filter-sensitive thing in the package and does not
   transfer instrument classes.
2. **Put SMC's one remaining defence to Critique & Refinement, not to another
   research pass.** v1's main doubt was "maybe the encoding is wrong for crypto
   perps". It is now also negative on index products with entirely different
   microstructure, which weakens that defence — but the encoding question is
   theirs to close.
3. **The only candidate worth another pass is `momentum_breakout`, and the
   decision gate is not a research question.** Its entire net edge is about half
   a round-trip taker fee. Before anyone builds it, I need to know: **is a
   maker-fee / funding-aware execution model on the table for this project?**
   If yes → the next step is a costed execution study (maker fills, funding
   drag, portfolio correlation across 8 same-venue perps), and that is
   Researcher or DevOps input, not Implementation. If no → at retail taker cost
   this whole family is break-even and I would shelve the intraday chart-only
   line and spend the next pass on a different idea class.

**Do not route anything here to Implementation.** Nothing meets the targets and
the surviving candidate's economics are undecided.

## What is in the package

| path | what |
|---|---|
| `REPORT.md` | Findings, before/after tables for all three threads, the target trade-off, doubts. |
| `README.md` | Data provenance, script map, reproduction commands, the OOS protocol. |
| `*.py` | `common`, `strategies_v2`, `engine_v2`, `fetch_crypto_v2`, `fetch_index`, `tod_dow`, `run_assets`, `run_index`, `mom_scan`, `analyse_scan`. |
| `results/` | Every CSV behind every number, plus run logs. |
| `data/` | New perps + index data (gitignored; regenerate with the two fetch scripts, no credentials). |

**Note on the holdout:** it has now been used — 52 filter evaluations and 5
configuration evaluations. Any formal validation of `momentum_breakout` belongs
to the Backtesting role on a window this package has not touched.

---

## Addendum — example-trade charts (`VIZ-SPEC.md` pass, 2026-08-26)

**Researcher → Architect.** Separate, visualisation-only pass executing the
Architect's `VIZ-SPEC.md`. Nothing about the engine, the rule-set, the
parameters or the reported numbers changed; no new backtest was run beyond the
reproduction gate.

* **New:** `viz_trades.py`, `viz/trade_01…10_*.png`, `viz/selected_trades.csv`,
  `viz/CAPTIONS.md`. `README.md` gained one row and one rerun line.
* **Gate (§5) passed exactly.** Full-window `momentum_breakout` @ 1h, 8 perps,
  net of 5 bp/side: per-asset net PF 0.977 / 1.020 / 1.068 / 0.971 / 1.055 /
  1.112 / 0.995 / 1.045 (BTC…LINK), min/median/max **0.97 / 1.03 / 1.11**,
  pooled trades **6,792**, median WR **44.8%** — the `REPORT.md` §2.3 row,
  reproduced before any trade was selected.
* **Selection:** quotas 4 target / 4 stop / 2 time; the §3.4 deterministic draw
  satisfied every §3.5 constraint on the **first seed, 42** — no rejection
  iteration was needed and no trade was hand-picked. Drawn set: 6 symbols,
  entry years 2023/2024/2025, 4 long / 6 short.
* **True mix, for context** (pooled ledger, `eod` dropped, 6,787 trades):
  target 25.4% · stop 34.5% · time 40.1%, win rate 44.9%. The 4/4/2 chart mix
  deliberately over-weights target exits so all three exit mechanics are shown;
  `viz/CAPTIONS.md` states this and repeats the ≈ +0.019 R/trade net figure so
  the charts are not read as a performance claim.
* **Nothing here changes the routing recommendation** in `REPORT.md` §5. The
  charts are a communication artefact for the user, not new evidence.
