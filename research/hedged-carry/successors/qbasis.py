import os, sys, io, zipfile, json
import numpy as np, pandas as pd
from urllib.request import urlopen
from urllib.error import HTTPError
from concurrent.futures import ThreadPoolExecutor
S=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,'/Users/Vladyslav_Borsh/orca/workspaces/trade_automation/architect-carry-next/research/crosssec-instruments-in-play/prep')
import fetch as F
KL=["open_time","open","high","low","close","volume","close_time","quote_volume","n","tbb","tbq","ignore"]
def get_zip(url):
    try: raw=urlopen(url,timeout=120).read()
    except HTTPError: return None
    z=zipfile.ZipFile(io.BytesIO(raw)); n=z.namelist()[0]
    df=pd.read_csv(z.open(n),header=None,names=KL)
    df=df[pd.to_numeric(df.open_time,errors='coerce').notna()]
    df['open_time']=df.open_time.astype('int64'); df.loc[df.open_time>10**14,'open_time']//=1000
    return df[['open_time','open','high','low','close','volume']].astype(float)
def spot_1d(sym):
    out=f'{S}/q/spot_{sym}.parquet'
    if os.path.exists(out): return pd.read_parquet(out)
    months=[f'{y}-{m:02d}' for y in range(2020,2027) for m in range(1,13) if (y,m)<=(2026,8)]
    with ThreadPoolExecutor(8) as ex:
        parts=list(ex.map(lambda ym:get_zip(f'https://data.binance.vision/data/spot/monthly/klines/{sym}/1d/{sym}-1d-{ym}.zip'),months))
    df=pd.concat([p for p in parts if p is not None]).drop_duplicates('open_time').sort_values('open_time'); df.to_parquet(out,index=False); return df
def quarterlies(base):
    out=f'{S}/q/q_{base}.parquet'
    if os.path.exists(out): return pd.read_parquet(out)
    rows=[]
    for e in ['210326','210625','210924','211231','220325','220624','220930','221230','230331','230630','230929','231229','240329','240628','240927','241227','250328','250627','250926','251226','260327','260626','260925','261225']:
        sym=f'{base}_{e}'
        months=F.list_months(sym,'klines','1d')
        with ThreadPoolExecutor(8) as ex:
            parts=list(ex.map(lambda ym:get_zip(f'https://data.binance.vision/data/futures/um/monthly/klines/{sym}/1d/{sym}-1d-{ym}.zip'),months))
        parts=[p for p in parts if p is not None]
        if not parts: continue
        df=pd.concat(parts).drop_duplicates('open_time').sort_values('open_time'); df['contract']=sym; df['expiry']=pd.Timestamp('20'+e,tz='UTC')+pd.Timedelta(hours=8)
        rows.append(df)
    df=pd.concat(rows); df.to_parquet(out,index=False); return df
res={}
for base in ['BTCUSDT','ETHUSDT']:
    sp=spot_1d(base); q=quarterlies(base)
    sp['t']=pd.to_datetime(sp.open_time,unit='ms',utc=True); q['t']=pd.to_datetime(q.open_time,unit='ms',utc=True)
    m=q.merge(sp[['t','close']].rename(columns={'close':'spot'}),on='t')
    m['days']=(m.expiry-m.t).dt.total_seconds()/86400
    m=m[m.days>1]
    m['basis']=m.close/m.spot-1; m['ann']=m.basis*365/m.days
    # front contract = nearest expiry with days>=7 ; next = second
    m=m.sort_values(['t','days'])
    front=m[m.days>=7].groupby('t').first().reset_index()
    nxt=m[m.days>=7].groupby('t').nth(1).reset_index()
    front['year']=front.t.dt.year
    summ=front.groupby('year').agg(n=('ann','size'),mean_ann=('ann','mean'),med_ann=('ann','median'),p10=('ann',lambda x:x.quantile(.1)),p90=('ann',lambda x:x.quantile(.9)),share_gt5=('ann',lambda x:(x>0.05).mean()),share_gt10=('ann',lambda x:(x>0.10).mean()),share_gt15=('ann',lambda x:(x>0.15).mean()),mean_days=('days','mean'))
    print(base); print(summ.round(4).to_string())
    for lab,d in [('fit 2021-01..2024-07',front[front.t<'2024-08-01']),('holdout 2024-08..2026-07',front[(front.t>='2024-08-01')&(front.t<'2026-08-01')])]:
        x=d.ann; print(lab, 'n',len(x),'mean',round(x.mean(),4),'median',round(x.median(),4),'share>5%',round((x>.05).mean(),3),'share>10%',round((x>.10).mean(),3),'share>15%',round((x>.15).mean(),3))
    # next-quarter (second) contract too
    nxt['year']=nxt.t.dt.year
    print('next contract by year'); print(nxt.groupby('year').agg(n=('ann','size'),mean_ann=('ann','mean'),med_ann=('ann','median'),share_gt10=('ann',lambda x:(x>0.10).mean()),mean_days=('days','mean')).round(4).to_string())
    front.to_csv(f'{S}/q/front_{base}.csv',index=False); nxt.to_csv(f'{S}/q/next_{base}.csv',index=False)
