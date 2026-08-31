# `research/session-liquidity-v4/` — iFVG confirmation with the invalidation rule deleted

A **delta pass** over `research/session-liquidity-v3/` (which was itself a
delta over v2). It changes exactly one thing, and the change is a **deletion**:
v3's rule *"discard the active candidate if a bar closes beyond the take-out
bar's own extreme"* is removed. That rule was fabricated during a grilling
session — the user never asked for it, and it rejects exactly the shape their
own diagram draws as a valid sweep.

What is left is `knowledge/session-liquidity.md` §5.1 (V9, **v4**): a fixed
boundary (the swept level), one active candidate at a time (the latest-formed
qualifying gap, replacement final), confirmation = a close through that
candidate's far edge, unconfirmed at block end. Nothing else.

Everything upstream of confirmation is unchanged and lives in v2 — and that is
proved, not assumed: `checks.py` asserts the v4 take-out stream reproduces v2's
committed `events_*.csv` exactly, and that v2's and v3-A's algorithms, re-run
inside this engine, reproduce their own committed confirmations exactly.

## Start here

| If you want… | Read |
|---|---|
| the findings | [`REPORT.md`](REPORT.md) — **§2 first** (it overturns v3's headline), then §5.5 |
| to audit the mechanic on real charts | [`results/GALLERY.md`](results/GALLERY.md) + the 24 `viz/{conf1,confrep,multiext,diffgap,unclive,uncnone}*.png` panels |
| to audit it on TradingView | [`session_liquidity_v4.pine`](session_liquidity_v4.pine) + [`RUNBOOK.md`](RUNBOOK.md) |
| the routing note / what the Architect must decide | [`HANDOFF.md`](HANDOFF.md) |
| every table as data | `results/*.csv`, assembled in `results/TABLES.md` |
| the authoritative definitions | `../../knowledge/session-liquidity.md` §5.1 / V9 |

## Headline

* Confirmation rate **v2 64.4 % / v3-A 20.7 % / v4 64.4 %** on the identical
  21,118-event primary sample. Deleting the invalidation rule restores v2's
  numbers **exactly** — same confirmed set (0 disagreements over 23,423
  take-outs), same confirming bar (100 %).
* The two algorithms name the **same gap** on 93.3 % of shared confirmations;
  where they differ the confirming bar, delay, MFE, stop and R are still
  identical. The residual difference is gap identity only — which matters for
  executability, not for any measured number.
* **v3's headline was misattributed.** The 64 %→21 % collapse was the
  fabricated invalidation rule, not the sequencing fix.
* **The mechanic does not select.** Confirmed take-outs reverse 0.97–1.23× the
  unconditional baseline against 1.23–1.58× for bare take-outs — a filter that
  keeps 64 % of everything cannot select. iFVG confirmation is a timing /
  entry-reference mechanic, not a filter.
* 30.3 % of take-outs never see a qualifying gap — and that group has the
  **largest** median reversal in the sample (5.98 ATR).

## Running it

```bash
.venv/bin/python research/session-liquidity-v4/engine.py    # ~40 s, 4 symbols
.venv/bin/python research/session-liquidity-v4/tables.py
.venv/bin/python research/session-liquidity-v4/charts.py
.venv/bin/python research/session-liquidity-v4/examples.py  # teaching panels
.venv/bin/python research/session-liquidity-v4/gallery.py   # the audit set
.venv/bin/python research/session-liquidity-v4/checks.py    # 30 assertions
```

Run them from inside the package directory (the modules import each other by
bare name). Data comes through the `data/` symlink to
`research/intraday-mtf-smc/data`; no new pull is made.

## Files

| file | what it is |
|---|---|
| `common.py` | sessions, blocks, block-scoped horizon, level admission, ATR — behaviourally identical to v2's |
| `engine.py` | the v4 state machine, plus v2's and v3-A's algorithms verbatim so the three-way delta runs on the same event rows |
| `tables.py` | D (three-way delta + same-gap agreement), S (state machine), T (core), H (hour of day), A (appendix) |
| `charts.py` | `viz/01..08` |
| `examples.py` | the panel renderer — **one horizontal line, the swept boundary** — plus six teaching panels |
| `gallery.py` | the stratified, seeded 24-panel audit set |
| `checks.py` | 30 assertions + 4 counted diagnostics |
| `session_liquidity_v4.pine` | the TradingView mirror of the mechanic |
