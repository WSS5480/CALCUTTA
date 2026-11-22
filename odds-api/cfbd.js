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
    const ml = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && isFinite(n) && Math.abs(n) >= 100 ? n : null; };
    let hml = ml(pick.homeMoneyline), aml = ml(pick.awayMoneyline); // price: the spread provider's moneyline, else the first other provider that has both sides
    if (hml === null || aml === null) { hml = aml = null; for (const l of L.concat((g.lines || []).filter((x) => !L.includes(x)))) { const h = ml(l.homeMoneyline), a = ml(l.awayMoneyline); if (h !== null && a !== null) { hml = h; aml = a; break; } } }
    out.push({ y: year, wk: g.week, hml, aml, t: Date.parse(g.startDate) || 0, h: g.homeTeam, a: g.awayTeam, hc: g.homeConference || '', ac: g.awayConference || '', hp: g.homeScore, ap: g.awayScore, line: -sp }); // line>0: home favored
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

// ---- /cfbd/parlay: STATS REPORT ONLY. Walk-forward backtest of a "3-game favorites parlay" (college via CFBD, NFL via nflverse games.csv). No user-facing feature.
const PB = { th: 0.75, perParlay: 3, ranks: 5, cfb: { hfa: HFA, decay: DECAY, ridge: RIDGE, cap: CAPM, line: 0.8, sigma: 16 }, nfl: { hfa: 2, cap: 14, decay: 0.85, ridge: 6, line: 0.9, sigma: 12.5 }, nflFrom: 2006, cfbFrom: 2013, minGames: 300 };
const NFL_URL = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
function erf(x) { const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a); return s * y; }
const pcdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const decOdds = (ml) => (ml === null || ml === undefined ? null : ml > 0 ? 1 + ml / 100 : 1 + 100 / -ml);
const DAYF = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }); } catch (e) { return null; } })();
// betting week = Tuesday 00:00 to Monday 23:59 US Central; key = day number of that Tuesday
function weekKeyDay(y, m, d) { const dn = Math.floor(Date.UTC(y, m - 1, d) / 864e5), dow = (dn + 4) % 7; return dn - ((dow - 2 + 7) % 7); }
function weekKeyMs(ms) { if (!ms) return null; let y, m, d; if (DAYF) { const o = {}; DAYF.formatToParts(new Date(ms)).forEach((p) => (o[p.type] = p.value)); y = +o.year; m = +o.month; d = +o.day; } else { const t = new Date(ms - 6 * 3600e3); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); } return weekKeyDay(y, m, d); }
function weekKeyStr(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? weekKeyDay(+m[1], +m[2], +m[3]) : null; }
function legOf(src, y, id, team, p, won, push, ml, wkey) { return { src, y, id, team, p, won, push, o: decOdds(ml), wkey }; }
// college legs: ratings once per season-week from EARLIER weeks only (+ last season's final ratings), line blended 80/20 at margin level, win chance = cdf(blend / sigma)
function collegeLegs(by, years) {
  const C = PB.cfb, legs = [], seasons = [], skipped = []; let noDate = 0;
  for (const y of years) {
    const gs = by[y] || []; if (gs.length < PB.minGames) { if (gs.length) skipped.push(y); continue; }
    seasons.push(y); const prev = finalRatings(by[y - 1] || []), wks = [...new Set(gs.map((g) => g.wk))].sort((a, b) => a - b);
    for (const wk of wks) {
      const RAT = weekRatings(prev, gs.filter((g) => g.wk < wk), wk);
      for (const g of gs) {
        if (g.wk !== wk) continue; const wkey = weekKeyMs(g.t); if (wkey === null) { noDate++; continue; }
        const mh = (RAT[g.h] || 0) - (RAT[g.a] || 0) + C.hfa, m = C.line * g.line + (1 - C.line) * mh, ph = pcdf(m / C.sigma), home = ph >= 0.5;
        legs.push(legOf('cfb', y, 'c|' + y + '|' + g.wk + '|' + g.h + '|' + g.a, home ? g.h : g.a, home ? ph : 1 - ph, home ? g.hp > g.ap : g.ap > g.hp, g.hp === g.ap, home ? g.hml : g.aml, wkey));
      }
    }
  }
  return { legs, seasons, skipped, noDate };
}
function csvLine(l) { const o = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } o.push(c); return o; }
function parseCsv(t) { const ls = t.split(/\r?\n/).filter(Boolean), H = csvLine(ls[0]), rows = []; for (let i = 1; i < ls.length; i++) { const f = csvLine(ls[i]), r = {}; H.forEach((h, j) => (r[h] = f[j])); rows.push(r); } return rows; }
const numOrNull = (v) => (v === undefined || v === null || v === '' || !isFinite(Number(v)) ? null : Number(v));
function nflRatings(games, wc) { // same maths as the offline reference (bt.py): cap, decay per week, ridge toward 0, home edge off on neutral sites
  const C = PB.nfl, R = new Map(), n = new Map(), kk = (g) => Math.pow(C.decay, Math.max(0, wc - g.w));
  for (const g of games) { const k = kk(g); n.set(g.h, (n.get(g.h) || 0) + k); n.set(g.a, (n.get(g.a) || 0) + k); }
  let cur = R;
  for (let it = 0; it < 25; it++) { const s = new Map(); for (const g of games) { const k = kk(g), d = Math.max(-C.cap, Math.min(C.cap, g.hs - g.as)) - (g.n ? 0 : C.hfa); s.set(g.h, (s.get(g.h) || 0) + k * (d + (cur.get(g.a) || 0))); s.set(g.a, (s.get(g.a) || 0) + k * (-d + (cur.get(g.h) || 0))); } const nx = new Map(); for (const [t, v] of n) nx.set(t, (s.get(t) || 0) / (v + C.ridge)); cur = nx; }
  return cur;
}
function nflLegs(rows) {
  const C = PB.nfl, all = [], by = {}, gm = [];
  for (const r of rows) { const y = +r.season, w = +r.week, hs = numOrNull(r.home_score), as = numOrNull(r.away_score); if (!(y >= PB.nflFrom - 1) || hs === null || as === null || !r.home_team || !r.away_team) continue; const g = { y, w, h: r.home_team, a: r.away_team, hs, as, n: r.location !== 'Home', L: numOrNull(r.spread_line), hml: numOrNull(r.home_moneyline), aml: numOrNull(r.away_moneyline), day: r.gameday }; (by[y] = by[y] || []).push(g); if (y >= PB.nflFrom && g.L !== null) gm.push(g); }
  const cache = {}, legs = [], seasons = new Set(); let noDate = 0;
  for (const g of gm) {
    const key = g.y + '|' + g.w; if (!cache[key]) cache[key] = nflRatings(by[g.y].filter((x) => x.w < g.w), g.w);
    const R = cache[key], wkey = weekKeyStr(g.day); if (wkey === null) { noDate++; continue; }
    const mm = (R.get(g.h) || 0) - (R.get(g.a) || 0) + (g.n ? 0 : C.hfa), ph = pcdf((C.line * g.L + (1 - C.line) * mm) / C.sigma), home = ph >= 0.5, ml = home ? g.hml : g.aml;
    seasons.add(g.y); legs.push(legOf('nfl', g.y, 'n|' + g.y + '|' + g.w + '|' + g.h + '|' + g.a, home ? g.h : g.a, home ? ph : 1 - ph, home ? g.hs > g.as : g.as > g.hs, g.hs === g.as, ml !== null && Math.abs(ml) >= 100 ? ml : null, wkey));
  }
  return { legs, seasons: [...seasons].sort((a, b) => a - b), noDate };
}
const r1 = (x) => (x === null || !isFinite(x) ? null : Math.round(x * 10) / 10), r2 = (x) => (x === null || !isFinite(x) ? null : Math.round(x * 100) / 100), r3 = (x) => (x === null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
function legStats(all) {
  const q = all.filter((l) => l.p >= PB.th), pr = q.filter((l) => l.o !== null), w = pr.filter((l) => l.won).length, pu = pr.filter((l) => l.push).length, lo = pr.length - w - pu;
  const u = pr.reduce((a, l) => a + (l.won ? l.o - 1 : l.push ? 0 : -1), 0), n = pr.length;
  return { qualifying: q.length, priced: n, noPrice: q.length - n, won: w, lost: lo, pushed: pu, winPct: w + lo ? r1((w / (w + lo)) * 100) : null, avgModelPct: n ? r1((pr.reduce((a, l) => a + l.p, 0) / n) * 100) : null, avgDecimal: n ? r3(pr.reduce((a, l) => a + l.o, 0) / n) : null, singleUnits: r2(u), singleRoiPct: n ? r1((u / n) * 100) : null };
}
function weekMap(legs) { const m = new Map(), seen = new Set(); for (const l of legs) { if (l.o === null || l.p < PB.th || seen.has(l.id)) continue; seen.add(l.id); if (!m.has(l.wkey)) m.set(l.wkey, []); m.get(l.wkey).push(l); } for (const a of m.values()) a.sort((x, y) => y.p - x.p || (x.id < y.id ? -1 : 1)); return m; }
function rankStats(wm, rank, ok) {
  const per = {}; let n = 0, w = 0, l = 0, pu = 0, u = 0, pay = 0;
  for (const ls of wm.values()) {
    const sl = ls.slice((rank - 1) * PB.perParlay, rank * PB.perParlay); if (sl.length < PB.perParlay) continue; const y = sl[0].y; if (ok && !ok(y)) continue;
    const mult = sl.reduce((a, x) => a * (x.push ? 1 : x.o), 1), lost = sl.some((x) => !x.won && !x.push), allPush = sl.every((x) => x.push), un = lost ? -1 : mult - 1, s = per[y] || (per[y] = { season: y, parlays: 0, won: 0, lost: 0, units: 0 });
    n++; s.parlays++; pay += mult; u += un; s.units += un; if (lost) { l++; s.lost++; } else if (allPush) pu++; else { w++; s.won++; }
  }
  const avg = n ? pay / n : null;
  return { rank, parlays: n, won: w, lost: l, pushed: pu, winPct: w + l ? r1((w / (w + l)) * 100) : null, units: r2(u), roiPct: n ? r1((u / n) * 100) : null, avgPayoutMultiple: r2(avg), breakEvenPct: avg ? r1(100 / avg) : null, bySeason: Object.values(per).sort((a, b) => a.season - b.season).map((s) => ({ season: s.season, record: s.won + '-' + s.lost, parlays: s.parlays, won: s.won, lost: s.lost, units: r2(s.units) })) };
}
// Top-N parlay (one per week from the N most likely legs), for the owner's 3 / 6 / 9 question. Same pricing rules as rankStats.
function sizeStats(wm, N) {
  const per = {}; let n = 0, w = 0, l = 0, u = 0, pay = 0;
  for (const ls of wm.values()) {
    if (ls.length < N) continue; const sl = ls.slice(0, N), y = sl[0].y, mult = sl.reduce((a, x) => a * (x.push ? 1 : x.o), 1), lost = sl.some((x) => !x.won && !x.push), un = lost ? -1 : mult - 1, s = per[y] || (per[y] = { w: 0, l: 0, u: 0 });
    n++; pay += mult; u += un; s.u += un; if (lost) { l++; s.l++; } else { w++; s.w++; }
  }
  return { size: N, parlays: n, won: w, lost: l, winPct: n ? r1((w / n) * 100) : null, units: r2(u), roiPct: n ? r1((u / n) * 100) : null, avgPayoutMultiple: n ? r2(pay / n) : null, bySeason: Object.keys(per).sort().map((y) => y + ':' + per[y].w + '-' + per[y].l + ' ' + (per[y].u >= 0 ? '+' : '') + r1(per[y].u)).join('  ') };
}
function poolReport(legs, seasons) {
  const set = new Set(seasons), ls = legs.filter((l) => set.has(l.y)), wm = weekMap(ls), last5 = new Set(seasons.slice(-5)), rk = [];
  for (let r = 1; r <= PB.ranks; r++) rk.push(r);
  return { seasons, sizes: [3, 6, 9].map((N) => sizeStats(wm, N)), legs: legStats(ls), ranks: rk.map((r) => rankStats(wm, r)), last5Seasons: seasons.slice(-5), last5: rk.map((r) => rankStats(wm, r, (y) => last5.has(y))) };
}
function buildReport(by, years, nflRows, nflErr) {
  const col = collegeLegs(by, years), notes = [], pools = { college: poolReport(col.legs, col.seasons) }, seasons = { college: col.seasons, nfl: [], mix: [] };
  notes.push('College: win chance = normal curve of (0.8 x closing spread + 0.2 x model margin) / 16, model margin = the replica of the app college ratings built only from earlier weeks plus last season\'s final ratings (no AP-rank prior, no yards-per-play efficiency, no neutral-site flag: CFBD lines do not carry them). The app itself blends the two win chances rather than the two margins; the difference is small.');
  notes.push('College seasons are regular season only (no bowls or playoff), FBS vs FBS games that have a score and a spread; seasons start at ' + PB.cfbFrom + ' because older CFBD lines are too thin.');
  if (col.skipped.length) notes.push('College seasons skipped for fewer than ' + PB.minGames + ' games with lines: ' + col.skipped.join(', ') + '.');
  if (col.noDate) notes.push(col.noDate + ' college games had no kickoff time and were left out.');
  if (nflRows) {
    const nf = nflLegs(nflRows); seasons.nfl = nf.seasons; pools.nfl = poolReport(nf.legs, nf.seasons);
    seasons.mix = col.seasons.filter((y) => nf.seasons.includes(y)); pools.mix = poolReport(col.legs.concat(nf.legs), seasons.mix);
    notes.push('NFL: ratings cap 14, decay 0.85 per week, ridge 6, home edge 2, 0.9 x line + 0.1 x model margin, sigma 12.5, from nflverse games.csv (seasons ' + PB.nflFrom + '+). NFL legs are placed in a betting week by the game day (the csv has no kickoff time).');
    notes.push('Mix = college and NFL legs together in the same betting week, only for seasons where both have data (' + (seasons.mix.length ? seasons.mix[0] + ' to ' + seasons.mix[seasons.mix.length - 1] : 'none') + '). The current season is partial.');
    if (nf.noDate) notes.push(nf.noDate + ' NFL games had no game day and were left out.');
  } else notes.push('NFL data could not be loaded (' + (nflErr || 'unknown error') + '), so this report is college only; the nfl and mix pools are missing.');
  notes.push('Parlay = 1 unit on legs 1-3 (#1) through 13-15 (#5) of each Tuesday to Monday Central week, legs ranked by win chance; a parlay exists only if all 3 legs have a price. A leg with no moneyline is excluded and counted in noPrice. Win % counts won and lost parlays (pushes left out); avgPayoutMultiple is the mean product of decimal prices over all parlays (a tied leg pays 1.0); break-even win % = 100 / that.');
  notes.push('Closing moneylines are the spread provider\'s (consensus first), else the first other provider with both sides. Closing lines are used, which a bettor cannot always get.');
  return { ok: true, built: new Date().toISOString(), method: { winChanceThreshold: PB.th, legsPerParlay: PB.perParlay, parlayRanks: PB.ranks, college: { source: 'CFBD lines (regular season, FBS vs FBS)', seasonsFrom: PB.cfbFrom, marketWeight: PB.cfb.line, sigma: PB.cfb.sigma, sigmaFrom: 'pics/index.html SD = CFB ? 16 : 12.5', homeEdge: PB.cfb.hfa, ratingDecayPerWeek: PB.cfb.decay, ridge: PB.cfb.ridge, marginCap: PB.cfb.cap }, nfl: { source: NFL_URL, seasonsFrom: PB.nflFrom, marketWeight: PB.nfl.line, sigma: PB.nfl.sigma, homeEdge: PB.nfl.hfa, ratingDecayPerWeek: PB.nfl.decay, ridge: PB.nfl.ridge, marginCap: PB.nfl.cap }, week: 'Tuesday 00:00 to Monday 23:59 US Central by kickoff date', stake: '1 unit per parlay' }, seasons, pools, notes };
}
function parlayLog(rep) {
  const c = (r) => [r.rank, r.parlays, r.won, r.lost, r.units, r.roiPct, r.avgPayoutMultiple], out = [];
  Object.keys(rep.pools).forEach((k, i) => { const p = rep.pools[k]; out.push('PARLAYBT' + (i + 1) + ' ' + JSON.stringify({ pool: k, seasons: p.seasons.length ? p.seasons[0] + '-' + p.seasons[p.seasons.length - 1] : '', legs: { n: p.legs.priced, noPrice: p.legs.noPrice, winPct: p.legs.winPct, modelPct: p.legs.avgModelPct, units: p.legs.singleUnits }, cols: 'rank,n,w,l,units,roi,avgPay', all: p.ranks.map(c), last5: p.last5.map(c) })); });
  Object.keys(rep.pools).forEach((k, i) => { rep.pools[k].sizes.forEach((z) => out.push('PARLAYSZ' + (i + 1) + ' ' + JSON.stringify({ pool: k, size: z.size, n: z.parlays, w: z.won, l: z.lost, winPct: z.winPct, units: z.units, roi: z.roiPct, avgPay: z.avgPayoutMultiple, bySeason: z.bySeason }))); });
  return out;
}
let NFLC = null;
async function nflRows() { if (NFLC && Date.now() - NFLC.t < 3600e3) return NFLC.v; const r = await fetch(NFL_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined }); if (!r.ok) throw new Error('nflverse ' + r.status); const v = parseCsv(await r.text()); NFLC = { t: Date.now(), v }; return v; }
async function runParlay() {
  const y1 = new Date().getUTCFullYear(), by = {}, ys = []; for (let y = PB.cfbFrom - 1; y <= y1; y++) ys.push(y);
  for (let i = 0; i < ys.length; i += 4) await Promise.all(ys.slice(i, i + 4).map(async (y) => { try { by[y] = await lines(y); } catch (e) { if (y < PB.cfbFrom) by[y] = []; else throw e; } }));
  let rows = null, err = ''; try { rows = await nflRows(); } catch (e) { err = String(e.message || e).slice(0, 80); }
  const rep = buildReport(by, ys.filter((y) => y >= PB.cfbFrom), rows, err); parlayLog(rep).forEach((l) => console.log(l)); return rep;
}
let CT = null, CU = null, CC = null, CS = null, CP = null;
async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json');
  if (!require('./acct').ownerOk(req)) { res.statusCode = 401; res.end('{"error":"Owner sign-in needed"}'); return true; } // owner only: every call spends the CFBD quota
  if (!KEY()) { res.statusCode = 503; res.end('{"error":"CFBD_API_KEY not set"}'); return true; }
  const q = new URL(req.url, 'http://x').searchParams;
  if (req.url.startsWith('/cfbd/backtest')) { try { if (!CT || Date.now() - CT.t > 3600e3 || q.get('fresh')) CT = { t: Date.now(), v: await run(Math.max(2014, +q.get('from') || 2014), Math.min(2025, +q.get('to') || 2025), +q.get('c') || 0.05) }; res.end(JSON.stringify(CT.v, null, 1)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/slices')) { try { if (!CS || Date.now() - CS.t > 3600e3) CS = { t: Date.now(), v: await runSlices() }; res.end(JSON.stringify(CS.v)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/conf')) { try { if (!CC || Date.now() - CC.t > 3600e3) CC = { t: Date.now(), v: await runConf() }; res.end(JSON.stringify(CC.v)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/parlay')) { try { if (!CP || Date.now() - CP.t > 3600e3) CP = { t: Date.now(), v: await runParlay() }; res.end(JSON.stringify(CP.v)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  if (req.url.startsWith('/cfbd/current')) { try { if (!CU || Date.now() - CU.t > 3600e3) CU = { t: Date.now(), v: await runCurrent() }; res.end(JSON.stringify(CU.v, null, 1)); } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: e.message })); } return true; }
  res.statusCode = 404; res.end('{"error":"not found"}'); return true;
}
// One-off run at boot when PARLAYBT_RUN=1 (manager reads the PARLAYBT lines in the Render logs, then removes the variable; each boot with it set spends ~15 CFBD calls).
function bootParlay() { if (process.env.PARLAYBT_RUN !== '1' || !KEY()) return; setTimeout(() => { runParlay().then((v) => { CP = { t: Date.now(), v }; console.log('PARLAYBT done'); }).catch((e) => console.log('PARLAYBT error ' + String(e && e.message || e).slice(0, 200))); }, 20000); }
module.exports = { bootParlay, handle, run, feats, fit, collegeLegs, nflLegs, buildReport, weekMap, rankStats, parseCsv, weekKeyMs };
