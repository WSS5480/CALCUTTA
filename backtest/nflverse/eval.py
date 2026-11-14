import pickle, numpy as np, math, sys
rows = pickle.load(open('/tmp/nv/rows.pkl', 'rb'))
rows = [r for r in rows if r['week'] >= 3 and not np.isnan(r['L']) and r['m'] != 0]
rows.sort(key=lambda r: (r['season'], r['week']))
def fit(X, y, lam=20.0):
    X = np.array(X); y = np.array(y); n = X.shape[1]
    A = X.T @ X; A[1:, 1:] += lam * np.eye(n - 1)
    return np.linalg.solve(A + 1e-9 * np.eye(n), X.T @ y)
MODELS = {
    'team':   lambda r: [1, r['mT']],
    'P0 last game': lambda r: [1, *r['L0']],
    'P1 last3 no inj': lambda r: [1, *r['L1']],
    'P2 last3 - injuries': lambda r: [1, *r['L2']],
    'team+P2': lambda r: [1, r['mT'], *r['L2']],
    'PA actual lineup (look-ahead)': lambda r: [1, *r['A']],
    'team+PA (look-ahead)': lambda r: [1, r['mT'], *r['A']],
}
RES = {  # target = m - L (does it beat the line?)
    'R: P2 vs line': lambda r: [1, *r['L2']],
    'R: injury value only': lambda r: [1, *r['lost']],
    'R: team+P2 vs line': lambda r: [1, r['mT'] - r['L'], *r['L2']],
    'R: PA vs line (look-ahead)': lambda r: [1, *r['A']],
}
batches = sorted(set((r['season'], r['week']) for r in rows))
pred = {k: {} for k in list(MODELS) + list(RES)}
for b in batches:
    if b < (2018, 3): continue
    tr = [r for r in rows if (r['season'], r['week']) < b]; te = [r for r in rows if (r['season'], r['week']) == b]
    if len(tr) < 400: continue
    for k, fx in MODELS.items():
        w = fit([fx(r) for r in tr], [r['m'] for r in tr])
        for r in te: pred[k][id(r)] = float(np.dot(fx(r), w))
    for k, fx in RES.items():
        w = fit([fx(r) for r in tr], [r['m'] - r['L'] for r in tr], lam=50.0)
        for r in te: pred[k][id(r)] = r['L'] + float(np.dot(fx(r), w))
ev = [r for r in rows if id(r) in pred['team']]
print('eval games', len(ev), 'seasons', sorted(set(r['season'] for r in ev)))
rm = lambda f: math.sqrt(sum((r['m'] - f(r)) ** 2 for r in ev) / len(ev))
print('RMSE line %.2f' % rm(lambda r: r['L']))
def ats(k, lo=0, hi=99):
    x = [r for r in ev if r['m'] != r['L'] and lo <= abs(pred[k][id(r)] - r['L']) < hi]
    w = sum(1 for r in x if (pred[k][id(r)] > r['L']) == (r['m'] > r['L']))
    return w, len(x) - w
def pc(w, l): return '%d-%d (%.1f%%)' % (w, l, 100 * w / max(1, w + l))
for k in pred:
    r1 = rm(lambda r: pred[k][id(r)]); win = sum(1 for r in ev if (pred[k][id(r)] > 0) == (r['m'] > 0)) / len(ev)
    print('%-32s rmse %.2f win %.1f%%  ATS all %s | edge>=3 %s | edge>=5.4 %s' % (k, r1, 100 * win, pc(*ats(k)), pc(*ats(k, 3)), pc(*ats(k, 5.4))))
# per-season ATS for the key models
for k in ['P2 last3 - injuries', 'R: P2 vs line', 'R: injury value only', 'PA actual lineup (look-ahead)']:
    print(k, ' by season:', ' '.join('%d:%s' % (s, pc(*[sum(1 for r in ev if r['season'] == s and r['m'] != r['L'] and ((pred[k][id(r)] > r['L']) == (r['m'] > r['L'])) == t) for t in (True, False)])) for s in sorted(set(r['season'] for r in ev))))
