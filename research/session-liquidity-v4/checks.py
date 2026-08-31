#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity **v4** engine.

The protocol is descriptive — no statistical gate — but the hygiene claims in
REPORT.md §0 are checkable, so they are checked here rather than asserted in
prose. Run after engine.py.

v4's headline checks:

  1. **the take-out event stream reproduces v2's committed `events_*.csv`
     exactly** — the same assertion v3 passed, run again, so that every
     difference in this package is attributable to the confirmation layer and
     nothing else;
  2. **v2's algorithm, re-run here, reproduces v2's committed confirmations**,
     and **v3 variant A, re-run here, reproduces v3's committed
     confirmations** — without both, the three-way delta table would be
     comparing things that differ for a second, unintended reason;
  3. the v4 state machine's own invariants — active-candidate-only
     confirmation, replacement finality, no invalidation state anywhere, a gap
     never forming and confirming on the same bar;
  4. block containment and prefix stability, carried from v2/v3.

Usage: .venv/bin/python research/session-liquidity-v4/checks.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T

V2_RESULTS = os.path.join(C.REPO, "research", "session-liquidity-v2", "results")
V3_RESULTS = os.path.join(C.REPO, "research", "session-liquidity-v3", "results")


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # ============================================ THE UPSTREAM-STREAM CHECKS
    shared = ["level_px", "level_session", "sweep_block", "n_levels_taken",
              "level_age_h", "sweep_ref", "atr", "block_end_bar",
              "bars_remaining", "window_min", "excursion_pct", "excursion_atr",
              "rev_pct", "rev_atr", "adv_pct", "adv_atr", "end_pct", "end_atr"]
    all_same = all_v2 = all_v3 = True
    detail = []
    for s in C.SYMBOLS:
        a = pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
        b = pd.read_csv(os.path.join(V2_RESULTS, f"events_{s}.csv"))
        c = pd.read_csv(os.path.join(V3_RESULTS, f"events_{s}.csv"))
        A = a.set_index(["bar", "direction"]).sort_index()
        B = b.set_index(["bar", "direction"]).sort_index()
        D = c.set_index(["bar", "direction"]).sort_index()
        same = len(A) == len(B) and A.index.equals(B.index)
        for col in shared:
            if not same:
                break
            x, y = A[col], B[col]
            same &= (bool(np.allclose(x.fillna(-9e9), y.fillna(-9e9),
                                      rtol=1e-9, atol=1e-9))
                     if x.dtype.kind == "f" else bool((x.values == y.values).all()))
        v2ok = (bool((A.v2_ifvg_confirmed.values == B.ifvg_confirmed.values).all())
                and bool(np.allclose(A.v2_ifvg_delay_bars.fillna(-1),
                                     B.ifvg_delay_bars.fillna(-1))))
        # v3's committed primary column IS variant A.
        v3ok = (A.index.equals(D.index)
                and bool((A.v3a_confirmed.values == D.ifvg_confirmed.values).all())
                and bool(np.allclose(A.v3a_delay_bars.fillna(-1),
                                     D.ifvg_delay_bars.fillna(-1)))
                and bool(np.allclose(A.v3a_form_bar.fillna(-1),
                                     D.ifvg_form_bar.fillna(-1)))
                and bool((A.v3a_n_invalidations.values == D.n_invalidations.values).all()))
        all_same &= same; all_v2 &= v2ok; all_v3 &= v3ok
        detail.append(f"{s}:{len(A)}")
    chk("DESIGN §2: the take-out stream reproduces v2's committed events EXACTLY",
        all_same, ", ".join(detail))
    chk("v2's algorithm, re-run here, reproduces v2's committed confirmations",
        all_v2)
    chk("v3 variant A, re-run here, reproduces v3's committed confirmations "
        "(delay, forming bar and invalidation count too)", all_v3)

    # ---------------------------------------------------------------- levels
    chk("V1 levels are never used before their session closes",
        (e.level_age_h > 0).all(), f"min age {e.level_age_h.min():.2f}h")
    chk("V8 levels expire at 48h",
        (e.level_age_h <= C.LOOKBACK_HOURS + 1e-9).all(),
        f"max age {e.level_age_h.max():.2f}h")
    chk("levels only ever come from level-producing sessions (Late produces none)",
        set(e.level_session.unique()) <= set(C.LEVEL_SESSIONS))
    chk("sweep_block spans the four-block partition",
        set(e.sweep_block.unique()) <= set(C.BLOCK_ORDER))

    # ------------------------------------------------------- take-out geometry
    hi = e[e.direction == "high_sweep"]; lo = e[e.direction == "low_sweep"]
    chk("take-out wick is beyond the level (high sweeps)", (hi.sweep_ref > hi.level_px).all())
    chk("take-out wick is beyond the level (low sweeps)", (lo.sweep_ref < lo.level_px).all())
    chk("confirmation-anchored MFE/MAE are non-negative excursions",
        (e.ifvg_mfe_atr.dropna() >= 0).all() and (e.ifvg_mae_atr.dropna() >= 0).all())

    # ------------------------------------------------------- block containment
    chk("V4 bars_remaining is consistent with the block end",
        (e.bars_remaining == e.block_end_bar - e.bar).all())
    chk("V4 confirmation lands inside [take-out, block end]",
        ((e.ifvg_delay_bars.dropna() >= 0).all() and
         (e.loc[e.ifvg_confirmed, "ifvg_delay_bars"] <=
          e.loc[e.ifvg_confirmed, "bars_remaining"]).all()))
    chk("V4 the confirming gap's third bar is also inside the window",
        ((e.ifvg_form_bar.dropna() >= e.loc[e.ifvg_form_bar.notna(), "bar"]).all() and
         (e.ifvg_form_bar.dropna() <= e.loc[e.ifvg_form_bar.notna(), "block_end_bar"]).all()))
    chk("pin 3: a gap never forms and confirms on the same bar",
        (e.loc[e.ifvg_confirmed, "ifvg_form_bar"] <
         e.loc[e.ifvg_confirmed, "bar"] + e.loc[e.ifvg_confirmed, "ifvg_delay_bars"]).all())

    # ------------------------------------------------ state-machine bookkeeping
    c = e[e.ifvg_confirmed]
    chk("a confirmation always had at least one candidate", (c.n_candidates >= 1).all())
    chk("v4 has exactly THREE outcome causes — no `invalidated_out`",
        bool(((e.unconf_cause == "confirmed") == e.ifvg_confirmed).all()) and
        set(e.unconf_cause.unique()) == {"confirmed", "no_candidate",
                                         "live_at_block_end"},
        f"causes seen: {sorted(e.unconf_cause.unique())}")
    chk("'no_candidate' events really saw zero candidates",
        (e.loc[e.unconf_cause == "no_candidate", "n_candidates"] == 0).all())
    chk("'live_at_block_end' events had at least one candidate",
        (e.loc[e.unconf_cause == "live_at_block_end", "n_candidates"] >= 1).all())
    chk("replacements never exceed candidates-minus-one",
        (e.n_replacements <= (e.n_candidates - 1).clip(lower=0)).all())
    chk("v4's confirmed set is a subset of v2's (v4 can only pick gaps v2 saw, "
        "and v2 keeps the earliest inversion across all of them)",
        (~(e.ifvg_confirmed & ~e.v2_ifvg_confirmed)).all(),
        f"{int((e.ifvg_confirmed & ~e.v2_ifvg_confirmed).sum())} contradictions")
    chk("v4 never confirms EARLIER than v2 on a take-out both confirm",
        (e.loc[e.ifvg_confirmed & e.v2_ifvg_confirmed, "ifvg_delay_bars"] >=
         e.loc[e.ifvg_confirmed & e.v2_ifvg_confirmed, "v2_ifvg_delay_bars"]).all())
    chk("the diagnostic pivot/close counters are non-negative and bounded by the window",
        ((e.n_local_extremes_beyond >= 0).all()
         and (e.n_closes_beyond_extreme <= e.bars_remaining).all()
         and (e.n_local_extremes_pre_conf <= e.n_local_extremes_beyond).all()))

    # These are EMPIRICAL results, deliberately printed rather than asserted:
    # neither is guaranteed by the mechanic, and the report leans on the
    # measured value, not on an assumption.
    m = e.ifvg_confirmed & e.v2_ifvg_confirmed
    print(f"[INFO] v2 confirms but v4 does not: "
          f"{int((e.v2_ifvg_confirmed & ~e.ifvg_confirmed).sum()):,} of "
          f"{int(e.v2_ifvg_confirmed.sum()):,} — the two confirmed SETS are "
          f"{'identical' if int((e.v2_ifvg_confirmed ^ e.ifvg_confirmed).sum()) == 0 else 'different'} "
          f"on this sample; see REPORT.md §3")
    print(f"[INFO] v3-A confirms but v4 does not: "
          f"{int((e.v3a_confirmed & ~e.ifvg_confirmed).sum()):,} — deleting a "
          f"discard rule is not guaranteed to be monotone (v3 skipped gaps "
          f"forming ON an invalidation bar), so this is counted, not assumed")
    print(f"[INFO] same confirming BAR where both v2 and v4 confirm: "
          f"{100*(e.loc[m,'ifvg_delay_bars'] == e.loc[m,'v2_ifvg_delay_bars']).mean():.2f}%; "
          f"same GAP: {100*e.loc[m,'same_gap_selected'].mean():.2f}%")
    print(f"[INFO] strict-but-not-relaxed confirmations: "
          f"{int((e.ifvg_strict_confirmed & ~e.ifvg_confirmed).sum()):,} — a "
          f"sequential machine does not guarantee strict ⊆ relaxed; see "
          f"REPORT.md §6")

    # --------------------------------- REPLAY: the mechanic, bar by bar, on BTC
    # Re-walk the machine for a sample of events and verify by construction that
    # (a) the confirming gap was the ACTIVE one, (b) a replaced gap never
    # confirmed, (c) the active candidate is always the latest-formed candidate.
    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    fv = E.fvg_arrays(d)
    cl = d.close.to_numpy()
    s = e[e.symbol == sym]
    sub = s.sample(800, random_state=7)
    bad_active = bad_replaced = bad_close = bad_latest = 0
    for _, r in sub.iterrows():
        i = int(r.bar); be = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"
        res = E.ifvg_confirm_v4(fv, cl, i, be, r.level_px, side, trace=True)
        if (res["confirm_idx"] >= 0) != bool(r.ifvg_confirmed):
            bad_active += 1
            continue
        replaced, confirmed_form, last_form = set(), None, -1
        for rec in res["log"]:
            if rec["kind"] == "candidate":
                if rec["bar"] <= last_form:      # formation order must be strict
                    bad_latest += 1
                last_form = rec["bar"]
            elif rec["kind"] == "replaced":
                replaced.add(rec["form"])
            elif rec["kind"] == "confirmed":
                confirmed_form = rec["form"]
                if rec["form"] != last_form:     # the ACTIVE one is the latest
                    bad_latest += 1
        if confirmed_form is not None and confirmed_form in replaced:
            bad_replaced += 1
        if res["confirm_idx"] >= 0:
            u = res["confirm_idx"]
            if side == "high":
                if not (cl[u] < res["gap_lo"] and res["gap_hi"] > r.level_px):
                    bad_close += 1
            else:
                if not (cl[u] > res["gap_hi"] and res["gap_lo"] < r.level_px):
                    bad_close += 1
    chk("replay: engine output matches a fresh state-machine walk",
        bad_active == 0, f"{bad_active} mismatches in {len(sub)} sampled events")
    chk("pin 1: a REPLACED gap never confirms", bad_replaced == 0,
        f"{bad_replaced} violations")
    chk("pin 2: the confirming gap is always the LATEST-formed candidate",
        bad_latest == 0, f"{bad_latest} violations")
    chk("every confirmation is a full close-through of the ACTIVE gap, and that "
        "gap reaches beyond the swept level (V5)",
        bad_close == 0, f"{bad_close} violations")

    # The mechanic has no invalidation state left. Prove it structurally rather
    # than only in prose: no engine column and no transition kind mentions one.
    kinds = set()
    for sym_ in C.SYMBOLS:
        tr = pd.read_csv(os.path.join(C.RESULTS, f"transitions_{sym_}.csv.gz"))
        kinds |= set(tr.kind.unique())
    chk("the transition log contains no invalidation/tie/orphan events",
        kinds <= {"candidate", "replaced", "confirmed", "live_at_block_end"},
        f"kinds seen: {sorted(kinds)}")
    chk("no v4 event column carries an invalidation reference",
        not any(k in e.columns for k in ("inval_ref", "n_invalidations",
                                         "n_ties", "orphan_breaches")))

    # The horizon must never cross a block boundary (v2 check, kept).
    blk = d["block"].to_numpy(); day = d["ts"].dt.floor("D").to_numpy()
    b0 = s.bar.to_numpy(); b1 = s.block_end_bar.to_numpy().astype(int)
    chk("the horizon never crosses a block boundary",
        bool((blk[b0] == blk[b1]).all() and (day[b0] == day[b1]).all()))

    # ------------------------------------------------------- prefix stability
    cut = int(len(d) * 0.6)
    d_pre = d.iloc[:cut].reset_index(drop=True)
    import io, contextlib
    orig_load = C.load
    C.load = lambda _s, iv="5m": d_pre[["ts", "open", "high", "low", "close", "volume"]].copy()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            ev_pre, _ = E.run_symbol(sym, trace=False)
    finally:
        C.load = orig_load
    full = s[s.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    pre = ev_pre[ev_pre.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    common_bars = full.index.intersection(pre.index)
    cols = ["level_px", "level_session", "sweep_block", "bars_remaining",
            "ifvg_confirmed", "n_candidates", "n_replacements", "rev_atr", "ifvg_R"]
    same = True
    for col in cols:
        a_ = full.loc[common_bars, col]; b_ = pre.loc[common_bars, col]
        if a_.dtype.kind == "f":
            same &= bool(np.allclose(a_.fillna(-9e9), b_.fillna(-9e9), rtol=1e-9, atol=1e-9))
        else:
            same &= bool((a_.values == b_.values).all())
    chk("prefix stability: a 60%-truncated re-run reproduces the same events",
        same and len(common_bars) == len(full),
        f"{len(common_bars)} shared of {len(full)} full-run events in the prefix")

    print(f"\n{sum(ok)}/{len(ok)} — "
          + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
