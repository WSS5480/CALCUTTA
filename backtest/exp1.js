// Experiment 1: every model version and variants. Uses window.__BTLIB (bt.js). Returns compact text tables.
(function () {
  const L = window.__BTLIB, { G, base, modelMargins, score, rmse, ats, pairedDiff, cdf, clip, f } = L;
  const SA = G.filter((g) => g.w >= 3), SL = SA.filter((g) => g.L !== null && g.L !== undefined);
  const out = [];
  out.push('N all(w>=3)=' + SA.length + ' with line=' + SL.length);
  // line only
  const lineP = (sd) => (g) => cdf(g.L / sd);
  [11.5, 12.5, 13.5].forEach((sd) => { const s = score(SL, lineP(sd)); out.push('LINE sd' + sd + ' brier ' + f(s.brier) + ' ll ' + f(s.ll) + ' win ' + f(s.win * 100, 1) + '% rmse ' + f(rmse(SL, (g) => g.L), 2)); });
  // model-only variants
  const V = [['v23 NFL (cap14 d.85 r6 mix.5)', {}], ['margin only', { mix: 1 }], ['efficiency only', { mix: 0 }], ['mix .7', { mix: 0.7 }], ['decay .92', { decay: 0.92 }], ['decay 1.0', { decay: 1 }], ['ridge 3', { ridge: 3 }], ['ridge 10', { ridge: 10 }], ['cap 21', { cap: 21 }], ['no cap', { cap: 99 }], ['carry .5 last yr', { carry: 0.5 }], ['carry 1.0', { carry: 1 }], ['hfa 1.5', { hfa: 1.5 }], ['hfa 2.5', { hfa: 2.5 }], ['hfa 3', { hfa: 3 }]];
  const M = {};
  V.forEach(([name, o]) => { M[name] = modelMargins({ ...base, ...o }); });
  window.__BTM = M;
  const SD = 12.5;
  out.push('--- model alone, all games w>=3 (sd12.5): name | brier | ll | win% [CI] | rmse');
  V.forEach(([name]) => { const m = M[name], s = score(SA, (g) => cdf(m.get(g).mh / SD)); out.push(name + ' | ' + f(s.brier) + ' | ' + f(s.ll) + ' | ' + f(s.win * 100, 1) + ' [' + f(s.wci[0] * 100, 0) + '-' + f(s.wci[1] * 100, 0) + '] | ' + f(rmse(SA, (g) => m.get(g).mh), 2)); });
  out.push('--- same, only games with a line');
  V.forEach(([name]) => { const m = M[name], s = score(SL, (g) => cdf(m.get(g).mh / SD)); out.push(name + ' | ' + f(s.brier) + ' | ' + f(s.ll) + ' | ' + f(s.win * 100, 1) + ' | ' + f(rmse(SL, (g) => m.get(g).mh), 2)); });
  window.__EXP1 = out; return out.length;
})();
