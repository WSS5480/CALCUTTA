#!/usr/bin/env python3
# Player-lineup backtest (nflverse data). Walk-forward: every game predicted only from earlier weeks.
import pandas as pd, numpy as np, sys, json, collections
D = '/tmp/nv/'
FIX = {'OAK': 'LV', 'SD': 'LAC', 'STL': 'LA', 'LAR': 'LA', 'WSH': 'WAS', 'JAC': 'JAX'}
fx = lambda t: FIX.get(t, t)
YEARS = list(range(2015, 2026))

g = pd.read_csv(D + 'games.csv')
g = g[(g.game_type == 'REG') & (g.season >= 2015) & (g.season <= 2025)].copy()
g['home'] = g.home_team.map(fx); g['away'] = g.away_team.map(fx)
g = g.dropna(subset=['home_score', 'away_score']).sort_values(['season', 'week', 'gameday']).reset_index(drop=True)
g['m'] = g.home_score - g.away_score
g['L'] = g.spread_line  # positive = home favored by that many

# ---------- player weekly scores ----------
PS = pd.concat([pd.read_csv(D + f'stats_player_week_{y}.csv', low_memory=False) for y in YEARS])
PS = PS[PS.season_type == 'REG'].copy(); PS['team'] = PS.team.map(fx)
f = lambda c: PS[c].fillna(0)
scores = {}  # (pid, grp) -> list rows
grp_names = ['pass', 'rush', 'rec', 'def', 'k']
rows = []
def add(mask, grp, val):
    d = PS[mask]
    rows.append(pd.DataFrame({'pid': d.player_id.values, 'grp': grp, 'season': d.season.values, 'week': d.week.values, 'team': d.team.values, 'val': val[mask].values}))
add(f('attempts') >= 10, 0, f('passing_epa'))
add(f('carries') >= 3, 1, f('rushing_epa'))
add(f('targets') >= 1, 2, f('receiving_epa'))
dv = 1.5 * f('def_sacks') + 0.7 * f('def_tackles_for_loss') + 0.7 * f('def_pass_defended') + 2 * f('def_interceptions') + 0.4 * f('def_qb_hits') + 1.2 * f('def_fumbles_forced') + 0.05 * (f('def_tackles_solo') + f('def_tackles_with_assist'))
add((f('def_tackles_solo') + f('def_tackles_with_assist') + f('def_sacks') + f('def_pass_defended') + f('def_interceptions')) > 0, 3, dv)
add((f('fg_att') + f('pat_att')) > 0, 4, 0.9 * f('fg_made') - 1.5 * f('fg_missed') - 1.5 * f('pat_missed'))
SC = pd.concat(rows, ignore_index=True); SC = SC[SC.pid.notna()]
SC['key'] = SC.pid + '|' + SC.grp.astype(str)

# ---------- injuries ----------
INJ = pd.concat([pd.read_csv(D + f'injuries_{y}.csv') for y in YEARS])
INJ = INJ[INJ.game_type == 'REG']; INJ['team'] = INJ.team.map(fx)
inj = {}
for r in INJ.itertuples():
    s = r.report_status
    if isinstance(s, str) and s in ('Out', 'Doubtful', 'Questionable'):
        inj[(r.season, r.team, r.week, r.gsis_id)] = s
AVAIL = {'Out': 0.0, 'Doubtful': 0.0, 'Questionable': 0.5}

# team-game player lists and per-week score index
tg = collections.defaultdict(list)  # (season, team) -> [(week, {key:val})]
for (s, t, w), d in SC.groupby(['season', 'team', 'week']):
    tg[(s, t)].append((w, dict(zip(d.key, d.val))))
for k in tg: tg[k].sort(key=lambda x: x[0])
games_by_week = {(s, w): d for (s, w), d in g.groupby(['season', 'week'])}

# ---------- player ratings with trailing-3-season weights ----------
WY = [1.0, 0.6, 0.3]; KSHR = 4.0
hist = collections.defaultdict(dict)  # key -> {season: [n, sum]}
def rate(key, y):
    h = hist.get(key)
    if not h: return 0.0
    S = N = 0.0
    for d in range(3):
        e = h.get(y - d)
        if e: S += WY[d] * e[1]; N += WY[d] * e[0]
    return S / (N + KSHR)

def feats(team, season, week, lineup_mode):
    """returns 5-vector of summed ratings and a delta vector (injury-removed value)"""
    L = tg.get((season, team), [])
    past = [x for x in L if x[0] < week]
    f5 = np.zeros(5); lost = np.zeros(5)
    if lineup_mode == 'A':
        cur = [x for x in L if x[0] == week]
        keys = {k: 1.0 for k in (cur[0][1].keys() if cur else [])}
    elif lineup_mode == 'L0':
        keys = {k: 1.0 for k in (past[-1][1].keys() if past else [])}
    else:
        keys = {}
        for (_, d) in past[-3:]:
            for k in d: keys[k] = 1.0
    for k, wgt in keys.items():
        r = rate(k, season); gi = int(k[-1]); pid = k[:-2]
        if lineup_mode == 'L2':
            st = inj.get((season, team, week, pid))
            if st:
                a = AVAIL[st]; lost[gi] += r * (wgt - a * wgt); wgt = wgt * a
        f5[gi] += r * wgt
    return f5, lost

# ---------- margin power rating (team-level baseline), walk-forward ----------
def team_ratings(season, week, hfa=2.0, decay=0.85, cap=14, ridge=6.0):
    past = g[(g.season == season) & (g.week < week)]
    teams = sorted(set(g[g.season == season].home) | set(g[g.season == season].away))
    R = {t: 0.0 for t in teams}
    if past.empty: return R
    wgt = np.power(decay, (week - past.week).values)
    n = collections.Counter()
    for h, a, w in zip(past.home, past.away, wgt): n[h] += w; n[a] += w
    mm = np.clip(past.m.values, -cap, cap)
    for _ in range(25):
        sm = collections.defaultdict(float)
        for h, a, w, m in zip(past.home, past.away, wgt, mm):
            d = m - hfa
            sm[h] += w * (d + R[a]); sm[a] += w * (-d + R[h])
        R = {t: sm[t] / (n[t] + ridge) for t in teams}
    return R

# ---------- build rows ----------
out = []
weeks_sorted = sorted(games_by_week.keys())
done_upto = None
for (s, w) in weeks_sorted:
    G = games_by_week[(s, w)]
    R = team_ratings(s, w)
    for r in G.itertuples():
        row = {'season': s, 'week': w, 'm': r.m, 'L': r.L if pd.notna(r.L) else np.nan, 'mT': R.get(r.home, 0) - R.get(r.away, 0) + 2.0,
               'hml': r.home_moneyline, 'aml': r.away_moneyline, 'home': r.home, 'away': r.away}
        for mode in ('L0', 'L1', 'L2', 'A'):
            fh, lh = feats(r.home, s, w, mode); fa, la = feats(r.away, s, w, mode)
            row[mode] = fh - fa
            if mode == 'L2': row['lost'] = lh - la
        out.append(row)
    # update history with this week's games AFTER predicting
    for r in G.itertuples():
        for team in (r.home, r.away):
            for (wk, d) in tg.get((s, team), []):
                if wk == w:
                    for k, v in d.items():
                        e = hist[k].setdefault(s, [0, 0.0]); e[0] += 1; e[1] += v
import pickle
pickle.dump(out, open(D + 'rows.pkl', 'wb'))
print('rows', len(out), 'with line', sum(1 for x in out if not np.isnan(x['L'])))
