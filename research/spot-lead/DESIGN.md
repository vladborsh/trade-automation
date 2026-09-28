# DESIGN — `spot-lead`: does a spot-led 4 h advance continue better than a perp-led one? (insight-bot P4 research gate)

**Status:** pre-registration, **committed before any R exists on any arm.**
**Date:** 2026-09-28 · **Package:** `research/spot-lead/`

Mechanical restatement of the binding pre-registration
`research/spot-lead/ARCHITECT-NOTE.md` (commit `a0f0ba5`). **The note is the
canonical spec; where this document and the note disagree, the note wins and
this document is the bug.** This document adds mechanical detail and may not
loosen anything; where it tightens, it says so.

**No performance number of any kind exists at the time of this commit.** The
only numbers that exist are the Stage-0 data-audit counts of §2.4 (row counts,
month coverage, missing minutes) — no return, no label frequency, no trade
outcome.

---

## 0. The claim and the registered family

*A 4 h advance whose spot taker flow is net-buying (`SPOT_LED`) continues over
the next 1–5 days more reliably than an advance carried by perp taker flow
while spot is flat or selling (`PERP_LED`); the mirror for declines
(`ABSORPTION` — price down while spot buys and perps sell — is bought).*
Architect's prior for a tradeable arm clearing the bar: **20 %**; the label is
more likely to matter as a filter (L4) than as an entry.

**The family is exactly four arms, α = 0.05 / 4 = 0.0125,** counted by
registration whether or not an arm survives the screen:

| arm | entry | side | statistic that carries the verdict |
|---|---|---|---|
| **L1 continuation** | 4 h close labelled `SPOT_LED` | long | mean net R of L1, **plus** the contrast `L1 − L1c` where L1c is the identical long on `PERP_LED` closes (§5.3) |
| **L2 fade** | 4 h close labelled `PERP_LED` | short | mean net R |
| **L3 absorption** | 4 h close labelled `ABSORPTION` | long | mean net R |
| **L4 filter economics** | baseline B = long at every 4 h advance (price ↑, any CVD); filtered F = the subset labelled `SPOT_LED` | long | `Δ = mean netR(F) − mean netR(B)`, with keep share `n(F)/n(B)` |

**Universe reading (resolving "8-perp set in two tiers pooled per arm").**
Each arm has **one verdict on the pooled 8-perp set**: majors BTCUSDT,
ETHUSDT; alts SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT. The
two tier rows (majors, alts) and the eight per-symbol rows are mandatory and
descriptive. Reading the tiers as separate verdicts would make the family 8
cells and α 0.00625; the note fixes α at 0.0125 for four arms, so pooled it is.

Everything else — L1c on its own, tier/symbol/side rows, the `DISTRIBUTION`
label, the forward-return profile, the transition matrix, the "spot CVD >
perp CVD" variant of §1.4 — is **descriptive, carries no verdict**, and its
heading says so.

---

## 1. Definitions (note §1)

### 1.1 Bars

- Source: Binance 1m klines, perp (`data/futures/um`) and spot
  (`data/spot`), each carrying `volume` and `taker_buy_volume` (base units).
- **4 h bar k** = the 240 one-minute bars with open time in
  `[T_k, T_k + 4 h)`, `T_k ∈ {00, 04, 08, 12, 16, 20}:00 UTC`. Its **close
  time** `t_k = T_k + 4 h` is the decision instant. Perp 4 h OHLC from the
  perp minutes (open of the first, max high, min low, close of the last).
- **Validity.** Bar k is *valid* iff **both** legs have **≥ 228 of 240**
  minutes present (a 5 % tolerance for exchange maintenance). An invalid bar
  gets no label and no trade; counted per symbol in `results/data_audit.csv`.
  No fill, no interpolation.

### 1.2 Observables at the close `t_k`

```
cvd_spot_4h(k) = Σ_{minutes of bar k, spot} (2·taker_buy_volume − volume)
cvd_perp_4h(k) = Σ_{minutes of bar k, perp} (2·taker_buy_volume − volume)
ret_4h(k)      = close_perp(k) / close_perp(k−1) − 1      (bar k−1 must exist)
ATR(k)         = Wilder ATR(14) of perp 4 h bars, through and including bar k
                 (seed = SMA of the first 14 true ranges; TR uses close(k−1))
thr(k)         = 0.25 · ATR(k) / close_perp(k)
```

All of these are known at `t_k` and use no minute after it (`checks.py`
prefix-stability test, §7).

### 1.3 Labels (design §9.2, exactly)

Price direction: `↑` iff `ret_4h ≥ +thr`, `↓` iff `ret_4h ≤ −thr`, `→`
otherwise. CVD sign: `↑` iff `> 0`, `↓` iff `< 0`, `→` iff `= 0`.

| price | spot | perp | label |
|---|---|---|---|
| ↑ | ↑ | any | `SPOT_LED` |
| ↑ | → or ↓ | ↑ | `PERP_LED` |
| ↓ | ↑ | ↓ | `ABSORPTION` |
| → | ↓ | ↑ | `DISTRIBUTION` |
| anything else | | | `NONE` |

Labels are mutually exclusive and exhaustive over valid bars with a defined
ATR and `ret_4h` (asserted in `checks.py`).

### 1.4 Descriptive variant (fit only, no verdict)

The note's hypothesis sentence says "spot CVD positive **and larger than perp
CVD**"; the registered labels (design §9.2) do not require the second part.
One fit-only descriptive row runs L1 on `SPOT_LED ∧ cvd_spot_4h >
cvd_perp_4h`. It is never promoted and does not enter any verdict.

---

## 2. Data

### 2.1 Pull

`fetch_data.py` wraps `research/hedged-carry/fetch_data.py`, extended in this
pass with an `--interval 1m` mode that keeps `taker_buy_volume` (the 1h
default behaviour is unchanged). Months 2019-09 .. 2026-08, 8 symbols, spot
and perp 1m plus the perp funding archive. Per-file ms/µs timestamp rule
(spot switched to µs in 2025-01) enforced; an undeterminable unit stops the
pull.

### 2.2 Sample start

Per symbol, the first 4 h bar where both legs exist, plus 15 bars of ATR
warm-up. Perp 1m monthly archives begin later than spot for every symbol, so
the perp listing binds.

### 2.3 Windows (note §4)

By entry time `t_k` (the 4 h close):

- **Fit:** sample start ≤ `t_k` < 2025-08-01 00:00 UTC. A fit trade still open
  at 2025-08-01 00:00 exits at that minute's open (cause `boundary`), per the
  funding family's boundary rule — no fit trade reads a holdout price.
- **Holdout:** 2025-08-01 00:00 ≤ `t_k` < 2026-08-01 00:00. Holdout trades
  run to their own exit, at most 5 days into 2026-08 (the August 2026 tape is
  pulled for exactly this; no entry is taken in it).

**Prior reads of the holdout year, declared.** 2025-08-01 .. 2026-07-31 on
Binance crypto tapes has been read by price-only intraday registrations
(Записи 18, 22, 23), by the hedged carry (spot and perp **prices** and funding,
Запись 32, holdout 2024-08 .. 2026-07) and by COIN-M carry (Запись 34). **None
read taker-buy volume, CVD, or any spot-vs-perp flow quantity.** The
concurrent `squeeze-full-form` pass reads the same year with a spot-CVD
condition as one of four filters; it is independent registration run in
parallel, and neither pass sees the other's numbers before its own verdict.
This line starts its own count.

### 2.4 Stage-0 audit (counts only; filled from `data_audit.py` before commit)

See §9 of this document (appended after the audit ran, before any R).

---

## 3. The trade template (note §2)

For each arm, at a qualifying close `t_k` on symbol s:

```
entry      = close_perp(k)                      (the 4h close price)
stop_dist  = 1.5 · ATR(k)                       (= 1R)
long:  stop = entry − stop_dist, target = entry + stop_dist   (+1R)
short: stop = entry + stop_dist, target = entry − stop_dist
time stop  = 5 days = 7 200 minutes after t_k
```

**Path.** Perp 1m bars with open time ≥ `t_k`, in order:

- Long: a bar with `low ≤ stop` stops the trade at `min(open, stop)` (a gap
  through the stop fills at the open); a bar with `high ≥ target` hits the
  target at `target` (no favourable gap fill). **Same bar touches both → stop.**
- Short: mirror (`high ≥ stop` → `max(open, stop)`; `low ≤ target` → target).
- Time stop: exit at the **close** of the last minute before `t_k + 5 d`
  (cause `time`).
- Missing minutes are simply absent from the path; no fill.
- `t_exit` for accounting: the fill minute's open time **+ 1 minute** (stop /
  target), `t_k + 5 d` (time), 2025-08-01 00:00 (boundary).

**One position per (arm, symbol).** A qualifying close while that arm's trade
on that symbol is open is **skipped** (not queued). A new entry is allowed at
`t_k ≥ t_exit` of the previous trade. The same non-overlap rule applies to L1c,
B, F and every shadow arm, each independently.

---

## 4. Accounting, per trade, in R (funding family §4, restated)

```
side      = +1 long / −1 short
priceR    = side × (exit_px − entry) / stop_dist
fundingR  = Σ_{j : t_k < t_j < t_exit}  (−side) × f_j × P(t_j) / stop_dist
costR     = 0.0010 × entry / stop_dist                       (0.10 % round trip)
netR      = priceR + fundingR − costR
grossR    = priceR + fundingR
```

`f_j` = settled rate from the funding archive (whatever the interval),
`P(t_j)` = perp 1m open at the settlement minute (entry price if that minute is
missing). Strict inequality: a trade entered at 08:00 does not collect the
08:00 settlement; a stop filled inside the 16:00 minute does collect the
16:00 one. **Missing settlements** (a gap between consecutive archive rows
longer than 1.5 × the stated interval): a trade spanning exactly one missing
slot gets zero for it and is flagged; a trade spanning > 1 is **excluded and
counted**. No interpolation.

**Mandatory decomposition, every table that shows netR:** mean priceR, mean
fundingR, mean costR, mean hold (h), exit-cause split (stop / target / time /
boundary), win rate.

---

## 5. Controls (note §3)

### 5.1 Price shadow — gating, every arm

The label recomputed with **perp CVD replaced by a copy of the price return**
and **spot CVD replaced by the perp's own CVD**. Substituting into §1.3
(price direction unchanged):

| shadow label | condition |
|---|---|
| `SPOT_LED'` | price ↑ ∧ `cvd_perp_4h > 0` |
| `PERP_LED'` | price ↑ ∧ `cvd_perp_4h ≤ 0` (the "perp" slot, `ret_4h`, is > 0 by construction) |
| `ABSORPTION'` | price ↓ ∧ `cvd_perp_4h > 0` |

Shadow arms L1', L2', L3', L4' (F' = the `SPOT_LED'` subset of the same
baseline B) run the identical template, accounting, windows and nulls.

**Margin (the seventh build condition, funding family §5.3 verbatim in
form).** An arm is *not dominated* iff, on the same window, (i) `stat_real −
stat_shadow ≥ +0.05R`; (ii) the 90 % two-sample day-block bootstrap interval
of that difference (2 000 draws, whole UTC entry-days resampled independently
in each trade set) excludes 0; (iii) the same sign holds on fit. For L1–L3
`stat` = mean netR; for L4 `stat` = Δ, so the margin reduces to
`mean netR(F) − mean netR(F')`. An arm that clears the ladder but fails the
margin is **DOMINATED — no second signal**.

**Frequency parity.** Fit trade counts of real and shadow are both reported.
The note registers no fallback shadow; if a shadow fires fewer than half the
real arm's fit trades, the comparison is still run and the REPORT flags it.

### 5.2 Matched-time placebo — primary null, 1 000 draws

- **L1, L2, L3:** each real trade is replaced by one entered at a uniformly
  random **valid 4 h close** of the same symbol, same window, **different UTC
  date**, same side, same template (stop is 1.5·ATR at the placebo's own
  close), same accounting at the placebo's own dates. One-sided
  `p = share of draws with mean netR ≥ observed`. Destroys the alignment with
  the label; keeps symbol, side, clock grid, template, cost, window.
- **L4:** the filter question is "do `SPOT_LED` advances beat *random*
  advances?", so each F trade is replaced by a random **price-↑ valid close**
  (any label) of the same symbol, same window, different UTC date; `p = share
  of draws with mean netR(placebo) ≥ mean netR(F)`.
- Placebo trades are independent draws (no non-overlap among them).
- The shadow arms get the same null, reported, non-gating on their own.

### 5.3 The L1 contrast (the hypothesis as the note states it)

L1c = the identical long template on `PERP_LED` closes. L1 additionally
needs, on the holdout: `mean netR(L1) − mean netR(L1c) ≥ +0.05R`, its 90 %
two-sample day-block bootstrap interval excluding 0, and the same sign on fit.
(Tightening: the note names the contrast as the hypothesis but gives it no
bar; the shadow margin's bar is borrowed.)

### 5.4 Frequency floor

**≥ 60 fit trades** per arm, pooled (for L4: ≥ 60 in F). Below the floor the
arm is **unmeasurable at the pre-committed definition** and stops. Shadows
and L1c are reported at whatever count they have.

### 5.5 Descriptive (no verdict)

Label frequency and **transition matrix** (label at k → label at k+1),
**persistence** (mean run length per label), **contemporaneous `ret_4h` by
label in ATR units** (shows how much of the label is the move itself), and the
**forward return profile** `close(k+h)/close(k) − 1` in ATR(k) units at h =
6, 12, 18, 24, 30 bars (1–5 days) per label, overlapping, fit only.

---

## 6. Screen and verdict (funding family §7.3 / §8.1, with the note's changes)

### 6.1 Fit-period screen — committed before the holdout is read

An arm reads the holdout only if, on fit: (a) floor met; (b) statistic
≥ +0.05R (L4: Δ ≥ +0.05R **and** keep share ≥ 50 %); (c) placebo
`p ≤ 0.20`; (d) shadow margin (i) and (ii) hold; (e) L1 only: contrast (i)
and (ii) hold. Otherwise **SCREENED OUT — fit-period kill**, holdout never
computed. The screen decision is a commit, appended to this file as §10.
If the projected holdout `n` (fit trades per day × 365) is < 150 for an arm
that passes, it is run anyway and the UNDERPOWERED row applies; no parameter
moves for power.

### 6.2 Ladder, applied mechanically to each screened-in arm's holdout

`stat` = mean netR for L1–L3, Δ for L4.

| condition | verdict |
|---|---|
| screened out | **NO EDGE — fit-period kill** |
| `n_holdout < 150` (L4: `n(F) < 150`) | **UNDERPOWERED — inconclusive** |
| `stat < +0.05R` or placebo `p > 0.20` | **NO EDGE — kill** |
| `stat ≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE** — no build |
| all build conditions below met except the shadow margin (or, for L1, the contrast) | **DOMINATED — no second signal** |
| all build conditions | **REAL EDGE — build ruling** |

**Build conditions:** L1–L3: mean netR ≥ **+0.10R**; `p ≤ 0.0125`; fit
same sign with fit mean ≥ +0.05R; `n ≥ 150`; 90 % day-block bootstrap of
mean netR excludes 0; mean grossR > 0; shadow margin (i)–(iii); L1 also the
contrast (§5.3). **L4:** Δ ≥ **+0.05R** (the note's bar for the filter);
keep share ≥ 50 %; `p ≤ 0.0125`; fit Δ ≥ +0.05R; `n(F) ≥ 150`; 90 %
paired day-block bootstrap of Δ excludes 0 (days resampled jointly for F and
B); shadow margin (i)–(iii).

### 6.3 What the verdicts mean for the bot (note §4)

- Any arm **REAL EDGE** → build: `label.p4` may be declared as a playbook
  `context_gate` (twin-arm tested live, design §8.3) and its score weight
  stands. L4 is the arm whose pass most directly licenses the gate use.
- **No arm passes** → kill: the label stays a displayed context with weight 0
  in the score; arm (b) of the backlog entry is closed.
- DOMINATED / INCONCLUSIVE / UNDERPOWERED → no build; the REPORT says whether
  the shadow (plain "up move with positive perp taker flow") carried the
  number, which is a proposal for the standalone price/flow line, not for P4.

### 6.4 Mandatory rows beside every verdict

Per-tier and per-symbol mean netR and `n`; §4 decomposition; exit-cause
split; real vs shadow counts; for L4 the keep share and both B and F rows;
for L1 the L1c row.

---

## 7. `checks.py` (asserts; results to `results/checks.csv`)

1. 1m tapes: sorted, unique minutes, `0 ≤ taker_buy_volume ≤ volume`
   (tolerance 1e-9 relative), high ≥ max(open, close), low ≤ min(open, close).
2. 4 h CVD equals the sum of its minutes' deltas (recomputed independently).
3. Prefix stability: labels, ATR and thresholds recomputed from the tape
   truncated at `t_k` equal the full-sample values at 200 random closes.
4. Labels mutually exclusive and exhaustive; shadow labels recomputed from
   their definitions match.
5. Trade path: stops fill at or beyond the stop, targets at the target; no
   exit before `t_k`; same-minute stop+target resolved to stop (constructed
   case + count in data); hold ≤ 5 d.
6. Funding: no settlement counted outside `(t_k, t_exit)`; sign check on a
   constructed long/short pair.
7. Non-overlap: no two trades of one (arm, symbol) overlap.
8. Mirror symmetry: on a reflected tape (`p' = K − p`, CVD sign flipped) a
   long's priceR equals the mirrored short's priceR at 50 random closes.
9. Fit trades never read a price at or after 2025-08-01 00:00.

---

## 8. Order of work

1. Pull + Stage-0 audit (no R). 2. This file, committed. 3. Engine +
`checks.py` + `MECHANIC-PROOF.md` (ten trades with settlement ledgers).
4. Fit numbers for all arms, shadows, placebo, descriptive tables; screen
decision appended as §10 and committed. 5. Holdout once, screened-in arms
only. 6. `REPORT.md`, `HANDOFF.md`, `RESEARCH-LOG.md` Запись, backlog status.

---

## 9. Stage-0 audit (counts only, `results/data_audit*.csv`; run before this commit)

- **Coverage.** All 8 symbols, both legs, 2019-09 .. 2026-08. The perp 1m
  archive binds every symbol's start: BTC/ETH 2020-01-01, XRP 2020-01-06,
  LINK 2020-01-17, ADA 2020-01-31, BNB 2020-02-10, DOGE 2020-07-10, SOL
  2020-09-14. Fetch log: 625 perp months ok, 47 `404` (all before each
  symbol's perp listing); spot 661 ok, 11 `404` (SOL before 2020-08).
- **Missing minutes** on the grid: perp 0 for six symbols, 7 200 for SOL
  and XRP (the same two archive holes in 2022-02 and 2022-04, 4 320 + 2 880); spot 1 424 ..
  2 326 per symbol, concentrated in 2019–2021 maintenance windows (the same
  months across all spot pairs — venue-wide, not symbol-specific).
- **Invalid 4 h bars** (§1.1, < 228 minutes on either leg, incl. warm-up):
  fit 31–70 per symbol out of 10 689–12 233; **holdout 0** of 2 190 per symbol.
- **Taker rule.** One row violates `0 ≤ taker_buy ≤ volume`: XRPUSDT perp
  2023-11-30 12:35 (taker 132 462.5 > volume 91 695.7). **Ruling
  (tightening, mechanical):** a minute whose taker field is outside
  `[0, volume]` contributes **no delta** to either CVD (its prices are kept for
  the path). `checks.py` asserts no such minute remains in any delta.
- **Funding.** 8 h interval throughout except SOL (99 rows at 2 h, 2 at 4 h,
  all inside 2022-11-09 20:00 .. 2022-11-18 08:00, the FTX week the hedged
  carry blacked out); §4 sums whatever settled rows
  exist, so the interval is immaterial to the accounting. One missing slot in
  total (SOL). No duplicates. No SOL blackout is applied: the note registers
  none, and the hedged carry's blackout was a basis-anomaly rule for a
  two-legged position, which this single-leg perp template does not hold.

---

## 10. Screen decision (fit period, §6.1) — committed before any holdout R

Source: `results/fit_arms.csv`, `fit_margins.json`, `fit_screen.json`
(`stage1.py`). `checks.py`: 40 checks, 0 failed.

| arm | fit n | fit stat | placebo p | shadow margin (diff, 90 % CI) | other | screen |
|---|---|---|---|---|---|---|
| L1 | 9 265 | −0.0078R | 0.000 | +0.003 [−0.036, +0.043] | contrast vs L1c +0.005 [−0.041, +0.051] | **OUT** (stat, margin, contrast) |
| L2 | 3 318 | −0.0501R | 0.998 | −0.035 [−0.083, +0.012] | — | **OUT** (stat, placebo, margin) |
| L3 | 3 136 | −0.0596R | 0.428 | −0.071 [−0.129, −0.013] | — | **OUT** (stat, placebo, margin) |
| L4 | F 9 265 / B 10 984 | Δ = +0.0001R | 0.002 | +0.003 [−0.036, +0.043] | keep 84 % | **OUT** (Δ, margin) |

**All four arms SCREENED OUT — NO EDGE, fit-period kill.** Per §6.1 the
holdout (2025-08-01 .. 2026-07-31) is **not simulated for any arm**; no
holdout R exists. The package proceeds directly to REPORT/HANDOFF.
