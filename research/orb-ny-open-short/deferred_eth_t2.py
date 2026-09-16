#!/usr/bin/env python3
"""FROZEN — the deferred ETH template-2 registration.

`research/orb-ny-open/ARCHITECT-NOTE-FOLLOWUP.md` §3.2. Written and committed
2026-09-16 as part of the `orb-ny-open-short` dispatch. **Nothing is done on it
until the tape reaches 2027-07-31.** It is not part of the
`orb-ny-open-short` family, it shares none of that family's α, and running it
before the window closes is refused below.

WHY THIS EXISTS. `ETHUSDT-5m` (+0.106R) and `ETHUSDT-15m` (+0.138R) cleared the
+0.10R build bar on **template 2** (no target, flat 16:00 NY) in the closed
pass's holdout, while their gating template-1 verdicts were kills. Selecting
those two arms *because of* their holdout numbers is legitimate **only** if the
test then runs on data that did not exist when they were selected. That is what
this script is: the same mechanic, unchanged, on a **future** year.

THE REGISTRATION, fixed now, not at run time:

  arms       ETHUSDT-5m-t2, ETHUSDT-15m-t2 — the CLOSED pass's mechanic
             EXACTLY: 30-minute opening range 09:30-10:00 NY, trigger window
             10:00-12:00 NY, stop = the opposite side of the range, **no
             target**, forced flat 16:00 NY, NYSE full days, 0.10 % round trip.
  holdout    2027-08-01 .. 2027-07-31 is NOT the window — the window is
             **2026-08-01 .. 2027-07-31**, computed **ONCE**, no earlier than
             the tape reaching 2027-07-31.
  fit        none. The model has no free parameter; the already-read
             2024-01 .. 2026-07 tape IS the fit period.
  family     2 arms -> alpha = 0.05 / 2 = 0.025. Own ladder, NOT the
             orb-ny-open-short cumulative alpha.
  metric     template 2's mean net R.
  nulls      Null A and Null B run ON TEMPLATE 2, 90 % day-block bootstrap,
             n_holdout >= 150, gross > 0.
  weekend    the weekend row re-run on the same future window; "the clock, not
             the anchor" applies unchanged.

This script deliberately **reuses the closed package's `engine.py` unchanged**
(`research/orb-ny-open/`), not this package's parametrised fork: the deferred
registration is the closed mechanic, and importing the closed code is the
cheapest guarantee that it stays that way.

    python deferred_eth_t2.py          # refuses unless the tape reaches the end
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
CLOSED = os.path.abspath(os.path.join(HERE, "..", "orb-ny-open"))

# The closed package IS the mechanic. Import it, do not re-implement it.
sys.path.insert(0, CLOSED)
import common as C  # noqa: E402
import engine as E  # noqa: E402
import analysis as A  # noqa: E402

# ---------------------------------------------------------------- frozen spec
ARMS = [("ETHUSDT", 5), ("ETHUSDT", 15)]
HOLD_START, HOLD_END = "2026-08-01", "2027-07-31"
TEMPLATE = 2                       # the gating template HERE, by registration
N_ARMS = 2
ALPHA = 0.05 / N_ARMS              # 0.025 — this family's own alpha
MIN_TRADES = 150
KILL_MEAN = 0.05
BUILD_MEAN = 0.10
OUT = os.path.join(HERE, "results", "deferred_eth_t2")


def tape_reaches_end(symbol: str) -> tuple[bool, str]:
    """True only when the 1m tape carries a bar at or after 16:00 NY on the
    last day of the registered window."""
    df = C.load_1m(symbol)
    last = int(df.t_ms.max())
    need = C.ny_ms(HOLD_END, 16, 0)
    return last >= need, C.fmt(last)


def verdict(n, m, p, blo, bhi, gross) -> tuple[str, str]:
    if n < MIN_TRADES:
        return "UNDERPOWERED — INCONCLUSIVE", (
            f"{n} holdout trades < {MIN_TRADES}. Returns to the Architect.")
    if m < KILL_MEAN or p > 0.20:
        why = (f"mean net R {m:+.3f}R < +{KILL_MEAN:.2f}R" if m < KILL_MEAN
               else f"Null-A p = {p:.3f} > 0.20")
        return "NO EDGE — KILL", why + "."
    if p > ALPHA:
        return "INCONCLUSIVE", (
            f"mean net R {m:+.3f}R clears the kill bar but Null-A p = {p:.4f} > "
            f"{ALPHA:.4f}. No build.")
    fails = []
    if m < BUILD_MEAN:
        fails.append(f"mean net R {m:+.3f}R < +{BUILD_MEAN:.2f}R")
    if not (blo > 0 or bhi < 0):
        fails.append(f"90% day-block bootstrap [{blo:+.3f}, {bhi:+.3f}] includes 0")
    if not (gross > 0):
        fails.append(f"gross {gross:+.3f}R is not > 0")
    if fails:
        return "INCONCLUSIVE", ("build criteria not all met: " + "; ".join(fails) + ".")
    return "REAL EDGE — build for real", (
        f"mean net R {m:+.3f}R, Null-A p = {p:.4f} <= {ALPHA:.4f}, bootstrap "
        f"[{blo:+.3f}, {bhi:+.3f}] excludes 0, gross {gross:+.3f}R > 0. "
        "Routes to the Architect for a build ruling.")


def main() -> None:
    print("DEFERRED ETH TEMPLATE-2 REGISTRATION — frozen 2026-09-16")
    print(f"registered window: {HOLD_START} .. {HOLD_END}, computed ONCE, "
          f"template {TEMPLATE}, alpha = {ALPHA}")
    for sym, _ in dict.fromkeys(ARMS):
        break
    ok, last = tape_reaches_end("ETHUSDT")
    print(f"ETHUSDT tape ends at {last}")
    if not ok:
        raise SystemExit(
            f"REFUSED. The registered holdout window ends {HOLD_END} and the "
            f"tape only reaches {last}. This script computes nothing until the "
            "window has fully closed. That refusal IS the registration: the "
            "two arms were chosen on numbers already read, and the test is "
            "only honest on data that did not exist when they were chosen. Do "
            "not edit the window to make this run.")

    os.makedirs(OUT, exist_ok=True)
    days = C.nyse_days(HOLD_START, HOLD_END)
    rng = np.random.default_rng(C.SEED)
    rows = []
    for sym, tf in ARMS:
        q = E.build_arm(sym, tf, days)          # closed mechanic, unchanged
        if not len(q):
            continue
        import features as F
        q = F.build(q)
        q = A.add_stop_atr(q)
        m = float(q[f"netR_{TEMPLATE}"].mean())
        gross = float(q[f"grossR_{TEMPLATE}"].mean())
        # Null A / Null B on TEMPLATE 2 — the registered metric.
        nA, _ = A.null_A(sym, tf, q, C.N_PERM_A, rng)
        pA = float(np.nanmean(nA >= m))
        nB, _ = A.null_B(sym, tf, q, C.N_PERM_B, rng)
        pB = float(np.nanmean(nB >= m))
        bt = A.boot_days(q[f"netR_{TEMPLATE}"].values, q.date.values, C.N_BOOT, rng)
        blo, bhi = float(np.percentile(bt, C.BOOT_LO)), float(np.percentile(bt, C.BOOT_HI))
        v, why = verdict(len(q), m, pA, blo, bhi, gross)
        rows.append(dict(arm=f"{sym}-{tf}m-t2", n=len(q), mean_netR_t2=m,
                         mean_grossR_t2=gross, p_A=pA, p_B=pB,
                         boot_lo=blo, boot_hi=bhi, verdict=v, reason=why))
        print(f"  {sym}-{tf}m-t2: n={len(q)} mean={m:+.4f} pA={pA:.4f} -> {v}")

    # the weekend row, same future window, descriptive
    wk = []
    for sym, tf in ARMS:
        g = E.build_arm(sym, tf, C.weekend_days(HOLD_START, HOLD_END))
        if len(g):
            wk.append(dict(arm=f"{sym}-{tf}m-t2", row="weekend", n=len(g),
                           mean_netR_t2=float(g[f"netR_{TEMPLATE}"].mean())))
    pd.DataFrame(rows).to_csv(os.path.join(OUT, "verdicts.csv"), index=False)
    pd.DataFrame(wk).to_csv(os.path.join(OUT, "weekend.csv"), index=False)
    print("\nwrote", OUT)
    print("Return these to the Architect. Do not build on them without a ruling.")


if __name__ == "__main__":
    main()
