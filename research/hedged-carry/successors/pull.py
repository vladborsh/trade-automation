import os, sys, json, time
from concurrent.futures import ThreadPoolExecutor
import pandas as pd
sys.path.insert(0, '/Users/Vladyslav_Borsh/orca/workspaces/trade_automation/architect-carry-next/research/crosssec-instruments-in-play/prep')
import fetch as F
S = os.path.dirname(os.path.abspath(__file__))
u = pd.read_csv('/Users/Vladyslav_Borsh/orca/workspaces/trade_automation/architect-carry-next/research/crosssec-instruments-in-play/results/universe.csv')
u = u[u.n_days >= 400]
def one(sym):
    try:
        outf = f'{S}/data/funding/{sym}.parquet'; outd = f'{S}/data/1d/{sym}.parquet'
        if not os.path.exists(outf):
            months = F.list_months(sym, 'fundingRate')
            with ThreadPoolExecutor(max_workers=8) as ex:
                parts = list(ex.map(lambda ym: F.fetch_funding(sym, ym), months))
            F.norm_funding(parts).to_parquet(outf, index=False)
        if not os.path.exists(outd):
            months = F.list_months(sym, 'klines', '1d')
            with ThreadPoolExecutor(max_workers=8) as ex:
                parts = list(ex.map(lambda ym: F.fetch_klines(sym, ym, '1d'), months))
            F.norm_klines(parts).to_parquet(outd, index=False)
        return sym, 'ok'
    except Exception as e:
        return sym, f'err {e}'
t0 = time.time(); rows = []
with ThreadPoolExecutor(max_workers=8) as ex:
    for i, r in enumerate(ex.map(one, list(u.symbol))):
        rows.append(r)
        if (i+1) % 25 == 0: print(i+1, f'{time.time()-t0:.0f}s', flush=True)
json.dump(rows, open(f'{S}/pull_audit.json','w'), indent=1)
print('done', sum(r[1]=='ok' for r in rows), len(rows), f'{time.time()-t0:.0f}s')
