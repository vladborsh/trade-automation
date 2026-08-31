#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity **v3** engine.

The protocol is descriptive — no statistical gate — but the hygiene claims in
REPORT.md §0 are checkable, so they are checked here rather than asserted in
prose. Run after engine.py.

v3's headline check is the one DESIGN.md §2 asks for: **the take-out event
stream must reproduce v2's committed `results/events_*.csv` exactly**, so that
every difference in this package is attributable to the confirmation layer and
nothing else. On top of that, the state machine gets its own family of checks —
active-candidate-only confirmation, no post-invalidation retroactive
eligibility, replacement finality, and the same block-containment / prefix
stability checks v2 ran.

Usage: .venv/bin/python research/session-liquidity-v3/checks.py
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T

V2_RESULTS = os.path.join(C.REPO, "research", "session-liquidity-v2", "results")


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # =============================================== THE v3 HEADLINE CHECK
    # Only the confirmation layer moved: every upstream column must equal v2's
    # committed output, row for row, on the same (bar, direction) key.
    shared = ["level_px", "level_session", "sweep_block", "n_levels_taken",
              "level_age_h", "sweep_ref", "atr", "block_end_bar",
              "bars_remaining", "window_min", "excursion_pct", "excursion_atr",
              "rev_pct", "rev_atr", "adv_pct", "adv_atr", "end_pct", "end_atr"]
    all_same, all_algo, detail = True, True, []
    for s in C.SYMBOLS:
        a = pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
        b = pd.read_csv(os.path.join(V2_RESULTS, f"events_{s}.csv"))
        A = a.set_index(["bar", "direction"]).sort_index()
        B = b.set_index(["bar", "direction"]).sort_index()
        same = len(A) == len(B) and A.index.equals(B.index)
        for c in shared:
            if not same:
                break
            x, y = A[c], B[c]
            same &= (bool(np.allclose(x.fillna(-9e9), y.fillna(-9e9),
                                      rtol=1e-9, atol=1e-9))
                     if x.dtype.kind == "f" else bool((x.values == y.values).all()))
        # v2's ALGORITHM, re-run inside the v3 engine, must reproduce v2's own
        # confirmations — otherwise the delta table is comparing two things that
        # differ for a second, unintended reason.
        algo = (bool((A.v2_ifvg_confirmed.values == B.ifvg_confirmed.values).all())
                and bool(np.allclose(A.v2_ifvg_delay_bars.fillna(-1),
                                     B.ifvg_delay_bars.fillna(-1))))
        all_same &= same; all_algo &= algo
        detail.append(f"{s}:{len(A)}")
    chk("DESIGN §2: the take-out stream reproduces v2's committed events EXACTLY",
        all_same, ", ".join(detail))
    chk("v2's algorithm, re-run here, reproduces v2's committed confirmations",
        all_algo)

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
    chk("the invalidation reference IS the take-out bar's own extreme",
        bool(np.allclose(e.inval_ref, e.sweep_ref)))
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
    chk("pin 4: a gap never forms and confirms on the same bar",
        (e.loc[e.ifvg_confirmed, "ifvg_form_bar"] <
         e.loc[e.ifvg_confirmed, "bar"] + e.loc[e.ifvg_confirmed, "ifvg_delay_bars"]).all())

    # ------------------------------------------------ state-machine bookkeeping
    c = e[e.ifvg_confirmed]
    chk("a confirmation always had at least one candidate",
        (c.n_candidates >= 1).all())
    chk("unconf_cause is exhaustive and consistent with ifvg_confirmed",
        bool(((e.unconf_cause == "confirmed") == e.ifvg_confirmed).all()) and
        set(e.unconf_cause.unique()) == {"confirmed", "invalidated_out",
                                         "no_candidate", "live_at_block_end"})
    chk("'no_candidate' events really saw zero candidates",
        (e.loc[e.unconf_cause == "no_candidate", "n_candidates"] == 0).all())
    chk("replacements never exceed candidates-minus-one",
        (e.n_replacements <= (e.n_candidates - 1).clip(lower=0)).all())
    chk("v3's confirmed set is a subset of v2's (v3 can only pick gaps v2 saw)",
        (~(e.ifvg_confirmed & ~e.v2_ifvg_confirmed)).all(),
        f"{int((e.ifvg_confirmed & ~e.v2_ifvg_confirmed).sum())} contradictions")
    # NOT an assertion, and this is a genuine v2->v3 property change. Under v2's
    # retroactive best-pick, strict was a strict SUBSET of relaxed by
    # construction. Under a sequential machine it is not: the stricter location
    # filter admits FEWER candidates, so a gap that the relaxed run would have
    # replaced (or that would have been invalidated in its place) never exists,
    # and an earlier strict-qualifying gap can survive to confirm where the
    # relaxed run got churned out. Counted, documented in REPORT.md, not
    # silently smoothed over.
    print(f"[INFO] strict-but-not-relaxed confirmations: "
          f"{int((e.ifvg_strict_confirmed & ~e.ifvg_confirmed).sum()):,} of "
          f"{int(e.ifvg_strict_confirmed.sum()):,} strict confirmations "
          f"— under a sequential machine strict is NOT a subset of relaxed "
          f"(it was under v2's best-pick); see REPORT.md §6")
    chk("variant B is a superset of A (relaxing the tie can only add)",
        (~(e.ifvg_confirmed & ~e.B_confirmed)).all(),
        f"{int((e.ifvg_confirmed & ~e.B_confirmed).sum())} contradictions")

    # DESIGN §1 pin 3 called the tie 'near-impossible'. It is not — this is a
    # COUNT, deliberately not a pass/fail assertion, because the geometry that
    # produces it is legitimate (see REPORT.md §2).
    print(f"[INFO] pin-3 ties: {int(e.n_ties.sum()):,} bars across "
          f"{int((e.n_ties > 0).sum()):,} take-outs "
          f"({100*(e.n_ties>0).mean():.1f}% of events) — DESIGN §1 pin 3's "
          f"'near-impossible' assumption was wrong; see REPORT.md §2")

    # --------------------------------- REPLAY: the mechanic, bar by bar, on BTC
    # Re-walk the machine for a sample of events and verify by construction that
    # (a) the confirming gap was the ACTIVE one, (b) no gap that formed at or
    # before an invalidation bar was ever reconsidered, (c) a replaced gap never
    # confirmed.
    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    fv = E.fvg_arrays(d)
    cl = d.close.to_numpy(); hh = d.high.to_numpy(); ll = d.low.to_numpy()
    s = e[e.symbol == sym]
    sub = s.sample(800, random_state=7)
    bad_active = bad_retro = bad_replaced = bad_close = 0
    for _, r in sub.iterrows():
        i = int(r.bar); be = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"
        res = E.ifvg_confirm_v3(fv, cl, hh, ll, i, be, r.level_px, side, trace=True)
        if (res["confirm_idx"] >= 0) != bool(r.ifvg_confirmed):
            bad_active += 1
            continue
        log = res["log"]
        # (b) no candidate ever forms on or before the most recent invalidation
        last_inval = -1
        replaced, confirmed_form = set(), None
        for rec in log:
            if rec["kind"] == "candidate":
                if rec["bar"] <= last_inval:
                    bad_retro += 1
            elif rec["kind"] == "invalidated":
                last_inval = rec["bar"]
            elif rec["kind"] == "replaced":
                replaced.add(rec["form"])
            elif rec["kind"] == "confirmed":
                confirmed_form = rec["form"]
        # (c) a replaced gap never confirms
        if confirmed_form is not None and confirmed_form in replaced:
            bad_replaced += 1
        # (a) the confirming close really closes through the ACTIVE gap's far edge
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
    chk("no post-invalidation retroactive eligibility (§5.1 point 3)",
        bad_retro == 0, f"{bad_retro} violations")
    chk("pin 1: a REPLACED gap never confirms",
        bad_replaced == 0, f"{bad_replaced} violations")
    chk("pin 2: every confirmation is a full close-through of the ACTIVE gap, "
        "and that gap reaches beyond the swept level (V5)",
        bad_close == 0, f"{bad_close} violations")

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
            "ifvg_confirmed", "n_candidates", "n_invalidations", "rev_atr", "ifvg_R"]
    same = True
    for c_ in cols:
        a_ = full.loc[common_bars, c_]; b_ = pre.loc[common_bars, c_]
        if a_.dtype.kind == "f":
            same &= bool(np.allclose(a_.fillna(-9e9), b_.fillna(-9e9), rtol=1e-9, atol=1e-9))
        else:
            same &= bool((a_.values == b_.values).all())
    chk("prefix stability: a 60%-truncated re-run reproduces the same events",
        same and len(common_bars) == len(full),
        f"{len(common_bars)} shared of {len(full)} full-run events in the prefix")

    print("\n" + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
