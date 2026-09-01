# Hand-off — session-liquidity v5-NY → Architect

**From:** Researcher · **Package:** `research/session-liquidity-v5-ny/`
**Read first:** `REPORT.md` §0 (verdict), then `MECHANIC-PROOF.md` (the visual
audit the user asked for), then `results/HYPOTHESIS.md` (the test in full).

---

## 1. What was asked, and what came back

The user reviewed the shelving ruling (Запись 17), was not convinced by the
null, and specifically doubted whether iFVG/BoS detection is even implemented
correctly. Two deliverables were commissioned: a seventh pass with three
definitional changes run to a **stricter** standard than the six descriptive
ones, and **visual proof** that the current mechanics are right.

**Both delivered. The answer is still no edge, and it is now a tested no rather
than a described one.**

| arm | horizon | holdout n | mean net R | Null-A p | verdict |
|---|---|---|---|---|---|
| iFVG-v4 | block (primary) | 297 | −0.261 | 0.910 | NO EDGE — kill |
| iFVG-v4 | 24h | 297 | −0.271 | 0.923 | NO EDGE — kill |
| BoS pinned | block (primary) | 209 | −0.019 | 0.070 | NO EDGE — kill |
| BoS pinned | 24h | 209 | −0.037 | 0.160 | NO EDGE — kill |

Kill threshold was **+0.05R**, pinned in `DESIGN.md` §7 before any R existed.
All four fail at the first gate — the expectancy is negative — so the p-values
never became decisive.

---

## 2. What is new here that the Architect should carry forward

1. **A stronger negative than any of the six descriptive passes produced.** The
   matched-time placebo control (same window, same side, same stop in ATR, same
   horizon, same fees, random date) beats the iFVG signal in **91% of 1,000
   runs**. Previous passes could only say "the lift is 0.83, below 1.0". This
   says the signal is worse than a coin flip at a random minute of the same
   window, against a control that holds the clock and the risk fixed.
2. **Gross expectancy is ≈ 0 and the fee is the entire negative** (−0.006R /
   +0.009R gross; cost 0.192R / 0.116R). This is a cleaner statement of the
   null than "the lift is below 1" and it is the number to quote at anyone who
   proposes a variation: the signal does not lose, it simply does not pay for
   anything.
3. **The NY window is a genuinely better stretch of tape and still not an
   edge.** Forward lift rises 0.84 → 0.95 (iFVG) and 0.89 → 1.00 (BoS) inside
   the window. That is the first cut in seven passes that moved this metric,
   and it lands at **par**. The move is accompanied by MFE *and* MAE both
   roughly doubling, so it reads as a volatility effect, not a directional one.
   The user's read on *where* was partly right; the read on *whether* was not.
   Say that plainly in any user-facing material — it is the honest framing and
   it is more useful than a flat "no".
4. **The h24 horizon question is now closed.** Letting the trade run 24 hours
   changes the holdout expectancy by −0.010R / −0.018R, both slightly worse.
   Nobody needs to ask again whether block-scoping was hiding the move.
5. **A reusable pre-registration template.** `DESIGN.md` + `hypothesis.py` are
   the first working instance in this repo of the standard Запись 17 §7
   demands: pinned stop, pinned template, chronological split, matched-time
   permutation null, numeric kill rule, mechanical verdict ladder, and a
   printed list of every comparison run. **The C3 reopen trigger (PDH/PDL swept
   in Asia) can be tested with this machinery almost as-is** — see §4.

---

## 3. Status changes this pass justifies

* **`IDEAS-BACKLOG.md`** — session-liquidity stays **shelved**. The one named
  reopen trigger (C3) is untouched: this pass tested a *time window* on the
  session-level stream, not PDH/PDL-in-Asia, so C3 neither fires nor expires.
* **`knowledge/session-liquidity.md`** — a new §6.3 records the h24 horizon and
  the NY-window definitions, and §0 gains the v5-NY status line. **No pinned
  definition was changed.** The v5 pass reproduced the v4 and BoS event streams
  bit-for-bit, which is itself an independent re-audit of both.
* **`RESEARCH-LOG.md`** — Запись 18.

---

## 4. What a follow-up pass would need

**If C3 (PDH/PDL swept in Asia) is ever authorised**, this is the cheapest it
will ever be to run properly:

* `hypothesis.py` is written against a generic trade table — `trade_table()`
  selects on `{arm}_confirmed`, `{arm}_in_ny` and `{arm}_{h}_netR`. Swapping
  the population to the PDH/PDL stream means adding the PDH/PDL level class to
  `engine.py` (the §3.2 definition is already pinned, and
  `research/session-liquidity-v2/drilldown/` has salvageable code) and changing
  the filter column. The null, the split, the bootstrap and the verdict ladder
  need no change.
* **Null A would need one adjustment**: its placebo pool is currently "bars
  inside the NY window on a complete NY block". For an Asia-block population
  the pool becomes "bars inside the Asia block", which is a one-line change to
  `Tape.pool` — but it should be made deliberately and written into that
  pass's DESIGN, not improvised.
* **The power problem is real and should be sized first.** C3's population is
  ~0.24 pure day-level sweeps per asset-day. Over 4 years × 4 assets that is
  roughly 1,400 events *before* any confirmation filter, so a 25% holdout will
  land well under this pass's 297 trades. Pre-register the minimum-n rule with
  that arithmetic done, or the pass will produce an "underpowered —
  inconclusive" and nothing else.

**Not recommended, and why:**

* **A wider/narrower NY window, or a different time of day.** The eligibility
  funnel (`REPORT.md` §2.2) shows the population is already thin, and the
  all-hours baseline (−0.216R / −0.100R) is barely different from the in-window
  one. Searching over windows is exactly the p-hacking this pass was designed
  to avoid, and the multiple-comparison cost would swamp any result.
* **A different exit rule on the same signal.** Gross expectancy is ≈ 0. An
  exit rule redistributes a zero; it does not create one. The same argument the
  Architect used to decline the "realistic BoS stop" follow-up (Запись 17 §3)
  applies here with a measured number behind it now.
* **A longer horizon than 24h.** Tested and closed (§2.4).

---

## 5. Known gaps and caveats, stated so nobody rediscovers them

1. **DST drift.** The window is a fixed UTC−4 window. In EST months it is
   really 08:40–10:20 New York, not 09:40–11:20. This is the house convention
   (fixed UTC, no DST) applied honestly, but it means the pass tested "a fixed
   100-minute UTC window that mostly coincides with the intended one", not the
   wall-clock window. The UTC−5 sensitivity row is reported and is worse for
   iFVG, better-but-still-negative for BoS. **If anyone ever wants the true
   wall-clock reading, that is a different pass and it breaks a standing
   project convention to run it.**
2. **Data source substitution.** `research/intraday-mtf-smc/data/` is not
   materialised in this worktree, so BTC/ETH/SOL were read from
   `research/intraday-mr-smc/data/` (same puller, same range, same 420,768
   bars) and **BNBUSDT was re-pulled** from the same public Binance archive.
   `checks.py` A1–A7 prove the substitution is harmless by reproducing the v4
   and BoS event streams bit-for-bit on all four symbols. Documented in
   `DESIGN.md` §1.1.
3. **Slippage is not modelled.** Only a 0.10% round-trip taker fee. The real
   number is worse than reported, not better.
4. **`RUNBOOK.md` is a delta, not a new indicator.** No new `.pine` file was
   written for this pass — the BoS pass's `session_liquidity_bos.pine` already
   draws both mechanics correctly, and the only additions this pass makes
   (a shaded NY window, an h24 measurement) are described as a small manual
   edit rather than shipped as a fifth Pine file. Flagged as **not done** in
   the sense of "no new file committed"; see `RUNBOOK.md` for the exact
   3-line change if the user wants it on their chart.
5. **The gallery is BTC+ETH only** (DESIGN §2.3). SOL and BNB panels were not
   rendered. They are in every table.

---

## 6. Suggested routing

**Architect decision, not mine.** My reading:

* The shelving ruling stands and is now backed by a hypothesis test rather than
  six descriptive shapes. Nothing here reopens the idea.
* The user asked a fair question and deserves a user-facing answer that leads
  with **what did move** (the window is genuinely a better stretch of tape;
  forward lift 0.84 → 0.95 / 0.89 → 1.00) before landing on **why it still is
  not tradeable** (par is not profit; gross ≈ 0; the fee is the whole
  negative). Charts `02` and `05` and two or three gallery panels carry that
  story without a single statistics term that needs defining.
* The mechanic-proof deliverable should be shown regardless of the verdict —
  it is the direct answer to the user's stated doubt, and it is the part of
  this package with a life beyond this idea.
