import pandas as pd, numpy as np, json, sys
M=json.load(open('/tmp/parlay/pics/trophy-model.json'))
FIX={'OAK':'LV','SD':'LAC','STL':'LA','LAR':'LA','WSH':'WAS','JAC':'JAX'}
CONF=set('BUF MIA NE NYJ BAL CIN CLE PIT HOU IND JAX TEN DEN KC LV LAC'.split())
DIV=set(M['div'])
def build(playoff_hist=False, start=1999):
    g=pd.read_csv('/tmp/parlay/data/games.csv')
    g=g[g.season>=start].copy()
    g['home']=g.home_team.replace(FIX); g['away']=g.away_team.replace(FIX)
    g['t']=pd.to_datetime(g.gameday)
    g=g.sort_values(['t','game_id']).reset_index(drop=True)
    hist={}  # team -> list of dict
    meet={}
    out=[]
    # process by date so same-day games don't see each other
    for t,day in g.groupby('t',sort=True):
        newrows=[]
        for r in day.itertuples():
            fin=not (pd.isna(r.home_score) or pd.isna(r.away_score))
            L=r.spread_line
            if r.game_type=='REG' and not pd.isna(L) and L!=0:
                home,away=r.home,r.away; dogHome=1 if L<0 else 0
                dog=home if dogHome else away; fav=away if dogHome else home
                def side(team):
                    H=hist.get(team,[]); cur=[x for x in H if x['season']==r.season]; last=H[-1] if H else None; d={}
                    d['prev_margin']=last['margin'] if last else 0
                    d['prev_close_loss']=int(bool(last) and -3<=last['margin']<0)
                    d['prev_ot_loss']=int(bool(last) and bool(last['ot']) and last['margin']<=0)
                    d['prev_blowout_loss']=int(bool(last) and last['margin']<=-14)
                    d['prev_lost_as_fav']=int(bool(last) and last['spr']>0 and last['margin']<0)
                    d['prev_big_win']=int(bool(last) and last['margin']>=14)
                    d['prev_cover_margin']=last['margin']+last['spr'] if last else 0
                    l3=H[-3:]; d['ats3']=sum(1 for x in l3 if x['margin']+x['spr']>0)/len(l3) if l3 else 0.5
                    d['rest']=int(round((t-last['t']).days)) if (last and last['season']==r.season) else 7
                    d['short']=int(d['rest']<=5); d['bye']=int(d['rest']>=10)
                    w=sum(1 for x in cur if x['margin']>0); l=sum(1 for x in cur if x['margin']<0); n=len(cur)
                    d['winpct']=(w+0.5*(n-w-l))/n if n else 0.5; d['gp']=n
                    wk=r.week
                    d['late_bubble']=int(wk>=12 and 0.4<=d['winpct']<=0.7); d['late_dead']=int(wk>=12 and d['winpct']<0.3); d['late_contender']=int(wk>=12 and d['winpct']>=0.7)
                    d['recent_loss_streak']=int(len(H)>=2 and H[-1]['margin']<0 and H[-2]['margin']<0)
                    return d
                sd=side(dog); sf=side(fav)
                key='-'.join(sorted([home,away]))
                hm=[x for x in meet.get(key,[]) if r.season-x['season']<=6][-3:]
                hmv=[((x['hs']-x['as']) if x['home']==dog else (x['as']-x['hs']), x['L'] if x['home']==dog else -x['L']) for x in hm]
                cf=int((home in CONF)==(away in CONF)); dv=int(key in DIV)
                f={'h2h_n':len(hmv),'h2h_cover':sum(1 for a,b in hmv if a+b>0)/len(hmv) if hmv else 0.5,'h2h_lastlost':int(len(hmv)>0 and hmv[-1][0]<0),'h2h_avgmargin':sum(a for a,b in hmv)/len(hmv) if hmv else 0,'div':dv,'conf':cf,'dog_home':dogHome,'sp':abs(L),'f_dead':sf['late_dead']}
                for k,v in sd.items(): f['d_'+k]=v
                for k,v in sf.items(): f['f_'+k]=v
                f['both_bubble']=int(sd['late_bubble'] and sf['late_bubble']); f['dog_dontdie']=int(sd['late_bubble'] and r.week>=13 and cf)
                row={'game_id':r.game_id,'season':r.season,'week':r.week,'home':home,'away':away,'L':L,'dogHome':dogHome,'fin':fin}
                if fin:
                    mg=r.home_score-r.away_score; dm=mg if dogHome else -mg; v=dm+abs(L)
                    row['v']=v; row['y']=np.nan if v==0 else float(v>0)
                else: row['v']=np.nan; row['y']=np.nan
                row.update(f); out.append(row)
            if fin and (r.game_type=='REG' or playoff_hist) and not pd.isna(L):
                newrows.append(r)
        for r in newrows:
            L=r.spread_line; m=r.home_score-r.away_score; ot=int(r.overtime==1)
            hist.setdefault(r.home,[]).append({'season':r.season,'margin':m,'spr':L,'ot':ot,'t':t})
            hist.setdefault(r.away,[]).append({'season':r.season,'margin':-m,'spr':-L,'ot':ot,'t':t})
            key='-'.join(sorted([r.home,r.away])); meet.setdefault(key,[]).append({'season':r.season,'home':r.home,'hs':r.home_score,'as':r.away_score,'L':L})
    return pd.DataFrame(out)
if __name__=='__main__':
    for ph in (False,True):
        D=build(ph); D.to_pickle('/tmp/parlay/work/D_%d.pkl'%ph)
        T=D[(D.season>=2004)&(D.season<=2025)&D.y.notna()]
        X=T[M['cols']].values.astype(float)
        print('playoff_hist',ph,'n',len(T),'model n',M['n'])
        dm=np.abs(X.mean(0)-np.array(M['mean'])); ds=np.abs(X.std(0)-np.array(M['scale']))
        print(' max mean diff',dm.max(),M['cols'][dm.argmax()],' max scale diff',ds.max(),M['cols'][ds.argmax()])
        print(' n with |diff|>1e-5:',(dm>1e-5).sum(),(ds>1e-5).sum())
