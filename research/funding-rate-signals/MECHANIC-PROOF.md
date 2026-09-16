# MECHANIC-PROOF — `funding-rate-signals`

Twenty fit-period trades, ten per hypothesis, split across both tiers, each printed with its **full settlement ledger** and its four-leg decomposition re-derived by hand from the printed inputs (DESIGN §10 step 3). Trades are chosen by a **fixed stride** through each tier's trade list — outcome-blind, before any R is looked at.

`checks.py` results are in `results/checks.csv`; all ten assertions pass. Everything below is **fit period only**.

---

## Hypothesis A — ten trades

#### tier: majors

### A · BTCUSDT · SHORT · signal 2020-01-16 16:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.000315` (+0.0315 %/8h), `fpct_k = 0.958`, `spct_k = nan`.
* Previous settlement `k-1` 2020-01-16 08:00:00+00:00: `f = +0.000412`, `fpct = 0.979` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2020-01-16 16:00:00+00:00, i.e. `t_entry = 2020-01-16 17:00:00+00:00` (one full bar of lag). `entry = 8666.95`.
* **Risk unit** `dATR14` (prior completed UTC day) = 382.646; `stop_dist = 1.5 x dATR14 = 573.969` = **1R**; `stop = 9240.92`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-01-16 17:00:00+00:00 < t_j < 2020-01-17 01:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-01-17 00:00:00+00:00 | +0.000100 | 8724.99 | +0.001520 | collected |
| | | **sum** | **+0.001520** | engine `fundingR = +0.001520` |

* **Exit** — cause `lapse`, `t_exit = 2020-01-17 01:00:00+00:00`, `exit_px = 8695`, hold 8 h, 1 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (8695 - 8666.95) / 573.969 = -0.0489`; `fundingR = +0.0015`; `costR = 0.001 x 8666.95 / 573.969 = +0.0151`; **`netR = -0.0489 +0.0015 - 0.0151 = -0.0625`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### A · BTCUSDT · SHORT · signal 2020-05-08 16:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.000532` (+0.0532 %/8h), `fpct_k = 0.989`, `spct_k = 0.867`.
* Previous settlement `k-1` 2020-05-08 08:00:00+00:00: `f = +0.000340`, `fpct = 0.978` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2020-05-08 16:00:00+00:00, i.e. `t_entry = 2020-05-08 17:00:00+00:00` (one full bar of lag). `entry = 9982.92`.
* **Risk unit** `dATR14` (prior completed UTC day) = 494.781; `stop_dist = 1.5 x dATR14 = 742.171` = **1R**; `stop = 10725.1`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-05-08 17:00:00+00:00 < t_j < 2020-05-10 09:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-05-09 00:00:00+00:00 | +0.000420 | 9809.63 | +0.005556 | collected |
| 2020-05-09 08:00:00+00:00 | +0.000758 | 9608.49 | +0.009815 | collected |
| 2020-05-09 16:00:00+00:00 | +0.000580 | 9697.3 | +0.007581 | collected |
| 2020-05-10 00:00:00+00:00 | +0.000423 | 9550.25 | +0.005447 | collected |
| 2020-05-10 08:00:00+00:00 | +0.000100 | 8805.67 | +0.001186 | collected |
| | | **sum** | **+0.029585** | engine `fundingR = +0.029585` |

* **Exit** — cause `lapse`, `t_exit = 2020-05-10 09:00:00+00:00`, `exit_px = 8808.82`, hold 40 h, 5 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (8808.82 - 9982.92) / 742.171 = +1.5820`; `fundingR = +0.0296`; `costR = 0.001 x 9982.92 / 742.171 = +0.0135`; **`netR = +1.5820 +0.0296 - 0.0135 = +1.5981`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### A · BTCUSDT · SHORT · signal 2020-11-22 00:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.000804` (+0.0804 %/8h), `fpct_k = 1.000`, `spct_k = 0.411`.
* Previous settlement `k-1` 2020-11-21 16:00:00+00:00: `f = +0.000594`, `fpct = 1.000` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2020-11-22 00:00:00+00:00, i.e. `t_entry = 2020-11-22 01:00:00+00:00` (one full bar of lag). `entry = 18575`.
* **Risk unit** `dATR14` (prior completed UTC day) = 809.247; `stop_dist = 1.5 x dATR14 = 1213.87` = **1R**; `stop = 19788.9`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-11-22 01:00:00+00:00 < t_j < 2020-11-27 09:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-11-22 08:00:00+00:00 | +0.000870 | 18524.4 | +0.013274 | collected |
| 2020-11-22 16:00:00+00:00 | +0.000665 | 18310 | +0.010036 | collected |
| 2020-11-23 00:00:00+00:00 | +0.001012 | 18434.2 | +0.015361 | collected |
| 2020-11-23 08:00:00+00:00 | +0.000762 | 18481.3 | +0.011603 | collected |
| 2020-11-23 16:00:00+00:00 | +0.001084 | 18283.3 | +0.016326 | collected |
| 2020-11-24 00:00:00+00:00 | +0.000508 | 18382.1 | +0.007693 | collected |
| 2020-11-24 08:00:00+00:00 | +0.000604 | 18382 | +0.009141 | collected |
| 2020-11-24 16:00:00+00:00 | +0.000812 | 19369.2 | +0.012953 | collected |
| 2020-11-25 00:00:00+00:00 | +0.000842 | 19178.5 | +0.013309 | collected |
| 2020-11-25 08:00:00+00:00 | +0.000381 | 18991.6 | +0.005958 | collected |
| 2020-11-25 16:00:00+00:00 | +0.000753 | 19148.3 | +0.011877 | collected |
| 2020-11-26 00:00:00+00:00 | +0.000354 | 18741.7 | +0.005468 | collected |
| 2020-11-26 08:00:00+00:00 | +0.000131 | 17646.2 | +0.001909 | collected |
| 2020-11-26 16:00:00+00:00 | +0.000288 | 16919 | +0.004014 | collected |
| 2020-11-27 00:00:00+00:00 | +0.000108 | 17155.4 | +0.001523 | collected |
| 2020-11-27 08:00:00+00:00 | +0.000100 | 17106.8 | +0.001409 | collected |
| | | **sum** | **+0.141853** | engine `fundingR = +0.141853` |

* **Exit** — cause `lapse`, `t_exit = 2020-11-27 09:00:00+00:00`, `exit_px = 16857.8`, hold 128 h, 16 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (16857.8 - 18575) / 1213.87 = +1.4147`; `fundingR = +0.1419`; `costR = 0.001 x 18575 / 1213.87 = +0.0153`; **`netR = +1.4147 +0.1419 - 0.0153 = +1.5412`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### A · ETHUSDT · SHORT · signal 2021-04-10 16:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.001203` (+0.1203 %/8h), `fpct_k = 0.922`, `spct_k = 0.856`.
* Previous settlement `k-1` 2021-04-10 08:00:00+00:00: `f = +0.002097`, `fpct = 1.000` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2021-04-10 16:00:00+00:00, i.e. `t_entry = 2021-04-10 17:00:00+00:00` (one full bar of lag). `entry = 2157.49`.
* **Risk unit** `dATR14` (prior completed UTC day) = 127.524; `stop_dist = 1.5 x dATR14 = 191.287` = **1R**; `stop = 2348.78`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-04-10 17:00:00+00:00 < t_j < 2021-04-14 03:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-04-11 00:00:00+00:00 | +0.000559 | 2135.99 | +0.006241 | collected |
| 2021-04-11 08:00:00+00:00 | +0.000863 | 2132.56 | +0.009626 | collected |
| 2021-04-11 16:00:00+00:00 | +0.000911 | 2151.94 | +0.010250 | collected |
| 2021-04-12 00:00:00+00:00 | +0.000997 | 2155.07 | +0.011228 | collected |
| 2021-04-12 08:00:00+00:00 | +0.001645 | 2186.61 | +0.018805 | collected |
| 2021-04-12 16:00:00+00:00 | +0.000679 | 2122.03 | +0.007528 | collected |
| 2021-04-13 00:00:00+00:00 | +0.000471 | 2139.24 | +0.005272 | collected |
| 2021-04-13 08:00:00+00:00 | +0.001178 | 2167.9 | +0.013353 | collected |
| 2021-04-13 16:00:00+00:00 | +0.001676 | 2280.67 | +0.019983 | collected |
| 2021-04-14 00:00:00+00:00 | +0.001528 | 2303.15 | +0.018393 | collected |
| | | **sum** | **+0.120679** | engine `fundingR = +0.120679` |

* **Exit** — cause `stop`, `t_exit = 2021-04-14 03:01:00+00:00`, `exit_px = 2348.78`, hold 82 h, 10 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (2348.78 - 2157.49) / 191.287 = -1.0000`; `fundingR = +0.1207`; `costR = 0.001 x 2157.49 / 191.287 = +0.0113`; **`netR = -1.0000 +0.1207 - 0.0113 = -0.8906`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### A · ETHUSDT · LONG · signal 2022-11-10 00:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = -0.000601` (-0.0601 %/8h), `fpct_k = 0.011`, `spct_k = 0.022`.
* Previous settlement `k-1` 2022-11-09 16:00:00+00:00: `f = -0.000547`, `fpct = 0.011` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2022-11-10 00:00:00+00:00, i.e. `t_entry = 2022-11-10 01:00:00+00:00` (one full bar of lag). `entry = 1142.88`.
* **Risk unit** `dATR14` (prior completed UTC day) = 112.272; `stop_dist = 1.5 x dATR14 = 168.408` = **1R**; `stop = 974.472`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2022-11-10 01:00:00+00:00 < t_j < 2022-11-11 17:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2022-11-10 08:00:00+00:00 | -0.000543 | 1189.5 | +0.003835 | collected |
| 2022-11-10 16:00:00+00:00 | -0.000155 | 1321.24 | +0.001213 | collected |
| 2022-11-11 00:00:00+00:00 | -0.000168 | 1298.3 | +0.001294 | collected |
| 2022-11-11 08:00:00+00:00 | -0.000136 | 1277.84 | +0.001035 | collected |
| 2022-11-11 16:00:00+00:00 | +0.000029 | 1259.51 | -0.000215 | collected |
| | | **sum** | **+0.007162** | engine `fundingR = +0.007162` |

* **Exit** — cause `lapse`, `t_exit = 2022-11-11 17:00:00+00:00`, `exit_px = 1249.49`, hold 40 h, 5 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (1249.49 - 1142.88) / 168.408 = +0.6330`; `fundingR = +0.0072`; `costR = 0.001 x 1142.88 / 168.408 = +0.0068`; **`netR = +0.6330 +0.0072 - 0.0068 = +0.6334`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### A · XRPUSDT · SHORT · signal 2020-02-06 08:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.001852` (+0.1852 %/8h), `fpct_k = 0.989`, `spct_k = 0.544`.
* Previous settlement `k-1` 2020-02-06 00:00:00+00:00: `f = +0.001545`, `fpct = 0.933` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2020-02-06 08:00:00+00:00, i.e. `t_entry = 2020-02-06 09:00:00+00:00` (one full bar of lag). `entry = 0.2835`.
* **Risk unit** `dATR14` (prior completed UTC day) = 0.0150651; `stop_dist = 1.5 x dATR14 = 0.0225977` = **1R**; `stop = 0.306098`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-02-06 09:00:00+00:00 < t_j < 2020-02-12 18:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-02-06 16:00:00+00:00 | +0.001293 | 0.2797 | +0.015999 | collected |
| 2020-02-07 00:00:00+00:00 | +0.001218 | 0.2841 | +0.015312 | collected |
| 2020-02-07 08:00:00+00:00 | +0.001080 | 0.2824 | +0.013495 | collected |
| 2020-02-07 16:00:00+00:00 | +0.001945 | 0.2799 | +0.024089 | collected |
| 2020-02-08 00:00:00+00:00 | +0.000984 | 0.2799 | +0.012190 | collected |
| 2020-02-08 08:00:00+00:00 | +0.000318 | 0.2747 | +0.003869 | collected |
| 2020-02-08 16:00:00+00:00 | +0.000683 | 0.2773 | +0.008385 | collected |
| 2020-02-09 00:00:00+00:00 | +0.000910 | 0.2776 | +0.011174 | collected |
| 2020-02-09 08:00:00+00:00 | +0.000948 | 0.286 | +0.011994 | collected |
| 2020-02-09 16:00:00+00:00 | +0.001237 | 0.2805 | +0.015351 | collected |
| 2020-02-10 00:00:00+00:00 | +0.000848 | 0.2832 | +0.010622 | collected |
| 2020-02-10 08:00:00+00:00 | +0.001089 | 0.2767 | +0.013334 | collected |
| 2020-02-10 16:00:00+00:00 | +0.000739 | 0.2746 | +0.008981 | collected |
| 2020-02-11 00:00:00+00:00 | +0.000500 | 0.2737 | +0.006058 | collected |
| 2020-02-11 08:00:00+00:00 | +0.000637 | 0.2697 | +0.007603 | collected |
| 2020-02-11 16:00:00+00:00 | +0.000699 | 0.2782 | +0.008605 | collected |
| 2020-02-12 00:00:00+00:00 | +0.002713 | 0.2817 | +0.033819 | collected |
| 2020-02-12 08:00:00+00:00 | +0.004124 | 0.2892 | +0.052780 | collected |
| 2020-02-12 16:00:00+00:00 | +0.002254 | 0.2952 | +0.029441 | collected |
| | | **sum** | **+0.303104** | engine `fundingR = +0.303104` |

* **Exit** — cause `stop`, `t_exit = 2020-02-12 18:01:00+00:00`, `exit_px = 0.306098`, hold 153 h, 19 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (0.306098 - 0.2835) / 0.0225977 = -1.0000`; `fundingR = +0.3031`; `costR = 0.001 x 0.2835 / 0.0225977 = +0.0125`; **`netR = -1.0000 +0.3031 - 0.0125 = -0.7094`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### A · SOLUSDT · SHORT · signal 2020-10-25 00:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.000591` (+0.0591 %/8h), `fpct_k = 0.978`, `spct_k = 0.444`.
* Previous settlement `k-1` 2020-10-24 16:00:00+00:00: `f = +0.000890`, `fpct = 1.000` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2020-10-25 00:00:00+00:00, i.e. `t_entry = 2020-10-25 01:00:00+00:00` (one full bar of lag). `entry = 1.9133`.
* **Risk unit** `dATR14` (prior completed UTC day) = 0.236598; `stop_dist = 1.5 x dATR14 = 0.354897` = **1R**; `stop = 2.2682`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-10-25 01:00:00+00:00 < t_j < 2020-10-26 01:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-10-25 08:00:00+00:00 | +0.000273 | 1.8828 | +0.001450 | collected |
| 2020-10-25 16:00:00+00:00 | +0.000199 | 1.8433 | +0.001032 | collected |
| 2020-10-26 00:00:00+00:00 | +0.000100 | 1.7946 | +0.000506 | collected |
| | | **sum** | **+0.002987** | engine `fundingR = +0.002987` |

* **Exit** — cause `lapse`, `t_exit = 2020-10-26 01:00:00+00:00`, `exit_px = 1.8117`, hold 24 h, 3 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (1.8117 - 1.9133) / 0.354897 = +0.2863`; `fundingR = +0.0030`; `costR = 0.001 x 1.9133 / 0.354897 = +0.0054`; **`netR = +0.2863 +0.0030 - 0.0054 = +0.2839`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### A · XRPUSDT · SHORT · signal 2021-02-18 00:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.002671` (+0.2671 %/8h), `fpct_k = 0.978`, `spct_k = 0.567`.
* Previous settlement `k-1` 2021-02-17 16:00:00+00:00: `f = +0.002254`, `fpct = 0.933` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2021-02-18 00:00:00+00:00, i.e. `t_entry = 2021-02-18 01:00:00+00:00` (one full bar of lag). `entry = 0.5476`.
* **Risk unit** `dATR14` (prior completed UTC day) = 0.0789691; `stop_dist = 1.5 x dATR14 = 0.118454` = **1R**; `stop = 0.666054`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-02-18 01:00:00+00:00 < t_j < 2021-02-23 17:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-02-18 08:00:00+00:00 | +0.002441 | 0.5494 | +0.011322 | collected |
| 2021-02-18 16:00:00+00:00 | +0.001773 | 0.5301 | +0.007934 | collected |
| 2021-02-19 00:00:00+00:00 | +0.001601 | 0.533 | +0.007206 | collected |
| 2021-02-19 08:00:00+00:00 | +0.001262 | 0.5387 | +0.005738 | collected |
| 2021-02-19 16:00:00+00:00 | +0.002945 | 0.5495 | +0.013664 | collected |
| 2021-02-20 00:00:00+00:00 | +0.003156 | 0.5666 | +0.015095 | collected |
| 2021-02-20 08:00:00+00:00 | +0.003149 | 0.5665 | +0.015061 | collected |
| 2021-02-20 16:00:00+00:00 | +0.002400 | 0.5365 | +0.010871 | collected |
| 2021-02-21 00:00:00+00:00 | +0.000419 | 0.5118 | +0.001812 | collected |
| 2021-02-21 08:00:00+00:00 | +0.000885 | 0.5181 | +0.003872 | collected |
| 2021-02-21 16:00:00+00:00 | +0.001687 | 0.5404 | +0.007698 | collected |
| 2021-02-22 00:00:00+00:00 | +0.001222 | 0.546 | +0.005632 | collected |
| 2021-02-22 08:00:00+00:00 | +0.000969 | 0.5945 | +0.004862 | collected |
| 2021-02-22 16:00:00+00:00 | +0.000109 | 0.5547 | +0.000509 | collected |
| 2021-02-23 00:00:00+00:00 | +0.000935 | 0.5669 | +0.004473 | collected |
| 2021-02-23 08:00:00+00:00 | +0.000286 | 0.5164 | +0.001246 | collected |
| 2021-02-23 16:00:00+00:00 | +0.000100 | 0.4678 | +0.000395 | collected |
| | | **sum** | **+0.117392** | engine `fundingR = +0.117392` |

* **Exit** — cause `lapse`, `t_exit = 2021-02-23 17:00:00+00:00`, `exit_px = 0.4599`, hold 136 h, 17 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (0.4599 - 0.5476) / 0.118454 = +0.7404`; `fundingR = +0.1174`; `costR = 0.001 x 0.5476 / 0.118454 = +0.0046`; **`netR = +0.7404 +0.1174 - 0.0046 = +0.8531`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### A · BNBUSDT · SHORT · signal 2021-10-10 16:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = +0.000357` (+0.0357 %/8h), `fpct_k = 0.989`, `spct_k = 0.422`.
* Previous settlement `k-1` 2021-10-10 08:00:00+00:00: `f = +0.000352`, `fpct = 0.989` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2021-10-10 16:00:00+00:00, i.e. `t_entry = 2021-10-10 17:00:00+00:00` (one full bar of lag). `entry = 417.85`.
* **Risk unit** `dATR14` (prior completed UTC day) = 27.1735; `stop_dist = 1.5 x dATR14 = 40.7602` = **1R**; `stop = 458.61`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-10-10 17:00:00+00:00 < t_j < 2021-10-11 01:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-10-11 00:00:00+00:00 | +0.000000 | 404.11 | +0.000000 | collected |
| | | **sum** | **+0.000000** | engine `fundingR = +0.000000` |

* **Exit** — cause `lapse`, `t_exit = 2021-10-11 01:00:00+00:00`, `exit_px = 408.02`, hold 8 h, 1 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (408.02 - 417.85) / 40.7602 = +0.2412`; `fundingR = +0.0000`; `costR = 0.001 x 417.85 / 40.7602 = +0.0103`; **`netR = +0.2412 +0.0000 - 0.0103 = +0.2309`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### A · BNBUSDT · LONG · signal 2023-12-16 00:00:00+00:00

* **Trigger** — extreme funding at `k-1` and `k`. `f_k = -0.000620` (-0.0620 %/8h), `fpct_k = 0.011`, `spct_k = 0.089`.
* Previous settlement `k-1` 2023-12-15 16:00:00+00:00: `f = -0.000371`, `fpct = 0.056` — both slots present, so the two-settlement condition holds.
* **Entry** at the close of the bar opening at `t_k` = 2023-12-16 00:00:00+00:00, i.e. `t_entry = 2023-12-16 01:00:00+00:00` (one full bar of lag). `entry = 244.89`.
* **Risk unit** `dATR14` (prior completed UTC day) = 10.075; `stop_dist = 1.5 x dATR14 = 15.1125` = **1R**; `stop = 229.778`.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2023-12-16 01:00:00+00:00 < t_j < 2023-12-17 09:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2023-12-16 08:00:00+00:00 | -0.000298 | 246.6 | +0.004861 | collected |
| 2023-12-16 16:00:00+00:00 | -0.000172 | 246.28 | +0.002806 | collected |
| 2023-12-17 00:00:00+00:00 | -0.000390 | 244.16 | +0.006297 | collected |
| 2023-12-17 08:00:00+00:00 | +0.000000 | 240.31 | -0.000000 | collected |
| | | **sum** | **+0.013964** | engine `fundingR = +0.013964` |

* **Exit** — cause `lapse`, `t_exit = 2023-12-17 09:00:00+00:00`, `exit_px = 240.73`, hold 32 h, 4 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (240.73 - 244.89) / 15.1125 = -0.2753`; `fundingR = +0.0140`; `costR = 0.001 x 244.89 / 15.1125 = +0.0162`; **`netR = -0.2753 +0.0140 - 0.0162 = -0.2775`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

---

## Hypothesis B — ten trades

#### tier: majors

### B · BTCUSDT · SHORT · signal 2020-01-31 05:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `+0.3174%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2020-01-31 05:00:00+00:00`, `t_entry = 2020-01-31 06:00:00+00:00`, `entry = 9356.16`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (77.1641) = 9618.29; `stop_dist = 262.131` = **1R**; **target** +1R = 9094.03.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-01-31 06:00:00+00:00 < t_j < 2020-02-02 06:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-01-31 08:00:00+00:00 | +0.000772 | 9380.64 | +0.027610 | collected |
| 2020-01-31 16:00:00+00:00 | +0.000399 | 9347.45 | +0.014213 | collected |
| 2020-02-01 00:00:00+00:00 | +0.000750 | 9364.5 | +0.026790 | collected |
| 2020-02-01 08:00:00+00:00 | +0.000657 | 9434.58 | +0.023635 | collected |
| 2020-02-01 16:00:00+00:00 | +0.000491 | 9341.58 | +0.017481 | collected |
| 2020-02-02 00:00:00+00:00 | +0.000283 | 9392.99 | +0.010128 | collected |
| | | **sum** | **+0.119857** | engine `fundingR = +0.119857` |

* **Exit** — cause `time`, `t_exit = 2020-02-02 06:00:00+00:00`, `exit_px = 9319`, hold 48 h, 6 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (9319 - 9356.16) / 262.131 = +0.1418`; `fundingR = +0.1199`; `costR = 0.001 x 9356.16 / 262.131 = +0.0357`; **`netR = +0.1418 +0.1199 - 0.0357 = +0.2259`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### B · ETHUSDT · SHORT · signal 2020-07-27 15:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `+0.8229%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2020-07-27 15:00:00+00:00`, `t_entry = 2020-07-27 16:00:00+00:00`, `entry = 313.64`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (5.56913) = 331.292; `stop_dist = 17.6523` = **1R**; **target** +1R = 295.988.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-07-27 16:00:00+00:00 < t_j < 2020-07-27 22:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| — | — | — | +0.000000 | *no settlement inside the span (zero-settlement trade, counted)* |
| | | **sum** | **+0.000000** | engine `fundingR = +0.000000` |

* **Exit** — cause `stop`, `t_exit = 2020-07-27 22:01:00+00:00`, `exit_px = 331.292`, hold 6 h, 0 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (331.292 - 313.64) / 17.6523 = -1.0000`; `fundingR = +0.0000`; `costR = 0.001 x 313.64 / 17.6523 = +0.0178`; **`netR = -1.0000 +0.0000 - 0.0178 = -1.0178`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### B · ETHUSDT · SHORT · signal 2021-01-10 11:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `+3.2625%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2021-01-10 11:00:00+00:00`, `t_entry = 2021-01-10 12:00:00+00:00`, `entry = 1262.9`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (33.2468) = 1362.97; `stop_dist = 100.072` = **1R**; **target** +1R = 1162.83.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-01-10 12:00:00+00:00 < t_j < 2021-01-11 03:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-01-10 16:00:00+00:00 | +0.001260 | 1305.42 | +0.016443 | collected |
| 2021-01-11 00:00:00+00:00 | +0.001775 | 1257.95 | +0.022319 | collected |
| | | **sum** | **+0.038761** | engine `fundingR = +0.038761` |

* **Exit** — cause `target`, `t_exit = 2021-01-11 03:01:00+00:00`, `exit_px = 1162.83`, hold 15 h, 2 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (1162.83 - 1262.9) / 100.072 = +1.0000`; `fundingR = +0.0388`; `costR = 0.001 x 1262.9 / 100.072 = +0.0126`; **`netR = +1.0000 +0.0388 - 0.0126 = +1.0261`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### B · ETHUSDT · LONG · signal 2021-07-20 15:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `-0.8378%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2021-07-20 15:00:00+00:00`, `t_entry = 2021-07-20 16:00:00+00:00`, `entry = 1803.87`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (27.6621) = 1708.08; `stop_dist = 95.7855` = **1R**; **target** +1R = 1899.66.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-07-20 16:00:00+00:00 < t_j < 2021-07-21 10:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-07-21 00:00:00+00:00 | +0.000002 | 1785.2 | -0.000031 | collected |
| 2021-07-21 08:00:00+00:00 | -0.000255 | 1874.09 | +0.004987 | collected |
| | | **sum** | **+0.004956** | engine `fundingR = +0.004956` |

* **Exit** — cause `target`, `t_exit = 2021-07-21 10:01:00+00:00`, `exit_px = 1899.66`, hold 18 h, 2 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (1899.66 - 1803.87) / 95.7855 = +1.0000`; `fundingR = +0.0050`; `costR = 0.001 x 1803.87 / 95.7855 = +0.0188`; **`netR = +1.0000 +0.0050 - 0.0188 = +0.9861`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: majors

### B · ETHUSDT · LONG · signal 2022-11-10 08:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `-3.7659%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2022-11-10 08:00:00+00:00`, `t_entry = 2022-11-10 09:00:00+00:00`, `entry = 1215.35`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (41.3346) = 1060.81; `stop_dist = 154.544` = **1R**; **target** +1R = 1369.89.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2022-11-10 09:00:00+00:00 < t_j < 2022-11-12 09:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2022-11-10 16:00:00+00:00 | -0.000155 | 1321.24 | +0.001322 | collected |
| 2022-11-11 00:00:00+00:00 | -0.000168 | 1298.3 | +0.001410 | collected |
| 2022-11-11 08:00:00+00:00 | -0.000136 | 1277.84 | +0.001127 | collected |
| 2022-11-11 16:00:00+00:00 | +0.000029 | 1259.51 | -0.000234 | collected |
| 2022-11-12 00:00:00+00:00 | +0.000100 | 1288.67 | -0.000833 | collected |
| 2022-11-12 08:00:00+00:00 | +0.000049 | 1265.96 | -0.000398 | collected |
| | | **sum** | **+0.002395** | engine `fundingR = +0.002395` |

* **Exit** — cause `time`, `t_exit = 2022-11-12 09:00:00+00:00`, `exit_px = 1260.9`, hold 48 h, 6 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (1260.9 - 1215.35) / 154.544 = +0.2947`; `fundingR = +0.0024`; `costR = 0.001 x 1215.35 / 154.544 = +0.0079`; **`netR = +0.2947 +0.0024 - 0.0079 = +0.2893`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### B · ADAUSDT · LONG · signal 2020-03-13 13:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `-0.3587%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2020-03-13 13:00:00+00:00`, `t_entry = 2020-03-13 14:00:00+00:00`, `entry = 0.02778`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (0.00227124) = 0.0169522; `stop_dist = 0.0108278` = **1R**; **target** +1R = 0.0386078.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2020-03-13 14:00:00+00:00 < t_j < 2020-03-15 14:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2020-03-13 16:00:00+00:00 | -0.001694 | 0.02572 | +0.004024 | collected |
| 2020-03-14 00:00:00+00:00 | +0.000100 | 0.02844 | -0.000263 | collected |
| 2020-03-14 08:00:00+00:00 | +0.000100 | 0.02794 | -0.000258 | collected |
| 2020-03-14 16:00:00+00:00 | +0.000100 | 0.02695 | -0.000249 | collected |
| 2020-03-15 00:00:00+00:00 | +0.000100 | 0.02572 | -0.000238 | collected |
| 2020-03-15 08:00:00+00:00 | -0.000846 | 0.02653 | +0.002073 | collected |
| | | **sum** | **+0.005090** | engine `fundingR = +0.005090` |

* **Exit** — cause `time`, `t_exit = 2020-03-15 14:00:00+00:00`, `exit_px = 0.02678`, hold 48 h, 6 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (0.02678 - 0.02778) / 0.0108278 = -0.0924`; `fundingR = +0.0051`; `costR = 0.001 x 0.02778 / 0.0108278 = +0.0026`; **`netR = -0.0924 +0.0051 - 0.0026 = -0.0898`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### B · SOLUSDT · SHORT · signal 2021-01-10 11:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `+3.6136%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2021-01-10 11:00:00+00:00`, `t_entry = 2021-01-10 12:00:00+00:00`, `entry = 3.2544`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (0.157705) = 3.80343; `stop_dist = 0.549026` = **1R**; **target** +1R = 2.70537.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-01-10 12:00:00+00:00 < t_j < 2021-01-11 14:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-01-10 16:00:00+00:00 | +0.000801 | 3.4121 | +0.004976 | collected |
| 2021-01-11 00:00:00+00:00 | +0.000244 | 3.4453 | +0.001534 | collected |
| 2021-01-11 08:00:00+00:00 | +0.000100 | 3.0031 | +0.000547 | collected |
| | | **sum** | **+0.007057** | engine `fundingR = +0.007057` |

* **Exit** — cause `target`, `t_exit = 2021-01-11 14:01:00+00:00`, `exit_px = 2.70537`, hold 26 h, 3 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (2.70537 - 3.2544) / 0.549026 = +1.0000`; `fundingR = +0.0071`; `costR = 0.001 x 3.2544 / 0.549026 = +0.0059`; **`netR = +1.0000 +0.0071 - 0.0059 = +1.0011`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### B · SOLUSDT · SHORT · signal 2021-08-21 11:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `+6.1161%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2021-08-21 11:00:00+00:00`, `t_entry = 2021-08-21 12:00:00+00:00`, `entry = 75.959`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (1.80266) = 82.5507; `stop_dist = 6.59166` = **1R**; **target** +1R = 69.3673.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2021-08-21 12:00:00+00:00 < t_j < 2021-08-23 12:00:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2021-08-21 16:00:00+00:00 | +0.000234 | 75.49 | +0.002681 | collected |
| 2021-08-22 00:00:00+00:00 | +0.000100 | 73.892 | +0.001121 | collected |
| 2021-08-22 08:00:00+00:00 | +0.000239 | 75.592 | +0.002743 | collected |
| 2021-08-22 16:00:00+00:00 | +0.000232 | 74.693 | +0.002634 | collected |
| 2021-08-23 00:00:00+00:00 | +0.000100 | 72.808 | +0.001105 | collected |
| 2021-08-23 08:00:00+00:00 | +0.000392 | 73.48 | +0.004372 | collected |
| | | **sum** | **+0.014657** | engine `fundingR = +0.014657` |

* **Exit** — cause `time`, `t_exit = 2021-08-23 12:00:00+00:00`, `exit_px = 72.85`, hold 48 h, 6 settlement slots crossed.
* **Decomposition** — `priceR = -1 x (72.85 - 75.959) / 6.59166 = +0.4717`; `fundingR = +0.0147`; `costR = 0.001 x 75.959 / 6.59166 = +0.0115`; **`netR = +0.4717 +0.0147 - 0.0115 = +0.4748`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### B · SOLUSDT · LONG · signal 2022-08-26 13:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `-2.4370%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2022-08-26 13:00:00+00:00`, `t_entry = 2022-08-26 14:00:00+00:00`, `entry = 35.23`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (0.481656) = 33.6296; `stop_dist = 1.60041` = **1R**; **target** +1R = 36.8304.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2022-08-26 14:00:00+00:00 < t_j < 2022-08-26 15:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| — | — | — | +0.000000 | *no settlement inside the span (zero-settlement trade, counted)* |
| | | **sum** | **+0.000000** | engine `fundingR = +0.000000` |

* **Exit** — cause `stop`, `t_exit = 2022-08-26 15:01:00+00:00`, `exit_px = 33.6296`, hold 1 h, 0 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (33.6296 - 35.23) / 1.60041 = -1.0000`; `fundingR = +0.0000`; `costR = 0.001 x 35.23 / 1.60041 = +0.0220`; **`netR = -1.0000 +0.0000 - 0.0220 = -1.0220`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

#### tier: alts

### B · BNBUSDT · LONG · signal 2024-02-24 05:00:00+00:00

* **Trigger** — funding extreme at the last settlement `t_k <= T`; trailing 24h return `-0.2917%` (with the crowd); close through the prior 12-bar extreme.
* **Entry** at `close_T`, `T = 2024-02-24 05:00:00+00:00`, `t_entry = 2024-02-24 06:00:00+00:00`, `entry = 379.39`.
* **Stop** = 12-bar extreme +/- 0.25 x ATR14 (3.30487) = 370.424; `stop_dist = 8.96622` = **1R**; **target** +1R = 388.356.

**Settlement ledger** — collected iff `t_entry < t_j < t_exit`, i.e. `2024-02-24 06:00:00+00:00 < t_j < 2024-02-25 11:01:00+00:00`:

| `t_j` | `f_j` | mark `open(t_j)` | `(-side)*f_j*mark/stop_dist` | status |
|---|---|---|---|---|
| 2024-02-24 08:00:00+00:00 | -0.000553 | 379.32 | +0.023397 | collected |
| 2024-02-24 16:00:00+00:00 | -0.000818 | 379.18 | +0.034588 | collected |
| 2024-02-25 00:00:00+00:00 | -0.000968 | 381.27 | +0.041161 | collected |
| 2024-02-25 08:00:00+00:00 | -0.000762 | 380.28 | +0.032317 | collected |
| | | **sum** | **+0.131463** | engine `fundingR = +0.131463` |

* **Exit** — cause `target`, `t_exit = 2024-02-25 11:01:00+00:00`, `exit_px = 388.356`, hold 29 h, 4 settlement slots crossed.
* **Decomposition** — `priceR = 1 x (388.356 - 379.39) / 8.96622 = +1.0000`; `fundingR = +0.1315`; `costR = 0.001 x 379.39 / 8.96622 = +0.0423`; **`netR = +1.0000 +0.1315 - 0.0423 = +1.0891`**.
* **Hand re-check**: recomputing all four legs from the printed inputs reproduces `netR` to 1e-12 — **OK**.

---

**All twenty hand re-checks reproduce the engine's `netR` to 1e-12: YES.**
