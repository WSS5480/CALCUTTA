// Oddable Alert, frozen once for everyone: the week's Lock, the division road dogs (with the model %) and the Helper.
// The first signed-in phone that posts a week stores it; a stored week is NEVER overwritten; every phone reads the stored copy.
// Same persistence as locks.js: one row in oddable_sync (id 'lock:alert26'; the 'lock:' prefix keeps it out of player lists), written with an
// optimistic check on `updated` so two phones posting at once cannot both win.
// Guard rails: only the week ESPN calls the current regular-season week of SEASON is accepted, every game id must be in that week,
// and the teams must match ESPN's. The model numbers themselves cannot be checked here (the model runs in the app).
const SEASON = 2026, ID = 'lock:alert26';
const D = { S: require('./sync'), fetch: (...a) => fetch(...a), check: (req) => require('./acct').check(req), now: () => Date.now() };
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const half = (x) => num(x) && Math.abs(x) <= 40 && Number.isInteger(x * 2);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }, ab = (x) => FIX[String(x)] || String(x); // the same team-name fixes the app applies to ESPN's abbreviations (pics/index.html FIX)
let SC = null;
// ESPN's current week: its number, and each game's kickoff and teams.
async function sched() {
  if (SC && D.now() - SC.at < 5 * 6e4) return SC.v;
  try {
    const r = await D.fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=400', { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('espn ' + r.status);
    const j = await r.json(), games = {};
    (j.events || []).forEach((e) => { const c = (e.competitions || [])[0] || {}, t = Date.parse(e.date), h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away'); if (e.id && Number.isFinite(t) && h && a && h.team && a.team) games[String(e.id)] = { t, home: ab(h.team.abbreviation), away: ab(a.team.abbreviation) }; });
    if (!j.week || !j.season || !Object.keys(games).length) throw new Error('espn empty');
    SC = { at: D.now(), v: { week: +j.week.number, type: +j.season.type, year: +j.season.year, games } }; return SC.v;
  } catch (e) { if (SC) return SC.v; throw Object.assign(new Error('schedule unavailable'), { status: 503 }); }
}
// Returns the cleaned record, or a string saying what is wrong.
function clean(rec, sc, now) {
  if (!rec || typeof rec !== 'object') return 'no record';
  const G = sc.games, out = { lock: null, dogs: [], helper: null };
  if (rec.lock) { const l = rec.lock, g = G[String(l.id)]; if (!g) return 'lock: game not in this week'; if (l.abbr !== g.home && l.abbr !== g.away) return 'lock: team not in that game'; if (!half(l.line) || !num(l.conf) || l.conf < 0.5 || l.conf > 1) return 'lock: bad numbers'; out.lock = { id: String(l.id), rank: 2, abbr: l.abbr, other: l.abbr === g.home ? g.away : g.home, line: l.line, conf: r4(l.conf), dog: !!l.dog }; }
  if (!Array.isArray(rec.dogs) || rec.dogs.length > 16) return 'dogs: bad list';
  const seen = {};
  for (const d of rec.dogs) { const g = d && G[String(d.id)]; if (!g) return 'dog: game not in this week'; if (seen[d.id]) return 'dog: listed twice'; seen[d.id] = 1; if (!half(d.line) || d.line <= 0 || !num(d.p) || d.p <= 0 || d.p >= 1) return 'dog: bad numbers'; out.dogs.push({ id: String(d.id), abbr: g.away, home: g.home, line: d.line, p: r4(d.p) }); }
  if (rec.helper) { const h = rec.helper, g = G[String(h.id)]; if (!g) return 'helper: game not in this week'; if (h.abbr !== g.home && h.abbr !== g.away) return 'helper: team not in that game'; if (!num(h.conf) || h.conf < 0.5 || h.conf > 1) return 'helper: bad numbers'; out.helper = { id: String(h.id), abbr: h.abbr, conf: r4(h.conf) }; }
  if (!out.lock || !out.helper) return 'need the Lock and the Helper';
  out.t = now; out.pre = now < Math.min(...Object.values(G).map((g) => g.t)); // pre = frozen before the week's first kickoff
  return out;
}
function body(req) { return new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 20000) rej(Object.assign(new Error('too big'), { status: 413 })); else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(Object.assign(new Error('bad json'), { status: 400 })); } }); req.on('error', rej); }); }
let cache = null; const rl = new Map();
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/alert') return false;
  try {
    if (req.method === 'GET') {
      if (cache && D.now() - cache.at < 20000) { send(res, 200, { season: SEASON, weeks: cache.weeks }); return true; }
      const row = await D.S.dbGet(ID), weeks = (row && row.data && row.data.weeks) || {}; cache = { at: D.now(), weeks }; send(res, 200, { season: SEASON, weeks }); return true;
    }
    if (req.method !== 'POST') return false;
    const ip = require('./ip').clientIp(req), k = ip + ':' + Math.floor(D.now() / 6e4); rl.set(k, (rl.get(k) || 0) + 1); if (rl.size > 5000) rl.clear();
    if (rl.get(k) > 20) { send(res, 429, { error: 'slow down' }); return true; }
    if (!(await D.check(req))) { send(res, 401, { error: 'Sign in again' }); return true; } // only signed-in accounts can freeze a week
    const b = await body(req), wk = b.week;
    if (!Number.isInteger(wk) || wk < 1 || wk > 18) { send(res, 400, { error: 'bad week' }); return true; }
    const sc = await sched(), now = D.now();
    if (sc.year !== SEASON || sc.type !== 2 || sc.week !== wk) { send(res, 409, { error: 'not the current week', current: sc.type === 2 && sc.year === SEASON ? sc.week : null }); return true; }
    const rec = clean(b.rec, sc, now); if (typeof rec === 'string') { send(res, 400, { error: rec }); return true; }
    for (let tries = 0; tries < 4; tries++) {
      let row = await D.S.dbGet(ID); if (!row) { await D.S.dbPut({ id: ID, salt: 'x', pinhash: 'x', data: { weeks: {} }, updated: 1 }, true); row = await D.S.dbGet(ID); if (!row) continue; }
      const weeks = Object.assign({}, (row.data && row.data.weeks) || {});
      if (weeks[wk]) { send(res, 200, { week: wk, rec: weeks[wk], created: false }); return true; } // already frozen: never overwritten
      weeks[wk] = rec;
      if (await D.S.dbPatchIf(ID, row.updated, { weeks }, Math.max(now, Number(row.updated || 0) + 1))) { cache = null; send(res, 200, { week: wk, rec, created: true }); return true; }
    }
    send(res, 503, { error: 'busy, try again' }); return true;
  } catch (e) { send(res, e.status || 500, { error: e.status ? e.message : 'Alert error' }); return true; }
}
module.exports = { handle, clean, _deps: D, _reset: () => { SC = null; cache = null; rl.clear(); } };
