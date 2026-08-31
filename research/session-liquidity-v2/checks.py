#!/usr/bin/env python3
"""Correctness assertions for the session-liquidity **v2** engine.

The protocol for this pass is descriptive — no statistical gate — but the
hygiene claims in REPORT.md §0 are checkable, so they are checked here rather
than asserted in prose. Run after engine.py.

v2 adds three families of check that phase 1 could not have: block-boundary
containment, iFVG timing containment inside the block, and prefix stability
(the engine is causal, so re-running it on a truncated tape must reproduce the
same events bar-for-bar).

Usage: .venv/bin/python research/session-liquidity-v2/checks.py
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import common as C
import engine as E
import tables as T


def main():
    e = T.load_events()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # ---------------------------------------------------------------- levels
    chk("V1 levels are never used before their session closes",
        (e.level_age_h > 0).all(), f"min age {e.level_age_h.min():.2f}h")
    chk("V8 levels expire at 48h",
        (e.level_age_h <= C.LOOKBACK_HOURS + 1e-9).all(),
        f"max age {e.level_age_h.max():.2f}h")
    chk("levels only ever come from level-producing sessions (Late produces none)",
        set(e.level_session.unique()) <= set(C.LEVEL_SESSIONS),
        f"{sorted(e.level_session.unique())}")
    chk("sweep_block spans the full four-block partition",
        set(e.sweep_block.unique()) <= set(C.BLOCK_ORDER),
        f"{sorted(e.sweep_block.unique())}")

    # ------------------------------------------------------- take-out geometry
    hi = e[e.direction == "high_sweep"]; lo = e[e.direction == "low_sweep"]
    chk("take-out wick is beyond the level (high sweeps)",
        (hi.sweep_ref > hi.level_px).all())
    chk("take-out wick is beyond the level (low sweeps)",
        (lo.sweep_ref < lo.level_px).all())
    chk("reverse move is a non-negative excursion",
        (e.rev_atr.dropna() >= 0).all())
    chk("continuation move is a non-negative excursion (floored)",
        (e.adv_atr.dropna() >= 0).all())
    chk("confirmation-anchored MFE/MAE are non-negative excursions (floored)",
        (e.ifvg_mfe_atr.dropna() >= 0).all() and (e.ifvg_mae_atr.dropna() >= 0).all())

    # ------------------------------------------------------- block containment
    chk("V4 bars_remaining is consistent with the block end",
        (e.bars_remaining == e.block_end_bar - e.bar).all())
    chk("V4 bars_remaining is never negative",
        (e.bars_remaining >= 0).all(), f"min {e.bars_remaining.min()}")
    chk("V4 iFVG confirmation lands inside [take-out, block end]",
        ((e.ifvg_delay_bars.dropna() >= 0).all() and
         (e.loc[e.ifvg_confirmed, "ifvg_delay_bars"] <=
          e.loc[e.ifvg_confirmed, "bars_remaining"]).all()),
        f"max delay/remaining ratio "
        f"{(e.loc[e.ifvg_confirmed, 'ifvg_delay_bars'] / e.loc[e.ifvg_confirmed, 'bars_remaining'].clip(lower=1)).max():.2f}")
    chk("V4 the FVG's third bar is also inside the window",
        ((e.ifvg_form_bar.dropna() >= e.loc[e.ifvg_form_bar.notna(), "bar"]).all() and
         (e.ifvg_form_bar.dropna() <= e.loc[e.ifvg_form_bar.notna(), "block_end_bar"]).all()))
    chk("magnitudes exist exactly when the window is non-empty",
        (e.rev_atr.notna() == (e.bars_remaining > 0)).all())

    # A take-out and its block end must carry the same block label, on the same
    # UTC day — the horizon must never spill into the next block.
    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    blk = d["block"].to_numpy(); day = d["ts"].dt.floor("D").to_numpy()
    s = e[e.symbol == sym]
    b0 = s.bar.to_numpy(); b1 = s.block_end_bar.to_numpy().astype(int)
    chk("the horizon never crosses a block boundary",
        bool((blk[b0] == blk[b1]).all() and (day[b0] == day[b1]).all()))
    chk("the block end really is the last bar of its block",
        bool(np.all((b1 == len(d) - 1) |
                    (blk[np.minimum(b1 + 1, len(d) - 1)] != blk[b1]) |
                    (day[np.minimum(b1 + 1, len(d) - 1)] != day[b1]))))

    # ----------------------------------------------------- iFVG reconstruction
    # Rebuild one symbol and verify every sampled confirmation is a genuine full
    # close-through of a gap that REACHES beyond the level (V5 relaxed).
    fv = E.fvg_arrays(d)
    cl = d.close.to_numpy()
    sub = s[s.ifvg_confirmed].head(500)
    bad = 0
    for _, r in sub.iterrows():
        i = int(r.bar); be = int(r.block_end_bar)
        side = "high" if r.direction == "high_sweep" else "low"
        u, t = E.ifvg_confirm(fv, cl, i, be, r.level_px, side, strict=False)
        if u < 0 or t < 0 or not (i <= t < u <= be):
            bad += 1
            continue
        g_lo = fv["bull_lo"][t] if side == "high" else fv["bear_lo"][t]
        g_hi = fv["bull_hi"][t] if side == "high" else fv["bear_hi"][t]
        if side == "high":
            if not (g_hi > r.level_px and cl[u] < g_lo):
                bad += 1
        else:
            if not (g_lo < r.level_px and cl[u] > g_hi):
                bad += 1
    chk("V5 iFVG confirmations are full close-throughs of a gap reaching beyond the level",
        bad == 0, f"{bad} violations in {len(sub)} sampled events")

    # strict is a subset of relaxed, by construction
    chk("strict iFVG is a strict subset of relaxed iFVG",
        (~(e.ifvg_strict_confirmed & ~e.ifvg_confirmed)).all(),
        f"{int((e.ifvg_strict_confirmed & ~e.ifvg_confirmed).sum())} contradictions")

    # ------------------------------------------------------- prefix stability
    # The engine is causal, so truncating the tape must not change any event
    # that already fits inside the truncated prefix. Re-run BTCUSDT on the first
    # 60% of bars and compare against the full run, restricted to events whose
    # whole horizon is inside the prefix.
    cut = int(len(d) * 0.6)
    d_pre = d.iloc[:cut].reset_index(drop=True)
    import io, contextlib
    orig_load = C.load
    C.load = lambda _s, iv="5m": d_pre[["ts", "open", "high", "low", "close", "volume"]].copy()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            ev_pre = E.run_symbol(sym)
    finally:
        C.load = orig_load
    # index on (bar, direction): one bar can host BOTH a high-side and a
    # low-side take-out, so `bar` alone is not unique.
    full = s[s.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    pre = ev_pre[ev_pre.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    common_bars = full.index.intersection(pre.index)
    cols = ["level_px", "level_session", "sweep_block",
            "bars_remaining", "ifvg_confirmed", "rev_atr", "ifvg_R"]
    same = True
    for c in cols:
        a_ = full.loc[common_bars, c]; b_ = pre.loc[common_bars, c]
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
