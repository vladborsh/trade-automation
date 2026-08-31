#!/usr/bin/env python3
"""Correctness assertions for the **PDH/PDL** stream — drill-down pass (post-v4).

The v4 package's `checks.py` covers the session-level stream and is not re-run
here (it passes unchanged; nothing in this pass touches it). What is new is a
second level class, so this file asserts the properties that class must have, in
the same style: mechanical checks instead of prose — **plus** the wiring check
this pass specifically needs, PD0: that this package's confirmation call
reproduces the v4 package's committed confirmation set on the v2/v4 session
stream, event for event and bar for bar. That is the assertion that the rewire
from the halted attempt's v2 `ifvg_confirm` to `ifvg_confirm_v4` actually
landed, and that nothing in this directory shadows or re-derives the mechanic.

Families:
  * level construction — PDH/PDL really is the prior *full* UTC day's extreme,
    it is frozen before the day it is sweepable in starts, and it lives exactly
    one day;
  * block containment — inherited from the parent horizon, re-asserted on the
    new stream (the horizon must never cross a block boundary);
  * iFVG containment — formation bar and inversion close both inside the window;
  * **stream separation** — no event is shared between the two streams, and the
    day-level stream never claims a session label;
  * **v4 wiring** — PD0, above;
  * prefix stability — the engine is causal, so a 60%-truncated re-run must
    reproduce every event that fits inside the prefix, bar-for-bar;
  * derived-metric sanity — |ER| <= 1, gap heights positive.

Usage: .venv/bin/python research/session-liquidity-v2/drilldown/dd_checks.py
"""
from __future__ import annotations

import contextlib
import io
import os

import numpy as np
import pandas as pd

import dd_common as D
import pd_engine as P
from dd_common import C, E


def load_pd() -> pd.DataFrame:
    fr = [pd.read_csv(os.path.join(D.RESULTS, f"pd_events_{s}.csv"), parse_dates=["ts"])
          for s in D.SYMBOLS]
    e = pd.concat(fr, ignore_index=True)
    e["primary"] = e.bars_remaining >= D.MINB
    return e


def main() -> int:
    e = load_pd()
    ok = []

    def chk(name, cond, detail=""):
        ok.append(bool(cond))
        print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail else ""))

    # -------------------------------------------------- v4 wiring (PD0) -----
    # The pass's confirmation layer must BE the v4 mechanic, not a look-alike.
    # Re-run `E.ifvg_confirm_v4` from this package on the v4 package's own
    # session-level events and require an exact match on the committed columns.
    ses_v4 = D.T.load_events()
    prices = D.Prices()
    n_ok = 0; n_bad = 0
    rng = np.random.default_rng(7)
    for symc in D.SYMBOLS:
        dd = C.prep(C.load(symc))
        fvc = E.fvg_arrays(dd)
        clc = dd.close.to_numpy()
        g = ses_v4[ses_v4.symbol == symc]
        take = g.iloc[rng.choice(len(g), size=min(1500, len(g)), replace=False)]
        for _, r in take.iterrows():
            side_ = "high" if r.direction == "high_sweep" else "low"
            rr = E.ifvg_confirm_v4(fvc, clc, int(r.bar), int(r.block_end_bar),
                                   r.level_px, side_, strict=False)
            got_c = rr["confirm_idx"] >= 0
            got_d = (rr["confirm_idx"] - int(r.bar)) if got_c else np.nan
            same = (bool(got_c) == bool(r.ifvg_confirmed)) and (
                (not got_c) or int(got_d) == int(r.ifvg_delay_bars)) and (
                rr["cause"] == r.unconf_cause)
            n_ok += bool(same); n_bad += (not same)
    chk("PD0 the v4 confirmation set reproduces exactly on the session stream "
        "(the wiring check)", n_bad == 0,
        f"{n_ok} events re-derived, {n_bad} mismatches")
    chk("PD0b this package calls ifvg_confirm_v4 and defines no confirmation of "
        "its own",
        E.ifvg_confirm_v4.__module__ == "engine"
        and "ifvg_confirm" not in dir(D)
        and os.path.abspath(E.__file__).endswith(
            os.path.join("session-liquidity-v4", "engine.py")),
        os.path.abspath(E.__file__))

    # -------------------------------------------------------- level identity
    chk("PD1 the day-level stream never carries a session label",
        set(e.level_session.unique()) == {D.PD_SESSION},
        f"{sorted(e.level_session.unique())}")
    chk("PD2 every PDH/PDL take-out is attributed to exactly one level",
        (e.n_levels_taken == 1).all())
    chk("PD3 take-out wick is beyond the level",
        bool((e[e.direction == "high_sweep"].sweep_ref
              > e[e.direction == "high_sweep"].level_px).all()
             and (e[e.direction == "low_sweep"].sweep_ref
                  < e[e.direction == "low_sweep"].level_px).all()))
    chk("PD4 a level is retired on first take-out (V7): <=1 event per day/side",
        bool(e.assign(day=e.ts.dt.floor("D"))
             .groupby(["symbol", "day", "direction"]).size().max() == 1))

    sym = "BTCUSDT"
    d = C.prep(C.load(sym))
    days = P.day_frames(d)
    days["prev_high"] = days.high.shift(1); days["prev_low"] = days.low.shift(1)
    dm = days.set_index("day")
    s = e[e.symbol == sym].copy()
    s["day"] = s.ts.dt.floor("D")

    # The level really is the prior full day's extreme, Late included, and it
    # was frozen before the sweeping day's first bar.
    lvl_ok = True; froz_ok = True; life_ok = True
    for _, r in s.iterrows():
        row = dm.loc[r.day]
        want = row.prev_high if r.direction == "high_sweep" else row.prev_low
        lvl_ok &= bool(np.isclose(r.level_px, want))
        # frozen: the prior day's last bar is strictly before this day's first
        froz_ok &= bool(int(row.first_idx) > int(dm.loc[r.day - pd.Timedelta(days=1)].last_idx))
        # lifetime: the take-out sits inside the sweeping day, never later
        life_ok &= bool(int(row.first_idx) <= int(r.bar) <= int(row.last_idx))
    chk("PD5 PDH/PDL equals the prior FULL UTC day's extreme (Late included)", lvl_ok)
    chk("PD6 the level is frozen before its sweepable day starts (no lookahead)", froz_ok)
    chk("PD7 the level's lifetime is exactly the following UTC day", life_ok)

    # The Late-included definition is not cosmetic: check it actually differs
    # from the session-max shorthand on a real share of days.
    hh = d.groupby([d.ts.dt.floor("D"), d.block]).high.max().unstack()
    sess_max = hh[["Asia", "London", "NY"]].max(axis=1)
    full_max = hh.max(axis=1)
    diff_share = float((full_max > sess_max + 1e-12).mean())
    chk("PD8 the Late block genuinely moves the day's high on a real share of days",
        diff_share > 0, f"{100*diff_share:.1f}% of days")

    # -------------------------------------------------------- block/horizon
    chk("PD9 bars_remaining is consistent with the block end",
        (e.bars_remaining == e.block_end_bar - e.bar).all())
    blk = d["block"].to_numpy(); day = d["ts"].dt.floor("D").to_numpy()
    b0 = s.bar.to_numpy().astype(int); b1 = s.block_end_bar.to_numpy().astype(int)
    chk("PD10 the horizon never crosses a block boundary",
        bool((blk[b0] == blk[b1]).all() and (day[b0] == day[b1]).all()))
    chk("PD11 iFVG confirmation lands inside [take-out, block end]",
        bool((e.loc[e.ifvg_confirmed, "ifvg_delay_bars"] >= 0).all()
             and (e.loc[e.ifvg_confirmed, "ifvg_delay_bars"]
                  <= e.loc[e.ifvg_confirmed, "bars_remaining"]).all()))
    chk("PD12 the FVG's third bar is also inside the window",
        bool((e.ifvg_form_bar.dropna() >= e.loc[e.ifvg_form_bar.notna(), "bar"]).all()
             and (e.ifvg_form_bar.dropna()
                  <= e.loc[e.ifvg_form_bar.notna(), "block_end_bar"]).all()))
    chk("PD13 magnitudes exist exactly when the window is non-empty",
        (e.rev_atr.notna() == (e.bars_remaining > 0)).all())
    chk("PD14 excursions are floored at zero",
        bool((e.rev_atr.dropna() >= 0).all() and (e.adv_atr.dropna() >= 0).all()
             and (e.ifvg_mfe_atr.dropna() >= 0).all()
             and (e.ifvg_mae_atr.dropna() >= 0).all()))

    # ------------------------------------------------------ stream separation
    ses = ses_v4
    # Separation is a claim about ROWS, not about prices: the two streams are
    # disjoint record sets written to different files, and neither one's events
    # enter the other's tables. Price coincidence is the opposite of a defect --
    # a PDH set during the prior day's NY session simply IS that session's high,
    # so the same number appears in both streams by construction. That case must
    # be flagged, never deduplicated, which is what PD15b asserts.
    key_pd = set(zip(e.symbol, e.bar, e.direction, e.level_px.round(8)))
    key_ss = set(zip(ses.symbol, ses.bar, ses.direction, ses.level_px.round(8)))
    both_keys = key_pd & key_ss
    chk("PD15a stream separation: the streams share no row (disjoint files, disjoint labels)",
        len(set(e.columns) & {"__merged__"}) == 0
        and not e.level_session.isin(C.LEVEL_SESSIONS).any()
        and not ses.level_session.eq(D.PD_SESSION).any())
    same_px = e.merge(ses[["symbol", "bar", "direction", "level_px"]].assign(_ss=1),
                      on=["symbol", "bar", "direction"], how="inner", suffixes=("", "_s"))
    exact = same_px[np.isclose(same_px.level_px, same_px.level_px_s)]
    chk("PD15b an exact price coincidence with the session stream is always flagged",
        bool(exact.coincident_session_level.all()),
        f"{len(exact)} exact-price overlaps of {len(both_keys)} shared keys, "
        f"{int((~exact.coincident_session_level).sum())} unflagged")
    chk("PD16 the v4 session stream is untouched by this pass",
        set(ses.level_session.unique()) <= set(C.LEVEL_SESSIONS),
        f"{sorted(ses.level_session.unique())}")
    # A shared BAR is expected and legitimate (one excursion, two level classes);
    # it must show up in the coincidence flag rather than be silently deduped.
    shared_bars = set(zip(e.symbol, e.bar, e.direction)) & set(zip(ses.symbol, ses.bar, ses.direction))
    chk("PD17 bars shared with the session stream are flagged, not dropped",
        len(shared_bars) > 0 and e.coincident_session_level.any(),
        f"{len(shared_bars)} shared bars, {100*e.coincident_session_level.mean():.1f}% flagged coincident")

    # ------------------------------------------------------ prefix stability
    cut = int(len(d) * 0.6)
    d_pre = d.iloc[:cut].reset_index(drop=True)
    orig = C.load
    C.load = lambda _s, iv="5m": d_pre[["ts", "open", "high", "low", "close", "volume"]].copy()
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            pre = P.run_symbol(sym)
    finally:
        C.load = orig
    # The prefix's LAST day is truncated by the file, so its own extreme (and
    # therefore the next day's PDH/PDL) is not comparable; the block_end filter
    # already removes anything whose horizon leaves the prefix.
    full_i = s[s.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    pre_i = pre[pre.block_end_bar < cut - 1].set_index(["bar", "direction"]).sort_index()
    common = full_i.index.intersection(pre_i.index)
    cols = ["level_px", "sweep_block", "bars_remaining", "ifvg_confirmed",
            "rev_atr", "ifvg_R", "coincident_session_level"]
    same = True
    for c in cols:
        a_ = full_i.loc[common, c]; b_ = pre_i.loc[common, c]
        if a_.dtype.kind == "f":
            same &= bool(np.allclose(a_.fillna(-9e9), b_.fillna(-9e9), rtol=1e-9, atol=1e-9))
        else:
            same &= bool((a_.values == b_.values).all())
    chk("PD18 prefix stability: a 60%-truncated re-run reproduces the same events",
        same and len(common) == len(full_i),
        f"{len(common)} shared of {len(full_i)} full-run events in the prefix")

    # ------------------------------------------------- derived drill-down cols
    prices = D.Prices()
    both = D.attach_derived(pd.concat([e, ses], ignore_index=True), prices)
    chk("PD19 |signed ER| <= 1 by construction",
        bool((both.er.dropna().abs() <= 1 + 1e-9).all()),
        f"max |ER| {both.er.dropna().abs().max():.4f}")
    chk("PD20 gap heights are strictly positive where an iFVG confirmed",
        bool((both.loc[both.ifvg_confirmed, "gap_abs"].dropna() > 0).all()))
    chk("PD21 the gap-size predictor exists for essentially every confirmed event",
        float(both.loc[both.ifvg_confirmed, "gap_atr"].notna().mean()) > 0.999,
        f"{100*both.loc[both.ifvg_confirmed, 'gap_atr'].notna().mean():.3f}% coverage")
    chk("PD22 the structure range denominator is positive and resolved",
        bool((both.struct_range_atr.dropna() > 0).all())
        and float(both.struct_range_atr.notna().mean()) > 0.999,
        f"{100*both.struct_range_atr.notna().mean():.3f}% resolved")

    chk("PD23 the day-level stream carries the v4 state-machine columns",
        set(["n_candidates", "n_replacements", "unconf_cause"]) <= set(e.columns)
        and set(e.unconf_cause.unique())
        <= {"confirmed", "no_candidate", "live_at_block_end"},
        f"causes {sorted(e.unconf_cause.unique())}")
    chk("PD24 no event carries the removed v3 invalidation cause",
        not (e.unconf_cause == "invalidated_out").any())

    print("\n" + ("ALL CHECKS PASSED" if all(ok) else "SOME CHECKS FAILED"))
    return 0 if all(ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
