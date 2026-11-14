// Experiment 2: blends with the closing line, learned weight, spread picks, Elo. Needs bt.js + exp1.js (window.__BTLIB, window.__BTM).
(function () {
  const Lb = window.__BTLIB, M = window.__BTM, { G, eloMargins, score, rmse, ats, pairedDiff, cdf, f } = Lb;
  const SA = G.filter((g) => g.w >= 3), SL = SA.filter((g) => g.L !== null && g.L !== undefined), out = [];
  const m0 = M['v23 NFL (cap14 d.85 r6 mix.5)'];
  const blend = (mm, w, sd) => (g) => w * cdf(g.L / sd) + (1 - w) * cdf(mm.get(g).mh / sd);
  const ref = score(SL, (g) => cdf(g.L / 12.5));
  const row = (name, fn) => { const s = score(SL, fn), d = pairedDiff(s.per, ref.per); return name + '|' + f(s.brier) + '|' + f(s.win * 100, 1) + '%|' + (d.d >= 0 ? '+' : '') + f(d.d, 4) + '±' + f(d.se * 1.96, 4); };
  out.push('SL n=' + SL.length + ' | name|brier|win%|diff vs line (+=worse)');
  out.push(row('LINE sd12.5', (g) => cdf(g.L / 12.5)));
  out.push(row('v23 orig 80/20 sd13.5', blend(m0, 0.8, 13.5)));
  out.push(row('CURRENT 90/10 sd12.5', blend(m0, 0.9, 12.5)));
  [0, 0.5, 0.7, 0.8, 0.95].forEach((w) => out.push(row('blend ' + w * 100 + '% line', blend(m0, w, 12.5))));
  ['margin only', 'efficiency only', 'mix .7', 'decay 1.0', 'carry .5 last yr', 'hfa 2.5'].forEach((n) => out.push(row(n + ' 90/10', blend(M[n], 0.9, 12.5))));
  [0, 0.1, 0.2, 0.3, 0.5, 1].forEach((b) => out.push('b=' + b + ' rmse ' + f(rmse(SL, (g) => g.L + b * (m0.get(g).mh - g.L)), 3)));
  const bw = (mm) => { const res = new Map(); let sxy = 0, sxx = 0, k = 0; SL.forEach((g) => { const b = k >= 100 && sxx > 0 ? Math.max(0, Math.min(1, sxy / sxx)) : 0; res.set(g, b); const x = mm.get(g).mh - g.L, y = g.hs - g.as - g.L; sxy += x * y; sxx += x * x; k++; }); return res; };
  const bm = bw(m0), bs = [...bm.values()];
  out.push('walk-fwd b final ' + f(bs[bs.length - 1], 3) + ' rmse ' + f(rmse(SL, (g) => g.L + bm.get(g) * (m0.get(g).mh - g.L)), 3) + ' vs line ' + f(rmse(SL, (g) => g.L), 3));
  out.push(row('learned-b', (g) => cdf((g.L + bm.get(g) * (m0.get(g).mh - g.L)) / 12.5)));
  [['v23', m0], ['eff', M['efficiency only']], ['margin', M['margin only']], ['decay1', M['decay 1.0']]].forEach(([n, mm]) => [0, 2, 4].forEach((t) => { const a = ats(SL, (g) => { const e = mm.get(g).mh - g.L; return Math.abs(e) >= t && e !== 0 ? (e > 0 ? 1 : -1) : 0; }); out.push('ATS ' + n + ' edge>=' + t + '|n' + a.n + '|' + f(a.pct * 100, 1) + '% [' + f(a.ci[0] * 100, 0) + '-' + f(a.ci[1] * 100, 0) + ']|ROI ' + f(a.roi * 100, 1) + '%'); }));
  const home = ats(SL, () => 1), fav = ats(SL, (g) => (g.L > 0 ? 1 : g.L < 0 ? -1 : 0));
  out.push('ATS always HOME ' + f(home.pct * 100, 1) + '% | FAV ' + f(fav.pct * 100, 1) + '% n' + home.n);
  [[0.06, 2, 0.3], [0.1, 2, 0.3], [0.1, 2.5, 0.5]].forEach(([k, h, r]) => { const E = eloMargins(k, h, r), a = score(SA, (g) => cdf(E.get(g).mh / 12.5)); out.push('elo k' + k + ' h' + h + ' r' + r + ' alone brier ' + f(a.brier) + ' win ' + f(a.win * 100, 1) + '% rmse ' + f(rmse(SA, (g) => E.get(g).mh), 2) + ' | ' + row('+line', blend(E, 0.9, 12.5))); });
  window.__EXP2 = out; return out.length;
})();
