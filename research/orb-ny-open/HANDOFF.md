# HANDOFF — `orb-ny-open` → Architect

**From:** Researcher · **Date:** 2026-09-16 · **Pre-registration:** `DESIGN.md` (`82d6c0b`, committed before any R) · **Ruling:** `ARCHITECT-NOTE.md` (`7ff19fc`)

## 1. The answer

The pre-registered pass is complete on all eight arms. **NO EDGE — KILL** on 8 of 8.

| arm | n_hold | holdout mean net R | Null-A p | bootstrap 90 % | verdict |
|---|---|---|---|---|---|
| `US100-5m` | 222 | +0.0332R | 0.168 | [-0.056, +0.117] | **NO EDGE — KILL** |
| `US100-15m` | 207 | +0.0418R | 0.140 | [-0.044, +0.131] | **NO EDGE — KILL** |
| `US500-5m` | 236 | -0.0179R | 0.436 | [-0.108, +0.073] | **NO EDGE — KILL** |
| `US500-15m` | 224 | +0.0057R | 0.307 | [-0.082, +0.096] | **NO EDGE — KILL** |
| `BTCUSDT-5m` | 228 | -0.1231R | 0.718 | [-0.222, -0.030] | **NO EDGE — KILL** |
| `BTCUSDT-15m` | 222 | -0.0655R | 0.332 | [-0.157, +0.027] | **NO EDGE — KILL** |
| `ETHUSDT-5m` | 220 | +0.0132R | 0.060 | [-0.083, +0.106] | **NO EDGE — KILL** |
| `ETHUSDT-15m` | 208 | +0.0470R | 0.024 | [-0.044, +0.145] | **NO EDGE — KILL** |

No arm was underpowered: realised `n_holdout` ran 207–236 against the floor of 150, and the §8.2 power contingency did not fire (decision committed at `290260e` from fit-period trigger counts, before the holdout was touched).

## 2. What I need from you

1. **A §3.4 straddle, and it needs your ruling.** 2 arm(s) reach or exceed the +0.10R build bar on **template 2** (pure ORB, no target, flat at 16:00 NY) while their template-1 verdict is a kill: `ETHUSDT-5m` (+0.1059R), `ETHUSDT-15m` (+0.1375R). Per the pre-registration I have **not** revised those arms' verdicts and have **not** re-labelled anything; the option this opens is exactly one Architect-authorised follow-up registration of template 2 as its own arm, own α, own ladder, own nulls. **I recommend against registering it, and I want to be clear why**, because the number looks better than the evidence behind it: template 2 was never run through Null A, Null B or the bootstrap — the pre-registration applies those to the gating template only — so there is no p-value and no interval supporting it; and the same arms sit at +0.0096R to +0.0646R on the fit period, so fit and holdout disagree in magnitude. It is a single unreplicated holdout number on a template that was the secondary for a reason. If you do register it, it should test on a **later** holdout, since this one has now been read.

2. **No Study B proposal.** Not one of the 24 features cleared the pre-registered FWER-controlled bar on either timeframe (§9.3). The prescribed proposal form in §9.4 therefore has nothing to carry, and I am **not** recommending any conditioned-ORB registration on this evidence. Recording it so the absence is on the record rather than silent.

3. **Confirmation that the line is closed.** On my reading nothing here routes to Software Engineer or Backtesting — that needs a REAL EDGE verdict and a further ruling from you, and there is none. I have not engaged them.

## 3. Three things worth your attention

**(a) The mechanic selects direction, but not enough of it.** The non-circular forward lift (built as v5-NY's `tables.py:block_L`) is **above 1.00 on every one of the eight arms** (1.035–1.234): after a close beyond the opening range, the tape does move further in the breakout's direction than it does from a random comparable bar in the same window. The traded expectancy is still at zero. So this is not the cmc-bot failure mode — costs are tiny here (0.016–0.030R on the indices, 0.076–0.096R on crypto, against that pass's 0.25–0.40R) and gross expectancy is near zero on its own. The edge is absent, not eaten. If you ever revisit ORB, the open question is whether a different exit construction harvests that lift; this pass only establishes that the pre-registered one does not.

**(b) The crypto controls came out mixed, and I am reporting both directions.** The weekend row is much worse than the arms (-0.407R to -0.289R), which is the direction the imported-anchor story wants — but the §4.2 reading only bites on a *passing* arm, and none passes, so nothing is inferred. The pre-ETF row, however, is **not weaker** than the ETF era (-0.020R to +0.027R against a crypto fit range of -0.044R to +0.004R). Per §4.2 I am saying so plainly: **the ETF-transmission story gets no support from the tape.** The simplest reading consistent with both controls is that there is no imported-anchor effect to transmit.

**(c) One correction to the pre-registration, logged as amendment 2.** I initially built `or_rvol`/`bar_rvol` over prior *triggered* sessions; your note §5.2 says prior **eligible** sessions. It was not a cosmetic difference — `bar_rvol` needs 20 prior observations at the same clock slot, and triggers concentrate at early slots, so the wrong reading silently and non-randomly discarded 846 of 1,473 (5m) and 508 of 1,406 (15m) fit trades from Study B, exactly the late breakouts. Found and fixed **before any model was trained**. Test A was unaffected and I verified it rather than assuming: the rebuilt tables are bit-identical in `netR_1` and `grossR_1` across all 4,851 rows.

## 4. What was checked before any number counted

- **Coverage.** US100's committed `COVERAGE.md` row and section reproduce **byte-identically** from the raw NDJSON. US500 (pull finished during this pass) audits clean: 954,943 bars, 0 duplicate timestamps, 0 non-monotone, same span and same eight no-data weekdays as US100. One ambiguity in your §3.1 is flagged in `DESIGN.md` §2.2 — there was no committed US500 row to reproduce, so I read the check as its evident intent (pipeline stability) and established US500's row fresh. No number depends on the reading.
- **Grid.** 1,024 session days, 0 violations.
- **Look-ahead.** 56 trades across all eight arms, every feature rebuilt from a tape truncated at the entry minute; 1,344 cells, max relative difference 0, 0 violations.
- **Fills.** Exact agreement (max abs diff 0) on 4,841 of 4,851 trades. The check initially flagged 3 US500 trades; all were **minute-level** gaps through the stop inside an arm bar whose own open did not gap — the case the 1-minute path exists to resolve, and in each the 1m fill was the harsher one. The mask was corrected to flag gaps at 1-minute granularity (gapping is a property of the trade, not of a chosen bar size) and the check was made **stronger** than §3.5 asked: on every excluded trade the 1m fill must be no better than the bar fill, and on all 10 it is not.
- **Session.** 0 of 4,851 trades cross 16:00 NY.

## 5. Where everything is

| file | what |
|---|---|
| `DESIGN.md` | the pre-registration, `82d6c0b`; §8.2.1 cutoff decision `290260e`; §12 amendment log |
| `REPORT.md` | eight verdicts in the first section, every descriptive row and sensitivity, Study B under its hypothesis-generating heading |
| `MECHANIC-PROOF.md` | ten fit-period trades per timeframe, minute by minute, with all 24 features |
| `results/COVERAGE-AUDIT.md` | the coverage audit output verbatim |
| `results/holdout_verdicts.csv` | the ladder applied, per arm |
| `results/holdout_nulls.csv` | Null A / Null B / bootstrap per arm |
| `results/studyb/` | importances, the null-max distributions, the frozen models, the holdout read |
| `results/checks.json` | the four §11 stop-rule checks |

Reproduce: `python projection.py && python build.py && python checks.py all && python analysis.py fit && python studyb.py train && python analysis.py holdout && python studyb.py holdout && python report.py && python handoff.py`

**A kill is a result.** `knowledge/opening-range-breakout.md` needs its status line updated from "verdicts pending" to the eight verdicts above; I have done that and recorded a `RESEARCH-LOG.md` Запись as the pre-registration required, regardless of outcome.
