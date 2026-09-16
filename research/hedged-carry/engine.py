#!/usr/bin/env python3
"""Hedged spot-perp carry engine (ARCHITECT-NOTE §1, §2, §4).

One object: a slot holding long spot + short USD-M perp in equal notional N,
driven by an ON/OFF state defined per settlement, with the isolated-margin
path of §2 evaluated on the perp 1h HIGH.

Everything the design varies (gate, leverage, mmr, costs, re-centre fraction,
margin on/off) is a field of `Cfg`, so a sensitivity is a different Cfg and
never a different code path.
"""
from __future__ import annotations
import os, sys
from dataclasses import dataclass, field, replace
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SPOT_FEE, PERP_FEE, SLIP, MMR, LIQ_FEE, LEV, RC_FRAC,
                    ON_LEVEL, OFF_LEVEL, F9_WINDOW, BASIS_ANOM,
                    MAX_ABSENT_HOURS, SOL_BLACKOUT, SOL_LAST_BAR_BEFORE,
                    load_funding, load_klines, x_liq_of)


@dataclass(frozen=True)
class Cfg:
    lev: float = LEV
    mmr: float = MMR
    liq_fee: float = LIQ_FEE
    rc_frac: float = RC_FRAC
    spot_fee: float = SPOT_FEE
    perp_fee: float = PERP_FEE
    slip: float = SLIP
    perp_maker_fee: float | None = None   # §4.3 fit-only: entry / gate-OFF exit
    margin: bool = True                   # §6.5 shadow runs with margin off
    exit_fee_on_exit_notional: bool = False   # fit-only sensitivity
    c_slot: float = 1.0                   # scaled by the caller
    label: str = "primary"

    @property
    def x_liq0(self) -> float:
        return x_liq_of(self.lev, 0.0, self.mmr)

    @property
    def x_rc(self) -> float:
        return self.rc_frac * self.x_liq0

    @property
    def n_of_slot(self) -> float:
        """§1.4: N = C_slot / (1 + 1/L)."""
        return self.c_slot / (1.0 + 1.0 / self.lev)


# ---------------------------------------------------------------- data -----
def bars(symbol: str) -> pd.DataFrame:
    """Merged 1h frame, UTC bar opens.  A bar is USABLE for a decision or a
    mark only when both legs are present and |b| <= 5 % (§3.2); the perp row is
    kept regardless so the margin path is evaluated on every perp bar."""
    p = load_klines(symbol, "perp1h").rename(
        columns={"open": "P_open", "high": "P_high", "low": "P_low",
                 "close": "P_close"})
    s = load_klines(symbol, "spot1h").rename(
        columns={"open": "S_open", "high": "S_high", "low": "S_low",
                 "close": "S_close"})
    df = p[["ts", "P_open", "P_high", "P_low", "P_close"]].merge(
        s[["ts", "S_close"]], on="ts", how="left")
    df["b"] = df.P_close / df.S_close - 1.0
    df["ok"] = df.S_close.notna() & (df.b.abs() <= BASIS_ANOM)
    df.loc[~df.ok, ["S_close", "b"]] = np.nan
    return df.sort_values("ts").reset_index(drop=True)


def settlements(symbol: str) -> pd.DataFrame:
    """Present, non-blackout settlement rows with f9 (§1.2, §3.3 rule 3)."""
    f = load_funding(symbol)[["ts", "last_funding_rate"]].rename(
        columns={"last_funding_rate": "f"})
    if symbol == "SOLUSDT":
        a, b = SOL_BLACKOUT
        f = f[~((f.ts >= a) & (f.ts < b))].reset_index(drop=True)
    f["f9"] = f.f.rolling(F9_WINDOW, min_periods=F9_WINDOW).mean()
    return f.reset_index(drop=True)


# --------------------------------------------------------------- gates -----
def gate_hysteresis(f: pd.DataFrame, on=ON_LEVEL, off=OFF_LEVEL) -> np.ndarray:
    """§1.2: ON at f9 >= on, OFF at f9 <= off, persist between.  Undefined f9
    carries no decision and leaves the state where it was."""
    st = np.zeros(len(f), bool)
    cur = False
    v = f.f9.values
    for i in range(len(v)):
        if not np.isnan(v[i]):
            if v[i] >= on:
                cur = True
            elif v[i] <= off:
                cur = False
        st[i] = cur
    return st


def gate_always_on(f: pd.DataFrame) -> np.ndarray:
    """§6.4 benchmark: ON from the first settlement with a defined f9 (so the
    two series start on the same settlement)."""
    return ~f.f9.isna().values


def gate_price(f: pd.DataFrame, bar: pd.DataFrame, on=0.03, off=0.0) -> np.ndarray:
    """§6.5 shadow: the identical hysteresis on the trailing 3-day SPOT return
    in place of f9."""
    s = bar.set_index("ts").S_close
    r3 = (s / s.shift(72) - 1.0).reindex(f.ts.values).values
    st, cur = np.zeros(len(f), bool), False
    for i, v in enumerate(r3):
        if not np.isnan(v):
            if v >= on:
                cur = True
            elif v <= off:
                cur = False
        st[i] = cur
    return st


def gate_extreme(f: pd.DataFrame, pct_window=90, pct_minp=45, pct_hi=0.90,
                 floor=0.0003, lapse=0.0001, persist=2, cooldown=3,
                 max_settle=30) -> np.ndarray:
    """§6.6: the funding family's extreme-state entry, hedged.  ON after two
    consecutive extreme-positive settlements; OFF on lapse to <= 0.01 %/8h or
    after 30 settlements; 3-settlement cooldown."""
    v = f.f.values
    n = len(v)
    pct = np.full(n, np.nan)
    for i in range(n):
        lo = max(0, i - pct_window + 1)
        w = v[lo:i + 1]
        w = w[~np.isnan(w)]
        if len(w) >= pct_minp:
            pct[i] = (w <= v[i]).sum() / len(w)
    extreme = (pct >= pct_hi) & (v >= floor)
    st = np.zeros(n, bool)
    cur, held, cd = False, 0, 0
    run = 0
    for i in range(n):
        run = run + 1 if extreme[i] else 0
        if cur:
            held += 1
            if v[i] <= lapse or held >= max_settle:
                cur, cd = False, cooldown
        elif cd > 0:
            cd -= 1
        elif run >= persist:
            cur, held = True, 0
        st[i] = cur
    return st


# ------------------------------------------------------------ simulate -----
def simulate(symbol: str, state: np.ndarray, f: pd.DataFrame, bar: pd.DataFrame,
             cfg: Cfg, start: pd.Timestamp, end: pd.Timestamp):
    """Run one slot.  `state[k]` is the ON/OFF state decided at settlement
    f.ts[k]; the decision is acted on at the close of the bar opening f.ts[k].

    Returns (positions, per-bar equity frame, events).
    """
    N = cfg.n_of_slot
    ent_cost = (cfg.spot_fee + cfg.perp_fee + 2 * cfg.slip)
    ent_cost_maker = (cfg.spot_fee + (cfg.perp_maker_fee if cfg.perp_maker_fee
                                      is not None else cfg.perp_fee)
                      + cfg.slip + (cfg.slip / 2 if cfg.perp_maker_fee
                                    is not None else cfg.slip))

    bar = bar[(bar.ts >= start) & (bar.ts < end)].reset_index(drop=True)
    if len(bar) == 0:
        return (pd.DataFrame(), pd.DataFrame(columns=["ts", "eq"]), [])
    sett = {t: (i, f.f.values[i]) for i, t in enumerate(f.ts.values)}
    on_at = {t: bool(state[i]) for i, (t) in enumerate(f.ts.values)}

    ts = bar.ts.values
    P_open, P_high, P_close = bar.P_open.values, bar.P_high.values, bar.P_close.values
    S_close, ok = bar.S_close.values, bar.ok.values

    # SOL blackout: no decision inside it, and an open position is unwound at
    # the close of the bar opening 2022-11-09 19:00 (§3.3 rule 3, restated).
    bo_a, bo_b = SOL_BLACKOUT
    is_sol = symbol == "SOLUSDT"

    realized = 0.0                 # cumulative realised cash for the slot
    eq = np.full(len(bar), np.nan)
    pos = None                     # dict of the open position
    positions, events = [], []
    last_state = False
    absent_run = 0

    def open_pos(i, why):
        nonlocal pos, realized
        c = ent_cost_maker if (cfg.perp_maker_fee is not None and why in
                               ("gate_on",)) else ent_cost
        realized -= c * N
        pos = dict(entry_i=i, entry_ts=ts[i], S_e=S_close[i], P_e=P_close[i],
                   q_s=N / S_close[i], q_p=N / P_close[i], F=0.0,
                   fees=c * N, n_settle=0, x_max=0.0, n_rc=0,
                   b_e=P_close[i] / S_close[i] - 1.0, why=why)

    def close_pos(i, why, P_x=None, S_x=None, liq=False):
        nonlocal pos, realized
        p = pos
        P_x = P_close[i] if P_x is None else P_x
        S_x = S_close[i] if S_x is None else S_x
        spot_pnl = p["q_s"] * (S_x - p["S_e"])
        perp_pnl = -p["q_p"] * (P_x - p["P_e"])
        if liq:
            cost = cfg.liq_fee * N + (cfg.spot_fee + cfg.slip) * N
        else:
            maker = (cfg.perp_maker_fee is not None and why == "gate_off")
            pf = cfg.perp_maker_fee if maker else cfg.perp_fee
            sl = cfg.slip + (cfg.slip / 2 if maker else cfg.slip)
            if cfg.exit_fee_on_exit_notional:
                cost = (cfg.spot_fee + cfg.slip) * p["q_s"] * S_x + \
                       (pf + sl - cfg.slip) * p["q_p"] * P_x
            else:
                cost = (cfg.spot_fee + pf + sl) * N
        realized += spot_pnl + perp_pnl - cost
        positions.append(dict(
            symbol=symbol, entry_ts=p["entry_ts"], exit_ts=ts[i],
            why_in=p["why"], why_out=why, N=N,
            S_e=p["S_e"], P_e=p["P_e"], S_x=S_x, P_x=P_x,
            b_e=p["b_e"], b_x=P_x / S_x - 1.0,
            spot_pnl=spot_pnl, perp_pnl=perp_pnl,
            hedge_pnl=spot_pnl + perp_pnl,
            hedge_basis=N * (p["b_e"] - (P_x / S_x - 1.0)),
            funding=p["F"], fees=p["fees"] + cost,
            net=spot_pnl + perp_pnl + p["F"] - p["fees"] - cost,
            gross=spot_pnl + perp_pnl + p["F"],
            n_settle=p["n_settle"], x_max=p["x_max"],
            hold_hours=(ts[i] - p["entry_ts"]) / np.timedelta64(1, "h"),
            liquidated=bool(liq), n_rc_before=p["n_rc"],
        ))
        pos = None

    for i in range(len(bar)):
        t = ts[i]
        tpd = pd.Timestamp(t)
        in_blackout = is_sol and (bo_a <= tpd < bo_b)

        # ---- 1. settlement at this bar's open -----------------------------
        s = sett.get(t)
        if s is not None and pos is not None and i > pos["entry_i"]:
            amt = s[1] * pos["q_p"] * P_open[i]
            pos["F"] += amt
            realized += amt
            pos["n_settle"] += 1
        if s is not None:
            last_state = on_at[t]

        # ---- 2. margin path on the perp HIGH (§2.4, §2.5) -----------------
        do_liq = do_rc = False
        if pos is not None and cfg.margin and i > pos["entry_i"]:
            x = P_high[i] / pos["P_e"] - 1.0
            pos["x_max"] = max(pos["x_max"], x)
            xl = x_liq_of(cfg.lev, pos["F"] / N, cfg.mmr)
            if x >= xl:
                do_liq = True
            elif x >= cfg.rc_frac * cfg.x_liq0:
                do_rc = True

        # ---- 3. absent-bar rule (§3.2) ------------------------------------
        if not ok[i]:
            absent_run += 1
        else:
            absent_run = 0
        force_unwind = (pos is not None and absent_run == 0 and
                        pos.get("absent_over", False))
        if pos is not None and absent_run > MAX_ABSENT_HOURS:
            pos["absent_over"] = True

        # ---- 4. decisions at the bar close --------------------------------
        if pos is not None and do_liq:
            P_x = pos["P_e"] * (1.0 + x_liq_of(cfg.lev, pos["F"] / N, cfg.mmr))
            S_x = S_close[i] if ok[i] else pos["S_e"]
            events.append(dict(symbol=symbol, ts=t, kind="liquidation",
                               entry_ts=pos["entry_ts"], P_e=pos["P_e"],
                               P_liq=P_x, x_liq=P_x / pos["P_e"] - 1.0,
                               x_bar_high=P_high[i] / pos["P_e"] - 1.0))
            close_pos(i, "liquidation", P_x=P_x, S_x=S_x, liq=True)
        elif pos is not None and ok[i] and do_rc:
            n_rc = pos["n_rc"] + 1
            events.append(dict(symbol=symbol, ts=t, kind="recentre",
                               entry_ts=pos["entry_ts"],
                               x=P_high[i] / pos["P_e"] - 1.0))
            close_pos(i, "recentre")
            if last_state and not in_blackout:
                open_pos(i, "recentre")
                pos["n_rc"] = n_rc
        elif pos is not None and ok[i] and force_unwind:
            close_pos(i, "absent_bars")
        elif is_sol and pos is not None and tpd == SOL_LAST_BAR_BEFORE and ok[i]:
            close_pos(i, "sol_blackout")
        elif s is not None and ok[i] and not in_blackout:
            if pos is not None and not last_state:
                close_pos(i, "gate_off")
            elif pos is None and last_state:
                open_pos(i, "gate_on")

        # ---- 5. mark -------------------------------------------------------
        if pos is not None and ok[i]:
            unreal = (pos["q_s"] * (S_close[i] - pos["S_e"])
                      - pos["q_p"] * (P_close[i] - pos["P_e"]))
        elif pos is not None:
            unreal = eq[i - 1] - cfg.c_slot - realized if i > 0 else 0.0
        else:
            unreal = 0.0
        eq[i] = cfg.c_slot + realized + unreal

    if pos is not None:                     # §3.4: the window ends on a MARK
        p = pos
        positions.append(dict(
            symbol=symbol, entry_ts=p["entry_ts"], exit_ts=pd.NaT,
            why_in=p["why"], why_out="open_at_boundary", N=N,
            S_e=p["S_e"], P_e=p["P_e"], S_x=np.nan, P_x=np.nan,
            b_e=p["b_e"], b_x=np.nan, spot_pnl=np.nan, perp_pnl=np.nan,
            hedge_pnl=np.nan, hedge_basis=np.nan, funding=p["F"],
            fees=p["fees"], net=np.nan, gross=np.nan,
            n_settle=p["n_settle"], x_max=p["x_max"],
            hold_hours=np.nan, liquidated=False, n_rc_before=p["n_rc"]))

    eqf = pd.DataFrame(dict(ts=bar.ts, eq=eq,
                            open=[0.0] * len(bar)))
    # slot-days ON: a bar counts as ON if a position is open at its close
    opens = np.zeros(len(bar))
    for p in positions:
        a = p["entry_ts"]
        b = p["exit_ts"] if pd.notna(p["exit_ts"]) else bar.ts.iloc[-1]
        opens[(bar.ts.values > a) & (bar.ts.values <= b)] = 1.0
    eqf["open"] = opens
    return pd.DataFrame(positions), eqf, events
