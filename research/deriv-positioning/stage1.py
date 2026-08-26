#!/usr/bin/env python3
"""STAGE 1 — signal-level probes (DESIGN.md §3 stage-1 test, §4 stage-1 probe).

Same methodology as every prior package's edge probe: direction-adjusted forward
returns on NON-OVERLAPPING triggers, no stops, no targets, no costs — purely
"does the trigger see anything". Fit window only. Unusable bars (§1.2) excluded.

  (a) OI-conditioned momentum_breakout: Welch t on
      mean(top ΔOI tercile) − mean(bottom ΔOI tercile) of the SAME trigger set.
      Pass = difference positive with t > 2 at >= 2 adjacent horizons.
  (b1)/(b2) standalone events: pooled mean direction-adjusted forward return.
      Pass = mean positive, t > 2 at >= 2 adjacent horizons, >= 400 events pooled.
      Below 400 the hypothesis is "unmeasurable at the pre-committed definition"
      and stops — the threshold is NOT loosened to manufacture sample.

Horizons: 3..48 1h bars (§3). Every horizon is reported whatever the verdict.
"""
from __future__ import annotations
import numpy as np
import pandas as pd

import common as C
import prep
import signals as S

HORIZONS = [3, 6, 12, 24, 36, 48]
MIN_EVENTS = 400            # §4 frequency floor, pooled, fit


# --------------------------------------------------------------------- utils
def fwd_returns(d: pd.DataFrame, hz: int) -> np.ndarray:
    c = d.close.to_numpy()
    f = np.full(len(c), np.nan)
    f[:-hz] = c[hz:] / c[:-hz] - 1.0
    return f


def deoverlap(idx: np.ndarray, gap: int) -> np.ndarray:
    """Keep the first of any cluster of triggers closer than `gap` bars."""
    keep, last = [], -10 ** 9
    for i in idx:
        if i - last >= gap:
            keep.append(i); last = i
    return np.asarray(keep, dtype=int)


def trigger_idx(d: pd.DataFrame, sig: pd.DataFrame, win, hz: int,
                gap: int | None = None, gate: str = "usable") -> np.ndarray:
    s = sig.sig.to_numpy()
    w = C.window_mask(d, win) & d[gate].to_numpy()
    idx = np.flatnonzero((s != 0) & w)
    idx = idx[idx < len(d) - hz]
    return deoverlap(idx, gap if gap is not None else hz)


def welch(a: np.ndarray, b: np.ndarray):
    """Welch t for mean(a) - mean(b)."""
    if len(a) < 2 or len(b) < 2:
        return np.nan, np.nan
    va, vb = a.var(ddof=1), b.var(ddof=1)
    se = np.sqrt(va / len(a) + vb / len(b))
    diff = a.mean() - b.mean()
    return diff, (diff / se if se > 0 else np.nan)


def tstat(r: np.ndarray) -> float:
    if len(r) < 2 or r.std(ddof=1) == 0:
        return np.nan
    return float(r.mean() / (r.std(ddof=1) / np.sqrt(len(r))))


def adjacent_pass(flags: list[bool]) -> bool:
    return any(flags[i] and flags[i + 1] for i in range(len(flags) - 1))


# -------------------------------------------------------------- hypothesis (a)
def probe_a(symbols, win=None, cond="dOI_4h_pct", label="a_dOI_4h",
            gate="usable_a") -> pd.DataFrame:
    """Tercile split of momentum_breakout triggers on `cond`.

    §5.3 shadow: cond="ret4h_pct" (trailing 4h return percentile), run on the
    SAME `gate` bar set as the real test so the shadow cannot buy extra sample.
    """
    win = win or C.FIT_BY_HYP["a"]
    rows = []
    per_hz = {h: {0: [], 1: [], 2: []} for h in HORIZONS}
    for sym in symbols:
        d = prep.get(sym)
        sig = S.momentum_breakout(d)
        terc = S.tercile(d[cond].to_numpy())
        s = sig.sig.to_numpy()
        for hz in HORIZONS:
            f = fwd_returns(d, hz)
            idx = trigger_idx(d, sig, win, hz, gate=gate)
            idx = idx[terc[idx] >= 0]
            r = f[idx] * s[idx]
            for t in (0, 1, 2):
                sel = r[terc[idx] == t]
                sel = sel[~np.isnan(sel)]
                if len(sel):
                    per_hz[hz][t].append(sel)
    for hz in HORIZONS:
        bot = np.concatenate(per_hz[hz][0]) if per_hz[hz][0] else np.array([])
        mid = np.concatenate(per_hz[hz][1]) if per_hz[hz][1] else np.array([])
        top = np.concatenate(per_hz[hz][2]) if per_hz[hz][2] else np.array([])
        diff, t = welch(top, bot)
        rows.append(dict(hypothesis=label, cond=cond, horizon=hz,
                         n_bottom=len(bot), n_mid=len(mid), n_top=len(top),
                         mean_bottom_bps=bot.mean() * 1e4 if len(bot) else np.nan,
                         mean_mid_bps=mid.mean() * 1e4 if len(mid) else np.nan,
                         mean_top_bps=top.mean() * 1e4 if len(top) else np.nan,
                         diff_bps=diff * 1e4 if diff == diff else np.nan,
                         t_stat=t,
                         t_top=tstat(top), t_bottom=tstat(bot),
                         passes=bool(diff == diff and diff > 0 and t > 2)))
    return pd.DataFrame(rows)


# ------------------------------------------------------------ hypotheses (b*)
def probe_event(symbols, name, win=None) -> pd.DataFrame:
    win = win or C.fit_win(name)
    gate = S.EVENTS[name][1].get("gate", "usable_b1" if name.startswith("b1") else "usable_b2")
    rows = []
    per_hz = {h: [] for h in HORIZONS}
    n_raw = 0
    for sym in symbols:
        d = prep.get(sym)
        sig = S.build_event(d, name)
        s = sig.sig.to_numpy()
        w = C.window_mask(d, win) & d[gate].to_numpy()
        n_raw += int(((s != 0) & w).sum())
        for hz in HORIZONS:
            f = fwd_returns(d, hz)
            # §4: non-overlapping at a FIXED 12-bar spacing, not horizon-dependent
            idx = trigger_idx(d, sig, win, hz, gap=C.BREAK_N, gate=gate)
            r = f[idx] * s[idx]
            r = r[~np.isnan(r)]
            if len(r):
                per_hz[hz].append(r)
    for hz in HORIZONS:
        r = np.concatenate(per_hz[hz]) if per_hz[hz] else np.array([])
        t = tstat(r)
        rows.append(dict(hypothesis=name, horizon=hz, n_raw_events=n_raw,
                         n=len(r), mean_bps=r.mean() * 1e4 if len(r) else np.nan,
                         t_stat=t, hit_rate=float((r > 0).mean()) if len(r) else np.nan,
                         long_share=np.nan,
                         passes=bool(len(r) >= MIN_EVENTS and r.mean() > 0 and t > 2)))
    return pd.DataFrame(rows)


def verdict(df: pd.DataFrame, key: str) -> str:
    g = df.sort_values("horizon")
    flags = g.passes.tolist()
    return "PASS" if adjacent_pass(flags) else "FAIL"


def main():
    import json, sys
    keep = json.load(open(f"{C.OUT}/symbols_kept.json"))["kept"]
    print(f"symbols in pooled statistics — (a) {len(keep['a'])}/8 {keep['a']}")
    print(f"                              (b1) {len(keep['b1'])}/8 {keep['b1']}")
    print(f"                              (b2) {len(keep['b2'])}/8 {keep['b2']}")
    print(f"effective fit windows — (a) {C.FIT}  (b1) {C.FIT_B1}  (b2) {C.FIT}\n")

    out = []
    # --- (a) real + secondary + shadow, all on the same usable_a bar set
    syms = keep["a"]
    a_real = probe_a(syms, cond="dOI_4h_pct", label="a_dOI_4h")
    a_sec = probe_a(keep["a"], cond="dOI_1h_pct", label="a_dOI_1h", gate="usable_a1")
    a_sh = probe_a(syms, cond="ret4h_pct", label="a_shadow_ret4h")
    for nm, df in (("a_dOI_4h", a_real), ("a_dOI_1h", a_sec), ("a_shadow_ret4h", a_sh)):
        out.append(df)
    pd.concat(out).to_csv(f"{C.OUT}/stage1_a.csv", index=False)

    pd.set_option("display.width", 250)
    print("=== (a) OI-conditioned momentum_breakout — top minus bottom ΔOI tercile, FIT ===")
    for nm, df in (("a_dOI_4h (primary)", a_real), ("a_dOI_1h (secondary)", a_sec),
                   ("a_shadow_ret4h (§5.3)", a_sh)):
        print(f"\n-- {nm}")
        print(df.drop(columns=["hypothesis"]).to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
        print(f"   verdict: {verdict(df, nm)}")

    # --- (b1)/(b2) real + sensitivity + shadow
    ev = {}
    for name in S.EVENTS:
        ev[name] = probe_event(keep["b1" if name.startswith("b1") else "b2"], name)
    pd.concat(ev.values()).to_csv(f"{C.OUT}/stage1_b.csv", index=False)
    print("\n=== (b1)/(b2) standalone events — pooled direction-adjusted forward returns, FIT ===")
    for name, df in ev.items():
        print(f"\n-- {name}   raw events (pre-de-overlap) {int(df.n_raw_events.iloc[0])}")
        print(df.drop(columns=["hypothesis", "long_share"]).to_string(index=False, float_format=lambda x: f"{x:9.3f}"))
        floor = int(df.n.max()) >= MIN_EVENTS
        print(f"   n_max {int(df.n.max())} (floor {MIN_EVENTS}: {'met' if floor else 'NOT MET -> unmeasurable'})"
              f"  verdict: {verdict(df, name) if floor else 'UNMEASURABLE'}")


if __name__ == "__main__":
    main()
