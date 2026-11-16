// Oddable Alert, computed and frozen ON THE SERVER (v252). The server/database is the only source of the weekly picks: no phone computes or freezes them.
//   🔒 Lock   = the frozen factor model's #2 cover pick of the week (pics/trophy.js run here in Node). Live until 30 minutes before the WEEK'S FIRST kickoff, then final.
//   🏠 Dogs   = every division road underdog with its line and model %. Each one is live until 30 minutes before ITS OWN kickoff, then final (picked at 53%+).
//   🤝 Helper = the week's highest win-chance team (helper.js). Live until 30 minutes before the week's first kickoff, then final.
// Before those marks the picks follow the line: every tick re-reads the lines and recomputes. A final pick is never recomputed (only the owner route below can correct its line).
// Lines before a freeze, in this order: (1) the many-book consensus ALREADY cached by games.js (peek: this file never spends an Odds API credit), if it was fetched in the
// last 3 hours and before that game's kickoff; (2) ESPN's line on the scoreboard; (3) the last line this server stored for the game. Finished games (model inputs for later
// weeks) use the nflverse closing line (games.csv, re-read every 6 hours), then pics/trophy-season.json.
// Who runs it: tick() every minute from server.js, and lazily on GET /alert, so no phone has to be open. Render's free plan can sleep: if the server wakes after a mark it
// freezes then, with the last value it has. Each final part carries t (when it was frozen), pre (true = frozen before that kickoff; false = after it, shown with * in the app)
// and late (frozen more than 5 minutes after its mark).
// Stored in oddable_sync row 'lock:alert26' as { weeks: { N: record } } ('lock:' keeps it out of player lists), written with an optimistic check on `updated`.
// Record v2: { v:2, first, at, gl:{gameId:{l,s,lt,f,t,pre,late}}, lock, dogs:[], helper }. A record without v (week 10 of 2026, frozen by a phone under v248) is final as it is.
// Weeks in pics/alert-frozen.json (2026 weeks 1-9, back-filled) are never recomputed; GET returns them too (src 'ship').
// Routes: GET /alert (public) · POST /alert/fix and POST /alert/run (owner only, acct.ownerOk) · POST /alert (the old phone freeze) is gone: 410.
const fs = require('fs'), path = require('path');
const Trophy = require('../pics/trophy.js'), H = require('./helper');
const SEASON = 2026, ID = 'lock:alert26', BXID = 'lock:bx26', MARK = 30 * 6e4, GRACE = 5 * 6e4, BOOK_MAX = 3 * 3600e3, AHEAD = 9 * 864e5; // AHEAD: a week is computed once its first kickoff is within 9 days (this week and next)
const SBU = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/', NVU = 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv';
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pics', f), 'utf8')); } catch (e) { return d; } };
Trophy.init(rd('trophy-model.json', null), rd('trophy-hist.json', []));
const D = {
  S: require('./sync'), fetch: (...a) => fetch(...a), now: () => Date.now(),
  ownerOk: (req) => require('./acct').ownerOk(req), // NOT acct.check(): that one answers true for everybody while the gate is off
  peek: () => require('./games').peek('nfl'), // cached many-book lines only; never triggers a paid refresh
  log: (m) => console.log('alert: ' + m),
  lines: () => null, // server.js points this at its in-memory ESPN line log (LINES)
  ship: (rd('alert-frozen.json', {}).weeks) || {}, trs: rd('trophy-season.json', {}),
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
function parseLine(text, home, away) { if (!text) return null; if (/^(EVEN|PK|PICK)/i.test(text)) return 0; const m = /^([A-Z]{2,3})\s+(-?\d+(?:\.\d+)?)$/.exec(String(text).trim()); if (!m) return null; const fav = ab(m[1]), v = Math.abs(+m[2]); return fav === home ? v : fav === away ? -v : null; }
function parse(j, wk) {
  return ((j && j.events) || []).map((e) => {
    const c = (e.competitions || [])[0] || {}, t = (e.status && e.status.type) || {}, h = (c.competitors || []).find((x) => x.homeAway === 'home'), a = (c.competitors || []).find((x) => x.homeAway === 'away'), start = Date.parse(e.date);
    if (!e.id || !h || !a || !h.team || !a.team || !Number.isFinite(start)) return null;
    const g = { id: String(e.id), week: wk, start, state: /CANCEL|POSTPON/i.test(t.name || '') ? 'canceled' : t.state || 'pre', detail: t.shortDetail || '', neutral: !!c.neutralSite, home: { abbr: ab(h.team.abbreviation), score: parseInt(h.score, 10) || 0 }, away: { abbr: ab(a.team.abbreviation), score: parseInt(a.score, 10) || 0 } };
    const o = c.odds && c.odds[0]; g.espn = o ? parseLine(o.details, g.home.abbr, g.away.abbr) : null; return g;
  }).filter(Boolean);
}
let WK = {}, HEAD = null;
// Returns { games, cur } for the 2026 regular season, or null outside it. Finished weeks are read once; live weeks every 5 minutes (every minute near a freeze mark).
async function season(now) {
  if (!HEAD || now - HEAD.at > 5 * 6e4) { try { const j = await jget(SBU + 'scoreboard'); if (!j.season || !j.week) throw new Error('espn empty'); HEAD = { at: now, year: +j.season.year, type: +j.season.type, week: +j.week.number }; } catch (e) { if (!HEAD) throw new Error('schedule unavailable (' + e.message + ')'); } }
  if (HEAD.year !== SEASON || HEAD.type < 2) return null;
  const cached = [].concat(...Object.values(WK).map((w) => w.games)), hot = cached.some((g) => g.state !== 'post' && g.state !== 'canceled' && g.start - MARK - now < 10 * 6e4 && now - g.start < 15 * 6e4);
  const todo = []; for (let w = 1; w <= 18; w++) { const c = WK[w]; if (c && c.done) continue; const soon = c && c.games.some((g) => g.state !== 'post' && g.start - now < 8 * 864e5); if (!c || now - c.at >= (hot && soon ? 55e3 : soon ? 5 * 6e4 : 60 * 6e4)) todo.push(w); }
  let i = 0; const worker = async () => { while (i < todo.length) { const w = todo[i++]; try { const games = parse(await jget(SBU + 'scoreboard?week=' + w + '&seasontype=2'), w); if (!games.length) throw new Error('no games'); WK[w] = { at: now, games, done: games.every((g) => g.state === 'post' || g.state === 'canceled') }; } catch (e) { if (!WK[w]) throw new Error('week ' + w + ' unavailable (' + e.message + ')'); } } };
  await Promise.all([worker(), worker(), worker()]);
  return { games: [].concat(...Object.keys(WK).map((w) => WK[w].games)).filter((g) => g.state !== 'canceled'), cur: HEAD.type === 2 ? HEAD.week : 18 };
}
// ---------- nflverse closing lines for finished games (home-favored points, keyed week-away-home) ----------
let NV = null;
async function closing(now) {
  if (NV && now - NV.at < 6 * 3600e3) return NV.map;
  try {
    const r = await D.fetch(NVU, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const L = (await r.text()).split('\n'), hd = L[0].trim().split(','), ix = (n) => hd.indexOf(n), map = {}, c0 = ['season', 'game_type', 'week', 'away_team', 'home_team', 'home_score', 'spread_line'].map(ix); if (c0.some((x) => x < 0)) throw new Error('unexpected columns');
    L.slice(1).forEach((l) => { const c = l.split(','); if (+c[c0[0]] !== SEASON || c[c0[1]] !== 'REG' || c[c0[5]] === '' || c[c0[5]] === undefined || c[c0[6]] === '') return; const v = +c[c0[6]]; if (half(v)) map[+c[c0[2]] + '-' + c[c0[3]] + '-' + c[c0[4]]] = v; });
    NV = { at: now, map };
  } catch (e) { logOnce('closing lines (nflverse) unavailable: ' + e.message); if (NV) NV.at = now - 6 * 3600e3 + 30 * 6e4; else NV = { at: now - 6 * 3600e3 + 10 * 6e4, map: {} }; }
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
  if (c && Array.isArray(c.games) && num(c.at) && now - c.at <= BOOK_MAX && c.at < g.start) { const b = c.games.find((x) => x.home === g.home.abbr && x.away === g.away.abbr && Math.abs(Date.parse(x.start) - g.start) < 36 * 3600e3); if (b && half(b.line)) return { l: b.line, s: 'books' }; }
  return half(g.espn) ? { l: g.espn, s: 'espn' } : null;
}
// ---------- the computation. Mutates `weeks` (the stored records) and returns the weeks that changed. Pure apart from D.peek / D.log. ----------
function compute(weeks, games, cur, nv, bx, now) {
  const byW = {}; games.forEach((g) => (byW[g.week] = byW[g.week] || []).push(g));
  const wks = Object.keys(byW).map(Number).sort((a, b) => a - b), open = wks.filter((w) => !D.ship[w] && !(weeks[w] && weeks[w].v !== 2) && Math.min(...byW[w].map((g) => g.start)) - now < AHEAD), before = {}, changed = [];
  const closeOf = (g) => { const k = kOf(g); return nv[k] !== undefined ? nv[k] : D.trs[k] !== undefined ? D.trs[k] : null; }, started = (g) => now >= g.start || g.state !== 'pre';
  // 1. lines: follow the line until 30 minutes before each game's kickoff, then keep it
  open.forEach((w) => {
    before[w] = weeks[w] ? clone(weeks[w]) : null; const rec = (weeks[w] = weeks[w] || { v: 2, gl: {}, lock: null, dogs: [], helper: null }); rec.gl = rec.gl || {}; rec.first = Math.min(...byW[w].map((g) => g.start));
    byW[w].forEach((g) => {
      let e = rec.gl[g.id]; if (e && e.f) return;
      const L = started(g) ? null : liveLine(g, now); if (L && (!e || e.l !== L.l || e.s !== L.s)) e = rec.gl[g.id] = { l: L.l, s: L.s, lt: now };
      if (now < g.start - MARK) return;
      if (!e && started(g)) { const c = closeOf(g); if (c !== null) e = rec.gl[g.id] = { l: c, s: 'close', lt: now }; } // nothing was read before kickoff: the closing line, flagged as after the fact
      if (!e) return; // no line anywhere yet: try again next tick
      e.f = 1; e.t = now; e.pre = now < g.start && e.s !== 'close'; if (now > g.start - MARK + GRACE) e.late = 1;
      D.log(`week ${w} line frozen ${g.away.abbr}@${g.home.abbr} home ${e.l > 0 ? '-' : '+'}${Math.abs(e.l)} (${e.s}, read ${hhmm(e.lt)})${e.pre ? '' : ' AFTER KICKOFF'}${e.late ? ' late' : ''}`);
    });
  });
  // 2. model inputs: a finished game uses its closing line; any other game the line this server holds for it
  const lineOf = (g) => { if (g.state === 'post') { const c = closeOf(g); if (c !== null) return c; } const r = weeks[g.week], e = r && r.v === 2 && r.gl && r.gl[g.id]; if (e) return e.l; if (g.state !== 'post') return null; let h = null; try { h = (D.lines() || {})[g.id]; } catch (er) {} const x = Array.isArray(h) ? h.filter((y) => y[0] < g.start).pop() : null; return x && half(x[1]) ? x[1] : null; }; // last resort for a finished game: the ESPN line this server logged before kickoff
  const gs = games.map((g) => Object.assign({}, g, { line: lineOf(g) })), rows = Trophy.pool(gs, SEASON), W = Trophy.weekly(gs, SEASON), R = H.ratings(games, cur, bx.map), byId = {}; gs.forEach((g) => (byId[g.id] = g));
  // 3. picks
  open.forEach((w) => {
    const rec = weeks[w], wg = byW[w].slice().sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1)), first = rec.first, mark = first - MARK;
    const full = gs.every((g) => g.week >= w || (g.state === 'post' && g.line !== null)); // the model reads every earlier result and line: without them a pick is only an early look
    const stamp = (o, kick, pre) => { o.final = true; o.t = now; o.pre = pre; if (now > kick - MARK + GRACE) o.late = 1; return o; };
    if (!(rec.lock && rec.lock.final)) {
      const p = (W[w] || []).find((x) => x.rank === 2), L = p ? { id: String(p.id), rank: 2, abbr: p.abbr, other: p.other, line: p.line, conf: r4(p.conf), dog: !!p.dog } : null;
      if (L && !full) L.part = 1;
      if (L && now >= mark && (full || now >= first)) { stamp(L, first, now < first); rec.t = now; rec.pre = L.pre; D.log(`week ${w} LOCK final: ${L.abbr} ${L.line > 0 ? '+' : ''}${L.line} ${Math.round(L.conf * 100)}%${L.pre ? '' : ' AFTER FIRST KICKOFF'}${L.late ? ' late' : ''}${L.part ? ' (inputs incomplete)' : ''}`); }
      rec.lock = L;
    }
    const old = {}; (rec.dogs || []).forEach((d) => (old[d.id] = d));
    rec.dogs = (rec.dogs || []).filter((d) => d.final && !wg.some((g) => g.id === String(d.id))).concat(wg.map((g) => { // a final dog is kept even if its game drops out of ESPN's list
      if (old[g.id] && old[g.id].final) return old[g.id];
      const e = rec.gl[g.id]; if (!e || !(e.l > 0) || !Trophy.isDiv(g.away.abbr, g.home.abbr)) return null; // road team must be the underdog in a division game
      const c = Trophy.dogCover(byId[g.id].line === e.l ? byId[g.id] : Object.assign({}, byId[g.id], { line: e.l }), rows, SEASON), d = { id: g.id, abbr: g.away.abbr, home: g.home.abbr, line: e.l, p: c && c.p > 0 ? r4(c.p) : 0.5 };
      if (!full) d.part = 1;
      if (e.f && (full || now >= g.start)) { stamp(d, g.start, !!e.pre && now < g.start); D.log(`week ${w} road dog final: ${d.abbr} +${d.line} at ${d.home} ${Math.round(d.p * 100)}% ${d.p >= 0.53 ? 'PICKED' : 'not picked'}${d.pre ? '' : ' AFTER KICKOFF'}${d.late ? ' late' : ''}${d.part ? ' (inputs incomplete)' : ''}`); }
      return d;
    }).filter(Boolean));
    if (!(rec.helper && rec.helper.final)) {
      const h = H.best(wg, (g) => (rec.gl[g.id] ? rec.gl[g.id].l : null), R);
      if (h && !bx.full) h.part = 1;
      if (h && now >= mark && (bx.full || now >= first)) { stamp(h, first, now < first); D.log(`week ${w} HELPER final: ${h.abbr} ${Math.round(h.conf * 100)}%${h.pre ? '' : ' AFTER FIRST KICKOFF'}${h.late ? ' late' : ''}${h.part ? ' (box scores incomplete)' : ''}`); }
      rec.helper = h;
    }
    const prev = before[w]; if (prev && prev.at !== undefined) rec.at = prev.at; else delete rec.at;
    if (!prev || canon(rec) !== canon(prev)) { rec.at = now; changed.push(w); }
  });
  return changed;
}
// ---------- tick: read, compute, store ----------
let ROW = null, INF = null, TK = { at: 0, ok: false, ran: 0 }, SEA = null;
async function getRow(force) {
  if (ROW && !force && D.now() - ROW.at < 5 * 6e4) return ROW.row;
  let row = await D.S.dbGet(ID); if (!row) { await D.S.dbPut({ id: ID, salt: 'x', pinhash: 'x', data: { weeks: {} }, updated: 1 }, true); row = await D.S.dbGet(ID); if (!row) throw new Error('alert row missing'); }
  ROW = { at: D.now(), row }; return row;
}
async function run() {
  const now = D.now(), sea = await season(now); SEA = sea; if (!sea) return 'outside the ' + SEASON + ' regular season';
  const nv = await closing(now), bx = await boxes(sea.games);
  for (let tries = 0; tries < 3; tries++) {
    const row = await getRow(tries > 0), weeks = clone((row.data && row.data.weeks) || {}), changed = compute(weeks, sea.games, sea.cur, nv, bx, now);
    if (!changed.length) return 'no change';
    const upd = Math.max(now, Number(row.updated || 0) + 1);
    if (await D.S.dbPatchIf(ID, row.updated, Object.assign({}, row.data, { weeks }), upd)) { ROW = { at: D.now(), row: Object.assign({}, row, { data: Object.assign({}, row.data, { weeks }), updated: upd }) }; return 'saved week ' + changed.join(', '); }
    ROW = null; // someone else wrote (the owner fix route): read again and recompute
  }
  throw new Error('busy, could not save');
}
function tick() {
  if (!INF) INF = run().then((m) => { TK = { at: D.now(), ok: true, ran: TK.ran + 1, note: m }; }, (e) => { TK = { at: D.now(), ok: false, ran: TK.ran + 1, err: String((e && e.message) || e).slice(0, 160) }; logOnce('tick failed: ' + TK.err); }).finally(() => { INF = null; });
  return INF;
}
// ---------- what GET returns: shipped weeks (as game ids) + the stored weeks, every part flagged final or live ----------
function view(weeks, sea) {
  const out = {};
  if (sea) { const byK = {}; sea.games.forEach((g) => (byK[kOf(g)] = g)); Object.keys(D.ship).forEach((w) => { const s = D.ship[w], lg = s.lock && byK[s.lock.k], hg = s.helper && byK[s.helper.k], fl = { final: true, pre: false }; out[w] = { src: 'ship', lock: lg ? Object.assign({ id: lg.id, rank: 2, abbr: lg[s.lock.side].abbr, other: lg[s.lock.side === 'home' ? 'away' : 'home'].abbr, line: s.lock.line, conf: s.lock.conf, dog: !!s.lock.dog }, fl) : null, dogs: (s.dogs || []).map((d) => (byK[d.k] ? Object.assign({ id: byK[d.k].id, abbr: byK[d.k].away.abbr, home: byK[d.k].home.abbr, line: d.line, p: d.p }, fl) : null)).filter(Boolean), helper: hg ? Object.assign({ id: hg.id, abbr: hg[s.helper.side].abbr, conf: s.helper.conf }, fl) : null }; }); }
  Object.keys(weeks || {}).forEach((w) => {
    if (D.ship[w]) return; const r = clone(weeks[w]); r.src = 'srv';
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
    const fin = (o) => o && (rec.v !== 2 || o.final), set = (o, what, to) => { if (o.line === to) return; changes.push({ what, team: o.abbr, id: String(o.id), from: o.line, to }); if (o.was === undefined) o.was = o.line; o.line = to; o.fx = now; };
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
      send(res, 200, { season: SEASON, now: D.now(), markMin: MARK / 6e4, tick: { at: TK.at, ok: TK.ok }, stale, weeks: view((row.data && row.data.weeks) || {}, SEA) }); return true;
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
module.exports = { handle, tick, compute, view, _deps: D, _state: () => ({ TK, SEA }), _reset: () => { WK = {}; HEAD = null; NV = null; BX = null; ROW = null; INF = null; SEA = null; TK = { at: 0, ok: false, ran: 0 }; rl.clear(); Object.keys(LOGGED).forEach((k) => delete LOGGED[k]); } };
