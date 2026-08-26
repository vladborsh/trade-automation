#!/usr/bin/env python3
"""Smoke test for the §5.4 permutation-control helpers.

Stage 1 gated stage 2 out, so the nulls were never run as a protocol step. This
just proves the two helpers execute and do what they claim, so a future pass can
pick them up: the random-direction control must preserve the bias regimes' extent
while randomising their sign, and the random-zone control must preserve every
zone's width and lifetime while displacing it.
"""
import numpy as np
import common as C, mtf, prep

d = prep.get("BTCUSDT").iloc[:120000].reset_index(drop=True)
rng = np.random.default_rng(20260826)

hb = d.h1_bias.to_numpy()
nb = mtf.random_direction_bias(hb, rng)
segs_t = mtf.bias_segments(hb); segs_n = mtf.bias_segments(nb)
print(f"random-direction: true bias regimes {len(segs_t)}, "
      f"zero-bars preserved {bool(((hb == 0) == (nb == 0)).all())}, "
      f"sign flipped on {float((hb != nb)[hb != 0].mean()):.0%} of non-zero bars")
sa = mtf.variant_a(d, mtf.P); sn = mtf.variant_a(d, mtf.P, bias_override=nb)
print(f"                  variant A signals: true {int((sa.sig!=0).sum())} vs null {int((sn.sig!=0).sum())}")

z = mtf.zone_bands(d, mtf.P); ident = mtf.zone_identity(d)
zn = mtf.offset_zones(z, ident, d.h1_atr.to_numpy(), rng)
for k in z:
    w1 = z[k][1] - z[k][0]; w2 = zn[k][1] - zn[k][0]
    assert np.allclose(w1[~np.isnan(w1)], w2[~np.isnan(w2)]), k
    assert bool((np.isnan(z[k][0]) == np.isnan(zn[k][0])).all()), k
print("random-zone:      widths and lifetimes preserved for all 6 (type,dir) slots")
sb = mtf.variant_b(d, mtf.P, "sweep")
sbn = mtf.variant_b(d, mtf.P, "sweep", zones=zn, ident=ident)
print(f"                  variant B signals: true {int((sb.sig!=0).sum())} vs null {int((sbn.sig!=0).sum())}")
