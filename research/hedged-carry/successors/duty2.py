import os, numpy as np, pandas as pd
S=os.path.dirname(os.path.abspath(__file__))
FIT=(pd.Timestamp('2020-01-01',tz='UTC'),pd.Timestamp('2024-08-01',tz='UTC'))
HOLD=(pd.Timestamp('2024-08-01',tz='UTC'),pd.Timestamp('2026-08-01',tz='UTC'))
D=pd.read_parquet(f'{S}/duty_daily.parquet').reset_index(drop=True)
D['year']=D.day.dt.year; D['rate_on']=np.where(D.on,D.rate8,np.nan); D['jump30on']=(D.jump>=0.30)&D.on
pd.set_option('display.width',250)
def tab(t,lab):
    g=t.groupby('year').agg(sym_days=('on','size'),n_sym=('symbol','nunique'),share_on=('on','mean'),rate_on_8h=('rate_on','mean'),jump30_on=('jump30on','sum'))
    g['gross_pa_of_notional']=g.share_on*g.rate_on_8h*3*365
    print(f'\n== {lab}: by year =='); print(g.round(5).to_string())
tab(D,'ALL listed symbols (515 with ≥400 daily bars)')
D=D.sort_values(['symbol','day']).reset_index(drop=True)
D['qv90']=D.groupby('symbol').quote_volume.transform(lambda v:v.rolling(90,min_periods=30).median())
D['rank']=D.groupby('day').qv90.rank(ascending=False,method='first')
for K in [8,30,100]:
    tab(D[D['rank']<=K],f'top-{K} by trailing-90d median quote volume')
for lab,(a,b) in [('fit',FIT),('hold',HOLD)]:
    t=D[(D.day>=a)&(D.day<b)]
    for K,name in [(None,'all listed'),(30,'top-30'),(100,'top-100')]:
        tt=t if K is None else t[t['rank']<=K]
        pdy=tt.groupby('day').on.sum(); ls=tt.groupby('day').on.size()
        print(f'{lab} {name}: symbols ON per day mean {pdy.mean():.1f} median {pdy.median():.0f} p10 {pdy.quantile(.1):.0f} p90 {pdy.quantile(.9):.0f}; listed mean {ls.mean():.0f}; share ON {tt.on.mean():.3f}; rate ON {tt.rate_on.mean()*100:.4f}%/8h; gross p.a. of notional {tt.on.mean()*tt.rate_on.mean()*3*365*100:.2f}%; jump≥30% days while ON {int(tt.jump30on.sum())} over {tt.on.sum()/365.25:.0f} ON symbol-years')
# how much of the holdout ON exposure is in symbols with tiny volume
t=D[(D.day>=HOLD[0])&(D.day<HOLD[1])&D.on]
print('\nholdout ON symbol-days by qv90 bucket:'); print(t.groupby(pd.cut(t.qv90,[0,1e6,1e7,1e8,1e12],labels=['<1M','1-10M','10-100M','>100M'])).agg(on_days=('on','size'),rate_on=('rate8','mean'),jump30=('jump30on','sum')).round(5).to_string())
t=D[(D.day>=FIT[0])&(D.day<FIT[1])&D.on]
print('\nfit ON symbol-days by qv90 bucket:'); print(t.groupby(pd.cut(t.qv90,[0,1e6,1e7,1e8,1e12],labels=['<1M','1-10M','10-100M','>100M'])).agg(on_days=('on','size'),rate_on=('rate8','mean'),jump30=('jump30on','sum')).round(5).to_string())
