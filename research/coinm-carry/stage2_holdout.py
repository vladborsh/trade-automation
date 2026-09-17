#!/usr/bin/env python3
"""Stage 2 — the HOLDOUT, read ONCE (DESIGN §3.4, §12).

Refuses to run until results/screen.json exists, and refuses to run twice:
the first successful run writes results/holdout_arms.csv and a lock file
results/HOLDOUT_READ.lock recording the timestamp and the git HEAD.
"""
from __future__ import annotations
import json, os, subprocess, sys, datetime
from dataclasses import replace
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import (PERPS, C_TIER, SLOTS, OUT, HOLD_START, HOLD_END,
                    TAIL_START, TAIL_END, QB_THRESHOLD, QB_MIN_DAYS)
import engine, portfolio, armb
from engine import Cfg

SCREEN = os.path.join(OUT, "screen.json")
LOCK = os.path.join(OUT, "HOLDOUT_READ.lock")


def guard():
    if not os.path.exists(SCREEN):
        sys.exit("REFUSING: results/screen.json does not exist — the screen "
                 "decision must be committed BEFORE any holdout number.")
    if os.path.exists(LOCK):
        sys.exit(f"REFUSING: the holdout has already been read.\n"
                 f"{open(LOCK).read()}")


def main():
    guard()
    scr = json.load(open(SCREEN))
    arms_in = [k for k, v in scr["arms"].items() if v["decision"] == "SCREENED IN"]
    print(f"screened in: {arms_in}")
    cfg = Cfg()
    rows = []

    if "A" in arms_in:
        d, p, e = portfolio.run_tier("always", cfg, HOLD_START, HOLD_END)
        rows.append(portfolio.stats(d, p, e, "ARM A - holdout"))
        p.to_csv(os.path.join(OUT, "holdout_positions.csv"), index=False)
        d.to_csv(os.path.join(OUT, "holdout_daily_A.csv"))
        dO, pO, eO = portfolio.run_tier("hysteresis", cfg, HOLD_START, HOLD_END)
        rows.append(portfolio.stats(dO, pO, eO,
                                    "funding-gate overlay - holdout"))
        dt, pt, et = portfolio.run_tier("always", cfg, TAIL_START, TAIL_END)
        rows.append(portfolio.stats(dt, pt, et, "ARM A - tail 2026-08 (non-gating)",
                                    boot=False))

    if "B" in arms_in:
        dB, tB = armb.run(QB_THRESHOLD, QB_MIN_DAYS, HOLD_END, start=HOLD_START)
        rows.append(armb.stats(dB, tB, "ARM B - holdout"))
        tB.to_csv(os.path.join(OUT, "holdout_armb_trades.csv"), index=False)
        dBh, tBh = armb.run(QB_THRESHOLD, QB_MIN_DAYS, HOLD_END,
                            start=HOLD_START, always_hold=True)
        rows.append(armb.stats(dBh, tBh, "arm B always-hold - holdout"))
        dBt, tBt = armb.run(QB_THRESHOLD, QB_MIN_DAYS, TAIL_END,
                            start=TAIL_START)
        rows.append(armb.stats(dBt, tBt, "ARM B - tail 2026-08 (non-gating)"))

    out = pd.DataFrame(rows)
    out.to_csv(os.path.join(OUT, "holdout_arms.csv"), index=False)
    pd.set_option("display.width", 250)
    cols = ["label", "net_pa", "p_boot", "ci90_lo", "ci90_hi", "boot_se_pa",
            "sharpe", "maxdd_pct", "utilisation", "on_slot_days", "trade_days",
            "n_positions", "n_trades", "n_buffer_breach"]
    print(out[[c for c in cols if c in out]].to_string(index=False))
    print()
    dcols = ["label", "funding_pa", "hedge_pa", "fee_pa", "sweep_pa",
             "cost_carry_ratio", "min_buffer_frac", "sd_daily_pct", "rho1",
             "mean_beta_e"]
    print(out[[c for c in dcols if c in out]].to_string(index=False))

    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE,
                          capture_output=True, text=True).stdout.strip()
    open(LOCK, "w").write(
        f"holdout read at {datetime.datetime.now(datetime.timezone.utc)}\n"
        f"git HEAD {head}\nscreen.json committed at {scr['committed_utc']}\n")
    print(f"\nwrote {LOCK}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
