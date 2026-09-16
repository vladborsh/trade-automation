#!/usr/bin/env python3
"""Fit tables, then the §6.2 SCREEN, then the holdout ONCE, then the ladder.

Pre-registered in `DESIGN.md` §3-§8; nothing here is tuned. Split into three
commands so that the screen decision is committed before the holdout can be
cut, and so the holdout cannot be cut by accident while the fit tables are
being read.

    python analysis.py fit        # every arm and row, FIT period only
    python analysis.py screen     # §6.2 fit-period screen, FIT period only
    python analysis.py holdout    # the holdout, ONCE, SCREENED-IN arms only

`holdout` refuses to run at all unless `results/fit_screen.csv` exists, and it
computes nothing for an arm the screen removed nor for the quoted +1R corner —
a screened-out arm's holdout column stays blank in `REPORT.md`, and the blank
is the point (note §5.2, §9.3 check 7).

**This is the THIRD AND LAST look at the 2025-08-01 .. 2026-07-31 holdout for
the ORB line on these instruments.** α = 0.05/20 = 0.0025, cumulative over
every arm ever pre-registered against that year (note §6.1). A REAL EDGE here
routes to a pre-committed forward confirmation on 2026-08+ tape, NOT to a
build (note §6.5).

Everything about the nulls, the bootstrap, the cost model, the calendar and
the fills is verbatim from `research/orb-ny-open-short/analysis.py`. The
substantive adaptations, all pre-registered:

  * the arm axis is the exit CONSTRUCTION, so there is one netR per arm rather
    than a template-1 / template-2 pair;
  * **Null A exits its placebos by the arm's own template** — the ratchet for
    E1, the fixed stop and the 16:00 flat for E0 and E2 (note §6.3);
  * §8.1's harvest ratio, common-scale and mean-win / mean-loss rows;
  * forward lift printed ONCE per instrument (it is a property of the trigger
    and is identical across E0/E1/E2 by construction);
  * the §6.4 attribution and "one-sided — flagged" labels replace the closed
    width family's dose-response label, the width axis being closed.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import engine as E  # noqa: E402
import features as F  # noqa: E402

ARMS = C.ARMS
SCREEN_CSV = os.path.join(C.RESULTS, "fit_screen.csv")


def load(name="trades_all") -> pd.DataFrame:
    return pd.read_parquet(os.path.join(C.RESULTS, f"{name}.parquet"))


def describe(g: pd.DataFrame) -> dict:
    """§8.1's mandatory descriptive row. Never silently impute: a trade with no
    defined R is excluded and counted."""
    if not len(g):
        return dict(n=0)
    bad = int((~np.isfinite(g.netR.values)).sum())
    g = g[np.isfinite(g.netR.values)]
    if not len(g):
        return dict(n=0, n_excluded=bad)
    net = g.netR
    win, loss = net[net > 0], net[net <= 0]
    ec = g.exit.value_counts()
    return dict(n=len(g), n_excluded=bad, mean_netR=float(net.mean()),
                median_netR=float(net.median()),
                mean_grossR=float(g.grossR.mean()),
                mean_cost_R=float(g.cost_R.mean()),
                median_cost_R=float(g.cost_R.median()),
                p90_cost_R=float(g.cost_R.quantile(0.90)),
                win_rate=float(100 * (net > 0).mean()),
                mean_win_R=float(win.mean()) if len(win) else np.nan,
                mean_loss_R=float(loss.mean()) if len(loss) else np.nan,
                n_days=int(g.date.nunique()),
                pct_long=float(100 * (g.side > 0).mean()),
                median_stop_atr=float(g.stop_atr.median()) if "stop_atr" in g else np.nan,
                median_stop_dist=float(g.stop_dist.median()),
                median_hold_min=float(g.hold_min.median()),
                median_mfe_R=float(g.mfe_R.median()),
                median_harvest=float(g.harvest.median()),
                exit_stop=int(ec.get("stop", 0)),
                exit_trail_stop=int(ec.get("trail-stop", 0)),
                exit_time=int(ec.get("time-exit", 0)),
                # §8.1 common-scale row: one unit for every construction, so
                # E0/E1 (large R) and E2 (small R) can be compared. The ladder
                # does NOT read this.
                mean_net_points=float((g.netR * g.stop_dist).mean()),
                mean_net_datr=float((g.netR * g.stop_dist / g.datr14).mean())
                if g.datr14.notna().any() else np.nan)


def add_stop_atr(q: pd.DataFrame) -> pd.DataFrame:
    """`stop_atr = stop_dist / ATR14` on the arm's bars at the entry bar —
    Null A sizes its placebo stops with it (DESIGN §6). For E2 this is how the
    0.10-dATR stop reaches the placebo: the placebo keeps the trade's side and
    its `stop_atr`, so a placebo of an E2 trade carries an E2-sized stop."""
    v = np.full(len(q), np.nan)
    for (sym, tf), g in q.groupby(["symbol", "tf"], sort=False):
        I = F.Ind.get(sym, int(tf))
        v[g.index.values] = g.stop_dist.values / I.atr14[g.j.values]
    q["stop_atr"] = v
    return q


# ==========================================================================
# Null A — matched-time placebo (DESIGN §6), PER ARM, exited by the ARM'S OWN
# TEMPLATE (note §6.3)
# ==========================================================================
class Pool:
    """Every 5m bar OPENING in [09:35, 12:00) NY on a day eligible for the
    arm, with a finite ATR14 and a live session after it. The placebo draws
    from here. Verbatim from the short pass, at the single width.

    The pool is shared by E0/E1/E2 — it is a property of the trigger window,
    not of the exit — and the construction enters through the exit walk, which
    is the point of note §6.3.
    """

    _cache: dict = {}

    def __init__(self, sym: str, tf: int, or_minutes: int = C.OR_MIN):
        tp = E.Tape.get(sym)
        B = tp.bars[tf]
        I = F.Ind.get(sym, tf)
        t_start = C.trig_start(or_minutes)
        days = C.nyse_days(C.FIT_START, C.TAIL_END)
        j, ient, iflat, dates = [], [], [], []
        for d in days:
            if E.opening_range(tp, d, or_minutes) is None:
                continue
            fl = E.flat_index(tp, d)
            a = np.searchsorted(B["t"], C.ny_ms(d, *t_start), "left")
            b = np.searchsorted(B["t"], C.ny_ms(d, *C.TRIG_END_BASE), "left")
            for k in range(a, b):
                ie = int(B["i_last"][k])
                if ie < fl and np.isfinite(I.atr14[k]) and I.atr14[k] > 0:
                    j.append(k); ient.append(ie); iflat.append(fl); dates.append(d)
        self.j = np.asarray(j, np.int64)
        self.i_entry = np.asarray(ient, np.int64)
        self.i_flat = np.asarray(iflat, np.int64)
        self.date = np.asarray(dates)
        self.atr = I.atr14[self.j]
        self.close = B["c"][self.j]

    @classmethod
    def get(cls, sym, tf, or_minutes=C.OR_MIN):
        k = (sym, int(tf), int(or_minutes))
        if k not in cls._cache:
            cls._cache[k] = Pool(sym, int(tf), int(or_minutes))
        return cls._cache[k]


def placebo_mean(sym, pool: Pool, pick: np.ndarray, side: np.ndarray,
                 stop_atr: np.ndarray, construction: str) -> float:
    """The placebo keeps the real trade's SIDE and `stop_atr`, and is exited by
    **the arm's own template** (note §6.3): no target ever; the ratchet for E1;
    the fixed stop and the 16:00 flat for E0 and E2. Costs verbatim."""
    tp = E.Tape.get(sym)
    entry = pool.close[pick]
    dist = stop_atr * pool.atr[pick]
    ok = np.isfinite(dist) & (dist > 0)
    if not ok.any():
        return np.nan
    pick, side, entry, dist = pick[ok], side[ok], entry[ok], dist[ok]
    stop = entry - side * dist
    b0 = pool.i_entry[pick] + 1
    b1 = pool.i_flat[pick]
    live = b1 >= b0
    if not live.any():
        return np.nan
    pick, side, entry, dist = pick[live], side[live], entry[live], dist[live]
    stop, b0, b1 = stop[live], b0[live], b1[live]
    b0 = b0.astype(np.int64); b1 = b1.astype(np.int64); side = side.astype(np.int64)
    if C.CONSTRUCTION_TRAIL[construction]:
        xi, xp, _, _, _ = E.walk1m_trail_many(tp.o, tp.h, tp.l, tp.c, b0, b1, side,
                                              entry, stop, dist, C.TRAIL_R)
    else:
        tgt = np.where(side > 0, np.inf, -np.inf)
        xi, xp, _ = E.walk1m_many(tp.o, tp.h, tp.l, tp.c, b0, b1, side, entry, stop, tgt)
    gross = side * (xp - entry) / dist
    cst = E.cost_R(tp.venue, tp, pool.i_entry[pick], np.clip(xi, 0, tp.n - 1), entry, dist)
    return float(np.mean(gross - cst))


def null_A(sym, tf, g: pd.DataFrame, construction: str, n_draws: int,
           rng) -> tuple[np.ndarray, float]:
    pool = Pool.get(sym, tf)
    side = g.side.values.astype(np.int64)
    sa = g.stop_atr.values
    means = np.full(n_draws, np.nan)
    clash_tot = 0
    n = len(g)
    for k in range(n_draws):
        pick = rng.integers(0, len(pool.j), size=n)
        clash = pool.date[pick] == g.date.values
        if clash.any():
            pick[clash] = rng.integers(0, len(pool.j), size=int(clash.sum()))
            clash_tot += int((pool.date[pick] == g.date.values).sum())
        means[k] = placebo_mean(sym, pool, pick, side, sa, construction)
    return means, clash_tot / (n_draws * max(n, 1))


def null_B(sym, tf, g: pd.DataFrame, construction: str, n_draws: int,
           rng) -> tuple[np.ndarray, float]:
    """Whole-stream day shift: every trade moves k eligible days forward,
    keeping its clock slot. Entries with no bar at the shifted slot drop.
    Reported, never gating. Verbatim."""
    pool = Pool.get(sym, tf)
    days = list(dict.fromkeys(pool.date.tolist()))
    dpos = {d: i for i, d in enumerate(days)}
    slot = {}
    B = E.Tape.get(sym).bars[int(tf)]
    for i in range(len(pool.j)):
        d = pool.date[i]
        s = (B["t"][pool.j[i]] - C.ny_ms(d, *C.OR_START))
        slot[(d, int(s))] = i
    base_slot = [(d, int(t - C.ny_ms(d, *C.OR_START)))
                 for d, t in zip(g.date.values, g.t_sig.values)]
    side = g.side.values.astype(np.int64)
    sa = g.stop_atr.values
    means = np.full(n_draws, np.nan)
    ks = rng.permutation(np.arange(1, n_draws + 1))
    drops = []
    for i, k in enumerate(ks):
        pick, sd, st = [], [], []
        for (d, s), sg, a in zip(base_slot, side, sa):
            p = dpos[d] + int(k)
            if p >= len(days):
                p -= len(days)
            key = (days[p], s)
            if key in slot:
                pick.append(slot[key]); sd.append(sg); st.append(a)
        drops.append(1.0 - len(pick) / max(len(g), 1))
        if not pick:
            continue
        means[i] = placebo_mean(sym, pool, np.asarray(pick, np.int64),
                                np.asarray(sd, np.int64), np.asarray(st), construction)
    return means, float(np.mean(drops))


def boot_days(netR, date, n_draws, rng) -> np.ndarray:
    by = {}
    for r, d in zip(netR, date):
        by.setdefault(d, []).append(r)
    blocks = [np.asarray(v) for v in by.values()]
    m = len(blocks)
    out = np.empty(n_draws)
    for k in range(n_draws):
        out[k] = np.concatenate([blocks[j] for j in rng.integers(0, m, size=m)]).mean()
    return out


# ==========================================================================
# Forward lift — v5-ny `tables.py:block_L`, windows substituted. VERBATIM.
# A property of the TRIGGER: identical across E0/E1/E2, so §8.1 prints it
# ONCE PER INSTRUMENT.
# ==========================================================================
HZ_CAP = 390                # minutes: 09:30->16:00 NY
REF_SAMPLE = 20000


def forward_lift(sym, tf, g: pd.DataFrame, rng) -> dict:
    if not len(g):
        return dict(n=0, lift_median=np.nan, pct_ge_1=np.nan)
    tp = E.Tape.get(sym)
    pool = Pool.get(sym, tf)
    I = F.Ind.get(sym, int(tf))
    atr = I.atr14[g.j.values]
    hz = np.minimum(g.i_flat.values - g.i_entry_min.values, HZ_CAP)
    b0 = g.i_entry_min.values + 1
    b1 = g.i_entry_min.values + hz
    mfe = _mfe(tp, b0, b1, g.side.values) / atr
    bucket = np.digitize(hz, [60, 120, 180, 240, 300])
    pb = np.arange(len(pool.j))
    if len(pb) > REF_SAMPLE:
        pb = np.sort(rng.choice(pb, REF_SAMPLE, replace=False))
    phz = np.minimum(pool.i_flat[pb] - pool.i_entry[pb], HZ_CAP)
    keep = phz > 0
    pb, phz = pb[keep], phz[keep]
    pbk = np.digitize(phz, [60, 120, 180, 240, 300])
    ref = {}
    for sd in (1, -1):
        m = _mfe(tp, pool.i_entry[pb] + 1, pool.i_entry[pb] + phz,
                 np.full(len(pb), sd)) / pool.atr[pb]
        for bk in np.unique(pbk):
            v = m[(pbk == bk) & np.isfinite(m)]
            if len(v):
                ref[(sd, int(bk))] = float(np.median(v))
    base = np.array([ref.get((int(s), int(b)), np.nan) for s, b in zip(g.side.values, bucket)])
    L = pd.Series(mfe / base).replace([np.inf, -np.inf], np.nan).dropna()
    return dict(n=int(len(L)), lift_median=float(L.median()),
                pct_ge_1=float(100 * (L >= 1).mean()), ref_n=int(len(pb)))


def _mfe(tp, b0, b1, side):
    out = np.empty(len(b0))
    for i in range(len(b0)):
        a, b = int(b0[i]), int(b1[i])
        if b < a or a < 1:
            out[i] = np.nan
            continue
        out[i] = (tp.h[a:b + 1].max() - tp.c[a - 1]) if side[i] > 0 \
            else (tp.c[a - 1] - tp.l[a:b + 1].min())
    return out


# ==========================================================================
# FIT
# ==========================================================================
def fit_pass() -> None:
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    desc, sides, lift, harv = [], [], [], []
    for arm in ARMS:
        sym, k = C.parse_arm(arm)
        g = q[q.arm == arm]
        f = g[g.period == "fit"]
        desc.append(dict(arm=arm, construction=k, status="pre-registered",
                         period="fit", **describe(f)))
        t = g[g.period == "tail"]
        if len(t):
            desc.append(dict(arm=arm, construction=k, status="pre-registered",
                             period="tail", **describe(t)))
        for sd, lab in ((1, "long"), (-1, "short")):
            sides.append(dict(arm=arm, period="fit", side=lab,
                              **describe(f[f.side == sd])))
        harv.append(dict(arm=arm, period="fit", n=len(f),
                         median_harvest=float(f.harvest.median()),
                         mean_harvest=float(f.harvest.mean()),
                         median_mfe_R=float(f.mfe_R.median()),
                         pct_mfe_ge_1R=float(100 * (f.mfe_R >= 1).mean()),
                         median_netR=float(f.netR.median())))
        print(f"  [fit] {arm}: n={len(f)} mean_netR={f.netR.mean():+.4f} "
              f"mean_cost_R={f.cost_R.mean():.4f} "
              f"median_harvest={f.harvest.median():+.3f}", flush=True)
    # forward lift ONCE per instrument (§8.1) — a property of the trigger
    for sym in C.INSTRUMENTS:
        f = q[(q.arm == C.arm_name(sym, "E0")) & (q.period == "fit")]
        lift.append(dict(symbol=sym, note="identical across E0/E1/E2 by "
                         "construction — the trigger is the same list",
                         **forward_lift(sym, C.TF, f, rng)))
    pd.DataFrame(desc).to_csv(os.path.join(C.RESULTS, "fit_describe.csv"), index=False)
    pd.DataFrame(sides).to_csv(os.path.join(C.RESULTS, "fit_by_side.csv"), index=False)
    pd.DataFrame(lift).to_csv(os.path.join(C.RESULTS, "fit_forward_lift.csv"), index=False)
    pd.DataFrame(harv).to_csv(os.path.join(C.RESULTS, "fit_harvest.csv"), index=False)
    print("\n[fit] wrote fit_describe / fit_by_side / fit_forward_lift / fit_harvest")


# ==========================================================================
# THE SCREEN — §6.2. FIT PERIOD ONLY. Committed before any holdout number.
# ==========================================================================
def screen_pass() -> None:
    """An arm passes the screen iff, on the FIT PERIOD ALONE:

        mean net R >= +0.05R   AND   fit-period Null-A p <= 0.05

    An arm that fails is verdicted "NO EDGE — KILL (fit screen)" and its
    holdout is NEVER computed. Nothing here reads the holdout. Verbatim from
    the follow-up note §5.3; nothing tuned.
    """
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    rows = []
    for arm in ARMS:
        sym, k = C.parse_arm(arm)
        f = q[(q.arm == arm) & (q.period == "fit")]
        m_fit = float(f.netR.mean()) if len(f) else np.nan
        nA, clash = null_A(sym, C.TF, f, k, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m_fit))
        ok_mean = bool(np.isfinite(m_fit) and m_fit >= C.SCREEN_MEAN)
        ok_p = bool(pA <= C.SCREEN_P)
        passed = ok_mean and ok_p
        why = []
        if not ok_mean:
            why.append(f"fit mean net R {m_fit:+.4f}R < +{C.SCREEN_MEAN:.2f}R")
        if not ok_p:
            why.append(f"fit-period Null-A p = {pA:.3f} > {C.SCREEN_P:.2f}")
        rows.append(dict(arm=arm, symbol=sym, construction=k, n_fit=len(f),
                         mean_netR_fit=m_fit,
                         mean_grossR_fit=float(f.grossR.mean()) if len(f) else np.nan,
                         mean_cost_R_fit=float(f.cost_R.mean()) if len(f) else np.nan,
                         fit_nullA_mean=float(np.nanmean(nA)), fit_p_A=pA,
                         fit_nullA_same_date_residual=clash,
                         screen_mean_ok=ok_mean, screen_p_ok=ok_p,
                         screen="PASS" if passed else "SCREENED OUT",
                         reason="" if passed else "; ".join(why)))
        print(f"  [screen] {arm}: n_fit={len(f)} mean={m_fit:+.4f} pA={pA:.3f} "
              f"-> {'PASS' if passed else 'SCREENED OUT'}", flush=True)
    t = pd.DataFrame(rows)
    t.to_csv(SCREEN_CSV, index=False)
    print("\n=== §6.2 FIT-PERIOD SCREEN (no holdout number exists yet) ===")
    print(t[["arm", "n_fit", "mean_netR_fit", "fit_p_A", "screen", "reason"]]
          .to_string(index=False))
    print(f"\nscreened in: {list(t[t.screen == 'PASS'].arm)}")


# ==========================================================================
# HOLDOUT — run ONCE, screened-in arms only
# ==========================================================================
def verdict(n, m_hold, p, m_fit, blo, bhi, gross) -> tuple[str, str]:
    """§6.3's ladder, applied mechanically. α = 0.0025 = 0.05/20."""
    if n < C.MIN_TRADES:
        return "UNDERPOWERED — INCONCLUSIVE", (
            f"{n} holdout trades < {C.MIN_TRADES}; no directional claim either way. "
            "Returns to the Architect.")
    if m_hold < C.KILL_MEAN or p > C.P_INCONCLUSIVE:
        why = (f"holdout mean net R {m_hold:+.3f}R < the pre-registered "
               f"+{C.KILL_MEAN:.2f}R kill bar" if m_hold < C.KILL_MEAN
               else f"Null-A p = {p:.3f} > {C.P_INCONCLUSIVE}")
        return "NO EDGE — KILL", why + "."
    if p > C.ALPHA:
        return "INCONCLUSIVE", (
            f"mean net R {m_hold:+.3f}R clears the kill bar but Null-A p = {p:.4f} is "
            f"above the cumulative Bonferroni-corrected {C.ALPHA:.5f} "
            f"(0.05/{C.N_ARMS_CUMULATIVE}). No build, and no follow-up on the "
            "exit axis.")
    fails = []
    if m_hold < C.BUILD_MEAN:
        fails.append(f"mean net R {m_hold:+.3f}R < +{C.BUILD_MEAN:.2f}R")
    if not (m_fit >= C.KILL_MEAN):
        fails.append(f"fit period does not agree (fit mean {m_fit:+.3f}R < +{C.KILL_MEAN:.2f}R)")
    if not (blo > 0 or bhi < 0):
        fails.append(f"90% day-block bootstrap [{blo:+.3f}, {bhi:+.3f}] includes 0")
    if not (gross > 0):
        fails.append(f"gross expectancy {gross:+.3f}R is not > 0")
    if fails:
        return "INCONCLUSIVE", ("clears the kill bar and the Bonferroni p, but the build "
                                "criteria are not all met: " + "; ".join(fails) + ".")
    return "REAL EDGE (third look)", (
        f"holdout mean net R {m_hold:+.3f}R, Null-A p = {p:.5f} <= {C.ALPHA:.5f}, fit agrees "
        f"({m_fit:+.3f}R), bootstrap [{blo:+.3f}, {bhi:+.3f}] excludes 0, gross "
        f"{gross:+.3f}R > 0. Because this is the THIRD look at this holdout, it does NOT "
        "route to a build: it routes to the Architect and to the pre-committed forward "
        "confirmation on 2026-08+ tape (note §6.5, `forward_confirm.py`).")


# ------------------------------------------------------------------ §6.4
def attribution(verd: pd.DataFrame) -> pd.DataFrame:
    """§6.4, applied mechanically. The sentence the reader is owed about WHICH
    AXIS carried a passing arm, by construction:

      E1 passes, E0 killed          -> the ratchet (the give-back)
      E0 passes                     -> the cap
      E2 passes, E0 killed          -> the stop width
      E0 and E2 both pass           -> the cap; the stop width is not
                                       separately supported

    This is not a veto — the cells are hypotheses, not doses, and a lone pass
    at α = 0.0025 is what the correction is for.
    """
    by = {}
    scr = pd.read_csv(SCREEN_CSV)
    for _, r in scr.iterrows():
        by[r.arm] = "SCREENED OUT (fit screen)" if r.screen != "PASS" else "screened in"
    for _, r in verd.iterrows():
        by[r.arm] = str(r.verdict)

    def passing(sym, k):
        return str(by.get(C.arm_name(sym, k), "")).startswith("REAL EDGE")

    lab, note = [], []
    for _, r in verd.iterrows():
        if not str(r.verdict).startswith("REAL EDGE"):
            lab.append("")
            note.append("")
            continue
        sym, k = r.symbol, r.construction
        e0, e2 = passing(sym, "E0"), passing(sym, "E2")
        if k == "E0" and e2:
            a = ("the CAP. E0 and E2 both pass, so the cap is what carried them and the "
                 "stop width is NOT separately supported.")
        elif k == "E0":
            a = "the CAP — removing the +1R target is what carried this arm."
        elif k == "E1":
            a = ("the GIVE-BACK (the ratchet)." if not e0 else
                 "ambiguous between the CAP and the GIVE-BACK: E0 passes too, and E1 "
                 "nests E0, so the ratchet is not separately attributed.")
        else:
            a = ("the STOP WIDTH — a volatility-sized stop, not the range."
                 if not e0 else
                 "the CAP, with the stop width not separately supported (E0 passes too).")
        lab.append({"E0": "cap", "E1": "give-back", "E2": "stop width"}[k])
        note.append("Which axis carried it, by construction (§6.4): " + a +
                    " Neighbouring cells on the same instrument: " +
                    ", ".join(f"{kk}: {by.get(C.arm_name(sym, kk), 'MISSING')}"
                              for kk in C.CONSTRUCTIONS if kk != k) + ".")
    verd = verd.copy()
    verd["axis"] = lab
    verd["attribution"] = note
    return verd


def one_sided_label(verd: pd.DataFrame, q: pd.DataFrame) -> pd.DataFrame:
    """§6.4 — "an arm reaching REAL EDGE whose holdout mean net R on either
    side is <= 0 is labelled 'one-sided — flagged'". It still routes to the
    Architect; the forward confirmation is then run side-split and the build
    ruling must treat the result as directional."""
    lab, note = [], []
    for _, r in verd.iterrows():
        h = q[(q.arm == r.arm) & (q.period == "holdout")]
        ml = float(h[h.side > 0].netR.mean()) if (h.side > 0).any() else np.nan
        ms = float(h[h.side < 0].netR.mean()) if (h.side < 0).any() else np.nan
        if str(r.verdict).startswith("REAL EDGE") and (ml <= 0 or ms <= 0):
            lab.append("one-sided — flagged")
            note.append(f"holdout long {ml:+.4f}R, short {ms:+.4f}R — one side is not "
                        "positive. Per §6.4 the arm still routes to the Architect, the "
                        "forward confirmation is run SIDE-SPLIT, and the build ruling "
                        "must treat the result as directional.")
        else:
            lab.append("")
            note.append(f"holdout long {ml:+.4f}R, short {ms:+.4f}R")
    verd = verd.copy()
    verd["side_label"] = lab
    verd["side_note"] = note
    return verd


def holdout_pass() -> None:
    if not os.path.exists(SCREEN_CSV):
        raise SystemExit("results/fit_screen.csv does not exist. The §6.2 screen must be "
                         "run and COMMITTED before the holdout is touched.")
    scr = pd.read_csv(SCREEN_CSV)
    keep = list(scr[scr.screen == "PASS"].arm)
    print(f"[holdout] THIRD AND LAST look at {C.HOLD_START} .. {C.HOLD_END}; "
          f"alpha = {C.ALPHA:.5f} = 0.05/{C.N_ARMS_CUMULATIVE}")
    print(f"[holdout] screened in: {keep or '(none)'}")
    print(f"[holdout] screened out, holdout NEVER computed: "
          f"{list(scr[scr.screen != 'PASS'].arm)}")
    print("[holdout] the quoted +1R corner is never computed on the holdout at all.")
    q = add_stop_atr(load())
    rng = np.random.default_rng(C.SEED)
    fixed = pd.read_csv(os.path.join(C.RESULTS, "fixed_spread.csv"), index_col=0).iloc[:, 0]
    rows, verd, nulls, sens, draws, sides, harv = [], [], [], [], {}, [], []
    for arm in keep:
        sym, k = C.parse_arm(arm)
        tf = C.TF
        g = q[q.arm == arm]
        h = g[g.period == "holdout"]
        f = g[g.period == "fit"]
        rows.append(dict(arm=arm, construction=k, period="holdout", **describe(h)))
        if not len(h):
            continue
        for sd, lab in ((1, "long"), (-1, "short")):
            sides.append(dict(arm=arm, period="holdout", side=lab,
                              **describe(h[h.side == sd])))
        harv.append(dict(arm=arm, period="holdout", n=len(h),
                         median_harvest=float(h.harvest.median()),
                         mean_harvest=float(h.harvest.mean()),
                         median_mfe_R=float(h.mfe_R.median()),
                         pct_mfe_ge_1R=float(100 * (h.mfe_R >= 1).mean()),
                         median_netR=float(h.netR.median())))
        m_hold = float(h.netR.mean())
        nA, clash = null_A(sym, tf, h, k, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m_hold))
        nB, dropr = null_B(sym, tf, h, k, C.N_PERM_B, rng)
        pB = float(np.nanmean(nB >= m_hold))
        bt = boot_days(h.netR.values, h.date.values, C.N_BOOT, rng)
        blo, bhi = float(np.percentile(bt, C.BOOT_LO)), float(np.percentile(bt, C.BOOT_HI))
        draws[arm] = dict(nullA=nA.tolist(), nullB=nB.tolist())
        nulls.append(dict(arm=arm, n_holdout=len(h), mean_netR=m_hold,
                          nullA_mean=float(np.nanmean(nA)), p_A=pA,
                          nullA_same_date_residual=clash,
                          nullB_mean=float(np.nanmean(nB)), p_B=pB, nullB_drop_rate=dropr,
                          boot_lo=blo, boot_hi=bhi))
        m_fit = float(f.netR.mean()) if len(f) else np.nan
        v, why = verdict(len(h), m_hold, pA, m_fit, blo, bhi, float(h.grossR.mean()))
        verd.append(dict(arm=arm, symbol=sym, construction=k,
                         n_holdout=len(h), n_fit=len(f),
                         mean_netR_holdout=m_hold, mean_netR_fit=m_fit,
                         mean_grossR_holdout=float(h.grossR.mean()),
                         mean_cost_R_holdout=float(h.cost_R.mean()),
                         median_cost_R_holdout=float(h.cost_R.median()),
                         p90_cost_R_holdout=float(h.cost_R.quantile(0.90)),
                         median_harvest_holdout=float(h.harvest.median()),
                         mean_net_points_holdout=float((h.netR * h.stop_dist).mean()),
                         p_A=pA, p_B=pB, boot_lo=blo, boot_hi=bhi,
                         verdict=v, reason=why))
        s = dict(arm=arm, base=m_hold)
        tp = E.Tape.get(sym)
        ix = np.clip(h.i_exit.values, 0, tp.n - 1)
        s["2x per-bar spread"] = float(h.netR_2x.mean())
        s["fixed fit-median spread"] = float((h.grossR.values - E.cost_R(
            "cc", tp, h.i_entry_min.values, ix, h.entry.values, h.stop_dist.values,
            "fixed", fixed[sym])).mean())
        sens.append(s)
        print(f"  [holdout] {arm}: n={len(h)} mean={m_hold:+.4f} pA={pA:.4f} -> {v}",
              flush=True)
    pd.DataFrame(rows).to_csv(os.path.join(C.RESULTS, "holdout_describe.csv"), index=False)
    pd.DataFrame(sides).to_csv(os.path.join(C.RESULTS, "holdout_by_side.csv"), index=False)
    pd.DataFrame(harv).to_csv(os.path.join(C.RESULTS, "holdout_harvest.csv"), index=False)
    pd.DataFrame(nulls).to_csv(os.path.join(C.RESULTS, "holdout_nulls.csv"), index=False)
    pd.DataFrame(sens).to_csv(os.path.join(C.RESULTS, "holdout_cost_sensitivity.csv"),
                              index=False)
    with open(os.path.join(C.RESULTS, "null_draws.json"), "w") as fh:
        json.dump(draws, fh)

    v = pd.DataFrame(verd)
    if len(v):
        v = attribution(v)
        v = one_sided_label(v, q)
        under = v[v.verdict.str.startswith("UNDERPOWERED")]
        if len(under):
            print("\n*** STOP RULE (DESIGN §11): n_holdout < 150 on a screened-in arm: "
                  f"{list(under.arm)}. Return to the Architect. ***")
        real = v[v.verdict.str.startswith("REAL EDGE")]
        if len(real):
            print(f"\n*** {len(real)} arm(s) reached REAL EDGE (third look): "
                  f"{list(real.arm)}. §6.5: `forward_confirm.py` must be written and "
                  f"committed in THIS dispatch, at alpha = 0.05/{len(real)} = "
                  f"{0.05/len(real):.5f}. NO build routing on the holdout read alone. ***")
    v.to_csv(os.path.join(C.RESULTS, "holdout_verdicts.csv"), index=False)
    print(f"\n=== HOLDOUT VERDICTS (alpha = 0.05/{C.N_ARMS_CUMULATIVE} "
          f"= {C.ALPHA:.5f}) ===")
    if len(v):
        print(v[["arm", "n_holdout", "mean_netR_holdout", "p_A", "verdict",
                 "axis", "side_label"]].to_string(index=False))
    else:
        print("no arm was screened in; the holdout was not read for this family.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    {"fit": fit_pass, "screen": screen_pass, "holdout": holdout_pass}[cmd]()
