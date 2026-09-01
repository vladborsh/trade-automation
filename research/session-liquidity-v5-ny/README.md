# session-liquidity **v5-NY** — pre-registered NY-window pass

The seventh and final pass on the session-liquidity idea, and the first one run
as a **hypothesis test** rather than a descriptive study.

**Verdict: no edge.** All four pre-registered numbers fail the kill rule.
See `REPORT.md` §0.

## Why this pass exists

The idea was shelved on 2026-08-31 (`RESEARCH-LOG.md` Запись 17). The user
reviewed the ruling, was not convinced by the null, and doubted whether the
detection mechanics were even implemented correctly — a fair doubt, since 3 of
the 6 prior passes carried real bugs. Two things were commissioned:

1. a pass with three definitional changes (a 24h horizon beside the
   block-scoped one, a live 09:40–11:20 New York filter, BTC/ETH foregrounded),
   run to a **stricter** standard than the six descriptive passes precisely
   because it is motivated by disagreeing with a null and by hand-picked cuts;
2. **visual proof** that the current mechanics are right — real annotated
   charts of real detected events, not a written claim.

Both are here.

## Read in this order

| file | what it is |
|---|---|
| `DESIGN.md` | the **pre-registration**, committed before any result existed: hypothesis, stop rule, trade template, fit/holdout split, permutation null, numeric kill rule |
| `REPORT.md` | the full write-up and the verdict |
| `MECHANIC-PROOF.md` | **deliverable 2** — 8 captioned worked examples proving the level never moves and the gap is not chosen with hindsight, plus what the 36 machine checks assert |
| `results/gallery_ny/GALLERY.md` | 24 stratified, un-curated NY-window panels |
| `results/HYPOTHESIS.md` | the test in full: trades, both nulls, bootstrap, verdict ladder, sensitivities |
| `results/TABLES.md` | the house-style descriptive layer |
| `HANDOFF.md` | Researcher → Architect routing note |
| `RUNBOOK.md` | the (small) delta for the TradingView indicator |

## Code

| file | role |
|---|---|
| `common.py` | fork of the BoS pass's, plus the NY window, the h24 horizon, the split dates and the cost model |
| `engine.py` | detection + measurement. The mechanics are copied verbatim from the BoS pass; the additions are the window flag, the long horizon and the trade template |
| `hypothesis.py` | the pre-registered test — split, Null A, Null B, bootstrap, verdict ladder |
| `tables.py` | descriptive tables |
| `charts.py` | `viz/01..06` aggregate views |
| `examples.py` | the panel renderer + the 8 mechanic-proof picks |
| `gallery.py` | the stratified NY gallery |
| `checks.py` | **36/36 PASS** — bit-identity against v4 and the BoS pass, causality, immutability, trade arithmetic |

Run order and timings: `REPORT.md` §10.

## Do not

* modify anything under `research/session-liquidity{,-v2,-v3,-v4,-bos}/` —
  those are closed, audited passes and this package asserts against their
  committed CSVs;
* quote the BoS holdout `p = 0.070` without the fit-period `p = 0.870` beside
  it (`REPORT.md` §8.3).
