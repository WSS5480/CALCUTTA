// 🤝 Helper on the server: the week's highest win-chance team (straight-up).
// A Node port of the NFL win pick in pics/index.html (buildRatings + buildEff + the win-chance half of pred()), so the server, not a phone, picks the Helper.
// KEEP IN STEP with pics/index.html: HFA 2.0, CAP 14, DECAY 0.85, RIDGE 6, MIXM 0.5, SD 12.5, W_MKT 0.9, and the same cdf() approximation.
// Injuries are not used: in the app's default mode ('qb') they move the spread pick only, never the win chance.
const HFA = 2.0, CAP = 14, DECAY = 0.85, RIDGE = 6, MIXM = 0.5, SD = 12.5, W_MKT = 0.9;
const cdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const clamp = (p) => Math.min(0.99, Math.max(0.01, p));
// games: [{id, week, state, neutral, home:{abbr,score}, away:{abbr,score}}]; cur = ESPN's current week (recent games count more); bx: {gameId: [homeYpp, homeTurnovers, awayYpp, awayTurnovers]}
function ratings(games, cur, bx) {
  const wgt = (g) => Math.pow(DECAY, Math.max(0, (cur || g.week) - g.week));
  const fin = games.filter((g) => g.state === 'post' && (g.home.score || g.away.score)), RAT = {}, n = {}, EFF = {};
  fin.forEach((g) => { const k = wgt(g); n[g.home.abbr] = (n[g.home.abbr] || 0) + k; n[g.away.abbr] = (n[g.away.abbr] || 0) + k; RAT[g.home.abbr] = 0; RAT[g.away.abbr] = 0; });
  const keys = Object.keys(RAT);
  for (let it = 0; it < 25; it++) {
    const sum = {};
    fin.forEach((g) => { const d = Math.max(-CAP, Math.min(CAP, g.home.score - g.away.score)) - (g.neutral ? 0 : HFA), k = wgt(g); sum[g.home.abbr] = (sum[g.home.abbr] || 0) + k * (d + RAT[g.away.abbr]); sum[g.away.abbr] = (sum[g.away.abbr] || 0) + k * (-d + RAT[g.home.abbr]); });
    keys.forEach((k) => (RAT[k] = (sum[k] || 0) / ((n[k] || 0) + RIDGE)));
  }
  const tot = {}, m = {};
  games.forEach((g) => { const b = g.state === 'post' && bx && bx[g.id]; if (!b || !b[0] || !b[2]) return; const d = 8 * (b[0] - b[2]) + 4 * (b[3] - b[1]), k = wgt(g); tot[g.home.abbr] = (tot[g.home.abbr] || 0) + k * d; tot[g.away.abbr] = (tot[g.away.abbr] || 0) - k * d; m[g.home.abbr] = (m[g.home.abbr] || 0) + k; m[g.away.abbr] = (m[g.away.abbr] || 0) + k; });
  Object.keys(m).forEach((k) => (EFF[k] = tot[k] / (m[k] + 4)));
  return { RAT, EFF };
}
// Home win chance: 90% what the spread implies, 10% the ratings (ratings alone when there is no line). line = points the HOME team is favored by.
function win(g, line, R) {
  const hfa = g.neutral ? 0 : HFA, mM = (R.RAT[g.home.abbr] || 0) - (R.RAT[g.away.abbr] || 0) + hfa;
  const mE = R.EFF[g.home.abbr] !== undefined && R.EFF[g.away.abbr] !== undefined ? R.EFF[g.home.abbr] - R.EFF[g.away.abbr] + hfa : null;
  const mh = mE === null ? mM : MIXM * mM + (1 - MIXM) * mE, phModel = clamp(cdf(mh / SD));
  const phMkt = line === null || line === undefined ? null : clamp(cdf(line / SD)), ph = phMkt === null ? phModel : W_MKT * phMkt + (1 - W_MKT) * phModel, pa = 1 - ph;
  return { abbr: pa >= 0.5 ? g.away.abbr : g.home.abbr, conf: Math.max(pa, ph), ph };
}
// The week's Helper: wg = that week's games, lineOf(g) = the line to use for each
function best(wg, lineOf, R) { let b = null; wg.forEach((g) => { const w = win(g, lineOf(g), R); if (w.conf && (!b || w.conf > b.conf)) b = { id: String(g.id), abbr: w.abbr, conf: Math.round(w.conf * 1e4) / 1e4 }; }); return b; }
// ESPN game summary -> [homeYpp, homeTurnovers, awayYpp, awayTurnovers] (same reading as parseBox() in the app), or null when the box score is missing
function box(summary, g, ab) {
  const o = {}; ((summary && summary.boxscore && summary.boxscore.teams) || []).forEach((t) => { const m = {}; (t.statistics || []).forEach((q) => (m[q.name] = q.displayValue)); const plays = (parseInt(((m.completionAttempts || '').split('/')[1]), 10) || 0) + (parseInt(m.rushingAttempts, 10) || 0); if (t.team) o[ab(t.team.abbreviation)] = [parseFloat(m.yardsPerPlay) || (plays ? Math.round((parseFloat(m.totalYards) / plays) * 10) / 10 : 0) || 0, parseInt(m.turnovers, 10) || 0]; });
  const h = o[g.home.abbr], a = o[g.away.abbr]; return h && a ? [h[0], h[1], a[0], a[1]] : null;
}
module.exports = { ratings, win, best, box, cdf };
