import pandas as pd, numpy as np
pd.set_option('display.width', 260)
f = pd.read_csv('results/mom_scan_fit.csv')
print("configs scanned (fit):", len(f))
print("\n--- fit: any config meeting BOTH targets? ---")
b = f[(f.profit_factor > 1.2) & (f.win_rate > 0.5)]
print(b[['candidate','z','stop_atr','mom_rr','time_stop','trades','win_rate','profit_factor']].to_string(index=False) if len(b) else "NONE of %d" % len(f))
print("\n--- fit: PF>1.1 ---")
print(f[f.profit_factor>1.1][['candidate','z','stop_atr','mom_rr','time_stop','trades','win_rate','profit_factor','symbols_pf_gt_1']].to_string(index=False,float_format=lambda x:f"{x:6.3f}"))
print("\n--- fit: best PF at each reward:risk (shows the WR/PF trade-off) ---")
g = f.groupby(['candidate','mom_rr']).agg(best_pf=('profit_factor','max'),
      wr_at_best=('win_rate', lambda s: s.loc[f.loc[s.index,'profit_factor'].idxmax()]),
      max_wr=('win_rate','max'),
      pf_at_max_wr=('profit_factor', lambda s: s.loc[f.loc[s.index,'win_rate'].idxmax()]),
      med_pf=('profit_factor','median'), med_wr=('win_rate','median'))
print(g.to_string(float_format=lambda x:f"{x:7.3f}"))
print("\n--- fit: configs with WR>50%, ranked by PF ---")
w = f[f.win_rate>0.50].sort_values('profit_factor',ascending=False)
print(w.head(10)[['candidate','z','stop_atr','mom_rr','time_stop','trades','win_rate','profit_factor','symbols_pf_gt_1']].to_string(index=False,float_format=lambda x:f"{x:6.3f}"))
print(f"\nconfigs with WR>50%: {len(w)} / {len(f)}; best PF among them: {w.profit_factor.max():.3f}")
try:
    h = pd.read_csv('results/mom_scan_holdout.csv')
    print("\n--- fit-selected configs, holdout ---")
    print(h[['candidate','pick','period','z','stop_atr','mom_rr','time_stop','trades','win_rate','profit_factor','sharpe','max_dd','symbols_pf_gt_1']].to_string(index=False,float_format=lambda x:f"{x:6.3f}"))
except FileNotFoundError:
    print("\n(holdout not written yet)")
