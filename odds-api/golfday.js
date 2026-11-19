// Oddable Golf days (v273, Nov 17 2026): a GROUP GAME behind the Groups switches. Built new and small (NOT a port of feat/golf 2fa88eb).
// A group's commissioner starts a Golf day (course from the Golf GPS search, date, format, holes, pars, stroke index); members of that group join from the
// group page and log their own hole scores; everyone in the group sees the leaderboard.
// NO MONEY: no entry, no payout, no pot, no order, and nothing is sent to anyone (the owner's Activity event `golf_start` aside, which carries no contact data).
//
// THE RULES (manager defaults of Nov 17 2026, the owner may change them; HANDOFF "## v273"):
//   1  Formats: stroke play gross ('gross'), stroke play net ('net'), Stableford with net points ('stableford').
//   2  Holes: 18 ('all'), front 9 ('front'), back 9 ('back').
//   3  Par for every hole in play (3 to 6), confirmed by the commissioner (`parOk: true`). A stroke index on every hole in play is needed for net and
//      Stableford; without a complete one only gross is accepted.
//   4  Each member types his own PLAYING STROKES when joining (whole number 0 to 54; no index conversion). The commissioner may change a member's number
//      before the first score only (logged, shown to everyone); frozen after the first score.
//   5  A member enters only his own scores. The commissioner may correct a hole a member has entered; every correction is logged (who, hole, old, new, when).
//   6  Scores count at once (no partner confirmation).
//   7  Ties share a place ("T2"); no count-back.
//   8  An unfinished card shows "thru N" and is ranked by score to par (Stableford: points). The commissioner closes the day; an 18-hole day may be closed
//      as shortened to the front or the back 9 when every player has all nine of those holes: then only those holes count.
//   9  Joining is open until the first score is logged. The commissioner may remove a member before the first score. Players = members of the group (so never
//      more than the group's member limit).
//   10 Signed-in members of the group only. No typed-in guests.
//   11 One open Golf day per group at a time.
//   12 A member may change his own hole until the day is closed (changes are logged).
//   13 Course flag colours: the COURSE's colours are NOT touched (golfcourse.js D.organizer still answers false). v287 (owner, Nov 18 2026, answer e):
//      the commissioner of an open Golf day may set what each flag colour means FOR THAT DAY (`flags`, logged); only the players of that day see it on Golf GPS.
// v287 (owner answers Nov 18 2026, d): `here` = the open Golf days dated today (Chicago) at one course that the caller PLAYS in, across his groups, so the
//      Golf GPS hole screen can offer "Log my score". Scores still go through `score` (the same rules); the phone keeps a score it could not send and sends it later.
//
// SWITCHES: the same as Groups (groups.js onFor = GROUPS_ENABLED / GROUPS_OWNER_ONLY / GROUPS_TESTERS). A blocked caller gets 403 {off:true} and nothing is read
// from the database. An account whose time has ended gets 403 {expired:true} (the phone shows the same "Your time has ended" lock as everywhere else).
// STORAGE: one row per group through sync.js dbGet / dbPut / dbPatchIf (sync.js not edited): id 'lock:gd:<group id>', data { days: [ ...the open day and the
// last 5 closed ones ], hist: [ v274: the compact final board of every day closed since v274, newest 500 ] }. The 'lock:' prefix keeps the row out of player lists and owner counts.
// WHAT A MEMBER SEES OF ANOTHER MEMBER: the name the group shows and the group's short member id (pid). Never a phone number, an email, a PIN or an account id.
const crypto = require('crypto');
const D = {
  S: require('./sync'),
  acct: () => require('./acct'),
  grp: () => require('./groups'),
  ev: () => require('./events'),
  now: () => Date.now(),
  ip: (req) => require('./ip').clientIp(req),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
const FORMATS = ['gross', 'net', 'stableford'], FNAME = { gross: 'Stroke play (gross)', net: 'Stroke play (net)', stableford: 'Stableford (net points)' };
const HOLES = ['all', 'front', 'back'], HNAME = { all: '18 holes', front: 'Front 9', back: 'Back 9' };
const MAXHCP = 54, MAXSTROKES = 20, KEEP = 5, LOGMAX = 300, DAY = 864e5, HISTMAX = 500; // v274: HISTMAX = closed days kept in `hist` per group
const GID = /^[A-Z2-9]{10}$/, DID = /^[A-Z2-9]{8}$/, PID = /^[A-Z2-9]{6}$/, COURSE = /^(way|relation|node)\/([1-9]\d{0,14})$/;
const OFF_MSG = 'Groups is not open for this account yet.', LAPSED_MSG = 'Your time has ended. Pay to use Groups again.';
const K = (gid) => 'lock:gd:' + gid;
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error) => Object.assign(new Error(error), { status });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 20000) c.push(d); }); req.on('end', () => { if (n > 20000) return no(bad(413, 'Too big')); try { const j = JSON.parse(Buffer.concat(c).toString() || '{}'); ok(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', () => no(bad(400, 'Bad request'))); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const cleanName = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
const isInt = (v, a, b) => typeof v === 'number' && Number.isInteger(v) && v >= a && v <= b;
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

// ---------- scoring (pure: no clock, no database) ----------
const holesOf = (h) => (h === 'front' ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : h === 'back' ? [10, 11, 12, 13, 14, 15, 16, 17, 18] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
// The holes that COUNT: the day's holes, or the nine an 18-hole day was shortened to (rule 8).
const counting = (d) => holesOf(d.short || d.holes);
// Rule 4: the typed number IS the playing strokes for the round as set up (18, or the 9 being played). They are given out by stroke index over the holes
// in play: every hole gets floor(strokes / holes), and the (strokes mod holes) hardest holes (lowest stroke index) one more. A day shortened to nine keeps
// the strokes each hole already had (nothing is re-dealt after play).
function strokesGiven(d, hcp) {
  const hs = holesOf(d.holes), out = {}; hs.forEach((h) => (out[h] = 0));
  if (!d.si || !(hcp > 0)) return out;
  const order = hs.slice().sort((a, b) => d.si[a] - d.si[b]), base = Math.floor(hcp / hs.length), extra = hcp % hs.length;
  order.forEach((h, i) => (out[h] = base + (i < extra ? 1 : 0)));
  return out;
}
const stablefordPts = (par, net) => Math.max(0, 2 + par - net);
// One player's card over the counting holes.
function card(d, p) {
  const sc = (d.scores && d.scores[p.pid]) || {}, given = strokesGiven(d, p.hcp), hs = counting(d);
  let thru = 0, gross = 0, par = 0, net = 0, pts = 0;
  hs.forEach((h) => { const s = sc[h]; if (!isInt(s, 1, MAXSTROKES)) return; thru++; gross += s; par += d.par[h]; net += s - given[h]; pts += stablefordPts(d.par[h], s - given[h]); });
  return { pid: p.pid, name: p.name, hcp: p.hcp, thru, of: hs.length, done: thru === hs.length, gross, par, net, pts, toPar: (d.format === 'net' ? net : gross) - par };
}
// Rules 7 and 8: ranked by score to par (gross or net), Stableford by points; ties share a place; a player with no hole yet has no place.
function board(d) {
  const rows = (d.players || []).map((p) => card(d, p)), sf = d.format === 'stableford', val = (r) => (sf ? -r.pts : r.toPar);
  const on = rows.filter((r) => r.thru > 0).sort((a, b) => val(a) - val(b) || String(a.name).localeCompare(String(b.name)) || (a.pid < b.pid ? -1 : 1));
  on.forEach((r, i) => { r.place = i && val(on[i - 1]) === val(r) ? on[i - 1].place : i + 1; });
  on.forEach((r) => { r.tied = on.filter((x) => x.place === r.place).length > 1; });
  const off = rows.filter((r) => !r.thru).sort((a, b) => String(a.name).localeCompare(String(b.name))); off.forEach((r) => { r.none = true; r.place = 0; r.tied = false; });
  return on.concat(off);
}
// Can an 18-hole day be closed as shortened to this nine? Only when there is a player and every player has all nine holes (rule 8).
const canShort = (d, half) => d.holes === 'all' && (half === 'front' || half === 'back') && (d.players || []).length > 0 && d.players.every((p) => holesOf(half).every((h) => isInt(((d.scores || {})[p.pid] || {})[h], 1, MAXSTROKES)));

// ---------- set-up ----------
function cleanPar(par, hs) { const out = {}; for (const h of hs) { const v = par && par[h]; if (!isInt(v, 3, 6)) throw bad(400, 'Par for hole ' + h + ' must be 3, 4, 5 or 6'); out[h] = v; } return out; }
// A complete stroke index = a whole number 1 to 18 on every hole in play, none used twice. Anything less is "no stroke index" (null), never an error:
// the format check below then explains why net and Stableford are not offered.
function cleanSi(si, hs) { if (!si || typeof si !== 'object') return null; const out = {}, seen = new Set(); for (const h of hs) { const v = si[h]; if (!isInt(v, 1, 18) || seen.has(v)) return null; seen.add(v); out[h] = v; } return out; }
const NEED_SI = 'Net and Stableford need a stroke index on every hole (1 to 18, each used once). Type them in, or play stroke play gross.';
function cleanDay(b, now) {
  const c = b.course || {}, id = String(c.id || ''); if (!COURSE.test(id)) throw bad(400, 'Pick the course from the search');
  const cname = cleanName(c.name, 60); if (cname.length < 2) throw bad(400, 'Pick the course from the search');
  const date = String(b.date || ''), today = chiDay(now); if (!okDay(date)) throw bad(400, 'Pick the date'); if (date < today) throw bad(400, 'The date is in the past'); if (date > addDays(today, 365)) throw bad(400, 'The date is too far away');
  const format = String(b.format || ''); if (!FORMATS.includes(format)) throw bad(400, 'Pick the format');
  const holes = String(b.holes || ''); if (!HOLES.includes(holes)) throw bad(400, 'Pick 18 holes, the front 9 or the back 9');
  const hs = holesOf(holes), par = cleanPar(b.par, hs); if (b.parOk !== true) throw bad(400, 'Check the par of every hole and confirm it');
  const si = cleanSi(b.si, hs); if (format !== 'gross' && !si) throw bad(400, NEED_SI);
  const course = { id, name: cname }; if (Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lon)) && Math.abs(Number(c.lat)) <= 90 && Math.abs(Number(c.lon)) <= 180 && c.lat != null && c.lon != null) { course.lat = Math.round(Number(c.lat) * 1e5) / 1e5; course.lon = Math.round(Number(c.lon) * 1e5) / 1e5; }
  return { id: rnd(8), name: cleanName(b.name, 30) || cleanName(cname, 30), course, date, format, holes, par, si, created: now, started: 0, closed: 0, short: '', players: [], scores: {}, log: [] };
}

// ---------- rows: read, change, write only if nobody else wrote (the pattern of groups.js) ----------
const QUEUE = new Map();
function serial(key, fn) { const prev = QUEUE.get(key) || Promise.resolve(), run = prev.then(fn, fn), tail = run.then(() => {}, () => {}); QUEUE.set(key, tail); tail.then(() => { if (QUEUE.get(key) === tail) QUEUE.delete(key); }); return run; }
const rmw = (key, fn) => serial(key, async () => {
  for (let i = 0; i < 16; i++) {
    let row = await D.S.dbGet(key);
    if (!row) { await D.S.dbPut({ id: key, salt: 'x', pinhash: 'x', data: { days: [] }, updated: 1 }, true); row = await D.S.dbGet(key); if (!row) continue; }
    const data = clone(row.data || {}); if (!Array.isArray(data.days)) data.days = [];
    const out = await fn(data);
    if (await D.S.dbPatchIf(key, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
    await D.sleep(3 + Math.random() * 12 * Math.min(i + 1, 6));
  }
  throw bad(409, 'Busy, try again');
});
const read = async (gid) => { const r = await D.S.dbGet(K(gid)); return r && r.data && Array.isArray(r.data.days) ? r.data.days : []; };
const openOf = (days) => days.find((d) => !d.closed) || null;
const find = (days, id) => { const d = days.find((x) => x.id === String(id || '')); if (!d) throw bad(404, 'Golf day not found'); return d; };
const logIt = (d, e) => { d.log = (d.log || []).concat(e).slice(-LOGMAX); };

// ---------- what the phone gets ----------
const scoreFrom = (d) => d.date; // scoring opens on the day itself (Chicago date)
// v287: what each flag colour means today, set by the commissioner for this day (the same words golfcourse.js stores: short / center / long)
const FCOLORS = ['red', 'white', 'blue', 'yellow'], FPLACES = ['short', 'center', 'long'];
function cleanFlags(f) { if (f == null) return null; if (typeof f !== 'object' || Array.isArray(f)) throw bad(400, 'Pick Short, Center or Long for each colour'); const o = {}; for (const c of FCOLORS) { if (!FPLACES.includes(f[c])) throw bad(400, 'Pick Short, Center or Long for each colour'); o[c] = f[c]; } return o; }
const flagsOf = (d) => (d.flags && d.flags.map ? { map: Object.assign({}, d.flags.map), by: d.flags.by || '', at: d.flags.at || 0 } : null);
function summary(d) { return { id: d.id, name: d.name, course: { id: d.course.id, name: d.course.name }, date: d.date, format: d.format, formatName: FNAME[d.format], holes: d.holes, holesName: HNAME[d.holes], players: d.players.length, started: !!d.started, closed: d.closed || 0, short: d.short || '' }; }
function view(d, m, now) {
  const o = summary(d), mine = d.players.find((p) => p.pid === m.pid);
  o.course = clone(d.course); o.par = d.par; o.si = d.si || null; o.count = counting(d);
  o.me = m.pid; o.comm = !!m.comm; o.joined = !!mine; o.myHcp = mine ? mine.hcp : null;
  o.canJoin = !d.closed && !d.started && !mine; o.canScore = !!mine && !d.closed && chiDay(now) >= scoreFrom(d); o.scoreFrom = scoreFrom(d);
  o.usesHcp = d.format !== 'gross';
  o.board = board(d);
  o.scores = {}; d.players.forEach((p) => { o.scores[p.pid] = (d.scores && d.scores[p.pid]) || {}; });
  o.given = {}; if (d.si) d.players.forEach((p) => { o.given[p.pid] = strokesGiven(d, p.hcp); });
  o.log = (d.log || []).slice(-100).reverse();
  o.canShort = d.closed ? [] : ['front', 'back'].filter((h) => canShort(d, h));
  o.flags = flagsOf(d); // v287
  return o;
}

// ---------- rate limits (per account, in memory) ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k >= 1000) break; } } return false; }

// ---------- the switches (the SAME answer as every /groups call) ----------
const signedIn = (req) => { try { return D.acct().who(req) || null; } catch (e) { return null; } };
const allowed = (e) => { try { return !!D.grp().onFor(e); } catch (er) { return false; } };
async function lapsed(e) { if (!e) return false; try { const A = D.acct(); return typeof A.expired === 'function' ? !!(await A.expired(e)) : false; } catch (er) { return false; } }

// ---------- routes: POST /golfday/<op>, JSON, x-token ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/golfday' && !path.startsWith('/golfday/')) return false;
  const op = path.slice(9), e = signedIn(req);
  if (!allowed(e)) { req.resume(); send(res, 403, { error: OFF_MSG, off: true }); return true; }           // Groups off, or not on for this account: nothing is read
  if (await lapsed(e)) { req.resume(); send(res, 403, { error: LAPSED_MSG, expired: true }); return true; } // time ended: locked until paid, nothing deleted
  if (req.method !== 'POST') { req.resume(); send(res, 405, { error: 'POST only' }); return true; }
  try {
    if (!e) throw bad(401, 'Sign in to use Groups');
    const b = await body(req), now = D.now(), gid = String(b.g || '');
    if (op === 'here') { // v287: the open Golf days at this course, dated today (Chicago), that this account plays in (any of his groups)
      const cid = String(b.course || ''); if (!COURSE.test(cid)) throw bad(400, 'Pick the course');
      if (limit('gd|' + e, 600, 600e3) || limit('gdh|' + e, 120, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      const ids = (await D.grp().myGroupIds(e).catch(() => [])).filter((x) => GID.test(x)), today = chiDay(now), found = [];
      for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(async (id) => {
        const d = openOf(await read(id).catch(() => [])); if (!d || d.course.id !== cid || d.date !== today) return;
        const m = await D.grp().memberCheck(id, e).catch(() => null); if (!m || !d.players.some((p) => p.pid === m.pid)) return;
        found.push({ g: id, group: cleanName(m.group, 40), day: view(d, m, now) });
      }));
      found.sort((a, c) => a.group.localeCompare(c.group) || (a.g < c.g ? -1 : 1));
      send(res, 200, { ok: true, days: found }); return true;
    }
    if (!GID.test(gid)) throw bad(404, 'Group not found');
    if (limit('gd|' + e, 600, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
    const m = await D.grp().memberCheck(gid, e); if (!m) throw bad(403, 'Golf days are for members of this group');
    const who = cleanName(m.name, 24) || 'Player';
    const out = (d, extra) => send(res, 200, Object.assign({ ok: true, day: view(d, m, now) }, extra || {}));
    const need = (d) => { if (d.closed) throw bad(409, 'This Golf day is closed'); return d; };
    const comm = () => { if (!m.comm) throw bad(403, 'Only the commissioner can do that'); };

    if (op === 'list') { const days = await read(gid), o = openOf(days); send(res, 200, { ok: true, comm: !!m.comm, open: o ? summary(o) : null, past: days.filter((d) => d.closed).sort((a, b) => b.closed - a.closed).map(summary), formats: FORMATS.map((f) => [f, FNAME[f]]), holes: HOLES.map((h) => [h, HNAME[h]]) }); return true; }
    if (op === 'get') { out(find(await read(gid), b.id)); return true; }

    if (op === 'create') { // rule 11: one open Golf day per group
      comm(); const nd = cleanDay(b, now);
      const d = await rmw(K(gid), (x) => { if (openOf(x.days)) throw bad(409, 'This group already has an open Golf day. Close it first.'); if (limit('gdc|' + e, 5, DAY)) throw bad(429, 'You started several Golf days today. Try again tomorrow.'); x.days.push(nd); const closed = x.days.filter((y) => y.closed).sort((a, b2) => b2.closed - a.closed).slice(0, KEEP); x.days = closed.concat(nd); return nd; });
      out(d);
      // The owner's Activity (events.js -> My Apps), AFTER the write and the answer. Names of the group, the day and the course only; events.js cleans them again.
      try { D.ev().golfStarted({ id: gid, name: m.group || '' }, d.name, { account: /@/.test(String(e)) ? String(e) : undefined, key: 'golf_start|' + gid + '|' + d.id, detail: [m.group ? 'Group: ' + cleanName(m.group, 40) : '', cleanName(d.course.name, 50), FNAME[d.format], d.date].filter(Boolean).join('. ') }); } catch (er) {}
      return true;
    }
    if (!DID.test(String(b.id || ''))) throw bad(404, 'Golf day not found');
    const mut = (fn) => rmw(K(gid), (x) => { const d = find(x.days, b.id); fn(d); return d; });

    if (op === 'join') { // rules 4, 9, 10: a member of the group, before the first score, with his own playing strokes
      const hcp = b.hcp == null ? 0 : b.hcp;
      out(await mut((d) => { need(d); if (d.started) throw bad(409, 'Joining closed when the first score was logged');
        if (d.format !== 'gross' && !isInt(hcp, 0, MAXHCP)) throw bad(400, 'Type your playing strokes: a whole number from 0 to ' + MAXHCP);
        const h = d.format === 'gross' ? 0 : hcp, p = d.players.find((q) => q.pid === m.pid);
        if (p) { if (p.hcp !== h) { logIt(d, { at: now, kind: 'hcp', by: who, who, old: p.hcp, new: h }); p.hcp = h; } p.name = who; return; } // already in: he may re-type his own number until the first score (logged)
        d.players.push({ pid: m.pid, name: who, hcp: h, joined: now }); d.scores[m.pid] = {}; }));
      return true;
    }
    if (op === 'leave') { out(await mut((d) => { need(d); if (d.started) throw bad(409, 'The round has started. Players stay on the board.'); if (!d.players.some((p) => p.pid === m.pid)) throw bad(409, 'You are not in this Golf day'); d.players = d.players.filter((p) => p.pid !== m.pid); delete d.scores[m.pid]; })); return true; }
    if (op === 'remove') { // rule 9
      comm(); const pid = String(b.pid || ''); if (!PID.test(pid)) throw bad(404, 'Player not found');
      out(await mut((d) => { need(d); if (d.started) throw bad(409, 'A player can only be removed before the first score'); const p = d.players.find((q) => q.pid === pid); if (!p) throw bad(404, 'Player not found'); d.players = d.players.filter((q) => q.pid !== pid); delete d.scores[pid]; logIt(d, { at: now, kind: 'remove', by: who, who: p.name }); }));
      return true;
    }
    if (op === 'hcp') { // rule 4: the commissioner, before the first score only; logged and shown to everyone
      comm(); const pid = String(b.pid || ''), hcp = b.hcp; if (!PID.test(pid)) throw bad(404, 'Player not found'); if (!isInt(hcp, 0, MAXHCP)) throw bad(400, 'Playing strokes: a whole number from 0 to ' + MAXHCP);
      out(await mut((d) => { need(d); if (d.format === 'gross') throw bad(400, 'Stroke play gross uses no playing strokes'); if (d.started) throw bad(409, 'Playing strokes are frozen: the first score is in'); const p = d.players.find((q) => q.pid === pid); if (!p) throw bad(404, 'Player not found'); if (p.hcp === hcp) return; logIt(d, { at: now, kind: 'hcp', by: who, who: p.name, old: p.hcp, new: hcp }); p.hcp = hcp; }));
      return true;
    }
    if (op === 'score') { // rules 5, 6, 12
      const hole = b.hole, s = b.strokes == null || b.strokes === 0 ? null : b.strokes, pid = b.pid == null || b.pid === '' ? m.pid : String(b.pid), own = pid === m.pid;
      if (!PID.test(pid)) throw bad(404, 'Player not found');
      if (s !== null && !isInt(s, 1, MAXSTROKES)) throw bad(400, 'Strokes: a whole number from 1 to ' + MAXSTROKES);
      if (!own) comm();
      out(await mut((d) => { need(d);
        const p = d.players.find((q) => q.pid === pid); if (!p) throw bad(own ? 403 : 404, own ? 'Join this Golf day first' : 'Player not found');
        if (!isInt(hole, 1, 18) || !holesOf(d.holes).includes(hole)) throw bad(400, 'That hole is not in this round');
        if (chiDay(now) < scoreFrom(d)) throw bad(409, 'Scores open on the day of the round (' + d.date + ')');
        const sc = d.scores[pid] || (d.scores[pid] = {}), old = isInt(sc[hole], 1, MAXSTROKES) ? sc[hole] : null;
        if (!own) { if (old === null) throw bad(409, 'A member enters his own scores. You can correct a hole once he has entered it.'); if (s === null) throw bad(400, 'Type the corrected strokes'); }
        if (old === s) return;
        if (s === null) delete sc[hole]; else sc[hole] = s;
        if (old !== null) logIt(d, { at: now, kind: own ? (s === null ? 'clear' : 'edit') : 'fix', by: who, who: p.name, hole, old, new: s }); // a first entry is not a change; every change is logged
        if (own) p.name = who; if (!d.started) d.started = now; }));
      return true;
    }
    if (op === 'flags') { // v287 (owner answer e): the commissioner sets what the flag colours mean today, for this day only (null = back to the course's colours)
      comm(); const f = cleanFlags(b.flags);
      out(await mut((d) => { need(d); const was = d.flags && d.flags.map ? JSON.stringify(d.flags.map) : '';
        if (!f) { if (!was) return; delete d.flags; logIt(d, { at: now, kind: 'flags', by: who, map: null }); return; }
        if (was === JSON.stringify(f)) return; d.flags = { map: f, by: who, at: now }; logIt(d, { at: now, kind: 'flags', by: who, map: f }); }));
      return true;
    }
    if (op === 'close') { // rule 8
      comm(); const half = b.short == null || b.short === '' ? '' : String(b.short);
      out(await rmw(K(gid), (x) => { const d = find(x.days, b.id); need(d); if (!d.started) throw bad(409, 'No score has been logged. Cancel the Golf day instead.');
        if (half) { if (d.holes !== 'all' || !['front', 'back'].includes(half)) throw bad(400, 'Only an 18-hole day can be shortened to nine'); if (!canShort(d, half)) throw bad(409, 'Not every player has all nine of those holes yet'); d.short = half; }
        d.closed = now; logIt(d, { at: now, kind: 'close', by: who, short: half });
        // v274: the final board of every closed day is also kept in `hist` (compact: names, member ids, numbers), so lifetime stats (gstats.js) still
        // count a day after it drops out of the last KEEP closed days. HISTMAX per group, oldest dropped first.
        x.hist = (Array.isArray(x.hist) ? x.hist : []).filter((h) => h && h.id !== d.id).concat(require('./gstats').histOf(module.exports, d)).slice(-HISTMAX);
        return d; }));
      return true;
    }
    if (op === 'cancel') { comm(); await rmw(K(gid), (x) => { const d = find(x.days, b.id); need(d); if (d.started) throw bad(409, 'Scores are in. Close the Golf day instead.'); x.days = x.days.filter((y) => y.id !== d.id); }); send(res, 200, { ok: true, gone: true }); return true; }
    throw bad(404, 'Not found');
  } catch (er) { if (!er.status) console.error('golfday:', er.message); send(res, er.status || 500, { error: er.status ? er.message : 'Golf day error, try again' }); }
  return true;
}
module.exports = { handle, cleanFlags, board, card, strokesGiven, stablefordPts, holesOf, counting, canShort, cleanDay, cleanPar, cleanSi, view, summary, FORMATS, HOLES, NEED_SI, _deps: D, _reset: () => { RL.clear(); QUEUE.clear(); } };
