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
    out.push({ y: year, wk: g.week, t: Date.parse(g.startDate) || 0, h: g.homeTeam, a: g.awayTeam, hp: g.homeScore, ap: g.awayScore, line: -sp }); // line>0: home favored
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
let CT = null;
async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
  if (!KEY()) { res.statusCode = 503; res.end('{"error":"CFBD_API_KEY not set"}'); return true; }
  const q = new URL(req.url, 'http://x').searchParams;
  if (req.url.startsWith('/cfbd/backtest')) { try { if (!CT || Date.now() - CT.t > 3600e3 || q.get('fresh')) CT = { t: Date.now(), v: await run(Math.max(2014, +q.get('from') || 2014), Math.min(2025, +q.get('to') || 2025), +q.get('c') || 0.05) }; res.end(JSON.stringify(CT.v, null, 1)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  res.statusCode = 404; res.end('{"error":"not found"}'); return true;
}
module.exports = { handle, run, feats, fit };
