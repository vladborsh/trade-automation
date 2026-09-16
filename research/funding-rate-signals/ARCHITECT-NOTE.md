# Architect note — Funding-rate signals on Binance USD-M perps: carry (A) and funding-extreme continuation (B)

**Date:** 2026-09-16 · **Status:** designed, **awaiting Researcher dispatch by
the coordinator**; scope and numbers fixed below. This note is the binding
pre-registration for the Researcher's pass. `DESIGN.md` restates it
mechanically and is committed before any R is computed. Inputs:
`IDEAS-BACKLOG.md` "Funding-rate signals" (prioritised 2026-08-26),
`research/_surveys/2026-09-intraday-directions.md` §4.2 and §5 (ranked #2),
`research/intraday-mr-smc/ARCHITECT-NOTE.md` §2.1 (the mechanism this pass
monetises), `research/deriv-positioning/DESIGN.md` §5.3 and `REPORT.md` §5
(the redundancy-control precedent and the standing negative on the squeeze
shape), `research/orb-ny-open/ARCHITECT-NOTE.md` (style and ladder),
`research/session-liquidity-v5-ny/DESIGN.md` §4–§6 (project-standard trade
template and nulls), `research/cmc-bot-smart-money/ARCHITECT-NOTE.md` §3.2
(threshold convention), `RESEARCH-LOG.md` Записи 8, 18, 27.

Nothing in this note was written with sight of any performance number. None
exists. The only data touched while writing it was the **coverage probe in
§3.1** (HTTP HEAD on the archive's month list and a column/row inspection of
eight monthly funding files, chosen for listing dates, not for content). No
return, no trade, no percentile was computed on any tape.

---

## 0. Summary of rulings

| # | question | ruling |
|---|---|---|
| 1 | two sub-hypotheses | **A — funding carry**: at a settlement whose rate is extreme (§1.2: rolling 90-settlement percentile ≥ 90 / ≤ 10 **and** |rate| ≥ 0.03 % per 8 h, at **two consecutive** settlements), hold the **paid** side (short when funding is positive), price stop 1.5 × daily ATR, exit when funding lapses to ≤ baseline or after 30 settlements. **B — funding-extreme continuation**: same extreme-funding state **and** trailing 24 h return in the crowd's direction **and** a 1 h close through the prior 12-bar extreme against the crowd; enter with the squeeze, stop beyond the 12-bar extreme + 0.25 ATR, **+1R target** (project standard), 48-bar time stop. Both registered **separately** (§1, §2). |
| 2 | redundancy control | **Mandatory, pre-registered, gating.** Every arm is re-run with the funding variable replaced by its **price shadow — the trailing 24 h return, percentile-ranked on the same 90-settlement window, same thresholds, same template, same funding accounting**. An arm that does not beat its shadow on the pre-registered margin (§5.3) is **"dominated — no second signal"** whatever its ladder result. Second control: funding split inside a fixed shadow bucket (§5.4). Descriptive overlap with `momentum_breakout` triggers (§5.5). |
| 3 | data / gaps | `data.binance.vision` `futures/um/monthly/fundingRate/` **verified**: BTC/ETH/XRP/LINK from 2020-01, ADA from 2020-01-31, BNB from 2020-02-10, DOGE from 2020-07-10, SOL from 2020-09-14, all through 2026-08; columns `calc_time, funding_interval_hours, last_funding_rate`; interval 8 h on every file inspected. 1 h klines from the same archive, same starts. **Gap rule fixed in §3.3**: settlement grid derived from the interval column; a missing slot is *missing* (no fill, no interpolation, no signal, zero funding credited, trade flagged); REST endpoint as the only permitted secondary source, logged per slot. |
| 4 | funding as P&L | **Funding is a P&L leg, not a cost.** A settlement at `t_j` is collected iff `t_entry < t_j < t_exit` (§4.2). Entry at the close of the 1 h bar that opens at the settlement (one-bar lag), so the *first* rate a position can collect is the *next* one — the carry hypothesis is a **persistence** hypothesis by construction. No minimum-settlement requirement: a trade stopped before its first settlement is a trade with `funding_R = 0` and counts. Per-trade decomposition `netR = priceR + fundingR − costR` is mandatory in every table. |
| 5 | universe | **The project's 8-perp universe** — BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT — in **two pooled tiers: majors (BTC, ETH) and alts (the six)**. Not the ≥ 50-perp cross-sectional universe (a different harness, §6.2), not BTC/ETH alone (an extreme-funding frequency floor would not be met, §6.1). |
| 6 | split / α | Per symbol: fit **listing + warm-up .. 2025-07-31** (BTC/ETH from 2020-01-16), holdout **2025-08-01 .. 2026-07-31**, tail 2026-08 non-gating. The holdout year has been read by four earlier crypto lines (§7.2), none on funding; **this line starts its own count**: **4 arms → α = 0.05/4 = 0.0125**, prior reads declared. A **fit-period screen** (§7.3) decides which arms may read the holdout at all. |
| 7 | costs | **0.10 % round trip taker** (2 × 5 bp), `cost_R = 0.001 × entry / stop_dist`, as every crypto package. Maker 0.04 % fit-only sensitivity. No slippage modelled; the REPORT says so and adds that extreme-funding tape is *more* volatile than average, so the omission is larger here than usual. |
| 8 | verdict ladder | Carried verbatim (§8): kill `< +0.05R` or Null-A `p > 0.20`; build needs all of `≥ +0.10R`, `p ≤ 0.0125`, fit same sign `m_fit ≥ +0.05R`, `n_holdout ≥ 150`, 90 % day-block bootstrap excludes 0, gross `> 0` — **plus** the §5.3 redundancy margin as a seventh condition. Verdict is on **total** net R (funding included); a pass whose `fundingR` exceeds its total is labelled "carry, not signal" and routes differently (§8.3). |

The pre-registered family is **exactly four arms**: {A carry, B continuation}
× {majors, alts}. Each has its own verdict and its own shadow. Everything
else — per-symbol rows, per-side rows, the 3R template for B, every threshold
sensitivity — is descriptive, fit-only where marked, and says so in its
heading.

---

## 1. Hypothesis A — funding carry

### 1.1 What is being claimed, and what is not

Funding on a Binance USD-M perp is exchanged every 8 h (00:00, 08:00, 16:00
UTC) between longs and shorts at the settled rate; positive rate = longs pay
shorts. The rate is the *price of crowding*: when leveraged demand is
one-sided the perp trades at a premium and the crowd pays to hold it. The
project's one confirmed diagnosis (`intraday-mr-smc/ARCHITECT-NOTE.md` §2.1)
is that this crowding is self-reinforcing in price. Claim A is therefore not
"extreme funding predicts reversal". It is narrower and more honest:

> *Extreme funding persists long enough that the paid side collects more in
> settlements than it loses on price while holding against the crowd with a
> wide stop.*

The academic prior: Schmeling, Schrimpf & Todorov, *Crypto Carry* (BIS WP
1087, 2023) document that the perp carry reaches tens of percent annualised,
is highly persistent, is driven by leveraged trend-chasing demand against
limited arbitrage capital, and comes with crash risk. Their carry trade is
hedged (short perp / long spot). **This project trades the perp leg
directionally**, so the whole question is the one the backlog wrote down:
does the carry survive the *unhedged* price risk taken to collect it. Prior
for A clearing the build bar after its redundancy control: **15–20 %**. The
price leg of a carry short is a fade of a rally the venue's mechanics tend to
extend — the sign the v1 MR trigger measured as negative — so the funding leg
must outrun a leg expected to be negative.

### 1.2 The funding state — one definition, shared by A and B

At each settlement `k` (time `t_k`, rate `f_k`, from the archive):

- `fpct_k` = percentile rank of `f_k` among `{f_{k−89}, …, f_k}` — the
  trailing **90 settlements = 30 days**, including the current one;
  `min_periods = 45` present rows; undefined otherwise (§3.3). The 30-day
  window is the project's positioning convention (`deriv-positioning`
  DESIGN §2), not a choice made here. **Never swept.**
- **Extreme-positive at `k`** iff `fpct_k ≥ 0.90` **and** `f_k ≥ +0.0003`.
- **Extreme-negative at `k`** iff `fpct_k ≤ 0.10` **and** `f_k ≤ −0.0003`.

Why both a percentile and an absolute floor. The backlog preferred
percentiles because thresholds are regime-dependent; that is right for
*which* settlements are unusual, but a percentile alone would call
+0.012 %/8 h "extreme" in a flat regime, and 0.012 % per 8 h cannot pay a
0.10 % round trip inside a week. The floor is **3 × Binance's 0.01 %/8 h
baseline** (the interest-rate component the rate sits on when the premium is
zero; ≈ 33 % annualised), i.e. the rate must carry a real premium, not just
rank high. Fit-only sensitivities, never promoted: percentile 95 / 80; floor
0.0001 (none) / 0.0005.

### 1.3 Entry

- **Persistence trigger.** Extreme-positive at both `k−1` and `k` (two
  consecutive settlements, 16 h) → **short**. Extreme-negative at both →
  **long**. One settlement alone is not a trigger (single-settlement spikes
  are index/mark noise around a print; two is the shortest run that means
  the crowd stayed). Fit-only sensitivity: one settlement; three.
- **Decision bar and entry price.** The rate `f_k` is final at `t_k`. The
  decision is taken at the **close of the 1 h bar that opens at `t_k`**
  (i.e. at `t_k + 1 h`), entry at that close — the project's
  signal-bar-close convention with one full bar of lag on the funding
  print. Consequence, stated so nobody rediscovers it: the position can
  never collect `f_k`; its first possible settlement is `t_{k+1}`, seven
  hours away, whose rate is unknown at entry.
- **One position per symbol.** No pyramiding. After a **stop** exit, no
  re-entry for **3 settlements** (24 h); after a funding-lapse or time exit,
  re-entry allowed at the next settlement that satisfies the trigger afresh.
- Both sides are registered in one arm; per-side rows are mandatory (§8.2,
  the drift lesson). Expect the long side to be rare and crash-clustered.

### 1.4 Exits, in priority order

1. **Price stop** — `stop_dist = 1.5 × dATR14`, where `dATR14` is Wilder
   ATR(14) on **UTC-day bars** built from the 1 h tape, value as of the prior
   completed day. Short: `stop = entry + stop_dist`; long: `entry −
   stop_dist`. Fixed at entry, never trailed. `1R ≡ stop_dist`. Checked on
   every 1 h bar's adverse extreme; a bar touching the stop exits at the stop
   level; **a bar gapping through fills at that bar's open** (conservative).
   Why 1.5 dATR and daily rather than hourly ATR: the hold is multi-day, so
   the risk unit has to be a daily one; 1.5 days of range is the widest stop
   at which `cost_R` stays ≈ 0.02–0.03R and the narrowest at which a
   ten-day hold is not stopped by ordinary noise on most trades. There is no
   external calibration for this number; it is pinned so it cannot move.
   Fit-only sensitivities: 1.0 and 2.5 dATR.
2. **Funding-lapse exit** — at any settlement `j` during the hold with
   `f_j ≤ +0.0001` (short) / `f_j ≥ −0.0001` (long), i.e. the premium is
   gone, exit at the **close of the 1 h bar opening at `t_j`**. The lapsing
   settlement itself is collected (the position was open at `t_j`; §4.2).
3. **Time stop** — after **30 settlements** (10 days) collected, exit at the
   close of the bar opening at the 30th.
4. No target. A carry trade has no price objective.

### 1.5 Projected frequency (assumption, not computed)

If extreme-positive states cover ~8–12 % of settlements on the alts and
~4–8 % on the majors and cluster into episodes of a few days, the two-
settlement trigger followed by exits and the 24 h cooldown yields roughly
15–40 trades per symbol-year on alts and 8–20 on majors → fit-period pooled
`n` in the high hundreds for the alt tier and low hundreds for the majors;
holdout `n` ≈ 100–250 (alts) and 30–80 (majors). **The majors arm is
projected close to or below the 150 floor.** §7.3 pre-registers what happens.

---

## 2. Hypothesis B — funding-extreme continuation (the squeeze)

### 2.1 The claim and the standing negative it must overcome

> *When funding is extreme and price has been moving with the crowd, the
> first 1 h close against the crowd through the recent extreme starts a
> squeeze that continues far enough to pay a +1R template.*

This is the §2.1 diagnosis run forwards: crowded longs in profit, first
adverse break, liquidations feed the move. **It has already been tested with
a different sensor and failed decisively.** `deriv-positioning` (b1) —
top-trader long/short ratio ≥ 95th percentile + 12-bar adverse break, 1 h,
same 8 perps — was **−58.4 bp at 24 h, t = −4.56, 0th percentile of its
random-event null, negative on 6 of 8 symbols** (REPORT §3.2, §4.3). The
funding version is *the same shape with the price-of-crowding sensor instead
of the quantity sensor*, plus a "price with the crowd" condition b1 lacked.
Pre-registered interpretation: a kill on B closes the squeeze-entry shape on
this venue on both sensors; a pass must be reconciled with b1 in the REPORT
(what the funding sensor or the with-the-crowd condition selected that the
ratio did not) before any build ruling. Prior for B: **≤ 10 %**.

### 2.2 Trigger (short side; long side is the exact mirror)

At the close of 1 h bar `T` (bars labelled by open time):

1. **Funding state**: extreme-positive (§1.2) at the **last settlement
   `k` with `t_k ≤ T`** — i.e. the most recent settled rate, no
   persistence requirement (B is an event, not a state).
2. **Price with the crowd**: `close_T / close_{T−24} − 1 > 0` (trailing 24
   bars = 24 h).
3. **Price turns**: `close_T < min(low_{T−12 … T−1})` — a close (not a
   touch) below the lowest low of the prior 12 bars, verbatim the b1
   definition so that the comparison to b1 is like-for-like.
4. Not within 12 bars of the previous B event on the same symbol (event
   de-overlap, keep the first); no open B position on the symbol.

Enter **short at `close_T`**. Conditions 2 and 3 can hold in the same bar
(a pullback inside a still-positive day); §5.6 pre-registers the frequency
floor that catches the case where they nearly cannot.

### 2.3 Exits

- **Stop** — `max(high_{T−12 … T}) + 0.25 × ATR14` (1 h Wilder ATR at `T`),
  the level whose reclaim refutes the squeeze (b1 verbatim). `1R ≡ |entry −
  stop|`.
- **Target** — **+1R** from entry (project-standard template, gates).
- **Time stop** — 48 bars after entry, mark to market at that bar's close.
- **Same-bar ambiguity resolved as a loss** (stop checked first); gapped
  stop fills at the breaching bar's open.
- **Mandatory secondary template, no verdict**: target **+3R**, same stop,
  same time stop — b1's template, reported so a reader sees whether the
  +1R cap made or unmade the number. A template-2 number that alone would
  clear the build bar is grounds for one Architect-authorised follow-up
  registration, never a re-labelling (the ORB §1.5 rule).
- **Funding accounting applies to B as well** (§4): a B short during
  extreme-positive funding collects settlements during its hold. The verdict
  is on total net R; `priceR` alone is reported beside it so that a B pass
  cannot be A in disguise (§8.3).

---

## 3. Data

### 3.1 Sources and verified coverage

| dataset | path on `data.binance.vision` | verified 2026-09-16 |
|---|---|---|
| funding | `data/futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-<YYYY-MM>.zip` | columns `calc_time, funding_interval_hours, last_funding_rate`; `calc_time` in ms with sub-second jitter (e.g. `…00007`); `funding_interval_hours = 8` on every file opened (BTC 2020-01, BTC/ADA/SOL/DOGE 2025-07, BNB 2020-02, SOL 2020-09, DOGE 2020-07); BTC 2020-01 has 93 rows = 31 days × 3 |
| klines | `data/futures/um/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip` | monthly 1h files exist from the same first months as funding |

Per-symbol first archive month (HTTP 200 on the month list; a 404 on the
month before):

| symbol | first funding month | first 1h kline month | fit start after 15-day warm-up (§3.4) |
|---|---|---|---|
| BTCUSDT, ETHUSDT, XRPUSDT, LINKUSDT | 2020-01 | 2020-01 | 2020-01-16 |
| ADAUSDT | 2020-01 (listed 2020-01-31) | 2020-01 | 2020-02-15 |
| BNBUSDT | 2020-02 (listed 2020-02-10; 59 rows) | 2020-02 | 2020-02-25 |
| DOGEUSDT | 2020-07 (listed 2020-07-10; 65 rows) | 2020-07 | 2020-07-25 |
| SOLUSDT | 2020-09 (listed 2020-09-14; 52 rows) | 2020-09 | 2020-09-29 |

All eight run through 2026-08. This is the deepest history the archive
publishes for these symbols (the memory rule for crypto passes: deepest
available, not the 2022-08 convention). The 5 m/1 m tapes of earlier
packages are **not** used — 1 h is the decision bar for both hypotheses and
the multi-day holds do not need finer path evaluation; the 1 h pull is a
fresh, small, audited-by-this-package tape.

**Stage 0 must re-verify all of this** on the full pull, per symbol and per
month, and deliver `results/data_audit.csv` (rows expected vs present, gaps,
duplicates, interval values, first/last timestamp) **before** any derived
series exists. Assume nothing above survives contact with the full pull
until it does.

### 3.2 Alignment

- Settlement `k` at `calc_time` rounded to the nearest minute (the jitter is
  sub-second and means "settled just after"). A settlement belongs to the
  1 h bar whose open time equals it; `checks.py` asserts every settlement
  lands on a bar open.
- `f_k` is usable from the close of the bar opening at `t_k` onward (one
  bar of lag). `fpct_k` is computed only from settlements `≤ k`. Prefix-
  stability check as `deriv-positioning/checks.py` check 3: recomputing
  `fpct` on a tape truncated at any `k` gives the same value.
- Klines: 1 h bars by open time, UTC. A bar absent from the archive is
  absent (no fill); indicators run over present bars; a trade whose path
  crosses an absent bar is **excluded and counted**.
- Funding notional at settlement `j` is marked at the **open of the 1 h bar
  opening at `t_j`** (last-price proxy for the mark price, which the archive
  does not carry; the perp–mark gap is basis points and second-order to a
  rate quoted in basis points — stated as an approximation in the REPORT).

### 3.3 Gap rule (fixed now; the backlog's own warning)

1. **Grid.** For each symbol the expected settlement grid is built from the
   `funding_interval_hours` column: slots every `interval` hours from the
   first row's time, on the 00/08/16 UTC grid when the interval is 8. Every
   slot on the grid without a row is a **missing settlement**.
2. **Interval changes.** If any symbol has `funding_interval_hours ≠ 8` on
   ≥ 1 % of rows in either window, or changes interval mid-sample, the
   Researcher **stops and escalates before stage 1**; the pre-committed
   fallback the Architect will rule on is restating §1.3/§1.4's counts in
   hours (16 h persistence, 240 h time stop, 24 h cooldown) so they are
   interval-invariant. Nothing else changes.
3. **Duplicates.** Two rows on one slot → keep the last; count them.
4. **Secondary source, logged.** A missing slot may be filled **only** from
   Binance's public REST endpoint `GET /fapi/v1/fundingRate` for that symbol
   and time range, no credentials; every filled slot is listed in
   `results/data_audit_fills.csv`. A slot missing from both is missing for
   good. **No interpolation, no forward fill, ever.**
5. **Consequences of a missing slot.** (i) No trigger may be evaluated on
   it; the §1.3 two-settlement condition needs both present. (ii) `fpct`
   uses present rows only, with `min_periods = 45` of the 90-slot window;
   fewer → `fpct` undefined → no signal. (iii) For an open position,
   `fundingR` for that slot is **zero** and the trade is flagged; a trade
   spanning **> 1** missing slot is **excluded and counted**. (iv) A trade
   whose funding-lapse exit would have fired on a missing slot cannot see
   it; it exits on the next present slot that lapses — reported in the
   flagged-trade row.
6. **Symbol rule.** A symbol with > 5 % missing slots in the fit window is
   dropped from its tier's pooled arm (reported, not silently excluded); if
   a tier loses more than half its symbols, that tier's two arms stop and
   the Researcher escalates.

### 3.4 Windows

| window | dates | use |
|---|---|---|
| warm-up | listing .. listing + 15 days (45 settlements) | `fpct` undefined; no trades |
| **fit** | warm-up end (§3.1 table) .. **2025-07-31** | everything exploratory, every sensitivity, the §7.3 screen |
| **holdout** | **2025-08-01 .. 2026-07-31** | computed once, at the end, only for arms that pass the screen |
| tail | 2026-08-01 .. last archived month | non-gating "post-holdout tail" row |

Split by the **entry bar's UTC date**. A fit trade open on 2025-08-01 is
closed at the fit boundary's last bar close (mark to market) for the fit
tables; the holdout run starts flat. Never re-cut.

---

## 4. Funding as P&L — the accounting

### 4.1 Definitions, per trade, in R

```
side        = −1 (short) / +1 (long)
stop_dist   = |entry − stop|            (1R)
priceR      = side × (exit_px − entry) / stop_dist
fundingR    = Σ_{j : t_entry < t_j < t_exit}  (−side) × f_j × open(t_j) / stop_dist
costR       = 0.001 × entry / stop_dist
netR        = priceR + fundingR − costR
grossR      = priceR + fundingR
```

Sign check: short (`side = −1`), positive `f_j` → `fundingR > 0` (shorts
are paid). Long with negative funding → paid. Long with positive funding →
pays (a B long entered during extreme-negative funding is paid; a B long
that overlaps a later positive settlement pays — both fall out of the
formula).

### 4.2 Timing rules

- **A settlement is collected iff the position is open strictly across it:
  `t_entry < t_j < t_exit`.** Binance exchanges funding only with positions
  open at the settlement instant; there is no accrual for a partial period.
  Consequently a position entered at `t_k + 1 h` and stopped at `t_k + 5 h`
  has `fundingR = 0` — it is still a trade, still in the arm's `n`, still
  in the mean; the share of such trades is a mandatory diagnostic. **No
  minimum-settlement requirement.** Requiring one would drop exactly the
  trades where the price risk materialised before the carry did, which is
  the risk the hypothesis is being charged for.
- Exits at a bar close `t_j + 1 h` (funding-lapse, time stop) have
  `t_exit = t_j + 1 h > t_j`: the settlement at `t_j` **is** collected —
  including the lapsing one, whose rate is small by definition. This is the
  honest reading: you learn the rate when it is paid.
- A stop touched inside bar `[t, t + 1 h)` has `t_exit = t`'s touch, which
  is unknown at 1 h resolution; pin `t_exit` = the bar's **open time + 1
  minute** for settlement accounting — i.e. a settlement at the bar's open
  is collected (the position was open at that instant), one later in the
  bar is not. `checks.py` asserts no settlement is ever counted after an
  exit bar or before an entry bar.
- The fit/holdout boundary close (§3.4) is an exit for accounting purposes.

### 4.3 Mandatory decomposition, every table

Every table that shows `netR` shows, in adjacent columns: mean `priceR`,
mean `fundingR`, mean `costR`, mean settlements per trade, share of trades
with zero settlements, and mean hold in hours. A verdict-bearing number
without its decomposition is a protocol violation.

---

## 5. Controls

### 5.1 Null A — matched-time placebo (primary, 1,000 draws), per arm

Each real trade is replaced by one entered on a **random settlement bar**
(A) or a **random bar** (B) on a different, randomly chosen date inside the
same window, same symbol, same side, **same `stop_dist` in dATR units** (A)
or in ATR14 units (B), same exit template — for A the placebo's time stop is
the **real trade's realised hold in settlements** (its funding-lapse exit
cannot be reproduced without the funding state, which is the thing being
destroyed), for B the same +1R / 48-bar template — **same funding accounting
at the placebo's own dates**, same costs. One-sided `p = share of draws whose
mean netR ≥ observed`. What this holds fixed: clock, risk, hold, side mix,
cost, *and average funding*. What it destroys: the alignment with an extreme
funding state. So `p` answers exactly "does entering on extreme funding beat
entering on ordinary funding with the same risk and hold?".

### 5.2 Null B — whole-stream day shift (secondary, 250 draws)

Shift every entry timestamp forward by `k ~ U{1..250}` days, re-evaluate at
the same clock time with the same template and accounting.

### 5.3 The redundancy control — the shadow (mandatory, gating)

The design's central question, with teeth: **does funding add anything
beyond trailing price?** Funding is high after rallies; a rule that shorts
on extreme funding may be a rule that shorts after rallies. Per
`deriv-positioning` §5.3, the test is the identical pipeline with **one
input changed**:

- **Shadow variable** `spct_k` = percentile rank of the **trailing 24 h
  return** `close(t_k)/close(t_k − 24 h) − 1`, sampled at settlement times,
  ranked on the same trailing 90-settlement window, same `min_periods`.
- **Shadow-A**: extreme-positive ⇔ `spct_k ≥ 0.90` and return `> 0`;
  two consecutive settlements; short; identical stop, exits (the
  funding-lapse exit becomes a **shadow-lapse** exit: `spct_j ≤ 0.50`),
  time stop, cooldown, **identical funding accounting** (a shadow short
  collects whatever funding actually prevailed — as it would in reality).
  Extreme-negative mirrored.
- **Shadow-B**: condition 1 of §2.2 replaced by `spct_k ≥ 0.90` at the
  last settlement; conditions 2–4 unchanged; same template, same
  accounting.
- Same windows, same nulls, same ladder, same tables. Per tier.

**Pre-registered margin (seventh build condition).** An arm is "not
dominated" iff, on the same window, **(i)** `mean netR_real − mean
netR_shadow ≥ +0.05R` and **(ii)** the 90 % two-sample day-block bootstrap
interval of that difference (2,000 draws, whole UTC days resampled
independently in each trade set) **excludes 0**, and **(iii)** the same sign
of difference holds on the fit period. Applied on the fit period in the
§7.3 screen and on the holdout in the verdict. An arm that clears the six
ladder conditions but fails (i)–(iii) is **"DOMINATED — no second signal"**:
no build, and the shadow's own number is written up as a proposal for the
standalone-momentum line, exactly as `deriv-positioning` flagged its
shadow. An arm that clears the ladder *and* the margin is REAL EDGE.

**Frequency parity.** The shadow must be able to fire (the b1 shadow starved
at 72 events, REPORT §5.3). Stage 1 reports both event counts; if a shadow
fires fewer than **half** the real rule's fit events, the Researcher adds
the one pre-committed fallback shadow — **trailing 72 h return** ranked the
same way — and reports both, with the better-powered one gating. No other
shadow definition may be introduced.

### 5.4 Incremental control (pre-registered, non-promotable)

Hold the shadow fixed, ask what funding adds inside it: on the fit period,
all real-A candidate settlements (extreme-positive, ignoring persistence)
bucketed by `spct` tercile; within each tercile, mean netR of the A template
for extreme-funding vs non-extreme-funding settlements (same template, same
accounting). 2 tiers × 3 terciles = 6 cells; **≥ 4 of 6 with the funding
split positive and the pooled Welch t > 2** is the pre-committed bar for the
sentence "funding carries information inside a fixed price bucket". This is
reported, never promoted, and never rescues an arm that failed §5.3.

### 5.5 Overlap with `momentum_breakout` (descriptive)

For each real A and B entry, whether a `momentum_breakout` trigger (v2
defaults: z = 2.0 on the 50-bar rolling mean/sd, 1 h) fired on the same
symbol within the prior 12 bars, and on which side. Reported as a share; a
carry short *against* a fresh breakout long is the expected common case and
is the reason A's price leg is expected negative. No verdict.

### 5.6 Frequency floors

Fit-period pooled events per arm: **≥ 300** for A tiers, **≥ 300** for B
tiers, **≥ 150** for each shadow. Below the floor the arm (or its shadow) is
**"unmeasurable at the pre-committed definition"** and stops; thresholds
are not loosened to manufacture sample.

### 5.7 Harness validation

Run `momentum_breakout` (v2 defaults, no funding accounting) through this
package's 1 h frames on the 2022-08 .. 2025-04 window and reproduce v2's
gross PF > 1.0 on 8/8 perps within rounding; run the same with funding
accounting switched on and report how much of a 1 h continuation strategy's
edge the settlements it crosses take away — this is the number the
`deriv-positioning` §6 "funding is a promotion blocker" flag was waiting for.

### 5.8 Mechanism prerequisite (fit-only, descriptive)

Funding persistence: for settlements in the extreme-positive state, the mean
and median of `f_{k+1}, …, f_{k+9}` and the survival curve of the state
(share still extreme after 1, 3, 6, 9, 15, 30 settlements), per tier. If the
state does not persist beyond ~3 settlements the carry arm's mechanism is
absent and the REPORT says so in §0 regardless of the trade numbers.

---

## 6. Universe

### 6.1 Ruling: the 8-perp universe, two pooled tiers

BTCUSDT, ETHUSDT (majors); SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT,
LINKUSDT (alts). Reasons:

1. **Frequency.** Extreme-funding episodes on BTC alone are a few per year;
   §1.5's projection puts a BTC/ETH-only carry arm below the 150-trade
   holdout floor. The alts have more and larger funding extremes — which is
   also where the carry is economically largest — so they carry the power.
2. **Like-for-like with the precedent.** These eight, on 1 h, are exactly
   the `deriv-positioning` universe; B's comparison with b1 and every
   shadow comparison inherit that frame unchanged.
3. **Not BTC/ETH/SOL/BNB.** The four-symbol universe was a *bot* constraint
   (`cmc-bot-smart-money` §5.1) and is a strict subset here.
4. **Not the ≥ 50-perp universe.** That universe belongs to the
   cross-sectional package (§4.1 of the survey; `research/crosssec-
   instruments-in-play/` did not exist when this note was written) and
   needs its portfolio harness and its survivorship-free membership rule.
   Funding signals are per-asset and need neither; coupling them would
   block this pass on that build for no gain in what A and B claim.
5. **Survivorship, declared.** All eight are still listed in 2026. That does
   not bias a per-asset time-series test the way it biases a selection, but
   it does mean the sample under-represents the perps whose funding blew
   out before delisting. Stated in the REPORT; not corrected.

Why tiers rather than one pooled-8 arm: a pooled arm's `n` would be
alt-dominated and a majors result would be invisible except in descriptive
rows; the two tiers have different funding magnitudes, different
`cost_R`/carry ratios and — plausibly — different answers. Four arms is the
smallest family that keeps both visible. Per-symbol rows are descriptive.

### 6.2 What a pass would route to

A REAL EDGE on an alt-tier arm is a *per-asset* result and routes to a build
ruling on its own. The cross-sectional package may later use funding as a
selector; that is its registration, not this one's.

---

## 7. Split, prior reads, α, and the screen

### 7.1 Split

§3.4. Fit ≈ 5.5 years (majors), 5.0–5.5 (alts); holdout 12 months; the
project's standard holdout year.

### 7.2 Prior reads of the holdout year, declared

The 2025-08-01 .. 2026-07-31 year on Binance crypto tapes has been read by:
`session-liquidity-v5-ny` (BTC/ETH, Запись 18); `cmc-bot-smart-money`
(BTC/ETH/SOL/BNB); `cmc-bot-vwap` (2 crypto arms, Запись 22); `orb-ny-open`
(4 crypto arms, Запись 23). `orb-utc0-crypto` screened out before reading
it. `deriv-positioning` used a different holdout (2025-04 .. 2026-08) and
never read it. **None of those reads concerned funding, funding accounting,
or a multi-day hold**; every one was an intraday, flat-by-session,
price-only registration. Per Запись 27's convention — a new line starts its
own count and declares the prior reads — this line's count is its own.

### 7.3 Fit-period screen (committed before the holdout is touched)

On the fit period, for each of the four arms: mean netR, Null-A `p`, the
§5.3 shadow comparison, the §5.6 floors, and the projected holdout `n`
(fit trades per eligible day × holdout days). **An arm reads the holdout
only if** fit `mean netR ≥ +0.05R`, fit Null-A `p ≤ 0.20`, floors met, and
the §5.3 margin holds on fit. Arms that fail are **SCREENED OUT — fit-period
kill**; their holdout is never computed (the `orb-utc0-crypto` §7.4
pattern). The screen decision is a commit. If the majors-tier projection is
`< 150` for an arm that otherwise passes, it is run anyway and the
UNDERPOWERED row applies; **no parameter moves for power**.

### 7.4 α

**Family = 4 registered arms → α = 0.05/4 = 0.0125**, counted by
registration whether or not an arm survives the screen (Запись 27: count by
registration, report actual reads beside it).

---

## 8. Verdict ladder

### 8.1 Applied mechanically to each arm's holdout mean total net R

| condition | verdict |
|---|---|
| screened out (§7.3) | **NO EDGE — fit-period kill.** Holdout not read. |
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** No directional claim. |
| mean netR `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| six ladder conditions met (`≥ +0.10R`; `p ≤ 0.0125`; fit same sign `m_fit ≥ +0.05R`; `n ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0`) **but §5.3 margin fails** | **DOMINATED — no second signal.** No build; shadow written up as a proposal (§5.3). |
| all six **and** §5.3 margin (i)–(iii) on the holdout | **REAL EDGE — build ruling.** Routes to Architect. |

Kill bar +0.05R and build bar +0.10R are the smart-money numbers, kept for
the same reasons (few trades, unmodelled slippage on a tape that is
volatile precisely when the signal fires). `DESIGN.md` may add mechanical
detail and may not loosen anything here; if the Researcher finds the arm
count wrong, tighten.

### 8.2 Mandatory rows beside every verdict

Per-side (long/short) mean netR and `n`; per-symbol mean netR and `n`; the
§4.3 decomposition; exit-cause split (stop / lapse / time for A; stop /
target / time for B); the tail row; the B template-2 row; every §1
sensitivity actually run on fit, including the ones that came out worse.

### 8.3 Two pre-registered readings of a pass

1. **"Carry, not signal."** If an A arm passes and `mean fundingR ≥ mean
   netR` (the price leg is ≤ 0 net of cost), the REPORT's first paragraph
   says the edge is *the carry surviving its price risk*, not funding
   predicting price. That is a legitimate result — it is what A claims —
   but its build ruling is a different object (position-sizing and
   funding-persistence monitoring, not a directional signal) and the
   HANDOFF must say so.
2. **"B is A in disguise."** If a B arm passes and its `priceR` alone
   (net of cost) is `< +0.05R`, the continuation claim is not supported;
   what passed is carry collected during a B hold. The REPORT says so and
   B's verdict is re-labelled INCONCLUSIVE on the continuation claim.

---

## 9. Order of work and stop rules

1. **Pull and audit.** `fetch_data.py`: 1 h klines and funding, all 8
   symbols, first month .. latest, into `research/funding-rate-signals/
   data/` (gitignored; add the path to `.gitignore`). Stage-0 audit per
   §3.1–§3.3 → `results/data_audit*.csv`. **No R computed.** Stop and
   escalate on: interval ≠ 8 h (§3.3 rule 2); a symbol over the 5 %
   missing rule; any month whose row count is not explained by listing
   date + logged gaps.
2. **`DESIGN.md`** restating this note mechanically — the four arms and
   their two tiers, the §1.2 state, both triggers, both exit sets, the §4
   accounting with the collection rule and sign convention, the §3.3 gap
   rule, the shadows and the §5.3 margin, the nulls, the screen, the
   ladder with α = 0.0125 — **committed before any R is computed**.
3. **Mechanic proof on the fit period** (`MECHANIC-PROOF.md`): ten
   hand-checked A trades and ten B trades across tiers with the settlement
   ledger printed per trade (each `t_j`, `f_j`, mark, R contribution), the
   stop, the exit and its cause; `checks.py` — every settlement on a bar
   open; `fpct`/`spct` prefix stability; no settlement counted outside
   `(t_entry, t_exit)`; no trigger on a missing slot; long/short mirror
   symmetry (a sign-flipped tape gives sign-flipped trades).
4. **Fit-period numbers** for all four arms, shadows, §5.4, §5.5, §5.7,
   §5.8, all sensitivities; the **screen decision recorded in `DESIGN.md`
   and committed**.
5. **Holdout, once**, for screened-in arms only; verdicts locked; then the
   tail row.
6. **`REPORT.md`** (four verdicts in the first paragraph, §8.3 readings
   applied, decomposition everywhere, doubts section), **`HANDOFF.md`** to
   Architect, **`RESEARCH-LOG.md` Запись** regardless of outcome, backlog
   status updated. A kill is a result. If all four die, the deliverable is
   the measured statement that on Binance USD-M perps, 2020–2026, the
   funding rate neither pays for its own price risk nor selects squeezes
   beyond what trailing price already does — the second half of the
   positioning question `deriv-positioning` answered for the quantity side.

---

## 10. Explicitly not ruled here

- **A hedged carry (short perp / long spot)** — the Schmeling et al. trade;
  a relative-value registration that belongs with the backlog's spot–perp
  basis entry, not here.
- **Funding as a selector in the cross-sectional package** — that package's
  registration.
- **Predicted (pre-settlement) funding** from the live premium index — not
  in the archive; a live-only input, out of scope.
- **Any percentile window other than 30 days, any floor other than
  0.03 %, any stop other than 1.5 dATR / 12-bar + 0.25 ATR** as gating
  numbers — the listed fit-only sensitivities exist so a reader can see
  the shape, never to pick from.
- **Software Engineer / Backtesting** — only on a REAL EDGE, after a
  further Architect ruling that also decides which of §8.3's two objects is
  being built.
