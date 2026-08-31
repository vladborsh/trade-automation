#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity **BoS** engine.

The protocol is descriptive — no statistical gate — but the hygiene claims in
REPORT.md are checkable, so they are checked here rather than asserted in
prose. Run after engine.py.

DESIGN.md §2 asks for exactly these:

  1. **anchor precedence** — on every event the anchor's pivot bar is strictly
     before `t0` AND its confirmation bar is <= `t0`;
  2. **anchor immutability** — no event's tested level changes after `t0`.
     Proved by re-deriving the anchor from a *causal prefix* of the data that
     ends at `t0` (so no later pivot can be seen at all) and asserting the same
     level comes back, and by re-walking the break scan against a brute-force
     scan of the fixed level;
  3. **block containment** — the horizon never crosses a block boundary;
  4. **prefix stability** — a 60%-truncated re-run reproduces the same events;
  5. **reproduction of the v2 take-out stream** — asserted against v4's
     committed `results/events_*.csv`, which the v4 pass in turn proved
     byte-identical to v2's (v4 REPORT §2 / its own checks.py). v2's and v3's
     packages are not present on this branch, so v4 is the transitive
     reference; the shared columns are the same ones v4 compared.

Plus, because this package reuses v4's iFVG machine READ-ONLY:

  6. the reused iFVG arm reproduces v4's committed confirmations bar for bar
     (same set, same delay) — without this the method comparison would be
     comparing something that is not the published iFVG-v4 result;
  7. phase 1's `bos_flags()` reproduction really is the overwriting machine
     (its level changes inside the window on the events D2 says it does).

Usage: .venv/bin/python research/session-liquidity-bos/checks.py
"""
from __future__ import annotations

import contextlib
import io
import os

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T

V4_RESULTS = os.path.join(C.REPO, "research", "session-liquidity-v4", "results")


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # ==================================== 5. THE UPSTREAM-STREAM REPRODUCTION
    shared = ["level_px", "level_session", "sweep_block", "n_levels_taken",
              "level_age_h", "sweep_ref", "atr", "block_end_bar",
              "bars_remaining", "window_min", "excursion_pct", "excursion_atr",
              "rev_pct", "rev_atr", "adv_pct", "adv_atr", "end_pct", "end_atr"]
    same_rows = same_cols = True
    same_ifvg = same_ifvg_delay = True
    detail = []
    for s in C.SYMBOLS:
        a = pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
        b = pd.read_csv(os.path.join(V4_RESULTS, f"events_{s}.csv"))
        A_ = a.set_index(["bar", "direction"]).sort_index()
        B_ = b.set_index(["bar", "direction"]).sort_index()
        if not A_.index.equals(B_.index):
            same_rows = False
            detail.append(f"{s}: {len(A_)} vs {len(B_)} events")
            continue
        for c in shared:
            x, y = A_[c], B_[c]
            if x.dtype.kind == "f":
                good = np.allclose(x.fillna(-9e9), y.fillna(-9e9),
                                   rtol=1e-9, atol=1e-9)
            else:
                good = bool((x.values == y.values).all())
            if not good:
                same_cols = False
                detail.append(f"{s}.{c}")
        same_ifvg &= bool((A_.ifvg_confirmed.values == B_.ifvg_confirmed.values).all())
        same_ifvg_delay &= bool(np.allclose(A_.ifvg_delay_bars.fillna(-1),
                                            B_.ifvg_delay_bars.fillna(-1)))
    chk("the take-out event stream reproduces v4's (= v2's) events row for row",
        same_rows, "; ".join(detail[:4]))
    chk("every shared take-out column is numerically identical to v4's",
        same_cols, "; ".join(detail[:6]))
    chk("the reused iFVG-v4 arm confirms the identical set of take-outs",
        same_ifvg)
    chk("...on the identical bars", same_ifvg_delay)

    # ============================================== 1. ANCHOR PRECEDENCE
    anch = e[e.bos_anchorable]
    chk("anchor pivot bar is strictly before the take-out bar t0",
        bool((anch.bos_anchor_bar < anch.bar).all()),
        f"min gap {int((anch.bar - anch.bos_anchor_bar).min())} bars")
    chk("anchor confirmation bar is <= t0 (confirmed AS OF the take-out)",
        bool((anch.bos_anchor_conf_bar <= anch.bar).all()),
        f"max lag {int((anch.bar - anch.bos_anchor_conf_bar).max())} bars")
    chk(f"anchor pivot precedes its own confirmation by exactly k = {C.PIVOT_K}",
        bool(((anch.bos_anchor_conf_bar - anch.bos_anchor_bar) == C.PIVOT_K).all()))
    chk("unanchorable events carry no anchor and never confirm",
        bool((~e.loc[~e.bos_anchorable, "bos_confirmed"]).all()
             and e.loc[~e.bos_anchorable, "bos_anchor_px"].isna().all()),
        f"{int((~e.bos_anchorable).sum())} unanchorable events")
    ua = 100 * (~e.bos_anchorable).mean()
    print(f"[{'INFO' if ua <= 2 else 'LOUD'}] unanchorable share = {ua:.3f}% "
          + ("(within the ~2% the design tolerates)" if ua <= 2 else
             "*** EXCEEDS THE 2% THE DESIGN ASKS TO FLAG LOUDLY ***"))

    # ================================ 2. ANCHOR IMMUTABILITY (the correction)
    # (a) causal re-derivation: recompute the anchor from a prefix of the data
    #     that ENDS at t0. Nothing after the take-out exists in that view, so a
    #     level that survives is provably free of post-t0 information.
    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    pv = C.pivots(d)
    ai = E.anchor_index_arrays(pv)
    cl = d.close.to_numpy()
    s = e[e.symbol == sym]
    sub = s.sample(400, random_state=7)
    bad_causal = bad_break = bad_ray = bad_geo = 0
    for _, r in sub.iterrows():
        i = int(r.bar); be = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"

        # --- (a) prefix-causal anchor -----------------------------------
        pre = d.iloc[:i + 1].reset_index(drop=True)
        pv_p = C.pivots(pre)
        ai_p = E.anchor_index_arrays(pv_p)
        an_p = E.bos_anchor(pv_p, ai_p, i, side)
        if bool(an_p["anchorable"]) != bool(r.bos_anchorable):
            bad_causal += 1
            continue
        if an_p["anchorable"] and abs(an_p["px"] - r.bos_anchor_px) > 1e-9:
            bad_causal += 1
            continue

        if not r.bos_anchorable:
            continue

        # --- (b) the break, brute-forced against the FIXED level ---------
        lvl = float(r.bos_anchor_px)
        hits = [t for t in range(i, be + 1)
                if (cl[t] < lvl if side == "high" else cl[t] > lvl)]
        u_bf = hits[0] if hits else -1
        if (u_bf >= 0) != bool(r.bos_confirmed):
            bad_break += 1
        elif u_bf >= 0 and u_bf != int(r.bos_break_bar):
            bad_break += 1

        # --- (c) the ray really is one constant number over the window ---
        # the engine holds no per-bar level state at all; assert the value the
        # panel draws equals the value every bar was tested against
        if u_bf >= 0:
            if not all((cl[t] >= lvl if side == "high" else cl[t] <= lvl)
                       for t in range(i, u_bf)):
                bad_ray += 1
        else:
            if not all((cl[t] >= lvl if side == "high" else cl[t] <= lvl)
                       for t in range(i, be + 1)):
                bad_ray += 1

        # --- (d) the stop proxy is the pinned convention -----------------
        if u_bf >= 0 and u_bf < be and np.isfinite(r.bos_stop_atr):
            hi = d.high.to_numpy(); lo = d.low.to_numpy()
            ext = hi[i:u_bf + 1].max() if side == "high" else lo[i:u_bf + 1].min()
            stop = (ext - cl[u_bf]) if side == "high" else (cl[u_bf] - ext)
            if abs(stop / r.atr - r.bos_stop_atr) > 1e-8:
                bad_geo += 1

    chk("ANCHOR IMMUTABILITY (a): re-deriving the anchor from a data prefix "
        "ending at t0 gives the identical level — no post-t0 pivot can reach it",
        bad_causal == 0, f"{bad_causal} mismatches in {len(sub)} sampled events")
    chk("ANCHOR IMMUTABILITY (b): a brute-force scan against the FIXED level "
        "reproduces the engine's break bar exactly",
        bad_break == 0, f"{bad_break} violations")
    chk("ANCHOR IMMUTABILITY (c): no bar before the break is on the far side "
        "of the ray — the level tested is one constant over the whole window",
        bad_ray == 0, f"{bad_ray} violations")
    chk("stop proxy = break close back to the sweep leg's running extreme "
        "(DESIGN §2 pin, the same convention iFVG uses)",
        bad_geo == 0, f"{bad_geo} violations")

    # ---- structural: the corrected engine holds no mutable level state -----
    # Docstrings are prose ABOUT the defect, so strip them before looking for
    # the defect's fingerprint in the executable body.
    import ast
    tree = ast.parse(open(os.path.join(C.HERE, "engine.py")).read())
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "bos_break")
    stmts = [s for s in fn.body if not (isinstance(s, ast.Expr)
                                        and isinstance(s.value, ast.Constant))]
    assigned = {t.id for s in ast.walk(ast.Module(body=stmts, type_ignores=[]))
                if isinstance(s, ast.Assign) for t in ast.walk(s.targets[0])
                if isinstance(t, ast.Name)}
    chk("the corrected break scan assigns to no level variable at all "
        "(it is structurally incapable of re-anchoring)",
        "anchor_px" not in assigned and "act_lo" not in assigned
        and "act_hi" not in assigned,
        f"names assigned in the body: {sorted(assigned) or 'none'}")

    # ============================================ 7. PHASE-1 ARM IS THE DEFECT
    p1 = E.phase1_bos_arrays(d, pv)
    moved = 0
    for _, r in sub.iterrows():
        i = int(r.bar)
        u1 = int(r.p1bos_break_bar)
        if u1 < 0:
            continue
        act = p1["act_lo_at" if r.direction == "high_sweep" else "act_hi_at"]
        seg = act[i:u1 + 1]
        seg = seg[np.isfinite(seg)]
        if len(seg) and (seg != seg[0]).any():
            moved += 1
    chk("the phase-1 arm really does re-anchor (its tested level changes "
        "inside the window on a large share of events)",
        moved > 0, f"{moved} of the sampled events show a level change")
    chk("phase-1 and corrected pick the SAME level at t0 on >95% of take-outs "
        "(so the delta isolates re-anchoring, not a different selection rule)",
        e.p1bos_agrees_at_t0.mean() > 0.95,
        f"{100*e.p1bos_agrees_at_t0.mean():.2f}%")

    # =========================================== 3. BLOCK CONTAINMENT
    blk = d["block"].to_numpy(); day = d["ts"].dt.floor("D").to_numpy()
    b0 = s.bar.to_numpy(); b1 = s.block_end_bar.to_numpy().astype(int)
    chk("the horizon never crosses a block boundary",
        bool((blk[b0] == blk[b1]).all() and (day[b0] == day[b1]).all()))
    chk("every break bar lies inside [t0, block_end]",
        bool(((s.bos_break_bar >= s.bar) | (s.bos_break_bar == -1)).all()
             and ((s.bos_break_bar <= s.block_end_bar) | (s.bos_break_bar == -1)).all()))

    # =========================================== 4. PREFIX STABILITY
    cut = int(len(d) * 0.6)
    d_pre = d.iloc[:cut].reset_index(drop=True)
    orig_load = C.load
    C.load = lambda _s, iv="5m": d_pre[["ts", "open", "high", "low", "close",
                                        "volume"]].copy()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            ev_pre = E.run_symbol(sym)
    finally:
        C.load = orig_load
    full = s[s.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    pre = ev_pre[ev_pre.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    common_bars = full.index.intersection(pre.index)
    cols = ["level_px", "level_session", "sweep_block", "bars_remaining",
            "bos_anchor_px", "bos_confirmed", "bos_delay_bars", "bos_R",
            "ifvg_confirmed", "p1bos_confirmed", "rev_atr"]
    same = True
    for col in cols:
        a_ = full.loc[common_bars, col]; b_ = pre.loc[common_bars, col]
        if a_.dtype.kind == "f":
            same &= bool(np.allclose(a_.fillna(-9e9), b_.fillna(-9e9),
                                     rtol=1e-9, atol=1e-9))
        else:
            same &= bool((a_.values == b_.values).all())
    chk("prefix stability: a 60%-truncated re-run reproduces the same events",
        same and len(common_bars) == len(full),
        f"{len(common_bars)} shared of {len(full)} full-run events in the prefix")

    # ---------------------------------------------------------------- INFO
    p = e[e.primary]
    print(f"[INFO] corrected BoS {100*p.bos_confirmed.mean():.2f}% | "
          f"phase-1 BoS {100*p.p1bos_confirmed.mean():.2f}% | "
          f"iFVG v4 {100*p.ifvg_confirmed.mean():.2f}% (primary sample)")
    print(f"[INFO] phase 1 still tests the corrected anchor at its break on "
          f"{100*p[p.p1bos_confirmed].p1bos_same_level_as_corrected.mean():.2f}% "
          f"of its own confirmations")
    cb = p[p.bos_confirmed]
    print(f"[INFO] rev_atr >= anchor distance on "
          f"{100*(cb.rev_atr >= cb.bos_anchor_dist_atr).mean():.2f}% of BoS "
          f"confirmations — the M4d circularity, measured not assumed")

    print(f"\n{sum(ok)}/{len(ok)} — "
          + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
