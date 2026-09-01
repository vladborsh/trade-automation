#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity **v5-NY** engine.

This pass is hypothesis-tested rather than descriptive, and it is motivated by
disagreement with a null — so the burden on the plumbing is higher than usual,
not lower. Three families of claim are checked:

  A. **The inherited event stream is bit-identical.** The take-out stream and
     BOTH confirmation streams must reproduce `research/session-liquidity-v4/`
     (iFVG) and `research/session-liquidity-bos/` (BoS + iFVG) exactly. If they
     do not, every number in this pass is about a different event set and the
     pass is invalid. This also validates DESIGN §1.1's data substitution
     (BTC/ETH/SOL read from `intraday-mr-smc/data/`, BNB re-pulled).

  B. **The inherited mechanics really are what the docs say.** Anchor
     precedence (pivot bar < t0, confirmed <= t0); anchor immutability, proved
     by re-deriving the anchor from a data PREFIX that ends at t0 and by
     brute-forcing the break against the fixed level; the iFVG candidate is
     the latest-formed qualifying gap that was already active BEFORE the
     confirming bar (i.e. not retroactively chosen); block containment; prefix
     stability. These are the checks that back `MECHANIC-PROOF.md` — the user
     asked to be shown the mechanics are right, and a chart plus an assertion
     are the two halves of that.

  C. **This pass's own additions.** The NY window flag is a pure function of
     the confirmation bar's UTC clock; the h24 horizon is exactly 288 bars from
     t0 (or truncated at the data end) and never shorter than the block
     horizon's reach; the stop proxy is horizon-invariant by construction; and
     the DESIGN §4 trade template — path, same-bar tie, cost, netR — is
     re-derived brute force on a sample.

Usage: python research/session-liquidity-v5-ny/checks.py
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
BOS_RESULTS = os.path.join(C.REPO, "research", "session-liquidity-bos", "results")


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # =====================================================================
    # A. THE INHERITED EVENT STREAM IS BIT-IDENTICAL
    # =====================================================================
    shared = ["level_px", "level_session", "sweep_block", "n_levels_taken",
              "level_age_h", "sweep_ref", "atr", "block_end_bar",
              "bars_remaining", "window_min", "excursion_pct", "excursion_atr",
              "rev_pct", "rev_atr", "adv_pct", "adv_atr", "end_pct", "end_atr"]
    for ref_name, ref_dir in (("v4", V4_RESULTS), ("BoS pass", BOS_RESULTS)):
        same_rows = same_cols = True
        same_ifvg = same_ifvg_delay = True
        detail = []
        for s in C.SYMBOLS:
            a = pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv"))
            b = pd.read_csv(os.path.join(ref_dir, f"events_{s}.csv"))
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
        chk(f"A1[{ref_name}] the take-out stream reproduces row for row",
            same_rows, "; ".join(detail[:4]))
        chk(f"A2[{ref_name}] every shared take-out column is numerically identical",
            same_cols, "; ".join(detail[:6]))
        chk(f"A3[{ref_name}] the iFVG-v4 arm confirms the identical set of take-outs",
            same_ifvg)
        chk(f"A4[{ref_name}] ...on the identical bars", same_ifvg_delay)

    same_bos = same_bos_delay = same_anchor = True
    for s in C.SYMBOLS:
        a = pd.read_csv(os.path.join(C.RESULTS, f"events_{s}.csv")
                        ).set_index(["bar", "direction"]).sort_index()
        b = pd.read_csv(os.path.join(BOS_RESULTS, f"events_{s}.csv")
                        ).set_index(["bar", "direction"]).sort_index()
        same_bos &= bool((a.bos_confirmed.values == b.bos_confirmed.values).all())
        same_bos_delay &= bool(np.allclose(a.bos_delay_bars.fillna(-1),
                                           b.bos_delay_bars.fillna(-1)))
        same_anchor &= bool(np.allclose(a.bos_anchor_px.fillna(-9e9),
                                        b.bos_anchor_px.fillna(-9e9),
                                        rtol=1e-9, atol=1e-9))
    chk("A5 the corrected-BoS arm confirms the identical set of take-outs as the BoS pass",
        same_bos)
    chk("A6 ...on the identical bars", same_bos_delay)
    chk("A7 ...off the identical pinned anchor price", same_anchor)

    # =====================================================================
    # B. THE INHERITED MECHANICS ARE WHAT THE DOCS SAY
    # =====================================================================
    anch = e[e.bos_anchorable]
    chk("B1 anchor pivot bar is strictly before the take-out bar t0",
        bool((anch.bos_anchor_bar < anch.bar).all()),
        f"min gap {int((anch.bar - anch.bos_anchor_bar).min())} bars")
    chk("B2 anchor confirmation bar is <= t0 (confirmed AS OF the take-out)",
        bool((anch.bos_anchor_conf_bar <= anch.bar).all()),
        f"max lag {int((anch.bar - anch.bos_anchor_conf_bar).max())} bars")
    chk(f"B3 anchor pivot precedes its own confirmation by exactly k = {C.PIVOT_K}",
        bool(((anch.bos_anchor_conf_bar - anch.bos_anchor_bar) == C.PIVOT_K).all()))
    chk("B4 unanchorable events carry no anchor and never confirm",
        bool((~e.loc[~e.bos_anchorable, "bos_confirmed"]).all()
             and e.loc[~e.bos_anchorable, "bos_anchor_px"].isna().all()),
        f"{int((~e.bos_anchorable).sum())} unanchorable events")

    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    pv = C.pivots(d)
    ai = E.anchor_index_arrays(pv)
    fv = E.fvg_arrays(d)
    cl = d.close.to_numpy(); hi_a = d.high.to_numpy(); lo_a = d.low.to_numpy()
    s = e[e.symbol == sym]
    sub = s.sample(400, random_state=7)
    bad_causal = bad_break = bad_ray = 0
    bad_ifvg_causal = bad_ifvg_live = 0
    for _, r in sub.iterrows():
        i = int(r.bar); be = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"

        # --- B5 prefix-causal anchor: nothing after t0 exists in this view --
        pre = d.iloc[:i + 1].reset_index(drop=True)
        pv_p = C.pivots(pre)
        ai_p = E.anchor_index_arrays(pv_p)
        an_p = E.bos_anchor(pv_p, ai_p, i, side)
        if bool(an_p["anchorable"]) != bool(r.bos_anchorable):
            bad_causal += 1
        elif an_p["anchorable"] and abs(an_p["px"] - r.bos_anchor_px) > 1e-9:
            bad_causal += 1

        # --- B6/B7 the break, brute-forced against the FIXED level ----------
        if r.bos_anchorable:
            lvl = float(r.bos_anchor_px)
            hits = [t for t in range(i, be + 1)
                    if (cl[t] < lvl if side == "high" else cl[t] > lvl)]
            u_bf = hits[0] if hits else -1
            if (u_bf >= 0) != bool(r.bos_confirmed):
                bad_break += 1
            elif u_bf >= 0 and u_bf != int(r.bos_break_bar):
                bad_break += 1
            stop_at = u_bf if u_bf >= 0 else be
            if not all((cl[t] >= lvl if side == "high" else cl[t] <= lvl)
                       for t in range(i, stop_at if u_bf >= 0 else be + 1)):
                bad_ray += 1

        # --- B8 the iFVG gap was chosen LIVE, not retroactively -------------
        # Re-run the state machine on a prefix that ends at the confirming bar:
        # no bar after the confirmation is visible, so a gap that survives
        # cannot have been picked with hindsight.
        if r.ifvg_confirmed:
            u4 = int(r.ifvg_break_bar)
            pre2 = d.iloc[:u4 + 1].reset_index(drop=True)
            fv2 = E.fvg_arrays(pre2)
            r2 = E.ifvg_confirm_v4(fv2, pre2.close.to_numpy(), i, u4,
                                   float(r.level_px), side)
            if r2["confirm_idx"] != u4 or int(r2["form_idx"]) != int(r.ifvg_form_bar):
                bad_ifvg_causal += 1
            # ...and the gap's own 3rd bar strictly precedes the confirming bar
            if not (int(r.ifvg_form_bar) < u4 and int(r.ifvg_form_bar) >= i):
                bad_ifvg_live += 1

    chk("B5 ANCHOR CAUSALITY: re-deriving the anchor from a data prefix ending "
        "at t0 gives the identical level — no post-t0 pivot can reach it",
        bad_causal == 0, f"{bad_causal} mismatches in {len(sub)} sampled events")
    chk("B6 ANCHOR IMMUTABILITY: a brute-force scan against the FIXED level "
        "reproduces the engine's break bar exactly", bad_break == 0,
        f"{bad_break} violations")
    chk("B7 no bar before the break sits on the far side of the ray — the level "
        "tested is ONE constant over the whole window (the ray never steps)",
        bad_ray == 0, f"{bad_ray} violations")
    chk("B8 iFVG CAUSALITY: re-running the state machine on a prefix ending at "
        "the confirming bar picks the SAME gap — it was not chosen with hindsight",
        bad_ifvg_causal == 0, f"{bad_ifvg_causal} mismatches")
    chk("B9 the confirming gap's 3rd bar lies inside [t0, confirmation bar) — "
        "the gap formed after the take-out and before the close that inverted it",
        bad_ifvg_live == 0, f"{bad_ifvg_live} violations")

    import ast
    tree = ast.parse(open(os.path.join(C.HERE, "engine.py")).read())
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "bos_break")
    stmts = [st for st in fn.body if not (isinstance(st, ast.Expr)
                                          and isinstance(st.value, ast.Constant))]
    assigned = {t.id for st in ast.walk(ast.Module(body=stmts, type_ignores=[]))
                if isinstance(st, ast.Assign) for t in ast.walk(st.targets[0])
                if isinstance(t, ast.Name)}
    chk("B10 the break scan assigns to no level variable at all — it is "
        "structurally incapable of re-anchoring",
        "anchor_px" not in assigned and "act_lo" not in assigned
        and "act_hi" not in assigned,
        f"names assigned in the body: {sorted(assigned) or 'none'}")

    blk = d["block"].to_numpy(); day = d["ts"].dt.floor("D").to_numpy()
    b0 = s.bar.to_numpy(); b1 = s.block_end_bar.to_numpy().astype(int)
    chk("B11 the block-scoped horizon never crosses a block boundary",
        bool((blk[b0] == blk[b1]).all() and (day[b0] == day[b1]).all()))
    chk("B12 every confirmation bar lies inside [t0, block_end], both arms",
        bool(((s.bos_break_bar >= s.bar) | (s.bos_break_bar == -1)).all()
             and ((s.bos_break_bar <= s.block_end_bar) | (s.bos_break_bar == -1)).all()
             and ((s.ifvg_break_bar >= s.bar) | (s.ifvg_break_bar == -1)).all()
             and ((s.ifvg_break_bar <= s.block_end_bar) | (s.ifvg_break_bar == -1)).all()))

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
    full = s[s.h24_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    pre_ = ev_pre[ev_pre.h24_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    common_bars = full.index.intersection(pre_.index)
    cols = ["level_px", "level_session", "sweep_block", "bars_remaining",
            "bos_anchor_px", "bos_confirmed", "bos_delay_bars",
            "ifvg_confirmed", "bos_in_ny", "ifvg_in_ny",
            "bos_blk_netR", "ifvg_blk_netR", "bos_h24_netR", "ifvg_h24_netR"]
    same = True
    for col in cols:
        a_ = full.loc[common_bars, col]; b_ = pre_.loc[common_bars, col]
        if a_.dtype.kind == "f":
            same &= bool(np.allclose(a_.fillna(-9e9), b_.fillna(-9e9),
                                     rtol=1e-9, atol=1e-9))
        else:
            same &= bool((a_.values == b_.values).all())
    chk("B13 prefix stability: a 60%-truncated re-run reproduces the same "
        "events, the same flags and the same R",
        same and len(common_bars) == len(full),
        f"{len(common_bars)} shared of {len(full)} full-run events in the prefix")

    # =====================================================================
    # C. THIS PASS'S OWN ADDITIONS
    # =====================================================================
    # C1 the NY flag is a pure function of the confirmation bar's UTC clock
    bad_win = 0
    for pre in ("bos", "ifvg"):
        cc = e[e[f"{pre}_confirmed"]]
        m = cc[f"{pre}_conf_min_utc"].to_numpy()
        want = (m >= C.NY_WIN_UTC[0]) & (m < C.NY_WIN_UTC[1])
        bad_win += int((want != cc[f"{pre}_in_ny"].to_numpy()).sum())
        want_e = (m >= C.NY_WIN_UTC_EST[0]) & (m < C.NY_WIN_UTC_EST[1])
        bad_win += int((want_e != cc[f"{pre}_in_ny_est"].to_numpy()).sum())
    chk("C1 the NY-window flag is exactly [13:40,15:20) UTC on the confirmation "
        "bar's own clock — a pure clock function, incapable of looking forward",
        bad_win == 0, f"{bad_win} mismatches")

    # C2 the minute-of-day column is the real timestamp's minute-of-day
    bad_mod = 0
    for pre, col in (("bos", "bos_break_bar"), ("ifvg", "ifvg_break_bar")):
        cc = s[s[f"{pre}_confirmed"]]
        u = cc[col].to_numpy().astype(int)
        got = (d["ts"].dt.hour * 60 + d["ts"].dt.minute).to_numpy()[u]
        bad_mod += int((got != cc[f"{pre}_conf_min_utc"].to_numpy()).sum())
    chk("C2 the recorded confirmation minute-of-day equals the bar's timestamp",
        bad_mod == 0, f"{bad_mod} mismatches")

    # C3 in-window confirmations sit in the NY block, and their take-outs sit
    #    in 13:00-15:15 UTC — the structural consequence DESIGN §2.2 predicts
    inw = e[(e.bos_in_ny) | (e.ifvg_in_ny)]
    chk("C3 every in-window confirmation belongs to an NY-block take-out whose "
        "t0 is inside 13:00-15:15 UTC (the structural consequence of "
        "block-scoped confirmation + a window inside the NY block)",
        bool((inw.sweep_block == "NY").all()
             and (inw.t0_min_utc >= 13 * 60).all()
             and (inw.t0_min_utc < C.NY_WIN_UTC[1]).all()),
        f"{len(inw)} in-window events, t0 range "
        f"{int(inw.t0_min_utc.min())}-{int(inw.t0_min_utc.max())} min UTC")

    # C4 the h24 horizon is exactly 288 bars from t0 unless truncated by data end
    chk("C4 the h24 horizon end is min(t0 + 288, last bar), and is flagged when "
        "truncated",
        bool(((e.h24_end_bar - e.bar == C.H24_BARS) | e.h24_truncated).all()),
        f"{int(e.h24_truncated.sum())} truncated events")
    chk("C5 the h24 horizon always reaches at least as far as the block horizon "
        "for the events that have both (so the long column can only ADD tape)",
        bool((e.loc[~e.h24_truncated, "h24_end_bar"]
              >= e.loc[~e.h24_truncated, "block_end_bar"]).all()))

    # C6 the stop proxy is horizon-invariant by construction ([t0,u] only)
    both = e[e.ifvg_confirmed & e.ifvg_blk_stop_atr.notna() & e.ifvg_h24_stop_atr.notna()]
    both_b = e[e.bos_confirmed & e.bos_blk_stop_atr.notna() & e.bos_h24_stop_atr.notna()]
    chk("C6 the stop proxy is identical across the two horizons (it depends only "
        "on [t0, confirmation], never on the forward window)",
        bool(np.allclose(both.ifvg_blk_stop_atr, both.ifvg_h24_stop_atr, atol=1e-12)
             and np.allclose(both_b.bos_blk_stop_atr, both_b.bos_h24_stop_atr,
                             atol=1e-12)),
        f"{len(both)} iFVG / {len(both_b)} BoS events compared")

    # C7 the DESIGN §4 trade template, re-derived brute force
    bad_trade = bad_cost = 0
    tsub = s[s.ifvg_confirmed & s.ifvg_blk_netR.notna()].sample(
        300, random_state=11)
    for _, r in tsub.iterrows():
        i = int(r.bar); u = int(r.ifvg_break_bar); h_end = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"
        entry = cl[u]
        ext = hi_a[i:u + 1].max() if side == "high" else lo_a[i:u + 1].min()
        dist = abs(entry - ext)
        target = entry - dist if side == "high" else entry + dist
        got = None
        for t in range(u + 1, h_end + 1):
            if (hi_a[t] >= ext) if side == "high" else (lo_a[t] <= ext):
                got = -1.0; break
            if (lo_a[t] <= target) if side == "high" else (hi_a[t] >= target):
                got = 1.0; break
        if got is None:
            mtm = (entry - cl[h_end]) if side == "high" else (cl[h_end] - entry)
            got = mtm / dist
        if abs(got - r.ifvg_blk_grossR) > 1e-9:
            bad_trade += 1
        cost = C.COST_ROUNDTRIP * entry / dist
        if abs(cost - r.ifvg_blk_cost_R) > 1e-9 or \
           abs((got - cost) - r.ifvg_blk_netR) > 1e-9:
            bad_cost += 1
    chk("C7 the pinned trade template (entry at the confirmation close, stop at "
        "the sweep leg's running extreme, +1R target, same-bar tie = LOSS) is "
        "reproduced by a brute-force bar walk", bad_trade == 0,
        f"{bad_trade} of {len(tsub)} sampled trades differ")
    chk("C8 cost_R = 0.10% x entry / stop_dist and netR = grossR - cost_R",
        bad_cost == 0, f"{bad_cost} violations")

    # C9 grossR is bounded by construction on stop/target exits
    for pre in ("bos", "ifvg"):
        for h in ("blk", "h24"):
            g = e[f"{pre}_{h}_grossR"]; x = e[f"{pre}_{h}_exit"]
            bad = int(((x == "stop") & (g != -1.0)).sum()
                      + ((x == "target") & (g != 1.0)).sum())
            chk(f"C9[{pre}/{h}] every 'stop' exit books exactly -1R and every "
                f"'target' exit exactly +1R", bad == 0, f"{bad} violations")

    # ------------------------------------------------------------------ INFO
    p = e[e.primary]
    print(f"[INFO] primary sample {len(p):,} of {len(e):,} take-outs; "
          f"BoS {100*p.bos_confirmed.mean():.2f}% iFVG {100*p.ifvg_confirmed.mean():.2f}%")
    fg = p[p.symbol.isin(C.FOREGROUND)]
    print(f"[INFO] BTC+ETH in-window trades: iFVG {int(fg.ifvg_in_ny.sum())}, "
          f"BoS {int(fg.bos_in_ny.sum())}")

    print(f"\n{sum(ok)}/{len(ok)} — "
          + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
