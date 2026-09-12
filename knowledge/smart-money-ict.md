# ICT "smart money" — true opens, premium/discount, proximal-edge iFVG

Canonical definitions for the ICT-flavoured primitives introduced into this
project by the user's pre-built bot at `cmc-bot-main/` (their own prior
project, not built by this team), and for the composed strategy that bot
implements.

**Everything below was read directly off the TypeScript source and is a
description of code that exists, not a design proposal.** Where the code's
behaviour differs from its own naming, or from the same-named concept
elsewhere in this knowledge base, the code wins and the difference is called
out. Nothing here has been validated by this project — see §0.

## 0. Status

- **Mechanic pinned 2026-09-12 by Architect** (`research/cmc-bot-smart-money/ARCHITECT-NOTE.md`,
  `RESEARCH-LOG.md` Запись 19). **Not validated.** No number in this project's
  record supports or refutes it; the bot's own in-repo backtester
  (`cmc-bot-main/src/backtesting/`) models **no costs, no spread and no
  slippage**, fills entries at the signal bar's close, and clamps a
  gapped-through stop back to the exact stop price (§4.6) — so no historical
  result produced by it is admissible here.
- **Family:** this is **not** session-liquidity (`knowledge/session-liquidity.md`).
  It contains **no level-sweep detection step of any kind** — nothing in the
  entry condition requires a level to have been taken out first. The level
  machinery it does compute (PDH/PDL/PWH/PWL/PMH/PML, London high/low) is
  **never read by the signal** and is structurally incomplete besides (§5).
  The session-liquidity shelving ruling (Запись 17) and its C3 reopen trigger
  are therefore **untouched** by this idea, in either direction.
- **Family it *is* in:** `knowledge/smc.md` §3 — the register of tested
  "HTF bias → LTF entry trigger" encodings. This is encoding **#4** of that
  family (bias engine = H1 iFVG direction; entry trigger = M1 iFVG; zone
  filter = premium/discount + true-open side). Encodings #1–#3 are all closed
  as statistically indistinguishable from noise. That standing null is the
  reason this one reopens only under a pre-registered test — see the
  architecture note.
- **Primitives introduced here that this project had not pinned before:** the
  ICT **true-open** level family (§2), the **premium/discount** midpoint over
  a swing-anchored running range (§3), and a **proximal-edge** definition of
  iFVG (§1.2) that is *not* the far-edge definition used by
  `knowledge/session-liquidity.md` §5.1. Do not let the shared word "iFVG"
  hide that.

## 1. FVG and iFVG — this bot's definitions

Source: `cmc-bot-main/src/indicator/tools/fvg-element.ts` (stateful
`FvgCalculator`, used on M1 by the indicator engine) and
`cmc-bot-main/src/indicator/tools/fvg.indicator.ts` (`calculateFVG`, the
one-shot version used for the H1 bias). The two are the same algorithm; only
the one-shot version reports the last bar's flags.

### 1.1 FVG (3-candle, with an extra body condition)

Bar `i` against bar `i-2`:

- **Bullish FVG** iff `close[i] > open[i-2]` **and** `low[i] > high[i-2]`.
  Recorded as `{low: high[i-2], high: low[i], x: i}`.
- **Bearish FVG** iff `close[i] < open[i-2]` **and** `high[i] < low[i-2]`.
  Recorded as `{low: high[i], high: low[i-2], x: i}`.

The second clause is the standard geometric gap. The **first clause is
extra** — a body condition against bar `i-2`'s *open* — and is not part of
the plain FVG definition in `knowledge/smc.md` §1 or
`knowledge/session-liquidity.md` §5.1. In practice it is nearly always
implied by the gap, but it is not identical and a port must carry it.

### 1.2 iFVG — inversion through the **proximal** edge

An FVG is held in a live list. On every bar it is tested with that bar's own
`open`/`close`:

- A **bullish** FVG is inverted (removed from the FVG list, appended to the
  bearish-signal iFVG list) iff `open > fvg.low` **and** `close < fvg.low`.
- A **bearish** FVG is inverted iff `open < fvg.high` **and** `close > fvg.high`.

`fvg.low` of a bullish gap is its **lower** edge — the edge price approaches
from above, i.e. the **proximal / near** edge. So inversion here means *a
close back through the near side of the gap*, and the bar must have **opened
on the far side of that edge** (a bar opening inside the gap and closing
beyond it does **not** invert it).

> **This is a different event from `knowledge/session-liquidity.md` §5.1**,
> where an iFVG is a close through the **far** edge of the gap. Same word,
> different trigger, different frequency, different geometry. Any pass
> touching both must say which one it means.

- Flags exposed per bar: `isLastCandleDiscardBullishFvg` (a bullish FVG was
  just inverted → a **bearish** signal, surfaced as `bearishIfvgOccurs`) and
  the mirror. The naming inverts; the polarity in the strategy is correct.
- iFVGs are themselves **pruned**: an entry in the bullish-signal iFVG list is
  dropped once a bar closes back down through its `low` (mirror for bearish).
  So both iFVG lists are frequently empty — which has a large behavioural
  consequence, see §1.3 and §4.4.
- No level, no sweep, and no location filter of any kind participates in this
  definition.

### 1.3 "Last iFVG" and "last iFVG direction" — the defaults and the index bug

`getLastIfvgDirection()` / `getLastIfvg()` (both files, identical logic):

- If the bullish-signal iFVG list is **empty** → direction defaults to **sell**.
- Else if the bearish-signal list is empty → direction defaults to **buy**.
- Else → whichever list's newest entry has the larger bar index `x`.

The first two branches are **defaults, not observations**: with both lists
empty the answer is `sell`. The direction is therefore structurally
sell-biased in quiet tape.

`getLastIfvg()` has a real **index bug** in exactly those two branches — it
indexes one array by the *other* array's length minus one, i.e. `arr[-1]`,
and returns `undefined`. Consequence (§4.4): whenever **either** iFVG list is
empty, `lastIFVG` is undefined, the ATR gate divides by nothing and the trade
is blocked. So the gate silently also requires **both** lists to be non-empty
simultaneously. This is behaviour a reproduction must carry, not fix.

## 2. True-open levels

Source: `cmc-bot-main/src/indicator/tools/date-helpers.ts`. All are New York
wall-clock times converted through `zonedTimeToUtc(..., 'America/New_York')`,
so they are DST-aware. A level is set to the **open price of the first bar at
or after** that instant, and persists as a horizontal ray.

| Level | Instant |
|---|---|
| **Day true open** | 00:00 New York |
| **NY AM true open** | **07:30 New York** |
| **NY exchange open** | 09:30 New York |
| Week true open | Monday 01:00 |
| Month true open | the **second Monday** of the month, 00:00 |

**The NY AM true open is 07:30 New York, not 09:30.** It is the open of the
ICT "AM quarter", a distinct concept from the cash-equity open, and distinct
from anything in `knowledge/session-liquidity.md`. Only the day / NY-AM / NY-exchange
levels are stored as state; week and month opens are drawn but not stored.

- `aboveNYamTrueOpen` compares the **open of the most recent bar** (not its
  close) against the stored level, and is **`false` when no level has been
  set yet** in the window — so "not above" conflates *below* with *unknown*.
  The buy branch keys off `!aboveNYamTrueOpen` (§4.2), so a missing level
  reads as a buy permission. A reproduction must carry this.
- **Host-timezone caveat:** `getTargetTimeFromNYTime` and the strategy's own
  session gate both build their target from `startOfDay(new Date(ts))`, which
  is the **host machine's** local midnight, and only then reinterpret that
  naive wall-clock as New York. The conversion is correct on a **UTC host**
  and can slip a day elsewhere. Pin: any reproduction assumes a UTC host.

## 3. Premium / discount

Source: `cmc-bot-main/src/indicator/functions/y-in-discount.ts`,
`functions/swings.ts`, and the `h_trail_up` / `h_trail_dn` state in
`main-indicator.ts`.

- `rangeHigh` (`h_trail_up`) is **seeded** by the most recently confirmed
  swing high of a **60-bar** `Swings` detector and then **trails upward** with
  every new bar high; it resets down to the swing high each time a fresher
  60-bar swing high confirms. `rangeLow` is the mirror.
- `priceInDiscount` ≡ `0.5 * rangeHigh + 0.5 * rangeLow > close[last]` —
  price below the midpoint of that swing-anchored running range. "Premium" is
  the complement; there is no equilibrium band.
- The `Swings` detector — and therefore the whole range — only starts updating
  **after bar index 200** in the supplied window (`i > max(60, 15, 3, 200)`).
  On a shorter window `rangeHigh`/`rangeLow` stay **0**, which makes the stop
  distance equal to the entry price (§4.5). **A window of ≥ 201 bars is a hard
  warm-up requirement**, not a nicety. The bot supplies 12 h of M1 = 720 bars.

## 4. The composed strategy (`SmartMoneyStrategy`)

Source: `cmc-bot-main/src/strategy/smartmoney-strategy.ts`,
`strategy-template.ts`, `risk-manager.ts`, `order.ts`. Timeframes: **M1** for
entry, **H1** for bias.

### 4.1 Evaluation cadence and session gate

- One evaluation per **M1 bar**. Each evaluation is handed a rolling **12-hour
  window of M1 candles** (720 bars) and recomputes **all** indicator state
  from scratch over that window.
- `isValidTimeForNewOrders` and `canOrdersBeAlive` are the **same** predicate:
  **09:40–11:10 America/New_York wall clock** (DST-aware), **Mon–Fri**.
- Outside that window the strategy **force-closes every open order** at the
  last M1 close. Maximum holding time is therefore **90 minutes**, and a
  **time-exit at 11:10 NY is a first-class exit path**, not an edge case — it
  will account for a large share of outcomes and must be reported as its own
  exit category.

### 4.2 Entry conditions

All conditions are evaluated on the same M1 bar and must hold simultaneously.

**Sell:** `aboveNYamTrueOpen` **and** `bearishIfvgOccurs` **and**
`!priceInDiscount` **and** H1 bias == sell **and** ATR gate **and** daily caps
not reached.

**Buy:** `!aboveNYamTrueOpen` **and** `bullishIfvgOccurs` **and**
`priceInDiscount` **and** H1 bias == buy **and** ATR gate **and** daily caps
not reached.

The two location filters point the **same way** as the bias, so the mechanic
reads as: *continuation in the direction of the H1 iFVG bias, triggered by an
M1 iFVG, permitted only while price sits on the bias-consistent side of both
the NY-AM true open and the range midpoint.* No level is required to have been
swept at any point.

### 4.3 H1 bias

Fetch **720 hours (30 days)** of H1 candles ending at the current bar, run
`calculateFVG` over them, take `lastIFVGDirection` (§1.3 — including its
defaults). Recomputed on every M1 evaluation.

### 4.4 The ATR gate

`ATR(20)` over the M1 window, divided by the size of `lastIFVG`:
`ATR / |lastIFVG.high − lastIFVG.low| < 8`.

- Despite the constant's name (`MAX_IFVG_TO_ATR_RATIO`) the ratio computed is
  **ATR ÷ gap size**, so the gate requires the gap to be **wider than
  ATR/8** — it rejects **small** gaps, not large ones.
- `lastIFVG` is `undefined` whenever either iFVG list is empty (§1.3), which
  makes the ratio `Infinity` and **blocks the trade**. The gate therefore also
  enforces "both iFVG lists non-empty".

### 4.5 Stop, target, trail

- **Stop anchor:** `rangeLow` for a buy, `rangeHigh` for a sell (§3).
  `stopSize = |anchor − close[last]|`.
- **Shrink table** (`RiskManager.adjustStopLoss`), keyed on
  `ratio = rangeSize / stopSize` where `rangeSize = |rangeHigh − rangeLow|`:
  `ratio < 2.5` → ×**0.5**; `2.5 ≤ ratio < 3` → ×**0.7**; else ×1. The shrink
  fires when the stop is **large relative to the range**.
- **Target:** entry ± **2.7 × stopSize** (`TARGET_RISK_REWARD_RATIO = 2.7`),
  fixed, never adapted.
- **Trail** (`tryToTrailStopLoss`, on M1 closes): unrealised profit > **1R** →
  stop to **breakeven**; > **2R** → stop to **+1R**. Ratchet only.

### 4.6 Fills, exits and the optimism baked into them

- **Entry fill = the close of the signal bar**, stamped at the next bar's open
  time. No spread, no slippage.
- **Exits are checked on M1 closes only.** A buy closes when
  `close < stopLoss` or `close > takeProfit`; intrabar wicks never trigger
  anything.
- `Order.close()` then **clamps the recorded fill back to the exact stop or
  target price**. A bar that gaps clean through the stop is therefore booked
  as a tidy **−1R**. This is **optimistic on the loss side** and conservative
  on the win side, and it is the single largest reason the bot's own backtest
  numbers cannot be taken at face value.
- **No cost model exists anywhere in the bot.**

### 4.7 Position and daily limits

- At most **1 open order per direction**; if a long and a short are ever open
  together the **earlier** one is force-closed at the current close.
- Per calendar day (of the close time): at most **2 losing** and at most
  **1 winning** *closed* order. After the first winner the day is over.
- These are a money-management overlay applied *on top of* the signal. They
  discard signals for reasons unrelated to signal quality and make the trade
  stream path-dependent — which matters for how a validation pass defines its
  population (see the architecture note).

## 5. Computed but unused — do not read this bot as having sweep logic

`indicatorScript` also computes and exports PDH/PDL, PWH/PWL, PMH/PML, the
London high/low (02:00–05:00 NY) with `isLondonHighTaken` /
`isLondonLowTaken`, and `trend` / `bullishBos` / `bearishBos`. **None of them
is read by `SmartMoneyStrategy`.** Two further facts:

- `trend` and `itrend` are declared and **never assigned** anywhere in the
  loop, so `bullishBos` and `bearishBos` are **permanently `false`**. There is
  no working BoS in this bot.
- The prior-day / prior-week / prior-month extremes are scanned **only over
  the supplied 12-hour window**, so "yesterday's high" is computed from at
  most a couple of hours of the prior day's tape. They are structurally
  wrong, not merely unused.

Do not port any of this, and do not cite this bot as evidence about
sweep-based mechanics.

## 6. Out of scope of this concept file

`cmc-bot-main` also contains a `vwap-strategy`, a `tech-analysis`/RSI
strategy, a `correlation-analyzer`, a Telegram control/notification bot, and
AWS/OTel deployment plumbing. None of those are covered here or by the
associated research package.
