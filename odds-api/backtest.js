// Real-data accuracy check for the sports page model (runs on Render, where ESPN is reachable).
// GET /backtest?lg=nba|nhl|ncaab|mlb&days=45&bt=14[&to=YYYYMMDD]
const PATHS = { nba: 'basketball/nba', mlb: 'baseball/mlb', nhl: 'hockey/nhl', ncaab: 'basketball/mens-college-basketball' };
const ENGS = { nba: { adv: 2.5, cap: 25, hl: 40, k: 4, rest: 1.5, thr: 3, sd: 12 }, ncaab: { adv: 3.5, cap: 30, hl: 25, k: 3, rest: 0, thr: 4, sd: 11 }, nhl: { adv: 0.25, cap: 4, hl: 45, k: 4, rest: 0.25, thr: 0.5, sd: 2.4 }, mlb: { adv: 0.3, cap: 8, hl: 70, k: 6, rest: 0, thr: 0.7, sd: 4.4 } };
const cdf = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const ymd = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
const dayOf = (t) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10); // US Central-ish day
const ml = (x) => { x = +x; return x ? (x < 0 ? -x / (-x + 100) : 100 / (x + 100)) : null; };

function parse(j, lg) {
  return (j.events || []).map((e) => {
    const c = e.competitions[0], t = e.status.type; if (t.state !== 'post' || t.completed === false) return null;
    const cs = c.competitors.map((x) => ({ abbr: x.team.abbreviation, score: parseInt(x.score, 10) || 0, home: x.homeAway === 'home' })).sort((a, b) => a.home - b.home);
    if (cs[0].score === cs[1].score) return null;
    const o = c.odds && c.odds[0]; let line = null, total = null, mlA = null, mlH = null;
    if (o) { total = o.overUnder != null ? +o.overUnder : null;
      if (o.homeTeamOdds && o.homeTeamOdds.moneyLine != null) mlH = +o.homeTeamOdds.moneyLine; if (o.awayTeamOdds && o.awayTeamOdds.moneyLine != null) mlA = +o.awayTeamOdds.moneyLine;
      if (o.spread != null && !isNaN(+o.spread) && o.homeTeamOdds && o.homeTeamOdds.favorite != null) { const s = Math.abs(+o.spread); line = o.homeTeamOdds.favorite ? s : -s; } }
    return { id: e.id, start: +new Date(e.date), home: cs[1], away: cs[0], line, total, mlA, mlH };
  }).filter(Boolean);
}
function fit(G, asOf, E) {
  if (G.length < 30) return null; let sw = 0, sp = 0;
  const W = G.map((g) => { const w = Math.pow(0.5, Math.max(0, asOf - g.start) / (E.hl * 864e5)); let hs = g.home.score, as = g.away.score; const m = hs - as; if (Math.abs(m) > E.cap) { const d = (Math.abs(m) - E.cap) / 2 * Math.sign(m); hs -= d; as += d; } sw += 2 * w; sp += w * (hs + as); return { w, h: g.home.abbr, a: g.away.abbr, hs, as }; });
  const mu = sp / sw, off = {}, def = {}; W.forEach((x) => { off[x.h] = off[x.a] = def[x.h] = def[x.a] = 0; });
  for (let it = 0; it < 40; it++) { const no = {}, nd = {}, s2 = {};
    W.forEach((x) => { const ha = E.adv / 2; no[x.h] = (no[x.h] || 0) + x.w * (x.hs - mu - ha - def[x.a]); nd[x.a] = (nd[x.a] || 0) + x.w * (x.hs - mu - ha - off[x.h]); no[x.a] = (no[x.a] || 0) + x.w * (x.as - mu + ha - def[x.h]); nd[x.h] = (nd[x.h] || 0) + x.w * (x.as - mu + ha - off[x.a]); s2[x.h] = (s2[x.h] || 0) + x.w; s2[x.a] = (s2[x.a] || 0) + x.w; });
    Object.keys(off).forEach((t) => { off[t] = (no[t] || 0) / (s2[t] + E.k); def[t] = (nd[t] || 0) / (s2[t] + E.k); }); }
  return { mu, off, def };
}
async function getJson(u) { const r = await fetch(u, { headers: { 'user-agent': 'oddable-backtest' } }); if (!r.ok) throw new Error('espn ' + r.status); return r.json(); }

async function run(lg, days, bt, to) {
  const E = ENGS[lg], path = PATHS[lg]; if (!E) throw new Error('lg must be nba|nhl|ncaab|mlb');
  const end = to ? new Date(Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8))) : new Date();
  const ds = []; for (let k = 0; k < days; k++) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - k); ds.push(ymd(d)); }
  const games = {}; let fail = 0;
  for (let i = 0; i < ds.length; i += 8) await Promise.all(ds.slice(i, i + 8).map(async (x) => { try { parse(await getJson('https://site.api.espn.com/apis/site/v2/sports/' + path + '/scoreboard?dates=' + x + '&limit=400' + (lg === 'ncaab' ? '&groups=50' : '')), lg).forEach((g) => { games[g.id] = g; }); } catch (e) { fail++; } }));
  const H = Object.values(games).sort((a, b) => a.start - b.start);
  const dayList = [...new Set(H.map((g) => dayOf(g.start)))].sort().slice(-bt);
  const S = { games: 0, model: 0, market: 0, mktN: 0, blend: 0, blendN: 0, mae: 0, mktMae: 0, atsN: 0, atsHit: 0, ats3N: 0, ats3Hit: 0, totN: 0, totHit: 0, brM: 0, brK: 0, brB: 0, bN: 0 };
  const b2b = (abbr, start, prior) => { const y = dayOf(start - 864e5); return prior.some((g) => (g.home.abbr === abbr || g.away.abbr === abbr) && dayOf(g.start) === y); };
  dayList.forEach((d) => {
    const t0 = +new Date(d + 'T06:00:00Z'), prior = H.filter((g) => g.start < t0), M = fit(prior, t0, E); if (!M) return;
    H.filter((g) => dayOf(g.start) === d).forEach((g) => {
      const h = g.home.abbr, a = g.away.abbr; if (M.off[h] === undefined || M.off[a] === undefined) return;
      let eh = M.mu + E.adv / 2 + M.off[h] + M.def[a], ea = M.mu - E.adv / 2 + M.off[a] + M.def[h];
      if (E.rest) { const bh = b2b(h, g.start, prior), ba = b2b(a, g.start, prior); if (bh && !ba) { eh -= E.rest / 2; ea += E.rest / 2; } else if (ba && !bh) { eh += E.rest / 2; ea -= E.rest / 2; } }
      const mm = eh - ea, tot = eh + ea, am = g.home.score - g.away.score, atot = g.home.score + g.away.score, pm = cdf(mm / E.sd), homeWon = am > 0 ? 1 : 0;
      S.games++; if ((mm > 0) === (am > 0)) S.model++; S.mae += Math.abs(mm - am);
      let pk = null; const aP = ml(g.mlA), hP = ml(g.mlH); if (aP && hP) pk = hP / (aP + hP); else if (g.line !== null) pk = cdf(g.line / E.sd);
      if (pk !== null) { S.mktN++; if ((pk > 0.5) === (am > 0)) S.market++; const pb = 0.8 * pk + 0.2 * pm; S.blendN++; if ((pb > 0.5) === (am > 0)) S.blend++; S.bN++; S.brM += (pm - homeWon) ** 2; S.brK += (pk - homeWon) ** 2; S.brB += (pb - homeWon) ** 2; }
      if (g.line !== null) { S.mktMae += Math.abs(g.line - am); if (am !== g.line) { S.atsN++; const homeCover = mm > g.line; if (homeCover === (am > g.line)) S.atsHit++; if (Math.abs(mm - g.line) >= E.thr) { S.ats3N++; if (homeCover === (am > g.line)) S.ats3Hit++; } } }
      if (g.total !== null && Math.abs(tot - g.total) >= E.thr && atot !== g.total) { S.totN++; if ((tot > g.total) === (atot > g.total)) S.totHit++; }
    });
  });
  const pc = (a, n) => (n ? +(a / n * 100).toFixed(1) : null), f = (x, n) => (n ? +(x / n).toFixed(3) : null);
  return { lg, gamesFetched: H.length, fetchFailures: fail, testedDays: dayList.length, tested: S.games,
    winnerPct: { model: pc(S.model, S.games), market_favorite: pc(S.market, S.mktN), blend_80_20: pc(S.blend, S.blendN) },
    marginErr: { model: f(S.mae, S.games), market: f(S.mktMae, S.atsN + 0) },
    brier_lowerIsBetter: { model: f(S.brM, S.bN), market: f(S.brK, S.bN), blend: f(S.brB, S.bN) },
    againstTheSpread: { all: { n: S.atsN, hitPct: pc(S.atsHit, S.atsN) }, bigEdge: { n: S.ats3N, hitPct: pc(S.ats3Hit, S.ats3N), edgeAtLeast: E.thr } },
    totalsLean: { n: S.totN, hitPct: pc(S.totHit, S.totN) }, note: 'walk-forward: model refit before each tested day; market numbers are ESPN closing lines' };
}
module.exports = { run };
