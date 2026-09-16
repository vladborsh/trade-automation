# HANDOFF — Researcher → Architect, `cmc-bot` VWAP band-reversal, Stage 1

**Status:** Stage 1 complete, exactly as pre-registered. **All four
pre-registered arms: NO EDGE — KILL.** No stop rule fired; no arm came back
UNDERPOWERED; no threshold, window, split or criterion was touched after a
number existed.

Artefacts: `DESIGN.md` (the pre-registration, committed `8a07a20` **before any
R**), `REPORT.md` (the full result), `results/stage1/*.csv` (every table),
`stage1.py` / `stage1_engine.py` / `stage1_analysis.py` / `stage1_report.py`
(the code). `RESEARCH-LOG.md` Запись 22.

## 1. The verdicts

| arm | n_holdout | holdout mean net R | Null-A p | fit mean net R | 90 % bootstrap | live-like row | verdict |
|---|---|---|---|---|---|---|---|
| **US100** | 434 | **+0.029R** | 0.628 | +0.086R | [−0.089, +0.149] | +0.021R | **NO EDGE — KILL** |
| **US500** | 471 | **−0.053R** | 0.914 | +0.051R | [−0.157, +0.057] | −0.044R | **NO EDGE — KILL** |
| **BTCUSDT-(a)** | 442 | **−0.285R** | 0.265 | −0.336R | [−0.397, −0.169] | −0.267R | **NO EDGE — KILL** |
| **ETHUSDT-(a)** | 362 | **−0.083R** | 0.037 | −0.238R | [−0.209, +0.042] | −0.095R | **NO EDGE — KILL** |

Every arm fails on the same clause: holdout mean net R below the
pre-registered **+0.05R** kill bar. US500 additionally fails on `p > 0.20`.
The `live_like=True` row agrees on the tier for all four, so **no arm's
verdict depends on the L-01 bar convention** — the §2 tightening never had to
bind.

Descriptive legs, **no verdict, not promotable** (`ARCHITECT-NOTE-STAGE1.md`
§3.1/§4.1): EURCHF −0.789R (n = 91), GBPCHF −0.682R (n = 92), BTCUSDT-(b)
−0.586R (n = 4,265), ETHUSDT-(b) −0.262R (n = 3,800).

## 2. Why it failed — two independent facts

**(a) The mechanic selects nothing.** The non-circular forward lift is **0.99
on US100 and 1.05 on US500** — the signals pick stretches of tape neither
better nor worse than random comparable stretches of the same tape, same
direction, same horizon. On both index arms the **matched-time placebo beat
the strategy**: US100 +0.052R placebo vs +0.029R real, US500 +0.043R placebo
vs −0.053R real. That is what `p_A` = 0.63 and 0.91 are measuring, and it is
the cleanest statement in the pass: *picking the bar with the three gates is
not better than picking it at random inside the same window.*

**(b) The geometry cannot pay a cost.** Gross expectancy is small and positive
on every arm (+0.085 / +0.016 / +0.097 / +0.153 R) and the cost takes it
(0.056 / 0.069 / 0.382 / 0.236 R). `adjustStopLoss` shrinks the stop to a
fraction of a 200-bar range, so the stop is small in price terms and a cost
that is fixed in price terms is therefore large in R terms. On the CHF crosses
this is extreme: the **median `cost_R` is 0.90 (EURCHF) and 0.74 (GBPCHF)** —
one round-trip spread is most of the risk unit. Your prediction in §3.1 of the
Stage 1 note was right, and it was right about the indices too, just less
violently.

Neither fact depends on the template or the fill convention: all four
template × fill numbers are negative on every arm except US100/US500 number 1,
and the two realistic-fill numbers are the worst of the four everywhere.

## 3. What was checked before any number counted

- **`engine.py` was not edited.** Stage 0's bit-exact parity stands untouched.
  Everything new is in `stage1_engine.py`, a sibling.
- **The re-pulled Capital.com tape is the same tape.** `data/` is gitignored
  and was absent from this worktree, so all 3,930,148 bars were re-pulled
  through the bot's own `CapitalComSession`. `prep_data.py`'s coverage audit
  came out **byte-identical to the committed `results/COVERAGE.md`**, and every
  leg's order counts reproduce `results/INVENTORY.md` and
  `results/crypto/INVENTORY_CRYPTO.md` **exactly**, in every condition.
- **The walker reproduces the engine's exits.** 0 mismatches on every leg,
  excluding only orders closed by the cross-order rule (13–1,233 per leg) and
  two orders with no defined R (one still open at the tape's last bar, one with
  a zero-width stop — `INVENTORY.md`'s known US500 case).
- **`DESIGN.md` §8's agreement stop rule: 0 violations on all eight legs**
  (agreement sets of 122–9,168 trades, max |diff| exactly 0.0). The pass was
  not stopped.
- **`run_ablate(drop=None)` returns an order table identical to
  `engine.run`'s**, so the ablation rows differ from the bot only in the gate
  dropped.

## 4. One disclosure

The first version of the fit pass also emitted a whole-sample row, whose value
together with the fit and tail rows implies the holdout mean. That row was
produced and seen for **BTCUSDT-(a)** before the holdout pass ran. It was then
removed and the fit pass re-run. **Nothing was changed as a result** — every
threshold, window, split and criterion was already fixed in the committed
`DESIGN.md`, the ladder is applied mechanically in code, and no arm's numbers
were recomputed under different settings. Recorded in `REPORT.md` §2.1 as
well. I am flagging it rather than burying it; if you judge it material to
BTCUSDT-(a)'s standing, that arm's kill can be re-derived by anyone from the
committed parquet and code without my involvement.

## 5. What I did not do (per `ARCHITECT-NOTE-STAGE1.md` §7)

- **Software Engineer / Backtesting not engaged** — no REAL EDGE verdict, so
  the gate never opened.
- **The smart-money package's D-03 exposure** (`knowledge/smart-money-ict.md`
  §1.3 and the unmerged Stage-0 WIP `429b0db` encode the symmetric reading of
  `getLastIfvg`) — still flagged, still not actioned. **It is now the only
  open item this package has generated that belongs to somebody else.**
- No 2022 Capital.com extension (impossible on this vendor), no alternative
  index window, no threshold adjustment, no re-cut split.

## 6. What I would put to you

1. **Close the line.** Four kills on four arms, on the population the bot
   actually trades, with the placebo beating it on both indices and a forward
   lift of 1.00. `knowledge/vwap-band-reversal-ict.md` should get a closing
   note recording the result so the composition is not re-proposed; the three
   ingredients' individual standings are unchanged by this and should stay
   that way.
2. **Tell the user the D-01 thing directly.** It is in `REPORT.md` §1 in plain
   terms. The strategy is live-traded now, and the evidence they had for it —
   if it came from the bot's own backtest — measured different hours. That is
   worth saying independently of the kill.
3. **The forex legs are not "pending more data" in any useful sense.** The
   descriptive rows show a cost problem of the order of the whole risk unit,
   not a power problem that 44 months would fix. If you want that written down
   as a reason not to re-register in 2027, `REPORT.md` §4 has the numbers.
4. **Nothing here reopens v5-NY, and v5-NY does not touch this** — the
   pre-registered interpretation in §4.2 of your note, unchanged by the
   outcome.
