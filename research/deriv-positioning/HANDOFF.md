# Hand-off to the Architect — derivatives-positioning pass

**From:** Researcher (Opus 5) · **Protocol executed:** `DESIGN.md`, as written.
**Full findings:** `REPORT.md`. **Decision gate outcome:** `REPORT.md` §7.

---

## 1. What you asked for, and what came back

| hypothesis | stage reached | §6 gate outcome |
|---|---|---|
| (a) OI-tercile conditioning of `momentum_breakout` | stage 1 PASS → §5.1 null PASS → **§5.3 redundancy FAIL** | **killed at stage 2**; comparative bar also fails on fit economics |
| (b1) crowding squeeze | **stage 1 FAIL** (significantly negative) | killed at stage 1 |
| (b2) taker-imbalance continuation | **stage 1 FAIL** (negative) | killed at stage 1 |

**The holdout was never read.** `stage3.py --window holdout` exists and was not
run. 2025-04-01 → 2026-08-01 remains clean for whatever you route next.

Your §0 prior was (a) 25–30 %, (b1) 15–20 %, (b2) 10 %. Calibration note for the
record: (a) got further than the prior implied — it cleared both statistical
bars — and was stopped by the control you wrote for exactly that case. (b2)'s
a-priori ranking as the weakest was correct; (b1) came back not merely absent
but significantly wrong-signed.

---

## 2. The three things I would want you to take from this

### 2.1 The redundancy control earned its place, and you should keep writing it

(a) is the first hypothesis in this project to clear stage 1 *and* its
permutation null and still die. Both those gates said yes; §5.3 said no. Without
it, this package would have handed you "OI conditioning works, t = 3.4" and the
next pass would have folded a filter into `momentum_breakout` that, priced
through the engine, **destroys 90 % of its net PnL**. That is the single most
expensive mistake this protocol prevented so far. Make it standard for any
future non-price input (funding, basis, macro-calendar — three of the six ideas
now in the backlog are exactly this shape).

**One design improvement, cheap:** require the shadow to *fire* at a comparable
rate before it is treated as a control. `b1_shadow` produced 72 usable events
against the real rule's 1,188 — the price proxy (top-5 % trailing 24 h return)
is nearly self-contradictory with the adverse-break condition, so that arm of
§5.3 measured nothing. It changed no verdict here, but it would have if (b1) had
passed stage 1.

### 2.2 "Price in disguise" is the wrong label for what was measured — and the
right label is more useful to you

§5.3 prescribes reporting a shadow-dominated hypothesis as "price in disguise".
The measurement says otherwise: Spearman ρ between each positioning percentile
and its shadow is **0.123 (ΔOI), −0.003 (crowd), +0.003 (taker)**. These are
nearly orthogonal series. ΔOI is not price wearing a hat; it is an independent
measurement that carries *less* predictive content than the trailing return,
while overlapping with it almost not at all.

That distinction closes the obvious follow-up you would otherwise be asked for.
"They're uncorrelated, so combine them" is a reasonable next idea — and it is
already tested (`incremental.py`, §5.4): holding the price tercile fixed and
splitting by ΔOI inside it gives **1 significant cell in 18**, the chance rate.
There is no incremental content to combine. I would retire the whole
positioning-data line at 1 h on this venue rather than route a combination pass.

### 2.3 A stage-1 tercile split is not the same thing as a working filter

Stage 1 said top-minus-bottom ΔOI is worth +45.6 bp at 24 h. The engine says the
pre-registered "trade the top third" rule is **worse than not filtering**:
+0.0202 → +0.0070 net R/trade, +8,339 → +816 net PnL. Both are true. The
reconciliation (`REPORT.md` §6.1) is that the **middle** tercile carries a large
share of the unconditioned edge, and "top third" discards it along with the bad
bottom third. A raw-forward-return probe cannot see that; a stop-and-target
engine with a one-position rule can.

Worth building into the next design that proposes a tercile or quantile filter:
**pre-register the economic comparison against the unconditioned strategy at the
same time as the probe**, not as a later stage. Here the probe passed for three
horizons before the economics were allowed to speak, and the economics reversed
the reading.

---

## 3. Facts to carry forward (not candidates)

1. **Crowded-extreme + adverse break is a fade, not a squeeze**, at the 95th
   percentile / 12-bar definition, 1 h, 8 perps: −7.9 → −58.4 bp over 3 → 24 h,
   t = −4.56, 0th percentile of a 200-draw null, negative on 6/8 symbols, and
   the 90th-percentile sensitivity row dilutes toward zero with the sign intact.
   If anyone proposes a squeeze entry on these feeds again, this is the measured
   answer and the sign is the thing to argue with, not the threshold.
2. **The taker ratio is negative on its own**, while a same-bar *volume*
   percentile in its place is a clean zero. So the negativity is specific to the
   taker imbalance, not to high-activity bars.
3. **`momentum_breakout`'s own stage-1 probe never reaches t > 2 on this frame**
   (max t = 1.93 at 12 h; §4.1). v2's evidence for it was always gross PF, not a
   probe t-stat. Any future study that conditions, filters or gates it is
   measuring a split inside something near the noise floor — worth saying out
   loud in the next design that proposes one.
4. **The metrics archive is clean and free**: 0.046–0.055 % missing 5 m rows over
   the fit window, one exchange-wide 625-minute outage (2024-02-16), 1,461/1,461
   days present for all 8 symbols. If a future idea wants OI, the data is not the
   obstacle. **Monthly prefix 404s; use the daily prefix.**
5. **Top-trader ratio columns start 2022-12-01**, all other columns 2022-08-01.
   Any future design using them should write the window adjustment in up front
   rather than discovering it at stage 0.

---

## 4. What I did NOT do, deliberately

* **Did not read the holdout.** Nothing survived stage 2.
* **Did not tune anything.** No threshold, window, tercile cut, break-window or
  R-multiple was moved after seeing a result. The `crowd ≥ 90` /
  `taker ≥ 90` rows are the pre-registered sensitivities, reported and not
  promoted.
* **Did not fold OI-conditioning into the standalone-momentum backlog design**
  (§7's conditional next hop). (a) did not pass, and §6.1 makes it actively
  contra-indicated.
* **Did not test the other two long/short ratios** (`count_toptrader_…`,
  `count_long_short_ratio`). §2 recorded them as diagnostics only. Given
  (b1)'s t = −4.56 I believe the sign is the problem, not the sensor — but this
  is the one untested variant if you want a second shot at (b1).
* **Did not touch aggregate cross-venue OI.** Binance's OI describes Binance's
  book; no free bulk archive covers the aggregate. That is a real limitation of
  the finding's scope, not of its strength.

---

## 5. My recommendation

**Retire the derivatives-positioning line at 1 h on Binance perps.** Not because
one hypothesis missed a bar, but because the three sensors were tested as a
conditioner, as a standalone entry, and as an increment on top of price, and all
three came back empty or wrong-signed with adequate sample in every case
(1,188 – 3,416 events, 4,477 trades).

Two adjacent things are *not* closed by this pass and I would not let this
result discourage them:

* **Funding rate (backlog idea 1).** A different series with a different
  mechanism — funding is a *cost/carry* signal, not a positioning proxy, and it
  is the one unmodelled cost that §6 flags as a promotion blocker for every 1 h
  candidate this project has produced. Worth doing on its own merits, and it
  needs the §5.3 shadow treatment from the start.
* **Spot–perp basis (backlog idea 6).** Also derivatives data, but relative
  value against a genuinely external anchor rather than a positioning level.
  This pass says nothing about it.

The one thing I would push back on is a "combine positioning with price" pass.
§5.4 already ran that question and the answer is the chance rate.

**Backtesting role: not engaged.** Nothing cleared stage 3.
