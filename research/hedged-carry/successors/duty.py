import os, json, numpy as np, pandas as pd
S=os.path.dirname(os.path.abspath(__file__))
ON=0.0002; OFF=0.00005; H8=8*3600*1000
FIT=(pd.Timestamp('2020-01-01',tz='UTC'),pd.Timestamp('2024-08-01',tz='UTC'))
HOLD=(pd.Timestamp('2024-08-01',tz='UTC'),pd.Timestamp('2026-08-01',tz='UTC'))
syms=sorted(f[:-8] for f in os.listdir(f'{S}/data/funding') if f.endswith('.parquet'))
rows=[]; daily_on=[]
for sym in syms:
    f=pd.read_parquet(f'{S}/data/funding/{sym}.parquet'); d=pd.read_parquet(f'{S}/data/1d/{sym}.parquet')
    if len(f)<30 or len(d)<400: continue
    f=f.sort_values('t_ms').reset_index(drop=True)
    dt=np.diff(f.t_ms.values); iv=np.r_[dt[0] if len(dt) else H8, dt]
    iv=np.clip(iv, 3600*1000, H8)  # 1h..8h intervals
    f['rate8']=f.rate.values*(H8/iv)   # per-8h equivalent
    f['t']=pd.to_datetime(f.t_ms,unit='ms',utc=True)
    # trailing 72h mean of rate8 (time-based window == 9 settlements at 8h)
    s=f.set_index('t').rate8
    m72=s.rolling('72h').mean().values
    on=np.zeros(len(f),bool); st=False
    for i,v in enumerate(m72):
        if not st and v>=ON: st=True
        elif st and v<=OFF: st=False
        on[i]=st
    f['on']=on
    # per-day ON flag (a day is ON if any settlement that day is ON) and daily mean rate8
    f['day']=f.t.dt.floor('D')
    dd=f.groupby('day').agg(on=('on','max'),rate8=('rate8','mean'),n=('rate8','size')).reset_index()
    d['day']=pd.to_datetime(d.t_ms,unit='ms',utc=True)
    dd=dd.merge(d[['day','open','high','low','close','quote_volume']],on='day',how='inner')
    dd['prev_close']=dd.close.shift(1)
    dd['jump']=dd.high/dd.prev_close-1
    dd['symbol']=sym
    daily_on.append(dd[['symbol','day','on','rate8','jump','quote_volume']])
    def stats(x,label):
        if len(x)==0: return {}
        onx=x[x.on]
        # episodes and x_max from episode entry (no re-centre)
        ep=(x.on & ~x.on.shift(1,fill_value=False)).cumsum()*x.on
        xmax=[]; 
        for k,g in x[x.on].groupby(ep[x.on]):
            e=g.prev_close.iloc[0] if not np.isnan(g.prev_close.iloc[0]) else g.open.iloc[0]
            xmax.append(g.high.max()/e-1)
        xmax=np.array(xmax)
        yrs=len(x)/365.25
        return {f'{label}_days':len(x), f'{label}_util':x.on.mean(), f'{label}_rate_on':onx.rate8.mean() if len(onx) else np.nan,
                f'{label}_gross_pa':(x.rate8*x.on).mean()*3*365, f'{label}_episodes':len(xmax),
                f'{label}_ep_xmax_ge_485':int((xmax>=0.485).sum()), f'{label}_jump30_on':int((onx.jump>=0.30).sum()),
                f'{label}_jump30_on_per_yr':(onx.jump>=0.30).sum()/max(len(onx)/365.25,1e-9) if len(onx) else np.nan,
                f'{label}_jump_max_on':onx.jump.max() if len(onx) else np.nan,
                f'{label}_qv_med':x.quote_volume.median()}
    r=dict(symbol=sym,first_day=str(dd.day.iloc[0].date()),n_days=len(dd),qv_med=dd.quote_volume.median())
    r.update(stats(dd[(dd.day>=FIT[0])&(dd.day<FIT[1])],'fit')); r.update(stats(dd[(dd.day>=HOLD[0])&(dd.day<HOLD[1])],'hold')); r.update(stats(dd,'all'))
    rows.append(r)
R=pd.DataFrame(rows); R.to_csv(f'{S}/duty_symbols.csv',index=False)
D=pd.concat(daily_on); D.to_parquet(f'{S}/duty_daily.parquet',index=False)
print('symbols',len(R))
eight=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','LINKUSDT']
pd.set_option('display.width',250)
print('\n== the eight (fit / hold) ==')
print(R[R.symbol.isin(eight)][['symbol','fit_util','fit_rate_on','fit_gross_pa','fit_ep_xmax_ge_485','fit_jump30_on','fit_jump_max_on','hold_util','hold_rate_on','hold_gross_pa','hold_jump30_on']].round(5).to_string())
# volume tiers on fit-period median quote volume
def tier(q):
    return 'A ≥$100M' if q>=1e8 else ('B $10–100M' if q>=1e7 else ('C $1–10M' if q>=1e6 else 'D <$1M'))
for lab in ['fit','hold']:
    x=R[R[f'{lab}_days']>=180].copy(); x['tier']=x[f'{lab}_qv_med'].map(tier)
    g=x.groupby('tier').agg(n_sym=('symbol','size'),util_mean=(f'{lab}_util','mean'),util_med=(f'{lab}_util','median'),rate_on=(f'{lab}_rate_on','mean'),gross_pa=(f'{lab}_gross_pa','mean'),gross_med=(f'{lab}_gross_pa','median'),
        jump30_on_per_sym=(f'{lab}_jump30_on','mean'),share_sym_with_jump30=(f'{lab}_jump30_on',lambda v:(v>0).mean()),ep_xmax485_per_sym=(f'{lab}_ep_xmax_ge_485','mean'),days=(f'{lab}_days','mean'))
    print(f'\n== {lab}: by fit-period median daily quote volume tier (symbols with ≥180 days in window) ==')
    print(g.round(4).to_string())
# panel utilisation by year: share of (symbol,day) ON among listed symbols, and among top-N by trailing volume
D['year']=D.day.dt.year
print('\n== panel share of symbol-days ON, by year, all symbols listed ==')
print(D.groupby('year').agg(sym_days=('on','size'),share_on=('on','mean'),rate_on=('rate8',lambda v: v[D.loc[v.index,'on']].mean()),n_sym=('symbol','nunique')).round(4).to_string())
# top-30 by 90-day trailing volume each day
D=D.sort_values(['symbol','day']); D['qv90']=D.groupby('symbol').quote_volume.transform(lambda v:v.rolling(90,min_periods=30).median())
D['rank']=D.groupby('day').qv90.rank(ascending=False)
for K in [8,30,100]:
    t=D[D['rank']<=K]
    print(f'\n== top-{K} by trailing-90d median quote volume: share ON by year ==')
    print(t.groupby('year').agg(sym_days=('on','size'),share_on=('on','mean'),rate_on=('rate8',lambda v: v[t.loc[v.index,'on']].mean()),jump30_on=('jump',lambda v: int(((v>=0.30)&t.loc[v.index,'on']).sum()))).round(4).to_string())
# how many symbols are ON on an average day (fit / hold), i.e. slots available
for lab,(a,b) in [('fit',FIT),('hold',HOLD)]:
    t=D[(D.day>=a)&(D.day<b)]
    per_day=t.groupby('day').on.sum()
    print(f'\n{lab}: symbols ON per day: mean {per_day.mean():.1f}, median {per_day.median():.0f}, p10 {per_day.quantile(.1):.0f}, p90 {per_day.quantile(.9):.0f}; listed per day mean {t.groupby("day").on.size().mean():.0f}')
    t30=t[t['rank']<=30]; per_day=t30.groupby('day').on.sum(); print(f'{lab}: within top-30: ON per day mean {per_day.mean():.1f}, median {per_day.median():.0f}, p10 {per_day.quantile(.1):.0f}')
