// Player-level backtest (run in a page holding window.__BTLIB from bt.js and window.__PC from the ESPN collector below).
// COLLECTOR (ESPN scoreboard seasontype=2 weeks 1-18 for 2021-2026, then /summary?event=ID boxscore.players):
//   per team-game keeps pass [id,att,yds,td,int], rush [id,car,yds,td], rec [id,rec,yds,td,tgt], def [id,tot,sacks,tfl,pd].
// PLAYER GAME SCORE (value above average): QB yds-6.5*att+20td-45int (att>=10); RB yds-4.2*car+15td (car>=5);
//   WR/TE yds-6.5*tgt+15td (tgt>=3); defender 6*sacks+3*tfl+3*pd+0.3*tot.
// Player rating = prior sum/(prior games+4). Team talent D = sum of ratings of players in the lineup.
// V = sum over lineup of (player's shrunk avg vs THIS opponent - rating); W = same vs opponent's DIVISION (shrink 3).
// Lineup A = players who appeared in this game (optimistic: slight look-ahead, e.g. in-game injuries).
// Lineup B = the team's previous game lineup (no look-ahead).
// All ratings/history update only AFTER each game is predicted, games in kickoff order.
// Regression: walk-forward ridge OLS on strictly earlier games. +LINE: (margin - line) ~ features, min 100 prior line games.
//   NOLINE: margin ~ features + home flag, min 150 prior games. Win prob = cdf(margin/12.5).
(function () {
  const { G, score, rmse, ats, pairedDiff, cdf, f } = window.__BTLIB; const PG = Object.values(__PC.games).sort((a, b) => a.t - b.t);
  const DIV = { AFC_E: ['BUF', 'MIA', 'NE', 'NYJ'], AFC_N: ['BAL', 'CIN', 'CLE', 'PIT'], AFC_S: ['HOU', 'IND', 'JAX', 'TEN'], AFC_W: ['DEN', 'KC', 'LV', 'LAC'], NFC_E: ['DAL', 'NYG', 'PHI', 'WSH'], NFC_N: ['CHI', 'DET', 'GB', 'MIN'], NFC_S: ['ATL', 'CAR', 'NO', 'TB'], NFC_W: ['ARI', 'LAR', 'SF', 'SEA'] };
  const dv = {}; Object.entries(DIV).forEach(([d, ts]) => ts.forEach((t) => (dv[t] = d)));
  const nt = (t) => (t === 'WAS' ? 'WSH' : t); const lm = {}; G.forEach((g) => (lm[g.y + '|' + nt(g.h) + '|' + nt(g.a)] = g));
  const sc = { pass: (r) => (r[1] >= 10 ? r[2] - 6.5 * r[1] + 20 * r[3] - 45 * r[4] : null), rush: (r) => (r[1] >= 5 ? r[2] - 4.2 * r[1] + 15 * r[3] : null), rec: (r) => (r[4] >= 3 ? r[2] - 6.5 * r[4] + 15 * r[3] : null), def: (r) => 6 * r[2] + 3 * r[3] + 3 * r[4] + 0.3 * r[1] };
  const K = 4, K2 = 3, hist = {}, last = {}, rows = [];
  const lineupOf = (p, team) => { const o = p.p[team], L = []; if (!o) return L; ['pass', 'rush', 'rec', 'def'].forEach((c) => o[c].forEach((r) => { const s = sc[c](r); if (s !== null) L.push([r[0] + '|' + c, s]); })); return L; };
  function feat(lineup, opp) { let D = 0, V = 0, W = 0; const od = dv[opp]; lineup.forEach((k) => { const h = hist[k]; if (!h) return; const r = h.s / (h.n + K); D += r; const t = h.vsT[opp]; if (t) V += t.s / (t.n + K2) - r; const d = h.vsD[od]; if (d) W += d.s / (d.n + K2) - r; }); return [D, V, W]; }
  PG.forEach((p) => {
    const g = lm[p.y + '|' + nt(p.h) + '|' + nt(p.a)], Lh = lineupOf(p, p.h), La = lineupOf(p, p.a), kh = Lh.map((x) => x[0]), ka = La.map((x) => x[0]);
    const fa = [feat(kh, p.a), feat(ka, p.h)], fb = [feat(last[p.h] || [], p.a), feat(last[p.a] || [], p.h)];
    rows.push({ g, p, A: [0, 1, 2].map((i) => fa[0][i] - fa[1][i]), B: [0, 1, 2].map((i) => fb[0][i] - fb[1][i]), y: p.hs - p.as, w: p.w, yr: p.y, L: g ? g.L : null, neutral: g ? g.n : 0 });
    [[Lh, p.a, p.h], [La, p.h, p.a]].forEach(([L, opp, team]) => { L.forEach(([k, s]) => { const h = (hist[k] = hist[k] || { n: 0, s: 0, vsT: {}, vsD: {} }); h.n++; h.s += s; const t = (h.vsT[opp] = h.vsT[opp] || { n: 0, s: 0 }); t.n++; t.s += s; const d = (h.vsD[dv[opp]] = h.vsD[dv[opp]] || { n: 0, s: 0 }); d.n++; d.s += s; }); last[team] = L.map((x) => x[0]); });
  });
  window.__PR = rows;
})();
// Evaluation (walk-forward OLS wf(), score/ats/pairedDiff from bt.js) was run inline; see HANDOFF.md for results.

// ---- PLAYER STRENGTH REGRESSION (adjusted plus-minus style), run after the collector ----
// Every player who recorded any pass/rush/rec/defensive stat in a game is "in the lineup". Model: margin = hfa + sum(beta of home lineup) - sum(beta of away lineup).
// Ridge (lambda 30/100/300) fit by coordinate descent (5 warm-started sweeps) on ALL earlier games (2021 onward), refit after each (season, week) batch.
// Predictions for a batch are made BEFORE that batch is added to training. Lineup A = players who appeared in the game (optimistic), B = team's previous-game lineup (no look-ahead).
// Evaluated only on games with a closing line, week>=3, >=300 prior training games (n=434). Compared with line-only (sd 12.5) by paired Brier difference; blends 90/10, 80/20; walk-forward learned b; ATS vs line.
/* code (run inline in page):
const ids=(p,team)=>{const o=p.p[team],s=new Set();if(!o)return[];['pass','rush','rec','def'].forEach(c=>o[c].forEach(r=>s.add(r[0])));return[...s]};
gs=PG.map(p=>({p,H:ids(p,p.h),A:ids(p,p.a),y:p.hs-p.as,yr:p.y,w:p.w,t:p.t})); batches grouped by yr|w, in kickoff order;
for each batch: predict (A: this game's ids, B: last[team] ids) with current beta+hfa; push batch to train; rebuild byPlayer index; r=y-hfa-sum(H beta)+sum(A beta);
5 sweeps: for each player i: bn=sum(s*(r+s*bo))/(count+lambda); update r; then hfa+=mean(r), r-=mean(r). */
