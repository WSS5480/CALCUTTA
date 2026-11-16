// Oddable Alert, computed and frozen ON THE SERVER (v252; v253: 1-hour freeze, each pick at its OWN game, prices, parlays). The server/database is the only source of the weekly picks.
//   FREEZE_MIN (below) = minutes before a game's kickoff when picks on that game go final. Owner, Nov 15 2026: D5 "lock at 1 hour before", D9 "Locks 1 hour before the
//   actual game ... the pick can change; if you take early you risk". The app builds all its wording from GET's markMin.
//   🔒 Lock   = the frozen factor model's second most confident cover pick of the week among games still in contention (pics/trophy.js run here in Node). Live, and can
//               move to another game, until FREEZE_MIN before ITS OWN game; a game that reaches its mark while not the Lock is out of contention. It changes game or
//               team only on a tick built from in-time information; after an outage, a restart or a late line it is carried (THE RULE, in compute()).
//   🏠 Dogs   = every division road underdog with its line and model %. Each one is live until FREEZE_MIN before its own kickoff, then final (picked at 53%+).
//   🤝 Helper = the week's highest win-chance team (helper.js), same rule as the Lock: live until FREEZE_MIN before its own game.
//   🎟 Parlays (pics/parlay.js): 2-game = Lock + highest-% picked dog; 3-game = Lock + top two dogs by model %. Each leg freezes with its own game; frozen legs stay,
//      the others can change; the parlay is final when every leg is final.
//   Prices: every line the server holds also carries the price of each side AT THAT LINE: the median price of the cached books posting exactly that number
//      (games.peek: no Odds API credit), else ESPN's price when ESPN shows the same number, else the nflverse closing price for a line taken from nflverse, else none.
//      No price = the app shows no payout (never -110).
//   Postponed / cancelled games: dropped from the computation (no new pick on them), but a pick that is already final stays in the record; a week holding such a game
//      is never marked 'done', so ESPN is re-read hourly and a rescheduled game comes back.
//   Public GET: the owner's /alert/fix `why` note is NOT returned (only time, count, source).
// Lines before a freeze, in this order: (1) the many-book consensus ALREADY cached by games.js (peek: this file never spends an Odds API credit), if it was fetched in the
// last 3 hours and before that game's kickoff; (2) ESPN's line on the scoreboard; (3) the last line this server stored for the game. Finished games (model inputs for later
// weeks) use the nflverse closing line (games.csv, re-read every 6 hours), then pics/trophy-season.json.
// Who runs it: tick() every minute from server.js, and lazily on GET /alert, so no phone has to be open. Render's free plan can sleep: if the server wakes after a mark it
// freezes then, with the last value it has. Each final part carries t (when it was frozen), pre (true = frozen before that kickoff; false = after it, shown with * in the app)
// and late (frozen more than 5 minutes after its mark).
// Stored in oddable_sync row 'lock:alert26' as { weeks: { N: record } } ('lock:' keeps it out of player lists), written with an optimistic check on `updated`.
// Record v2: { v:2, first, at, gl:{gameId:{l,s,lt,f,t,pre,late, il,ihp,iap,ips}}, lock, top:{id,conf}, lockOut, lockWait, lockGone, dogs:[], helper }. gl.il = the last number read IN TIME when a late one replaced it (Lock ranking only; grading uses l). lock.off = final on a postponed game with no game left to move to. lock.conf may be null (carried Lock the model no longer takes). A record without v (week 10 of 2026, frozen by a phone under v248) is final as it is.
// Weeks in pics/alert-frozen.json (2026 weeks 1-9, back-filled) are never recomputed; GET returns them too (src 'ship').
// Routes: GET /alert (public) · POST /alert/fix and POST /alert/run (owner only, acct.ownerOk) · POST /alert (the old phone freeze) is gone: 410.
const fs = require('fs'), path = require('path');
const Trophy = require('../pics/trophy.js'), H = require('./helper'), Parlay = require('../pics/parlay.js');
const SEASON = 2026, ID = 'lock:alert26', BXID = 'lock:bx26', FREEZE_MIN = 60, MARK = FREEZE_MIN * 6e4, GRACE = 5 * 6e4, BOOK_MAX = 3 * 3600e3, AHEAD = 9 * 864e5; // AHEAD: a week is computed once its first kickoff is within 9 days (this week and next)
const SBU = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/', NVU = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
// v253 boot safety (v252 review): a missing or empty data file must not crash calcutta-odds (this file is loaded at boot) and must never let the server recompute
// the shipped weeks after the fact. BROKEN holds the reason; while it is set tick() refuses to run and GET serves only what the database already holds.
let BROKEN = null;
const rd = (f, need) => { try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pics', f), 'utf8')); if (need && !need(j)) throw new Error('empty or wrong shape'); return j; } catch (e) { BROKEN = BROKEN || f + ': ' + e.message; return null; } };
const MODEL = rd('trophy-model.json', (j) => j && Array.isArray(j.cols) && j.cols.length), HIST = rd('trophy-hist.json', (j) => Array.isArray(j) && j.length), SHIPF = rd('alert-frozen.json', (j) => j && j.weeks && Object.keys(j.weeks).length);
try { if (!BROKEN) Trophy.init(MODEL, HIST); } catch (e) { BROKEN = 'trophy model: ' + e.message; }
if (BROKEN) console.error('alert: !!! PICKS DISABLED, data file problem: ' + BROKEN + ' (no week is computed until this is fixed and the service restarts)');
const SHIP_MAX = 10; // weeks 1-10 of 2026 are never recomputed here: 1-9 ship with the app (alert-frozen.json), 10 was frozen whole by a phone under v248
const D = {
  S: require('./sync'), fetch: (...a) => fetch(...a), now: () => Date.now(),
  ownerOk: (req) => require('./acct').ownerOk(req), // NOT acct.check(): that one answers true for everybody while the gate is off
  peek: () => require('./games').peek('nfl'), // cached many-book lines only; never triggers a paid refresh
  log: (m) => console.log('alert: ' + m),
  lines: () => null, // server.js points this at its in-memory ESPN line log (LINES)
  ship: (SHIPF && SHIPF.weeks) || {}, trs: rd('trophy-season.json', (j) => j && typeof j === 'object') || {}, shipMax: SHIP_MAX,
};
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const half = (x) => num(x) && Math.abs(x) <= 40 && Number.isInteger(x * 2);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const clone = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, x) => { a[x] = v[x]; return a; }, {}) : v)); // key order does not matter (Postgres jsonb reorders keys)
const FIX = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' }, ab = (x) => FIX[String(x)] || String(x); // the app's spelling of ESPN's abbreviations (pics/index.html FIX)
const trN = (a) => ({ LAR: 'LA', WSH: 'WAS', JAC: 'JAX' })[a] || a, kOf = (g) => g.week + '-' + trN(g.away.abbr) + '-' + trN(g.home.abbr); // key in the nflverse / shipped tables
const hhmm = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ') + 'Z';
const LOGGED = {}; const logOnce = (m) => { const n = D.now(); if (LOGGED[m] && n - LOGGED[m] < 10 * 6e4) return; LOGGED[m] = n; const ks = Object.keys(LOGGED); if (ks.length > 200) delete LOGGED[ks[0]]; D.log(m); };

// ---------- ESPN: the season's schedule, scores and scoreboard lines ----------
async function jget(u, ms) { const r = await D.fetch(u, { signal: AbortSignal.timeout(ms || 15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
const pnum = (x) => { if (x === null || x === undefined || x === '') return null; const v = /^EVEN$/i.test(String(x).trim()) ? 100 : Number(String(x).trim()); return Parlay.okPrice(v) ? v : null; };
function parseLine(text, home, away) { if (!text) return null; if (/^(EVEN|PK|PICK)/i.test(text)) return 0; const m = /^([A-Z]{2,3})\s+(-?\d+(?:\.\d+)?)$/.exec(String(text).trim()); if (!m) return null; const fav = ab(m[1]), v = Math.abs(+m[2]); return fav === home ? v : fav === away ? -v : null; }
function parse(j, wk) {
  return ((j && j.events) || []).map((e) => {
    const c = (e.competitions || [])[0] || {}, t = (e.status && e.status.type) || {}, h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away'), start = Date.parse(e.date);
    if (!e.id || !h || !a || !h.team || !a.team || !Number.isFinite(start)) return null;
    const g = { id: String(e.id), week: wk, start, state: /CANCEL|POSTPON/i.test(t.name || '') ? 'canceled' : t.state || 'pre', detail: t.shortDetail || '', neutral: !!c.neutralSite, home: { abbr: ab(h.team.abbreviation), score: parseInt(h.score, 10) || 0 }, away: { abbr: ab(a.team.abbreviation), score: parseInt(a.score, 10) || 0 } };
    const o = c.odds && c.odds[0]; g.espn = o ? parseLine(o.details, g.home.abbr, g.away.abbr) : null;
    if (o && g.espn !== null) { const ps = o.pointSpread || {}, hp = pnum(o.homeTeamOdds && o.homeTeamOdds.spreadOdds) || pnum(ps.home && ps.home.close && ps.home.close.odds), ap = pnum(o.awayTeamOdds && o.awayTeamOdds.spreadOdds) || pnum(ps.away && ps.away.close && ps.away.close.odds); if (hp && ap) g.espnP = [hp, ap]; } // ESPN's spread price for each side (shape NOT checked against a live payload: both known shapes are read)
    return g;
  }).filter(Boolean);
}
let WK = {}, HEAD = null;
// Returns { games, cur } for the 2026 regular season, or null outside it. Finished weeks are read once; live weeks every 5 minutes (every minute near a freeze mark).
async function season(now) {
  if (!HEAD || now - HEAD.at > 5 * 6e4) { try { const j = await jget(SBU + 'scoreboard'); if (!j.season || !j.week) throw new Error('espn empty'); HEAD = { at: now, year: +j.season.year, type: +j.season.type, week: +j.week.number }; } catch (e) { if (!HEAD) throw new Error('schedule unavailable (' + e.message + ')'); } }
  if (HEAD.year !== SEASON || HEAD.type < 2) return null;
  const cached = [].concat(...Object.values(WK).map((w) => w.games)), hot = cached.some((g) => g.state !== 'post' && g.state !== 'canceled' && g.start - MARK - now < 10 * 6e4 && now - g.start < 15 * 6e4);
  const todo = []; for (let w = 1; w <= 18; w++) { const c = WK[w]; if (c && c.done) continue; const soon = c && c.games.some((g) => g.state !== 'post' && g.start - now < 8 * 864e5); if (!c || now - c.at >= (hot && soon ? 55e3 : soon ? 5 * 6e4 : 60 * 6e4)) todo.push(w); }
  let i = 0; const worker = async () => { while (i < todo.length) { const w = todo[i++]; try { const games = parse(await jget(SBU + 'scoreboard?week=' + w + '&seasontype=2'), w); if (!games.length) throw new Error('no games'); WK[w] = { at: now, games, done: games.every((g) => g.state === 'post') /* v253: a week with a postponed/cancelled game is never 'done', so it is re-read hourly and a rescheduled game shows up */ }; } catch (e) { if (!WK[w]) throw new Error('week ' + w + ' unavailable (' + e.message + ')'); } } };
  await Promise.all([worker(), worker(), worker()]);
  const all = [].concat(...Object.keys(WK).map((w) => WK[w].games)), read = {}; Object.keys(WK).forEach((w) => (read[w] = WK[w].at));
  return { games: all.filter((g) => g.state !== 'canceled'), off: all.filter((g) => g.state === 'canceled'), read, cur: HEAD.type === 2 ? HEAD.week : 18 }; // off: games ESPN marks postponed/cancelled; read: when each week's schedule was last read (both for compute(), M1)
}
// ---------- nflverse closing lines for finished games (home-favored points, keyed week-away-home) ----------
let NV = null;
async function closing(now) {
  if (NV && now - NV.at < 6 * 3600e3) return NV.map;
  try {
    const r = await D.fetch(NVU, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const L = (await r.text()).split('\n'), hd = L[0].trim().split(','), ix = (n) => hd.indexOf(n), map = {}, pr = {}, c0 = ['season', 'game_type', 'week', 'away_team', 'home_team', 'home_score', 'spread_line', 'away_spread_odds', 'home_spread_odds'].map(ix); if (c0.slice(0, 7).some((x) => x < 0)) throw new Error('unexpected columns');
    L.slice(1).forEach((l) => { const c = l.split(','); if (+c[c0[0]] !== SEASON || c[c0[1]] !== 'REG' || c[c0[5]] === '' || c[c0[5]] === undefined || c[c0[6]] === '') return; const v = +c[c0[6]], k = +c[c0[2]] + '-' + c[c0[3]] + '-' + c[c0[4]]; if (!half(v)) return; map[k] = v; const ap = c0[7] >= 0 ? pnum(c[c0[7]]) : null, hp = c0[8] >= 0 ? pnum(c[c0[8]]) : null; if (ap && hp) pr[k] = [hp, ap]; });
    Object.defineProperty(map, 'pr', { value: pr, enumerable: false }); NV = { at: now, map, pr }; // closing prices ride along on the map (nv.pr), keyed like the lines
  } catch (e) { logOnce('closing lines (nflverse) unavailable: ' + e.message); if (NV) NV.at = now - 6 * 3600e3 + 30 * 6e4; else NV = { at: now - 6 * 3600e3 + 10 * 6e4, map: {}, pr: {} }; }
  return NV.map;
}
// ---------- box scores (yards per play, turnovers) for the Helper's ratings: read once per finished game, kept in row 'lock:bx26' ----------
let BX = null;
async function boxes(games) {
  if (!BX) { const r = await D.S.dbGet(BXID); BX = { map: (r && r.data && r.data.bx) || {}, has: !!r, tries: {}, dirty: false }; }
  const need = games.filter((g) => g.state === 'post' && BX.map[g.id] === undefined && (BX.tries[g.id] || 0) < 3).slice(0, 12); let got = 0, i = 0;
  const worker = async () => { while (i < need.length) { const g = need[i++]; BX.tries[g.id] = (BX.tries[g.id] || 0) + 1; try { const b = H.box(await jget(SBU + 'summary?event=' + g.id, 20000), g, ab); if (b) { BX.map[g.id] = b; got++; BX.dirty = true; } } catch (e) { logOnce('box score unavailable: ' + e.message); } } };
  await Promise.all([worker(), worker(), worker()]);
  if (BX.dirty) { try { if (!BX.has) { await D.S.dbPut({ id: BXID, salt: 'x', pinhash: 'x', data: { bx: {} }, updated: 1 }, true); BX.has = true; } const r = await D.S.dbGet(BXID); if (r) await D.S.dbPatchIf(BXID, r.updated, { bx: Object.assign({}, (r.data && r.data.bx) || {}, BX.map) }, Math.max(D.now(), Number(r.updated || 0) + 1)) && (BX.dirty = false); } catch (e) { logOnce('box score save failed: ' + e.message); } }
  return { map: BX.map, full: games.every((g) => g.state !== 'post' || BX.map[g.id] !== undefined || (BX.tries[g.id] || 0) >= 3) };
}
// ---------- the line of a game that has not started ----------
function liveLine(g, now) {
  let c = null; try { c = D.peek(); } catch (e) {}
  const espnP = (l) => (g.espnP && g.espn === l ? { hp: g.espnP[0], ap: g.espnP[1], ps: 'espn' } : {});
  if (c && Array.isArray(c.games) && num(c.at) && now - c.at <= BOOK_MAX && c.at < g.start) { const b = c.games.find((x) => x.home === g.home.abbr && x.away === g.away.abbr && Math.abs(Date.parse(x.start) - g.start) < 36 * 3600e3); if (b && half(b.line)) { const at = (b.books || []).filter((x) => x && x.l === b.line && Parlay.okPrice(x.p) && Parlay.okPrice(x.pa)); return Object.assign({ l: b.line, s: 'books' }, at.length ? { hp: medP(at.map((x) => x.p)), ap: medP(at.map((x) => x.pa)), ps: 'books', pn: at.length } : espnP(b.line)); } }
  return half(g.espn) ? Object.assign({ l: g.espn, s: 'espn' }, espnP(g.espn)) : null;
}
// median of American prices, taken on decimal odds (so -105 and +105 average sensibly), back to American
function medP(a) { const d = a.map(Parlay.dec).sort((x, y) => x - y), m = d.length >> 1; return Parlay.amer(d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2); }
const priceOf = (e, side) => (e && Parlay.okPrice(side === 'home' ? e.hp : e.ap) ? { o: side === 'home' ? e.hp : e.ap, os: e.ps } : { o: null, os: 'none' }); // the price stored with a pick: its side's price at the line it holds
// ---------- the computation. Mutates `weeks` (the stored records) and returns the weeks that changed. Pure apart from D.peek / D.log. ----------
// prevTick = when the previous successful tick ran (run() passes it; null = not known, e.g. the first tick after a restart). Callers that keep ONE `weeks` object
// across ticks (tests, simulations) may leave it out: the time of the last compute() on that object is used.
// `games` may hold games with state 'canceled' (ESPN says postponed or cancelled): they are not computed, but a live Lock on one moves on at once (M1). reads =
// { week: when that week's schedule was last read } (run() passes it; left out = every call is a new read).
const SEEN = new WeakMap(), GONE_N = 3, GONE_MS = 10 * 6e4; // a Lock's game that is merely missing from the feed is 'off the schedule' after GONE_N reads in a row spanning GONE_MS
function compute(weeks, games, cur, nv, bx, now, ll, prevTick, reads) {
  const offIds = new Set(games.filter((g) => g.state === 'canceled').map((g) => String(g.id))); if (offIds.size) games = games.filter((g) => g.state !== 'canceled');
  const last = prevTick !== undefined ? prevTick : SEEN.get(weeks), dirty = !(num(last) && now - last <= GRACE), taint = {}; SEEN.set(weeks, now); // dirty: an outage or a restart since the last tick (THE RULE (a), at the Lock)
  const byW = {}; games.forEach((g) => (byW[g.week] = byW[g.week] || []).push(g));
  const wks = Object.keys(byW).map(Number).sort((a, b) => a - b), open = wks.filter((w) => !D.ship[w] && w > (D.shipMax || 0) && !(weeks[w] && weeks[w].v !== 2 && w <= 10) && Math.min(...byW[w].map((g) => g.start)) - now < AHEAD), before = {}, changed = [];
  const closeOf = (g) => { const k = kOf(g); return nv[k] !== undefined ? nv[k] : D.trs[k] !== undefined ? D.trs[k] : null; }, started = (g) => now >= g.start || g.state !== 'pre';
  // 0. v253 (v252 review): the last pre-game line of EVERY game (any week) is kept in the database (row data.ll), so a finished game still has a line after a deploy
  //    wipes memory, even when nflverse is unreachable and the week is not one this server computes (e.g. week 10). { gameId: { l, s, t } }, t = when read.
  let llCh = false; if (ll) games.forEach((g) => { if (started(g)) return; const L = liveLine(g, now); if (L && (!ll[g.id] || ll[g.id].l !== L.l)) { ll[g.id] = { l: L.l, s: L.s, t: now }; llCh = true; } });
  // 1. lines (and their prices): follow the line until FREEZE_MIN before each game's kickoff, then keep it
  open.forEach((w) => {
    if (weeks[w] && weeks[w].v !== 2) { D.log(`week ${w}: old-format record (not v2) found after week 10: ignored and computed by the server`); delete weeks[w]; } // v252 review: a v248-v251 phone could have posted it to the old server
    before[w] = weeks[w] ? clone(weeks[w]) : null; const rec = (weeks[w] = weeks[w] || { v: 2, gl: {}, lock: null, dogs: [], helper: null }); rec.gl = rec.gl || {}; rec.first = Math.min(...byW[w].map((g) => g.start));
    byW[w].forEach((g) => {
      let e = rec.gl[g.id]; if (e && e.f) return;
      const L = started(g) ? null : liveLine(g, now);
      if (L && (!e || e.l !== L.l || e.s !== L.s || e.hp !== L.hp || e.ap !== L.ap)) { // lt = when this NUMBER was first read for the game: a change of price or of source with the same number keeps it (a restart that loses the book cache is not a late line)
        const same = !!e && e.l === L.l, lateNow = now > g.start - MARK + GRACE; if (!same && (lateNow || (e && e.s !== L.s))) taint[w] = 1; // a number first read late, or one that changed together with its source: not in-time information for the Lock (see THE RULE)
        // v253 H1: when a late number replaces one that was read in time, the last IN-TIME number (and its prices) is kept as il / ihp, iap, ips: the Lock ranking
        // goes on using it for this game. A new number read in time drops it (kickoff moved later); the same number with another price or source keeps it.
        const inT = !e ? null : same || lateNow ? (e.il !== undefined ? { il: e.il, ihp: e.ihp, iap: e.iap, ips: e.ips } : !same && e.lt <= g.start - MARK + GRACE ? { il: e.l, ihp: e.hp, iap: e.ap, ips: e.ps } : null) : null;
        e = rec.gl[g.id] = Object.assign({ l: L.l, s: L.s, lt: same ? e.lt : now }, L.ps ? { hp: L.hp, ap: L.ap, ps: L.ps } : {}); if (inT) Object.keys(inT).forEach((k) => { if (inT[k] !== undefined) e[k] = inT[k]; });
      }
      if (now < g.start - MARK) return;
      if (!e && started(g)) { const c = closeOf(g); if (c !== null) { taint[w] = 1; const cp = nv.pr && nv.pr[kOf(g)]; e = rec.gl[g.id] = Object.assign({ l: c, s: 'close', lt: now }, cp && nv[kOf(g)] === c ? { hp: cp[0], ap: cp[1], ps: 'close' } : {}); } } // nothing was read before kickoff: the closing line (and its closing price), flagged as after the fact
      if (!e) return; // no line anywhere yet: try again next tick
      e.f = 1; e.t = now; e.pre = now < g.start && e.s !== 'close'; if (now > g.start - MARK + GRACE) e.late = 1;
      D.log(`week ${w} line frozen ${g.away.abbr}@${g.home.abbr} home ${e.l > 0 ? '-' : '+'}${Math.abs(e.l)} (${e.s}, read ${hhmm(e.lt)})${e.ps ? ` price home ${e.hp} away ${e.ap} (${e.ps})` : ' no price'}${e.pre ? '' : ' AFTER KICKOFF'}${e.late ? ' late' : ''}`);
    });
  });
  // 2. model inputs: a finished game uses its closing line; any other game the line this server holds for it
  const lineOf = (g) => { if (g.state === 'post') { const c = closeOf(g); if (c !== null) return c; } const r = weeks[g.week], e = r && r.v === 2 && r.gl && r.gl[g.id]; if (e) return e.l; if (g.state !== 'post') return null; const k = ll && ll[g.id]; if (k && k.t < g.start && half(k.l)) return k.l; let h = null; try { h = (D.lines() || {})[g.id]; } catch (er) {} const x = Array.isArray(h) ? h.filter((y) => y[0] < g.start).pop() : null; return x && half(x[1]) ? x[1] : null; }; // last resort for a finished game: the ESPN line this server logged before kickoff
  const gs = games.map((g) => Object.assign({}, g, { line: lineOf(g) })), rows = Trophy.pool(gs, SEASON), R = H.ratings(games, cur, bx.map), byId = {}; gs.forEach((g) => (byId[g.id] = g));
  // 3. picks
  open.forEach((w) => {
    const rec = weeks[w], wg = byW[w].slice().sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
    const full = gs.every((g) => g.week >= w || (g.state === 'post' && g.line !== null)); // the model reads every earlier result and line: without them a pick is only an early look
    const stamp = (o, kick, pre) => { o.final = true; o.t = now; o.pre = pre; if (now > kick - MARK + GRACE) o.late = 1; return o; };
    // 🔒 Lock (owner D9, Nov 15 2026: "Locks 1 hour before the actual game ... the pick can change; if you take early you risk").
    // THE RANKING: every tick the week is ranked (Trophy.pickOf, most confident first) from IN-TIME lines only: a game before its mark at the line the server holds
    // now; a game at or past its mark at the line frozen there if that line was first read by the mark (+ GRACE), otherwise at the last number that WAS read in
    // time (gl.il, rev253h H1: a late line never takes a game out of the ranking; only a game with no in-time number at all is left out). A line that turns up
    // later (late ESPN line, nflverse close) is used to GRADE that game (the frozen line its road dog and a Lock on it share), never to rank. (A week the server first sees after its
    // games, with no Lock yet, is still ranked after the fact and flagged *.)
    // THE #1 SLOT is a stored game (rec.top = { id, conf }), not a position: the model's most confident pick is never the Lock, the Lock is the most confident game
    // after it that is still in contention. If the stored #1 cannot be ranked on a tick (late line, pick'em, off the schedule) it keeps the slot until a rankable game
    // out-ranks it, so losing the #1 from the ranking never promotes the Lock's own game into the skipped slot.
    // CONTENTION: going through the games in kickoff order, a game that reaches its mark while it is the Lock makes the Lock final there, at that game's frozen line
    // and price; a game that reaches its mark while NOT the Lock is out for the week (rec.lockOut). Out games keep their place in the ranking.
    // THE RULE (v253, Nov 16 2026): once the week has a live Lock, its identity (game and team) may change on a tick ONLY when that tick is clean:
    //   (a) the previous successful tick was at most GRACE ago (no outage, no restart);
    //   (b) no line of the week was altered this tick by a late read (first read more than GRACE after that game's mark, or a closing line) or by a change of
    //       source that also changed the number (taint[w], set in step 1);
    //   (c) the Lock's own game is not more than GRACE past its mark, and is not being held (rec.lockWait).
    // Otherwise the Lock is CARRIED: same game, same team, no ranking. Before its mark it stays live at that game's current line turned into that team's spread.
    // At or past its mark it freezes there: the game's frozen line as that team's spread, that side's price (what its road dog freezes at), final when the earlier
    // results are complete or at kickoff (held until then, N5); "line at the mark unavailable" (nl: last line and side it held) only with no usable line at all.
    // The confidence of a carried Lock is the model's at that line if the model still takes that team, otherwise none (null: the app shows no %).
    // Defined exception: the Lock's game is OFF THE SCHEDULE: the Lock moves on by the ranking (never onto a game more than GRACE past its mark, D5). Off the
    // schedule = ESPN flags it postponed/cancelled, or it is missing on GONE_N reads of the schedule in a row spanning GONE_MS (rev253h M1); a game missing from
    // fewer reads is a feed gap and the Lock is carried as it is. If no game is left in contention the Lock goes final where it stands, flagged off (L4).
    if (!(rec.lock && rec.lock.final)) {
      const prevL = rec.lock || null; // the live Lock as of the last tick
      const lateLine = (g) => { const e = rec.gl[g.id]; return !!prevL && now >= g.start - MARK && (!e || e.s === 'close' || !(e.lt <= g.start - MARK + GRACE)); };
      const atMark = (g) => { const e = rec.gl[g.id], x = byId[g.id]; if (lateLine(g)) return e && e.s !== 'close' && half(e.il) ? Object.assign({}, x, { line: e.il }) : null; /* H1: ranked at its last in-time number; never had one = not ranked */ return e && e.f && half(e.l) && e.l !== x.line ? Object.assign({}, x, { line: e.l }) : x; };
      const out = new Set(rec.lockOut || []), picks = wg.map(atMark).filter((g) => g && g.line !== null && g.line !== undefined).map((g) => Trophy.pickOf(g, rows, SEASON)).filter(Boolean).sort((a, b) => b.conf - a.conf);
      let top = picks[0] ? { id: String(picks[0].id), conf: r4(picks[0].conf) } : null;
      if (rec.top && !picks.some((x) => String(x.id) === String(rec.top.id)) && (!top || rec.top.conf >= top.conf)) top = rec.top; // the stored #1 is not rankable this tick: it keeps the slot
      if (top) rec.top = top;
      // owner (Nov 16 2026): never a week without a Lock: if no game after the #1 is still in contention, the top game still in contention is the Lock.
      const inC = (x) => !out.has(String(x.id)), cand = () => picks.find((x) => inC(x) && !(top && String(x.id) === top.id)) || picks.find(inC) || null;
      const mk = (x) => Object.assign({ id: String(x.id), rank: 2, abbr: x.abbr, other: x.other, line: x.line, conf: r4(x.conf), dog: !!x.dog }, lockPrice(rec, byId[x.id], x));
      const goOut = (g) => { out.add(g.id); D.log(`week ${w} ${g.away.abbr}@${g.home.abbr} reached its mark while not the Lock: out of contention`); };
      const show = (L) => `${L.abbr} ${L.line > 0 ? '+' : ''}${L.line}${L.o ? ' ' + L.o : ' no price'}${num(L.conf) ? ' ' + Math.round(L.conf * 100) + '%' : ''}${L.pre ? '' : ' AFTER KICKOFF'}${L.late ? ' late' : ''}${L.nl ? ' (line at the mark unavailable)' : ''}${L.part ? ' (inputs incomplete)' : ''}`;
      const own = prevL ? wg.find((g) => g.id === String(prevL.id)) || null : null;
      // M1: the Lock's game is not in this answer. Off the schedule only when ESPN says postponed/cancelled, or after GONE_N reads in a row without it spanning
      // GONE_MS; until then the Lock is carried (limbo). rec.lockGone = { id, n, t0, r }: reads counted, first and last read time.
      let limbo = false, gone = false;
      if (prevL && !own) { const id = String(prevL.id), r = reads && num(reads[w]) ? reads[w] : now; let q = rec.lockGone && rec.lockGone.id === id ? rec.lockGone : { id, n: 0, t0: r, r: null }; if (q.r !== r) q = { id, n: q.n + 1, t0: q.t0, r }; gone = offIds.has(id) || (q.n >= GONE_N && r - q.t0 >= GONE_MS); limbo = !gone; if (gone) { delete rec.lockGone; D.log(`week ${w} the Lock's game ${prevL.abbr} v ${prevL.other} is off the schedule (${offIds.has(id) ? 'postponed/cancelled' : 'missing on ' + q.n + ' reads'}): the Lock moves on`); } else rec.lockGone = q; } else delete rec.lockGone;
      if (rec.lockWait && !(own && own.id === String(rec.lockWait))) delete rec.lockWait; // the held game left the schedule (or is no longer the Lock's game): nothing is held
      const pin = !!own && (dirty || !!taint[w] || rec.lockWait === own.id || now > own.start - MARK + GRACE);
      let L = null, wait = false;
      if (limbo) { wg.forEach((g) => { if (now >= g.start - MARK && !out.has(g.id)) goOut(g); }); L = prevL; } // carried as it is: nothing is known about its game on this read
      else if (pin) { // CARRIED: no ranking decides anything about the Lock this tick
        wg.forEach((g) => { if (g.id !== own.id && now >= g.start - MARK && !out.has(g.id)) goOut(g); });
        const oe = rec.gl[own.id], ok = !!oe && half(oe.l) && oe.l !== 0, home = prevL.abbr === own.home.abbr, x = Object.assign({}, prevL); delete x.part; delete x.nl;
        if (ok) { const line = home ? -oe.l : oe.l, m = Trophy.pickOf(Object.assign({}, byId[own.id], { line: oe.l }), rows, SEASON); Object.assign(x, { line, dog: line > 0, conf: m && m.abbr === prevL.abbr ? r4(m.conf) : null }, priceOf(oe, home ? 'home' : 'away')); }
        if (now < own.start - MARK) { if (!full) x.part = 1; L = x; } // not at its mark yet: still live, on the same game and team
        else if (!ok || full || now >= own.start) { if (!ok) x.nl = 1; if (!full) x.part = 1; L = stamp(x, own.start, now < own.start && !(ok && oe.s === 'close')); if (ok && (oe.late || !(oe.lt <= own.start - MARK + GRACE))) L.late = 1; delete rec.lockWait; rec.t = now; rec.pre = L.pre; D.log(`week ${w} LOCK final on its own game (carried, no re-ranking): ${show(L)}`); }
        else { x.part = 1; L = x; wait = true; rec.lockWait = own.id; } // inputs incomplete: held as the Lock until kickoff
      } else {
        for (const g of wg) {
          if (out.has(g.id) || now < g.start - MARK) continue;
          if (prevL && now > g.start - MARK + GRACE) { goOut(g); continue; } // D5: with a live Lock in the week, a game more than GRACE past its mark is never taken up as the Lock (the Lock's own game in that state is carried, above)
          // the live Lock's game reaches its mark but cannot be ranked there (pick'em or no line): frozen at the last line and side it held, with its stored price,
          // flagged nl ("line at mark unavailable") (manager, applying the owner's "never a week without a Lock" + D9).
          if (own && own.id === g.id && !picks.some((x) => String(x.id) === g.id)) { const x = Object.assign({}, prevL, { nl: 1 }); delete x.part; if (!full) x.part = 1; L = stamp(x, g.start, now < g.start); rec.t = now; rec.pre = L.pre; D.log(`week ${w} LOCK final at its last live line: ${show(L)}`); break; }
          const c = cand(); if (!c) break;
          if (String(c.id) === g.id) { if (full || now >= g.start) { const x = mk(c); if (!full) x.part = 1; L = stamp(x, g.start, now < g.start); rec.t = now; rec.pre = L.pre; D.log(`week ${w} LOCK final: ${show(L)}`); } else { wait = true; rec.lockWait = g.id; } break; } // inputs incomplete at the mark: held as the Lock, frozen at kickoff, flagged
          goOut(g);
        }
        if (!L) { // not final this tick: the candidate; with none in contention, only if there never was a live Lock, the top-ranked game that has not kicked off
          const c = cand() || (!prevL ? picks.find((x) => byId[x.id] && byId[x.id].start > now) : null);
          if (!c && gone) { L = Object.assign({}, prevL, { final: true, t: now, pre: true, off: 1 }); rec.t = now; rec.pre = true; D.log(`week ${w} LOCK final on a game off the schedule (no game left in contention): ${show(L)}`); } // L4: never a live Lock left on a postponed game. No game is left to move to (D5: a game past its mark is never taken up), so it is final where it stands, flagged off (no result unless the game is played)
          else { L = c ? mk(c) : prevL; if (L && (!full || wait)) L.part = 1; }
        }
      }
      rec.lockOut = [...out]; rec.lock = L;
    }
    const old = {}; (rec.dogs || []).forEach((d) => (old[d.id] = d));
    rec.dogs = (rec.dogs || []).filter((d) => d.final && !wg.some((g) => g.id === String(d.id))).concat(wg.map((g) => { // a final dog is kept even if its game drops out of ESPN's list
      if (old[g.id] && old[g.id].final) return old[g.id];
      const e = rec.gl[g.id]; if (!e || !(e.l > 0) || !Trophy.isDiv(g.away.abbr, g.home.abbr)) return null; // road team must be the underdog in a division game
      const c = Trophy.dogCover(byId[g.id].line === e.l ? byId[g.id] : Object.assign({}, byId[g.id], { line: e.l }), rows, SEASON), d = Object.assign({ id: g.id, abbr: g.away.abbr, home: g.home.abbr, line: e.l, p: c && c.p > 0 ? r4(c.p) : 0.5 }, priceOf(e, 'away'));
      if (!full) d.part = 1;
      if (e.f && (full || now >= g.start)) { stamp(d, g.start, !!e.pre && now < g.start); D.log(`week ${w} road dog final: ${d.abbr} +${d.line} at ${d.home} ${Math.round(d.p * 100)}% ${d.p >= 0.53 ? 'PICKED' : 'not picked'}${d.pre ? '' : ' AFTER KICKOFF'}${d.late ? ' late' : ''}${d.part ? ' (inputs incomplete)' : ''}`); }
      return d;
    }).filter(Boolean));
    // 🤝 Helper, same principle (D9): the highest win chance among games still in contention; final at its own game's mark; a game that reaches its mark while not
    // the Helper is out (rec.helpOut).
    if (!(rec.helper && rec.helper.final)) {
      const out = new Set(rec.helpOut || []), hs = wg.map((g) => { const x = H.win(g, rec.gl[g.id] ? rec.gl[g.id].l : null, R); return x && x.conf ? { id: String(g.id), abbr: x.abbr, conf: r4(x.conf) } : null; }).filter(Boolean).sort((a, b) => b.conf - a.conf);
      const cand = () => hs.find((x) => !out.has(x.id)) || null; let h = null, wait = false;
      for (const g of wg) {
        if (out.has(g.id) || now < g.start - MARK) continue; const c = cand(); if (!c) break;
        if (c.id === g.id) { if (bx.full || now >= g.start) { h = stamp(Object.assign({}, c), g.start, now < g.start); if (!bx.full) h.part = 1; D.log(`week ${w} HELPER final: ${h.abbr} ${Math.round(h.conf * 100)}%${h.pre ? '' : ' AFTER KICKOFF'}${h.late ? ' late' : ''}${h.part ? ' (box scores incomplete)' : ''}`); } else wait = true; break; }
        out.add(g.id);
      }
      if (!h) { const c = cand(); h = c ? Object.assign({}, c) : null; if (h && (!bx.full || wait)) h.part = 1; }
      rec.helpOut = [...out]; rec.helper = h;
    }
    rec.parlays = parlays(rec, wg, now);
    const prev = before[w]; if (prev && prev.at !== undefined) rec.at = prev.at; else delete rec.at;
    if (!prev || canon(rec) !== canon(prev)) { rec.at = now; changed.push(w); }
  });
  if (llCh) changed.ll = true;
  return changed;
}
// the Lock's price: its side's price at the line the server holds for that game, only when that line is the Lock's line (a finished game's closing line counts)
function lockPrice(rec, g, p) {
  if (!g) return { o: null, os: 'none' }; const side = p.abbr === g.home.abbr ? 'home' : 'away', e = rec.gl[g.id], hl = side === 'home' ? -p.line : p.line; // hl = the line in home-favoured points
  return e && e.l === hl ? priceOf(e, side) : { o: null, os: 'none' };
}
// 🎟 parlays of one week (pics/parlay.js composes them). { two: P | null, three: P | null }, P = { legs: [game ids, Lock first], final?, t?, pre?, late? }
// Owner D9: each leg freezes with its own game (the Lock leg = the Lock, a dog leg = that road dog). Legs that are frozen stay; only legs not yet frozen can change,
// by the same rules; a dog that is already frozen is never added. Final when every leg is final.
function parlays(rec, wg, now) {
  const old = rec.parlays || {}, out = {}, dog = (id) => (rec.dogs || []).find((d) => String(d.id) === String(id));
  const part = (id) => (rec.lock && String(rec.lock.id) === String(id) ? rec.lock : dog(id));
  const keep = (k) => ((old[k] && old[k].legs) || []).slice(1).filter((id) => { const d = dog(id); return d && d.final; });
  const fresh = Parlay.compose(rec.lock, (rec.dogs || []).map((d) => ({ id: String(d.id), p: d.p, fin: !!d.final })), { keep: { two: keep('two'), three: keep('three') } });
  ['two', 'three'].forEach((k) => {
    const o = old[k]; if (o && o.final) { out[k] = o; return; }
    const legs = fresh[k] ? fresh[k].map((x) => String(x.id)) : null; if (!legs) { out[k] = null; return; }
    const P = { legs }, ps = legs.map(part);
    if (ps.every((x) => x && x.final)) { P.final = true; P.t = now; P.pre = ps.every((x) => x.pre); if (ps.some((x) => x.late)) P.late = 1; D.log(`week ${wg[0].week} ${k === 'two' ? '2' : '3'}-game parlay final: ${ps.map((x) => x.abbr + (x.o ? ' ' + x.o : ' no price')).join(' + ')}${P.pre ? '' : ' (a leg frozen after kickoff)'}`); }
    out[k] = P;
  });
  return out;
}
// ---------- tick: read, compute, store ----------
let ROW = null, INF = null, TK = { at: 0, ok: false, ran: 0 }, SEA = null, LAST = null; // LAST: when the last successful tick of THIS process ran (null after a restart)
async function getRow(force) {
  if (ROW && !force && D.now() - ROW.at < 5 * 6e4) return ROW.row;
  let row = await D.S.dbGet(ID); if (!row) { await D.S.dbPut({ id: ID, salt: 'x', pinhash: 'x', data: { weeks: {} }, updated: 1 }, true); row = await D.S.dbGet(ID); if (!row) throw new Error('alert row missing'); }
  ROW = { at: D.now(), row }; return row;
}
async function run() {
  const now = D.now(), sea = await season(now); SEA = sea; if (!sea) return 'outside the ' + SEASON + ' regular season';
  const nv = await closing(now), bx = await boxes(sea.games);
  for (let tries = 0; tries < 3; tries++) {
    const row = await getRow(tries > 0), weeks = clone((row.data && row.data.weeks) || {}), ll = clone((row.data && row.data.ll) || {}), changed = module.exports.compute(weeks, sea.games.concat(sea.off || []), sea.cur, nv, bx, now, ll, LAST, sea.read);
    if (!changed.length && !changed.ll) { LAST = now; return 'no change'; }
    const ids = new Set(sea.games.map((g) => g.id)); Object.keys(ll).forEach((id) => { if (!ids.has(id)) delete ll[id]; }); // only this season's games
    const upd = Math.max(now, Number(row.updated || 0) + 1);
    if (await D.S.dbPatchIf(ID, row.updated, Object.assign({}, row.data, { weeks, ll }), upd)) { ROW = { at: D.now(), row: Object.assign({}, row, { data: Object.assign({}, row.data, { weeks, ll }), updated: upd }) }; LAST = now; return changed.length ? 'saved week ' + changed.join(', ') : 'saved lines'; }
    ROW = null; // someone else wrote (the owner fix route): read again and recompute
  }
  throw new Error('busy, could not save');
}
function tick() {
  if (BROKEN) { TK = { at: D.now(), ok: false, ran: TK.ran + 1, err: 'picks disabled: ' + BROKEN }; logOnce('tick refused: ' + BROKEN); return Promise.resolve(); }
  if (!INF) INF = run().then((m) => { TK = { at: D.now(), ok: true, ran: TK.ran + 1, note: m }; }, (e) => { TK = { at: D.now(), ok: false, ran: TK.ran + 1, err: String((e && e.message) || e).slice(0, 160) }; logOnce('tick failed: ' + TK.err); }).finally(() => { INF = null; });
  return INF;
}
// ---------- what GET returns: shipped weeks (as game ids) + the stored weeks, every part flagged final or live ----------
function view(weeks, sea) {
  const out = {};
  if (sea) { const byK = {}; sea.games.forEach((g) => (byK[kOf(g)] = g)); Object.keys(D.ship).forEach((w) => { const s = D.ship[w], lg = s.lock && byK[s.lock.k], hg = s.helper && byK[s.helper.k], fl = { final: true, pre: false }, pr = (x) => (Parlay.okPrice(x.o) ? { o: x.o, os: x.os || 'close' } : { o: null, os: 'none' }), pl = (L) => (L && L.every((k) => byK[k]) ? Object.assign({ legs: L.map((k) => byK[k].id) }, fl) : null); out[w] = { src: 'ship', lock: lg ? Object.assign({ id: lg.id, rank: 2, abbr: lg[s.lock.side].abbr, other: lg[s.lock.side === 'home' ? 'away' : 'home'].abbr, line: s.lock.line, conf: s.lock.conf, dog: !!s.lock.dog }, pr(s.lock), fl) : null, dogs: (s.dogs || []).map((d) => (byK[d.k] ? Object.assign({ id: byK[d.k].id, abbr: byK[d.k].away.abbr, home: byK[d.k].home.abbr, line: d.line, p: d.p }, pr(d), fl) : null)).filter(Boolean), helper: hg ? Object.assign({ id: hg.id, abbr: hg[s.helper.side].abbr, conf: s.helper.conf }, fl) : null, parlays: { two: pl(s.parlays && s.parlays.two), three: pl(s.parlays && s.parlays.three) } }; }); }
  Object.keys(weeks || {}).forEach((w) => {
    if (D.ship[w]) return; const r = clone(weeks[w]); r.src = 'srv';
    if (r.v !== 2 && +w > 10) return; // old format after week 10: not official (the next tick recomputes it)
    if (r.fix) r.fix = r.fix.map((f) => ({ t: f.t, n: f.n, src: f.src })); // the owner's `why` text stays private (v252 review: GET /alert is public)
    if (r.v !== 2) { const fl = (o) => (o ? Object.assign(o, { final: true, t: o.t || r.t || 0, pre: !!r.pre }) : o); r.v = 1; fl(r.lock); (r.dogs || []).forEach(fl); fl(r.helper); } // frozen whole by a phone under v248
    out[w] = r;
  });
  return out;
}
// ---------- owner-only correction of FINAL picks' lines (e.g. week 10 of 2026 to the closing lines). Dry run unless apply:true. ----------
// body: { week, apply, why, source:'nflverse' }  -> every final Lock / road dog of that week whose game is finished takes the nflverse closing line
//   or: { week, apply, why, fixes:[{abbr:'PIT', line:4.5}] } -> that team's spread (PIT +4.5); the other side of the game gets the mirror number
// The model % is NOT recomputed and the Lock is NOT re-chosen: only the line the pick is graded at changes. The first original line is kept in `was`.
async function fix(b) {
  const wk = b.week; if (!Number.isInteger(wk) || wk < 1 || wk > 18) throw Object.assign(new Error('bad week'), { status: 400 });
  if (D.ship[wk]) throw Object.assign(new Error('week ' + wk + ' ships with the app (pics/alert-frozen.json): correct it there'), { status: 400 });
  const want = {}; // game id -> home-favored line
  const now = D.now(), sea = await season(now); if (!sea) throw Object.assign(new Error('schedule unavailable'), { status: 503 });
  const wg = sea.games.filter((g) => g.week === wk), skipped = [];
  if (b.source === 'nflverse') { NV = null; const nv = await closing(now); wg.forEach((g) => { const c = nv[kOf(g)]; if (g.state === 'post' && c !== undefined) want[g.id] = c; }); if (!Object.keys(want).length) throw Object.assign(new Error('no closing lines for week ' + wk + ' yet'), { status: 409 }); }
  else if (Array.isArray(b.fixes) && b.fixes.length && b.fixes.length <= 16) { for (const f of b.fixes) { const a = f && ab(String(f.abbr || '').toUpperCase()), g = wg.find((x) => x.home.abbr === a || x.away.abbr === a); if (!g) throw Object.assign(new Error('team not in week ' + wk + ': ' + String(f && f.abbr).slice(0, 5)), { status: 400 }); if (!half(f.line)) throw Object.assign(new Error('bad line for ' + a), { status: 400 }); want[g.id] = g.home.abbr === a ? -f.line : f.line; } }
  else throw Object.assign(new Error("give source:'nflverse' or fixes:[{abbr,line}]"), { status: 400 });
  for (let tries = 0; tries < 4; tries++) {
    const row = await getRow(true), weeks = clone((row.data && row.data.weeks) || {}), rec = weeks[wk], changes = []; if (!rec) throw Object.assign(new Error('week ' + wk + ' is not stored'), { status: 404 });
    const cpOf = (id, team) => { const g = wg.find((x) => x.id === String(id)), cp = b.source === 'nflverse' && g && NV && NV.pr && NV.pr[kOf(g)]; return cp ? { o: g.home.abbr === team ? cp[0] : cp[1], os: 'close' } : { o: null, os: 'none' }; }; // v253: a corrected line takes the nflverse closing price, a hand-typed line has no price (no payout shown)
    const fin = (o) => o && (rec.v !== 2 || o.final), set = (o, what, to) => { if (o.line === to) return; const np = cpOf(o.id, o.abbr); changes.push({ what, team: o.abbr, id: String(o.id), from: o.line, to, price: np.o }); if (o.was === undefined) { o.was = o.line; if (o.o !== undefined) o.wo = o.o; } o.line = to; o.o = np.o; o.os = np.os; o.fx = now; };
    if (rec.lock && want[rec.lock.id] !== undefined) { const g = wg.find((x) => x.id === String(rec.lock.id)); if (!fin(rec.lock)) skipped.push({ what: 'lock', team: rec.lock.abbr, why: 'not final yet (still follows the line)' }); else set(rec.lock, 'lock', rec.lock.abbr === g.home.abbr ? -want[g.id] : want[g.id]); }
    (rec.dogs || []).forEach((d) => { const to = want[d.id]; if (to === undefined) return; if (!fin(d)) skipped.push({ what: 'dog', team: d.abbr, why: 'not final yet (still follows the line)' }); else if (!(to > 0)) skipped.push({ what: 'dog', team: d.abbr, why: 'at ' + to + ' the road team would not be the underdog: left as it is' }); else set(d, 'dog', to); });
    if (!b.apply || !changes.length) return { week: wk, applied: false, dry: !b.apply, changes, skipped, note: 'Model % and the choice of Lock are not recomputed; only the grading line changes.' };
    rec.fix = (rec.fix || []).concat([{ t: now, why: String(b.why || '').slice(0, 200), n: changes.length, src: b.source === 'nflverse' ? 'nflverse' : 'manual' }]).slice(-10); rec.at = now;
    if (await D.S.dbPatchIf(ID, row.updated, Object.assign({}, row.data, { weeks }), Math.max(now, Number(row.updated || 0) + 1))) { ROW = null; changes.forEach((c) => D.log(`OWNER FIX week ${wk} ${c.what} ${c.team}: ${c.from} -> ${c.to}`)); return { week: wk, applied: true, changes, skipped, rec: view({ [wk]: rec }, null)[wk] }; }
  }
  throw Object.assign(new Error('busy, try again'), { status: 503 });
}
function body(req) { return new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 20000) rej(Object.assign(new Error('too big'), { status: 413 })); else c.push(d); }); req.on('end', () => { try { const j = JSON.parse(Buffer.concat(c).toString() || '{}'); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(); res(j); } catch (e) { rej(Object.assign(new Error('bad json'), { status: 400 })); } }); req.on('error', rej); }); }
const rl = new Map();
async function handle(req, res) {
  const p = req.url.split('?')[0]; if (p !== '/alert' && p !== '/alert/fix' && p !== '/alert/run') return false;
  try {
    if (req.method === 'GET' && p === '/alert') {
      if (D.now() - TK.at > 90000) await Promise.race([tick(), new Promise((r) => setTimeout(r, 6000))]); // lazy tick: the picks do not depend on a phone, but a request wakes a sleeping server
      let row, stale = false; try { row = await getRow(); } catch (e) { if (!ROW) throw Object.assign(new Error('picks unavailable, try again'), { status: 503 }); row = ROW.row; stale = true; logOnce('database read failed, serving the copy in memory: ' + String(e.message).slice(0, 120)); }
      send(res, 200, { season: SEASON, now: D.now(), markMin: MARK / 6e4, lockAt: 'own', broken: BROKEN ? true : undefined, tick: { at: TK.at, ok: TK.ok }, stale, weeks: view((row.data && row.data.weeks) || {}, SEA) }); return true;
    }
    if (req.method !== 'POST') return false;
    const ip = require('./ip').clientIp(req), k = ip + ':' + Math.floor(D.now() / 6e4); rl.set(k, (rl.get(k) || 0) + 1); if (rl.size > 5000) rl.clear();
    if (rl.get(k) > 20) { send(res, 429, { error: 'slow down' }); return true; }
    if (p === '/alert') { logOnce('refused: POST /alert (phones no longer freeze picks)'); send(res, 410, { error: 'Picks are computed on the server now. Update the app.' }); return true; }
    if (!D.ownerOk(req)) { logOnce('refused: ' + p + ' without an owner token'); send(res, 401, { error: 'Owner only' }); return true; }
    if (p === '/alert/run') { await tick(); send(res, TK.ok ? 200 : 503, { tick: TK }); return true; }
    const out = await fix(await body(req)); send(res, 200, out); return true;
  } catch (e) { if (!e.status) logOnce('error on ' + req.method + ' ' + p + ': ' + String(e.message).slice(0, 160)); send(res, e.status || 500, { error: e.status ? e.message : 'Alert error' }); return true; }
}
module.exports = { handle, tick, compute, view, _deps: D, _state: () => ({ TK, SEA }), _reset: () => { WK = {}; HEAD = null; NV = null; BX = null; ROW = null; INF = null; SEA = null; LAST = null; TK = { at: 0, ok: false, ran: 0 }; rl.clear(); Object.keys(LOGGED).forEach((k) => delete LOGGED[k]); } };
