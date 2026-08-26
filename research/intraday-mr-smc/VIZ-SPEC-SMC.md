# VIZ-SPEC-SMC — 10 example trade charts for the retired `smc` candidate @ 1h

**Author:** Architect · **Executor:** Researcher (`agents/roles/researcher.md`)
**Purpose:** the user wants to *see* why the single-timeframe SMC candidate
failed. 10 individual trade charts in the same visual language as
`research/intraday-mr-smc-v2/viz/` (candles, entry/stop/target, holding
shading), but with SMC's own significant levels — the broken swing (BOS
level) and the order-block / FVG zone the entry retested — drawn explicitly.
**Scope:** visualization only. No new backtests, no parameter changes, no
re-litigating the retirement. The candidate is retired (REPORT.md §8,
ARCHITECT-NOTE.md §2.2); these charts are illustrative, not a re-evaluation.

**The story the charts must tell** (this drives the selection mix in §3): SMC's
1h win rate (37.7–38.6%) sits a few points above its own 2R break-even line
(33.3%), and the edge probe measured −0.03 bp of forward edge over 46,045
observations. The failure mode is therefore *not* "the pattern rarely
appears" or "the entries look obviously wrong" — it is that visually
textbook-correct OB/FVG retests in the direction of structure win and lose
in nearly break-even proportion. The charts must let the user compare
near-identical setups with opposite outcomes.

---

## 1. Exact configuration to visualize

One configuration, no variations:

* **Candidate:** `smc` (`strategies.py:smc`, this directory — the v1 module,
  **not** anything in `strategies_v2.py`).
* **Interval:** 1h only. This is the interval v1 established as the only
  viable one (REPORT.md §3); do not touch 5m or 15m.
* **Universe:** BTCUSDT, ETHUSDT, SOLUSDT — v1's original 3 symbols. SMC was
  only validated at 1h for these three; do **not** expand to the v2 8-symbol
  universe.
* **Window:** the full 48-month window, `2022-08-01 00:00 UTC` →
  `2026-08-01 00:00 UTC` (slice with `common.slice_period`). One engine pass
  per symbol over the whole window — this reproduces the REPORT.md §3
  `smc / 1h` rows.
* **Parameters — all defaults, stated explicitly** (`strategies.DEFAULTS`;
  obtained automatically via v2 `common.signals(d, "smc")`, which handles v1
  candidates and returns `(sig_frame, params)`):
  * `smc_k = 2` — fractal half-width for swing detection. A swing at bar `i`
    is only *confirmed* at bar `i+k` (`indicators.py:fractals` shifts by `k`).
  * `smc_rr = 2.0` — reward:risk multiple for the target (break-even WR 33.3%).
  * `atr_len = 14` — ATR lookback (used only for the 0.25×ATR stop buffer).
  * `time_stop = 24` — bars before an unresolved trade closes at the close.
  * (`mr_len`, `mr_z`, `stop_atr`, `tp_frac`, `sweep_lookback`, `htf_mult`
    exist in `DEFAULTS` but are **unused** by `smc()` — do not draw the
    z-band, mean, or anything MR-related on these charts.)
* **Engine:** v1 `backtest.py` unchanged, via v2 `common.run(...)` at default
  fees: `FEE_BPS = 5.0` per side, `RISK_PCT = 0.01`, `DAILY_STOP_PCT = 0.02`,
  `MAX_LEVERAGE = 10`, next-bar-open fills, stop-before-target on ambiguous
  bars. Identical engine/fee/risk defaults as the momentum viz pass. Do
  **not** use `engine_v2.py`.

The rule, restated so the chart annotations are right (`strategies.py:smc`,
`indicators.py:structure`):

* **Long signal (bar `i`):** structure bias is bullish (`bias == 1`, i.e. the
  most recent close-based break of a confirmed swing was upward), **and** bar
  `i` trades down into the active bullish order block
  (`low ≤ ob_high` and `close > ob_low`) **or** into the most recent
  unmitigated bullish FVG (`low ≤ fvg_high` and `close > fvg_low`). Short is
  the mirror. Simultaneous long+short conditions cancel to no signal.
* **Fill:** next bar's **open** (never the signal bar). The engine skips the
  entry if the open no longer sits strictly between stop and target.
* **Stop (long):** `min(zone_low, signal bar low) − 0.25 × ATR`, where
  `zone_low` is `ob_low` **if a bullish OB is active** (`ob_dir == 1`), else
  `fvg_low`. **Precision note:** this means a trade triggered *only* by the
  FVG condition still anchors its stop to the OB when one is active — the
  triggering zone and the stop-basis zone can differ. §2 requires recording
  both.
* **Target (long):** `signal bar close + 2.0 × |close − stop|`. Anchored at
  the signal bar's close, not the fill price, so realized R differs slightly
  from ±1 / +2.
* **Exits:** stop / target intrabar (stop assumed first when a bar spans
  both — pessimistic), else time-stop at bar close after 24 bars.

**Definitions behind the columns** (`indicators.py:structure` — the one
mechanical encoding this study committed to, per REPORT.md §9):

* **Order block:** the last opposite-colour candle within 30 bars before the
  impulse that produced the most recent BOS; its `[low, high]` is the zone.
  Cleared ("mitigated") when a close crosses fully through it; only replaced
  at the next BOS.
* **FVG:** 3-bar imbalance (`low[i] > high[i−2]` bullish); tracked until a
  wick re-enters it. Updates continuously — the newest unmitigated gap wins.
* **BOS:** a **close** beyond the last *confirmed* (fractal, `k`-lagged)
  swing high/low. Sets `bias`; the broken swing is then cleared from the
  `swing_high`/`swing_low` columns (recovery procedure in §2.3).

## 2. "Significant levels" for SMC — what to draw and how

This is a different vocabulary from `momentum_breakout`'s z-band. No rolling
mean, no σ band, no RSI/VWAP/ADX. Per trade, draw exactly these four
elements, all reconstructed from the `structure()` columns **at the signal
bar** `i−1` (the bar before the fill bar — the engine fills bar `i` from bar
`i−1`'s signal row):

### 2.1 The retested zone(s) — shaded rectangles, not lines

An OB/FVG is a price *band*, so it is drawn as a shaded rectangle, never a
single line.

* **Order block** (when `ob_dir` at the signal bar matches the trade side):
  rectangle spanning `[ob_low, ob_high]` vertically, filled **blue**
  (`#1565c0`, alpha ≈ 0.15) with a thin solid border, labeled `OB` at its
  left edge.
* **FVG** (when `fvg_dir` matches and the FVG condition held): rectangle
  spanning `[fvg_low, fvg_high]`, filled **orange** (`#ef6c00`,
  alpha ≈ 0.15), labeled `FVG`.
* **Horizontal extent:** each rectangle runs from its **formation/activation
  bar** to the **signal bar** (inclusive). Recover the formation bar without
  touching the state machine: scan backward from the signal bar for the
  longest contiguous run of bars where (`ob_low`, `ob_high`, `ob_dir`) — or
  the `fvg_*` triple — equal the signal-bar values; the run's first bar is
  the formation bar. (Zone values only change on re-assignment or
  mitigation, so the contiguous-run test is exact.)
* **Which zone(s) to draw:** evaluate the entry conditions from `smc()` at
  the signal bar and record `zone_trigger ∈ {OB, FVG, OB+FVG}` — draw every
  zone that triggered. Additionally, if the stop was anchored to a zone that
  did *not* trigger (the §1 precision note: `ob_dir` matched but only the
  FVG condition fired), draw that OB too, at lower alpha (≈ 0.08), labeled
  `OB (stop basis)`. Record `stop_basis ∈ {OB, FVG}` in the audit CSV and
  caption.

### 2.2 The broken swing — the BOS reference level

* **Horizontal dotted grey line** at the price of the swing the most recent
  BOS broke, drawn from the swing's bar (clamped to the window's left edge)
  to the BOS bar.
* **BOS bar marker:** a small diamond above (bullish) / below (bearish) the
  BOS bar's candle, annotated `BOS` — or `CHoCH` if `choch != 0` on that bar
  (a CHoCH is the more interesting case: structure just flipped).

### 2.3 Recovery procedure for the BOS level (the columns don't store it
directly — `structure()` clears the broken swing at the BOS bar):

1. Let `s` = signal bar index, `side` = trade direction.
2. Scan backward from `s` for the most recent bar `b ≤ s` with
   `bos[b] == side`. (One must exist whenever `bias == side`; if the scan
   would leave the prepared frame, escalate — do not silently skip.)
3. The broken level is `swing_high[b−1]` for a long (`swing_low[b−1]` for a
   short) — the column value on the bar *before* it was cleared.
4. The swing's own bar: scan backward from `b−1` for the first bar where the
   column first equals that value (start of its contiguous run).
5. Record `bos_bar`, `bos_level`, and `choch` (bool) in the audit CSV.

### 2.4 Structure bias — annotation, not a line

`bias` at the signal bar is by construction equal to the trade side; state it
in the subtitle (`bias: bullish` / `bearish`) rather than drawing anything.

**Critical correctness rule** (same as the momentum pass, and *more* binding
here because `structure()` is a stateful bar-by-bar machine): run
`st.prepare()` on the **full** window-sliced series exactly as
`common.signals` does, then *slice the prepared frame* to the plot window.
Never recompute `prepare()`/`structure()` on the plot window alone — the
state machine replayed from an arbitrary start produces different
bias/OB/FVG state (REPORT.md §8 flags exactly this trap).

## 3. Selection protocol — 10 honest, reproducible trades

Goal: illustrate *why this failed* — textbook-looking entries that don't
discriminate — not 10 nice wins and not 10 strawman losses. The protocol is
fixed here, before any trade is looked at; no trade may be swapped by hand.

1. **Build the pooled ledger.** For each of the 3 symbols: load 1h bars
   (`common.load(sym, "1h")`), `common.slice_period` to the full window,
   `common.signals(d, "smc")`, `common.run(...)` at default fees.
   Concatenate the 3 ledgers with a `symbol` column; id each trade
   `"{symbol}-{entry_ts:%Y%m%dT%H%M}"`. Drop `reason == "eod"` rows.
2. **Enrich every ledger row** with the §2 reconstruction *before* drawing:
   `zone_trigger`, `stop_basis`, `bos_bar`, `bos_level`, `choch`, plus a
   boolean **`textbook`** flag defined mechanically as:
   `zone_trigger` includes `OB` **and** the BOS bar lies within the 20 bars
   before the signal bar (a fresh break, retested promptly — the pattern the
   SMC playbook calls ideal). This flag is computed for the *whole* ledger,
   so the captions can report what fraction of all trades were "textbook"
   and their win rate — the single most illustrative number in the package.
3. **Buckets by exit reason:** `target` (win), `stop` (loss), `time`
   (timeout — small win or loss; label TIMEOUT, let R show the sign).
4. **Quotas: 3 target + 5 stop + 2 time = 10.** Weighted toward losses to
   match the ~38% win rate, but with 3 full wins guaranteed so the user sees
   the 2R payoff mechanic that keeps the candidate pinned near break-even.
5. **Textbook sub-quotas** (the point of the exercise — pre-committed, not
   Researcher judgment):
   * ≥ 3 of the 5 `stop` trades must have `textbook == True` — clean
     OB-retests of a fresh BOS that lost anyway;
   * ≥ 2 of the 3 `target` trades must have `textbook == True` — so the
     winning and losing setups are visually near-identical;
   * ≥ 1 of the 10 must be an FVG-only trigger (`zone_trigger == FVG`), so
     both zone types appear.
6. **Deterministic draw:** sort each bucket by `(symbol, entry_ts)`, then
   sample each quota without replacement with
   `numpy.random.default_rng(seed)`, starting at **seed = 42**.
7. **Representativeness constraints**, checked after the draw:
   * all 3 symbols represented;
   * ≥ 3 distinct calendar years among entry timestamps;
   * no two selected trades from the same symbol in the same ISO week;
   * ≥ 3 longs and ≥ 3 shorts;
   * the two `time` trades from different symbols;
   * the §3.5 textbook sub-quotas hold.
8. **If any constraint fails, redraw all buckets with seed+1** (42 → 43 →
   44 …) and take the first fully-satisfying seed. Record the winning seed.
   This deterministic rejection loop is the *only* selection mechanism. If no
   seed ≤ 142 satisfies everything (constraint infeasibility, e.g. too few
   FVG-only trades), escalate with the bucket counts rather than relaxing a
   constraint silently.
9. **Audit trail:** `viz/selected_trades.csv` with, per selected trade:
   trade id, symbol, direction, entry_ts, exit_ts, entry/exit prices, stop,
   target, reason, realized `r`, `pnl`, `zone_trigger`, `stop_basis`,
   `bos_bar` timestamp, `bos_level`, `choch`, `textbook`, and the winning
   seed. Also record full-ledger totals: bucket counts, overall WR, and the
   `textbook` subset's count + WR, so the 3/5/2 mix and the sub-quotas can
   be judged against the true distribution.

**Recovering stop/target for a ledger trade** (the ledger stores neither):
locate the fill bar index `i` where `bars.ts[i] == entry_ts`; the intent came
from signal bar `i−1`, so `stop = sig.stop[i−1]`, `target = sig.target[i−1]`.
Exact, no engine modification — same recipe as the momentum pass.

## 4. Chart spec

**One PNG per trade** (10 files), same rationale and visual language as
`intraday-mr-smc-v2/VIZ-SPEC.md` §4: matplotlib candlesticks (no new
dependencies), up candles `#26a69a`, down `#ef5350`, light background.

* **Time window — wider than the momentum charts, and dynamic.** A z-score
  cross needs ~40 bars of context; a BOS + retest needs the *impulse* that
  created the OB, the OB candle itself, the broken swing, and the
  retracement, which routinely spans more. Window:
  * **left edge:** `min(fill_bar − 60, ob/fvg formation bar − 5,
    swing bar − 5)`, clamped so the total left context never exceeds
    **120 bars** before the fill bar. If the 120-bar cap truncates the zone
    formation or the swing, keep the cap and say so in that trade's caption
    (an OB retested 100+ bars later is itself illustrative — staleness is
    part of the failure story).
  * **right edge:** exit bar + 10 bars (clamped to data).
  * Typical span ≈ 75–155 bars. At the upper end thin the candle bodies
    rather than shrinking the window.
* **Required elements per chart:**
  1. Candles across the whole window.
  2. **Zone rectangle(s)** per §2.1 (OB blue / FVG orange, labels, the
     lower-alpha `OB (stop basis)` case when applicable).
  3. **Broken swing level + BOS/CHoCH marker** per §2.2.
  4. **Signal bar** marked with a small hollow circle above/below its candle
     (the bar that traded into the zone and closed back across it).
  5. **Entry:** horizontal solid black line at the actual fill price, from
     fill bar to exit bar; `▲` below the fill bar for long / `▼` above for
     short; text `entry {price}`.
  6. **Stop:** horizontal **red dashed** line over the same span, labeled
     `stop {price}` at its right end.
  7. **Target:** horizontal **green dashed** line over the same span,
     labeled `target {price}`. (At 2R it sits twice as far as the stop —
     visually the point of the payoff geometry; do not clip it out of the
     y-range.)
  8. **Holding period:** light `axvspan` (alpha ≈ 0.10) from fill to exit.
  9. **Exit:** `×` marker at (exit bar, exit price); for TIMEOUT the close
     lands between the lines — visibly neither was hit.
  10. **Title:** `{symbol} 1h — {LONG|SHORT} — entry {YYYY-MM-DD HH:MM} UTC —
      {WIN|LOSS|TIMEOUT} — {r:+.2f}R`. **Subtitle:** entry/stop/target
      prices, bars held, `bias`, `zone: {OB|FVG|OB+FVG}`,
      `stop basis: {OB|FVG}`, `textbook: {yes|no}`, and `BOS {n} bars before
      entry` (`CHoCH` instead of `BOS` where applicable).
* **y-range:** include all candles in-window plus stop, target, both zone
  edges, and the BOS level, with ~2% padding.
* **Size/quality:** figsize ≈ (14, 7) — widen to (16, 7) beyond ~110 bars —
  dpi 150, tight layout, UTC axis dates, linear price axis.
* **File naming:**
  `viz/trade_{01..10}_{symbol}_{yyyymmdd}_{long|short}_{win|loss|timeout}.png`,
  ordered: 1–3 target, 4–8 stop, 9–10 time, each group chronological.

**Captions:** `viz/CAPTIONS.md` — per trade, the filename plus 2–3 sentences:
what structure had done (the BOS/CHoCH and the impulse), how price retested
the zone, and how it resolved. For `textbook == True` losses, say plainly
that the setup is the pattern as taught and it lost anyway. End the file with
the selection audit (winning seed, quotas vs. full-ledger bucket counts, true
WR) **and** the framing numbers: full-ledger `textbook` count and win rate
next to the 33.3% break-even line and the measured −0.03 bp/46,045-obs edge
probe (REPORT.md §4) — one honest closing sentence that these charts
illustrate *mechanics of a retired candidate*, not a tradable pattern.

## 5. Data source

Reuse the existing 1h pulls — **do not re-fetch.** The v1 `data/` dir is
gitignored and absent from this worktree; copy from the worktree where the v2
Researcher ran:

* `…/trade_automation/researcher-v2-timing-assets/research/intraday-mr-smc/data/{BTCUSDT,ETHUSDT,SOLUSDT}-1h.csv.gz`
  → `research/intraday-mr-smc/data/`

(That is the whole list — 3 files. `common.load` resolves v2/data first then
v1/data, so placing them in v1's `data/` works with the v2 helpers.)
Fallback only if the files have vanished: re-fetch with the existing v1
`fetch_data.py` — same source, same window — and note the re-fetch in
CAPTIONS.md.

**Sanity gate before plotting anything:** the per-symbol full-window ledgers
must reproduce REPORT.md §3's `smc / 1h` rows: trades ≈ 2408 / 2387 / 2415
(±1%), win rate ≈ 37.7% / 38.0% / 38.6% (±0.5 pt), net PF ≈ 0.71 / 0.81 /
0.91 (±0.02) for BTC / ETH / SOL. If any row disagrees, **stop and
escalate** — do not plot trades from a run that disagrees with the report.

## 6. Deliverables & acceptance checklist

New files, all under `research/intraday-mr-smc/`:

* `viz_trades_smc.py` — one script: build ledgers → enrich → select 10 →
  render 10 PNGs + CSV + captions. Re-running must reproduce byte-identical
  trade selection (same seed → same trades). Importing v2's `common.py` for
  load/signals/run/slice is expected and fine (it wraps the v1 engine
  unchanged); keep outputs in *this* directory.
* `viz/trade_01…10_*.png` — the 10 charts per §4.
* `viz/selected_trades.csv` — audit trail per §3.9.
* `viz/CAPTIONS.md` — captions + selection audit + framing numbers per §4.

Checklist:

- [ ] Engine/params untouched; §5 sanity gate passed before selection
- [ ] 3 target / 5 stop / 2 time; §3.5 textbook sub-quotas and §3.7
      constraints satisfied; winning seed recorded
- [ ] Every chart shows: candles, triggering zone rectangle(s) with labels,
      broken-swing line + BOS/CHoCH marker, signal-bar marker, entry
      line+marker, stop line, target line, holding shading, exit marker,
      full title + subtitle
- [ ] `prepare()`/`structure()` run once on the full sliced series, then the
      prepared frame sliced for plotting — never re-run on the plot window
- [ ] Stop/target recovered from the signal frame at bar `i−1`; zone/BOS
      state read at the signal bar, not the fill bar
- [ ] `zone_trigger` vs `stop_basis` distinguished wherever they differ
- [ ] No trade manually swapped; the seed-rejection loop is the only
      selection mechanism; infeasibility escalated, never silently relaxed

Out of scope: any parameter or engine change, alternative SMC encodings
(that is the separately-routed Critique & Refinement thread), other
intervals or symbols, funding/maker-fee modelling, and any new performance
claims beyond the §5 reproduction gate and the descriptive `textbook`-subset
numbers in the captions.
