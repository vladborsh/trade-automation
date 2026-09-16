# DESIGN — `funding-rate-signals`: funding carry (A) and funding-extreme continuation (B) on Binance USD-M perps

**Status:** pre-registration, **committed before any R exists on any of the
four arms.** **Date:** 2026-09-16 · **Package:**
`research/funding-rate-signals/`

This document is the mechanical restatement of the binding pre-registration
`research/funding-rate-signals/ARCHITECT-NOTE.md` (commit `61a2058`,
2026-09-16). **That note is the canonical spec; where this document and the
note disagree, the note wins and this document is the bug.** This document
may add mechanical detail and may not loosen anything (note §8.1).

Nothing here was chosen after seeing a performance number. **No performance
number of any kind exists at the time of this commit.** The only numbers that
exist are the Stage-0 data-audit counts of §3.6 — row counts, slot counts,
gap counts, interval values — which contain no return, no percentile and no
trade outcome.

---

## 0. The two claims, and what a kill closes

**A — carry.** *Extreme funding persists long enough that the paid side
collects more in settlements than it loses on price while holding against
the crowd with a wide stop.* Not "extreme funding predicts reversal". The
price leg of a carry short is a fade of a rally that this venue's mechanics
tend to extend (`intraday-mr-smc` §2.1), so the funding leg must outrun a
price leg **expected to be negative**. Architect's prior after the redundancy
control: **15–20 %**.

**B — continuation / squeeze.** *When funding is extreme and price has been
moving with the crowd, the first 1 h close against the crowd through the
recent extreme starts a squeeze that pays a +1R template.* This is the same
shape `deriv-positioning` (b1) already killed with the **quantity** sensor
(top-trader long/short ratio ≥ 95th pct + 12-bar adverse break, same 8 perps,
same 1 h): **−58.4 bp at 24 h, t = −4.56, 0th percentile of its random-event
null, negative on 6 of 8 symbols**. B swaps in the **price-of-crowding**
sensor and adds a "price with the crowd" condition b1 lacked. Architect's
prior: **≤ 10 %**. A pass must be reconciled with b1 in the REPORT before any
build ruling; a kill closes the squeeze-entry shape on this venue **on both
sensors**.

**The registered family is exactly four arms:**

| arm | hypothesis | tier | symbols |
|---|---|---|---|
| `A_majors` | A carry | majors | BTCUSDT, ETHUSDT |
| `A_alts` | A carry | alts | SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT |
| `B_majors` | B continuation | majors | BTCUSDT, ETHUSDT |
| `B_alts` | B continuation | alts | the six alts |

Everything else — per-symbol rows, per-side rows, B's +3R template, every
threshold sensitivity, §5.4, §5.5, §5.7, §5.8 — is **descriptive, fit-only
where marked, and carries no verdict**. Its heading says so.

---

## 1. The funding state — one definition, shared by A and B (note §1.2)

At each settlement `k` with time `t_k` and rate `f_k` taken from the archive:

```
fpct_k = ( #{ j in [k-89 .. k] : f_j present and f_j <= f_k } )
         / ( #{ j in [k-89 .. k] : f_j present } )
```

— the percentile rank of `f_k` among the trailing **90 settlements
(= 30 days)**, **including the current one**. Defined only when at least
`min_periods = 45` of the 90 slots carry a present row; **undefined
otherwise, and an undefined `fpct` produces no signal of any kind**. The
30-day window is the project's positioning convention (`deriv-positioning`
DESIGN §2). **Never swept.**

```
extreme_positive(k)  <=>  fpct_k >= 0.90  AND  f_k >= +0.0003
extreme_negative(k)  <=>  fpct_k <= 0.10  AND  f_k <= -0.0003
```

The absolute floor `0.0003` is **3 × Binance's 0.01 %/8 h baseline** (≈ 33 %
annualised): the rate must carry a real premium, not merely rank high, since
0.012 %/8 h cannot pay a 0.10 % round trip inside a week.

**Fit-only sensitivities, never promoted, reported even when worse:**
percentile 0.95 / 0.80; floor 0.0000 (none) / 0.0005.

---

## 2. Hypothesis A — the carry arm, mechanically

### 2.1 Trigger

- **Persistence.** `extreme_positive(k-1) AND extreme_positive(k)` → **short**.
  `extreme_negative(k-1) AND extreme_negative(k)` → **long**. `k-1` is the
  **immediately preceding grid slot**; if that slot is missing, the condition
  is **not** satisfied (note §3.3 rule 5(i)) — a trigger never fires across a
  missing slot.
- **Decision bar / entry price.** Entry at the **close of the 1 h bar whose
  open time equals `t_k`**, i.e. at `t_k + 1 h`. One full bar of lag on the
  funding print. **Consequence, stated so nobody rediscovers it: the position
  can never collect `f_k`; its first possible settlement is `t_{k+1}`, seven
  hours away, whose rate is unknown at entry.** A carry trade is therefore a
  *persistence* bet by construction.
- If the bar opening at `t_k` is absent from the kline tape, no entry.
- **One position per symbol.** No pyramiding. After a **stop** exit: no
  re-entry for **3 settlements (24 h)**. After a funding-lapse or time exit:
  re-entry allowed at the next settlement that satisfies the trigger afresh.
- Both sides registered in one arm. **Per-side rows mandatory** (§9.2).

*Fit-only sensitivity:* persistence = 1 settlement; = 3 settlements.

### 2.2 Risk unit

`dATR14` = Wilder ATR(14) on **UTC-day bars resampled from the 1 h tape**,
value **as of the prior completed UTC day** (shift 1). `stop_dist = 1.5 ×
dATR14`. `1R ≡ stop_dist`. Fixed at entry, **never trailed**.

- short: `stop = entry + stop_dist`; long: `stop = entry − stop_dist`.

*Fit-only sensitivity:* 1.0 and 2.5 dATR.

### 2.3 Exits, in priority order

1. **Price stop.** Checked on every subsequent 1 h bar's adverse extreme
   (short: `high`; long: `low`). A bar touching the stop exits **at the stop
   level**. A bar **gapping through** it (short: `open > stop`; long:
   `open < stop`) fills **at that bar's open** — conservative.
2. **Funding-lapse exit.** At any settlement `j` in the hold with
   `f_j ≤ +0.0001` (short) / `f_j ≥ −0.0001` (long), exit at the **close of
   the 1 h bar opening at `t_j`**, i.e. at `t_j + 1 h`. **The lapsing
   settlement itself is collected** (the position was open at `t_j`; §4.2).
   A lapse that would have fired on a **missing** slot cannot be seen; the
   trade exits at the next **present** slot that lapses, and the trade is
   reported in the flagged-trade row (note §3.3 rule 5(iv)).
3. **Time stop.** After **30 settlements** have been crossed, exit at the
   close of the bar opening at the 30th.
4. **No target.** A carry trade has no price objective.
5. **Window boundary.** The fit/holdout boundary close is an exit for
   accounting purposes (§3.4); the holdout run starts flat.

Within one bar the stop is checked **before** any settlement-driven exit at
that bar's open — the stop is the adverse event and ambiguity resolves as a
loss.

---

## 3. Hypothesis B — the continuation arm, mechanically

### 3.1 Trigger (short side; the long side is the exact mirror)

At the close of 1 h bar `T` (bars labelled by **open** time):

1. **Funding state:** `extreme_positive(k)` at the **last settlement `k` with
   `t_k ≤ T`**. **No persistence requirement** — B is an event, not a state.
   If that settlement's slot is missing, or `fpct` is undefined, no event.
2. **Price with the crowd:** `close_T / close_{T−24} − 1 > 0`.
3. **Price turns:** `close_T < min(low_{T−12 … T−1})` — a **close**, not a
   touch, below the lowest low of the prior 12 bars. **Verbatim the
   `deriv-positioning` b1 definition**, so the comparison to b1 is
   like-for-like.
4. **De-overlap:** not within 12 bars of the previous B event on the same
   symbol (keep the **first**); no open B position on the symbol.

All of bars `T−24 … T` must be present in the kline tape.

Enter **short at `close_T`**. Long mirror: `extreme_negative(k)`,
`close_T/close_{T−24} − 1 < 0`, `close_T > max(high_{T−12 … T−1})`, enter long.

### 3.2 Exits

- **Stop:** short `max(high_{T−12 … T}) + 0.25 × ATR14(T)`; long
  `min(low_{T−12 … T}) − 0.25 × ATR14(T)`, where `ATR14` is Wilder ATR(14) on
  the **1 h** tape at `T`. `1R ≡ |entry − stop|`.
- **Target:** **+1R** from entry (project-standard template; this is the
  gating template).
- **Time stop:** 48 bars after entry, marked to market at that bar's close.
- **Same-bar ambiguity resolved as a loss** — the stop is checked first. A
  gapped stop fills at the breaching bar's open.
- **Mandatory secondary template, no verdict:** target **+3R**, same stop,
  same time stop — b1's template. A template-2 number that alone would clear
  the build bar is grounds for **one Architect-authorised follow-up
  registration, never a re-labelling** (the ORB §1.5 rule).
- **§4 funding accounting applies to B exactly as to A.**

---

## 4. Funding as P&L — the accounting (note §4)

**Funding is a P&L leg, not a cost.**

### 4.1 Definitions, per trade, in R

```
side        = -1 (short) / +1 (long)
stop_dist   = |entry - stop|                                        (1R)
priceR      = side * (exit_px - entry) / stop_dist
fundingR    = SUM over { j : t_entry < t_j < t_exit }
                  (-side) * f_j * open(t_j) / stop_dist
costR       = 0.001 * entry / stop_dist
netR        = priceR + fundingR - costR
grossR      = priceR + fundingR
```

**Sign check.** Short (`side = −1`) with positive `f_j` → `fundingR > 0`
(shorts are paid). Long with negative funding → paid. Long with positive
funding → pays. A B long entered during extreme-negative funding is paid; if
it overlaps a later positive settlement it pays — both fall out of the
formula with no special case.

**Notional mark.** `open(t_j)` — the **open of the 1 h bar opening at `t_j`**
— is the last-price proxy for the mark price the archive does not carry. The
perp–mark gap is basis points and second-order to a rate quoted in basis
points. **Stated as an approximation in the REPORT.**

### 4.2 The collection rule — strict, both ends

**A settlement at `t_j` is collected iff `t_entry < t_j < t_exit`.** Binance
exchanges funding only with positions open at the settlement instant; there
is **no accrual for a partial period**.

- A position entered at `t_k + 1 h` and stopped at `t_k + 5 h` has
  `fundingR = 0`. **It is still a trade, still in the arm's `n`, still in the
  mean.** The share of such zero-settlement trades is a **mandatory
  diagnostic**. **There is no minimum-settlement requirement** — requiring one
  would drop exactly the trades where the price risk materialised before the
  carry did, which is the risk the hypothesis is being charged for.
- Exits at a bar close `t_j + 1 h` (funding-lapse, time stop) have
  `t_exit = t_j + 1 h > t_j`: **the settlement at `t_j` IS collected**,
  including the lapsing one, whose rate is small by definition.
- A **stop** touched inside bar `[t, t + 1 h)` has an exit instant unknown at
  1 h resolution; **pin `t_exit` = that bar's open time + 1 minute**. So a
  settlement at the exit bar's open **is** collected; one later in the bar is
  not.
- The fit/holdout boundary close is an exit for accounting purposes.

`checks.py` asserts no settlement is ever counted **at or before** the entry
instant or **at or after** the exit instant.

### 4.3 Mandatory decomposition, every table

Every table showing `netR` shows, in adjacent columns: mean `priceR`, mean
`fundingR`, mean `costR`, mean settlements per trade, **share of trades with
zero settlements**, and mean hold in hours. **A verdict-bearing number
without its decomposition is a protocol violation.**

---

## 5. Data (note §3)

### 5.1 Sources — public bulk archive, no credentials

| dataset | path on `data.binance.vision` |
|---|---|
| funding | `data/futures/um/monthly/fundingRate/<SYM>/<SYM>-fundingRate-<YYYY-MM>.zip` — `calc_time, funding_interval_hours, last_funding_rate` |
| klines | `data/futures/um/monthly/klines/<SYM>/1h/<SYM>-1h-<YYYY-MM>.zip` |

`fetch_data.py` probes **2019-09 .. 2026-09** for every symbol and logs each
month's HTTP outcome and row count to `results/fetch_log.csv`, so no coverage
start is assumed. 5 m / 1 m tapes of earlier packages are **not** used.

### 5.2 Alignment

- Settlement `k` at `calc_time` **rounded to the nearest minute** (the jitter
  is sub-second and means "settled just after"). A settlement belongs to the
  1 h bar whose **open time equals it**; `checks.py` asserts every settlement
  lands on a bar open.
- `f_k` is usable from the **close** of the bar opening at `t_k` onward.
  `fpct_k` is computed only from settlements `≤ k`; **prefix stability** is
  asserted directly (`deriv-positioning/checks.py` check 3).
- Klines: 1 h bars by open time, UTC. **A bar absent from the archive is
  absent — no fill.** Indicators run over present bars; a trade whose path
  crosses an absent bar is **excluded and counted**.

### 5.3 Gap rule (note §3.3) — fixed, non-negotiable

1. **Grid.** Expected settlement grid = every slot at `funding_interval_hours`
   spacing from the first row's time, on the **00/08/16 UTC** grid when the
   interval is 8. A grid slot with no row is a **missing settlement**.
2. **Interval changes.** `funding_interval_hours ≠ 8` on ≥ 1 % of rows in
   either window, or an interval change mid-sample → **STOP and escalate
   before stage 1.** (This fired. See §5.6.)
3. **Duplicates.** Two rows on one slot → **keep the last**, count them.
4. **Secondary source, logged.** A missing slot may be filled **only** from
   `GET /fapi/v1/fundingRate`, no credentials, every filled slot listed in
   `results/data_audit_fills.csv`. Missing from both → missing for good.
   **No interpolation, no forward fill, ever.**
5. **Consequences of a missing slot.** (i) No trigger evaluated on it; A's
   two-settlement condition needs **both** present. (ii) `fpct` uses present
   rows only, `min_periods = 45`; fewer → undefined → no signal. (iii) For an
   open position, `fundingR` for that slot is **zero** and the trade is
   flagged; a trade spanning **> 1** missing slot is **excluded and counted**.
   (iv) A funding-lapse exit cannot fire on a missing slot; the trade exits at
   the next present lapsing slot, reported in the flagged row.
6. **Symbol rule.** > 5 % missing slots in the fit window → the symbol is
   **dropped from its tier's pooled arm and reported**, never silently
   excluded. A tier losing more than half its symbols **stops and escalates**.

### 5.4 Windows (note §3.4) — cut once, never re-cut

| window | dates | use |
|---|---|---|
| warm-up | coverage start .. + 15 days (45 settlements) | `fpct` undefined; no trades |
| **fit** | warm-up end .. **2025-07-31** | everything exploratory, every sensitivity, the §8 screen |
| **holdout** | **2025-08-01 .. 2026-07-31** | computed **once**, at the end, **only** for arms that pass the screen |
| tail | 2026-08-01 .. last archived month (2026-08) | non-gating "post-holdout tail" row |

Split by the **entry bar's UTC date**. A fit trade still open on 2025-08-01
is marked to market at the fit boundary's last bar close for the fit tables;
the holdout run starts flat.

Coverage start per symbol = `max(first funding row, first 1 h bar)`.

### 5.5 Costs (note §7)

**0.10 % round-trip taker** (2 × 5 bp): `costR = 0.001 × entry / stop_dist`,
as every crypto package in this project. Maker **0.04 %** is a **fit-only**
sensitivity. **No slippage is modelled**; the REPORT says so and adds that
extreme-funding tape is *more* volatile than average, so the omission is
**larger here than usual**.

### 5.6 Stage-0 audit result and the Architect ruling it produced

**Run before any derived series existed. No R computed.** Outputs:
`results/data_audit.csv`, `data_audit_months.csv`, `data_audit_gaps.csv`,
`data_audit_klines.csv`, `fetch_log.csv`.

The tape is cleaner than §3.3 anticipated: **zero missing 8 h settlement
slots on all 8 symbols**, zero duplicate slots, zero NaN rates, `fit_missing`
= 0.0000 % everywhere — the 5 % symbol rule (§5.3 rule 6) is nowhere near
binding, and no symbol is dropped.

| symbol | first settlement | last settlement | grid slots | present | missing | first 1 h bar | 1 h bars missing |
|---|---|---|---|---|---|---|---|
| BTCUSDT | 2020-01-01 00:00 | 2026-08-31 16:00 | 7305 | 7305 | 0 | 2020-01-01 00:00 | 0 |
| ETHUSDT | 2020-01-01 00:00 | 2026-08-31 16:00 | 7305 | 7305 | 0 | 2020-01-01 00:00 | 0 |
| SOLUSDT | 2020-09-13 16:00 | 2026-08-31 16:00 | 6535 | 6610\* | 0 | 2020-09-14 07:00 | 120 |
| BNBUSDT | 2020-02-10 08:00 | 2026-08-31 16:00 | 7184 | 7184 | 0 | 2020-02-10 08:00 | 0 |
| XRPUSDT | 2020-01-06 08:00 | 2026-08-31 16:00 | 7289 | 7289 | 0 | 2020-01-06 08:00 | 120 |
| DOGEUSDT | 2020-07-10 08:00 | 2026-08-31 16:00 | 6731 | 6731 | 0 | 2020-07-10 09:00 | 0 |
| ADAUSDT | 2020-01-19 16:00 | 2026-08-31 16:00 | 7249 | 7249 | 0 | 2020-01-31 08:00 | 0 |
| LINKUSDT | 2020-01-17 08:00 | 2026-08-31 16:00 | 7256 | 7256 | 0 | 2020-01-17 08:00 | 0 |

\* 75 **extra, off-8 h-grid** rows — see (1) below.

Three anomalies were found and **escalated to the Architect before stage 1**,
per note §9 point 1. **The ruling landed 2026-09-16 and is binding:**
`research/funding-rate-signals/ARCHITECT-RULING-2026-09-16-stage0.md`
(commit `a393ffc`). All three went the Researcher's way. The records the
ruling requires this document to carry:

#### 5.6.1 `SOLUSDT` interval change — ruling: **option B, blackout**

101 of 6,610 SOL rows (1.53 % overall, ≈ 1.9 % of fit rows) carry
`funding_interval_hours ≠ 8`: **8 h → 4 h at 2022-11-09 20:00 UTC, → 2 h from
2022-11-10 04:00, back to 8 h at 2022-11-18 16:00** — the FTX week, with the
rate **pinned at the −2.0 % cap** for part of it. **No other symbol has a
single non-8 h row.** The 00/08/16 grid slots are all *present* through the
span; the 75 extra rows are intermediate slots, which is why
`slots_missing = 0`. §5.3 rule 2 fired on **both** its clauses.

**Ruling: an interval-anomaly blackout on `SOLUSDT` only, over
`[2022-11-09 20:00, 2022-11-18 16:00)` UTC.** The 8 h grid and every
pre-registered count stay exactly as written for all 8 symbols. The
Architect's reasoning, recorded for the REPORT: rule 2's hours-restatement
was written for a symbol that *lives* on a non-8 h grid; restating in hours
would have re-defined §1's window for all eight symbols to accommodate 101
rows and would **still** have left `fpct` ranking 2 h-period rates against
8 h-period rates, which is not one distribution. Option C is rejected for
the reason the Researcher gave.

**Blackout mechanics, as implemented (`prep.py`, `engine.py`):**

- Blackout rows are every SOL funding row with `calc_time` in
  `[2022-11-09 20:00, 2022-11-18 16:00)`, grid slots and intermediate slots
  alike. **The 2022-11-18 16:00 row is the first normal row.** On the 8 h
  grid this is **26 slots** (the 27th, 2022-11-09 20:00, is not a grid slot).
- Blackout rows are removed from the SOL settlement stream **for all signal
  purposes**: no A or B trigger is evaluated on them, **and they do not enter
  the `fpct` window** — they are masked to `NaN` *before* the rolling rank.
  A 90-slot window spanning the blackout keeps **64 valid rows**, clearing
  `min_periods = 45`. `checks.py` **1b** asserts this and confirms `fpct` is
  defined on 90 of the 90 slots following the span.
- **The shadow is masked with the same rows.** §6.3 demands an identical
  pipeline with exactly one input changed, so `ret_shadow` is blacked out on
  the same slots; otherwise the shadow would be given data the real rule is
  denied.
- First possible post-blackout **B** trigger: the bar opening 2022-11-18
  16:00. First possible **A** trigger: the 2022-11-19 00:00 settlement
  (`k−1` must itself be present and non-blackout).
- **Any SOL A or B trade whose `(t_entry, t_exit)` span intersects the
  blackout is excluded and counted** (`excluded = "blackout_span"`), per arm.
  No trade is entered inside it.
- **1 h klines inside the span are normal bars** — they feed `dATR14`,
  `ATR14` and every B price condition as usual. This is a funding-stream
  blackout, **not** a price blackout. The other seven symbols are untouched.
- The pre-committed hours fallback remains the rule for a **structural**
  interval regime. **Any further non-8 h episode on any symbol goes back to
  escalation; this blackout is not extended on the Researcher's own reading.**

**REPORT must disclose:** the span, the 8→4→2→8 sequence, the cap pinning,
the excluded-and-counted SOL trade count **per arm** (fit only — the audit
shows **zero** non-8 h rows in the holdout, so the holdout is unaffected and
the REPORT says so), and — in the doubts section — that the FTX week is a
candidate for the most extreme funding observations in the sample and is
deliberately outside the SOL evidence, while remaining fully in-sample for
the other seven symbols: the information cost is **1 of 8 symbols for 9 days
of ~6 years, all in fit**.

#### 5.6.2 The 1 h kline gaps — ruling: **daily-prefix backfill authorised**

`SOLUSDT` and `XRPUSDT` each missed 120 bars (0.21–0.23 %) on **identical**
spans — 2022-02-26..28 (72 bars) and 2022-04-01..02 (48 bars). The identical
spans on two symbols identify a **truncated monthly zip**, not an exchange
outage; all 10 daily files return HTTP 200 with 24 rows.

**Ruling: fill the 10 day-spans (240 bars) from
`data/futures/um/daily/klines/<SYM>/1h/` of the same archive.** Same
exchange, same series, same archive at a finer partition — **not** a §5.3
rule-4 secondary source (whose purpose is to stop a *different endpoint*
substituting silently) and **not** interpolation. Authorised **for this
pull's truncated months only**; it does not become a general fallback.

Implemented in `backfill_klines.py`; every filled day is a row in
`results/data_audit_fills.csv`. `checks.py` **1c** asserts, as the ruling
requires, that (a) the filled open times are exactly the missing ones with no
overlap or duplicate against monthly rows, and (b) for a neighbouring day per
gap present in **both** monthly and daily files, the two are identical
row-for-row on open time and OHLCV. **Four neighbouring days match exactly.**
A disagreement would have been an escalation, not a fix-and-continue.

#### 5.6.3 Funding rows before the first 1 h bar — ruling: **confirmed**

**38 settlements** across three symbols predate their first 1 h bar (ADA 35,
SOL 2, DOGE 1). **Ruling: the warm-up clock starts at `max(first funding row,
first 1 h bar)`; fit start = that timestamp's date + 15 days.** Pre-listing
settlements are genuine exchange prints and feed `fpct` **history only**; they
may satisfy `min_periods` early, which is harmless because no trade is
evaluated before the fit start and every trade requires a present bar at the
decision close. `checks.py` **1** scopes the "every settlement lands on a bar
open" assertion to settlements at or after the first bar and **counts the 38
exempt rows rather than dropping them silently**.

**Computed per-symbol coverage, which governs** (`results/fit_starts.csv`):

| symbol | first funding row | first 1 h bar | coverage start | **computed fit start** | note §3.1 table |
|---|---|---|---|---|---|
| BTCUSDT | 2020-01-01 00:00 | 2020-01-01 00:00 | 2020-01-01 00:00 | **2020-01-16** | 2020-01-16 ✓ |
| ETHUSDT | 2020-01-01 00:00 | 2020-01-01 00:00 | 2020-01-01 00:00 | **2020-01-16** | 2020-01-16 ✓ |
| XRPUSDT | 2020-01-06 08:00 | 2020-01-06 08:00 | 2020-01-06 08:00 | **2020-01-21** | 2020-01-16 ✗ |
| LINKUSDT | 2020-01-17 08:00 | 2020-01-17 08:00 | 2020-01-17 08:00 | **2020-02-01** | 2020-01-16 ✗ |
| ADAUSDT | 2020-01-19 16:00 | 2020-01-31 08:00 | 2020-01-31 08:00 | **2020-02-15** | 2020-02-15 ✓ |
| BNBUSDT | 2020-02-10 08:00 | 2020-02-10 08:00 | 2020-02-10 08:00 | **2020-02-25** | 2020-02-25 ✓ |
| DOGEUSDT | 2020-07-10 08:00 | 2020-07-10 09:00 | 2020-07-10 09:00 | **2020-07-25** | 2020-07-25 ✓ |
| SOLUSDT | 2020-09-13 16:00 | 2020-09-14 07:00 | 2020-09-14 07:00 | **2020-09-29** | 2020-09-29 ✓ |

**Two differences, and the computed date governs** (the ruling says so, and
§3.1 of the note calls its table a pre-pull expectation): the note grouped
BTC/ETH/XRP/LINK as "first funding month 2020-01 → fit start 2020-01-16", but
**XRP actually listed 2020-01-06 and LINK 2020-01-17**, so their warm-ups end
2020-01-21 and 2020-02-01. This costs XRP 5 days and LINK 16 days of fit
sample and changes nothing else.

**§5.3 rule 6 is not engaged anywhere**: no symbol is dropped, both tiers keep
all their symbols.

### 5.7 `checks.py` — run, and green

All ten assertions of §11 pass (`results/checks.csv`). The mirror check is
decomposed into three exact parts because three quantities in this design are
not equivariant under any single price transform — the trailing **ratio**
return, the funding **notional** (a price level times a rate) and `costR` (a
price level over a distance) — and a naive "reflect the tape" mirror silently
tests the wrong thing. §11.5 records what each part proves.

One property is worth recording because it is a real, if tiny, asymmetry in
the **pre-registered** definition rather than in this implementation: §1
computes `fpct` with `<=` **including the current value**, so
`fpct(−x) = 1 − fpct(x) + 1/n` exactly. `ext_neg` is therefore stricter than
`ext_pos` by **exactly one rank in 90 (0.0111)**. Inherited from
ARCHITECT-NOTE §1.2, **reported, not corrected.**

---

## 6. Controls (note §5)

### 6.1 Null A — matched-time placebo (primary, 1,000 draws, per arm)

Each real trade is replaced by one entered on a **random settlement bar** (A)
or a **random 1 h bar** (B) on a **different, randomly chosen date inside the
same window**, **same symbol, same side**, **same `stop_dist` in dATR units**
(A) or **ATR14 units** (B), same exit template — for A the placebo's time stop
is the **real trade's realised hold in settlements** (its funding-lapse exit
cannot be reproduced without the funding state, which is exactly what the
placebo destroys); for B the same +1R / 48-bar template. **Same funding
accounting at the placebo's own dates**, same costs.

One-sided `p = share of draws whose mean netR ≥ observed`.

**What it holds fixed:** clock, risk, hold, side mix, cost, *and average
funding*. **What it destroys:** the alignment with an extreme funding state.
So `p` answers exactly: *does entering on extreme funding beat entering on
ordinary funding with the same risk and hold?*

### 6.2 Null B — whole-stream day shift (secondary, 250 draws)

Shift every entry timestamp forward by `k ~ U{1..250}` days, re-evaluate at
the same clock time, same template, same accounting.

### 6.3 THE REDUNDANCY CONTROL — the price shadow (mandatory, **gating**)

> **Does funding add anything beyond trailing price?** Funding is high after
> rallies; a rule that shorts on extreme funding may be a rule that shorts
> after rallies. This is the control that killed `deriv-positioning`'s
> OI-conditioned signal as *price in disguise*, and it is applied here with
> equal rigour.

The test is the **identical pipeline with one input changed**:

- **Shadow variable.** `spct_k` = percentile rank of the **trailing 24 h
  return** `close(t_k)/close(t_k − 24 h) − 1`, sampled at settlement times,
  ranked on the **same trailing 90-settlement window**, same `min_periods
  = 45`.
- **Shadow-A.** extreme-positive ⇔ `spct_k ≥ 0.90` **and** return `> 0`;
  extreme-negative ⇔ `spct_k ≤ 0.10` **and** return `< 0`. Two consecutive
  settlements; short the extreme-positive state; **identical stop, identical
  exits**, with the funding-lapse exit becoming a **shadow-lapse** exit
  (`spct_j ≤ 0.50` for a short; `spct_j ≥ 0.50` for a long); same time stop,
  same cooldown, **identical funding accounting** — a shadow short collects
  whatever funding actually prevailed, as it would in reality.
- **Shadow-B.** Condition 1 of §3.1 replaced by `spct_k ≥ 0.90` (short) /
  `spct_k ≤ 0.10` (long) at the last settlement; conditions 2–4 unchanged;
  same template, same accounting.
- Same windows, same nulls, same ladder, same tables, **per tier**.

**Pre-registered margin — the seventh build condition.** An arm is **"not
dominated"** iff, on the same window, **all three** hold:

1. `mean netR_real − mean netR_shadow ≥ +0.05R`;
2. the **90 % two-sample day-block bootstrap** interval of that difference
   (**2,000 draws**, whole UTC days resampled independently in each trade
   set) **excludes 0**;
3. the **same sign** of difference holds on the **fit** period.

Applied on the **fit** period in the §8 screen and on the **holdout** in the
verdict. An arm that clears the six ladder conditions but fails (1)–(3) is
**"DOMINATED — no second signal"**: **no build**, and the shadow's own number
is written up as a proposal for the standalone-momentum line. An arm that
clears the ladder **and** the margin is **REAL EDGE**.

**Frequency parity.** The shadow must be able to fire — b1's shadow starved
at 72 events. Stage 1 reports both event counts; if a shadow fires **fewer
than half** the real rule's fit events, the **one pre-committed fallback
shadow** — **trailing 72 h return**, ranked identically — is added and both
are reported, **with the better-powered one gating**. **No other shadow
definition may be introduced.**

### 6.4 Incremental control (pre-registered, **non-promotable**)

Fit period only. All real-A candidate settlements (extreme-positive, ignoring
persistence) bucketed by `spct` **tercile**; within each tercile, mean netR of
the A template for **extreme-funding vs non-extreme-funding** settlements
(same template, same accounting). 2 tiers × 3 terciles = **6 cells**. The
pre-committed bar for the sentence *"funding carries information inside a
fixed price bucket"* is **≥ 4 of 6 cells with the funding split positive AND
pooled Welch t > 2**. Reported, **never promoted**, and it **never rescues an
arm that failed §6.3**.

### 6.5 Overlap with `momentum_breakout` (descriptive, no verdict)

For each real A and B entry: whether a `momentum_breakout` trigger (v2
defaults, z = 2.0 on the 50-bar rolling mean/sd, 1 h) fired on the same symbol
within the prior 12 bars, and on which side. Reported as a share. A carry
short *against* a fresh breakout long is the expected common case and is the
reason A's price leg is expected negative.

### 6.6 Frequency floors (note §5.6)

Fit-period pooled events per arm: **≥ 300** for each A tier, **≥ 300** for
each B tier, **≥ 150** for each shadow. Below the floor the arm (or its
shadow) is **"unmeasurable at the pre-committed definition"** and **stops**.
**Thresholds are not loosened to manufacture sample.**

### 6.7 Harness validation (note §5.7)

Run `momentum_breakout` (v2 defaults, no funding accounting) through this
package's 1 h frames on **2022-08 .. 2025-04** and reproduce v2's gross
PF > 1.0 on 8/8 perps within rounding; then run the same **with funding
accounting on** and report how much of a 1 h continuation strategy's edge the
settlements it crosses take away — the number the `deriv-positioning` §6
"funding is a promotion blocker" flag was waiting for.

### 6.8 Mechanism prerequisite (fit-only, descriptive)

Funding persistence: for settlements in the extreme-positive state, the mean
and median of `f_{k+1} … f_{k+9}` and the **survival curve** of the state
(share still extreme after 1, 3, 6, 9, 15, 30 settlements), per tier. **If the
state does not persist beyond ~3 settlements the carry arm's mechanism is
absent and the REPORT says so in §0 regardless of the trade numbers.**

---

## 7. Universe (note §6)

Majors **BTCUSDT, ETHUSDT**; alts **SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT,
ADAUSDT, LINKUSDT**. Two **pooled tiers**, not one pooled-8 arm (a pooled arm
would be alt-dominated and a majors result invisible), not BTC/ETH alone (an
extreme-funding frequency floor would not be met), not the ≥ 50-perp
cross-sectional universe (a different harness and a different registration).
Exactly the `deriv-positioning` universe, so B's comparison with b1 and every
shadow comparison inherit that frame unchanged.

**Survivorship, declared:** all eight are still listed in 2026. That does not
bias a per-asset time-series test the way it biases a selection, but the
sample **under-represents the perps whose funding blew out before
delisting**. Stated in the REPORT; **not corrected**.

---

## 8. Split, prior reads, α, and the fit-period screen

### 8.1 Prior reads of the holdout year, declared (note §7.2)

2025-08-01 .. 2026-07-31 on Binance crypto tapes has been read by
`session-liquidity-v5-ny` (BTC/ETH), `cmc-bot-smart-money` (BTC/ETH/SOL/BNB),
`cmc-bot-vwap` (2 crypto arms), `orb-ny-open` (4 crypto arms).
`orb-utc0-crypto` screened out before reading it; `deriv-positioning` used a
different holdout. **None of those reads concerned funding, funding
accounting, or a multi-day hold** — every one was an intraday, flat-by-session,
price-only registration. Per Запись 27, **this line starts its own count and
declares the prior reads.**

### 8.2 α

**Family = 4 registered arms → α = 0.05 / 4 = 0.0125**, counted **by
registration** whether or not an arm survives the screen; actual reads
reported beside it.

### 8.3 The fit-period screen — decided and committed **before** the holdout is touched

On the **fit** period, for each of the four arms: mean netR, Null-A `p`, the
§6.3 shadow comparison, the §6.6 floors, and the projected holdout `n` (fit
trades per eligible day × holdout days).

**An arm reads the holdout only if ALL of:**

- fit mean netR **≥ +0.05R**;
- fit Null-A **`p` ≤ 0.20**;
- §6.6 frequency floors met (arm **and** its shadow);
- the §6.3 margin **holds on fit**.

Arms that fail are **SCREENED OUT — fit-period kill**; **their holdout is
never computed.** The screen decision is recorded **in this file** (§13) and
**committed** before any holdout number exists.

If a majors-tier projection is `< 150` for an arm that otherwise passes, it is
**run anyway** and the UNDERPOWERED row applies. **No parameter moves for
power.**

---

## 9. The verdict ladder (note §8)

### 9.1 Applied mechanically to each arm's **holdout mean total net R**

| condition | verdict |
|---|---|
| screened out (§8.3) | **NO EDGE — fit-period kill.** Holdout not read. |
| `n_holdout < 150` | **UNDERPOWERED — inconclusive.** No directional claim. |
| mean netR `< +0.05R` **or** Null-A `p > 0.20` | **NO EDGE — kill.** |
| `≥ +0.05R` and `0.0125 < p ≤ 0.20` | **INCONCLUSIVE.** No build. At most one Architect-authorised follow-up. |
| six ladder conditions met (`≥ +0.10R`; `p ≤ 0.0125`; fit same sign `m_fit ≥ +0.05R`; `n ≥ 150`; 90 % day-block bootstrap excludes 0; gross `> 0`) **but §6.3 margin fails** | **DOMINATED — no second signal.** No build; shadow written up as a proposal. |
| all six **and** the §6.3 margin (1)–(3) on the holdout | **REAL EDGE — build ruling.** Routes to Architect. |

The verdict is on **total net R, funding included**.

### 9.2 Mandatory rows beside every verdict

Per-side (long/short) mean netR and `n`; per-symbol mean netR and `n`; the
§4.3 decomposition; exit-cause split (stop / lapse / time for A; stop /
target / time for B); the tail row; B's template-2 row; **every §1–§3
sensitivity actually run on fit, including the ones that came out worse**.

### 9.3 Two pre-registered readings of a pass (note §8.3)

1. **"Carry, not signal."** If an A arm passes and `mean fundingR ≥ mean
   netR` (i.e. the price leg is ≤ 0 net of cost), the REPORT's **first
   paragraph** says the edge is *the carry surviving its price risk*, not
   funding predicting price. Legitimate — it is what A claims — but its build
   ruling is a **different object** (position sizing and funding-persistence
   monitoring, not a directional signal) and **HANDOFF.md must say so**.
2. **"B is A in disguise."** If a B arm passes and its `priceR` alone (net of
   cost) is `< +0.05R`, the continuation claim is **not supported**; what
   passed is carry collected during a B hold. The REPORT says so and **B's
   verdict is re-labelled INCONCLUSIVE on the continuation claim**.

---

## 10. Order of work, and what may be read when (note §9)

1. **Pull and audit** — done, §5.6. **No R computed.**
2. **This document, committed** — **before any R is computed on any arm.**
3. **Mechanic proof** (`MECHANIC-PROOF.md`): 10 hand-checked A trades and 10
   B trades across tiers with the **full settlement ledger** printed per trade
   (each `t_j`, `f_j`, mark, R contribution), the stop, the exit and its
   cause; `checks.py`.
4. **Fit-period numbers** — four arms, both shadows, §6.4, §6.5, §6.7, §6.8,
   every sensitivity; **the screen decision recorded here and committed.**
5. **Holdout, once**, screened-in arms only. Verdicts locked. Then the tail row.
6. **`REPORT.md`, `HANDOFF.md`, `RESEARCH-LOG.md` Запись** regardless of
   outcome, backlog status updated. **A kill is a result.**

---

## 11. `checks.py` — the wiring assertions that must pass before any number is believed

1. Every settlement timestamp lands **exactly on a 1 h bar open**, scoped to
   settlements at or after the first 1 h bar; the 38 pre-listing rows are
   exempt and **counted**.
1b. The SOL blackout leaves `min_periods` met (64 valid rows in a 90-slot
   window) and `fpct` defined on all 90 slots after the span.
1c. The authorised daily-prefix backfill: filled opens are exactly the missing
   ones, no duplicates, and four neighbouring days present in both the monthly
   and daily files match **row-for-row** on open time and OHLCV.
2. `fpct` and `spct` **prefix stability**: recomputing on a tape truncated at
   any `k` reproduces the value at `k`.
3. **No settlement counted outside `(t_entry, t_exit)`** — neither at/before
   entry nor at/after exit, on every trade of every arm.
4. **No trigger fires on a missing slot** (A's `k−1`/`k`, B's last settlement).
5. **Long/short mirror symmetry**, decomposed into three EXACT parts, because
   the trailing **ratio** return, the funding **notional** and `costR` are not
   equivariant under any single price transform:
   **5a** — on an additively reflected tape (high↔low swapped, every absolute
   distance and ATR preserved), with the funding state booleans swapped, `f`
   negated, the notional zeroed and costs zeroed, a short must become a long
   with the **same** `stop_dist`, the **same** `priceR` and the **same** exit
   cause;
   **5b** — the funding sign convention algebraically:
   `collect(side, f) == collect(−side, −f)` exactly;
   **5c** — the percentile definition's own symmetry, **measured**:
   `fpct(−x) == 1 − fpct(x) + 1/n` exactly.
6. No signal on a bar absent from the kline tape; no indicator uses a future
   bar.

---

## 12. Stop rules — return to the Architect, do not decide locally (note §9.7)

- any data-coverage anomaly from Stage 0 *(fired — §5.6)*;
- a fixed-stop **fill disagreement**;
- the redundancy control **failing to compute cleanly**;
- `n_holdout < 150` on a **screened-in** arm;
- genuine **pre-registration ambiguity that changes a number**.

---

## 13. The §8.3 screen decision — **ALL FOUR ARMS SCREENED OUT**

**Decided on the fit period, recorded here, and committed before any holdout
number existed. The holdout (2025-08-01 .. 2026-07-31) was never read by this
package and remains clean.**

| arm | `n` fit | mean netR | Null-A `p` | floor ≥ 300 | shadow floor ≥ 150 | §6.3 margin | margin CI (90 %) | **screen** |
|---|---|---|---|---|---|---|---|---|
| `A_majors` | 89 | **−0.1294** | 0.891 | **NO** | yes (669) | −0.1233 | [−0.305, +0.075] | **OUT** |
| `A_alts` | 394 | **−0.0201** | 0.572 | yes | yes (1831) | +0.0048 | [−0.073, +0.081] | **OUT** |
| `B_majors` | 32 | +0.0852 | **0.209** | **NO** | yes (329) | +0.1616 | [−0.093, +0.419] | **OUT** |
| `B_alts` | 196 | **−0.0144** | 0.448 | **NO** | yes (974) | +0.0344 | [−0.100, +0.170] | **OUT** |

Screen-in requires **all** of: fit mean netR ≥ +0.05R, Null-A `p` ≤ 0.20,
both §6.6 floors, and the §6.3 margin on fit. **No arm satisfies even two of
the four.**

**The frequency floors are not load-bearing.** Three arms fall below the
300-event floor and are therefore also **"unmeasurable at the pre-committed
definition"** under §6.6 — but every one of the four independently fails a
criterion that has nothing to do with sample size: `A_majors`, `A_alts` and
`B_alts` on **mean netR** (all three are negative, not merely small), and
`B_majors` on **Null-A `p` = 0.209 > 0.20**. The conclusion does not rest on
the floors, and **no threshold was loosened to manufacture sample** — the
fit-only floor sensitivities in `results/fit_sensitivities.csv` show what
loosening would have produced, and it does not rescue anything (best variant
anywhere: `A_alts` at percentile 0.95, **+0.0094R**, still a fifth of the
+0.05R screen bar).

**The §6.3 margin never gets to bind.** It is the gating condition for
DOMINATED vs REAL EDGE, and it only matters for an arm that first clears the
ladder. None does. The margins are recorded above for completeness and one of
them is informative in its own right (§6.3 discussion in `REPORT.md` §5):
`A_alts` beats its price shadow by **+0.005R**, a twentieth of the required
margin, with a CI straddling zero.

**Consequence, per §9.1 row 1: all four arms are `NO EDGE — fit-period kill`.
The holdout is not read for any of them.** The tail row (2026-08) is likewise
not computed: §5.4 scopes it to "post-holdout", and there is no holdout read
to post-date. `results/screen.json` records the four `false` decisions.

## 14. Machinery map

| file | role |
|---|---|
| `fetch_data.py` | the pull; `results/fetch_log.csv` |
| `data_audit.py` | Stage 0 (§5.6); `results/data_audit*.csv` |
| `common.py` | constants, loaders, ATR, rolling percentile, statistics |
| `prep.py` | per-symbol frames: 1 h bars, settlements, `fpct`, `spct`, dATR |
| `engine.py` | the A and B trade engines and the §4 funding accounting |
| `checks.py` | §11 assertions |
| `mechanic_proof.py` | the 20 hand-checked trades with settlement ledgers |
| `stage1.py` | fit-period numbers, shadows, sensitivities, the screen |
| `controls.py` | Null A, Null B, bootstraps, §6.4, §6.5, §6.7, §6.8 |
| `holdout.py` | the single holdout read |
