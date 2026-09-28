# DESIGN — full-form long / short squeeze (insight-bot P1 / P2), research gate

**Researcher, 2026-09-28.** Mechanical restatement of `ARCHITECT-NOTE.md`
(same directory). **Committed before any R was computed.** At the time of this
commit the only numbers that exist are STAGE-0 data-depth facts (§2.3), which
say nothing about performance. Where the note left a mechanical choice open,
this file fixes it and marks it **[R-fix]** — every one is fixed without sight
of an outcome, and none may be changed after the first R. Anything the note
fixed is quoted or restated, not reinterpreted. If the Architect disagrees with
an [R-fix], the pass is re-run with the Architect's version, and both are
reported.

Prior (the note's): **10–15 %** for a build verdict. This is a rescue pass of a
shape closed twice on this tape (`deriv-positioning` b1, t = −4.56;
funding-rate-signals arm B killed).

---

## 1. Arms, α, universe

| arm | side | universe |
|---|---|---|
| **P1-M** | short (long squeeze) | BTCUSDT, ETHUSDT |
| **P1-A** | short | SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT |
| **P2-M** | long (short squeeze) | majors |
| **P2-A** | long | alts |

Exactly four registered arms; **α = 0.05 / 4 = 0.0125** per arm. Tiers pool
trades across their symbols. Everything else in this package — ablation
rungs, Binance-only re-read, 3R template, VWAP-T1 template, per-symbol rows,
sensitivities — is **descriptive / fit-only** and is labelled so wherever it
appears. None of it can be promoted to a verdict.

## 2. Data

### 2.1 Sources (all public, no credentials)

| input | source | puller |
|---|---|---|
| perp 1m OHLCV + taker-buy volume | `data.binance.vision/data/futures/um/monthly/klines/<SYM>/1m/` | `fetch_data.py` (hedged-carry's fetch/zip reader and per-file ms/µs rule, imported) |
| spot 15m OHLCV + taker-buy volume | `data.binance.vision/data/spot/monthly/klines/<SYM>/15m/` | same; **µs rule applies** (spot files 2025-01+ are 16-digit) |
| Binance funding | `data.binance.vision/data/futures/um/monthly/fundingRate/` | hedged-carry `build_funding` (imported verbatim) |
| Bybit funding | `GET api.bybit.com/v5/market/funding/history?category=linear` — limit 200, paged back by `endTime` to an empty page | `fetch_data.py::pull_bybit` |
| OKX funding | `GET www.okx.com/api/v5/public/funding-rate-history` — limit 100, paged back by `after` to an empty page; `realizedRate` preferred, `fundingRate` fallback | `fetch_data.py::pull_okx` |
| OI (5 m) | `data.binance.vision/data/futures/um/daily/metrics/` | deriv-positioning `fetch_day` (imported verbatim), range extended to the archive's first file |

**[R-fix] Spot at 15m, not 1m.** Spot enters only through a 4 h CVD sum. A
Binance 15m archive bar is the UTC-aligned aggregate of its fifteen 1m bars, so
`Σ_{4h}(2·takerBuy − vol)` is identical whichever is summed; `checks.py`
re-proves this on one full month (spot 1m vs spot 15m, BTCUSDT, a µs-era month)
rather than assuming it. Perp is pulled at **1m** because exits are resolved at
1m (§6.2) and every perp bar the rules use (15m, 1h, 4h) is **resampled here
from 1m**, UTC-aligned, labelled by open time, as the note requires.

### 2.2 Alignment (point-in-time; a decision at instant `T` sees only what existed at `T`)

- **Bars.** A bar labelled `t` with length `Δ` is known at `t + Δ`. A 15m / 1h /
  4h bar with **zero** 1m rows is missing (NaN, never filled); a bar with some
  1m rows is built from the rows present.
- **Funding, every venue.** A settlement row at `t_j` is known at `t_j`
  (settled rate). The state at `T` uses the last row with `t_j ≤ T`.
- **OI.** Metrics row `create_time = c` is usable at `T` iff `c + 5 min ≤ T`
  (deriv-positioning §1.4 lag rule). `OI_T` = last usable row;
  `OI_{T−24h}` = last row usable at `T − 24 h`. Either one older than 15 min
  relative to its instant → **OI undefined at `T`** (condition false; counted).
- **ATR(1h,14)** — Wilder, on resampled perp 1h bars (funding-family
  `wilder_atr`, imported), value of the **last completed** 1h bar at the
  instant used.
- **SOL FTX-week interval blackout** (funding-family ARCHITECT-RULING
  2026-09-16 §1, `[2022-11-09 20:00, 2022-11-18 16:00)` UTC): SOLUSDT funding
  rows inside it, on every venue, are removed before the percentile window; no
  SOL decision bar inside it can arm. Carried over, not re-decided.

### 2.3 STAGE-0 venue depth — measured 2026-09-28 (`results/venue_depth.csv`, `results/venue_pages.csv`)

| venue | first row, per symbol | interval |
|---|---|---|
| Binance (archive) | BTC/ETH 2020-01-01, XRP 01-06, LINK 01-17, ADA 01-19, BNB 02-10, DOGE 07-10, SOL 2020-09-13 | 8 h (SOL 2/4 h in the FTX week) |
| **Bybit** (REST) | **BTC 2020-03-25**, ETH/LINK 2020-10-21, ADA 2021-03-18, XRP 2021-05-13, DOGE 2021-06-02, SOL/BNB 2021-06-29 | 8 h (SOL 2 h rows in the FTX week) |
| **OKX** (REST) | **2026-06-22, every symbol — ≈ 97 days, ≈ 295 rows** | 8 h |

**OKX's public endpoint serves only the last ~3 months.** Paging back by
`after` returns an empty page after ≈ 295 rows on every symbol. With the
45-settlement `min_periods`, OKX has a defined percentile only from
≈ 2026-07-07, i.e. the **last ~3 weeks of the holdout** and the tail. For the
whole fit period and ~94 % of the holdout **the venue count is over
{Binance, Bybit}**, and "≥ 2 venues" means **both of them**. This is the note's
own contingency ("where a second venue has no history for a date, the count is
over the venues that exist and the row is flagged"); no rule changes. The
insight bot collects OKX live from day one, so its live count is over three
venues — REPORT states that the historical test is of the two-venue form.

### 2.4 Windows

- Fit: from each arm-symbol's **effective start** (the first decision bar at
  which every input of that arm has its warm-up: 90-row funding window at ≥ 45
  rows on the venues required, 7 d of OI, 24 h of 15m bars, ATR warm-up, spot
  present) to **2025-07-31** inclusive. The effective starts are measured and
  printed, never chosen.
- Holdout **2025-08-01 .. 2026-07-31**. Tail **2026-08** descriptive.
- A trade belongs to the window of its **entry** instant. A trade still open
  at a window's end is closed at that instant (1m open) — the boundary close is
  an exit for accounting (funding family §4.2).

## 3. Observables at a decision instant `T` (a 4h close: 00, 04, … 20 UTC)

**Funding state per venue `v`** (funding family §1.2 verbatim): at each
settlement `k`, `pct_k` = percentile rank of `f_k` among the trailing 90 rows
including itself, `min_periods = 45` (funding-family `rolling_pct_rank`,
imported). Extreme-positive iff `pct ≥ 0.90 ∧ f ≥ +0.0003`; extreme-negative
iff `pct ≤ 0.10 ∧ f ≤ −0.0003`. State at `T` = state of the last row
`t_k ≤ T`.

**Venue present at `T`** [R-fix]: `pct` defined at its last row **and** that
row is ≤ 16 h old (two 8 h intervals). `n_venues(T)` = venues present;
`ext_hi(T)`, `ext_lo(T)` = count of present venues in the state.
`flag_venues(T)` = `n_venues(T) < 3` — recorded on every row and every trade.
**[R-fix] "≥ 2 venues" stays literal**: a decision instant with fewer than 2
venues present cannot satisfy it (it does not degrade to "all venues that
exist"). Consequence: nothing arms before Bybit's percentile is defined.

**OI**: `oi_d24h = OI_T / OI_{T−24h} − 1`; `at_7d_high ⇔ OI_T ≥ max(OI
usable rows in (T − 7 d, T])`.

**Price context**: `ret24 = close(T) / close(T − 24 h) − 1` on perp 1m closes.

**Failed highs (P1)** over the 96 perp 15m bars ending at `T`: `H24` = max
high; a **3-bar pivot high** at bar `j` (`high_j > high_{j−1} ∧ high_j >
high_{j+1}`, so it needs bar `j+1` closed by `T`); it is a *failed high* iff
`H24 − high_j ≤ 0.5·ATR1h(T)` **and** `close_j < H24`. `fh(T)` = count.
Mirror **failed lows (P2)**: `L24` = min low, pivot lows with `low_j − L24 ≤
0.5·ATR1h(T)` and `close_j > L24`. (Matches the insight-bot frame key
`structure.failed_highs_24h`.)

**Compression (P2)**: `close(T) ≥ H24 − 1·ATR1h(T)`.

**Spot / perp CVD**: `cvd_x(T) = Σ (2·takerBuy − volume)` over the 16 × 15m
bars of the 4 h ending at `T`, on spot and on perp (base units).

**Price shadow** (funding family §5.3 verbatim, sampled on the 8 h grid
00/08/16 UTC): at grid slot `g`, `r_g = close(g)/close(g − 24 h) − 1`,
`spct_g` = rolling percentile over the trailing 90 slots, `min_periods = 45`.
Shadow-positive iff `spct ≥ 0.90 ∧ r > 0`; shadow-negative iff `spct ≤ 0.10
∧ r < 0`. State at `T` = last slot `g ≤ T`.

## 4. ARMED rules (evaluated at every decision instant `T`)

**P1 (short)** — all of:

1. `ext_hi(T) ≥ 2` (funding extreme-positive on ≥ 2 venues);
2. `oi_d24h(T) ≥ 0.05` **and** `at_7d_high(T)`;
3. `fh(T) ≥ 2`;
4. `cvd_spot(T) ≤ 0` **and** `cvd_perp(T) > 0`.

**P2 (long)** — all of:

1. `ext_lo ≥ 2` at `T`, `T − 4 h` **and** `T − 8 h` [R-fix: "negative
   funding ≥ 8 h" = the ≥ 2-venue extreme-negative state held at three
   consecutive decision instants spanning 8 h];
2. `oi_d24h(T) ≥ 0.03` **and** `ret24(T) ≥ −0.01` [R-fix: "price flat/up" =
   24 h return not worse than −1 %; the note did not name `at_7d_high` for
   P2, so it is not required];
3. failed lows `≥ 2` **and** compression;
4. `cvd_spot(T) ≥ 0`.

**Armed window**: 8 × 4 h = 32 h, i.e. 15m bars **closing** in `(T, T + 32 h]`.
A later ARMED instant while armed and flat extends the window to its own
`T + 32 h`. [R-fix] After a trade **exits**, only an ARMED instant with `T ≥
exit time` can arm again (one setup → at most one trade). One open position
per symbol per arm.

## 5. Trigger, entry, stop (on perp 15m bars inside the armed window)

At 15m bar `k` (closing at `c_k`), using only bars `≤ k`:

**P1** — `H` = max high of bars `k−96 … k−1`, `iH` its **last** occurrence
("the current high"). `L` = low of the most recent 3-bar pivot low `j` with
`j + 1 ≤ iH` (confirmed before the high), searched back ≤ 96 bars from `iH` —
"the swing low preceding the current high" (= frame key
`structure.impulse_low_15m`). No such pivot → no trigger at `k`.
**Trigger**: `close_k < L` and every close in `(iH, k−1]` is `≥ L` [R-fix: the
*first* close below the impulse low since the high — an event, not a state].
**Entry** short at `close_k`, time `c_k`. **Stop** `= max(H, high_k) +
0.2·ATR1h(c_k)`.

**P2** — `H` = max high of bars `k−96 … k−1` ("the local high" named in the
compression condition; [R-fix] "15m close above the high" = above this).
**Trigger**: `close_k > H` **and** `volume_k > p70(volume_{k−96 … k−1})`.
**Entry** long at `close_k`. **Stop** `= min(L24_k, low_k) − 0.2·ATR1h(c_k)`,
`L24_k` = min low of bars `k−96 … k−1` [R-fix: mirror of P1's "rejection
high" — the extreme the failed lows defended].

`1R ≡ |entry − stop|`. A candidate with `stop_dist ≤ 0` or non-finite is
skipped and counted.

## 6. Exits and accounting

### 6.1 Templates

| template | role | target |
|---|---|---|
| **T-1R** | **verdict** | entry ± 1R (project standard) |
| T-3R | fit-only descriptive | entry ± 3R |
| T-VWAP | descriptive | P1: VWAP (perp 1m, typical price `(h+l+c)/3`, volume-weighted) from the impulse-low pivot bar `j` to the entry bar = "VWAP of the rise"; P2 mirror from the `L24` bar. A VWAP on the wrong side of entry → trade recorded as `no_t1` and excluded from that row only |

All templates: same stop; **time stop 5 days** after entry (exit at the close
of the 1m bar ending at `c_k + 5 d`).

### 6.2 Path resolution on perp 1m, from the first minute after `c_k`

- Stop touched (`high ≥ stop` short / `low ≤ stop` long) → exit at the stop,
  or at the minute's **open** if the open is already through it (gap).
- Target touched → exit at the target.
- **Same minute touches both → stop** (the note).
- Missing 1m rows are skipped; a hold with > 60 consecutive missing minutes is
  flagged (not dropped).

### 6.3 Costs and funding (funding family §4 verbatim)

```
side      = −1 short / +1 long
priceR    = side × (exit − entry) / stop_dist
fundingR  = Σ_{j : t_entry < t_j < t_exit} (−side) × f_j × mark_j / stop_dist
costR     = 0.001 × entry / stop_dist          (0.10 % round trip, taker)
netR      = priceR + fundingR − costR ;  grossR = priceR + fundingR
```

`f_j` = **Binance** settled rates (the trade is a Binance perp position);
`mark_j` = perp 1m open at `t_j`. 1m resolution gives the exact exit minute, so
no pinning rule is needed. Every table carries the decomposition (mean
priceR, fundingR, costR, settlements/trade, zero-settlement share, hold h, win
rate, exit-cause split).

## 7. Controls

### 7.1 Price shadow (mandatory, gating)

Each arm re-run with its **funding and OI conditions** (P1 items 1–2; P2 items
1–2 including the ≥ 8 h persistence and the flat/up clause, which belongs to
the OI item) replaced by the **price shadow** at the same thresholds:
shadow-positive for P1, shadow-negative for P2 at `T` (P2's persistence rule
applied to the shadow too: `T`, `T−4h`, `T−8h`). Items 3–4, armed window,
trigger, stop, templates, accounting — identical. Shadow trades collect the
funding that actually prevailed.

**Screen margin** (note §3.1): an arm must beat its shadow by **≥ +0.05R**
mean netR on the fit period, else **"price in disguise"**.
**Build margin** (funding family §5.3 (i)–(iii), carried): on the holdout,
difference ≥ +0.05R, 90 % two-sample day-block bootstrap interval of the
difference excludes 0 (2,000 draws, whole UTC days resampled independently in
each trade set), same sign on fit.

[R-fix] **Shadow starvation**: if a shadow has **< 30** fit trades, the
margin is still computed against its mean but marked *unreliable*; if it has
**0** trades the screen margin is *not evaluable* and the arm **cannot reach a
build verdict** (the seventh condition cannot be shown), whatever else it
does. No alternative shadow is introduced (the funding family's 72 h fallback
was specific to its frequency-parity rule and is not in this note).

### 7.2 Ablation ladder (fit-only, descriptive — the table the user asked for)

Same template, same trigger, same accounting; conditions added cumulatively.

| rung | P1 adds | P2 adds |
|---|---|---|
| **R0 — closed simple form** | Binance extreme-positive at `T` | Binance extreme-negative at `T, T−4h, T−8h` |
| R1 — + venue count | → `ext_hi ≥ 2` (replaces R0's Binance-only) | → `ext_lo ≥ 2` at the three instants |
| R2 — + OI | `oi_d24h ≥ 0.05 ∧ at_7d_high` | `oi_d24h ≥ 0.03 ∧ ret24 ≥ −0.01` |
| R3 — + failed highs / lows | `fh ≥ 2` | failed lows ≥ 2 ∧ compression |
| **R4 — + spot CVD = the full arm** | `cvd_spot ≤ 0 ∧ cvd_perp > 0` | `cvd_spot ≥ 0` |

R0 is the closed shape **in this template** (4h arming, 15m structure
trigger, 5-day hold); it is not a re-run of funding arm B's 1h/12-bar
geometry, and the REPORT says so. Each rung reports `n`, mean netR with the
decomposition, day-block 90 % CI, and the change vs the rung above. Plus two
side rows: **R4 with Binance-only count ≥ 1** (the note's "what the
multi-venue filter contributed" re-read) and **R0 restricted to the dates
where R1 is evaluable** (so the R0→R1 step is not confounded by Bybit's later
start).

### 7.3 Matched-time placebo (1,000 draws)

Each real trade replaced by one on a **random 15m bar** on a different random
UTC date inside the same window and symbol, same side, **same `stop_dist` in
ATR1h units**, same T-1R template and 5-day time stop, funding accounting at
the placebo's own dates, same cost. One-sided `p` = share of draws whose mean
netR ≥ observed. Seed fixed (`20260928`).

### 7.4 Frequency floor

An arm with **< 60 fit-period trades** is **"underpowered"** and is not read on
the holdout (note §3.4).

## 8. Screen, holdout, verdict

**Fit screen** — an arm reads the holdout only if **all** of: `n_fit ≥ 60`;
fit mean netR (T-1R) **≥ +0.05R**; fit shadow margin **≥ +0.05R** (evaluable).

**Verdict ladder**, verbatim from funding note §8.1, on holdout mean total
netR (T-1R):

| condition | verdict |
|---|---|
| failed the frequency floor | **UNDERPOWERED** — holdout not read |
| failed the screen otherwise | **NO EDGE — fit-period kill**; holdout not read |
| `n_holdout < 150` | **UNDERPOWERED — inconclusive** |
| mean `< +0.05R` **or** placebo `p > 0.20` | **NO EDGE — kill** |
| `≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE** |
| six conditions (`≥ +0.10R`; `p ≤ 0.0125`; fit same sign ≥ +0.05R; `n ≥ 150`; 90 % day-block bootstrap excludes 0; gross > 0) but shadow margin fails | **DOMINATED — price in disguise** |
| all six + shadow margin (i)–(iii) | **REAL EDGE — build ruling** → thresholds to the Architect as `playbook_config` v1; live only after 4+ weeks of `SHADOW` agreeing in sign |

**Family rule (note §4): a kill closes the squeeze family — P1 and P2 both —
on this project.** An UNDERPOWERED outcome is reported as what it is: the full
form fires too rarely on 2020+ history to be certified; it is not a pass.

## 9. Order of work (and what is not done)

1. STAGE 0 — pull, depth log, `data_audit` (coverage per input and per
   symbol, effective starts). Done before this file was committed for the
   venue depth; the kline/metrics audit is run after this commit and reported.
2. `checks.py` — wiring checks (below) green **before** the first fit number
   is read.
3. Fit: four arms + shadows + ablation ladder + placebo + side rows.
4. Screen. Holdout only for arms that pass it.
5. REPORT, HANDOFF, logs.

`checks.py` asserts at least: µs/ms rule on spot files; spot 15m == Σ spot 1m
on a full month; resampled perp 15m/1h/4h OHLCV vs the archive's own 15m/1h
bars on a sample month; no decision uses a funding row with `t > T` or an OI
row with `c + 5 min > T`; failed-high pivots confirmed by `T`; trigger bar
strictly after the arming instant; `stop_dist > 0`; stop exits have `priceR =
−1` exactly unless gapped; target exits `+1` exactly; no settlement counted
outside `(t_entry, t_exit)`; placebo reproduces the real trade exactly when
its entry is forced to the real bar; one open position per symbol per arm.

**Not done here**: any threshold sweep promoted to a verdict; any holdout
read for a screened-out arm; liquidation data (none exists historically,
`knowledge/forced-flow.md`); OKX history beyond what its endpoint serves.
