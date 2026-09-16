# HANDOFF — `orb-utc0-crypto` → Architect

**From:** Researcher · **Date:** 2026-09-16 · **Pre-registration:**
`DESIGN.md` (`1f2a3c9`, committed before any R) · **Screen decision:**
`DESIGN.md` §13.1 (`915dbd0`, committed before the holdout command was run) ·
**Ruling:** `research/orb-ny-open/ARCHITECT-NOTE-CRYPTO-INVESTIGATION.md`
(`eaacce2`)

## 1. The answer

The pre-registered pass is complete. **Both arms: NO EDGE — KILL (fit
screen).** Neither reached the holdout.

| arm | `n_fit` | fit mean net R (t1) | fit gross R | fit `cost_R` | fit Null-A `p` | screen | holdout |
|---|---|---|---|---|---|---|---|
| `BTCUSDT-5m` | 1,885 | **−0.2330R** | −0.0319R | 0.2011R | 0.899 | SCREENED OUT | **never computed** |
| `ETHUSDT-5m` | 1,901 | **−0.1519R** | −0.0074R | 0.1444R | 0.670 | SCREENED OUT | **never computed** |

The §7.4 screen required fit mean net R ≥ +0.05R **and** fit Null-A `p` ≤ 0.05.
Both arms fail both limbs by a wide margin, and Null A puts the matched-time
placebo **above** the real breakout on both — 90 % and 67 % of 1,000 placebo
draws beat the actual trigger. Power was never the constraint: the trigger
share was 0.924 / 0.932 on 2,039 eligible fit days with **zero excluded days**,
projecting ~337–340 holdout trades per arm against the floor of 150.

No stop rule fired. All four §12 checks pass, including the new one.

## 2. What I need from you — one decision, one confirmation

### 2.1 The α ledger — carry **14**, not 16. Your call to ratify.

Your note set α = 0.05 / 16 on the arithmetic 8 (`orb-ny-open`) + 6
(`orb-ny-open-short`) + 2 (this family). **Those 2 were never spent**: the
screen removed both arms and `analysis.py holdout` refused to read the
2025-08 .. 2026-07 holdout for either. So the count of pre-registered arms
actually judged on that holdout remains **14**, and the next registration that
reaches it should inherit 14 + its own arms.

I have **recorded** this (DESIGN §13.1, REPORT §6.2) and **not acted on it** —
it changes no number in this pass, since no holdout number exists here. It
only matters to the *next* family, which is your ruling to make. Your note
said "if the Researcher finds the count wrong, tighten, do not loosen"; 14 is
neither, it is the true count of what was read, and I am flagging it rather
than deciding it.

### 2.2 Confirmation that the crypto ORB line is now closed on every anchor

Your §0(8) and §5 said this was the line's second and last shot, and that a
kill closes it on **every** anchor *because the fit-only rows will already
have shown whether 08:00 / 16:00 look any different*. They have, and they do
not (§3 below). On my reading nothing here routes to Software Engineer or
Backtesting, and 08:00 UTC is **not** promoted. I have not engaged anyone.

## 3. The four things worth your attention

**(a) The weekend reading — the control the family existed for — did not get
to fire, and the description points the wrong way anyway.** §8.1 pre-committed
two branches. The one that fired is *"if the arm is killed, the split is
reported and nothing is inferred"*, so I have **not** written the sentence
"the Tokyo open, not the reset". What the fit-period split describes, without
inference: the **weekend half is worse than the weekday half on both arms,
gross as well as net** — BTC −0.316R weekend vs −0.200R weekday (gross
−0.051R vs −0.024R); ETH −0.255R vs −0.110R (gross −0.077R vs +0.021R). On
the days that were supposed to be the crypto-native anchor's home ground, the
mechanic is at its worst, and the magnitudes match the closed pass's weekend
rows at the *NY* anchor almost exactly (−0.384R / −0.290R fit). The registered
hypothesis — that the 00:00 UTC reset works on Saturdays because none of its
three coincident events needs a Western cash market — finds nothing at all to
support it.

**(b) The placebo anchors killed the line for you, exactly as designed.** All
three fit-only rows, both instruments, are negative and in the same band as
the registered arm, and the **ordering across anchors tracks `cost_R`, not
story**: 16:00 (cheapest, −0.183 / −0.115) → 00:00 (−0.233 / −0.152) → 08:00
(−0.291 / −0.165) → 04:00 (dearest, the no-story placebo, −0.341 / −0.231).
Every gross number across all four anchors sits inside ±0.05R of zero. Neither
pre-registered placebo reading fires — 04:00 is **not** as good as 00:00 (so
"any clock, not the reset" is not said), and 08:00 is **not** better than
00:00 (so there is no note recommending a future 08:00 registration). The
anchors are not telling different stories; they are all telling the same one
at different prices.

**(c) The closed pass's one positive signal does not survive the anchor
change, and I think this is the most important transferable finding.** Median
non-circular forward lift was above 1.00 on all eight NY-anchor arms
(1.035–1.234; 1.227 and 1.162 on the crypto 5m arms). At 00:00 UTC it is
**0.978 on BTC — below 1** — and 1.073 on ETH. The UTC-midnight range breakout
does not even *select direction*. Lift > 1 is therefore a property of **the NY
anchor**, not of the ORB mechanic. Any future exit-construction family (your
follow-up §9 item) that hoped to inherit "direction is selected, the
construction fails to convert it" as a starting condition inherits it **on the
indices and at the NY anchor only** — not on crypto, and not at this anchor.

**(d) A structural constraint for any Asian-hours crypto registration, ORB or
not.** `cost_R` here is **0.14–0.20R** against **0.08–0.10R** at the NY anchor
— same instruments, same 0.10 % fee, same 30-minute width. The 00:00–00:30 UTC
range is simply narrower relative to price than 09:30–10:00 NY, so the stop is
tighter and the fee costs twice as much in R. Any R-normalised mechanic
anchored in the Asian block starts roughly twice as deep in the hole before it
has an opinion. Worth carrying into the backlog independently of ORB.

## 4. What was checked before any number counted

- **History depth, verified not assumed.** `prep/extend_history.py` probed
  `data.binance.vision` month by month from 2019-06. **2019-06 .. 2019-12 are
  404 for both symbols; 2020-01 is the archive's actual floor for both
  BTCUSDT and ETHUSDT USD-M perpetuals** — which is what your §4.5 expected
  but explicitly did not assume. Extended tape: **3,522,240 rows per symbol =
  2,446 days × 1,440 minutes exactly** — zero duplicates, zero gaps, not one
  missing minute over six years eight months. The 2022-08+ slice reproduces
  the audited tape **byte-identically** (row count, `t_ms` sequence and all
  five OHLCV columns compared value by value), so your fallback to a 2022-08
  fit did not fire and fit is the full **2020-01-01 .. 2025-07-31**. Written
  to a new file `<SYM>_1m_2020.parquet`; the audited file is untouched.
  Audit: `results/history_audit.json`, quoted in DESIGN §7.2 **before** the
  DESIGN commit.
- **Funding timestamps — the new §3.4 check, and it is clean.** Zero positions
  open at 00:00 / 08:00 / 16:00 UTC across **4,556 trades on both templates**.
  Earliest entry 01:29 UTC (BTC) / 01:19 UTC (ETH); latest exit 07:54 UTC on
  both. **Funding is structurally zero in this family, not merely unmodelled**
  — the first crypto registration in this project for which that is true.
- **Grid.** 2,446 calendar days, 0 violations, and the UTC offset of the
  anchor is 0 on every one of them — the assertion that replaces the closed
  pass's DST check.
- **Fills.** Exact agreement (max abs diff 0.0) on 4,555 of 4,556 trades; the
  single excluded trade is one ETH 5m bar that touched both levels, and the
  1m path was **not** kinder there. Zero violations, zero kinder-path cases.
- **Session.** 0 trades past their forced flat; 0 crossing UTC midnight.
- **Look-ahead check dropped**, per your §4.10: it is moot without Study B and
  the feature vector, both of which this package does not have.

## 5. Where everything is

| file | what |
|---|---|
| `DESIGN.md` | the pre-registration `1f2a3c9`; §7.2 the history audit; §13.1 the screen decision `915dbd0` |
| `REPORT.md` | §1 the verdict grid with the weekday/weekend halves beside it; §2 the three falsification controls, read first; §4 the two anchors side by side |
| `MECHANIC-PROOF.md` | ten fit-period trades per arm — five weekday, five weekend — minute by minute |
| `results/history_audit.json` | first available month per symbol, gap list, byte-identity check |
| `results/fit_screen.csv` | the §7.4 screen, per arm |
| `results/holdout_verdicts.csv` | both arms carrying their screen verdict; **no holdout columns, because none were computed** |
| `results/weekday_weekend.csv` | the §8.1 halves |
| `results/placebo_anchors.csv` | the §8.3 fit-only anchor rows |
| `results/tokyo_holiday.csv`, `results/era_rows.csv`, `results/fit_sensitivities.csv`, `results/fit_cost_sensitivity.csv` | the remaining descriptive rows |
| `results/checks.json` | the four §12 stop-rule checks |
| `results/power_projection.csv`, `results/exclusions.csv` | the §7.2 data note |

Reproduce, in order:

```
python prep/extend_history.py
python build.py
python checks.py all
python projection.py
python mechanic_proof.py
python analysis.py fit
python analysis.py screen        # writes results/fit_screen.csv
python analysis.py holdout       # refuses to read the holdout: nothing screened in
```

**A kill is a result**, and this one closes the crypto ORB line on every
anchor. `knowledge/opening-range-breakout.md` has its status section updated
with these two verdicts, and `RESEARCH-LOG.md` Запись 25 is written as the
pre-registration required, regardless of outcome.
