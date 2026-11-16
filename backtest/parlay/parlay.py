import pandas as pd,numpy as np,json
from scipy.stats import binom
D=pd.read_pickle('/tmp/parlay/work/P.pkl')
g=pd.read_csv('/tmp/parlay/data/games.csv').set_index('game_id')
dec=lambda a: 1+100/-a if a<0 else 1+a/100
def leg(r,typ,onDog,pct):
    pickHome=(r.dogHome==1) if onDog else (r.dogHome==0)
    o=r.home_spread_odds if pickHome else r.away_spread_odds
    res=None if pd.isna(r.v) else ('P' if r.v==0 else ('W' if (r.v>0)==onDog else 'L'))
    return dict(type=typ,game_id=r.game_id,team=r.home if pickHome else r.away,line=abs(r.L) if onDog else -abs(r.L),pct=pct,res=res,odds=o)
def week_picks(G,drop_push):
    if drop_push: G=G[G.y.notna()]
    G=G.sort_values(['conf','game_id'],ascending=[False,True])
    if len(G)<2: return None,[]
    lr=G.iloc[1]; lock=leg(lr,'LOCK',bool(lr.onDog),lr.conf)
    dogs=[leg(r,'DOG',True,r.p) for r in G[G.rdog&(G.game_id!=lr.game_id)].sort_values(['p','game_id'],ascending=[False,True]).itertuples()]
    return lock,dogs
def rules(lock,dogs):
    pk=[d for d in dogs if d['pct']>=0.53]; out={}
    out['R1']=[lock,pk[0]] if lock and pk else None
    out['R2']=[lock,dogs[0]] if lock and dogs else None
    out['R3']=pk[:2] if len(pk)>=2 else None
    al=sorted(([lock] if lock else [])+pk,key=lambda x:-x['pct'])
    out['R4']=al[:2] if len(al)>=2 else None
    return out
def build(seasons,drop_push,weeks=None,official=None):
    rows=[]; singles=[]
    for (S,w),G in D[D.season.isin(seasons)].groupby(['season','week']):
        if weeks and w not in weeks: continue
        if official is not None: lock,dogs=official(S,w,G)
        else: lock,dogs=week_picks(G,drop_push)
        if lock: singles.append(dict(season=S,week=w,**lock))
        for d in dogs: singles.append(dict(season=S,week=w,**d,picked=d['pct']>=0.53))
        for k,v in rules(lock,dogs).items():
            if v: rows.append(dict(season=S,week=w,rule=k,g1=v[0]['game_id'],t1=v[0]['team'],ty1=v[0]['type'],l1=v[0]['line'],p1=v[0]['pct'],r1=v[0]['res'],o1=v[0]['odds'],g2=v[1]['game_id'],t2=v[1]['team'],ty2=v[1]['type'],l2=v[1]['line'],p2=v[1]['pct'],r2=v[1]['res'],o2=v[1]['odds']))
    return pd.DataFrame(rows),pd.DataFrame(singles)
def grade(P,mode):
    # mode: 'actual' (drop parlays with a missing price), 'fill' (-110 for missing), 'flat' (-110 all)
    P=P[P.r1.notna()&P.r2.notna()].copy()
    if mode=='flat': P['o1']=-110.0; P['o2']=-110.0
    miss=P.o1.isna()|P.o2.isna()
    if mode=='actual': P=P[~miss].copy()
    if mode=='fill': P['o1']=P.o1.fillna(-110.0); P['o2']=P.o2.fillna(-110.0)
    out=[]
    for r in P.itertuples():
        d1,d2=dec(r.o1),dec(r.o2); rs=(r.r1,r.r2)
        st=(d1-1 if r.r1=='W' else -1 if r.r1=='L' else 0)+(d2-1 if r.r2=='W' else -1 if r.r2=='L' else 0)
        sst=(r.r1!='P')+(r.r2!='P')
        if rs==('P','P'): k,u,stake,be='NB',0.0,0,np.nan
        elif 'P' in rs:
            d=d2 if r.r1=='P' else d1; o=r.r2 if r.r1=='P' else r.r1
            k,u,stake,be=('RW',d-1,1,np.nan) if o=='W' else ('RL',-1.0,1,np.nan)
        elif rs==('W','W'): k,u,stake,be='W',d1*d2-1,1,1/(d1*d2)
        else: k,u,stake,be='L',-1.0,1,1/(d1*d2)
        out.append((k,u,stake,be,st,sst))
    P[['k','u','stake','be','su','sstake']]=pd.DataFrame(out,index=P.index)
    return P
def summ(Q):
    W=(Q.k=='W').sum(); L=(Q.k=='L').sum(); RW=(Q.k=='RW').sum(); RL=(Q.k=='RL').sum(); n=Q.stake.sum()
    return dict(weeks=int(n),W=int(W),L=int(L),RW=int(RW),RL=int(RL),hit=W/(W+L) if W+L else np.nan,units=Q.u.sum(),roi=Q.u.sum()/n if n else np.nan,be=Q.be.mean(),straight=Q.su.sum(),sstake=int(Q.sstake.sum()),pluck=binom.sf(W-1,W+L,0.25) if W+L else np.nan)
def show(P,label,per_season=()):
    for mode in ('actual','fill','flat'):
        Gd=grade(P,mode); Gd.to_csv('/tmp/parlay/work/out_%s_%s.csv'%(label,mode),index=False)
        print('\n== %s | pricing=%s'%(label,mode))
        for k in ('R1','R2','R3','R4'):
            s=summ(Gd[Gd.rule==k]); print('%s bets %3d  W-L %d-%d (reduced W %d L %d)  hit %.1f%%  units %+.2f  ROI %+.1f%%  avgBE %.1f%%  straight %+.2f on %d bets  P(luck>=W|coin) %.3f'%(k,s['weeks'],s['W'],s['L'],s['RW'],s['RL'],100*s['hit'],s['units'],100*s['roi'],100*s['be'],s['straight'],s['sstake'],s['pluck']))
            if k in per_season and mode=='actual':
                tu=0;ts=0
                for S,q in Gd[Gd.rule==k].groupby('season'):
                    s2=summ(q); tu+=s2['units']; ts+=s2['straight']
                    print('   %d bets %2d  %d-%d (rW %d rL %d)  units %+.2f  straight %+.2f'%(S,s2['weeks'],s2['W'],s2['L'],s2['RW'],s2['RL'],s2['units'],s2['straight']))
                print('   sum of seasons units %+.2f straight %+.2f'%(tu,ts))
def singles_summary(Sg,label):
    Sg=Sg[Sg.res.notna()].copy(); print('\n-- straight bets',label)
    Sg['miss']=Sg.odds.isna()
    for name,q in (('Lock',Sg[Sg.type=='LOCK']),('Picked dogs',Sg[(Sg.type=='DOG')&(Sg.picked==True)]),('Not-picked dogs',Sg[(Sg.type=='DOG')&(Sg.picked==False)])):
        W=(q.res=='W').sum();L=(q.res=='L').sum();Pu=(q.res=='P').sum()
        qa=q[~q.miss]; ua=sum((dec(o)-1) if r=='W' else (-1 if r=='L' else 0) for o,r in zip(qa.odds,qa.res))
        Wa=(qa.res=='W').sum();La=(qa.res=='L').sum()
        print('%s %d-%d-%d  flat-110 %+.2f | actual prices (%d-%d, %d legs missing price) %+.2f | avg dec %.4f'%(name,W,L,Pu,W*100/110-L,Wa,La,q.miss.sum(),ua,np.mean([dec(o) for o in qa.odds])))
    return Sg
if __name__=='__main__':
    import sys
    H=list(range(2014,2026))
    for dp,lab in ((False,'HIST_pregame'),(True,'HIST_published_method')):
        P,Sg=build(H,dp); P.to_pickle('/tmp/parlay/work/P_%s.pkl'%lab); Sg.to_pickle('/tmp/parlay/work/S_%s.pkl'%lab)
        print('\n########',lab,'parlays with a missing price by rule:',P[P.o1.isna()|P.o2.isna()].groupby('rule').size().to_dict(), 'weeks total',D[D.season.isin(H)].groupby(['season','week']).ngroups)
        print(P[P.o1.isna()|P.o2.isna()][['season','week','rule','g1','g2']])
        show(P,lab,per_season=('R1','R2','R3','R4'))
        singles_summary(Sg,lab)
