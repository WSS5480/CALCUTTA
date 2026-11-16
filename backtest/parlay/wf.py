import pandas as pd,numpy as np,json,warnings
warnings.filterwarnings('ignore')
from sklearn.linear_model import LogisticRegression
M=json.load(open('/tmp/parlay/pics/trophy-model.json')); cols=M['cols']
D=pd.read_pickle('/tmp/parlay/work/D_final.pkl')
g=pd.read_csv('/tmp/parlay/data/games.csv').set_index('game_id')
for c in ('away_spread_odds','home_spread_odds','home_score','away_score'): D[c]=D.game_id.map(g[c])
D['p']=np.nan
for S in range(2014,2026):
    T=D[(D.season>=2004)&(D.season<S)&D.y.notna()]; X=T[cols].values.astype(float); mu=X.mean(0); sc=X.std(0)
    m=LogisticRegression(C=0.05,max_iter=5000).fit((X-mu)/sc,T.y.values)
    ix=D.season==S; D.loc[ix,'p']=m.predict_proba((D.loc[ix,cols].values.astype(float)-mu)/sc)[:,1]
# frozen model for 2026
ix=D.season==2026; Z=(D.loc[ix,cols].values.astype(float)-np.array(M['mean']))/np.array(M['scale'])
D.loc[ix,'p']=1/(1+np.exp(-(M['b']+Z@np.array(M['coef']))))
D=D[D.season>=2014].copy()
D['onDog']=D.p>=0.5; D['conf']=np.where(D.onDog,D.p,1-D.p)
D['pickHome']=np.where(D.onDog,D.dogHome==1,D.dogHome==0)
D['rdog']=(D['div']==1)&(D.dogHome==0)
D.to_pickle('/tmp/parlay/work/P.pkl')
def res(v,onDog):
    if pd.isna(v): return None
    return 'P' if v==0 else ('W' if (v>0)==onDog else 'L')
rows=[]
for (S,w),G in D.groupby(['season','week']):
    G=G.sort_values(['conf','game_id'],ascending=[False,True]); 
    for rank,(i,r) in enumerate(G.iterrows(),1):
        if rank<=2: rows.append(dict(season=S,week=w,type='DL' if rank==1 else 'LOCK',game_id=r.game_id,side='home' if r.pickHome else 'away',line=abs(r.L) if r.onDog else -abs(r.L),pct=r.conf,res=res(r.v,r.onDog),odds=r.home_spread_odds if r.pickHome else r.away_spread_odds))
    lock=G.iloc[1].game_id if len(G)>1 else None
    for i,r in G[G.rdog].iterrows():
        rows.append(dict(season=S,week=w,type='DOG',game_id=r.game_id,side='away',line=abs(r.L),pct=r.p,res=res(r.v,True),odds=r.away_spread_odds,isLock=r.game_id==lock,picked=r.p>=0.53))
L=pd.DataFrame(rows); L.to_pickle('/tmp/parlay/work/legs.pkl')
H=L[L.season<=2025]
def rec(x): return (x.res=='W').sum(),(x.res=='L').sum(),(x.res=='P').sum()
TRH=[[2014,8,9,12,5],[2015,9,8,10,7],[2016,9,8,9,8],[2017,10,7,9,8],[2018,9,8,10,7],[2019,9,8,11,6],[2020,6,11,8,9],[2021,10,8,10,8],[2022,9,9,10,8],[2023,10,8,8,10],[2024,11,7,8,10],[2025,8,10,5,13]]
ALY=[[2014,12,5,12,11],[2015,10,7,15,8],[2016,9,8,9,12],[2017,9,8,8,10],[2018,10,7,16,13],[2019,11,6,13,2],[2020,8,9,15,10],[2021,10,8,10,15],[2022,10,8,11,8],[2023,8,10,11,10],[2024,8,10,11,8],[2025,5,13,10,13]]
ok=True
print('season  DL mine/pub  LOCK mine/pub  picked dogs mine/pub  notpicked  alldogs')
tot=np.zeros(10,int)
for t,a in zip(TRH,ALY):
    S=t[0]; x=H[H.season==S]
    dl=rec(x[x.type=='DL']); lk=rec(x[x.type=='LOCK']); dg=x[x.type=='DOG']
    pk=rec(dg[dg.picked&~dg.isLock]); np_=rec(dg[~dg.picked&~dg.isLock]); al=rec(dg)
    m=(dl[:2]==(t[1],t[2])) and (lk[:2]==(t[3],t[4])==(a[1],a[2])) and (pk[:2]==(a[3],a[4])); ok&=m
    print(S,dl,(t[1],t[2]),lk,(t[3],t[4]),pk,(a[3],a[4]),np_,al,'OK' if m else 'MISMATCH')
    tot+=np.array([*dl[:2],*lk[:2],*pk[:2],*np_[:2],*al[:2]])
print('TOTAL DL %d-%d LOCK %d-%d picked %d-%d notpicked %d-%d all dogs %d-%d'%tuple(tot),'ALL MATCH' if ok else 'MISMATCH')
