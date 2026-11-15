// College walk-forward backtest: does a factor model beat -110 on FBS spreads? Reads CFBD_API_KEY from env; never echoes it.
const KEY = () => process.env.CFBD_API_KEY || '';
const CACHE = {}, TTL = 24 * 3600e3;
async function lines(year) {
  const c = CACHE[year]; if (c && Date.now() - c.t < TTL) return c.v;
  const r = await fetch('https://api.collegefootballdata.com/lines?year=' + year + '&seasonType=regular', { headers: { Authorization: 'Bearer ' + KEY() } });
  if (!r.ok) throw new Error('CFBD ' + r.status + ' for ' + year);
  const j = await r.json(), out = [];
  for (const g of j) {
    if (g.homeScore == null || g.awayScore == null) continue;
    const L = (g.lines || []).filter((l) => l.spread !== null && l.spread !== undefined && l.spread !== '');
    if (!L.length) continue;
    const pick = L.find((l) => /consensus/i.test(l.provider)) || L[0], sp = Number(pick.spread);
    if (!isFinite(sp)) continue;
    if (g.homeClassification && g.homeClassification !== 'fbs') continue;
    if (g.awayClassification && g.awayClassification !== 'fbs') continue;
    out.push({ y: year, wk: g.week, t: Date.parse(g.startDate) || 0, h: g.homeTeam, a: g.awayTeam, hc: g.homeConference || '', ac: g.awayConference || '', hp: g.homeScore, ap: g.awayScore, line: -sp }); // line>0: home favored
  }
  out.sort((x, y) => x.wk - y.wk || x.t - y.t);
  CACHE[year] = { t: Date.now(), v: out }; return out;
}
// features per game from each team's earlier games the same season
function feats(games) {
  const S = {}, rows = [];
  const st = (tm) => S[tm] || (S[tm] = { n: 0, w: 0, last: null, lm: 0, lc: 0, t: 0 });
  for (const g of games) {
    const fav = g.line > 0 ? 'h' : 'a', L = Math.abs(g.line), dogHome = fav === 'a', dN = dogHome ? g.h : g.a, fN = dogHome ? g.a : g.h, d = st(dN), f = st(fN);
    const rest = (s) => (s.t && g.t ? Math.min(21, Math.max(3, Math.round((g.t - s.t) / 864e5))) : 7);
    const dm = (dogHome ? g.hp - g.ap : g.ap - g.hp), cover = dm + L; // dog margin plus points
    rows.push({ g, x: [L, dogHome ? 1 : 0, d.lm, f.lm, d.lc, f.lc, d.n ? d.w / d.n : 0.5, f.n ? f.w / f.n : 0.5, rest(d), rest(f), Math.min(g.wk, 14) / 14, L * (dogHome ? 1 : 0)], y: cover > 0 ? 1 : cover < 0 ? 0 : -1, cover });
    const upd = (s, m, cm) => { s.n++; if (m > 0) s.w++; s.lm = m; s.lc = cm; s.t = g.t; };
    const hm = g.hp - g.ap; upd(st(g.h), hm, hm - g.line); upd(st(g.a), -hm, -hm + g.line);
  }
  return rows;
}
function fit(X, y, C) {
  const n = X.length, k = X[0].length, mu = Array(k).fill(0), sd = Array(k).fill(0);
  X.forEach((r) => r.forEach((v, j) => (mu[j] += v / n))); X.forEach((r) => r.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / n))); sd.forEach((v, j) => (sd[j] = Math.sqrt(v) || 1));
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])); let w = Array(k).fill(0), b = 0;
  for (let it = 0; it < 400; it++) { const gw = Array(k).fill(0); let gb = 0; for (let i = 0; i < n; i++) { let s = b; for (let j = 0; j < k; j++) s += w[j] * Z[i][j]; const e = 1 / (1 + Math.exp(-s)) - y[i]; gb += e; for (let j = 0; j < k; j++) gw[j] += e * Z[i][j]; } b -= (0.5 * gb) / n; for (let j = 0; j < k; j++) w[j] -= (0.5 * (gw[j] / n + w[j] / (C * n))); }
  return (x) => { let s = b; for (let j = 0; j < k; j++) s += w[j] * ((x[j] - mu[j]) / sd[j]); return 1 / (1 + Math.exp(-s)); };
}
async function run(y0 = 2014, y1 = 2025, C = 0.05) {
  const by = {}; for (let y = y0 - 3; y <= y1; y++) by[y] = feats(await lines(y));
  const res = [], T = { a: [0, 0, 0], b: [0, 0, 0] }, base = [0, 0];
  for (let y = y0; y <= y1; y++) {
    const tr = []; for (let z = y0 - 3; z < y; z++) by[z].forEach((r) => r.y >= 0 && tr.push(r));
    const m = fit(tr.map((r) => r.x), tr.map((r) => r.y), C), te = by[y], wks = {};
    te.forEach((r) => { r.p = m(r.x); r.conf = Math.max(r.p, 1 - r.p); (wks[r.g.wk] = wks[r.g.wk] || []).push(r); });
    const A = [0, 0, 0], B = [0, 0, 0];
    Object.values(wks).forEach((arr) => { arr.sort((p, q) => q.conf - p.conf); arr.slice(0, 2).forEach((r, i) => { const pickDog = r.p >= 0.5, o = r.y < 0 ? 2 : (pickDog ? r.y === 1 : r.y === 0) ? 0 : 1; (i ? B : A)[o]++; }); });
    te.forEach((r) => { if (r.y >= 0) { base[0] += r.y; base[1]++; } });
    for (let i = 0; i < 3; i++) { T.a[i] += A[i]; T.b[i] += B[i]; }
    res.push({ year: y, train: tr.length, games: te.length, double: A.join('-'), lock: B.join('-') });
  }
  const both = [T.a[0] + T.b[0], T.a[1] + T.b[1], T.a[2] + T.b[2]], units = both[0] * 100 / 110 - both[1];
  return { note: 'record is W-L-push; break-even at -110 is 52.38%; all picks from a model trained only on earlier seasons', byYear: res, double: T.a.join('-'), lock: T.b.join('-'), both: both.join('-'), bothPct: +(both[0] / (both[0] + both[1]) * 100).toFixed(1), units: +units.toFixed(1), dogCoverRate: +(base[0] / base[1] * 100).toFixed(1), games: base[1] };
}

// Replica of the app's CURRENT college spread pick (margin power ratings + last-season carry). Left out because CFBD lines lack them: AP-rank prior, yards-per-play efficiency, neutral-site flag.
const HFA = 3.5, CAPM = 100, DECAY = 0.95, RIDGE = 1;
function finalRatings(gs) {
  const R = {}, n = {}; gs.forEach((g) => { n[g.h] = (n[g.h] || 0) + 1; n[g.a] = (n[g.a] || 0) + 1; R[g.h] = 0; R[g.a] = 0; });
  for (let it = 0; it < 25; it++) { const sm = {}; gs.forEach((g) => { const d = Math.max(-CAPM, Math.min(CAPM, g.hp - g.ap)) - HFA; sm[g.h] = (sm[g.h] || 0) + d + R[g.a]; sm[g.a] = (sm[g.a] || 0) - d + R[g.h]; }); Object.keys(n).forEach((k) => (R[k] = (sm[k] || 0) / (n[k] + RIDGE))); }
  return R;
}
function weekRatings(prev, fin, cur) {
  const RAT = {}, n = {}, keys = new Set(Object.keys(prev)), w = (g) => Math.pow(DECAY, Math.max(0, cur - g.wk));
  fin.forEach((g) => { const k = w(g); n[g.h] = (n[g.h] || 0) + k; n[g.a] = (n[g.a] || 0) + k; keys.add(g.h); keys.add(g.a); });
  keys.forEach((k) => (RAT[k] = prev[k] || 0));
  for (let it = 0; it < 25; it++) { const sum = {}; fin.forEach((g) => { const d = Math.max(-CAPM, Math.min(CAPM, g.hp - g.ap)) - HFA, k = w(g); sum[g.h] = (sum[g.h] || 0) + k * (d + RAT[g.a]); sum[g.a] = (sum[g.a] || 0) + k * (-d + RAT[g.h]); }); keys.forEach((k) => (RAT[k] = ((sum[k] || 0) + RIDGE * (prev[k] || 0)) / ((n[k] || 0) + RIDGE))); }
  return RAT;
}
async function runCurrent(y0 = 2014, y1 = 2025) {
  const B = (e) => ({ w: 0, l: 0, p: 0, e }), buckets = [B(0), B(3), B(5), B(7), B(10)], top = [0, 0, 0], top2 = [0, 0, 0], yr = [];
  for (let y = y0; y <= y1; y++) {
    const prev = finalRatings(await lines(y - 1)), gs = await lines(y), wks = [...new Set(gs.map((g) => g.wk))].sort((a, b) => a - b), Y = [0, 0, 0];
    for (const wk of wks) {
      const RAT = weekRatings(prev, gs.filter((g) => g.wk < wk), wk), rows = [];
      gs.filter((g) => g.wk === wk).forEach((g) => { const mh = (RAT[g.h] || 0) - (RAT[g.a] || 0) + HFA, homeCover = mh > g.line, m = g.hp - g.ap, cov = m - g.line, o = cov === 0 ? 2 : (homeCover ? cov > 0 : cov < 0) ? 0 : 1; rows.push({ edge: Math.abs(mh - g.line), o }); });
      rows.forEach((r) => buckets.forEach((b) => { if (r.edge >= b.e) { if (r.o === 0) b.w++; else if (r.o === 1) b.l++; else b.p++; } }));
      rows.sort((a, b) => b.edge - a.edge); rows.slice(0, 2).forEach((r, i) => { (i ? top2 : top)[r.o]++; Y[r.o]++; });
    }
    yr.push({ year: y, top2perWeek: Y.join('-') });
  }
  const f = (a) => ({ record: a.join('-'), pct: +(a[0] / (a[0] + a[1]) * 100).toFixed(1) });
  return { note: 'current app college model replica, spread picks vs closing consensus; W-L-push; break-even 52.38%', allPicks: buckets.map((b) => ({ edgeAtLeast: b.e, ...f([b.w, b.l, b.p]), units: +(b.w * 100 / 110 - b.l).toFixed(1) })), topEdgeEachWeek: f(top), secondEdgeEachWeek: f(top2), byYear: yr };
}

async function runConf(y0 = 2014, y1 = 2025) {
  const C = {}, add = (k, edge, o) => { const c = C[k] || (C[k] = { all: [0, 0, 0], e3: [0, 0, 0], e7: [0, 0, 0] }); c.all[o]++; if (edge >= 3) c.e3[o]++; if (edge >= 7) c.e7[o]++; };
  for (let y = y0; y <= y1; y++) {
    const prev = finalRatings(await lines(y - 1)), gs = await lines(y), wks = [...new Set(gs.map((g) => g.wk))].sort((a, b) => a - b);
    for (const wk of wks) {
      const RAT = weekRatings(prev, gs.filter((g) => g.wk < wk), wk);
      gs.filter((g) => g.wk === wk).forEach((g) => { const mh = (RAT[g.h] || 0) - (RAT[g.a] || 0) + HFA, homeCover = mh > g.line, cov = g.hp - g.ap - g.line, o = cov === 0 ? 2 : (homeCover ? cov > 0 : cov < 0) ? 0 : 1, edge = Math.abs(mh - g.line), k = g.hc && g.hc === g.ac ? g.hc : 'Non-conference (' + (g.hc || '?') + ' host)'; add(g.hc && g.hc === g.ac ? k : 'Non-conference (all)', edge, o); if (g.hc && g.hc === g.ac) add('(all conference games)', edge, o); });
    }
  }
  const f = (a) => ({ rec: a.join('-'), pct: a[0] + a[1] ? +(a[0] / (a[0] + a[1]) * 100).toFixed(1) : null });
  return Object.entries(C).map(([k, c]) => ({ conf: k, n: c.all[0] + c.all[1] + c.all[2], all: f(c.all), edge3plus: f(c.e3), edge7plus: f(c.e7) })).sort((a, b) => b.n - a.n);
}

async function runSlices(y0 = 2014, y1 = 2025) {
  const S = {}, Y = {}, add = (k, y, o) => { (S[k] = S[k] || [0, 0, 0])[o]++; const q = (Y[k] = Y[k] || {}); (q[y] = q[y] || [0, 0, 0])[o]++; };
  for (let y = y0; y <= y1; y++) for (const g of await lines(y)) {
    if (g.line === 0) continue; const awayDog = g.line > 0, cov = awayDog ? g.line + (g.ap - g.hp) : -g.line + (g.hp - g.ap), o = cov > 0 ? 0 : cov < 0 ? 1 : 2, same = g.hc && g.hc === g.ac, side = awayDog ? 'road dog' : 'home dog', small = Math.abs(g.line) <= 7 ? ' (spread<=7)' : '';
    add((same ? 'conference game, ' : 'non-conference, ') + side, y, o); if (small) add((same ? 'conference game, ' : 'non-conference, ') + side + small, y, o);
    if (same) add(g.hc + ', ' + side, y, o);
  }
  const f = (a) => ({ rec: a.join('-'), pct: a[0] + a[1] ? +(a[0] / (a[0] + a[1]) * 100).toFixed(1) : null, units: +(a[0] * 100 / 110 - a[1]).toFixed(1), n: a[0] + a[1] + a[2] });
  return Object.keys(S).map((k) => { const ys = Object.entries(Y[k]).filter(([, a]) => a[0] + a[1] >= 5), up = ys.filter(([, a]) => a[0] / (a[0] + a[1]) > 0.5238).length; return { slice: k, ...f(S[k]), seasonsAbove: up + '/' + ys.length }; }).sort((a, b) => b.pct - a.pct);
}
let CT = null, CU = null, CC = null, CS = null;
async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
  if (!KEY()) { res.statusCode = 503; res.end('{"error":"CFBD_API_KEY not set"}'); return true; }
  const q = new URL(req.url, 'http://x').searchParams;
  if (req.url.startsWith('/cfbd/backtest')) { try { if (!CT || Date.now() - CT.t > 3600e3 || q.get('fresh')) CT = { t: Date.now(), v: await run(Math.max(2014, +q.get('from') || 2014), Math.min(2025, +q.get('to') || 2025), +q.get('c') || 0.05) }; res.end(JSON.stringify(CT.v, null, 1)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/slices')) { try { if (!CS || Date.now() - CS.t > 3600e3) CS = { t: Date.now(), v: await runSlices() }; res.end(JSON.stringify(CS.v)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/conf')) { try { if (!CC || Date.now() - CC.t > 3600e3) CC = { t: Date.now(), v: await runConf() }; res.end(JSON.stringify(CC.v)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/current')) { try { if (!CU || Date.now() - CU.t > 3600e3) CU = { t: Date.now(), v: await runCurrent() }; res.end(JSON.stringify(CU.v, null, 1)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  res.statusCode = 404; res.end('{"error":"not found"}'); return true;
}
module.exports = { handle, run, feats, fit };
