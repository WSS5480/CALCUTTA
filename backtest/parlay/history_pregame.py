# v253: per-season PRE-KICKOFF history for the app's tables TRH / ALY / ALH (pics/index.html).
# The tables shipped before v253 dropped push games BEFORE ranking each week (a push is only known after the game = hindsight). Here every game with a line is
# ranked, as it would have been before kickoff; pushes are then counted as pushes. Input: legs.pkl from wf.py (walk-forward model, nflverse games.csv closing
# lines and closing spread prices, 2014-2025). Run the analyst pipeline first (feat.py -> wf.py; they expect the /tmp/parlay layout: data/games.csv, pics/, work/).
# Output: the JS rows pasted into pics/index.html, and totals. Units at -110 and at the closing price of the picked side (nflverse away/home_spread_odds).
import pandas as pd, sys
L = pd.read_pickle(sys.argv[1] if len(sys.argv) > 1 else '/tmp/parlay/work/legs.pkl'); H = L[L.season <= 2025]
dec = lambda a: 1 + 100 / -a if a < 0 else 1 + a / 100
def rec(q):
    W, Lo, P = int((q.res == 'W').sum()), int((q.res == 'L').sum()), int((q.res == 'P').sum()); qa = q[q.odds.notna()]
    uc = sum((dec(o) - 1) if r == 'W' else (-1 if r == 'L' else 0) for o, r in zip(qa.odds, qa.res)); return [W, Lo, P, round(uc, 2), int(q.odds.isna().sum())]
TRH, ALY, T = [], [], {}
for y in range(2014, 2026):
    x = H[H.season == y]; dl, lk = rec(x[x.type == 'DL']), rec(x[x.type == 'LOCK']); d = x[x.type == 'DOG']
    pkd, lkd = d.picked.astype(bool), d.isLock.astype(bool); pk, npk = rec(d[pkd & ~lkd]), rec(d[~pkd & ~lkd])
    TRH.append([y] + dl[:3] + lk[:3]); ALY.append([y] + lk[:4] + pk[:4] + npk[:4])
    for k, v in (('dl', dl), ('lock', lk), ('pick', pk), ('not', npk)): T[k] = [a + b for a, b in zip(T.get(k, [0] * 5), v)]
print('const TRH = ' + str(TRH).replace(' ', '') + ';  // season, #1 W L P, #2 (Lock) W L P')
print('const ALY = ' + str(ALY).replace(' ', '') + ';  // season, Lock W L P units@close, picked road dog W L P units@close, not picked W L P units@close')
for k, v in T.items(): print(k, v[:3], 'units at -110 %+.2f' % (v[0] * 100 / 110 - v[1]), 'units at closing prices %+.2f' % v[3], 'missing prices', v[4])
a = [T['lock'][i] + T['pick'][i] for i in range(4)]; print('Alert (Lock + picked dogs not the Lock)', a[:3], 'at -110 %+.2f' % (a[0] * 100 / 110 - a[1]), 'at close %+.2f' % a[3])
