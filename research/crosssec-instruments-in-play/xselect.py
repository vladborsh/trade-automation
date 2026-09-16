"""§8.2.3 (the note calls this file `select.py`; renamed `xselect.py` because
`select` is a Python stdlib module) — cross-sectional ranking and selection.

Pure index work on top of `results/instrument_days.parquet`: the leg outcome
of every eligible instrument-day is already known, so a selection is a set of
row positions. Top-k, bottom-k, middle-k, deciles, the random-k null, the
day-shift null and every sensitivity are all built here from the same index.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import common as C


class Panel:
    """Per-day eligible sets and ranking values, for one selector."""

    def __init__(self, legs: pd.DataFrame, selector: str):
        self.legs = legs.reset_index(drop=True)
        self.selector = selector
        if selector == "RVOL":
            key = self.legs.rvol.values.astype(float)
            ok = np.isfinite(key)
        elif selector == "TR24":
            key = np.abs(self.legs.tr24.values.astype(float))
            ok = np.isfinite(key)
        elif selector.startswith("TR"):                     # fit-only 12h/48h
            col = "tr12" if selector == "TR12" else "tr48"
            key = np.abs(self.legs[col].values.astype(float))
            ok = np.isfinite(key)
        else:
            raise ValueError(selector)
        self.key = key
        self.ok = ok
        self.tie = self.legs.v30.values.astype(float)       # §2.1/§2.2 tiebreak
        self.date = self.legs.date.values
        # per-day row positions, ranked once, descending by (key, v30)
        order = np.lexsort((-self.tie, -self.key, self.date))
        d = self.date[order]
        keep = self.ok[order]
        order, d = order[keep], d[keep]
        starts = np.concatenate([[0], np.where(d[1:] != d[:-1])[0] + 1])
        ends = np.concatenate([starts[1:], [len(d)]])
        self.days = d[starts]
        self.ranked = [order[a:b] for a, b in zip(starts, ends)]
        self.n_elig = np.array([len(r) for r in self.ranked])

    # ------------------------------------------------------------ selections
    def tradable(self, min_n: int = C.N_ELIG_MIN) -> np.ndarray:
        return self.n_elig >= min_n

    def _sel(self, which: str, k: int, min_n: int) -> tuple[np.ndarray, np.ndarray]:
        """Row positions of the selected legs and their day index."""
        idx, dayi = [], []
        for j, r in enumerate(self.ranked):
            if len(r) < min_n:
                continue
            if which == "top":
                s = r[:k]
            elif which == "bottom":
                s = r[-k:]
            elif which == "middle":
                m = len(r) // 2
                s = r[max(0, m - k // 2):max(0, m - k // 2) + k]
            else:
                raise ValueError(which)
            idx.append(s)
            dayi.append(np.full(len(s), j))
        if not idx:
            return np.array([], int), np.array([], int)
        return np.concatenate(idx), np.concatenate(dayi)

    def top(self, k=C.K_SELECT, min_n=C.N_ELIG_MIN):
        return self._sel("top", k, min_n)

    def bottom(self, k=C.K_SELECT, min_n=C.N_ELIG_MIN):
        return self._sel("bottom", k, min_n)

    def middle(self, k=C.K_SELECT, min_n=C.N_ELIG_MIN):
        return self._sel("middle", k, min_n)

    def threshold(self, thr: float, cap: int = 10, min_n=C.N_ELIG_MIN):
        """Fit-only §8.2.3 sensitivity: every leg with key >= thr, capped."""
        idx, dayi = [], []
        for j, r in enumerate(self.ranked):
            if len(r) < min_n:
                continue
            s = r[self.key[r] >= thr][:cap]
            if len(s):
                idx.append(s)
                dayi.append(np.full(len(s), j))
        if not idx:
            return np.array([], int), np.array([], int)
        return np.concatenate(idx), np.concatenate(dayi)

    def deciles(self, min_n=C.N_ELIG_MIN) -> pd.DataFrame:
        """§2.4 dose-response: mean net R by decile of the ranking variable,
        deciles cut per day, over ALL eligible instrument-days."""
        rows = []
        net = self.legs.netR.values
        for j, r in enumerate(self.ranked):
            if len(r) < min_n:
                continue
            n = len(r)
            # rank 0 = highest key -> decile 9 (top)
            dec = 9 - np.minimum((np.arange(n) * 10) // n, 9)
            rows.append(pd.DataFrame(dict(date=self.days[j], decile=dec,
                                          netR=net[r], row=r)))
        return pd.concat(rows, ignore_index=True)

    # ----------------------------------------------------------------- nulls
    def random_k(self, k=C.K_SELECT, n_draws=C.N_RANDOM_K, min_n=C.N_ELIG_MIN,
                 seed=C.SEED) -> np.ndarray:
        """Null A (§2.3): mean net R of each of `n_draws` random-k streams."""
        rng = np.random.default_rng(seed)
        net = self.legs.netR.values
        pools = [net[r] for j, r in enumerate(self.ranked) if len(r) >= min_n]
        out = np.empty(n_draws)
        for j in range(n_draws):
            tot, cnt = 0.0, 0
            for p in pools:
                s = rng.choice(len(p), k, replace=False)
                tot += p[s].sum()
                cnt += k
            out[j] = tot / cnt
        return out

    def day_shift(self, k=C.K_SELECT, n_draws=C.N_DAYSHIFT, min_n=C.N_ELIG_MIN,
                  seed=C.SEED + 1) -> np.ndarray:
        """Null B (§2.3): day d trades the set selected on day d - j, symbols
        not eligible on d dropped."""
        rng = np.random.default_rng(seed)
        net = self.legs.netR.values
        sym = self.legs.symbol.values
        live = [np.array([], int)] * len(self.ranked)
        sets = []
        for j, r in enumerate(self.ranked):
            live[j] = r
            sets.append(sym[r[:k]] if len(r) >= min_n else None)
        pos = {}
        for j, r in enumerate(self.ranked):
            pos[j] = dict(zip(sym[r], r))
        ok = [j for j in range(len(self.ranked)) if len(self.ranked[j]) >= min_n]
        out = np.empty(n_draws)
        for t in range(n_draws):
            shift = int(rng.integers(1, 251))
            tot, cnt = 0.0, 0
            for a, j in enumerate(ok):
                src = ok[a - shift] if a - shift >= 0 else None
                if src is None or sets[src] is None:
                    continue
                for s in sets[src]:
                    if s in pos[j]:
                        tot += net[pos[j][s]]
                        cnt += 1
            out[t] = tot / cnt if cnt else np.nan
        return out
