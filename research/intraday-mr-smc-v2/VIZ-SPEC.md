# VIZ-SPEC — 10 example trade charts for `momentum_breakout` @ 1h

**Author:** Architect · **Executor:** Researcher (`agents/roles/researcher.md`)
**Purpose:** the user wants to *see* how the one surviving candidate from this
research line actually trades: 10 individual trade charts with price action,
entry, stop, target, and the strategy's own reference levels.
**Scope:** visualization only. No new backtests, no parameter changes, no new
metrics claims. The charts must depict trades produced by the *existing* engine
and rule exactly as reported in `REPORT.md` §2.3 / §4.2.

---

## 1. Exact configuration to visualize

One configuration, no variations:

* **Candidate:** `momentum_breakout` (`strategies_v2.py`)
* **Interval:** 1h
* **Universe:** the 8 USDT-M perps — BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT,
  XRPUSDT, DOGEUSDT, ADAUSDT, LINKUSDT
* **Window:** the full 48-month window, `2022-08-01 00:00 UTC` →
  `2026-08-01 00:00 UTC` (slice with `common.slice_period`). One engine pass
  per symbol over the whole window — this reproduces the §2.3 per-asset table,
  not the fit/holdout split.
* **Parameters — all defaults, stated explicitly** (merged from
  `strategies.DEFAULTS` + `strategies_v2.EXTRA_DEFAULTS`; obtained
  automatically via `common.signals(d, "momentum_breakout")`):
  * `mr_len = 50` — lookback for the rolling mean and rolling std of close
    (the z-score basis)
  * `brk_z = 2.0` — the breakout trigger threshold in sigmas. **Precision
    note:** the trigger parameter for this candidate is `brk_z`, *not* `mr_z`.
    `mr_z = 2.0` also exists in the defaults but is only used by the
    reversion/`momentum` candidates; both happen to be 2.0, so numbers match,
    but the spec and code comments should name `brk_z`.
  * `atr_len = 14` — ATR lookback
  * `stop_atr = 1.5` — stop distance in ATRs beyond the signal bar's extreme
  * `mom_rr = 1.5` — reward:risk multiple for the target
  * `time_stop = 24` — bars before an unresolved trade is closed at the close
* **Engine:** v1 `backtest.py` unchanged, via `common.run(...)` with default
  fees (`FEE_BPS = 5.0` per side), `RISK_PCT = 0.01`, `DAILY_STOP_PCT = 0.02`,
  `MAX_LEVERAGE = 10`. Do **not** use `engine_v2.py` — that is the gap-aware
  index engine; the crypto numbers in the report come from the v1 engine.

The rule, restated so the chart annotations are right:

* **Signal (long):** previous bar's z < +2.0 and this bar's z ≥ +2.0 — close
  crosses *up through* the +2σ band (trade **with** the stretch). Short is the
  mirror: z crosses down through −2σ.
* **Fill:** next bar's **open** (never the signal bar).
* **Stop (long):** `signal bar low − 1.5 × ATR`. **Target (long):**
  `signal bar close + 1.5 × |close − stop|`. Note the R geometry is anchored
  at the signal bar's close, not at the actual fill price — the realized R in
  the ledger therefore differs slightly from ±1 / +1.5.
* **Exits:** stop / target intrabar (stop assumed first when a bar spans
  both — pessimistic), else time-stop at bar close after 24 bars.

## 2. "Significant levels" for this strategy

This is not SMC — there are no order blocks, FVGs, or zones. The only levels
the rule itself reads are the z-score geometry and the trade's own exit prices.
Draw exactly these, nothing else (no RSI, no VWAP, no ADX — `momentum_breakout`
uses none of them):

1. **Rolling mean** (`close.rolling(50).mean()`) — dashed grey line. This is
   the center the z-score measures from.
2. **±2σ trigger band** — `mean ± 2.0 × close.rolling(50).std()`, drawn as
   **two thin solid lines** with a **very light fill between them**
   (alpha ≈ 0.06–0.10). Rationale for band-plus-lines: the trigger event is a
   *crossing of one specific edge*, so that edge must be a crisp line the eye
   can see the close cross; the light fill just communicates "inside = no
   signal territory". Annotate the crossed edge once, near the left of the
   plot: `trigger band (+2σ)` or `(−2σ)`.
3. **Entry / stop / target lines** — see §4.

**Critical correctness rule:** compute mean/σ/ATR by calling `st.prepare()` on
the **full** window-sliced series (exactly as `common.signals` does), then
*slice* the prepared frame to the plot window. Never recompute the rolling
stats on the plot window alone — the 50-bar warm-up would visibly distort the
band and misplace the trigger.

## 3. Selection protocol — 10 honest, reproducible trades

Goal: a representative picture, not 10 nice wins. The protocol is fixed here,
before any trade is looked at; do not swap trades for "nicer" ones.

1. **Build the pooled ledger.** For each of the 8 symbols: load 1h bars, slice
   the full window, `common.signals(d, "momentum_breakout")`,
   `common.run(...)` at default fees. Concatenate the 8 trade ledgers with a
   `symbol` column. Assign each trade the id
   `"{symbol}-{entry_ts:%Y%m%dT%H%M}"`. Drop any `reason == "eod"` rows.
2. **Buckets by exit reason:** `target` (winner hit target), `stop` (loser hit
   stop), `time` (time-stop exit — may be a small win or small loss; label it
   TIMEOUT regardless, and let the R value tell the sign).
3. **Quotas:** **4 target + 4 stop + 2 time = 10.** This roughly matches the
   real exit mix (WR ≈ 45%, ~1.5R winners vs −1R losers) and guarantees the
   user sees all three exit mechanics.
4. **Deterministic draw:** sort each bucket by `(symbol, entry_ts)` (so the
   draw does not depend on concatenation order), then sample the quota without
   replacement with `numpy.random.default_rng(seed)`, starting at
   **seed = 42**.
5. **Representativeness constraints** on the drawn set of 10, checked after
   the draw:
   * ≥ 4 distinct symbols;
   * ≥ 3 distinct calendar years among entry timestamps;
   * no two selected trades from the same symbol in the same ISO week;
   * ≥ 3 longs and ≥ 3 shorts;
   * the two `time` trades come from different symbols.
6. **If any constraint fails, redraw all three buckets with seed+1** (42 → 43
   → 44 …) and take the **first seed that satisfies every constraint**. Record
   the winning seed in the captions file. This is a deterministic rejection
   loop, not manual curation — no human picks or vetoes individual trades.
7. **Audit trail:** write `viz/selected_trades.csv` with, per selected trade:
   trade id, symbol, direction, entry_ts, exit_ts, entry/exit prices, stop,
   target, reason, realized `r`, `pnl`, and the seed used. Also record the
   full-ledger bucket counts (how many target/stop/time trades existed in
   total) so the 4/4/2 mix can be judged against the true mix.

**Recovering stop/target for a ledger trade** (the ledger stores neither):
locate the fill bar index `i` where `bars.ts[i] == entry_ts`; the intent came
from the signal bar `i−1`, so `stop = sig.stop[i−1]`, `target =
sig.target[i−1]`. This is exact — the engine fills from the previous bar's
signal row — and requires no engine modification.

## 4. Chart spec

**One PNG per trade** (10 files), not a multi-panel figure. Reasons: each
trade's window has a different length (holds range 1–24 bars), so shared axes
waste space; per-trade files pair 1:1 with per-trade captions; and a single
readable candlestick chart at ~75 bars is already dense — 10 panels would
force unreadable candles.

* **Chart type: candlestick** (OHLC). The trigger is a close crossing a band
  and the stop fills intrabar off wicks — a line chart would hide both. Use
  plain matplotlib (wick = thin vertical line, body = bar/rectangle); do not
  add new dependencies like mplfinance unless already installed. Up candles
  `#26a69a`, down candles `#ef5350`, white/light background, no dark theme.
* **Time window:** **40 bars before the fill bar** through **exit bar + 10
  bars** (clamped to available data). Max ≈ 75 bars — readable, and 40 bars of
  context shows the stretch developing before the breakout.
* **Required elements per chart:**
  1. Candles, plus the §2 mean and ±2σ band across the whole window.
  2. **Signal bar** marked with a small hollow circle above/below its candle
     (the bar whose close crossed the band).
  3. **Entry:** horizontal solid black line at the actual fill price, drawn
     from the fill bar to the exit bar; a direction marker at the fill bar
     (`▲` below the bar for long, `▼` above for short) and text
     `entry {price}`.
  4. **Stop:** horizontal **red dashed** line over the same span, labeled
     `stop {price}` at its right end.
  5. **Target:** horizontal **green dashed** line over the same span, labeled
     `target {price}`.
  6. **Holding period:** light `axvspan` shading (alpha ≈ 0.10) from fill bar
     to exit bar.
  7. **Exit:** an `×` marker at (exit bar, exit price). For time exits the
     exit price is the bar close, between stop and target — visibly neither
     line was hit.
  8. **Title:** `{symbol} 1h — {LONG|SHORT} — entry {YYYY-MM-DD HH:MM} UTC —
     {WIN|LOSS|TIMEOUT} — {r:+.2f}R`. Small subtitle line: entry/stop/target
     prices and bars held.
* **Size/quality:** figsize ≈ (14, 7), dpi 150, tight layout. Axis dates in
  UTC; y-axis raw price (no log scale needed at ≤75 bars).
* **File naming:**
  `viz/trade_{01..10}_{symbol}_{yyyymmdd}_{long|short}_{win|loss|timeout}.png`,
  ordered: trades 1–4 target exits, 5–8 stop exits, 9–10 time exits, each
  group chronological.

**Captions:** `viz/CAPTIONS.md` — for each trade, the filename plus 2–3
sentences of plain description: what the market was doing, where the close
crossed the band (direction), and how the trade resolved (which line was hit,
or timed out, and the realized R). End the file with the selection audit
(seed used, bucket quotas vs. full-ledger bucket counts and true win rate) and
one honest reminder sentence that this rule's net edge is ≈ +0.019 R/trade —
these charts illustrate mechanics, they are not a performance claim.

## 5. Data source

Reuse the existing 1h pulls — **do not re-fetch** and do not use the
`intraday-mtf-smc` 5m data (that package holds 5m only; resampling would
introduce a second code path for no benefit — the v2 1h files are the exact
bars behind the §2.3 numbers).

The data dirs are gitignored, so they live only in the worktree where the v2
Researcher ran. Copy these files into the same relative paths in your own
worktree (`common.py` resolves v2/data first, then v1/data):

* `…/trade_automation/researcher-v2-timing-assets/research/intraday-mr-smc/data/{BTCUSDT,ETHUSDT,SOLUSDT}-1h.csv.gz`
  → `research/intraday-mr-smc/data/`
* `…/trade_automation/researcher-v2-timing-assets/research/intraday-mr-smc-v2/data/{BNBUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,LINKUSDT}-1h.csv.gz`
  → `research/intraday-mr-smc-v2/data/`

Fallback only if those files have vanished: re-fetch with the existing
`fetch_data.py` (v1 symbols) / `fetch_crypto_v2.py` (v2 symbols) — same
source, same window — and note the re-fetch in CAPTIONS.md.

**Sanity gate before plotting anything:** the pooled full-window ledger must
reproduce §2.3 — per-asset net PF in the 0.97–1.11 band, median ≈ 1.03,
pooled trade count ≈ 6,792, median WR ≈ 44.8%. If it does not, stop and
escalate; do not plot trades from a run that disagrees with the report.

## 6. Deliverables & acceptance checklist

New files, all under `research/intraday-mr-smc-v2/`:

* `viz_trades.py` — one script: build ledgers → select 10 → render 10 PNGs +
  CSV + captions. Re-running it must reproduce byte-identical trade selection
  (same seed → same trades).
* `viz/trade_01…10_*.png` — the 10 charts per §4.
* `viz/selected_trades.csv` — audit trail per §3.7.
* `viz/CAPTIONS.md` — captions + selection audit per §4.

Checklist:

- [ ] Engine/params untouched; §2.3 numbers reproduced before selection (§5 gate)
- [ ] 4 target / 4 stop / 2 time; constraints of §3.5 satisfied; seed recorded
- [ ] Every chart shows: candles, mean, ±2σ band, signal-bar marker, entry
      line+marker, stop line, target line, holding shading, exit marker, full title
- [ ] Rolling stats computed on the full series, then sliced (§2 warning)
- [ ] Stop/target recovered from the signal frame at bar `i−1` (§3, last note)
- [ ] No trade manually swapped; the rejection loop is the only selection mechanism

Out of scope: any parameter or engine change, funding/maker-fee modelling
(separately routed), index products, other candidates, and any new performance
metrics beyond the reproduction gate.
