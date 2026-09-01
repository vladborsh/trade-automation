# Pre-registered hypothesis test — session-liquidity v5-NY

Everything below was fixed in `DESIGN.md` §3–§7 **before any result existed** (commit `Pre-register the session-liquidity v5-NY pass`). The holdout was computed once, at the end, and is reported as it came out.

**Window:** 13:40–15:20 UTC (= 09:40–11:20 New York at the pinned fixed offset UTC−4). **Trade:** entry at the confirmation close, stop at the sweep leg's running extreme over `[t0, u]`, target +1R, same-bar tie booked as a loss, 0.10% round-trip cost. **Population:** BTC+ETH, primary sample (≥12 bars remaining).

**Self-test:** the vectorised template used by the null reproduces the engine's scalar template on **7,114 of 7,114** real trades (PASS). Without this the null would be testing a different rule than the observation.


## P1 — The trades (BTC+ETH, NY window, pinned template)

`mean netR` is the pre-registered primary metric: expectancy per trade in units of the risk taken, after 0.10% round-trip cost. A `target` exit is +1R, a `stop` exit −1R, `mtm` is marked to market at the horizon's last close.

| arm | horizon | period | n | mean_netR | median_netR | mean_grossR | mean_cost_R | win_rate | pct_target | pct_stop | pct_mtm | median_stop_atr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iFVG-v4 | block-scoped (PRIMARY) | fit | 759 | -0.174 | 0.017 | 0.020 | 0.194 | 50.198 | 45.850 | 44.005 | 10.145 | 3.055 |
| iFVG-v4 | block-scoped (PRIMARY) | holdout | 297 | -0.261 | -0.629 | -0.073 | 0.188 | 44.781 | 41.414 | 48.822 | 9.764 | 3.178 |
| iFVG-v4 | block-scoped (PRIMARY) | full | 1056 | -0.198 | -0.155 | -0.006 | 0.192 | 48.674 | 44.602 | 45.360 | 10.038 | 3.089 |
| iFVG-v4 | 24h (secondary) | fit | 759 | -0.173 | 0.119 | 0.021 | 0.194 | 50.856 | 49.407 | 47.431 | 3.162 | 3.055 |
| iFVG-v4 | 24h (secondary) | holdout | 297 | -0.271 | -1.055 | -0.083 | 0.188 | 45.791 | 44.108 | 52.189 | 3.704 | 3.178 |
| iFVG-v4 | 24h (secondary) | full | 1056 | -0.200 | -0.162 | -0.008 | 0.192 | 49.432 | 47.917 | 48.769 | 3.314 | 3.089 |
| BoS pinned anchor | block-scoped (PRIMARY) | fit | 559 | -0.139 | -0.136 | -0.021 | 0.118 | 46.154 | 34.526 | 35.599 | 29.875 | 5.642 |
| BoS pinned anchor | block-scoped (PRIMARY) | holdout | 209 | -0.019 | 0.034 | 0.090 | 0.109 | 50.239 | 41.148 | 30.622 | 28.230 | 5.579 |
| BoS pinned anchor | block-scoped (PRIMARY) | full | 768 | -0.107 | -0.085 | 0.009 | 0.116 | 47.266 | 36.328 | 34.245 | 29.427 | 5.625 |
| BoS pinned anchor | 24h (secondary) | fit | 559 | -0.164 | -0.311 | -0.046 | 0.118 | 45.438 | 41.503 | 45.259 | 13.238 | 5.642 |
| BoS pinned anchor | 24h (secondary) | holdout | 209 | -0.037 | 0.235 | 0.072 | 0.109 | 54.067 | 48.325 | 40.670 | 11.005 | 5.579 |
| BoS pinned anchor | 24h (secondary) | full | 768 | -0.130 | -0.147 | -0.014 | 0.116 | 47.786 | 43.359 | 44.010 | 12.630 | 5.625 |


## P2 — Null A, Null B and the bootstrap interval

**Null A (primary)** replaces every trade with one entered at a random bar inside the *same* NY window on a *different* date, same asset, same side, same stop width in ATR, same horizon, same costs. It holds the clock, the risk and the direction mix fixed and destroys only the alignment with a real swept level — so it answers exactly the question that matters: does the sweep-confirmation add anything over entering at a random moment in the same window? `p` is the share of 1,000 draws whose mean netR was at least as good as the observed one.

**Null B** shifts the whole confirmation stream forward by k whole days and re-runs it at the same clock time. **Bootstrap** resamples whole UTC days, 2,000 draws, for a 90% interval on the observed mean.

| arm | horizon | n_holdout | mean_netR_holdout | nullA_mean | nullA_sd | nullA_p | nullB_p | boot_lo90 | boot_hi90 | n_fit | mean_netR_fit | nullA_p_fit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| iFVG-v4 | block-scoped (PRIMARY) | 297 | -0.2610 | -0.1834 | 0.0558 | 0.9100 | 0.8920 | -0.3784 | -0.1456 | 759 | -0.1736 | 0.2230 |
| iFVG-v4 | 24h (secondary) | 297 | -0.2710 | -0.1867 | 0.0587 | 0.9230 | 0.8920 | -0.3926 | -0.1485 | 759 | -0.1728 | 0.2360 |
| BoS pinned anchor | block-scoped (PRIMARY) | 209 | -0.0193 | -0.1047 | 0.0574 | 0.0700 | 0.1240 | -0.1322 | 0.0916 | 559 | -0.1393 | 0.8700 |
| BoS pinned anchor | 24h (secondary) | 209 | -0.0370 | -0.1036 | 0.0661 | 0.1600 | 0.2480 | -0.1651 | 0.0935 | 559 | -0.1644 | 0.9320 |


## P3 — The verdict ladder (DESIGN §7), applied mechanically

Kill threshold **mean netR < +0.05R** or **p > 0.2**; 'real edge' requires **p ≤ 0.0125** (Bonferroni over the four primary numbers) **and** a fit period that agrees. Minimum 150 holdout trades.

* **iFVG-v4 · block-scoped (PRIMARY)** — **NO EDGE — KILL.** holdout mean netR -0.261R < the pre-registered +0.05R kill threshold.
* **iFVG-v4 · 24h (secondary)** — **NO EDGE — KILL.** holdout mean netR -0.271R < the pre-registered +0.05R kill threshold.
* **BoS pinned anchor · block-scoped (PRIMARY)** — **NO EDGE — KILL.** holdout mean netR -0.019R < the pre-registered +0.05R kill threshold.
* **BoS pinned anchor · 24h (secondary)** — **NO EDGE — KILL.** holdout mean netR -0.037R < the pre-registered +0.05R kill threshold.


## P4 — Robustness appendix (NOT the pre-registered population)

DESIGN §2.3 pins the test to pooled BTC+ETH. These rows exist so a reader can see whether the same sign shows up elsewhere; they are not the primary number and no verdict is drawn from them.

| arm | scope | n_fit | mean_fit | n_hold | mean_hold | n_all | mean_all |
|---|---|---|---|---|---|---|---|
| iFVG-v4 | BTC+ETH (primary) | 759 | -0.174 | 297 | -0.261 | 1056 | -0.198 |
| iFVG-v4 | ALL 4 assets | 1526 | -0.205 | 608 | -0.191 | 2134 | -0.201 |
| iFVG-v4 | BTCUSDT | 404 | -0.182 | 170 | -0.283 | 574 | -0.212 |
| iFVG-v4 | ETHUSDT | 355 | -0.164 | 127 | -0.231 | 482 | -0.181 |
| iFVG-v4 | SOLUSDT | 416 | -0.149 | 144 | -0.068 | 560 | -0.128 |
| iFVG-v4 | BNBUSDT | 351 | -0.340 | 167 | -0.173 | 518 | -0.286 |
| BoS pinned anchor | BTC+ETH (primary) | 559 | -0.139 | 209 | -0.019 | 768 | -0.107 |
| BoS pinned anchor | ALL 4 assets | 1018 | -0.124 | 405 | -0.018 | 1423 | -0.093 |
| BoS pinned anchor | BTCUSDT | 313 | -0.124 | 114 | -0.049 | 427 | -0.104 |
| BoS pinned anchor | ETHUSDT | 246 | -0.159 | 95 | 0.016 | 341 | -0.110 |
| BoS pinned anchor | SOLUSDT | 236 | -0.154 | 108 | 0.164 | 344 | -0.054 |
| BoS pinned anchor | BNBUSDT | 223 | -0.053 | 88 | -0.237 | 311 | -0.105 |


## P5 — Sensitivities actually run (count them; that is the point)

Every cut run in this pass is listed here, including the ones that looked worse, so the reader can count the comparisons behind any p-value (block-scoped horizon, BTC+ETH).

| arm | cut | n | mean_netR_all | n_hold | mean_netR_hold |
|---|---|---|---|---|---|
| iFVG-v4 | NY window UTC−4 (pinned) | 1056 | -0.198 | 297 | -0.261 |
| iFVG-v4 | NY window UTC−5 (sensitivity) | 1214 | -0.279 | 322 | -0.394 |
| iFVG-v4 | all hours (no window filter) | 6561 | -0.216 | 1735 | -0.238 |
| BoS pinned anchor | NY window UTC−4 (pinned) | 768 | -0.107 | 209 | -0.019 |
| BoS pinned anchor | NY window UTC−5 (sensitivity) | 633 | -0.025 | 176 | 0.034 |
| BoS pinned anchor | all hours (no window filter) | 3525 | -0.100 | 843 | -0.091 |


## P6 — Post-hoc diagnostics: is the verdict just the fees, or just the tie rule?

Neither of these changes the pre-registered result — DESIGN §4 pinned tie = LOSS and a 0.10% round trip, and that stands. They are computed **after** the verdict, to answer the two objections a reader will raise on seeing a negative expectancy.

| arm | n | pct_same_bar_tie | mean_cost_R | pinned_net | pinned_gross | tie_as_win_net | tie_as_win_gross |
|---|---|---|---|---|---|---|---|
| iFVG-v4 | 1056 | 0.000 | 0.192 | -0.198 | -0.006 | -0.198 | -0.006 |
| BoS pinned anchor | 768 | 0.000 | 0.116 | -0.107 | 0.009 | -0.107 | 0.009 |

`pct_same_bar_tie` settles the second objection outright: the stop and the target sit 2R apart, and a single 5-minute bar essentially never spans that, so the pinned tie = LOSS rule **never binds** and the 'tie as win' columns are identical to the pinned ones.

The first objection is the real one, and it points at the honest finding: **gross expectancy is approximately zero** (see `pinned_gross`), and the 0.10% round trip — which is 12–19% of the risk taken, because these stops are only 3–6 ATR wide — is what makes the net number negative. There is no version of this where the signal carries the costs.

