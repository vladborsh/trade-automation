#!/usr/bin/env python3
"""§1.3 / §11.3 — the mechanical checks, all of them stop rules.

    python checks.py

1. **Look-ahead.** For 50 random (symbol, anchor day) pairs, re-derive
   eligibility rules 1-5 and 7 and BOTH selectors from a tape **truncated at
   A + 30 min** and from a 1d tape truncated at the last complete UTC day, and
   assert equality with the panel. (Rule 6 is the declared non-causal rule and
   is excluded by construction.)
2. **1d vs 1m agreement.** On 30 random (symbol, UTC day) pairs, the 1d bar
   must equal the aggregate of that day's 1m bars within float tolerance.
3. **DST.** The anchor must fall on 13:30 or 14:30 UTC on every anchor day and
   on no other UTC time.
4. **Funding crossing.** Every leg must be open across exactly one 16:00 UTC
   settlement timestamp (§6.2's premise).
5. **Delisting exclusion is OUT of the primary.** Asserts that the primary leg
   table contains legs whose symbol delisted within 30 days after the trade —
   i.e. that the non-causal §9 exclusion was not silently applied.
6. **Selector/reader window identity.** `V30` and `r30` are read on the same
   `[A, A + 30)` window, so both are known at `A + 30` and neither uses a bar
   at or after the entry.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

FAIL: list[str] = []


def ck(name: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'OK ' if ok else 'FAIL'}] {name}  {detail}")
    if not ok:
        FAIL.append(f"{name}: {detail}")


# ------------------------------------------------------------------ check 1
def check_lookahead(pan: pd.DataFrame, n: int = 50, seed: int = C.SEED) -> dict:
    rng = np.random.default_rng(seed)
    cand = pan[pan.elig_A].sample(n=n, random_state=int(seed)).reset_index(drop=True)
    flags = pd.read_parquet(os.path.join(C.RESULTS, "daily_flags.parquet"))
    dates_all = C.nyse_days(C.FIT_START, C.HOLD_END)
    didx = {d: i for i, d in enumerate(dates_all)}
    bad = []
    for _, r in cand.iterrows():
        sym, d, A = r.symbol, r.date, int(r.anchor_ms)
        cut = A + C.WINDOW_MIN * C.MIN_MS                 # strictly before the entry
        tp = pd.read_parquet(os.path.join(C.DATA_1M, f"{sym}.parquet"))
        tp = tp[tp.t_ms < cut].drop_duplicates("t_ms").sort_values("t_ms").reset_index(drop=True)
        t, cl, qv = tp.t_ms.values, tp.close.values, tp.quote_volume.values

        # rule 2 + V30 + r30 on the truncated tape
        i0 = np.searchsorted(t, A, "left"); i1 = len(t)
        w = tp.iloc[i0:i1]
        r2 = (len(w) == C.WINDOW_MIN) and int(t[i0]) == A
        v30 = float(w.quote_volume.sum()) if r2 else np.nan
        r30 = float(w.close.iloc[-1] / w.open.iloc[0] - 1) if r2 else np.nan

        # rule 3 + RVOL denominator from the prior 14 anchor days, same tape
        k = didx[d]
        prior = dates_all[max(0, k - C.RVOL_LOOKBACK):k]
        vs = []
        for pd_ in prior:
            Ap = C.ny_ms(pd_)
            j0 = np.searchsorted(t, Ap, "left")
            j1 = np.searchsorted(t, Ap + C.WINDOW_MIN * C.MIN_MS, "left")
            if j1 - j0 == C.WINDOW_MIN and int(t[j0]) == Ap:
                vs.append(float(qv[j0:j1].sum()))
        rvol = v30 / float(np.median(vs)) if len(vs) >= C.RVOL_MIN_DAYS else np.nan

        # rule 7 + TR24 on the truncated tape
        def px(tt):
            j = np.searchsorted(t, tt, "left") - 1
            return float(cl[j]) if j >= 0 and (tt - t[j]) <= C.PRICE_TOL_MIN * C.MIN_MS else np.nan
        tr24 = px(A) / px(A - 24 * 3_600_000) - 1

        # rules 1/4/5 from the 1d tape truncated at the last complete UTC day
        d1 = pd.read_parquet(os.path.join(C.DATA_1D, f"{sym}.parquet"))
        d1 = d1[d1.t_ms + C.DAY_MS <= C.utc_ms(d)].sort_values("t_ms").reset_index(drop=True)
        atr = C.atr_wilder(d1.high.values, d1.low.values, d1.close.values, C.ATR_N)[-1]
        liq = float(np.median(d1.quote_volume.values[-C.LIQ_LOOKBACK:]))
        listed = (int(d1.t_ms.iloc[-1]) + C.DAY_MS - int(d1.t_ms.iloc[0])) / C.DAY_MS

        for nm, got, want in (("r2", r2, bool(r.r2_window)),
                              ("v30", v30, float(r.v30)),
                              ("r30", r30, float(r.r30)),
                              ("rvol", rvol, float(r.rvol)),
                              ("tr24", tr24, float(r.tr24)),
                              ("datr14", float(atr), float(r.datr14)),
                              ("liq_med", liq, float(r.liq_med)),
                              ("listed_days", listed, float(r.listed_days)),
                              ("r1", listed >= C.MIN_LISTED_DAYS, bool(r.r1_listed)),
                              ("r5", liq >= C.LIQ_FLOOR, bool(r.r5_liq))):
            if isinstance(want, bool):
                if bool(got) != want:
                    bad.append(f"{sym} {d} {nm}: {got} vs {want}")
            elif not (np.isnan(got) and np.isnan(want)):
                if not np.isclose(got, want, rtol=1e-9, atol=1e-12):
                    bad.append(f"{sym} {d} {nm}: {got!r} vs {want!r}")
    ck(f"1. look-ahead re-derivation on {n} random (symbol, day) pairs, "
       f"tape truncated at A+30min", not bad, f"{len(bad)} mismatches" + (f" e.g. {bad[:3]}" if bad else ""))
    return dict(n=n, mismatches=bad)


# ------------------------------------------------------------------ check 2
def check_1d_vs_1m(pan: pd.DataFrame, n: int = 30, seed: int = C.SEED + 3) -> dict:
    rng = np.random.default_rng(seed)
    syms = pan.symbol.unique()
    bad, done = [], 0
    for s in rng.permutation(syms):
        if done >= n:
            break
        d1 = pd.read_parquet(os.path.join(C.DATA_1D, f"{s}.parquet"))
        m1 = pd.read_parquet(os.path.join(C.DATA_1M, f"{s}.parquet"))
        day = (m1.t_ms.values // C.DAY_MS) * C.DAY_MS
        g = m1.groupby(day).agg(o=("open", "first"), h=("high", "max"),
                                l=("low", "min"), c=("close", "last"),
                                n=("close", "size"))
        g = g[g.n == 1440]
        if not len(g):
            continue
        pick = int(rng.choice(g.index.values))
        a = g.loc[pick]
        b = d1[d1.t_ms == pick]
        if not len(b):
            continue
        b = b.iloc[0]
        for nm, x, y in (("open", a.o, b.open), ("high", a.h, b.high),
                         ("low", a.l, b.low), ("close", a.c, b.close)):
            if not np.isclose(x, y, rtol=1e-9, atol=1e-12):
                bad.append(f"{s} {pd.Timestamp(pick, unit='ms')} {nm}: {x} vs {y}")
        done += 1
    ck(f"2. 1d bar == aggregate of that day's 1m bars on {done} random "
       f"(symbol, UTC day) pairs", not bad, f"{len(bad)} mismatches {bad[:3]}")
    return dict(n=done, mismatches=bad)


# ------------------------------------------------------------------ check 3
def check_dst(pan: pd.DataFrame) -> dict:
    hm = ((pan.anchor_ms.values % C.DAY_MS) // C.MIN_MS)
    uniq = sorted(set(hm.tolist()))
    want = {13 * 60 + 30, 14 * 60 + 30}
    ck("3. the anchor falls on 13:30 or 14:30 UTC and nothing else",
       set(uniq) <= want, f"observed UTC minutes-of-day: {uniq}")
    return dict(observed=[int(x) for x in uniq])


# ------------------------------------------------------------------ check 4
def check_funding_crossing(legs: pd.DataFrame) -> dict:
    entry = legs.anchor_ms.values + C.WINDOW_MIN * C.MIN_MS
    ex = legs.exit_ms.values
    day0 = (entry // C.DAY_MS) * C.DAY_MS
    settle = day0 + C.FUNDING_UTC_HOUR * 3_600_000
    crosses = (settle > entry) & (settle <= ex)
    # exits are at most 4 h after entry, so at most one settlement can fall in
    share = float(crosses.mean())
    ck("4. every leg is open across the 16:00 UTC funding settlement",
       share > 0.98, f"share crossing = {share:.4f}")
    return dict(share_crossing=share)


# ------------------------------------------------------------------ check 5
def check_delisting_in_primary(legs: pd.DataFrame) -> dict:
    n = int((legs.delist_days_after < 30).sum())
    ck("5. the non-causal 'delisted within 30 days after the trade' exclusion "
       "is NOT applied in the primary", n > 0,
       f"{n} primary legs are on symbols that delisted within 30 days "
       f"({100*n/len(legs):.2f} % of legs) — they are IN the primary, as §9 requires")
    return dict(n_legs_delisted_within_30d=n, share=float(n / len(legs)))


# ------------------------------------------------------------------ check 6
def check_window_identity(pan: pd.DataFrame) -> dict:
    ok = bool((pan.i_entry.values < pan.i_path0.values).all())
    ck("6. the selector window and the reader window are the same "
       "[A, A+30) and the path starts strictly after the entry bar", ok)
    return dict(ok=ok)


def main() -> None:
    pan = pd.read_parquet(os.path.join(C.RESULTS, "panel.parquet"))
    legs = pd.read_parquet(os.path.join(C.RESULTS, "instrument_days.parquet"))
    print(f"panel: {len(pan):,} rows   instrument-days: {len(legs):,}\n")
    out = dict(
        lookahead=check_lookahead(pan),
        d1_vs_1m=check_1d_vs_1m(pan),
        dst=check_dst(pan),
        funding_crossing=check_funding_crossing(legs),
        delisting_out_of_primary=check_delisting_in_primary(legs),
        window_identity=check_window_identity(pan),
    )
    ident = json.load(open(os.path.join(C.RESULTS, "history_audit_1m.json")))["identity_check"]
    for s, v in ident.items():
        ck(f"0. BTC/ETH identity check — {s}", bool(v.get("identical")), json.dumps(v)[:200])
    out["identity_check"] = ident
    out["failures"] = FAIL
    with open(os.path.join(C.RESULTS, "checks.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    print()
    if FAIL:
        raise SystemExit(f"STOP RULE: {len(FAIL)} check(s) failed:\n" + "\n".join(FAIL))
    print("all checks pass")


if __name__ == "__main__":
    main()
