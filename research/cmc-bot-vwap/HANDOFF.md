# HANDOFF — Researcher → Architect, `cmc-bot` VWAP band-reversal, Stage 0

> **Stage 1 is done and its handoff is `HANDOFF-STAGE1.md` (2026-09-16):
> all four pre-registered arms — US100, US500, BTCUSDT-(a), ETHUSDT-(a) —
> came back NO EDGE — KILL. Result in `REPORT.md`, pre-registration in
> `DESIGN.md`. This file remains the Stage 0 record; its three open questions
> were answered by `ARCHITECT-NOTE-STAGE1.md`.**

**Status:** Stage 0 complete, both gates PASS. **No performance number was
computed.** Stage 1 not started; it needs your go-ahead and three decisions
below.

## What was done

- Pulled Capital.com 1-minute history for US100, US500, EURCHF, GBPCHF through
  the bot's own `CapitalComSession` with the request `CapitalComClient` sends —
  3.93 M bars, **2024-01-01 .. 2026-09-11 for all four** (the API has no
  1-minute data before 2024-01-01; bisected). No gaps beyond market closures;
  holidays itemised in `results/COVERAGE.md`.
- Bug-faithful Python port (`engine.py`) of `VWapStrategy` + `StrategyTemplate`
  + `RiskManager` + `Order` + the backtest bar loop.
- **Gate 1:** diffed against the bot's unmodified TypeScript over **every month
  of all four instruments' whole history** — 200,322 evaluated bars with every
  intermediate value bit-identical, 2,322 orders identical in every lifecycle
  field, 0 discrepancies (`PARITY.md` §1).
- **Gate 2:** prefix-causality 600/600 on a truncated tape (`PARITY.md` §2).
- Signal inventory and funnel, counts only (`results/INVENTORY.md`).

## What you need to decide before Stage 1

1. **Which tape — D-01.** The bot's candle timestamps are broker-local time
   (UTC+2/+3) parsed as UTC. The *live* bot still trades the right bars; the
   bot's *own backtest* on scraped files trades bars 2–3 h earlier (indices:
   06:xx–09:xx NY, pre-cash-open; forex: 00:xx–01:xx NY) and shares
   essentially no orders with the live stream (0/895, 3/947, 0/239, 0/241).
   I keyed this pass's tape by `snapshotTimeUTC` = the live bot. Recommend
   pinning that. Also worth telling the user: any past backtest/grid search
   of this strategy on Capital.com data was measuring different hours than
   the labels said.
2. **Backtest bar or live bar as primary — L-01.** Live reads the bar that
   opened at T−1 at clock minute T (the API's `max: 720` truncation and the
   not-yet-served forming minute both point the same way); the backtest reads
   the bar that opened at T. 92–98 % of orders coincide. The difference is
   small; the primary should still be named in `DESIGN.md`. `engine.run(live_like=True)` exists.
3. **Split and the forex legs — §5.** History starts 2024-01-01 (32.3 months).
   Projected orders per 12 months, caps off: US100 ≈ 427, US500 ≈ 482,
   **EURCHF ≈ 89, GBPCHF ≈ 90**. `n_holdout ≥ 150` is easy for the indices and
   needs a ≥ 20-month holdout for the forex pairs, leaving ≤ 12 months of fit.
   By the precedent's stop rule the forex legs are **underpowered** under any
   conventional split. Options: indices only; forex with a long holdout and
   thin fit; or forex as descriptive-only. Your call.

## Findings that change pinned knowledge

- **D-03 — `getLastIfvg` is asymmetric.** `lastIFVG` is undefined only when the
  *bullish* iFVG list is empty; an empty *bearish* list returns a valid
  element. Both `knowledge/vwap-band-reversal-ict.md` §3 and
  `knowledge/smart-money-ict.md` §1.3 say "either list". I corrected the VWAP
  file. **I did not touch `smart-money-ict.md` or the smart-money Stage-0 WIP
  (unmerged `429b0db`)**, whose port encodes the symmetric reading — that
  package's owner should re-check it. Verified directly against the bot's
  `calculateFVG` (`ts_parity/unit_last_ifvg.ts`).
- D-05 (the bias compares the bar's **open** to the band), D-06 (the 200-bar
  range excludes the current bar), D-07 (VWAP from 00:01 UTC, population
  stdev, broker tick volume), D-18 (`VWAP([])` throws on forex holidays — the
  bot's own backtest CLI would crash there). All added to the knowledge file.
- L-02: live US500 bias VWAP double-counts a chunk-boundary bar whenever the
  12h tape has a missing minute (59 % of US500 evaluations). L-03: the live
  request fails outright if the host clock leads Capital.com's by more than
  the firing latency (reproduced the rejection). Neither is reproducible
  bar-exactly; both are listed, not modelled.

## For Stage 1 (if routed)

- Everything needed is in place: `engine.run(P, lo, hi, daily_caps=..., live_like=...)`
  returns orders with entry/stop/target/exit; `results/signals_*.parquet`
  (as-deployed and caps-off) are ready but **deliberately unsummarised**.
- The raw pull keeps bid/ask; `spread_close` per bar is in the parquet, so the
  cost model can use Capital.com's actual historical spread (ARCHITECT-NOTE §4).
- Exit mechanics (close-only, clamped fills, forced flat at 14:30 / 04:00 /
  05:00 NY) are the bot's; a realistic-fill template would need to be added,
  as in the smart-money ruling.
- ~38 % of index `processCharts` signals are swallowed by an already-open
  same-direction order — the caps-off population is still path-dependent
  through that rule.

## Software Engineer guidelines (only on a REAL EDGE verdict)

A build must fix, not inherit, D-01 (map `snapshotTimeUTC`), decide
deliberately on D-03 and L-01, catch D-18, and guard L-03 (subtract a clock
margin from `to`). None of these should be silently "improved" in the
research primary.

## Pros / cons as I understand the idea (no outcome information)

- Pro: fully specified, deterministic, reproducible to the bit; runs on data
  the user actually trades; indices give enough trades to test.
- Con: three ingredients each with a standing null in this project (proximal
  iFVG, prior-level sweep, now a VWAP stretch); hand-tuned thresholds; forex
  legs too sparse to test; broker CFD tape and tick volume; the user's past
  evidence for it (if any came from the bot's backtest on Capital.com data)
  was measured on the wrong hours (D-01).

---

# Addendum 2026-09-13 — the user's two extensions: "back to 2022" and "BTC + ETH"

Full detail: `crypto/README.md`, `results/crypto/PARITY_CRYPTO.md`,
`results/crypto/INVENTORY_CRYPTO.md`, `results/crypto/CHECKS_CRYPTO.md`,
`results/capital_com_floor_probe.txt`. **Still no performance number, no verdict.**

## 1. Extending the four Capital.com instruments to 2022: not possible

**The 2022–2023 extension cannot be done for US100, US500, EURCHF or GBPCHF.
This is Capital.com's own API data limit, not a research gap.**

Evidence (`ts_harness/probe_floor.ts` → `results/capital_com_floor_probe.txt`,
plus the Stage-0 bisection `ts_harness/probe_bisect.ts`): the same `/prices`
request the bot sends, on weekday session hours, for all four instruments:

| resolution | 2022-09-14 | 2023-12-28 / 2023-12-29 | 2024-01-02 |
|---|---|---|---|
| MINUTE | `error.prices.not-found` | `error.prices.not-found` | 61 bars |
| MINUTE_5 / MINUTE_15 | `error.prices.not-found` | — | — |
| HOUR / DAY | **served** (93–97 hourly bars, 26 daily bars) | — | — |

The instruments, the credentials and the request shape all work for 2022 at
hourly/daily resolution; only the intraday resolutions stop at 2024-01-01.
That is a retention limit on Capital.com's side. The strategy is defined on
1-minute bars (its iFVG, 6-bar sweep, 200-bar range and 20-bar ATR are all
M1 bar counts), so hourly data cannot stand in without changing the strategy.
I did not look for other Capital.com endpoints: the public REST API has one
historical-prices endpoint (`/prices`) and I have no concrete reason to think
another route serves deeper minute history. A 2022 extension on these
instruments would need a different data vendor, which means a different tape
and different prices from what the user trades (ARCHITECT-NOTE §4's broker
caveat), so it would be your routing decision, not a pull.

## 2. BTCUSDT / ETHUSDT extension: what was built

- **Data:** Binance USD-M perpetual 1-minute klines, **2022-08-01 00:00 →
  2026-09-11 23:59 UTC**, 2,164,320 bars each, **no missing minutes**
  (`crypto/fetch_binance_1m.py`, a wrapper over the project's shared
  `research/intraday-mr-smc/fetch_data.py`). No 1-minute cache existed
  anywhere in the project (only 5m/15m/1h), so this was a fresh pull.
- **Mechanic:** the same `engine.py`, unchanged in every rule and parameter.
  Only the clock gates are chosen (below). The refactor that added a `timing`
  argument was re-proven on Capital.com: 132/132 months, 0 problems, the
  order logs identical to the committed ones.
- **Parity, stated plainly:** the bot never ran `VWapStrategy` on BTC/ETH, so
  there is **no live or shipped history to diff against**. What *can* be
  diffed is the bot's own TypeScript run on this Binance tape. I did that
  over the **entire 49-month period, both conditions, both symbols**: 530/530
  chunks, **4,591,936 evaluated bars bit-identical, 8,158 orders identical, 0
  discrepancies**; prefix-causality 600/600 (`results/crypto/PARITY_CRYPTO.md`,
  `CHECKS_CRYPTO.md`). In the `all` condition the harness
  overrides the two clock predicates to `true` in a subclass; every other
  line is the bot's. This proves "the port equals the bot's code on this
  tape". It does not prove anything about a deployment that never existed.
- **Order logs (the four requested files, as-deployed = daily caps on):**
  `results/crypto/signals_BTCUSDT_win.parquet`, `signals_BTCUSDT_all.parquet`,
  `signals_ETHUSDT_win.parquet`, `signals_ETHUSDT_all.parquet`. Same schema as
  `results/signals_*.parquet`. Caps-removed twins: `signals_nocaps_*`.

## 3. The entry-window fork: counts only

| symbol | condition | orders, caps on | per 12 mo | orders, caps off | per 12 mo |
|---|---|---|---|---|---|
| BTCUSDT | **(a) `win`** — entry 09:40–11:40 NY, alive to 14:30 NY, Mon–Fri | 1,309 | 318 | 1,677 | 408 |
| BTCUSDT | **(b) `all`** — every minute, 24/7, never force-closed | 2,845 | 691 | 17,095 | 4,154 |
| ETHUSDT | (a) `win` | 1,145 | 278 | 1,377 | 335 |
| ETHUSDT | (b) `all` | 2,859 | 695 | 15,567 | 3,783 |

What the counts already show about the fork (mechanics, not outcomes):

- **(a) `win` is the CFD-index configuration on a crypto tape.** Order density
  is close to the indices' (US100 332 / US500 352 per 12 months, caps on). It
  is the condition comparable to Запись 18, but only in the *window*:
  session-liquidity-v5-ny tested a different mechanic (far-edge iFVG / BoS
  after a session-level sweep, 5m bars, a fixed-UTC 13:40–15:20 window without
  DST). The overlap is "a NY-morning window on BTC/ETH", not "the same
  hypothesis". A kill there is not a kill here, and a pass here would not
  rescue that one.
- **(b) `all` with the caps on is not really "unrestricted".** The daily caps
  (2 losses / 1 win per UTC day) reset at UTC midnight and are used up within
  hours. 28,248 (BTC) / 24,643 (ETH) bars that pass every mechanic gate are
  suppressed by the caps, and the as-deployed orders cluster in the **first
  six hours after 00:00 UTC** (BTC 2,684 of 2,845; ETH 2,647 of 2,859). With the caps
  on, (b) becomes an implicit "first hours after the VWAP reset" strategy, a
  window nobody chose. **The honest version of (b) is caps off**: about
  3,800–4,150 orders a year per symbol.
- In (b) the VWAP reset at 00:00 UTC is also where the band is narrowest (one
  bar at 00:01, so zero width), and the 00:00 bar itself throws in `VWAP([])`
  every day (1,503 bars per symbol, identical in the TypeScript). On a 24/7
  tape the UTC-midnight anchor is the Binance daily-candle boundary, a real
  convention but an arbitrary one for this mechanic.
- Weekend orders exist only in (b): 818 (BTC) / 824 (ETH). The code gates
  weekends only through the clock predicates.

**My recommendation, if this goes anywhere:** decide the window before any R
exists. If (b), register it caps-off, and note that its population is
dominated by re-entries: 2,764 / 2,606 signals are blocked by an open
same-direction order even with caps on.

## 4. Parameters: nothing changed; notes for a crypto registration

- Every threshold is a dimensionless ratio (band width ÷ ATR, ATR ÷ gap size,
  range ÷ stop, R multiples) and every lookback is a bar count, so nothing
  *needs* rescaling for crypto's price level or volatility. I changed nothing.
- But the distributions differ, and three of them matter:
  1. **VWAP volume is real exchange volume here** (Binance base-asset volume)
     versus Capital.com broker tick activity: same formula, different quantity.
  2. **Stop distance vs costs** (`results/crypto/stop_distance_bp.txt`, order
     geometry only): median initial stop is 31.8 bp (BTC `win`), 17.7 bp (BTC
     `all`), 41.9 / 25.2 bp (ETH). The project's standard 0.10 % round trip is
     more than half the median stop in BTC `all`. Any Stage 1 on crypto should
     treat costs as first-order, not as a footnote.
  3. The band-width gate [2.5, 11.5] passes 88–89 % of biased bars in `win` but
     62–65 % in `all`, because early-UTC-day bands are narrow. The regime filter
     behaves differently off-session.
- The daily caps are the one parameter whose *meaning* changes on a 24/7
  tape (§3). They are a risk overlay, not part of the signal. I would register
  crypto caps-off by default, as the smart-money ruling did for its primary.

## 5. Open questions for the Architect

1. **Route the crypto extension at all?** It is a new instrument class for
   this strategy, and the user asked for it. There is no deployment to validate.
2. **Which window: (a), (b), or both as separate registrations?** If (a), how
   to treat its overlap with the killed v5-NY window. If (b), caps off?
3. **Split:** the Binance tape covers 2022-08 → 2026-09, so the smart-money
   ruling's 2022-08 → 2025-07 fit / 2025-08 → 2026-07 holdout would fit
   unchanged. Power is not a constraint on crypto under either condition.
4. **Costs:** 0.10 % taker round trip as in v5-NY, given the stop distances in §4.
5. Nothing here changes the Capital.com open questions above (tape timing D-01,
   backtest vs live bar L-01, forex underpower).
