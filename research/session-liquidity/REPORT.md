# Session-liquidity sweeps — descriptive study (phase 1)

**Package:** `research/session-liquidity/` · **Role:** Researcher · **Date:** 2026-08-31
**Spec:** `knowledge/session-liquidity.md` (authoritative) · **Backlog:** *Session-liquidity
sweeps (Asia/London/NY), iFVG vs BoS confirmation* · **Prior log entry:** RESEARCH-LOG.md
Запись 9

---

## 0. What this pass is, and is not

This is a **descriptive frequency/magnitude study**, by explicit user decision.
There is **no permutation null, no kill rule, no pass/fail gate, no fit/holdout
split** here, and nothing below should be read as one. Every number is a
description of what the tape did, not a verdict on whether the idea has edge.

What *is* enforced, because it is correctness rather than protocol:

| Hygiene rule | How it is enforced |
|---|---|
| Pivots confirm k=3 bars late | the project's `fractals(df, k=3)` is imported, not reimplemented; it already `shift(k)`s |
| iFVG needs a full close-through | inversion test is `close < gap_low` (or `close > gap_high`), never a wick poke |
| No lookahead in a session level | a level enters the pool only at `session_end_bar + 1` |
| No lookahead in a measurement | every forward window starts at `take_out_bar + 1` |
| ATR is causal | `ATR(14)` read at the take-out bar, not over the horizon |

All five are asserted mechanically by `checks.py` (run it after `engine.py`);
as of this commit all checks pass.

**Scope:** BTCUSDT / ETHUSDT / SOLUSDT / BNBUSDT, 5m Binance USD-M perp klines,
2022-08-01 .. 2026-07-31 (1460 days, 420,768 bars/asset), reusing the existing
`research/intraday-mtf-smc/` pull — no new data was fetched.

---

## 1. Pinned mechanical defaults

`knowledge/session-liquidity.md` is silent on several points that had to be
decided to make the study runnable. Each was resolved with a mechanical default,
and all of them are now written back into the knowledge file. **They are choices,
not findings — a different choice would move the numbers.**

| # | Ambiguity | Pinned default | Why |
|---|---|---|---|
| D1 | When does a session level become sweepable? | at the first bar **after** its window closes | any earlier is lookahead |
| D2 | Which session gets credit when one bar takes out several levels? | the level that required the **largest excursion** to reach (highest high / lowest low); ties → the most recently closed session. All levels taken are retired, and `n_levels_taken` is recorded | that level is the "deepest" liquidity actually reached; a single bar should produce one event, not N correlated ones |
| D3 | London/NY overlap (13:00–16:00) double-marks levels | keep **both** sessions' levels as separate entries; D2 breaks the tie | the overlap is real; suppressing one session would silently change the spec |
| D4 | How long may confirmation take after a take-out? | **24 bars = 2h**, the same length as the reverse-move horizon | anything later is a different trade; matching the horizon keeps the two statistics comparable |
| D5 | Where must the iFVG sit relative to the level? | strict: the **whole gap** beyond the swept level (`gap_low ≥ level` for a high sweep). Relaxed variant (gap merely reaches beyond) reported as sensitivity, T11 | "an iFVG forms above the session high" reads as fully above; the relaxed reading is reported so the choice is visible |
| D6 | When may the FVG form? | the gap's 3rd bar must fall in `[take-out bar, take-out bar + 24]`, and the inversion close after it, inside the same window | ties the formation to the sweep leg rather than to unrelated earlier structure |
| D7 | Which pivot does BoS break? | the most recently **confirmed, still-unbroken** pivot low (high sweep) / pivot high (low sweep); a swing is broken at most once | the local one-off trigger the spec asks for — explicitly **not** the bias/CHoCH engine closed in Записи 5/6 |
| D8 | Can a level be swept twice? | no — retired on first take-out | otherwise one grinding level generates dozens of duplicate events |
| D9 | Level lifetime | 48h from session close (spec's "last 2 days"), then expired unswept | spec |

Two labels are reported separately throughout, because they are not the same thing
and the user's prior is ambiguous between them:

- **`level_session`** — whose liquidity was taken (Asia / London / NY).
- **`sweep_session`** — the clock session the take-out *happened* in
  (Asia / London / London-NY overlap / NY / off-session 21:00–24:00).

---

## 2. Headline numbers

- **20,999 take-out events** across 4 assets in 4 years — ~3.6/day/asset. Sweeps
  are not a rare event; any strategy built here will be selection-limited, not
  sample-limited.
- **Asia's levels are hunted most** (8,154 events, 39%), NY 6,915 (33%), London
  5,930 (28%) — Asia's range is the narrowest and sits ahead of two more active
  sessions, so it gets taken out first.
- **BoS fires on 54% of take-outs, iFVG on 39%** — and they agree far less than
  the backlog assumed: **only 16% of take-outs get both**, 23% get neither, and
  **38% get BoS only** vs **23% iFVG only**. They are largely *different* event
  sets, not two readings of the same event.
- When both fire, **iFVG is first 82% of the time**, by a median of 6 bars (30
  min). iFVG is the earlier, tighter signal; BoS is the later, looser one.
- **Reverse move from the sweep wick, 2h: median 3.2–3.4 ATR** vs an
  unconditional same-horizon median of ~2.55 ATR — a **~1.25× lift**, present in
  every session and both directions.
- **The user's NY/Asia prior survives, but only after normalisation.** In raw ATR,
  NY looks *worst* (2.95–3.07) and London best (3.39–3.47). Normalised by how
  volatile each clock session is anyway, **NY (1.29/1.32) and Asia (1.27/1.36)
  have the highest lift** and London the lowest of the three (1.21/1.24). The
  prior is right about *relative* behaviour and wrong about *absolute* size.
- **The catch, and it is a big one:** measured from the **confirmation close** —
  which is where a trader would actually be filled — median MFE ≈ median MAE for
  both methods (ratio 0.95–1.05 over 2h). The favourable move that the wick-extreme
  reference shows has largely *already happened* by the time either method
  confirms. iFVG keeps more of it (R median 0.81, 41% of events reach 1R within
  2h) than BoS (R median 0.47, 21%), because BoS confirms later and leaves a
  much wider stop (3.76 ATR vs 2.53 ATR).

---

## 3. Charts

### 3.1 Worked examples (real events, wins and failures)

Each chart shows the session rectangles, the swept level, the k=3 pivots, the
inverted FVG, the confirmation bar, the 2h horizon and both extremes. Session
rectangles are drawn over their whole window, so a rectangle may extend past the
event — that is display context, not information the detector had.

| Chart | What it shows |
|---|---|
| `viz/ex01_BNBUSDT_20250831_2325_lo.png` | textbook iFVG sweep of an NY low, clean reversal |
| `viz/ex02_ETHUSDT_20240103_0935_hi.png` | textbook BoS sweep, clean reversal |
| `viz/ex03_SOLUSDT_20221103_2300_lo.png` | both methods fire — the timing gap between them is visible |
| `viz/ex04_BTCUSDT_20240103_1110_lo.png` | **confirmed and no reversal** — price ran straight on |
| `viz/ex05_SOLUSDT_20231211_0200_lo.png` | BoS confirms very late; the implied stop is already huge |
| `viz/ex06_BTCUSDT_20230806_2050_hi.png` | large reversal that **neither** method caught |
| `viz/ex07_SOLUSDT_20240607_1655_lo.png` | no confirmation, no reversal — the level simply broke |
| `viz/ex08_ETHUSDT_20260329_2240_lo.png` | one bar takes out several levels — D2 attribution in action |

### 3.2 Statistics

| Chart | What it shows |
|---|---|
| `viz/02_frequency_by_session.png` | take-out counts by asset × level session × direction |
| `viz/03_confirmation_rates.png` | iFVG / BoS / both / neither rates per session |
| `viz/04_rev_distributions.png` | reverse-move boxplots per session and direction, with the unconditional median drawn in |
| `viz/05_method_comparison.png` | (a) from the wick extreme, (b) from the confirmation close, (c) R-proxy CDF |
| `viz/06_delay_and_offset.png` | take-out→confirmation delay, and the iFVG-vs-BoS timing offset |
| `viz/07_monthly.png` | monthly counts and monthly confirmation rates — the stability check |
| `viz/08_session_prior.png` | the NY/Asia prior, raw and normalised |
| `viz/09_conditional_vs_unconditional.png` | conditional vs unconditional 2h excursion densities |

---

## 4. Tables

_Window: 2022-08-01 .. 2026-07-31 (1460 days), 4 symbols, 5m bars, 20,999 sweep events._

### T1. Sweep (take-out) frequency — level session x direction x asset

| level_session | direction | BNBUSDT | BTCUSDT | ETHUSDT | SOLUSDT | TOTAL | per_day_all |
|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 1008 | 1063 | 1040 | 1027 | 4138 | 3 |
| Asia | low_sweep | 982 | 1012 | 1003 | 1019 | 4016 | 3 |
| London | high_sweep | 781 | 730 | 755 | 780 | 3046 | 2 |
| London | low_sweep | 733 | 700 | 686 | 765 | 2884 | 2 |
| NY | high_sweep | 932 | 867 | 849 | 903 | 3551 | 2 |
| NY | low_sweep | 864 | 824 | 798 | 878 | 3364 | 2 |

### T2. Confirmation rate by method — level session x direction

| level_session | direction | events | ifvg_rate | bos_rate | both | only_ifvg | only_bos | neither |
|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 4138 | 40.48 | 54.57 | 17.01 | 23.47 | 37.55 | 21.97 |
| Asia | low_sweep | 4016 | 37.18 | 56.10 | 16.41 | 20.77 | 39.69 | 23.13 |
| London | high_sweep | 3046 | 40.68 | 50.62 | 15.63 | 25.05 | 35.00 | 24.33 |
| London | low_sweep | 2884 | 35.78 | 55.37 | 15.19 | 20.60 | 40.19 | 24.03 |
| NY | high_sweep | 3551 | 41.26 | 54.15 | 17.69 | 23.57 | 36.47 | 22.28 |
| NY | low_sweep | 3364 | 35.79 | 52.44 | 13.94 | 21.85 | 38.50 | 25.71 |

_Rates in %. `both`/`only_*`/`neither` partition the same events — they sum to 100._

### T3. iFVG x BoS agreement matrix (all events, all sessions)

| cell | events | share_pct |
|---|---|---|
| both fire | 3374 | 16.07 |
| only iFVG | 4734 | 22.54 |
| only BoS | 7963 | 37.92 |
| neither | 4928 | 23.47 |

**Timing offset when both fire** (iFVG delay − BoS delay, bars of 5m; negative = iFVG first): n=3,374, median -6, p25 -10, p75 -1, iFVG-first 81.9%, same-bar 9.5%, BoS-first 8.6%.

| level_session | n | median | p25 | p75 | p90 | mean |
|---|---|---|---|---|---|---|
| Asia | 1363.00 | -5.00 | -10.00 | -1.00 | 0.00 | -5.27 |
| London | 914.00 | -6.00 | -9.00 | -2.00 | 0.00 | -5.54 |
| NY | 1097.00 | -6.00 | -10.00 | -1.00 | 0.00 | -5.48 |

### T4. Reverse move from the sweep's own wick extreme, 2h horizon (ALL take-outs, unconditional on confirmation)

| level_session | direction | rev_atr_n | rev_atr_median | rev_atr_p25 | rev_atr_p75 | rev_atr_p90 | rev_atr_mean | rev_pct_median | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|---|---|
| Asia | high_sweep | 4138 | 3.34 | 2.05 | 5.08 | 7.43 | 4.00 | 0.70 | 1.59 | 1.20 |
| Asia | low_sweep | 4016 | 3.36 | 2.07 | 4.91 | 6.86 | 3.84 | 0.76 | 1.49 | 1.41 |
| London | high_sweep | 3046 | 3.02 | 1.87 | 4.51 | 6.44 | 3.52 | 0.74 | 1.43 | 1.03 |
| London | low_sweep | 2884 | 3.03 | 1.97 | 4.29 | 6.01 | 3.44 | 0.84 | 1.27 | 1.42 |
| NY | high_sweep | 3551 | 3.24 | 2.03 | 4.91 | 7.08 | 3.85 | 0.70 | 1.56 | 1.26 |
| NY | low_sweep | 3364 | 3.44 | 2.20 | 4.92 | 6.66 | 3.84 | 0.85 | 1.34 | 1.62 |

_`rev` = max favourable excursion away from the swept level (the reversal), `adv` = max continuation past the wick extreme, `end` = signed close at +2h. ATR = ATR(14) on 5m as of the take-out bar._

### T5. Reverse move split by confirmation method

| method | level_session | n | rev_atr_median | rev_atr_p75 | rev_atr_p90 | rev_pct_median | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|
| iFVG | Asia | 3168 | 2.18 | 3.35 | 4.96 | 0.48 | 3.29 | -0.26 |
| iFVG | London | 2271 | 2.04 | 3.03 | 4.34 | 0.53 | 2.94 | -0.21 |
| iFVG | NY | 2669 | 2.29 | 3.43 | 4.85 | 0.53 | 3.25 | -0.18 |
| BoS | Asia | 4511 | 4.32 | 6.13 | 8.62 | 0.91 | 0.80 | 2.74 |
| BoS | London | 3139 | 3.89 | 5.37 | 7.48 | 1.00 | 0.62 | 2.58 |
| BoS | NY | 3687 | 4.23 | 5.96 | 8.11 | 0.96 | 0.67 | 2.85 |
| both | Asia | 1363 | 2.76 | 4.26 | 6.48 | 0.55 | 2.62 | 1.08 |
| both | London | 914 | 2.49 | 3.94 | 5.66 | 0.62 | 2.41 | 1.04 |
| both | NY | 1097 | 2.86 | 4.26 | 6.02 | 0.61 | 2.76 | 1.13 |
| neither | Asia | 1838 | 3.01 | 4.09 | 5.20 | 0.68 | 1.56 | 0.27 |
| neither | London | 1434 | 2.73 | 3.67 | 4.81 | 0.74 | 1.39 | 0.24 |
| neither | NY | 1656 | 3.06 | 4.15 | 5.29 | 0.76 | 1.40 | 0.57 |
| ALL take-outs | Asia | 8154 | 3.35 | 4.99 | 7.13 | 0.72 | 1.54 | 1.31 |
| ALL take-outs | London | 5930 | 3.02 | 4.41 | 6.21 | 0.79 | 1.36 | 1.23 |
| ALL take-outs | NY | 6915 | 3.34 | 4.92 | 6.86 | 0.77 | 1.47 | 1.42 |

### T6. Reverse move by asset (all take-outs)

| symbol | direction | n | rev_atr_median | rev_atr_p90 | rev_pct_median | rev_pct_p90 | adv_atr_median |
|---|---|---|---|---|---|---|---|
| BNBUSDT | high_sweep | 2721 | 3.11 | 6.60 | 0.56 | 1.49 | 1.61 |
| BNBUSDT | low_sweep | 2579 | 3.24 | 6.45 | 0.68 | 1.86 | 1.55 |
| BTCUSDT | high_sweep | 2660 | 3.45 | 7.66 | 0.57 | 1.56 | 1.64 |
| BTCUSDT | low_sweep | 2536 | 3.50 | 6.86 | 0.64 | 1.69 | 1.35 |
| ETHUSDT | high_sweep | 2644 | 3.33 | 7.30 | 0.78 | 2.04 | 1.40 |
| ETHUSDT | low_sweep | 2487 | 3.47 | 6.59 | 0.90 | 2.24 | 1.21 |
| SOLUSDT | high_sweep | 2710 | 3.00 | 6.34 | 1.03 | 2.69 | 1.50 |
| SOLUSDT | low_sweep | 2662 | 2.97 | 6.17 | 1.08 | 2.90 | 1.43 |

_The ATR column is the comparable one; the % column shows why (raw % differs across assets purely through volatility)._

### T7. Session in which the take-out HAPPENS (vs. which session's level)

| sweep_session | n | share_pct | ifvg_rate | bos_rate | rev_atr_median | rev_atr_p90 | adv_atr_median | end_atr_median |
|---|---|---|---|---|---|---|---|---|
| Asia | 3712 | 17.68 | 38.71 | 53.29 | 3.26 | 6.51 | 1.40 | 1.48 |
| London | 5315 | 25.31 | 39.30 | 56.91 | 3.43 | 7.12 | 1.55 | 1.39 |
| London/NY overlap | 2873 | 13.68 | 39.54 | 49.74 | 3.25 | 7.67 | 1.79 | 1.03 |
| NY | 5845 | 27.83 | 37.11 | 53.62 | 3.01 | 6.16 | 1.23 | 1.24 |
| off-session | 3254 | 15.50 | 39.24 | 54.43 | 3.45 | 6.78 | 1.54 | 1.48 |

### T7b. Lift over the unconditional baseline, by clock session

| clock_session | direction | n | cond_rev_atr_median | uncond_atr_median | lift |
|---|---|---|---|---|---|
| Asia | high_sweep | 2030 | 3.183 | 2.504 | 1.271 |
| Asia | low_sweep | 1682 | 3.393 | 2.500 | 1.357 |
| London | high_sweep | 2847 | 3.467 | 2.857 | 1.214 |
| London | low_sweep | 2468 | 3.391 | 2.741 | 1.237 |
| London/NY overlap | high_sweep | 1362 | 3.260 | 2.930 | 1.112 |
| London/NY overlap | low_sweep | 1511 | 3.221 | 2.685 | 1.199 |
| NY | high_sweep | 2836 | 2.947 | 2.281 | 1.292 |
| NY | low_sweep | 3009 | 3.066 | 2.330 | 1.316 |
| off-session | high_sweep | 1660 | 3.306 | 2.548 | 1.297 |
| off-session | low_sweep | 1594 | 3.579 | 2.587 | 1.384 |

_`lift` = conditional median / same-clock-session unconditional median. This is the honest way to read the user's NY/Asia prior: raw medians are confounded by how volatile each clock session is to begin with._

### T8. Take-out → confirmation delay (bars of 5m; window capped at 24 = 2h)

| method | level_session | n | median_bars | p25 | p75 | p90 | median_min |
|---|---|---|---|---|---|---|---|
| iFVG | ALL | 8108 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | Asia | 3168 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | London | 2271 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| iFVG | NY | 2669 | 13.00 | 8.00 | 18.00 | 22.00 | 65.00 |
| BoS | ALL | 11337 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | Asia | 4511 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | London | 3139 | 14.00 | 10.00 | 19.00 | 22.00 | 70.00 |
| BoS | NY | 3687 | 15.00 | 10.00 | 19.00 | 22.00 | 75.00 |

### T9. Unconditional yardstick — same 2h horizon, measured from EVERY bar

| clock_session | bars | down_atr_median | down_atr_p90 | up_atr_median | up_atr_p90 |
|---|---|---|---|---|---|
| Asia | 561024 | 2.50 | 6.49 | 2.50 | 6.28 |
| London | 350640 | 2.86 | 7.34 | 2.74 | 7.10 |
| London/NY overlap | 210384 | 2.93 | 7.85 | 2.69 | 7.30 |
| NY | 350640 | 2.28 | 6.12 | 2.33 | 5.69 |
| off-session | 210288 | 2.55 | 6.77 | 2.59 | 6.58 |
| ALL BARS | 1682976 | 2.58 | 6.82 | 2.54 | 6.51 |

_Context only, not a gate: `down_atr` is the drop from a bar's high over the next 2h (the high-sweep analogue), `up_atr` the rise from a bar's low._

Side by side — high-sweep reverse move median **3.21 ATR** vs unconditional down-move median **2.58 ATR**; low-sweep **3.28 ATR** vs unconditional up-move **2.54 ATR**.

### T10. Monthly sweep counts (all assets, both directions)

Full table in `results/t10_monthly_counts.csv` (48 months). Per-month totals: median 436, min 390, max 500; monthly iFVG rate ranges 28–47%, BoS 46–61%. See chart 07.

### T11. Sensitivity — strict vs relaxed iFVG location test

| variant | rate_pct | rev_atr_median |
|---|---|---|
| strict (whole gap beyond the level) | 38.61 | 2.17 |
| relaxed (gap merely reaches beyond) | 47.45 | 2.46 |

### T12. Reverse move measured from each method's CONFIRMATION close (secondary — what a trader entering on the signal would see)

| method | level_session | n | mfe_atr_median | mfe_atr_p90 | mae_atr_median | mfe_over_mae |
|---|---|---|---|---|---|---|
| IFVG | ALL | 8108 | 2.12 | 5.89 | 2.08 | 1.02 |
| IFVG | Asia | 3168 | 2.19 | 6.36 | 2.23 | 0.98 |
| IFVG | London | 2271 | 1.95 | 5.40 | 1.87 | 1.04 |
| IFVG | NY | 2669 | 2.18 | 5.70 | 2.07 | 1.05 |
| BOS | ALL | 11336 | 1.80 | 5.68 | 1.89 | 0.95 |
| BOS | Asia | 4511 | 1.91 | 6.19 | 2.02 | 0.94 |
| BOS | London | 3139 | 1.68 | 5.09 | 1.80 | 0.93 |
| BOS | NY | 3686 | 1.79 | 5.32 | 1.84 | 0.97 |

_MFE/MAE over the 2h following the confirmation bar's close, in ATR(14) units._

### T13. Stop distance and R proxy at the confirmation bar

| method | level_session | n | stop_atr_median | stop_atr_p90 | R_median | R_p75 | share_R_ge_1 | share_R_ge_2 |
|---|---|---|---|---|---|---|---|---|
| IFVG | ALL | 8108 | 2.53 | 4.90 | 0.81 | 1.48 | 41.06 | 14.97 |
| IFVG | Asia | 3168 | 2.57 | 4.89 | 0.83 | 1.52 | 41.86 | 16.32 |
| IFVG | London | 2271 | 2.35 | 4.54 | 0.82 | 1.48 | 41.57 | 14.97 |
| IFVG | NY | 2669 | 2.64 | 5.16 | 0.79 | 1.41 | 39.68 | 13.38 |
| BOS | ALL | 11336 | 3.76 | 6.48 | 0.47 | 0.89 | 20.80 | 5.46 |
| BOS | Asia | 4511 | 3.84 | 6.57 | 0.49 | 0.93 | 22.81 | 6.10 |
| BOS | London | 3139 | 3.48 | 5.95 | 0.47 | 0.88 | 20.52 | 5.07 |
| BOS | NY | 3686 | 3.91 | 6.73 | 0.44 | 0.84 | 18.58 | 5.02 |

_Stop = distance from the confirmation close back to the sweep leg's running extreme (take-out bar .. confirmation bar). `R` = 2h MFE / that stop distance. `share_R_ge_1` = % of confirmed events where price travelled at least one stop distance in the favourable direction within 2h. Descriptive only — no costs, no exit rule, not a backtest._

---

## 5. Reading the tables — what actually stands out

**5.1 The two methods are not two views of the same thing (T2, T3, chart 03/06).**
The backlog's open question was "iFVG vs BoS — which confirms a sweep?". The
honest answer from the overlap matrix is that they mostly confirm *different*
take-outs: 38% BoS-only, 23% iFVG-only, 16% both. A strategy that requires both
throws away 84% of take-outs; one that accepts either fires on 77% of them, which
is close to firing on everything. This is the single most decision-relevant number
in the package and it was not knowable before this pass.

**5.2 The subset medians in T5 are a selection artefact, and must not be read as
"BoS predicts bigger reversals".** BoS-confirmed events show a 4.2 ATR reverse
move vs 2.2 ATR for iFVG-confirmed — but a bearish BoS *is* a close below a prior
pivot, i.e. the reversal has already happened by definition. Symmetrically, iFVG
events show a large *continuation* (adv 3.3 ATR): the strict iFVG rule needs an
impulse up beyond the level to create the gap that later inverts, so the take-out
wick is usually *not* the leg's extreme. Both effects are mechanical. T12 and T13,
measured from the confirmation bar, are the comparison that is not contaminated
this way.

**5.3 From the confirmation bar, neither method looks obviously tradable as-is
(T12, T13, chart 05b/05c).** MFE/MAE ≈ 1 over 2h for both. Against a stop at the
sweep leg's extreme, iFVG's median R is 0.81 with 41% of events reaching 1R and
15% reaching 2R; BoS's is 0.47 / 21% / 5%. iFVG is clearly the better of the two
on this measure — earlier, tighter stop — but 0.81R median with no cost model is
not a green light, it is a starting point for the design phase.

**5.4 The session prior (T7, T7b, chart 08).** Raw medians rank London > Asia >
overlap > NY. Lift over the same-clock-session unconditional baseline ranks
off-session (1.30/1.38) > NY (1.29/1.32) > Asia (1.27/1.36) > London (1.21/1.24)
> overlap (1.11/1.20). So NY and Asia *are* the sessions where a sweep tells you
the most relative to background volatility — the user's prior is supported in that
sense — while the London/NY overlap is where a sweep tells you the least. The
21:00–24:00 off-session bucket scoring highest is worth a second look in the
design phase (thin book, 15.5% of events); it was not part of the original
hypothesis and is reported here only as an observation.

**5.5 Timing (T8, chart 06).** Median confirmation delay is 13 bars (65 min) for
iFVG and 14 bars (70 min) for BoS, both with a long right tail pressed against
the 24-bar cap (p90 = 22 bars). A meaningful share of confirmations are landing
at the very edge of the window, so **D4 is a live parameter, not a neutral
choice**: widening the window would add events and lengthen the average delay.

**5.6 Stability (T10, chart 07).** Monthly counts are flat (median 436/month,
range 390–500) with no trend; monthly iFVG rate 28–47%, BoS 46–61%. Nothing here
is a regime artefact of one period.

**5.7 Direction symmetry.** High and low sweeps behave nearly identically
(medians within 0.1–0.2 ATR everywhere), which is a mild sanity check that the
detector is not one-sided.

---

## 6. Doubts, limits, and what would change these numbers

- **Selection, not signal.** Take-out bars are by construction bars that made a
  new extreme — high-range bars. Part of the 1.25× lift over the unconditional
  baseline is that mechanical fact, not liquidity-sweep behaviour. The
  unconditional column is a *yardstick for context*, and this pass deliberately
  does not attempt to separate the two. A properly matched control (e.g. bars
  with the same ATR-normalised range but no level nearby) is the obvious next
  measurement and is **not** in this package.
- **D5 moves the iFVG numbers materially**: strict 38.6% confirmation rate vs
  relaxed 47.5% (T11). Any downstream design must state which reading it uses.
- **D4 caps the delay distribution** — see 5.5.
- **No costs, no slippage, no exit rule, no position sizing** anywhere. `R` in
  T13 is a geometric proxy (2h MFE ÷ stop distance), not a backtested return.
  It cannot be annualised, compounded, or compared to a strategy result.
- **Perp-only, 4 large-cap symbols, one venue.** Session definitions are UTC
  fixed windows with no DST handling (crypto trades continuously, so the forex
  session convention is an approximation imposed on the tape, not a property of it).
- **`n_levels_taken` > 1 on 18% of events** — D2 collapses those into one event.
  A design that treats "swept 3 levels at once" differently from "swept 1" would
  need the raw pool, which the engine records but the tables do not break out.
- The Pine indicator has **not been compiled by me** — it is written against the
  v6 reference and mirrors the Python definitions, but the user's first paste
  into TradingView is its first compile. See `RUNBOOK.md` §4 for what to check.

---

## 7. Reproducing

```bash
python3 -m venv .venv && .venv/bin/pip install pandas numpy matplotlib
ln -s ../intraday-mtf-smc/data research/session-liquidity/data   # existing 5m pull
cd research/session-liquidity
../../.venv/bin/python engine.py     # ~30s  -> results/events_*.csv, uncond_*.csv.gz
../../.venv/bin/python tables.py     # -> results/t*.csv + results/TABLES.md
../../.venv/bin/python charts.py     # -> viz/02..09_*.png
../../.venv/bin/python examples.py   # -> viz/ex01..ex08_*.png
../../.venv/bin/python checks.py      # hygiene assertions -- must all pass
```

`common.py` imports `atr()` and `fractals()` from
`research/intraday-mr-smc/indicators.py` directly — the primitives are reused,
never re-implemented.

---

## 8. Where this goes next

`HANDOFF.md` carries the routing note to the Architect for the strategy-design
phase, with the three design questions these numbers actually pose.
