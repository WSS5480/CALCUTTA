// v301 ⚡ Sir Oddable's Edge, card C ("Windy unders"): GET /wx/nfl (public, read-only, no key).
// For every UPCOMING NFL game of ESPN's current week it answers the National Weather Service hourly forecast wind at kickoff for the home stadium.
// - Forecast source: api.weather.gov (free, no key; NWS asks for a descriptive User-Agent, so it is fetched HERE, never from the phone).
// - Stadium coordinates and roofs: the app's own STAD table (pics/index.html, v216 wind feature), copied below. Dome / fixed roof = skipped.
//   Retractable roofs (ARI, ATL, DAL, HOU, IND) = "roof may be closed: not counted" (the roof's state is not known before kickoff).
//   ESPN venue.indoor = true also skips a game; a neutral-site game is skipped (the coordinates would be the wrong stadium).
// - Cache: 60 minutes per stadium (the gridpoint lookup 24 h). Any failure = that game is "na" ("forecast not available"), never a guess;
//   a failed stadium is asked again after 5 minutes. A kickoff past the end of the forecast = "later" (forecast not out yet).
// - Live record: the latest forecast pulled BEFORE kickoff is kept per game in ONE row of oddable_sync (id 'lock:wx26'; the 'lock:' prefix keeps it
//   out of player lists; same helpers as alert.js), with the total ESPN showed at that pull. `past` = those rows for games that have kicked off.
//   Without SUPABASE_URL / SUPABASE_KEY it is memory only (a restart forgets it).
// The existing open-meteo wind chip in the app is NOT touched by this file.
const SEASON = 2026, ROW = 'lock:wx26', HOUR = 36e5;
const D = { S: require('./sync'), fetch: (...a) => fetch(...a), now: () => Date.now(), hasDb: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY) };
const UA = () => process.env.WX_UA || 'Oddable weather lookup (calcutta-odds.onrender.com)';
const SRC = 'National Weather Service hourly forecast (api.weather.gov)';
// [lat, lon, indoor] exactly as pics/index.html STAD (1 = indoor or roof; 0 = open air)
const STAD = { ARI: [33.53, -112.26, 1], ATL: [33.76, -84.4, 1], BAL: [39.28, -76.62, 0], BUF: [42.77, -78.79, 0], CAR: [35.23, -80.85, 0], CHI: [41.86, -87.62, 0], CIN: [39.1, -84.52, 0], CLE: [41.51, -81.7, 0], DAL: [32.75, -97.09, 1], DEN: [39.74, -105.02, 0], DET: [42.34, -83.05, 1], GB: [44.5, -88.06, 0], HOU: [29.68, -95.41, 1], IND: [39.76, -86.16, 1], JAX: [30.32, -81.64, 0], KC: [39.05, -94.48, 0], LV: [36.09, -115.18, 1], LAC: [33.95, -118.34, 1], LAR: [33.95, -118.34, 1], MIA: [25.96, -80.24, 0], MIN: [44.97, -93.26, 1], NE: [42.09, -71.26, 0], NO: [29.95, -90.08, 1], NYG: [40.81, -74.07, 0], NYJ: [40.81, -74.07, 0], PHI: [39.9, -75.17, 0], PIT: [40.45, -80.02, 0], SF: [37.4, -121.97, 0], SEA: [47.6, -122.33, 0], TB: [27.98, -82.5, 0], TEN: [36.17, -86.77, 0], WAS: [38.91, -76.86, 0], WSH: [38.91, -76.86, 0] };
const RETRACT = new Set(['ARI', 'ATL', 'DAL', 'HOU', 'IND']);
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }, ab = (x) => FIX[String(x)] || String(x);
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', code === 200 ? 'public, max-age=300' : 'no-store'); res.end(JSON.stringify(o)); };

function roofOf(home, indoor) {
  const st = STAD[home]; if (!st) return 'unknown';
  if (RETRACT.has(home)) return 'retract';
  if (st[2] || indoor === true) return 'dome';
  return 'open';
}
// NWS windSpeed: "12 mph", "5 to 10 mph" (a range counts as its LOWER end: only flagged when even the low end is 10+), "15 km/h",
// or the gridpoint form { unitCode: 'wmoUnit:km_h-1' | 'wmoUnit:mph', value }. Anything else = null (not available).
function parseWind(w) {
  if (w && typeof w === 'object') { const v = Number(w.value); if (w.value === null || !Number.isFinite(v)) return null; if (/km_h-1$/.test(String(w.unitCode))) return v / 1.609344; if (/mph$|mi_h-1$/.test(String(w.unitCode))) return v; return null; }
  const m = /^\s*(\d+(?:\.\d+)?)(?:\s*to\s*(\d+(?:\.\d+)?))?\s*(mph|km\/h)\s*$/i.exec(String(w == null ? '' : w)); if (!m) return null;
  const v = parseFloat(m[1]); return /km/i.test(m[3]) ? v / 1.609344 : v;
}
// hourly periods -> the wind in mph for the period holding kickoff, or { later: true } when the forecast ends before kickoff, or null
function windAt(periods, ko) {
  if (!Array.isArray(periods) || !periods.length) return null; let last = 0;
  for (const p of periods) {
    const a = Date.parse(p && p.startTime), b = Date.parse(p && p.endTime); if (!Number.isFinite(a) || !Number.isFinite(b)) continue; if (b > last) last = b;
    if (a <= ko && ko < b) { const v = parseWind(p.windSpeed); return v === null ? null : { mph: Math.round(v * 10) / 10 }; }
  }
  return last && ko >= last ? { later: true } : null;
}
const C = {}, PTS = {}, FLY = {};
async function getJson(url) {
  const r = await D.fetch(url, { headers: { 'User-Agent': UA(), Accept: 'application/geo+json' }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('nws ' + r.status); return r.json();
}
// one stadium's hourly forecast periods (cached 60 min; a failure is kept 5 min so a broken NWS is not asked on every request)
async function periodsFor(key, lat, lon) {
  const c = C[key], now = D.now(); if (c && now - c.at < (c.ok ? HOUR : 5 * 6e4)) return c;
  if (FLY[key]) return FLY[key];
  FLY[key] = (async () => {
    try {
      let fu = PTS[key] && now - PTS[key].at < 24 * HOUR ? PTS[key].url : null;
      if (!fu) { const j = await getJson('https://api.weather.gov/points/' + lat.toFixed(4) + ',' + lon.toFixed(4)); fu = j && j.properties && j.properties.forecastHourly; if (typeof fu !== 'string' || !/^https:\/\/api\.weather\.gov\//.test(fu)) throw new Error('no hourly url'); PTS[key] = { at: now, url: fu }; }
      const j = await getJson(fu), periods = j && j.properties && j.properties.periods; if (!Array.isArray(periods) || !periods.length) throw new Error('no periods');
      C[key] = { ok: true, at: now, periods: periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime, windSpeed: p.windSpeed })) };
    } catch (e) { C[key] = { ok: false, at: now }; }
    return C[key];
  })();
  try { return await FLY[key]; } finally { delete FLY[key]; }
}
let SC = null;
async function sched() {
  if (SC && D.now() - SC.at < 5 * 6e4) return SC.v;
  const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=400', { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('espn ' + r.status);
  const j = await r.json(), games = [];
  (j.events || []).forEach((e) => {
    const c = (e.competitions || [])[0] || {}, t = Date.parse(e.date), h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away'), o = (c.odds || [])[0];
    if (!e.id || !Number.isFinite(t) || !h || !a || !h.team || !a.team) return;
    games.push({ id: String(e.id), ko: t, home: ab(h.team.abbreviation), away: ab(a.team.abbreviation), state: ((e.status || {}).type || {}).state || '', neutral: !!c.neutralSite, indoor: c.venue && c.venue.indoor !== undefined ? !!c.venue.indoor : null, tot: o && Number.isFinite(+o.overUnder) && o.overUnder !== null && o.overUnder !== '' ? +o.overUnder : null });
  });
  SC = { at: D.now(), v: { week: +((j.week || {}).number) || 0, type: +((j.season || {}).type) || 0, year: +((j.season || {}).year) || 0, games } }; return SC.v;
}
// ---- the stored forecasts (live record) ----
let MEM = { g: {} }, MEMAT = 0;
async function storeRead() {
  if (!D.hasDb()) return MEM;
  if (MEMAT && D.now() - MEMAT < 60e3) return MEM;
  try { const row = await D.S.dbGet(ROW); MEM = (row && row.data && row.data.g) ? { g: row.data.g, updated: row.updated } : { g: {}, updated: row ? row.updated : null, none: !row }; MEMAT = D.now(); } catch (e) {}
  return MEM;
}
async function storeAdd(add) {
  const ids = Object.keys(add); if (!ids.length) return;
  const apply = (g) => { const out = Object.assign({}, g); let ch = false; ids.forEach((id) => { const x = add[id], o = out[id]; if (!o || x.at > o.at) { out[id] = x; ch = true; } }); return ch ? out : null; };
  if (!D.hasDb()) { const n = apply(MEM.g); if (n) MEM = { g: n }; return; }
  try {
    for (let tries = 0; tries < 3; tries++) {
      let row = await D.S.dbGet(ROW);
      if (!row) { await D.S.dbPut({ id: ROW, salt: 'x', pinhash: 'x', data: { g: {} }, updated: 1 }, true); row = await D.S.dbGet(ROW); if (!row) return; }
      const n = apply((row.data && row.data.g) || {}); if (!n) { MEM = { g: (row.data && row.data.g) || {}, updated: row.updated }; MEMAT = D.now(); return; }
      const upd = Math.max(D.now(), Number(row.updated || 0) + 1);
      if (await D.S.dbPatchIf(ROW, row.updated, { g: n }, upd)) { MEM = { g: n, updated: upd }; MEMAT = D.now(); return; }
    }
  } catch (e) { console.error('wx store:', e && e.message); }
}
// ---- the answer ----
async function report() {
  const sc = await sched(), now = D.now(), out = [], keep = {};
  const up = sc.games.filter((g) => g.state === 'pre' && g.ko > now);
  await Promise.all(up.map(async (g) => {
    const base = { id: g.id, away: g.away, home: g.home, ko: g.ko, tot: g.tot };
    if (g.neutral) return out.push(Object.assign(base, { roof: 'neutral', status: 'skip', note: 'Neutral site: not counted' }));
    const roof = roofOf(g.home, g.indoor);
    if (roof === 'unknown') return out.push(Object.assign(base, { roof, status: 'na', note: 'Forecast not available' }));
    if (roof === 'dome') return out.push(Object.assign(base, { roof, status: 'skip', note: 'Dome or closed roof: not counted' }));
    if (roof === 'retract') return out.push(Object.assign(base, { roof, status: 'skip', note: 'Roof may be closed: not counted' }));
    const st = STAD[g.home], key = st[0] + ',' + st[1], c = await periodsFor(key, st[0], st[1]);
    const w = c && c.ok ? windAt(c.periods, g.ko) : null;
    if (w && w.later) return out.push(Object.assign(base, { roof, status: 'later', note: 'Forecast not out yet' }));
    if (!w) return out.push(Object.assign(base, { roof, status: 'na', note: 'Forecast not available' }));
    out.push(Object.assign(base, { roof, status: 'ok', mph: w.mph, pulled: c.at }));
    if (sc.year === SEASON && sc.type === 2 && c.at < g.ko) keep[g.id] = { mph: w.mph, at: c.at, ko: g.ko, tot: g.tot, h: g.home, a: g.away, wk: sc.week };
  }));
  await storeAdd(keep);
  const S = await storeRead(), past = Object.keys(S.g || {}).filter((id) => { const x = S.g[id]; return x && x.at < x.ko && x.ko <= now; }).map((id) => Object.assign({ id }, S.g[id]));
  out.sort((a, b) => a.ko - b.ko || (a.id < b.id ? -1 : 1));
  return { ok: true, src: SRC, at: now, season: sc.year, type: sc.type, week: sc.week, stored: D.hasDb(), games: out, past };
}
const rl = new Map();
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/wx/nfl') return false;
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET'); res.end(); return true; }
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
  const ip = require('./ip').clientIp(req), k = ip + ':' + Math.floor(D.now() / 6e4); rl.set(k, (rl.get(k) || 0) + 1); if (rl.size > 5000) rl.clear();
  if (rl.get(k) > 30) { send(res, 429, { ok: false, error: 'slow down' }); return true; }
  try { send(res, 200, await report()); } catch (e) { send(res, 502, { ok: false, error: 'Forecast not available right now' }); }
  return true;
}
module.exports = { handle, report, parseWind, windAt, roofOf, STAD, RETRACT, ROW, _deps: D, _reset: () => { SC = null; MEM = { g: {} }; MEMAT = 0; rl.clear(); Object.keys(C).forEach((k) => delete C[k]); Object.keys(PTS).forEach((k) => delete PTS[k]); } };
