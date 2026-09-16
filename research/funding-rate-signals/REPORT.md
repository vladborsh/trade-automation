# Research package — funding-rate signals on Binance USD-M perps: carry (A) and funding-extreme continuation (B)

**Role:** Researcher (Opus 5) · **Protocol:** `DESIGN.md`, restating the
binding pre-registration `ARCHITECT-NOTE.md` (commit `61a2058`), committed at
`af89ea7` **before any R existed** · **Stage-0 ruling:**
`ARCHITECT-RULING-2026-09-16-stage0.md` (`a393ffc`), recorded at `09d5ef8` ·
**Screen decision:** `DESIGN.md` §13, committed at `31a9c0e` **before any
holdout number existed** · **Hand-off:** Architect (`HANDOFF.md`).

**The idea, in my own words.** Every candidate this project has priced so far
has consumed price. The perpetual funding rate is something else: it is the
**price the crowd pays to stay crowded**, printed by the exchange three times
a day, and it is the one input that pays you *while you hold* rather than
only when you are right. The confirmed diagnosis from `intraday-mr-smc` §2.1
is that leveraged crowding is the fuel of the self-reinforcing moves that
killed reversion on perps. This pass asks the two honest questions that
follow: **(A)** can you get paid enough to stand in front of that crowd, and
**(B)** does the crowd's price tell you when it is about to be run over.

---

## 0. Bottom line

**All four pre-registered arms are dead on the fit period. The holdout was
never read.**

| arm | fit `n` | mean netR | Null-A `p` | §6.6 floor | §6.3 margin vs shadow | **verdict** |
|---|---|---|---|---|---|---|
| **A carry, majors** | 89 | **−0.129R** | 0.891 | **failed** (89 < 300) | −0.123 | **NO EDGE — fit-period kill** |
| **A carry, alts** | 394 | **−0.020R** | 0.572 | met | +0.005 | **NO EDGE — fit-period kill** |
| **B continuation, majors** | 32 | +0.085R | **0.209** | **failed** (32 < 300) | +0.162 | **NO EDGE — fit-period kill** |
| **B continuation, alts** | 196 | **−0.014R** | 0.448 | **failed** (196 < 300) | +0.034 | **NO EDGE — fit-period kill** |

The pre-registered sentence for this outcome, which §9 point 6 of the note
asked for in advance and which the numbers now support: **on Binance USD-M
perps, 2020–2026, the funding rate neither pays for its own price risk nor
selects squeezes beyond what trailing price already does.** That is the second
half of the positioning question `deriv-positioning` answered for the quantity
side.

**But the interesting part of this kill is *why*, and it is not the reason the
design expected.**

The design's central worry — inherited from `deriv-positioning`, where the
OI signal died as "price in disguise" — was that a rule which shorts on extreme
funding is really a rule that shorts after rallies. **That worry is
unfounded here, and the data says so cleanly.** The price shadow is the
identical pipeline with funding replaced by the trailing-24 h-return
percentile. Compare what the two rules actually *collect*:

| arm | mean `fundingR` | its shadow's mean `fundingR` | ratio |
|---|---|---|---|
| A alts | **+0.0353R** | +0.0014R | **≈ 25×** |
| A majors | **+0.0552R** | +0.0015R | **≈ 37×** |
| B alts | **+0.0280R** | −0.0000R | — |
| B majors | **+0.0390R** | −0.0013R | — |

Entering on extreme funding collects **twenty-five to thirty-seven times more
carry** than entering on an extreme trailing return with the same template,
the same stop and the same accounting. **The funding sensor is emphatically
not price in disguise.** It measures something a price chart does not, it
measures it well, and the thing it measures — persistent, collectable carry —
is exactly what hypothesis A said it was.

**The hypothesis dies anyway, and it dies on the leg the note predicted would
be negative.** The §6.8 mechanism prerequisite **passes**: the extreme state
survives three settlements 40 % of the time and nine settlements 28 %, and the
mean rate over the next nine settlements is **+0.058 %/8 h ≈ 63 %
annualised**. The carry is real, persistent and collectable. It is simply
**too small to pay for the price risk of collecting it**:

| A arm | mean `priceR` | mean `fundingR` | mean `costR` | **mean `netR`** |
|---|---|---|---|---|
| alts | **−0.0460** | +0.0353 | 0.0094 | **−0.0201** |
| majors | **−0.1707** | +0.0552 | 0.0139 | **−0.1294** |

On the alts the carry covers **77 %** of the price bleed and then loses to the
commission. On the majors it covers **32 %**. The note said it plainly in
advance — *"the funding leg must outrun a leg expected to be negative"* — and
it does not. **This is a cleaner and more useful negative than "no signal
found": the sensor works, the mechanism is present, and the trade still loses.**

**Two facts worth carrying forward as facts rather than as candidates:**

1. **Funding is *negatively* informative inside a fixed price bucket.** The
   §6.4 incremental control holds the price shadow fixed and splits by funding
   inside it: **0 of 6 cells** have the funding split positive, pooled Welch
   **t = −4.32**. The pre-committed bar was ≥ 4 of 6 and t > 2. This is not a
   null result — within a given trailing-return tercile, the extreme-funding
   settlements are the *worse* ones to short.
2. **The squeeze shape is now closed on both sensors.** `deriv-positioning`
   (b1) killed it with the quantity sensor at −58.4 bp / t = −4.56. B is the
   same shape with the price-of-crowding sensor **plus** a with-the-crowd
   condition b1 lacked, and it produces −0.014R on the alts (n = 196) and a
   statistically empty +0.085R on 32 majors trades. §3.3 below reconciles the
   two in detail. **No reconciliation is owed to a pass, because there is no
   pass.**

Everything below is **fit-window only**. The holdout
(**2025-08-01 → 2026-07-31**) **was not read at any point in this pass and
remains clean**, as does the 2026-08 tail.

---

## 1. STAGE 0 — the data, and the three rulings it produced

### 1.1 What was pulled

A **fresh, self-contained pull** (`fetch_data.py`), no credentials, from the
public `data.binance.vision` bulk archive: 1 h klines and `fundingRate`, all
8 perps, **every symbol's first archived month through 2026-08** (2026-09 is
not yet published). 85 months probed per symbol per dataset; every month's
HTTP outcome and row count logged to `results/fetch_log.csv`. No earlier
package's tape is reused.

The archive is **far cleaner than §3.3 anticipated**:

| | funding | 1 h klines |
|---|---|---|
| expected 8 h grid slots | 56,854 | — |
| **missing slots** | **0 on all 8 symbols** | 240 on 2 symbols (0.21–0.23 %), all backfilled |
| duplicate slots | 0 | 0 |
| NaN rates | 0 | — |
| fit-window missing % | **0.0000 % on all 8** | 0 after backfill |

**The §5.3 rule-6 symbol rule is never engaged: no symbol is dropped and both
tiers keep all their symbols.** Coverage runs 2020-01-01 (BTC/ETH) to
2026-08-31 — the deepest history the archive publishes, per the standing
preference for crypto passes.

### 1.2 The three Stage-0 escalations, raised before any R existed

All three were escalated under §9 point 1 **before a single derived series was
built**, and all three were ruled the Researcher's way
(`ARCHITECT-RULING-2026-09-16-stage0.md`). Full mechanics are in `DESIGN.md`
§5.6; the disclosures the ruling requires here:

**(1) `SOLUSDT` funding interval change — the FTX week.** 101 of 6,610 SOL
rows carry `funding_interval_hours ≠ 8`. The exchange moved SOL
**8 h → 4 h at 2022-11-09 20:00 UTC → 2 h from 2022-11-10 04:00 → back to 8 h
at 2022-11-18 16:00**, and **the rate sat pinned at the −2.0 % cap for part of
it**. No other symbol has a single non-8 h row. Ruled an **interval-anomaly
blackout on SOL only** over `[2022-11-09 20:00, 2022-11-18 16:00)` — 26 grid
slots — removed from the settlement stream for all signal purposes and from
the `fpct` window, with the shadow masked identically so that §6.3 stays an
identical pipeline. **Excluded-and-counted SOL trades: 0 on arm A, 0 on arm
B** (`results/sol_blackout.csv`). Zero because the one open SOL trade before
the span was stopped out on 2022-11-08 18:01, before the blackout begins, and
the next SOL entry is **2022-11-19 01:00** — exactly the first entry the
ruling predicted would be possible. **The audit shows zero non-8 h rows in the
holdout window, so the holdout is unaffected.**

**(2) Truncated monthly kline zips.** `SOLUSDT` and `XRPUSDT` each missed 120
1 h bars on *identical* spans — 2022-02-26..28 and 2022-04-01..02. The daily
prefix of the same archive has all 10 days. **240 bars were backfilled from
`data/futures/um/daily/klines/`**, logged per day in
`results/data_audit_fills.csv`. `checks.py` **1c** verifies that the filled
opens are exactly the missing ones with no duplicates, and that **four
neighbouring days present in both the monthly and daily files match
row-for-row** on open time and OHLCV — the archive is self-consistent, so this
was a truncated zip, not an outage.

**(3) Funding rows predating the first 1 h bar.** **38 settlements** across
three symbols (ADA 35, SOL 2, DOGE 1) are genuine exchange prints with no bar
to trade on. The warm-up clock starts at `max(first funding row, first 1 h
bar)`; they feed `fpct` history only. `checks.py` **1** counts them as exempt
rather than dropping them silently.

**Two computed fit starts differ from the note's §3.1 table, and the computed
date governs** (`results/fit_starts.csv`): the table grouped BTC/ETH/XRP/LINK
as "first month 2020-01 → fit start 2020-01-16", but **XRP actually listed
2020-01-06 and LINK 2020-01-17**, so their warm-ups end **2020-01-21** and
**2020-02-01**. This costs XRP 5 days and LINK 16 days of fit sample and
changes nothing else.

---

## 2. Wiring checks — all ten green (`results/checks.csv`)

```
1   settlement-on-bar-open (>= first bar)      0 offenders / 8 symbols
                                               38 pre-listing rows exempt+counted
1b  SOL blackout: min_periods still met        64 valid rows in a 90-slot window
                                               fpct defined 90/90 slots after
1c  authorised daily-prefix backfill           240 bars; opens exact; 4 neighbour
                                               days monthly==daily row-for-row
2   fpct / spct prefix stability               0 / 400 violations
3   no settlement outside (t_entry, t_exit)    0 / 3,913 ledger rows, 711 trades
4   no trigger on a missing slot               0
5a  trigger/stop/exit branch mirror            exact
5b  funding sign convention                    max|d| = 0.00e+00
5c  percentile mirror, measured                max|d| = 1.77e-16
6   no signal/path on an absent bar            0 trades
```

**One check had to be rebuilt, and the reason is worth recording.** The
note asks for "a sign-flipped tape gives sign-flipped trades". A naive
reflected tape **silently tests the wrong thing**: three quantities in this
design are not equivariant under any single price transform — the trailing
**ratio** return (B's condition 2 and the whole shadow), the funding
**notional** (a price *level* times a rate) and `costR` (a price level over a
distance). The first version of check 5 duly "failed" on artefacts of its own
construction. It is now decomposed into three parts, each **exact**: 5a
mirrors the trigger/stop/exit branches on an additively reflected tape with
the notional and costs zeroed; 5b verifies `collect(side, f) ==
collect(−side, −f)` algebraically; 5c *measures* the percentile definition's
own symmetry.

5c found a real, if tiny, asymmetry **in the pre-registration rather than in
this implementation**: §1.2 computes `fpct` with `<=` **including the current
value**, so `fpct(−x) = 1 − fpct(x) + 1/n` exactly, and **`ext_neg` is
stricter than `ext_pos` by exactly one rank in 90 (0.0111)**. Inherited,
reported, **not corrected** — it is pinned by the note and it moves nothing
here (the long side is the *stronger* side on A alts despite being the
stricter one).

**`MECHANIC-PROOF.md`** prints 20 fit-period trades — 10 per hypothesis across
both tiers, chosen by a **fixed, outcome-blind stride** — each with its full
settlement ledger (every `t_j`, `f_j`, mark, R contribution), its stop, its
exit and its cause. **All 20 hand re-checks reproduce the engine's `netR` to
1e-12.**

---

## 3. Fit-period results, with the mandatory decomposition everywhere

### 3.1 The four arms and their shadows (`results/fit_decomp.csv`)

| rule set | `n` | **netR** | priceR | fundingR | costR | grossR | sett./trade | zero-sett. | hold h | win |
|---|---|---|---|---|---|---|---|---|---|---|
| **A majors real** | 89 | **−0.1294** | −0.1707 | +0.0552 | 0.0139 | −0.1155 | 7.70 | 2.3 % | 62.4 | 38.2 % |
| A majors shadow | 669 | −0.0061 | +0.0065 | +0.0015 | 0.0141 | +0.0080 | 2.98 | 1.9 % | 24.1 | 59.2 % |
| **A alts real** | 394 | **−0.0201** | −0.0460 | +0.0353 | 0.0094 | −0.0107 | 6.05 | 3.6 % | 49.0 | 54.3 % |
| A alts shadow | 1831 | −0.0249 | −0.0161 | +0.0014 | 0.0102 | −0.0147 | 2.88 | 2.6 % | 23.4 | 60.1 % |
| **B majors real** | 32 | **+0.0852** | +0.0702 | +0.0390 | 0.0240 | +0.1092 | 3.66 | 15.6 % | 29.9 | 43.8 % |
| B majors shadow | 329 | −0.0764 | −0.0447 | −0.0013 | 0.0304 | −0.0460 | 3.27 | 12.8 % | 26.3 | 47.7 % |
| **B alts real** | 196 | **−0.0144** | −0.0208 | +0.0280 | 0.0216 | +0.0072 | 3.71 | 4.1 % | 29.6 | 46.9 % |
| B alts shadow | 974 | −0.0488 | −0.0270 | −0.0000 | 0.0218 | −0.0270 | 3.51 | 9.0 % | 28.4 | 47.0 % |

Sanity anchors visible in the table: settlements per trade is always
`hold_h / 8` to two decimals; stop exits carry `priceR = −1.0000` exactly and
target exits `+1.0000` exactly (per-cause rows in `fit_decomp.csv`);
`costR` is ≈ 0.009–0.014R on A's wide daily-ATR stop and ≈ 0.022–0.030R on
B's tighter 12-bar stop, both as the note projected.

### 3.2 Nulls and the gating margin (`results/fit_arms.csv`)

| arm | Null-A `p` (1,000 draws) | Null-B `p` (250) | 90 % day-block CI of the mean | §6.3 margin | margin CI (2,000 draws) |
|---|---|---|---|---|---|
| A majors | 0.891 | 0.880 | [−0.306, +0.058] | −0.1233 | [−0.305, +0.075] |
| A alts | 0.572 | 0.696 | [−0.090, +0.050] | +0.0048 | [−0.073, +0.081] |
| B majors | 0.209 | 0.228 | [−0.146, +0.340] | +0.1616 | [−0.093, +0.419] |
| B alts | 0.448 | 0.540 | [−0.131, +0.106] | +0.0344 | [−0.100, +0.170] |

Null A holds fixed the clock, the risk, the hold, the side mix, the cost **and
the average funding**, and destroys only the alignment with an extreme funding
state. So its `p` answers exactly the question worth asking — *does entering on
extreme funding beat entering on ordinary funding with the same risk and
hold?* — and the answer, on three of four arms, is that it is **worse than a
coin flip** (`p` ≥ 0.45 means the placebo beats the real rule more often than
not). Every day-block CI includes 0. **Frequency parity is comfortable on all
four arms** (the shadow fires 4.6× to 10.3× more often than the real rule), so
the pre-committed 72 h fallback shadow was **never triggered** and only the
24 h shadow gates — as registered.

### 3.3 Reconciling B with `deriv-positioning` b1

b1 — top-trader crowding ≥ 95th percentile + a 12-bar adverse break, same 8
perps, same 1 h, no with-the-crowd condition, no funding accounting — was
**−58.4 bp at 24 h, t = −4.56, 0th percentile of its null, negative on 6 of 8
symbols**. B swaps the **quantity** sensor for the **price-of-crowding**
sensor and adds condition 2.

The two agree, and the agreement is the finding:

- **B alts: `priceR` = −0.0208R on n = 196**, negative, and negative on 4 of
  its 6 symbols (SOL −0.237, XRP −0.162, DOGE −0.058, LINK −0.032 against ADA
  +0.095, BNB +0.086). Same sign as b1, smaller magnitude, and the smaller
  magnitude is what the with-the-crowd filter bought.
- **B majors is +0.085R on n = 32 and means nothing.** 32 trades over 5.5
  years, `p` = 0.209, a CI of [−0.146, +0.340]. Its own +3R secondary template
  reads +0.4635R — a number that would look spectacular and is built on
  **12 target hits**. Reported under §3.2 of the note's rule, promoted
  nowhere.
- The §6.5 overlap row explains the shape mechanically: **B enters against a
  fresh `momentum_breakout` 35–44 % of the time and with one 0 % of the
  time**, by construction. It is a fade dressed as a squeeze, which is exactly
  what b1 measured.

**A kill on B therefore closes the squeeze-entry shape on this venue on both
sensors**, as the note pre-registered it would.

### 3.4 The per-side rows the note made mandatory — and the one genuinely interesting number in this package

| arm | side | `n` | netR | priceR | fundingR | `t` | win |
|---|---|---|---|---|---|---|---|
| A alts | **long** (extreme-negative funding) | 135 | **+0.0980** | +0.0749 | +0.0321 | **+2.05** | 60.0 % |
| A alts | short (extreme-positive funding) | 259 | −0.0816 | −0.1090 | +0.0370 | −1.64 | 51.4 % |
| A majors | long | 7 | +0.0109 | +0.0033 | +0.0161 | +0.05 | 57.1 % |
| A majors | short | 82 | −0.1414 | −0.1855 | +0.0585 | −1.33 | 36.6 % |

**The arm is pooled over both sides by registration, and its verdict is the
pooled one.** But the split is the reason the note made these rows mandatory,
and it deserves to be stated precisely: on the alt tier, **being paid to be
long when the crowd is short** is +0.098R with `t` = 2.05, while **being paid
to be short when the crowd is long** is −0.082R. The asymmetry survives the
one-rank percentile bias noted in §2, which runs the *other* way (`ext_neg` is
the *stricter* condition).

**This is not a candidate and must not be read as one.** It is a post-hoc
side split inside a registered arm; `t` = 2.05 on n = 135 is nowhere near
α = 0.0125; the long side is rare, crash-clustered and exactly the population
where the unmodelled slippage of §4 is worst. It is written down because it is
the only place in this package where a number pointed somewhere, and because
an honest kill should say where the body was still warm.

### 3.5 Per-symbol breadth (A alts)

ADA **+0.172** (n=63) · BNB +0.050 (102) · LINK −0.053 (64) · SOL −0.058 (52)
· DOGE −0.156 (58) · XRP −0.152 (55). **Positive on 2 of 6.** A −0.02R pooled
mean sitting on a ±0.17R per-symbol spread is a wash, not a thin edge.

### 3.6 Exit-cause split

**A alts:** lapse 285 (+0.324R), stop 104 (−0.970R), time 5 (+0.156R).
**A majors:** lapse 49 (+0.513R), stop 38 (−0.952R), time 2 (−0.233R).
**B alts:** stop 68 (−0.987R), target 64 (+0.996R), time 64 (+0.009R).
**B majors:** stop 7, target 12, time 13.

The A shape is a wide-stop carry trade behaving exactly as designed: it wins
small and often on the funding lapse and loses a full R when the crowd keeps
going. On the alts that is 285 lapses at +0.32R against 104 stops at −0.97R —
**arithmetically a near-tie, and the commission decides it.**

### 3.7 The time-stop rows carry the clearest picture of the carry itself

The five A-alts trades that ran the full 30 settlements collected **+0.197R of
funding** and lost **−0.033R of price**, netting **+0.156R**; the two A-majors
equivalents collected **+0.255R** against **−0.479R** of price. *When the
carry is allowed ten full days to accumulate it is a substantial number.* The
problem is that **only 5 of 394 trades get there**, because the 1.5 dATR stop
or the funding lapse ends 98.7 % of them first. That is the honest shape of
"the carry does not survive its price risk": not that the carry is small, but
that you rarely get to hold it.

---

## 4. Controls, in full

### 4.1 §6.8 mechanism prerequisite — **PASSES** (and the REPORT says so in §0)

| tier | extreme-positive settlements | mean `f` over next 9 | median | still extreme after 1 / 3 / 6 / 9 / 15 / 30 |
|---|---|---|---|---|
| majors | 524 | +0.000570 | +0.000440 | 53 % / 42 % / 33 % / 29 % / 19 % / 15 % |
| alts | 1,637 | +0.000584 | +0.000400 | 52 % / 40 % / 31 % / 28 % / 21 % / 16 % |

The note pre-committed that *"if the state does not persist beyond ~3
settlements the carry arm's mechanism is absent"*. **It persists well beyond
3.** The mechanism is present; the trade still loses. This is the distinction
between a mechanism that is absent and one that is real but not monetisable
directionally, and it is the single most transferable thing in this package.

### 4.2 §6.4 incremental control — funding is *negatively* informative inside a fixed price bucket

| tier | `spct` tercile | `n` extreme / non-extreme | mean extreme | mean non-extreme | diff | Welch `t` |
|---|---|---|---|---|---|---|
| majors | low | 137 / 2,351 | −0.401 | −0.129 | **−0.272** | −3.18 |
| majors | mid | 128 / 2,389 | −0.198 | −0.107 | **−0.091** | −0.95 |
| majors | high | 255 / 2,119 | −0.393 | −0.075 | **−0.318** | −5.04 |
| alts | low | 411 / 7,008 | −0.253 | −0.078 | **−0.175** | −3.63 |
| alts | mid | 462 / 7,048 | −0.156 | −0.027 | **−0.130** | −2.82 |
| alts | high | 764 / 6,496 | −0.281 | −0.128 | **−0.153** | −4.04 |

**0 of 6 cells positive; pooled Welch t = −4.32.** The pre-committed bar was
≥ 4 of 6 **and** pooled t > 2. This is the mirror image of
`deriv-positioning`'s post-mortem, which found 1 significant cell in 18 — the
chance rate. Here the cells are significant and **all six point the wrong
way**: hold the trailing-return bucket fixed, and the extreme-funding
settlements are the *worse* ones to short. **Reported, never promoted, and it
rescues nothing** — as §6.4 pre-registered.

### 4.3 §6.5 overlap with `momentum_breakout` (descriptive)

| arm | `n` | breakout same side, prior 12 bars | breakout **opposite** side |
|---|---|---|---|
| A majors | 89 | 3.4 % | **29.2 %** |
| A alts | 394 | 5.8 % | **36.3 %** |
| B majors | 32 | 0.0 % | **43.8 %** |
| B alts | 196 | 0.0 % | **34.7 %** |

Exactly the expected common case the note named in advance: **a carry short
standing against a fresh breakout long**, in roughly a third of all A entries,
and it is the direct mechanical reason A's price leg is negative.

### 4.4 §6.7 harness validation — and the number `deriv-positioning` §6 was waiting for

`momentum_breakout` (v2 defaults, 2022-08 → 2025-04) re-implemented against
this package's fresh 1 h frames:

| symbol | gross PF, no funding | gross PF, funding on | mean `fundingR` | edge taken by funding |
|---|---|---|---|---|
| BTCUSDT | 0.9895 | 0.9875 | −0.0009 | — (already < 1) |
| ETHUSDT | 1.0151 | 1.0114 | −0.0016 | 24.4 % |
| SOLUSDT | 1.2053 | 1.2021 | −0.0011 | 1.4 % |
| BNBUSDT | 1.0396 | 1.0321 | −0.0033 | 18.6 % |
| XRPUSDT | 1.0625 | 1.0596 | −0.0013 | 4.6 % |
| DOGEUSDT | 1.1603 | 1.1553 | −0.0020 | 3.0 % |
| ADAUSDT | 1.0550 | 1.0519 | −0.0031 | 5.6 % |
| LINKUSDT | 1.0974 | 1.0937 | −0.0015 | 3.6 % |

**Gross PF > 1.0 on 7 of 8, not 8 of 8** — BTC lands at **0.9895**. I do not
claim this reproduces v2 exactly and the difference is declared rather than
explained away: v2's 1 h bars are a **5 m resample**, mine are a **fresh
monthly-archive 1 h pull**, and my re-implementation reconstructs v2's rule
from source rather than importing its engine. The shape matches (a weak
positive continuation edge, strongest on SOL and DOGE); the BTC cell does not
clear 1.0 in my frame.

**The answer to the standing `deriv-positioning` §6 flag:** switching funding
accounting on costs a 1 h continuation strategy **0.0009–0.0033 R per trade**.
In absolute R that is small, but against these thin edges it is **1.4 % to
24 % of the entire edge**, and it is **always negative** — a long-biased
intraday continuation rule systematically pays funding. **Funding is a real
promotion blocker for thin 1 h edges, and now it is a measured one.**

---

## 5. Why the gating redundancy control never got to bind — and what it said anyway

The §6.3 margin decides **DOMINATED vs REAL EDGE**, and it only engages for an
arm that has already cleared the six ladder conditions. **No arm clears even
one of the first two.** So the margin is recorded, not applied.

It is still worth reading, because it says the opposite of what
`deriv-positioning` found. There, the price shadow beat the real signal **at
every horizon**, and the kill was "price in disguise". Here:

- `A_alts` **beats** its shadow, by **+0.005R** — the right sign, and a
  **twentieth** of the +0.05R margin, with a CI of [−0.073, +0.081].
- `B_majors` beats its shadow by +0.162R on 32 trades, CI [−0.093, +0.419].
- `A_majors` **loses** to its shadow by −0.123R.
- `B_alts` beats its shadow by +0.034R, CI [−0.100, +0.170].

Two of these have the right sign and none has the magnitude or the precision.
The more informative comparison is the `fundingR` column of §0: the shadow
collects **essentially no carry** (+0.0014R, −0.0000R) while the real rule
collects 25–37× more. **Funding and trailing price are genuinely different
series here** — the failure is not redundancy, it is that the thing funding
uniquely measures is not worth the price risk of harvesting it.

**No shadow is written up as a proposal for the standalone-momentum line.**
§6.3 provides for that only when an arm clears the ladder and fails the
margin; more to the point, every shadow here is **negative or zero**
(−0.0061, −0.0249, −0.0764, −0.0488). There is nothing to propose.

---

## 6. Sensitivities — every one run, including the ones that came out worse

Fit-only, **never promoted** (`results/fit_sensitivities.csv`, 30 rows). The
question they answer is *"was the pre-registered threshold unlucky?"* and the
answer is no.

| variant | A majors | A alts | B majors | B alts |
|---|---|---|---|---|
| **registered** | −0.129 (89) | **−0.020 (394)** | +0.085 (32) | −0.014 (196) |
| percentile 0.95 | −0.221 (58) | **+0.009 (286)** | −0.018 (26) | −0.105 (132) |
| percentile 0.80 | −0.089 (115) | −0.021 (483) | +0.062 (44) | −0.011 (236) |
| floor 0 (none) | −0.024 (1506) | −0.020 (5327) | +0.035 (251) | −0.041 (1085) |
| floor 0.0005 | −0.065 (60) | +0.001 (271) | +0.016 (24) | +0.028 (117) |
| persistence 1 | −0.041 (163) | −0.006 (795) | — | — |
| persistence 3 | −0.144 (49) | −0.065 (236) | — | — |
| stop 1.0 dATR | −0.091 (94) | −0.048 (419) | — | — |
| stop 2.5 dATR | −0.039 (75) | −0.045 (378) | — | — |
| maker 0.04 % | −0.121 (89) | −0.014 (394) | +0.100 (32) | −0.001 (196) |
| **B template 2, +3R** | — | — | +0.464 (32) | +0.020 (194) |

**The best cell in the entire thirty-row sweep is `A_alts` at percentile 0.95:
+0.0094R — 19 % of the +0.05R screen bar, and on n = 286 it does not itself
meet the 300-event floor.** Among the variants that *do* meet the floor, the
best is `A_alts` at persistence 1, and it is **negative** (−0.0059R). Not one
of the eighteen A variants reaches +0.01R; **twenty-one of the thirty rows are
negative.** This is not a near miss at a different threshold — it is a
different order of magnitude at every threshold tried.

Two rows are mechanically informative rather than exploratory:

- **The absolute floor is doing exactly its job.** Drop it to zero and
  `fundingR` collapses from +0.0353R to **+0.0035R** on A alts (n = 5,327,
  **t = −4.45**, significantly negative). The note's reasoning — that a
  percentile alone would call +0.012 %/8 h "extreme", and 0.012 %/8 h cannot
  pay a 0.10 % round trip — is confirmed quantitatively. Raise it to 0.0005
  and `fundingR` rises monotonically to +0.0440R while `n` falls to 271.
  **The carry column responds to the threshold exactly as the mechanism
  predicts; the netR column does not follow it up.**
- **Even free execution does not save it.** At maker 0.04 % — a cost this
  strategy cannot actually achieve, since it enters on stops and closes — A
  alts is still **−0.014R** and A majors **−0.121R**.

---

## 7. Doubts, in order of how much they should worry a reader

1. **No slippage is modelled anywhere, and this tape is the worst case for
   that omission.** Costs are a flat 0.10 % round-trip taker. Extreme-funding
   tape is *more* volatile than average — that is what makes funding extreme —
   and the A stop is a market order triggered by an adverse extreme. Every
   number above is therefore **optimistic**, and the three arms that are
   negative are more negative in reality. This cuts only one way, which is why
   it is first: it **cannot** rescue anything, it can only deepen the kill.
2. **The `B_majors` cell is not evidence of anything.** 32 trades, `p` = 0.209,
   and a +3R secondary reading +0.464R built on 12 target hits. If a reader
   remembers one number from this package it should not be that one. It is
   reported because §9.2 requires it, and it is **UNMEASURABLE at the
   pre-committed definition** under §6.6 — below the 300-event floor by an
   order of magnitude.
3. **The FTX week is deliberately outside the SOL evidence.** It is a strong
   candidate for the most extreme funding observations in the whole sample,
   and the blackout removes 9 days of it on 1 of 8 symbols. It remains
   **fully in-sample for the other seven**, and 0 SOL trades were excluded by
   it, so the information cost is small — but it is not zero, and the direction
   of the bias is unknown: those were also the days when holding against the
   crowd would have paid most *and* when a stop would have been hit hardest.
4. **The mark price is a proxy.** `fundingR` marks the notional at the **open
   of the bar opening at `t_j`** because the archive does not carry the mark
   price. The perp–mark gap is basis points against a rate quoted in basis
   points — second-order, but it is an approximation and it is systematically
   in the direction of the premium when funding is extreme, which is precisely
   when it is used.
5. **Survivorship is declared and not corrected.** All eight perps are still
   listed in 2026. The sample therefore **under-represents exactly the perps
   whose funding blew out before delisting** — the population where a carry
   trade would have been most profitable *and* most likely to be liquidated.
   For a per-asset time-series test this does not bias the way it would bias a
   selection, but the tail of the carry distribution is missing.
6. **The §6.7 harness validation reproduces 7/8, not 8/8.** §4.4 states why
   and does not explain it away. It is a corroboration that came back slightly
   weaker than the note expected, and if a future pass needs byte-exact
   agreement with v2 it should import v2's engine rather than reconstruct it.
7. **A pooled tier hides a real per-side asymmetry.** §3.4's long side is
   +0.098R with `t` = 2.05 inside an arm that is −0.020R pooled. The
   registration pools both sides and the verdict is the pooled one; I have not
   dressed the split up as anything else, but a reader should know the pooled
   number is an average over two populations that behave differently.
8. **`fpct` is very slightly asymmetric by construction** (one rank in 90,
   §2). It is inherited from the note and left alone, and it happens to run
   *against* the side that performed better, so it is not manufacturing §3.4.

---

## 8. The §8.3 pre-registered readings — neither applies

1. **"Carry, not signal"** applies to an A arm that **passes** with
   `mean fundingR ≥ mean netR`. Both A arms have `fundingR` > `netR` — but
   neither passes, so the label has nothing to attach to. Recorded so the next
   reader does not mistake §0's carry discussion for a pass under this
   heading.
2. **"B is A in disguise"** applies to a B arm that **passes** with
   `priceR` net of cost < +0.05R. No B arm passes. For the record, `B_majors`
   would have met that description (`priceR` − `costR` = +0.046R, just under
   the bar), which is one more reason not to read anything into its cell.

---

## 9. What this closes, and what it does not

**Closed by this pass:**

- **Both funding hypotheses on this venue, at these definitions, across 5.5–6.5
  years and 8 perps.** Not marginal: three of four arms are negative, the
  incremental control is significantly *anti*-informative, and no sensitivity
  in a 30-row sweep reaches a fifth of the screen bar.
- **The squeeze-entry shape, on both the quantity sensor (b1) and the
  price-of-crowding sensor (B).**

**Explicitly NOT closed, and none of it is a consolation prize:**

- **The hedged carry** (short perp / long spot) — the Schmeling et al. trade,
  and the one this pass never tested. **This package's result is arguably an
  argument *for* it**: the carry is real, persistent and 25–37× better
  selected by funding than by price, and the *only* thing that killed it was
  the unhedged price leg. That belongs to the backlog's spot–perp basis entry,
  not here.
- **Funding as a cross-sectional selector** — a different harness and that
  package's registration.
- **Funding as a promotion blocker** — now quantified (§4.4) and, unlike
  everything else here, immediately usable.
