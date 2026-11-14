// Walk-forward NFL backtest of every Oddable model version plus candidate algorithms.
// Data rows: [season, week, kickoffSec, home, away, homeScore, awayScore, neutral, line(home-favored +), hYPP, aYPP, hTO, aTO]
// RULE: every prediction for a game in (season y, week w) uses ONLY games from earlier weeks of season y (and, for carry variants, season y-1 final ratings). Nothing from the game itself or later.
(function () {
  const raw = (typeof DATA !== 'undefined' ? DATA : JSON.parse(window.name.slice(6, -5)));
  const G = raw.map((r) => ({ y: r[0], w: r[1], t: r[2], h: r[3], a: r[4], hs: r[5], as: r[6], n: r[7], L: r[8], hy: r[9], ay: r[10], ht: r[11], at: r[12] })).sort((p, q) => p.t - q.t);
  const cdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
  const clip = (p) => Math.min(0.99, Math.max(0.01, p));
  const base = { hfa: 2.0, cap: 14, decay: 0.85, ridge: 6, mix: 0.5, effK: 4, carry: 0 };
  // ---- team ratings from a list of finished games, as seen from week wc (same maths as the app's buildRatings / buildEff) ----
  function ratings(games, wc, P, prior) {
    const R = {}, n = {}, keys = new Set(Object.keys(prior || {}));
    games.forEach((g) => { keys.add(g.h); keys.add(g.a); });
    const wg = (g) => Math.pow(P.decay, Math.max(0, wc - g.w));
    games.forEach((g) => { const k = wg(g); n[g.h] = (n[g.h] || 0) + k; n[g.a] = (n[g.a] || 0) + k; });
    const pr = {}; keys.forEach((k) => { pr[k] = P.carry * ((prior && prior[k]) || 0); R[k] = pr[k]; });
    for (let it = 0; it < 25; it++) {
      const sum = {};
      games.forEach((g) => { const d = Math.max(-P.cap, Math.min(P.cap, g.hs - g.as)) - (g.n ? 0 : P.hfa), k = wg(g); sum[g.h] = (sum[g.h] || 0) + k * (d + R[g.a]); sum[g.a] = (sum[g.a] || 0) + k * (-d + R[g.h]); });
      keys.forEach((k) => (R[k] = ((sum[k] || 0) + P.ridge * pr[k]) / ((n[k] || 0) + P.ridge)));
    }
    const E = {}, tot = {}, ne = {};
    games.forEach((g) => { if (!g.hy || !g.ay) return; const d = 8 * (g.hy - g.ay) + 4 * (g.at - g.ht), k = wg(g); tot[g.h] = (tot[g.h] || 0) + k * d; tot[g.a] = (tot[g.a] || 0) - k * d; ne[g.h] = (ne[g.h] || 0) + k; ne[g.a] = (ne[g.a] || 0) + k; });
    Object.keys(ne).forEach((k) => (E[k] = tot[k] / (ne[k] + P.effK)));
    return { R, E };
  }
  const bySeason = {}; G.forEach((g) => (bySeason[g.y] = bySeason[g.y] || []).push(g));
  const years = Object.keys(bySeason).map(Number).sort();
  const finalPrior = {}; // season-end ratings, for carry variants
  function prepCarry(P) { years.forEach((y) => { finalPrior[y + '|' + JSON.stringify(P)] = ratings(bySeason[y], 19, { ...P, carry: 0 }).R; }); }
  // ---- model margin for every game (walk-forward) under settings P ----
  function modelMargins(P) {
    const out = new Map();
    if (P.carry) prepCarry(P);
    years.forEach((y) => {
      const gs = bySeason[y], weeks = [...new Set(gs.map((g) => g.w))].sort((a, b) => a - b);
      const prior = P.carry && finalPrior[y - 1 + '|' + JSON.stringify(P)];
      weeks.forEach((w) => {
        const past = gs.filter((g) => g.w < w), { R, E } = ratings(past, w, P, prior || null);
        gs.filter((g) => g.w === w).forEach((g) => {
          const hfa = g.n ? 0 : P.hfa, mM = (R[g.h] || 0) - (R[g.a] || 0) + hfa, ok = E[g.h] !== undefined && E[g.a] !== undefined, mE = ok ? E[g.h] - E[g.a] + hfa : null;
          out.set(g, { mM, mE, mh: mE === null ? mM : P.mix * mM + (1 - P.mix) * mE, nPast: past.length });
        });
      });
    });
    return out;
  }
  // ---- Elo-style margin rating run strictly in time order; carry regresses toward 0 between seasons ----
  function eloMargins(k, hfa, regress) {
    const out = new Map(), r = {}; let cy = null;
    G.forEach((g) => {
      if (g.y !== cy) { Object.keys(r).forEach((t) => (r[t] *= 1 - regress)); cy = g.y; }
      const h = g.n ? 0 : hfa, m = (r[g.h] || 0) - (r[g.a] || 0) + h; out.set(g, { mh: m, mM: m, mE: null });
      const err = Math.max(-21, Math.min(21, g.hs - g.as)) - m; r[g.h] = (r[g.h] || 0) + k * err; r[g.a] = (r[g.a] || 0) - k * err;
    });
    return out;
  }
  // ---- scoring ----
  const wilson = (x, n) => { if (!n) return [0, 0]; const p = x / n, z = 1.96, d = 1 + z * z / n, c = p + z * z / (2 * n), s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - s) / d, (c + s) / d]; };
  const sel = (gs, minW) => gs.filter((g) => g.w >= minW);
  // probs: fn(g) -> P(home wins). Returns brier/logloss/win% (ties excluded) and per-game brier for paired tests
  function score(gs, prob) {
    let b = 0, ll = 0, c = 0, n = 0; const per = [];
    gs.forEach((g) => { if (g.hs === g.as) return; const y = g.hs > g.as ? 1 : 0, p = clip(prob(g)); const bb = (p - y) * (p - y); b += bb; ll -= Math.log(y ? p : 1 - p); if ((p >= 0.5) === (y === 1)) c++; n++; per.push(bb); });
    return { n, brier: b / n, ll: ll / n, win: c / n, wci: wilson(c, n), per };
  }
  function rmse(gs, pm) { let s = 0, n = 0; gs.forEach((g) => { const m = pm(g); if (m === null || m === undefined) return; s += (g.hs - g.as - m) ** 2; n++; }); return Math.sqrt(s / n); }
  function ats(gs, side) { // side(g) -> +1 home, -1 away, 0 skip; line L is home-favored points
    let w = 0, l = 0;
    gs.forEach((g) => { if (g.L === null || g.L === undefined) return; const s = side(g); if (!s) return; const cm = g.hs - g.as - g.L; if (cm === 0) return; if ((cm > 0 ? 1 : -1) === s) w++; else l++; });
    const n = w + l, roi = n ? (w * (100 / 110) - l) / n : 0; return { n, w, l, pct: n ? w / n : 0, ci: wilson(w, n), roi };
  }
  function pairedDiff(a, b) { const n = a.length; let m = 0; for (let i = 0; i < n; i++) m += a[i] - b[i]; m /= n; let v = 0; for (let i = 0; i < n; i++) v += (a[i] - b[i] - m) ** 2; return { d: m, se: Math.sqrt(v / (n - 1) / n) }; }
  const f = (x, d) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d === undefined ? 4 : d));
  window.__BTLIB = { G, years, base, modelMargins, eloMargins, score, rmse, ats, pairedDiff, wilson, cdf, clip, sel, f };
  return { games: G.length, withLine: G.filter((g) => g.L !== null && g.L !== undefined).length, years };
})();
