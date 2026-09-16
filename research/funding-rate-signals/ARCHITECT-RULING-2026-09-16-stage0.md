# Architect ruling — Stage-0 escalation (funding-rate-signals), 2026-09-16

Scope: the three anomalies escalated under §9 point 1 / §3.3 rule 2 of
`ARCHITECT-NOTE.md` (commit 61a2058). No R has been computed. This ruling
amends nothing in the pre-registration except where stated; everything
below must be restated in `DESIGN.md` before stage 1 and disclosed in
`REPORT.md` as listed.

## (1) SOLUSDT interval change 2022-11-09 20:00 .. 2022-11-18 16:00 UTC — ruling: option B, blackout

**Ruling.** Declare the span an *interval-anomaly blackout* on SOLUSDT
only. The 8 h grid and every pre-registered count (§1.2 90 settlements,
§1.3 two-settlement persistence and 3-settlement cooldown, §1.4 30-settlement
time stop, §2.2/§2.3 bar counts) stay exactly as written for all 8 symbols.

**Why not the pre-committed fallback (A).** Rule 2's hours-restatement was
written for a symbol that *lives* on a non-8 h grid. Here the exchange ran
a 4 h / 2 h interval for nine days on one symbol, with the rate pinned at
the cap for part of it. Restating in hours would re-define the §1.2 window
for all eight symbols to accommodate 101 rows, and it would still leave
`fpct` ranking 2 h-period rates against 8 h-period rates, which is not one
distribution. Option C is rejected for the reason the Researcher gave.

**Blackout mechanics (record verbatim in DESIGN.md).**
- Blackout rows: every SOLUSDT funding row with `calc_time` in
  `[2022-11-09 20:00, 2022-11-18 16:00)` UTC, grid slots and intermediate
  slots alike. The 2022-11-18 16:00 row (interval back to 8) is the first
  normal row.
- Blackout rows are removed from the SOL settlement stream for all signal
  purposes: no trigger (A or B) is evaluated on them, and they do **not**
  enter the `fpct` window. `fpct` after the blackout is computed over
  present non-blackout rows under the existing `min_periods = 45` rule
  (27 grid slots are lost from the 90-slot window, so `fpct` stays
  defined; `checks.py` asserts this).
- First possible post-blackout B trigger: the bar opening 2022-11-18
  16:00. First possible A trigger: the 2022-11-19 00:00 settlement
  (`k−1` must itself be a present, non-blackout row).
- Any A or B trade on SOL whose `(t_entry, t_exit)` span intersects the
  blackout is **excluded and counted** (the §3.3 rule-5(iii) treatment),
  per arm. No trade is entered inside it.
- 1 h klines inside the span are normal bars: they feed dATR14, ATR14,
  and the B price conditions as usual. The blackout is a funding-stream
  blackout, not a price blackout. The other seven symbols are untouched.
- The pre-committed fallback (A) remains the rule for a *structural*
  interval regime. Any further non-8 h episode found on any symbol goes
  back to escalation; the Researcher does not extend this blackout on
  their own reading.

**Disclosure in REPORT.md.** (i) The span, the interval sequence
(8→4→2→8), and that the rate sat at the −2.0 % cap for part of it.
(ii) The number of excluded-and-counted SOL trades per arm, fit window
only; the audit shows zero non-8 h rows in the holdout, so the holdout is
unaffected and the REPORT says so. (iii) In the doubts section: the FTX
week is a candidate for the most extreme funding observations in the
sample, and it is deliberately outside the SOL evidence; it remains fully
in-sample for the other seven symbols, so the information cost is 1 of 8
symbols for 9 days of ~6 years, all in fit.

## (2) 1 h kline gaps, SOLUSDT and XRPUSDT, 2022-02-26..28 and 2022-04-01..02 — ruling: backfill from the daily prefix, confirmed

**Ruling.** Fill the 10 missing day-spans (5 per symbol, 120 bars each)
from `data/futures/um/daily/klines/<SYM>/1h/` of the same archive. This
is the same exchange, the same series, the same archive at a finer
partition — not a secondary source in the §3.3 rule-4 sense, whose
purpose is to stop a different endpoint substituting silently, and not an
interpolation. The identical spans on two symbols and the Researcher's
probe (all 10 day files HTTP 200, 24 rows each) identify a truncated
monthly zip, not an exchange outage.

**Conditions (record in DESIGN.md §3.1 as an authorised fill).**
- Every filled day is a row in `results/data_audit_fills.csv` with symbol,
  date, source path, rows added.
- `checks.py` asserts: the filled open times are exactly the missing ones,
  no overlap or duplicate with monthly rows; and for at least one
  neighbouring day per gap that exists in *both* monthly and daily files,
  the two are identical row-for-row (OHLCV, open time). If any such day
  disagrees, stop and escalate.
- The daily prefix is authorised for this pull's truncated months only;
  it does not become a general fallback.

**Disclosure in REPORT.md.** One line in the data section: 240 bars on
two symbols backfilled from the daily prefix, spans named, fills logged.

## (3) Funding rows before the first 1 h bar (ADA 35, SOL 2, DOGE 1) — ruling: confirmed, mechanical

**Ruling.** The §3.4 warm-up clock starts at `max(first funding row,
first 1 h bar)`; fit start = that timestamp's date + 15 days. Pre-listing
settlements are genuine exchange prints and feed `fpct` history only.
They can count toward `min_periods = 45`, which may make `fpct` defined
before the fit start; that has no effect because no trade is evaluated
before the fit start, and every trade requires a present bar at the
decision close (§3.2). ADA's table entry (2020-02-15) is already consistent
with this rule; SOL's and DOGE's pre-listing rows are within a day of
their first bar, so 2020-09-29 and 2020-07-25 stand at date granularity.

**Record in DESIGN.md.** The rule above; the actual first-funding and
first-bar timestamps per symbol from `data_audit.csv`; and, if any
computed fit-start date differs from the note's §3.1 table, the computed
date governs and the difference is written down (the table was a
pre-pull expectation, as §3.1 itself says). The `checks.py` assertion
"every settlement lands on a bar open" is scoped to settlements at or
after the first bar; the 38 pre-listing rows are exempt and counted.

**Disclosure in REPORT.md.** One sentence in the data section.

---

Nothing else in the pre-registration moves. Stage 1 may proceed once
DESIGN.md carries the three records above.
