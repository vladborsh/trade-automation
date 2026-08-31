# Hand-off: Researcher → Architect (session-liquidity **v4**, invalidation deleted)

**Status:** pass executed in full. Package committed on `researcher-sl-v4`.
`checks.py` prints ALL CHECKS PASSED (30 assertions + 4 counted diagnostics).
Scope held: iFVG confirmation layer only, unchanged v2 event stream, no BoS,
no PDH/PDL, no drill-down.

**Process note:** the dispatch pointed at `research/session-liquidity-v4/DESIGN.md`,
which does not exist on this branch (`a0c2244` only touched the knowledge
file). The pass ran against the dispatch text's §1 pins + §2 required outputs
and `knowledge/session-liquidity.md` §5.1 v4, both self-contained. Every
required output was produced. If the missing brief pinned something the
dispatch text did not repeat, say so.

Read: [`REPORT.md`](REPORT.md) §2 first — it overturns the headline of the pass
you just accepted — then §5.5 and §7. Audit surface:
[`results/GALLERY.md`](results/GALLERY.md) (24 panels) and
`viz/06_hour_of_day.png`, `viz/08_invalidation_cost.png`.

---

## The short version

1. **Deleting the invalidation rule restores v2's numbers exactly, not
   approximately.** Over all 23,423 take-outs v2 and v4 confirm the **same
   set** (zero disagreements either way) on the **same bar** (100 %). They
   differ only in which gap they name, on 6.7 % of events, with **zero**
   consequence for delay, MFE, MAE, stop or R. Confirmation rate: **v2 64.4 %
   / v3-A 20.7 % / v4 64.4 %**.

2. **v3's headline was misattributed, and that matters for the record.** v3's
   REPORT credited the 64 %→21 % collapse to "the corrected sequential
   mechanic". It was not the sequencing — the sequencing changes essentially
   nothing. **The entire collapse was the fabricated invalidation rule.** Two
   consequences:
   * the v3 numbers are superseded in full (they measure a rule that is not
     part of the idea);
   * **v2's confirmation-rate / delay / from-confirmation geometry tables,
     which `knowledge/session-liquidity.md` §0 still marks as invalidated, are
     numerically correct.** §0 needs rewording: v2's *algorithm* was
     unexecutable, but its *numbers* survive. I did not edit the knowledge
     file — that is your call, and §0/§7 both need touching.

3. **Why the v2 bug was harmless on the headline** (REPORT §2, and it is close
   to a proof, not a coincidence): if no earlier bar closed below an older
   bullish gap's lower edge, every later bullish gap's lower edge sits at or
   above it, so the close that inverts the old gap inverts the freshest one
   too. The retroactive scan almost never buys an earlier confirmation.

4. **The rule the user actually specified does not select.** This is the
   decision-relevant finding and I would not ship past it silently:
   * a bare take-out reverses **1.23–1.58×** the same-block unconditional
     baseline (wick-anchored);
   * conditioning on a v4 iFVG confirmation gives **0.97–1.23×** — i.e. the
     confirmed subset reverses *less* than the average take-out and about as
     much as a random bar. Window-matched it is the same picture (0.86–1.29).
   * v3-A's confirmed lift looked good (1.28–1.75×) **because it was
     discarding**, not because iFVG selects. It was a fast-reversal filter
     wearing an iFVG costume — and it rejected the user's own definition of a
     sweep to get there.

   Arithmetically forced: a filter that keeps 64 % of everything cannot select
   much. **iFVG confirmation is a timing / entry-reference mechanic, not a
   selection filter.** Any strategy built on it needs selectivity from
   somewhere else.

5. **The biggest reversals are precisely the ones the rule cannot fire on.**
   30.3 % of take-outs never see a qualifying gap, and that group has the
   **largest** median wick-anchored reversal in the sample (5.98 ATR, vs 3.31
   for confirmed ones). Only 11.8 % of them would confirm with 2 h more
   window, so this is a property of the rule, not of the clock.

6. **From-confirmation geometry is a coin flip, unchanged across all three
   algorithms.** Median MFE 2.34 / MAE 2.36 ATR, MFE > MAE in ~50 % of
   confirmed events, favourable at block close 51.4 %, median R proxy 0.84,
   R ≥ 1 43.8 %, R ≥ 2 19.7 %. Best cut: London levels swept in the NY block
   (R median 1.00, R ≥ 1 50.2 %, n = 4,780). Worst: anything in the Late
   block (R 0.47).

7. **Window length still dominates everything.** 37.7 % → 56.1 % → 72.5 %
   confirmation rate across the 12–23 / 24–47 / 48–95 bars-remaining buckets —
   a 7× spread against the ~1.5× spread of the whole level × block table.

8. **Hour of day (the §5.1 required deliverable) yields no separate signal.**
   Gap frequency is flat across the clock (21.3–24.5 per 100 bars). The
   unstratified hourly rate looks strong and resets at every block boundary —
   it is window length in disguise. Window-matched it flattens: 72–77 % inside
   the 72+ stratum at every hour, 49–63 % inside 24–48, 34–40 % inside 12–24.
   Honest phrasing: **there is no best hour, only a best remaining window**,
   and they are the same fact seen twice.

---

## What I need from you

1. **A ruling on §0/§7 of `knowledge/session-liquidity.md`** — v2's numbers are
   not stale, and V9's wording should say the sequencing fix was cosmetic while
   the invalidation removal was the substantive one. I left the file untouched.
2. **A decision on point 4** before the PDH/PDL drill-down runs. If iFVG
   confirmation is accepted as a *trigger* rather than a *filter*, the
   drill-down's question changes: it should be asking which **level class**
   (PDH/PDL vs session) and which **window regime** select, not whether iFVG
   does.
3. **Whether to keep chasing the 30 % gapless reversals** (point 5) or accept
   that the mechanic trades a third of the sample for a clean entry reference.

## What is ready to run next, unchanged by this pass

* PDH/PDL drill-down (§3.2) — the salvaged non-iFVG code in
  `researcher-sl-drilldown` now has a stable §5.1 to wire into, and the v4
  confirmation layer is a 60-line function (`engine.ifvg_confirm_v4`) with no
  state beyond one candidate.
* BoS correction pass (§5.2) — untouched, still deferred.

## Package

`research/session-liquidity-v4/` — `engine.py` (all three algorithms on the
same event rows), `tables.py`, `charts.py`, `examples.py`, `gallery.py`,
`checks.py`, `results/` (31 CSVs + 8 gzipped data files + TABLES.md + GALLERY.md), `viz/`
(8 charts + 30 worked-example panels), `session_liquidity_v4.pine` + `RUNBOOK.md`,
`REPORT.md`, this file. `RESEARCH-LOG.md` Запись 14.
