// Oddable Golf (engine v1, Nov 16 2026). Pro tournament pools (Pick six, One and done) and "our golf day" (every format, heads-up matches, extras).
// A golf contest works on its own (invite link ?join=golf.<code>) or attached to a group as contest type "golf-pro" / "golf-day".
// MONEY STAYS OUTSIDE THE APP: entry, take, per-match amounts, skins and prizes are information only. Nothing is collected, held or paid.
// Storage (Supabase oddable_sync; 'lock:' prefix keeps these rows out of every player list / owner count):
//   'lock:golf:<id>'      one contest (settings, members, picks or the golf day's teams/scores/audit), every change with dbPatchIf on `updated`
//   'lock:golf:idx'       { codes: {code: id}, mine: {memberKey: [ids]} }
//   'lock:golf:courses'   { courses: {id: course} } saved courses typed in by users (no paid course database)
//   'lock:ent'            { keys: {accountKey: true}, courses: {accountKey: [courseId]} } enterprise accounts (STAND-IN for Groups' limits.maxPeople; see HANDOFF)
//                         and the saved courses each enterprise account (a golf course / club) is linked to by the owner (POST /golf/ent, owner token only)
// Members are shown by their Oddable name/handle only; member keys, account ids and phones are never sent to anyone.
'use strict';
const crypto = require('crypto');
const S = require('./golf-score'), F = require('./golf-feed'), CO = require('./golf-courses');
// HANDICAPS: ONE SOURCE, the stats module (odds-api/stats.js; manager decision Nov 16 2026). Golf keeps no index, no override store and no director
// log of its own: stats owns handicapFor / eventSetup / eventOverride / eventLog and the row 'lock:evr:<eventId>'. Contract used here:
//   handicapFor(userKey, {eventId, casual, typed}) -> { oddable: {index, rounds, text}, confirmedIndex, rounds, confirmedRounds, event, setBy, use, needsSet, text }
//       use = the number to play off: the tournament's value when a director set one; the CONFIRMED index in a money game, a flight or a tournament;
//       the full index in a casual round ({casual: true}); null = no usable number yet (the organizer or director sets one).
//       text = what people see next to a handicap: "12.6 · 4 of 20 rounds confirmed".
//   eventSetup(directorId, eventId, {title, sport, lockAt})            once per Enterprise tournament, and again when its first tee time moves
//   eventOverride(directorId, eventId, userKey, {hcp, reason, name})   the director's add / change, for that tournament only (E-H); stats logs it
//   eventLog(callerId, eventId) -> {log: [{at, by, player, old, new, oddable, reason}], locked, lockAt}
// eventId for a golf game = 'golf:<game id>'. When stats.js is not in the build (this branch on its own) nobody has an index: every number is set by
// the organizer, and tournament overrides answer 503. Tests plug a fake with the same shapes into golf._deps.
const NOSTATS = 'Tournament handicaps need the stats module, which is not in this build.';
const noStats = (o) => { const x = o || {}, t = x.typed != null && x.typed !== '' && Number.isFinite(Number(x.typed)) ? Math.round(Number(x.typed) * 10) / 10 : null, use = x.casual ? null : t;
  return { oddable: { index: null, rounds: 0, text: '' }, confirmedIndex: null, rounds: 0, confirmedRounds: 0, event: null, setBy: use != null ? 'organizer' : null, use, needsSet: use == null && !x.casual, text: '' }; };
const mod = (name, need) => { try { const m = require(name); return m && need.every((f) => typeof m[f] === 'function') ? m : null; } catch (e) { return null; } };
const D = { S: require('./sync'), acct: () => require('./acct'), now: () => Date.now(), ip: (req) => require('./ip').clientIp(req), feed: F, courses: CO, ownerOk: (req) => require('./acct').ownerOk(req), pairing: () => require('./pairing'),
  stats: () => mod('./stats', ['handicapFor', 'eventSetup', 'eventOverride', 'eventLog']), // THE handicap module (not in this branch; in the merged build)
  groups: () => mod('./groups', ['attachGame']), // Groups: attachGame(groupId, accountId, {type, ref, name, pot}) checks the caller is that group's commissioner
  limitsMod: () => mod('./limits', ['maxPeople', 'keyOf']), // the shared limits file (Groups branch)
  handicapFor: async (k, o) => { const st = D.stats(); return st ? st.handicapFor(k, o) : noStats(o); },
  eventSetup: async (d, id, o) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventSetup(d, id, o); },
  eventOverride: async (d, id, k, o) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventOverride(d, id, k, o); },
  eventLog: async (d, id) => { const st = D.stats(); if (!st) throw bad(503, NOSTATS); return st.eventLog(d, id); } };
const HCP_LABEL = 'Oddable Handicap Index', HCP_NOTE = 'Calculated with the World Handicap System method.', EID = (id) => 'golf:' + id;
const ROW = (id) => 'lock:golf:' + id, IDX = 'lock:golf:idx', CRS = 'lock:golf:courses', ENT = 'lock:ent', PLAYS = 'lock:golf:plays';
const DAY = 864e5;
const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // shared text (OWNER-DECISIONS, Limits and pricing)
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error, extra) => Object.assign(new Error(error), { status, extra });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 40000) c.push(d); }); req.on('end', () => { if (n > 40000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
// Names keep apostrophes and quotes (O'Neil, Sean O'Hair; review fix Nov 16 2026); tags and < > ` \\ and control characters are removed. EVERY consumer escapes on output (pics/golf.js esc/att).
const clean = (n, max) => String(n == null ? '' : n).replace(/<[^>]*>/g, '').replace(/[<>`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/^GOLF\./, '').replace(/[^A-Z0-9]/g, ''); return x.length === 10 ? x : ''; }; // 10 chars of 32 = 50 random bits
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkOf = (e) => crypto.createHash('sha256').update('oddable-golf|' + e).digest('hex').slice(0, 24);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// ---------- people cap (owner Nov 16 2026: standard accounts top out at 8 people, organizer included; enterprise lifts it) ----------
// The shared limits file (odds-api/limits.js, Groups branch) is used when it is in the build: maxPeople(keyOf(accountId), gameId), isEnterprise,
// recordPlay(accountKey, gameType, gameId, playerKey). Without it (this branch alone) the STAND-INS below answer with the same signatures.
// Golf always passes the organizer's ACCOUNT ID; the key (limits.keyOf) is worked out here.
const ENTC = { at: 0, keys: {} };
const limits = {
  isEnterprise: async (accountId) => { const L = D.limitsMod(); if (L && typeof L.isEnterprise === 'function') return !!(await L.isEnterprise(L.keyOf(accountId))); return (await limits.maxPeople(accountId)) > 8; },
  maxPeople: async (accountId, groupOrGameId) => { const L = D.limitsMod(); if (L) return L.maxPeople(L.keyOf(accountId), groupOrGameId || '');
    if (D.now() - ENTC.at > 60e3) { try { const r = await D.S.dbGet(ENT); ENTC.keys = (r && r.data && r.data.keys) || {}; } catch (e) {} ENTC.at = D.now(); } return ENTC.keys[accountId] ? 400 : 8; },
  // ENTERPRISE BILLING ($20 per player per game): every play is recorded through the shared limits.recordPlay(accountKey, gameType, gameId, playerKey).
  // Stand-in: row 'lock:golf:plays' { m: { 'YYYY-MM': { <account key>: { <gameId>: { t: gameType, p: [playerKey] } } } } }, one line per player per game.
  recordPlay: async (accountId, gameType, gameId, playerKey) => { const L = D.limitsMod(); if (L && typeof L.recordPlay === 'function') return L.recordPlay(L.keyOf(accountId), gameType, gameId, playerKey);
    const ak = mkOf(accountId), mo = chiDay(D.now()).slice(0, 7), gid = String(gameId).slice(0, 60), pk = String(playerKey).slice(0, 40);
    return mutateRow(PLAYS, () => ({ m: {} }), (d) => { d.m = d.m || {}; const a = ((d.m[mo] = d.m[mo] || {})[ak] = d.m[mo][ak] || {}), g = (a[gid] = a[gid] || { t: String(gameType).slice(0, 20), p: [] }); if (g.p.includes(pk)) return { nochange: true, v: { ok: true, dup: true } }; g.p.push(pk);
      const ms = Object.keys(d.m).sort(); while (ms.length > 14) delete d.m[ms.shift()]; return { ok: true }; }); },
};
// One call per player per game; never blocks or fails a play (billing is counted, the game goes on).
async function recPlays(c, gameType, pids, gameId) { for (const p of pids) { const m = c.members.find((x) => x.pid === p); if (!m) continue; try { await limits.recordPlay(c.orgE, gameType, gameId || c.id, m.guest ? 'g:' + m.gid : m.mk); } catch (e) { console.error('golf: recordPlay', e.message); } } }

// Enterprise course links (owner sets them): which saved courses an enterprise account (a course or club) runs. Events played there record courseId.
async function entRow() { const r = await D.S.dbGet(ENT); return (r && r.data) || {}; }
async function coursesOwnedBy(accountKey) {
  const e = await entRow(), ids = ((e.courses || {})[String(accountKey)] || []).slice(0, 50); if (!ids.length) return [];
  const r = await D.S.dbGet(CRS), all = (r && r.data && r.data.courses) || {};
  return ids.filter((id) => all[id]).map((id) => ({ id, name: all[id].name, tees: all[id].tees, holes: all[id].holes, rating: all[id].rating ?? null, slope: all[id].slope ?? null, city: all[id].city || '' }));
}

// ---------- rate limits ----------
const RL = new Map();
function limit(key, n, ms) { const t = D.now(), a = (RL.get(key) || []).filter((x) => t - x < ms); if (a.length >= n) { RL.set(key, a); return true; } a.push(t); RL.set(key, a); if (RL.size > 20000) { let k = 0; for (const x of RL.keys()) { RL.delete(x); if (++k > 5000) break; } } return false; }
const LIM = { create: [8, 3600e3, 20, 3600e3], code: [30, 600e3, 60, 600e3], score: [240, 600e3, 600, 600e3], write: [120, 600e3, 300, 600e3], read: [300, 600e3, 900, 600e3] };
function rate(kind, who, ip) { const L = LIM[kind]; if (limit(kind + '|a|' + who, L[0], L[1]) || limit(kind + '|i|' + ip, L[2], L[3])) throw bad(429, 'Too many tries. Wait a few minutes.'); }
const fails = (k) => (RL.get('f|' + k) || []).filter((x) => D.now() - x < 900e3).length;
const fail = (k) => { const a = (RL.get('f|' + k) || []).filter((x) => D.now() - x < 900e3); a.push(D.now()); RL.set('f|' + k, a); };

// ---------- rows ----------
async function mutateRow(id, init, fn) { // read, change, write only if nobody wrote in between; else redo (no lost updates)
  for (let i = 0; i < 8; i++) {
    let row = await D.S.dbGet(id);
    if (!row) { if (!init) throw bad(404, 'Not found'); await D.S.dbPut({ id, salt: 'x', pinhash: 'x', data: init(), updated: 1 }, true); row = await D.S.dbGet(id); if (!row) continue; }
    const data = clone(row.data || {}); const out = await fn(data);
    if (out && out.nochange) return out.v;
    if (await D.S.dbPatchIf(id, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out;
  }
  throw bad(409, 'Busy, try again');
}
async function getC(id) { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) throw bad(404, 'Golf game not found'); const r = await D.S.dbGet(ROW(id)); if (!r || !r.data || !r.data.id) throw bad(404, 'Golf game not found'); return r.data; }
const mutC = (id, fn) => { if (!/^[A-Z2-9]{10}$/.test(String(id || ''))) throw bad(404, 'Golf game not found'); return mutateRow(ROW(id), null, fn); };
const mutIdx = (fn) => mutateRow(IDX, () => ({ codes: {}, mine: {} }), (d) => { d.codes = d.codes || {}; d.mine = d.mine || {}; return fn(d); });

// ---------- who ----------
async function me(req) { const e = D.acct().who(req); if (!e) throw bad(401, 'Sign in to use Golf'); return { e, mk: mkOf(e) }; }
function nameFor(u, given) { const A = D.acct(); if (u.e === 'owner' || (A.isOwnerPhone && A.isOwnerPhone(u.e))) return clean(A.ownerName && A.ownerName(), 24) || 'Owner'; return clean(given, 24) || 'Player'; }
// A member who LEFT a pool after picking in group play keeps the entry (G16): the row stays with `left` set, and is not a member for any route until they rejoin.
const anyMember = (c, mk) => (mk ? c.members.find((m) => m.mk === mk) : undefined);
const memberOf = (c, mk) => { const m = anyMember(c, mk); return m && !m.left ? m : undefined; };
const isOrg = (c, mk) => c.org === mk;
// Co-organizers (the organizer names them): they can settle disputes and confirm cards on teams they are not part of. They cannot start, finish or reopen.
const isCo = (c, m) => !!m && (c.co || []).includes(m.pid);
// "On the team's side" = plays on it or scores for it. Nobody settles, confirms or forces anything for a team they are on the side of.
const teamSide = (t, pid) => !!t && !!pid && (t.players.includes(pid) || t.scorer === pid);
// Notices every player sees the next time the game is opened or refreshed (reopen, forced finish, a team marked did-not-finish, a late paid change).
const notify = (c, kind, by, text) => { c.notes = c.notes || []; const n = ((c.notes[c.notes.length - 1] || {}).n || 0) + 1; c.notes.push({ n, at: D.now(), kind, by: by ? by.name : '', bp: by ? by.pid : null, text: clean(text, 240) }); if (c.notes.length > 60) c.notes.splice(0, c.notes.length - 60); };
const unseenOf = (c, m) => (m ? (c.notes || []).filter((x) => x.n > (m.seen || 0) && x.bp !== m.pid).length : 0);
// What the server last SENT each member of each team's hole versions: a confirm without its own `revs` is checked against this (confirm pins what was seen).
const SEEN = new Map();
const seenPut = (c, pid) => { const v = {}; Object.keys(c.day.scores || {}).forEach((tid) => { v[tid] = {}; Object.keys(c.day.scores[tid]).forEach((h) => (v[tid][h] = c.day.scores[tid][h].rev)); }); SEEN.delete(c.id + '|' + pid); SEEN.set(c.id + '|' + pid, v); if (SEEN.size > 20000) SEEN.delete(SEEN.keys().next().value); };
const newPid = (c) => { let p; do { p = rnd(6); } while (c.members.some((m) => m.pid === p)); return p; };

// ---------- validation ----------
function cleanPot(p) {
  p = p || {}; const entry = num(p.entry || 0, 0, 10000); if (entry == null || Math.round(entry) !== entry) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const k = ['none', 'pct', 'flat'].includes(p.take && p.take.kind) ? p.take.kind : 'none'; let v = 0;
  if (k === 'pct') { v = num(p.take.v, 0, 50); if (v == null || !Number.isInteger(v)) throw bad(400, "Organizer's take: a whole percent from 0 to 50"); }
  if (k === 'flat') { v = num(p.take.v, 0, 1e6); if (v == null) throw bad(400, "Organizer's take: a dollar amount, not negative"); }
  return { entry, take: { kind: k, v }, pot: p.pot === 'side' ? 'side' : 'main', split: cleanSplit(p.split) };
}
// Payout table (whole percents, 1-10 places, adding to exactly 100). None = the small-field default (golf-score defaultSplit), sized to the field.
function cleanSplit(a) { if (a == null || a === '' || (Array.isArray(a) && !a.length)) return null; const x = (Array.isArray(a) ? a : String(a).split(/[\s,\/]+/)).filter((v) => v !== '').map(Number);
  if (!x.length || x.length > 10 || x.some((v) => !Number.isInteger(v) || v <= 0) || x.reduce((s0, v) => s0 + v, 0) !== 100) throw bad(400, 'Payout table: whole percents for 1 to 10 places that add up to 100 (e.g. 60 30 10)'); return x;
}
function cleanCourse(c) {
  c = c || {}; const holes = Number(c.holes) === 9 ? 9 : 18;
  const o = { name: clean(c.name, 50), tees: clean(c.tees, 20), holes, par: (c.par || []).slice(0, holes).map(Number), hcp: (c.hcp || []).slice(0, holes).map(Number) };
  if (o.name.length < 2) throw bad(400, 'Course name (2+ characters)'); if (!o.tees) throw bad(400, 'Which tees?');
  const er = S.checkCourse(o); if (er) throw bad(400, er);
  // Course Rating and Slope Rating (per tee) feed the unofficial Oddable handicap. Optional, but checked when given.
  const par = o.par.reduce((a, x) => a + x, 0), f = holes / 18;
  if (c.slope != null && c.slope !== '') { const v = num(c.slope, 55, 155); if (v == null || !Number.isInteger(v)) throw bad(400, 'Slope Rating is a whole number from 55 to 155'); o.slope = v; }
  if (c.rating != null && c.rating !== '') { const v = num(c.rating, par - 18 * f, par + 12 * f); if (v == null) throw bad(400, 'Course Rating should be close to par (' + par + '): between ' + (par - 18 * f) + ' and ' + (par + 12 * f)); o.rating = Math.round(v * 10) / 10; }
  if (Array.isArray(c.yards)) { const y = c.yards.slice(0, holes).map((x) => (x == null || x === '' ? null : num(x, 50, 800))); if (y.some((x, i) => x == null && c.yards[i] != null && c.yards[i] !== '')) throw bad(400, 'Yards per hole: 50 to 800'); if (y.some((x) => x != null)) o.yards = y.map((x) => (x == null ? null : Math.round(x))); }
  if (c.src === 'opengolfapi') { o.src = 'opengolfapi'; o.extId = clean(c.extId, 40); o.teeKey = clean(c.teeKey, 40); }
  if (c.city) o.city = clean(c.city, 40); if (c.state) o.state = clean(c.state, 20);
  return o;
}
const SCR4 = { 2: [35, 15], 3: [30, 20, 10], 4: [25, 20, 15, 10] }, SCR_ALLOW = { scramble4: SCR4, scramble2: SCR4, texas: SCR4, florida: SCR4 };
const allowFor = (d, n) => (d.allowStd && SCR_ALLOW[d.fmt] && SCR_ALLOW[d.fmt][n] ? SCR_ALLOW[d.fmt][n] : d.allow);
function cleanDay(b, prev) {
  const fmt = String(b.fmt || ''); if (!S.FORMATS[fmt]) throw bad(400, 'Pick a format'); const F0 = S.FORMATS[fmt];
  const net = ['gross', 'net', 'both'].includes(b.net) ? b.net : 'net';
  const teamSize = Math.max(F0.size[0], Math.min(F0.size[1], num(b.teamSize, 1, 4) || F0.size[1]));
  // Starting allowances (Playbook, Nov 16 2026; every one editable at set-up). Scrambles by team size: 2 players 35/15, 3 players 30/20/10, 4 players
  // 25/20/15/10. Best ball (WHS Appendix C): pairs 85%, best 1 of 3 or 4 75%, best 2 of 3 or 4 85%; a four-ball MATCH plays at 90% and a singles
  // (player v player) match at 100% (heads.pct). Review fix Nov 16 2026: best 2 of 4 was 90 here and singles matches took the format's percent.
  const std = SCR_ALLOW[fmt] ? SCR_ALLOW[fmt][teamSize] || F0.allow : F0.allow || [];
  const allow = (Array.isArray(b.allow) && b.allow.length ? b.allow : std).slice(0, 4).map((x) => num(x, 0, 100)); if (allow.some((x) => x == null)) throw bad(400, 'Allowances are percents from 0 to 100');
  const allowStd = !!SCR_ALLOW[fmt] && JSON.stringify(allow) === JSON.stringify(std); // untouched: a team short a player uses the list for ITS size
  const count = fmt === 'shamble' || fmt === 'bestball' ? (num(b.count, 1, 2) || F0.count) : null;
  const pct0 = fmt === 'bestball' ? (teamSize === 2 ? 85 : count === 1 ? 75 : 85) : F0.pct || 100;
  const pct = num(b.pct == null || b.pct === '' ? pct0 : b.pct, 0, 100); if (pct == null) throw bad(400, 'Handicap percent 0 to 100');
  const drivePen = fmt === 'texas' ? num(b.drivePen == null || b.drivePen === '' ? 2 : b.drivePen, 0, 10) : null; if (fmt === 'texas' && (drivePen == null || !Number.isInteger(drivePen))) throw bad(400, 'Penalty for a missing drive: 0 to 10 strokes');
  const drives = fmt === 'texas' ? num(b.drives == null ? F0.drives : b.drives, 1, 9) : null; if (fmt === 'texas' && drives == null) throw bad(400, 'Drives per player: 1 to 9');
  const date = okDay(b.date) ? b.date : chiDay(D.now());
  const ex = b.extras || {}, holesN = (prev && prev.course && prev.course.holes) || 18, hl = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((h) => Number.isInteger(h) && h >= 1 && h <= holesN))].slice(0, 6);
  const extras = { skins: { on: !!(ex.skins && ex.skins.on), net: !!(ex.skins && ex.skins.net), amt: num((ex.skins && ex.skins.amt) || 0, 0, 10000) || 0, end: ex.skins && ex.skins.end === 'none' ? 'none' : 'split' }, ctp: hl(ex.ctp), ld: hl(ex.ld), ctpAmt: num(ex.ctpAmt || 0, 0, 10000) || 0, ldAmt: num(ex.ldAmt || 0, 0, 10000) || 0 };
  const hu = b.hu || b.heads || {}, press = hu.press === 'auto2' ? 'auto2' : 'accept', hp = num(hu.pct == null || hu.pct === '' ? (hu.kind === 'player' ? 100 : fmt === 'bestball' ? 90 : pct) : hu.pct, 0, 100);
  const heads = { press, pct: hp == null ? pct : hp, on: !!hu.on, pair: ['bracket', 'foursome', 'pick', 'random'].includes(hu.pair) ? hu.pair : 'pick', kind: hu.kind === 'player' ? 'player' : 'team', type: hu.type === 'nassau' ? 'nassau' : 'match', amt: num(hu.amt || 0, 0, 10000) || 0, auto: press === 'auto2' ? 2 : 0, offLow: hu.offLow !== false };
  const tee = num(b.teeTime, 1e12, 1e14), lockAt = minT(prev && prev.lockAt, tee); // first tee time = tournament start (handicap edits lock then)
  // FLIGHTS (optional): 2 to 4 handicap flights, set at Start from the handicaps in use (the confirmed index in a money game); each flight has its own
  // gross and net board and its own payout. payBy = which board the prize money follows: gross, net, or half each when both boards are kept.
  const fl = Number(b.flights && typeof b.flights === 'object' ? (b.flights.asked != null ? b.flights.asked : b.flights.n) : b.flights), flights = { n: [2, 3, 4].includes(fl) ? fl : 0 };
  const payBy = net === 'both' ? (['net', 'gross', 'both'].includes(b.payBy) ? b.payBy : 'both') : net;
  return { fmt, net, allow, allowStd, pct, count, drives, drivePen, date, extras, heads, lockAt, teamSize, flights, payBy };
}

// ---------- invite code + index ----------
async function newCodeFor(id, mk) { return mutIdx((d) => { let code; do { code = rnd(10); } while (d.codes[code]); d.codes[code] = id; d.mine[mk] = (d.mine[mk] || []).concat(id).slice(-200); return code; }); }
async function addMine(mk, id) { await mutIdx((d) => { const a = d.mine[mk] || []; if (a.includes(id)) return { nochange: true }; d.mine[mk] = a.concat(id).slice(-200); return {}; }); }
async function byCode(code, k) { const c = normCode(code); if (!c) { fail(k); throw bad(404, 'No golf game with that code'); } const r = await D.S.dbGet(IDX); const codes = (r && r.data && r.data.codes) || {}; let id = null; Object.keys(codes).forEach((x) => { if (sameCode(x, c)) id = codes[x]; }); if (!id) { fail(k); throw bad(404, 'No golf game with that code'); } return getC(id); }

// ---------- pro: feed + tiers ----------
async function boardOf(c) { try { return await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) { return null; } }
function fieldMap(b) { const m = {}; (b ? b.golfers : []).forEach((g) => (m[g.id] = g)); return m; }
// Pick six tiers (Playbook, Nov 16 2026): the DEFAULT order is neutral so a playing organizer cannot rig it: the world ranking when the free feed carries
// one for the field (golfer.wr), else alphabetical by last name. An organizer's own list is an EDIT: allowed before anyone picks, logged, and shown to
// every entrant (pro.tierLog). No odds are used (they would cost Odds API credits).
const nameKey = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const lastFirst = (n) => { const w = String(n || '').trim().split(/\s+/); return nameKey(w.slice(-1)[0] || '') + ' ' + nameKey(w.slice(0, -1).join('')); };
const tierBasis = (b, rank) => ((rank || []).length ? 'list' : b.golfers.length && b.golfers.filter((g) => Number(g.wr) > 0).length >= b.golfers.length * 0.8 ? 'wr' : 'alpha');
function buildTiers(b, rank) {
  const gs = b.golfers.slice(), key = nameKey, basis = tierBasis(b, null), neutral = (x, y) => (basis === 'wr' ? (Number(x.wr) || 1e6) - (Number(y.wr) || 1e6) : 0) || (lastFirst(x.name) < lastFirst(y.name) ? -1 : lastFirst(x.name) > lastFirst(y.name) ? 1 : 0) || (x.id < y.id ? -1 : 1);
  const pos = {}; (rank || []).forEach((n, i) => { const k = key(n); if (k && pos[k] == null) pos[k] = i; });
  gs.sort((x, y) => (pos[key(x.name)] ?? 1e6) - (pos[key(y.name)] ?? 1e6) || neutral(x, y));
  return S.tiers(gs.map((g) => g.id));
}
// LOCK (review fix): the lock time is stored once (at create / first pick) and can only move EARLIER: min(stored, first tee, event start).
// A tournament that has begun (feed state not 'pre', or any golfer started) is locked whatever the clock says.
const feedLock = (b) => { if (!b) return null; const x = [b.firstTee, b.event && b.event.start].filter((v) => Number.isFinite(v) && v > 0); return x.length ? Math.min(...x) : null; };
const begun = (b) => !!b && ((b.event && b.event.state && !['pre', 'cal'].includes(b.event.state)) || !!(b.event && b.event.done) || b.golfers.some((g) => g.started));
const minT = (...a) => { const x = a.filter((v) => Number.isFinite(v) && v > 0); return x.length ? Math.min(...x) : null; };
const lockAt = (c, b) => minT(c.pro.lockAt, feedLock(b));
// G16 (owner, Nov 16 2026): in group play a pick saves to the server the moment it is added and is then LOCKED: no edit, delete or re-pick, even before
// the first tee. Group play = the game is attached to a group, or anyone besides the organizer is in it.
const g16 = (c) => !!c.groupId || c.members.length > 1;
const G16MSG = 'Your pick is in and locked. In group play a pick cannot be changed once it is added.';
// Is real money shown on this golf day (entry, skins, closest to the pin / longest drive, a match amount)? Then unconfirmed holes block Final.
const moneyOn = (c) => { const d = c.day, e = d.extras; return (c.pot.entry || 0) > 0 || (e.skins.on && e.skins.amt > 0) || (e.ctp.length && e.ctpAmt > 0) || (e.ld.length && e.ldAmt > 0) || (d.matches || []).some((m) => m.amt > 0); };
// Unconfirmed holes and side-game winners (a team marked did-not-finish is out of it). `own` = the part a given member cannot cover with a forced
// finish: holes of a team they play on or score for, holes they entered themselves, and side winners on their team or entered by them.
const unconfirmed = (c, me) => { const d = c.day, wd = d.wd || {}; let n = 0, side = 0, own = 0;
  d.teams.forEach((t) => { if (wd[t.tid]) return; Object.values(d.scores[t.tid] || {}).forEach((h) => { if (h.st === 'confirmed') return; n++; if (me && (teamSide(t, me.pid) || h.bp === me.pid)) own++; }); });
  ['ctp', 'ld'].forEach((k) => Object.values((d.win || {})[k] || {}).forEach((w) => { if (w.st === 'confirmed') return; side++; if (me) { const wT = d.teams.find((t) => t.tid === w.who || t.players.includes(w.who)); if (w.who === me.pid || w.bp === me.pid || teamSide(wT, me.pid)) own++; } }));
  return { n: n + side, holes: n, side, own }; };
const netOn = (d) => d.net !== 'gross' || !!(d.extras.skins.on && d.extras.skins.net);
// Casual = the full Oddable index may be played off. Money shown, flights or a tournament = the confirmed index (stats handicapFor decides from this flag).
const casualOf = (c) => !!c.day.solo || (!moneyOn(c) && !c.ent && !((c.day.flights || {}).n));
const hOpts = (c) => Object.assign(c.ent ? { eventId: EID(c.id) } : {}, casualOf(c) ? { casual: true } : {});
const hLocked = (d, now) => d.status !== 'setup' || (d.lockAt != null && now >= d.lockAt); // handicaps (and director edits) lock at the start

// ---------- payouts (S-ALL: every play shows entry, payout and net; display only, never collected or paid) ----------
// Pool = entry x entrants (everyone in the game, paid or not: it is what the game is played for) minus the organizer's take.
// THE POT COUNTS ONLY ENTRANTS MARKED PAID (manager decision Nov 16 2026, same as Groups and local events). In a golf day that has started, an entrant
// must also be on a team (an organizer or director who is not playing is not in the pot).
const inPlay = (c) => (c.kind === 'day' && c.day.status !== 'setup' ? new Set(c.day.teams.flatMap((t) => t.players)) : null);
const paidPids = (c) => { const on = inPlay(c); return new Set(c.members.filter((m) => m.paid && (!on || on.has(m.pid))).map((m) => m.pid)); };
const entrantsOf = (c) => { const on = inPlay(c); return on ? on.size : c.members.length; };
function poolC(c) { const p = c.pot, potC = Math.round((p.entry || 0) * 100) * paidPids(c).size, takeC = p.take.kind === 'pct' ? Math.round(potC * p.take.v / 100) : p.take.kind === 'flat' ? Math.min(Math.round(p.take.v * 100), potC) : 0; return { potC, takeC, poolC: potC - takeC }; }
// sides: [{key, place, pids:[...]}] in finishing order. Only paid entrants can win pot money: sides with no paid player are skipped and the places are
// counted among the rest. A side's prize is split evenly among its paid players in cents. -> {pid: cents}
function payPids(c, sides) { const paid = paidPids(c), live = sides.map((x) => ({ key: x.key, place: x.place, pids: x.pids.filter((p) => paid.has(p)) })).filter((x) => x.pids.length); live.forEach((x) => (x.pl = live.filter((y) => y.place < x.place).length + 1));
  const pc = poolC(c).poolC, by = S.payouts(pc, live.map((x) => ({ id: x.key, place: x.pl })), c.pot.split), out = {};
  live.forEach((x) => { const n = x.pids.length, each = Math.floor((by[x.key] || 0) / n); let left = (by[x.key] || 0) - each * n; x.pids.forEach((p) => { out[p] = each + (left > 0 ? 1 : 0); if (left > 0) left--; }); }); return out; }
// Which board the prize money follows: gross, net, or half each (set-up says it; "both" boards with no choice = half each).
const payBy = (d) => (d.net === 'gross' ? 'gross' : d.net === 'both' ? d.payBy || 'both' : 'net');
// THE golf-day payout (pays exactly what the set-up says): the pool is shared between the flights in proportion to their PAID players, then inside a
// flight between the gross and net boards (payBy), then by the payout table. Only finished cards rank; a team's prize is split among its paid players.
// -> { pids: {pid: cents} (final rounds only), lines: [{flight, board, pool, players, places: [{place, pct, amt}], won: [{tid, name, place, amt}] | null, notWon}] }
function dayPay(c, bd) {
  const d = c.day, paid = paidPids(c), pool = poolC(c).poolC, fin = d.status === 'final', tp = {}; d.teams.forEach((t) => (tp[t.tid] = t.players.filter((p) => paid.has(p))));
  const groups = bd.flights ? bd.flights.map((f) => ({ name: f.name, rows: bd.rows.filter((r) => r.flight === f.i), fl: true })) : [{ name: null, rows: bd.rows, fl: false }];
  const cnt = groups.map((g) => g.rows.reduce((a, r) => a + (tp[r.tid] || []).length, 0)), tot = cnt.reduce((a, x) => a + x, 0), pids = {}, lines = []; let acc = 0, given = 0;
  groups.forEach((g, gi) => { acc += cnt[gi]; const upto = tot ? Math.round(pool * acc / tot) : gi === groups.length - 1 ? pool : 0, share = upto - given; given = upto;
    const pb = payBy(d), boards = pb === 'both' ? [['net', share - Math.floor(share / 2)], ['gross', Math.floor(share / 2)]] : [[pb, share]];
    boards.forEach(([b, cents]) => { const f = (g.fl ? 'fPlace' : 'place') + (b === 'net' ? 'N' : 'G');
      const live = g.rows.filter((r) => r[f] && (tp[r.tid] || []).length).map((r) => ({ key: r.tid, place: r[f], name: r.name })); live.forEach((x) => (x.pl = live.filter((y) => y.place < x.place).length + 1));
      const sides = Math.max(1, fin ? live.length : g.rows.filter((r) => (tp[r.tid] || []).length && !r.dnf).length || g.rows.filter((r) => !r.dnf).length), pz = S.prizes(cents, c.pot.split, sides), sh = S.sharesFor(c.pot.split, sides);
      const byT = fin ? S.payouts(cents, live.map((x) => ({ id: x.key, place: x.pl })), c.pot.split) : {}, won = [];
      live.forEach((x) => { const v = byT[x.key] || 0, ps = tp[x.key], each = Math.floor(v / ps.length); let left = v - each * ps.length; ps.forEach((p) => { const a = each + (left > 0 ? 1 : 0); if (left > 0) left--; pids[p] = (pids[p] || 0) + a; }); if (v > 0) won.push({ tid: x.key, name: x.name, place: x.pl, amt: v / 100 }); }); won.sort((x, y) => x.place - y.place);
      lines.push({ flight: g.name, board: b, pool: cents / 100, players: cnt[gi], places: pz.map((v, i) => ({ place: i + 1, pct: sh[i], amt: v / 100 })), won: fin ? won : null, notWon: fin && !live.length && cents > 0 ? cents / 100 : 0 }); }); });
  return { pids, lines };
}
function payoutView(c) { const d = c.day, pc = poolC(c), paid = paidPids(c);
  const o = { entry: c.pot.entry, entrants: entrantsOf(c), paidN: paid.size, pot: pc.potC / 100, take: pc.takeC / 100, pool: pc.poolC / 100, custom: !!c.pot.split };
  if (c.kind === 'day') { const pay = dayPay(c, dayBoard(c)); o.lines = pay.lines; o.payBy = payBy(d); o.places = pay.lines[0].places; o.split = o.places.map((x) => x.pct);
    if (d.status === 'final') o.frozen = true; // the paid list is frozen at Final; a change needs the logged reopen
    if (d.status === 'final' && !d.solo && c.members.length > 1) { o.final = true; o.paid = c.members.map((m) => ({ pid: m.pid, name: m.name, amt: (pay.pids[m.pid] || 0) / 100 })).filter((x) => x.amt > 0); } }
  else { const n = Math.max(1, paid.size || c.members.length), pz = S.prizes(pc.poolC, c.pot.split, n), sh = S.sharesFor(c.pot.split, n); o.split = sh; o.places = pz.map((v, i) => ({ place: i + 1, pct: sh[i], amt: v / 100 })); }
  return o; }
const isLocked = (la, b, now) => (la != null && now >= la) || begun(b);

// ---------- golf day: computed board ----------
function dayCtx(c) { const d = c.day, n = d.course.par.length, hcp = {}; c.members.forEach((m) => (hcp[m.pid] = S.playHcp(chOf(d, m.pid), d.pct, n))); return { fmt: d.fmt, course: d.course, hcp, count: d.count }; }
function teamCtx(c, t, net) { const d = c.day, x = dayCtx(c); x.net = net; x.thcp = S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), d.course.par.length); return x; }
function holesOf(c, tid) { const h = {}, s = (c.day.scores[tid] || {}); Object.keys(s).forEach((k) => (h[k] = s[k])); return h; }
// Flights: teams sorted by the handicap in use (team handicap in team-ball formats, else the players' average), split into n flights as evenly as
// possible (low handicaps in Flight A). Never more flights than half the teams. Worked out as a preview during set-up and FIXED at Start.
function flightPlan(c) {
  const d = c.day, want = (d.flights && (d.flights.asked || d.flights.n)) || 0, ts = d.teams.filter((t) => t.players.length), n = Math.min(want, Math.floor(ts.length / 2)); if (!want) return { n: 0 }; if (n < 2) return { n: 0, asked: want, note: 'Flights need at least 4 teams (two per flight). Everyone plays in one flight.' };
  const hv = (t) => (S.FORMATS[d.fmt].ball === 'team' ? S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), d.course.par.length) : t.players.reduce((a, p) => a + (d.hcp[p] || 0), 0) / t.players.length);
  const list = ts.map((t) => ({ tid: t.tid, name: t.name, h: Math.round(hv(t) * 10) / 10 })).sort((a, b) => a.h - b.h || a.name.localeCompare(b.name)), of = {}, groups = []; let k = 0;
  for (let i = 0; i < n; i++) { const m = Math.floor(list.length / n) + (i < list.length % n ? 1 : 0), part = list.slice(k, k + m); k += m; part.forEach((x) => (of[x.tid] = i)); groups.push({ k: 'ABCD'[i], lo: part[0].h, hi: part[part.length - 1].h, teams: m }); }
  return { n, asked: want, of, groups };
}
function dayBoard(c) {
  const d = c.day, n = d.course.par.length, by = d.net === 'gross' ? 'gross' : 'net', st = d.fmt === 'stableford', fin = d.status === 'final', wd = d.wd || {}, FL = d.flights && d.flights.of && d.status !== 'setup' ? d.flights : null;
  const rows = d.teams.filter((t) => t.players.length).map((t) => { const rN = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, true)), rG = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, false));
    const sc = d.scores[t.tid] || {}, disp = Object.keys(sc).filter((h) => sc[h].st === 'disputed').map(Number), conf = Object.keys(sc).filter((h) => sc[h].st === 'confirmed').length;
    const r = { tid: t.tid, name: t.name, thru: rN.thru, gross: rG.gross, net: rN.net, toParG: rG.toParG, toParN: rN.toParN, pts: rN.pts, ptsG: rG.pts, thcp: S.FORMATS[d.fmt].ball === 'team' ? S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), n) : null, disputed: disp, confirmed: conf, of: Object.keys(sc).length };
    if (d.fmt === 'texas') { r.drives = S.texasDrives(t.players, Object.keys(sc).sort((a, b) => a - b).map((h) => sc[h].drive).filter(Boolean), d.drives, n);
      // Playbook: a team that finishes short of the drive count takes the penalty chosen at set-up (default 2 strokes) for EACH missing drive
      const short = r.thru >= n ? Object.values(r.drives.need).reduce((a, x) => a + x, 0) : 0, pen = short * (d.drivePen == null ? 2 : d.drivePen);
      if (pen) { r.pen = { strokes: pen, drives: short, each: d.drivePen == null ? 2 : d.drivePen }; r.gross += pen; r.net += pen; r.toParG += pen; r.toParN += pen; } }
    // DID NOT FINISH (review fix): a team the commissioner marked withdrawn, or (once the round is Final) a card short of all its holes. It ranks last,
    // has no place and wins no pot money. While the round is live an unfinished card still ranks by its score to par so far.
    r.wd = wd[t.tid] ? { by: wd[t.tid].by, at: wd[t.tid].at, reason: wd[t.tid].reason } : null; r.dnf = !!r.wd || (fin && r.thru < n); if (FL) r.flight = FL.of[t.tid] == null ? null : FL.of[t.tid];
    return r; });
  const keyOf = (r, b) => (st ? -(b === 'net' ? r.pts : r.ptsG) : b === 'net' ? r.toParN : r.toParG), key = (r) => keyOf(r, by), ord0 = (r) => (r.dnf ? 2 : r.thru > 0 ? 0 : 1);
  // rank a list on one board: ties share a place; no card / did not finish = no place
  const rank = (list, b, f) => { const live = list.filter((r) => r.thru > 0 && !r.dnf).sort((x, y) => keyOf(x, b) - keyOf(y, b)); let p = 0; live.forEach((r, i) => { if (!i || keyOf(live[i - 1], b) !== keyOf(r, b)) p = i + 1; r[f] = p; }); list.forEach((r) => { if (!(r.thru > 0 && !r.dnf)) r[f] = null; }); };
  rank(rows, 'net', 'placeN'); rank(rows, 'gross', 'placeG');
  rows.sort((a, b) => ord0(a) - ord0(b) || key(a) - key(b) || a.name.localeCompare(b.name)); rows.forEach((r) => (r.place = by === 'net' ? r.placeN : r.placeG));
  const out = { rows, by, holes: n, payBy: payBy(d) };
  if (d.net === 'both') { const g = rows.map((r) => ({ tid: r.tid, v: st ? -r.ptsG : r.toParG, o: ord0(r) })).sort((a, b) => a.o - b.o || a.v - b.v); out.gross = g.map((x) => x.tid); }
  if (FL) out.flights = FL.groups.map((g, i) => { const rs = rows.filter((r) => r.flight === i); rank(rs, 'net', 'fPlaceN'); rank(rs, 'gross', 'fPlaceG'); return { i, k: g.k, name: 'Flight ' + g.k, lo: g.lo, hi: g.hi, tids: rs.map((r) => r.tid) }; });
  // skins (per team for team-ball formats, per player otherwise)
  if (d.extras.skins.on || d.fmt === 'skins') {
    const net = d.fmt === 'skins' ? d.net !== 'gross' : d.extras.skins.net, ents = [];
    if (S.FORMATS[d.fmt].ball === 'team') d.teams.filter((t) => t.players.length && !wd[t.tid]).forEach((t) => { const r = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, net)); ents.push({ id: t.tid, s: r.per.map((x) => (x ? (net ? x.net : x.gross) : null)) }); });
    else { const x = dayCtx(c); d.teams.filter((t) => !wd[t.tid]).forEach((t) => t.players.forEach((pid) => { const h = holesOf(c, t.tid); ents.push({ id: pid, s: d.course.par.map((_, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[pid]); return g >= 1 ? g - (net ? S.strokesOn(x.hcp[pid] || 0, d.course.hcp[i], n) : 0) : null; }) }); })); }
    out.skins = Object.assign(S.skins(ents, n, d.extras.skins.end), { net, end: d.extras.skins.end || 'split' });
  }
  out.matches = (d.matches || []).map((m) => matchState(c, m));
  out.extras = { ctp: d.extras.ctp.map((h) => ({ hole: h, win: (d.win.ctp || {})[h] || null })), ld: d.extras.ld.map((h) => ({ hole: h, win: (d.win.ld || {})[h] || null })) };
  return out;
}
// One heads-up match: sides are teams or players. Strokes off the low side (commissioner option) by hole index.
function sideScores(c, m, side) {
  const d = c.day, n = d.course.par.length, id = m[side];
  if (m.kind === 'player') { const t = d.teams.find((x) => x.players.includes(id)); const h = t ? holesOf(c, t.tid) : {}; return d.course.par.map((_, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[id]); if (S.FORMATS[d.fmt].ball === 'team') return e && Number(e.g) >= 1 ? Number(e.g) : null; return g >= 1 ? g : null; }); }
  const t = d.teams.find((x) => x.tid === id); if (!t) return d.course.par.map(() => null); const r = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, false)); return r.per.map((x) => (x ? x.gross : null));
}
function sideHcp(c, m, side) { const d = c.day, id = m[side], n = d.course.par.length; if (m.kind === 'player') return S.playHcp(chOf(d, id), m.pct != null ? m.pct : 100, n); /* a singles match plays at 100% unless the organizer set another percent */ const t = d.teams.find((x) => x.tid === id); if (!t) return 0; return Math.round(S.teamHcp(t.players.map((p) => chOf(d, p)), allowFor(d, t.players.length), n)); }
// Team vs team NET match in a player-ball format (four-ball net, review fix): each player's playing handicap, strokes off the LOW player of the
// whole match (commissioner option offLow), net score per player by hole index, then the team's best N net per hole (N = the format's count; all players for stroke/Stableford).
function fourBall(c, m) {
  const d = c.day, n = d.course.par.length, tA = d.teams.find((x) => x.tid === m.a), tB = d.teams.find((x) => x.tid === m.b); if (!tA || !tB) return [d.course.par.map(() => null), d.course.par.map(() => null)];
  const ph = {}; const mp = m.pct != null ? m.pct : d.heads && d.heads.pct != null && d.fmt === 'bestball' ? d.heads.pct : d.pct; tA.players.concat(tB.players).forEach((p) => (ph[p] = S.playHcp(chOf(d, p), mp, n))); const lo = m.offLow !== false ? Math.min(...Object.values(ph)) : 0;
  const k = d.fmt === 'shamble' || d.fmt === 'bestball' ? Number(d.count) || S.FORMATS[d.fmt].count || 1 : null;
  const one = (t) => { const h = holesOf(c, t.tid); return d.course.par.map((_, i) => { const e = h[i + 1]; if (!e || !e.p) return null; const v = t.players.map((p) => { const g = Number(e.p[p]); return g >= 1 ? g - S.strokesOn(ph[p] - lo, d.course.hcp[i], n) : null; }); if (v.some((x) => x == null)) return null; v.sort((x, y) => x - y); return v.slice(0, Math.max(1, Math.min(v.length, k || v.length))).reduce((a, x) => a + x, 0); }); };
  return [one(tA), one(tB)];
}
function matchState(c, m) {
  const d = c.day, n = d.course.par.length; let a = sideScores(c, m, 'a'), b = sideScores(c, m, 'b');
  if (m.net && m.kind === 'team' && S.FORMATS[d.fmt].ball === 'player') [a, b] = fourBall(c, m);
  else if (m.net) { let ha = sideHcp(c, m, 'a'), hb = sideHcp(c, m, 'b'); if (m.offLow !== false) { const lo = Math.min(ha, hb); ha -= lo; hb -= lo; } a = a.map((v, i) => (v == null ? null : v - S.strokesOn(ha, d.course.hcp[i], n))); b = b.map((v, i) => (v == null ? null : v - S.strokesOn(hb, d.course.hcp[i], n))); }
  const o = { mid: m.mid, kind: m.kind, type: m.type, a: m.a, b: m.b, amt: m.amt, net: !!m.net, round: m.round || null };
  o.pct = m.kind === 'player' ? (m.pct != null ? m.pct : 100) : m.pct != null ? m.pct : null;
  if (m.type === 'nassau' && n === 18) { o.nassau = S.nassau(a, b, (m.presses || []).filter((p) => p.st !== 'offered'), m.auto); o.press = m.press || 'accept';
    // next = the next hole of each nine that has really NOT been played (review fix: a closed-out bet stops counting holes, the round does not)
    const nx = (s0) => { const k = S.holesPlayed(a, b, s0, 9); return k < 9 ? s0 + k + 1 : null; }; o.next = { front: nx(0), back: nx(9) };
    o.offers = (m.presses || []).filter((p) => p.st === 'offered').map((p) => ({ from: p.from, nine: p.nine, by: p.by, side: p.side, expired: o.next[p.nine] == null || p.from < o.next[p.nine] })); }
  else o.m = S.match(a, b, 0, n);
  return o;
}

// ---------- views ----------
function nameMap(c) { const m = {}; c.members.forEach((x) => (m[x.pid] = x.name)); return m; }
function pub(c) { return { id: c.id, kind: c.kind, title: c.title, pot: c.pot, orgName: (c.members.find((m) => m.mk === c.org) || {}).name || '', count: c.members.length, max: c.max, groupId: c.groupId || null, courseId: c.courseId || null, created: c.created,
  pro: c.pro ? { tour: c.pro.tour, eventId: c.pro.eventId, eventName: c.pro.eventName, game: c.pro.game, mc: c.pro.mc, tb: c.pro.tb, lockAt: c.pro.lockAt } : null,
  day: c.day ? { flights: c.day.flights || { n: 0 }, payBy: payBy(c.day), course: c.day.course, fmt: c.day.fmt, net: c.day.net, allow: c.day.allow, pct: c.day.pct, count: c.day.count, drives: c.day.drives, drivePen: c.day.drivePen, allowStd: !!c.day.allowStd, forced: c.day.forced || null, date: c.day.date, extras: c.day.extras, heads: c.day.heads, teamSize: c.day.teamSize, status: c.day.status, lockAt: c.day.lockAt || null, open: c.day.teams.filter((t) => t.players.length < t.slots).map((t) => ({ tid: t.tid, name: t.name, free: t.slots - t.players.length })) } : null }; }
async function full(c, u) {
  const o = pub(c), me0 = memberOf(c, u.mk), now = D.now(); o.role = isOrg(c, u.mk) ? 'org' : me0 ? 'member' : 'none'; o.me = me0 ? me0.pid : null; o.code = me0 ? c.code : undefined;
  o.members = c.members.map((m) => Object.assign({ pid: m.pid, name: m.name, org: m.mk === c.org, paid: !!m.paid, guest: !!m.guest }, isCo(c, m) ? { co: true } : {}, m.left ? { left: true } : {}));
  o.g16 = g16(c); o.co = isCo(c, me0); o.paidLog = (c.paidLog || []).slice(-10).reverse();
  o.notices = (c.notes || []).slice(-12).reverse().map((x) => ({ n: x.n, at: x.at, kind: x.kind, by: x.by, text: x.text, new: !!me0 && x.n > (me0.seen || 0) && x.bp !== me0.pid })); o.unseen = unseenOf(c, me0);
  if (c.kind === 'pro') { o.payout = payoutView(c);
    const b = await boardOf(c), fm = fieldMap(b), la = lockAt(c, b), locked = isLocked(la, b, now); o.pro.lockAt = la; o.pro.locked = locked;
    o.feed = b ? { ok: true, event: b.event, earnings: b.earnings } : { ok: false };
    o.golfers = b ? b.golfers.map((g) => ({ id: g.id, name: g.name, pos: g.pos, toPar: g.toPar, today: g.today, thru: g.thru, st: g.st, tee: g.tee, started: g.started, r: g.rounds })) : [];
    if (c.pro.game === 'six') {
      const tiers = c.pro.tiers || (b && b.golfers.length >= 12 ? buildTiers(b, c.pro.rank) : null); o.tiers = tiers; const basis = c.pro.basis || (b ? tierBasis(b, c.pro.rank) : 'alpha');
      o.tierLog = (c.pro.tierLog || []).slice(-20).reverse(); o.tierBasis = { k: basis, text: basis === 'wr' ? 'Tiers follow the world ranking.' : basis === 'alpha' ? 'Tiers are alphabetical by last name (no free world ranking for this field), so nobody chose the order.' : 'Tiers follow the organizer\'s own list. Every change is logged below.' };
      const ents = Object.keys(c.pro.entries).map((pid) => Object.assign({ pid, name: (c.members.find((m) => m.pid === pid) || {}).name || 'Player' }, c.pro.entries[pid]));
      const lead = b ? b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0] : null;
      const ranked = b ? S.rankSix(ents.filter((e) => e.picks && e.picks.length === 6), fm, c.pro.mc, c.pro.tb, b.event.done && lead ? lead.toPar : null) : [];
      o.entries = ranked.map((r) => { const mine = r.pid === o.me, show = mine || locked; return { pid: r.pid, name: r.name, place: r.place, total: r.total, n: r.n, alive: r.alive, today: show ? r.per.filter((x) => r.counting.includes(x.id)).reduce((a, x) => a + ((fm[x.id] && fm[x.id].today) || 0), 0) : null, picks: show ? r.picks : null, counting: show ? r.counting : null, per: show ? r.per.map((x) => ({ id: x.id, v: x.r ? x.r.v : null, mc: !!(x.r && x.r.mc), wd0: !!(x.r && x.r.wd0) })) : null, guess: show ? r.guess : null, swap: show ? r.swap || null : null }; });
      o.waiting = ents.filter((e) => !(e.picks && e.picks.length === 6)).map((e) => ({ pid: e.pid, name: e.name }));
      // every swap is shown to the whole pool with its time; the golfers' names once picks are locked (before that picks are hidden)
      o.swaps = ents.filter((e) => e.swap).map((e) => ({ pid: e.pid, name: e.name, at: e.swap.at, from: locked || e.pid === o.me ? e.swap.fromN || (fm[e.swap.from] || {}).name || '' : null, to: locked || e.pid === o.me ? e.swap.toN || (fm[e.swap.to] || {}).name || '' : null })).sort((x, y) => y.at - x.at);
      const mine = c.pro.entries[o.me]; o.mine = mine ? { picks: mine.picks, guess: mine.guess, swap: mine.swap || null, at: mine.at || null } : null;
      if (b && b.event.done && ranked.length) { const pm = payPids(c, ranked.map((x) => ({ key: x.pid, place: x.place, pids: [x.pid] }))); o.entries.forEach((e) => (e.payout = (pm[e.pid] || 0) / 100)); }
      if (!locked) o.entries.forEach((e) => { if (e.pid !== o.me) { e.total = null; e.place = null; } });
    } else {
      const oad = c.pro.oad; o.oad = { pointsLabel: 'Oddable points', log: (oad.log || []).slice(-20).reverse().map((x) => ({ at: x.at, by: x.by, what: x.what })), season: oad.season, events: Object.keys(oad.events).map((ev) => { const E = oad.events[ev], lk = E.lockAt && now >= E.lockAt; return { id: ev, name: E.name, lockAt: E.lockAt, locked: !!lk, res: E.res || null, by: E.by || null, manual: E.manual || null, golfers: lk ? [...new Set(Object.values(E.picks).map((p) => p.g))].map((id) => ({ id, name: (Object.values(E.picks).find((p) => p.g === id) || {}).n })) : [], picks: Object.keys(E.picks).filter((p) => lk || p === o.me).map((p) => ({ pid: p, golfer: E.picks[p].g, name: E.picks[p].n, pts: E.res ? (E.res[E.picks[p].g] || 0) : null })) }; }), used: (oad.used[o.me] || []) };
      const tot = {}; c.members.forEach((m) => (tot[m.pid] = 0)); Object.values(oad.events).forEach((E) => { if (!E.res) return; Object.keys(E.picks).forEach((p) => { tot[p] = (tot[p] || 0) + (E.res[E.picks[p].g] || 0); }); });
      o.table = c.members.map((m) => ({ pid: m.pid, name: m.name, total: Math.round(tot[m.pid] * 100) / 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)); o.table.forEach((r, i, a) => (r.place = i && a[i - 1].total === r.total ? a[i - 1].place : i + 1));
    }
  } else {
    const d = c.day; o.day.teams = d.teams.map((t) => ({ tid: t.tid, name: t.name, slots: t.slots, players: t.players.map((p) => ({ pid: p, name: nameMap(c)[p] || 'Player', hcp: d.hcp[p] == null ? null : d.hcp[p], hi: hinfo(d, p) })), scorer: t.scorer }));
    o.day.hcp = d.hcp; o.day.hsrc = d.hsrc || {}; o.day.hi = {}; c.members.forEach((m) => (o.day.hi[m.pid] = hinfo(d, m.pid))); o.day.hcpLabel = HCP_LABEL; o.day.hcpNote = HCP_NOTE;
    o.day.flights = d.status === 'setup' ? flightPlan(c) : d.flights || { n: 0 }; o.day.payBy = payBy(d); o.day.wd = d.wd || {}; o.day.reopens = (d.reopens || []).slice(-5).reverse(); o.day.netOn = netOn(d);
    o.day.hreq = {}; Object.keys(d.hreq || {}).forEach((p) => (o.day.hreq[p] = { v: d.hreq[p].v, at: d.hreq[p].at })); if (me0) seenPut(c, me0.pid);
    o.ent = !!c.ent; o.day.lockAt = d.lockAt || null; o.day.hlocked = hLocked(d, now); if (c.ent && isOrg(c, u.mk)) { try { o.day.hlog = (await D.eventLog(c.orgE, EID(c.id))).log.slice(-100).reverse().map((x) => ({ name: x.player, by: x.by, at: x.at, old: x.old, new: x.new, oddable: x.oddable == null ? null : x.oddable, reason: x.reason })); } catch (e) { o.day.hlog = []; } }
    o.payout = payoutView(c); o.day.unconfirmed = unconfirmed(c, me0); o.day.money = moneyOn(c); o.day.forced = d.forced || null; o.day.solo = !!d.solo; o.day.unassigned = c.members.filter((m) => !d.teams.some((t) => t.players.includes(m.pid))).map((m) => ({ pid: m.pid, name: m.name }));
    o.day.matches = d.matches; o.day.win = d.win;
    o.day.scores = d.scores; o.board = dayBoard(c); o.day.audit = d.audit.slice(-60).reverse();
    const myT = d.teams.find((t) => t.players.includes(o.me)); o.day.myTeam = myT ? myT.tid : null; o.day.iScore = d.teams.filter((t) => t.scorer === o.me).map((t) => t.tid);
  }
  return o;
}

// ---------- saved courses ----------
// Dedupe by name + tees. A user's own entry can be edited until a round uses it. Courses picked from OpenGolfAPI are stored when SELECTED (no bulk copy).
async function saveCourse(c, by, quiet) {
  // key (review fix): the API course id + tee when it came from OpenGolfAPI, else name + city + state + par + tees (same-name courses in other towns stay apart)
  const key = (c.src === 'opengolfapi' && c.extId ? 'og:' + c.extId + '|' + (c.teeKey || c.tees) : [c.name, c.city || '', c.state || '', c.par.reduce((a, x) => a + x, 0), c.tees].join('|')).toLowerCase().replace(/[^a-z0-9|:-]/g, ''), now = D.now(), x = Object.assign({}, c); delete x.id;
  return mutateRow(CRS, () => ({ courses: {} }), (d) => { d.courses = d.courses || {}; const hit = Object.entries(d.courses).find(([, y]) => y.key === key);
    if (hit) { const [id, y] = hit; if (quiet || y.by !== by) return { nochange: true, v: { id, dup: true } }; if (y.used) throw bad(409, 'This course has been used in a round. Save it under a different tees name.'); d.courses[id] = Object.assign(x, { key, by, used: 0, at: y.at || now }); return { id }; }
    if (Object.keys(d.courses).length >= 3000) { if (quiet) return { nochange: true, v: null }; throw bad(503, 'Course list is full'); } let id; do { id = rnd(8); } while (d.courses[id]); d.courses[id] = Object.assign(x, { key, by, used: 0, at: now }); return { id }; });
}
// One player's handicap for a game, normalized from the stats contract. Never throws (no answer = no number; the organizer sets one).
const NOH = { index: null, rounds: 0, confirmedIndex: null, confirmedRounds: 0, text: '', event: null, setBy: null, use: null };
const r1 = (v) => (v != null && Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
async function hcpOf(userKey, opts) { if (!userKey) return NOH; try { const h = await D.handicapFor(userKey, opts || {}), o = (h && h.oddable) || {};
  return { index: r1(o.index), rounds: h.rounds != null ? h.rounds : o.rounds || 0, confirmedIndex: r1(h.confirmedIndex), confirmedRounds: h.confirmedRounds || 0, text: clean(h.text || o.text || '', 60), event: r1(h.event), setBy: h.setBy === 'tournament' ? 'tournament' : h.setBy === 'organizer' ? 'organizer' : null, use: h.setBy === 'organizer' ? null : r1(h.use), reason: h.reason, at: h.at }; } catch (e) { return NOH; } }
const keyOfMember = (m) => (m.guest ? 'guest:' + m.gid : m.e || null);
// Course handicap used for strokes: the player's handicap (index) for this game converted with the course's rating and slope (WHS).
// A player with no handicap at all (no index, nothing set) plays off 0 strokes, not off the course's rating-minus-par.
const chOf = (d, pid) => ((d.hsrc || {})[pid] === 'none' && !d.hcp[pid] ? 0 : S.courseHcp(d.hcp[pid] || 0, d.course));
// What the phone shows next to a player. The real-results Oddable index ALWAYS shows, in the stats module's own words ("12.6 · 4 of 20 rounds
// confirmed"); a tournament number, an organizer's number or the confirmed index played off shows next to it, never instead of it (E-H addendum).
function hinfo(d, pid) {
  const o = (d.odx || {})[pid] || null, src = (d.hsrc || {})[pid] || 'none', v = d.hcp[pid] == null ? null : d.hcp[pid], f = (x) => (Math.round(x * 10) / 10).toFixed(1), by = (d.hby || {})[pid] || null, rq = (d.hreq || {})[pid] || null;
  const odd = o && o.index != null ? 'Oddable ' + (o.text || f(o.index) + ' (real results)') : o && o.rounds ? 'Oddable: no index yet' + (o.text && / · /.test(o.text) ? ' · ' + o.text.split(' · ').slice(1).join(' · ') : '') : 'Oddable: no rounds yet';
  const text = src === 'tournament' ? odd + ' · Tournament ' + f(v) + ', set by director' : src === 'typed' ? odd + ' · ' + (by && by.pid !== pid ? 'Set by ' + by.name + ': ' + f(v) : 'Entered ' + f(v) + (by && by.ok ? ', OK\'d by ' + by.ok : ''))
    : src === 'oddable' && o && o.index != null && v !== o.index ? odd + ' · Plays off ' + f(v) + ' (confirmed rounds)' : rq ? odd + ' · Asked for ' + f(rq.v) + ': waiting for an OK' : odd;
  return { used: src === 'none' ? null : v, ch: v == null ? null : Math.round(chOf(d, pid)), src, oddable: o && o.index != null ? o.index : null, rounds: (o && o.rounds) || 0, confirmedRounds: (o && o.confirmedRounds) || 0, text, ask: rq ? rq.v : null, set: src === 'tournament' ? (d.tset || {})[pid] || null : null };
}
// Set a member's handicap for this game from the stats answer (H1 / E-H): play off `use` (the tournament's value when the director set one, else the
// confirmed index in a money game / the full index in a casual one). With no usable number the organizer's (or an OK'd) typed number stays.
function applyIdx(d, pid, h) { d.odx = d.odx || {}; d.hsrc = d.hsrc || {}; d.tset = d.tset || {}; d.odx[pid] = { index: h.index, rounds: h.rounds, confirmedIndex: h.confirmedIndex, confirmedRounds: h.confirmedRounds, text: h.text || '' };
  if (h.setBy === 'tournament' && h.use != null) { d.hcp[pid] = h.use; d.hsrc[pid] = 'tournament'; d.tset[pid] = { v: h.use, at: h.at || null, reason: h.reason || '' }; if (d.hreq) delete d.hreq[pid]; return; } // shown as "Set by tournament"; the log itself is the stats module's
  delete d.tset[pid];
  if (h.use != null) { d.hcp[pid] = h.use; d.hsrc[pid] = 'oddable'; if (d.hreq) delete d.hreq[pid]; if (d.hby) delete d.hby[pid]; } else if (d.hsrc[pid] === 'typed' && d.hcp[pid] != null) { /* keeps the number that was set */ } else { d.hcp[pid] = 0; d.hsrc[pid] = 'none'; } }
// A number typed for a player with no usable index. setTyped = it is played off (set by the organizer, OK'd by someone else, or typed in a game with
// no money). askTyped = a player's own number in a MONEY game: it only asks; the organizer (or, for the organizer's own number, another player who is
// not on the organizer's team) has to OK it before it counts (review fix: nobody sets their own number where money is shown).
function setTyped(d, pid, v, by, now, okBy) { d.hsrc = d.hsrc || {}; d.hby = d.hby || {}; d.hcp[pid] = Math.round(v * 10) / 10; d.hsrc[pid] = 'typed'; d.hby[pid] = Object.assign({ pid: by.pid, name: by.name, at: now }, okBy ? { ok: okBy } : {}); if (d.hreq) delete d.hreq[pid]; }
function askTyped(d, pid, v, now) { d.hreq = d.hreq || {}; d.hreq[pid] = { v: Math.round(v * 10) / 10, at: now }; }
// A player's own typed number: asks in a money game, counts at once otherwise. Ignored when the player already has a usable index or a tournament number.
function selfTyped(c, m, v, now) { const d = c.day; if (v == null || ['oddable', 'tournament'].includes((d.hsrc || {})[m.pid])) return false; if (moneyOn(c) && !d.solo) { askTyped(d, m.pid, v, now); return true; } setTyped(d, m.pid, v, m, now); return false; }
// When a set-up change puts money on a game, numbers players typed for themselves go back to "asked" until someone OKs them.
function demoteSelfTyped(c, now) { const d = c.day; if (!moneyOn(c) || d.solo) return; Object.keys(d.hsrc || {}).forEach((p) => { const by = (d.hby || {})[p]; if (d.hsrc[p] === 'typed' && by && by.pid === p && !by.ok) { askTyped(d, p, d.hcp[p], now); d.hcp[p] = 0; d.hsrc[p] = 'none'; delete d.hby[p]; } }); }

// Who has partnered with whom (P1 Rotate / Hot pairs): finished golf days these members played together, from the lifetime index of their games.
// -> [{players: [pids of THIS game], date, place, of, result}] one per past team holding 2+ of this game's members.
async function pairHistory(c) {
  const r = await D.S.dbGet(IDX), mine = (r && r.data && r.data.mine) || {}, keyOf = (m) => (m.guest ? 'g:' + m.gid : m.mk), here = {}; c.members.forEach((m) => (here[keyOf(m)] = m.pid));
  const ids = [...new Set(c.members.flatMap((m) => (mine[keyOf(m)] || []).slice(-40)))].filter((id) => id !== c.id).slice(-150), out = [];
  for (const id of ids) { let g; try { g = await getC(id); } catch (e) { continue; } if (g.kind !== 'day' || g.day.status !== 'final' || g.day.solo) continue; const bd = dayBoard(g), tops = bd.rows.filter((x) => x.place === 1).length;
    g.day.teams.forEach((t) => { const ps = t.players.map((p) => g.members.find((m) => m.pid === p)).filter(Boolean).map((m) => here[keyOf(m)]).filter(Boolean); if (ps.length < 2) return; const row = bd.rows.find((x) => x.tid === t.tid);
      out.push({ players: ps, date: g.day.date, place: row && row.place ? row.place : undefined, of: bd.rows.length, result: row && row.place === 1 && tops === 1 && bd.rows.length > 1 ? 'W' : null }); }); }
  return out;
}

// ---------- create ----------
async function create(u, b, ip) {
  rate('create', u.mk, ip); const now = D.now(), kind = b.kind === 'day' ? 'day' : b.kind === 'pro' ? 'pro' : null; if (!kind) throw bad(400, 'Pick Pro tournament or Our golf day');
  const title = clean(b.title, 40); if (title.length < 2) throw bad(400, 'Give it a name (2+ characters)');
  let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
  // groupId is NEVER taken from the request (review fix): a game is attached to a group only through the Groups module, which checks that the caller is that group's commissioner (attachTo).
  const c = { id, kind, title, org: u.mk, orgE: u.e, created: now, pot: cleanPot(b.pot), groupId: null, members: [], co: [], notes: [], max: await limits.maxPeople(u.e, id) };
  c.members.push({ pid: newPid(c), mk: u.mk, e: u.e, name: nameFor(u, b.myName), joined: now, paid: false }); // e (account key) stays on the server: handicapFor needs it
  c.ent = !!(await limits.isEnterprise(u.e)); // E-H: an Enterprise account's games are tournaments whose director may set handicaps
  if (kind === 'pro') {
    const P = b.pro || {}, tour = F.TOURS[P.tour] ? P.tour : null; if (!tour) throw bad(400, 'Pick a tour');
    const game = P.game === 'oad' ? 'oad' : P.game === 'six' ? 'six' : null; if (!game) throw bad(400, 'Pick a game');
    c.pro = { tour, game, mc: ['w1', 'p10', 'out'].includes(P.mc) ? P.mc : 'w1', tb: P.tb === 'best' ? 'best' : 'score', rank: (Array.isArray(P.rank) ? P.rank : String(P.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200), tierLog: [], entries: {}, oad: { season: clean(P.season || String(new Date(now).getUTCFullYear()), 8), events: {}, used: {} } };
    if (game === 'six') {
      const ev = clean(P.eventId, 20); if (!ev) throw bad(400, 'Pick a tournament'); let bd = null; try { bd = await D.feed.board(tour, ev); } catch (e) {}
      if (!bd) throw bad(503, 'Could not read the tour leaderboard. Try again in a minute.');
      const la = feedLock(bd); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks for that tournament are already locked (first tee time has passed)');
      if (bd.golfers.length >= 12 && bd.golfers.length < 50) { /* tiers shrink in proportion (golf-score tiers) */ } if (bd.golfers.length && bd.golfers.length < S.MIN_FIELD) throw bad(409, 'Pick six needs at least ' + S.MIN_FIELD + ' golfers in the field; this one has ' + bd.golfers.length + '.');
      Object.assign(c.pro, { eventId: ev, eventName: bd.event.name, start: bd.event.start, lockAt: la, tiers: bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null, basis: tierBasis(bd, c.pro.rank) });
      if (c.pro.rank.length) c.pro.tierLog.push({ at: now, by: c.members[0].name, what: 'Tier order set from the organizer\'s own list at set-up', n: c.pro.rank.length, top: c.pro.rank.slice(0, 6) });
    }
  } else {
    let course; if (b.courseId) { const r = await D.S.dbGet(CRS), cc = r && r.data && r.data.courses && r.data.courses[String(b.courseId)]; if (!cc) throw bad(404, 'Course not found'); course = cleanCourse(cc); course.id = String(b.courseId); } else course = cleanCourse(b.course);
    c.day = Object.assign(cleanDay(b.solo ? Object.assign({}, b.day, { fmt: 'stroke' }) : b.day || {}, { course }), { course, teams: [], hcp: {}, matches: [], win: { ctp: {}, ld: {} }, scores: {}, audit: [], eids: [], status: 'setup' });
    if (c.ent) await D.eventSetup(u.e, EID(id), { title, sport: 'golf', lockAt: c.day.lockAt || undefined }); // E-H: the stats module holds the tournament's handicap edits
    if (b.solo) c.day.solo = true;
    applyIdx(c.day, c.members[0].pid, await hcpOf(u.e, hOpts(c))); selfTyped(c, c.members[0], num((b.day || {}).myHcp, -10, 54), now); // H1: the Oddable index when there is one; a typed number only without one (asked, not set, in a money game)
    if (b.solo) { // a ONE-PLAYER round is a valid game: stroke play, one team of one, starts at once
      Object.assign(c.day, { fmt: 'stroke', solo: true, teamSize: 1, status: 'live' }); c.day.teams.push({ tid: 'T1', name: c.members[0].name, slots: 1, players: [c.members[0].pid], scorer: c.members[0].pid });
    } else { const nT = Math.max(0, Math.min(Math.floor(c.max / Math.max(1, c.day.teamSize)) || 1, num((b.day || {}).teams, 0, 100) || 0));
      for (let i = 0; i < nT; i++) c.day.teams.push({ tid: 'T' + (i + 1), name: 'Team ' + (i + 1), slots: c.day.teamSize, players: [], scorer: null }); }
    if (!course.id) { const saved = await saveCourse(course, course.src === 'opengolfapi' ? 'ogapi' : u.mk, true); if (saved && saved.id) course.id = saved.id; }
    if (course.id) await mutateRow(CRS, () => ({ courses: {} }), (d) => { const x = d.courses && d.courses[course.id]; if (!x) return { nochange: true }; x.used = (x.used || 0) + 1; return {}; });
  }
  if (c.day && c.day.course.id) c.courseId = c.day.course.id;
  c.code = await newCodeFor(id, u.mk); c.u = now;
  await D.S.dbPut({ id: ROW(id), salt: 'x', pinhash: 'x', data: c, updated: now }, true);
  if (c.day && c.day.solo) await recPlays(c, 'golf-solo', [c.members[0].pid]); // a solo round is a play the moment it starts
  if (b.groupId) { try { return await attachTo(c, u, clean(b.groupId, 20), b.pot && b.pot.pot); } catch (e) { c.attachError = e.status ? e.message : 'Could not add it to the group'; } }
  return c;
}

// ---------- golf day: score entry ----------
function canScore(c, mk, tid) { const me0 = memberOf(c, mk); const t = c.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); return { t, ok: isOrg(c, mk) || (me0 && t.scorer === me0.pid), me0 }; }
// ATTACH TO A GROUP: only when the caller is the golf game's organizer AND that group's commissioner. Groups checks the commissioner
// (groups.attachGame) and calls back attachToGroup(gameId, groupId, contestId), which only accepts an attach this route has just asked for.
const ATT = new Map();
async function attachTo(c, u, groupId, pot) {
  if (!isOrg(c, u.mk)) throw bad(403, 'Only the organizer can attach this to a group'); if (!groupId) throw bad(400, 'Which group?'); const GR = D.groups(); if (!GR) throw bad(503, 'Groups is not in this build, so this game cannot be added to a group yet.');
  const k = c.id + '|' + groupId; ATT.set(k, D.now() + 30e3); let r; try { r = await GR.attachGame(groupId, u.e, { type: 'golf', ref: c.id, name: c.title, pot: pot === 'main' ? 'main' : 'side' }); } finally { ATT.delete(k); }
  const g = await getC(c.id); if (g.groupId !== groupId) return mutC(c.id, (d) => { d.groupId = groupId; d.contestId = (r && r.cid) || d.contestId || null; d.u = D.now(); return d; }); return g;
}
function entryOf(c, t, b) {
  const d = c.day, F0 = S.FORMATS[d.fmt], hole = Number(b.hole); if (!(Number.isInteger(hole) && hole >= 1 && hole <= d.course.par.length)) throw bad(400, 'Pick a hole');
  const e = {}; if (F0.ball === 'team') { e.g = num(b.g, 1, 15); if (e.g == null || !Number.isInteger(e.g)) throw bad(400, 'Strokes 1 to 15'); e.who = t.players.slice(); } // team score + who played (for stats)
  else { e.p = {}; t.players.forEach((p) => { const v = num(b.p && b.p[p], 1, 15); if (v == null || !Number.isInteger(v)) throw bad(400, 'Strokes 1 to 15 for every player on the team'); e.p[p] = v; }); }
  if (d.fmt === 'texas') { if (!t.players.includes(b.drive)) throw bad(400, 'Whose drive was used?'); e.drive = b.drive; }
  if (d.fmt === 'florida' && b.shots) { const sh = (Array.isArray(b.shots) ? b.shots : []).map(String); if (sh.some((p) => !t.players.includes(p))) throw bad(400, 'Unknown player in the shot list'); const er = S.floridaCheck(sh, e.g); if (er) throw bad(400, er); e.shots = sh; }
  if (b.putts != null) { const pu = num(b.putts, 0, 10); if (pu != null) e.putts = pu; }
  return { hole, e };
}
const same = (x, y) => JSON.stringify([x.g, x.p, x.drive, x.shots, x.putts]) === JSON.stringify([y.g, y.p, y.drive, y.shots, y.putts]);
const audit = (d, o) => { d.audit.push(o); if (d.audit.length > 3000) d.audit.splice(0, d.audit.length - 3000); };

// ---------- one and done ----------
async function oadSettle(c) { // stores results of finished events once (prize money if the feed has it for every finisher, else finish points)
  const todo = Object.keys(c.pro.oad.events).filter((ev) => !c.pro.oad.events[ev].res); if (!todo.length) return c;
  const done = {}; for (const ev of todo.slice(0, 3)) { let b = null; try { b = await D.feed.board(c.pro.tour, ev); } catch (e) {} if (!b || !b.event.done) continue;
    const res = {}; const posN = {}; b.golfers.forEach((g) => { const p = parseInt(String(g.pos).replace(/^T/, ''), 10); if (p) posN[p] = (posN[p] || 0) + 1; });
    b.golfers.forEach((g) => { if (b.earnings) res[g.id] = g.st === 'active' ? g.earn || 0 : 0; else { const p = parseInt(String(g.pos).replace(/^T/, ''), 10); res[g.id] = g.st === 'active' && p ? S.finishPoints(p, posN[p]) : 0; } });
    done[ev] = { res, by: b.earnings ? 'money' : 'points' }; }
  if (!Object.keys(done).length) return c;
  return mutC(c.id, (d) => { Object.keys(done).forEach((ev) => { if (d.pro.oad.events[ev] && !d.pro.oad.events[ev].res) Object.assign(d.pro.oad.events[ev], done[ev]); }); return d; });
}

// ---------- routes ----------
async function handle(req, res) {
  const path = req.url.split('?')[0]; if (!path.startsWith('/golf/')) return false;
  if (req.method !== 'POST') { send(res, 405, { error: 'POST only' }); return true; }
  try {
    const b = await body(req), ip = D.ip(req), now = D.now(), op = path.slice(6);
    if (op === 'preview') { // PUBLIC: title + kind only, for the ?join=golf.<code> link before sign-in
      if (fails('i|' + ip) >= 10) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); if (limit('pv|' + ip, 60, 600e3)) throw bad(429, 'Too many tries. Wait a few minutes.');
      const c = await byCode(b.code, 'i|' + ip); send(res, 200, { title: c.title, kind: c.kind }); return true;
    }
    if (op === 'ent') { // OWNER ONLY (owner-PIN token, or owner phone + x-dash): enterprise flag and course links for an account. No player sees this.
      if (!D.ownerOk(req)) throw bad(401, 'Owner only'); const acc = String(b.account || '').trim().slice(0, 120); if (!acc) throw bad(400, 'Which account?'); const a = String(b.op || 'get');
      if (a === 'link' || a === 'unlink') { const r = await D.S.dbGet(CRS); if (a === 'link' && !(r && r.data && r.data.courses && r.data.courses[String(b.courseId)])) throw bad(404, 'Course not found'); }
      if (a !== 'get') await mutateRow(ENT, () => ({ keys: {}, courses: {} }), (d) => { d.keys = d.keys || {}; d.courses = d.courses || {}; const cid = String(b.courseId || '');
        if (a === 'enterprise') { if (b.on) d.keys[acc] = true; else delete d.keys[acc]; }
        else if (a === 'link') { const l = d.courses[acc] || []; if (!l.includes(cid)) d.courses[acc] = l.concat(cid).slice(-50); }
        else if (a === 'unlink') { d.courses[acc] = (d.courses[acc] || []).filter((x) => x !== cid); if (!d.courses[acc].length) delete d.courses[acc]; }
        else throw bad(400, 'Unknown change'); return {}; });
      ENTC.at = 0; const e = await entRow(); send(res, 200, { enterprise: !!(e.keys || {})[acc], courses: await coursesOwnedBy(acc) }); return true;
    }
    const u = await me(req);
    if (op === 'events') { rate('read', u.mk, ip); const t = F.TOURS[b.tour] ? b.tour : 'pga'; let ev = []; try { ev = await D.feed.events(t); } catch (e) { throw bad(503, 'Could not read the ' + F.TOURS[t] + ' schedule. Try again in a minute.'); } send(res, 200, { tour: t, tours: F.TOURS, events: ev.filter((e) => !e.end || e.end > now - 3 * DAY).slice(0, 40) }); return true; }
    if (op === 'board') { rate('read', u.mk, ip); const t = F.TOURS[b.tour] ? b.tour : 'pga'; let bd; try { bd = await D.feed.board(t, b.event ? clean(b.event, 20) : ''); } catch (e) { throw bad(503, 'Could not read the leaderboard. Try again in a minute.'); } send(res, 200, bd); return true; }
    if (op === 'courses') { // saved courses (typed in by users or picked from OpenGolfAPI) + a live OpenGolfAPI search; the API being down only drops the second list
      rate('read', u.mk, ip); const r = await D.S.dbGet(CRS), all = Object.entries((r && r.data && r.data.courses) || {}), q = clean(b.q, 40).toLowerCase();
      const saved = all.filter(([, c]) => !q || (c.name + ' ' + (c.city || '')).toLowerCase().includes(q)).slice(0, 50).map(([id, c]) => ({ id, name: c.name, tees: c.tees, holes: c.holes, par: c.par, hcp: c.hcp, yards: c.yards || null, rating: c.rating ?? null, slope: c.slope ?? null, city: c.city || '', src: c.src || 'user', mine: c.by === u.mk, used: c.used || 0 }));
      // COURSE SEARCH (ported from the preview fix, Nov 16 2026): one page of the live list (25; `offset` = "Show more" in the same list), courses near a
      // typed city, and when the course service cannot be reached: a clear message plus the bundled sample courses (never a silent drop to "type it in").
      let api = { ok: false, results: [] }; if (q.length >= 2 || b.state || b.near) api = typeof D.courses.searchSafe === 'function' ? await D.courses.searchSafe(clean(b.q, 60), clean(b.state, 4), clean(b.near, 40), b.offset)
        : await (async () => { try { return { ok: true, results: await D.courses.search(q, clean(b.state, 4), clean(b.near, 40)), attribution: CO.ATTR }; } catch (e) { return { ok: false, down: true, results: [], error: "Couldn't reach the course list. Try again." }; } })();
      let owned = []; try { owned = await coursesOwnedBy(u.e); } catch (e) {} // a golf course / club account sees its own course(s) first
      send(res, 200, { courses: saved, owned, api }); return true; }
    if (op === 'coursedetail') { rate('read', u.mk, ip); let c; try { c = await D.courses.detail(String(b.extId || '')); } catch (e) { throw bad(503, "Couldn't reach the course list. Try again."); } send(res, 200, { course: c }); return true; }
    if (op === 'course') { rate('write', u.mk, ip); const c = cleanCourse(b.course); const out = await saveCourse(c, u.mk, false); send(res, 200, out || {}); return true; }
    if (op === 'mine') { rate('read', u.mk, ip); const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[u.mk] || [], out = []; for (const id of ids.slice(-30).reverse()) { try { const c = await getC(id), m = memberOf(c, u.mk); if (m) out.push(Object.assign(pub(c), { role: isOrg(c, u.mk) ? 'org' : 'member', unseen: unseenOf(c, m) })); } catch (e) {} } send(res, 200, { games: out }); return true; }
    if (op === 'create') { const c = await create(u, b, ip); send(res, 200, Object.assign({ game: await full(c, u) }, c.attachError ? { attachError: c.attachError } : {})); return true; }
    if (op === 'look' || op === 'join') { // signed-in look-up by code (rules, entry/take, main/side, open team slots) and join
      if (fails('a|' + u.mk) >= 10 || fails('i|' + ip) >= 10) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('code', u.mk, ip);
      let c; try { c = await byCode(b.code, 'a|' + u.mk); } catch (e) { fail('i|' + ip); throw e; }
      if (op === 'look') { send(res, 200, { game: memberOf(c, u.mk) ? await full(c, u) : Object.assign(pub(c), { role: 'none', back: !!anyMember(c, u.mk) }) }); return true; }
      const max = await limits.maxPeople(c.orgE, c.id); const tid = b.tid ? String(b.tid) : null; const hj = c.kind === 'day' && !anyMember(c, u.mk) ? await hcpOf(u.e, hOpts(c)) : null; let asked = false;
      const g = await mutC(c.id, (d) => { let m = anyMember(d, u.mk);
        // G16 (review fix): an entry with a pick belongs to the account. Coming back after leaving gives the SAME entry back, picks still locked.
        if (m && m.left) { delete m.left; m.back = now; }
        else if (!m) { if (d.members.length >= Math.max(max, 0)) throw bad(409, 'This game is full (up to ' + max + ' golfers). ' + PRICE); if (d.kind === 'day' && d.day.status === 'final') throw bad(409, 'This golf day is over'); m = { pid: newPid(d), mk: u.mk, e: u.e, name: nameFor(u, b.myName), joined: now, paid: false }; d.members.push(m);
          if (d.kind === 'day') { applyIdx(d.day, m.pid, hj || NOH); asked = selfTyped(d, m, num(b.hcp, -10, 54), now); } }
        else if (!tid) return { nochange: true, v: d };
        if (tid && d.kind === 'day') { const t = d.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); if (!t.players.includes(m.pid)) { if (t.players.length >= t.slots) throw bad(409, 'That team is full'); if (d.day.status !== 'setup') throw bad(409, 'Teams are set: the round has started'); d.day.teams.forEach((x) => (x.players = x.players.filter((p) => p !== m.pid))); t.players.push(m.pid); if (!t.scorer) t.scorer = m.pid; } }
        d.u = now; return d; });
      await addMine(u.mk, c.id); send(res, 200, Object.assign({ game: await full(g, u) }, asked ? { hcpAsked: true } : {})); return true;
    }
    // ----- everything below needs an id and membership -----
    let c = await getC(b.id); const mem = memberOf(c, u.mk), org = isOrg(c, u.mk);
    if (!mem) throw bad(404, 'Golf game not found');
    if (op === 'get') { rate('read', u.mk, ip); if (c.kind === 'pro' && c.pro.game === 'oad') c = await oadSettle(c); send(res, 200, { game: await full(c, u), now }); return true; }
    if (op === 'seen') { const g = await mutC(c.id, (d) => { const m = memberOf(d, u.mk), last = ((d.notes || []).slice(-1)[0] || {}).n || 0; if (!m) throw bad(404, 'Golf game not found'); if ((m.seen || 0) >= last) return { nochange: true, v: d }; m.seen = last; return d; }); send(res, 200, { game: await full(g, u) }); return true; }
    if (op === 'leave') { await mutC(c.id, (d) => { if (isOrg(d, u.mk)) throw bad(409, 'The organizer cannot leave'); if (d.kind === 'day' && d.day.status !== 'setup') throw bad(409, 'The round has started'); const m = memberOf(d, u.mk); if (!m) throw bad(404, 'Golf game not found'); const p = m.pid;
        if (d.kind === 'pro') { const O = d.pro.oad, has = !!(d.pro.entries[p] && d.pro.entries[p].picks && d.pro.entries[p].picks.length) || Object.values(O.events).some((E) => E.picks[p]) || (O.used[p] || []).length > 0;
          // G16 (review fix): once a pick exists in group play the entry is tied to the account. Leaving takes the game off the player's list; the picks
          // stay in the pool, locked, the golfers used stay used, and rejoining restores the same entry.
          if (has) { m.left = now; d.u = now; return {}; }
          if (d.pro.game === 'six' && d.pro.lockAt && now >= d.pro.lockAt) throw bad(409, 'Picks are locked'); }
        d.members = d.members.filter((x) => x.mk !== u.mk); d.co = (d.co || []).filter((x) => x !== p); if (d.day) { d.day.teams.forEach((t) => { t.players = t.players.filter((x) => x !== p); if (t.scorer === p) t.scorer = t.players[0] || null; }); ['hcp', 'hsrc', 'hby', 'hreq', 'odx', 'tset'].forEach((k) => { if (d.day[k]) delete d.day[k][p]; }); } if (d.pro) delete d.pro.entries[p]; d.u = now; return {}; }); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { // organizer marks entries paid. FROZEN AT FINAL (review fix): a golf day's list changes only through the logged reopen; a finished pool's only with a logged reason every player is told about.
      if (!org) throw bad(403, 'Only the organizer marks entries paid'); const why = clean(b.reason, 120); let done = false;
      if (c.kind === 'pro') { if (c.pro.game === 'six') { const bd = await boardOf(c); done = !!c.pro.doneAt || (bd ? !!bd.event.done : !!(c.pro.lockAt && now >= c.pro.lockAt + 5 * DAY)); } else done = !!c.pro.oad.ended || chiDay(now) > String(c.pro.oad.season).slice(0, 4) + '-12-31'; }
      const g = await mutC(c.id, (d) => { const m = d.members.find((x) => x.pid === String(b.pid)); if (!m) throw bad(404, 'Not a member'); if (!!m.paid === !!b.paid) return { nochange: true, v: d };
        if (d.kind === 'day' && d.day.status === 'final') throw bad(409, 'The paid list is frozen: the round is final. Reopen scoring (with a reason) to change it.', { frozen: true });
        if (d.kind === 'pro' && done) { if (why.length < 3) throw bad(409, 'The paid list is frozen: this pool is final. To change it give a reason; everyone in the pool is told.', { frozen: true, needReason: true });
          d.pro.doneAt = d.pro.doneAt || now; d.paidLog = (d.paidLog || []).concat({ at: now, by: mem.name, name: m.name, paid: !!b.paid, reason: why }).slice(-50); notify(d, 'paid', mem, mem.name + ' marked ' + m.name + (b.paid ? ' paid' : ' not paid') + ' after the pool was final. Reason: ' + why); }
        m.paid = !!b.paid; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; }
    if (op === 'attach') { rate('write', u.mk, ip); const g = await attachTo(c, u, clean(b.groupId, 20), b.pot); send(res, 200, { game: await full(g, u) }); return true; }
    if (c.kind === 'pro') {
      rate('write', u.mk, ip);
      if (op === 'tiers') { // organizer: rebuild the six tiers from a ranking list (before picks lock)
        if (!org) throw bad(403, 'Only the organizer sets the tiers'); const bd = await boardOf(c); if (!bd || bd.golfers.length < 12) throw bad(503, 'The field is not posted yet');
        if (isLocked(lockAt(c, bd), bd, now)) throw bad(409, 'Picks are locked'); if (Object.values(c.pro.entries).some((e) => e.picks && e.picks.length)) throw bad(409, 'Someone already picked. Tiers are fixed now.');
        const rank = (Array.isArray(b.rank) ? b.rank : String(b.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200);
        const g = await mutC(c.id, (d) => { const was = (d.pro.tiers || []).map((x) => x.slice()); d.pro.rank = rank; d.pro.tiers = buildTiers(bd, rank); d.pro.basis = tierBasis(bd, rank); const moved = d.pro.tiers ? d.pro.tiers.reduce((a, tier, i) => a + tier.filter((id) => !(was[i] || []).includes(id)).length, 0) : 0;
          d.pro.tierLog = (d.pro.tierLog || []).concat({ at: now, by: mem.name, what: rank.length ? 'Tier order changed to the organizer\'s own list' : 'Tier order put back to the neutral default', n: rank.length, top: rank.slice(0, 6), moved }).slice(-50); d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'pick' && c.pro.game === 'six') {
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard to check the lock. Try again in a minute.'); // fail closed
        const la = lockAt(c, bd); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks locked at the first tee time');
        const tiers = c.pro.tiers || (bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null); if (!tiers) throw bad(409, 'The field is not posted yet');
        const picks = (Array.isArray(b.picks) ? b.picks : []).map(String); if (picks.length !== 6) throw bad(400, 'Pick one golfer from each of the six tiers');
        picks.forEach((id, i) => { if (!tiers[i].includes(id)) throw bad(400, 'Tier ' + (i + 1) + ': that golfer is not in this tier'); });
        const guess = c.pro.tb === 'score' ? num(b.guess, -40, 40) : null; if (c.pro.tb === 'score' && (guess == null || !Number.isInteger(guess))) throw bad(400, 'Tiebreaker: guess the winning score to par (e.g. -15)');
        const g = await mutC(c.id, (d) => { const had = d.pro.entries[mem.pid]; if (had && had.picks && had.picks.length === 6 && g16(d)) throw bad(409, G16MSG);
          if (!d.pro.tiers) d.pro.tiers = tiers; d.pro.lockAt = minT(d.pro.lockAt, la); d.pro.entries[mem.pid] = { picks, guess, swap: null, at: now, locked: g16(d) }; d.u = now; return d; }); await recPlays(g, 'golf-six', [mem.pid]); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'swap' && c.pro.game === 'six') { // ONE replacement for a golfer who withdrew before teeing off
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard. Try again in a minute.'); const fm = fieldMap(bd), e = c.pro.entries[mem.pid];
        if (!e || !e.picks) throw bad(404, 'No picks to swap'); if (e.swap) throw bad(409, 'You already used your one swap');
        const i = e.picks.indexOf(String(b.from)), f = fm[String(b.from)], t = fm[String(b.to)]; if (i < 0 || !f) throw bad(400, 'Pick the golfer to replace');
        if (!(f.st === 'wd' && !f.started)) throw bad(409, 'Swaps are only for a golfer who withdrew before teeing off');
        if (!t || !c.pro.tiers[i].includes(t.id) || t.st !== 'active' || t.started || e.picks.includes(t.id)) throw bad(400, 'The new golfer must be from the same tier and not have teed off yet');
        // WHEN (review fix): only before the replacement's own tee time. A feed with no tee times (the ESPN scoreboard) cannot show who has teed off, so
        // there the swap is only allowed before round 1 starts. Anything else is refused: no picking a replacement once scores are coming in.
        const hasTee = Number.isFinite(t.tee) && t.tee > 0, la = lockAt(c, bd);
        if (hasTee) { if (now >= t.tee) throw bad(409, t.name + ' has already teed off. A swap is only allowed before the new golfer\'s tee time.'); }
        else if (begun(bd) || !la || now >= la) throw bad(409, 'Round 1 has started and the tour feed has no tee times, so a swap can no longer be checked. Swaps are only allowed before round 1 starts.');
        const g = await mutC(c.id, (d) => { const x = d.pro.entries[mem.pid]; if (!x || !x.picks) throw bad(404, 'No picks to swap'); if (x.swap) throw bad(409, 'You already used your one swap'); if (x.picks[i] !== f.id || x.picks.includes(t.id)) throw bad(409, 'Your picks changed. Check them and try again.');
          x.picks[i] = t.id; x.swap = { from: f.id, to: t.id, fromN: f.name, toN: t.name, at: now }; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; // shown to the whole pool with the time (view: swaps)
      }
      if (op === 'oadmoney' && c.pro.game === 'oad') { // Playbook: the organizer can enter the real prize money for a finished tournament instead of Oddable points
        if (!org) throw bad(403, 'Only the organizer enters prize money'); const ev = clean(b.event, 20), E0 = c.pro.oad.events[ev]; if (!E0) throw bad(404, 'No picks for that tournament'); if (!(E0.lockAt && now >= E0.lockAt)) throw bad(409, 'That tournament has not started');
        const ids = [...new Set(Object.values(E0.picks).map((p) => p.g))], money = {}; for (const id of ids) { const v = num((b.money || {})[id], 0, 1e8); if (v == null) throw bad(400, 'Prize money for every golfer picked (0 if they missed the cut)'); money[id] = Math.round(v * 100) / 100; }
        const g = await mutC(c.id, (d) => { const E = d.pro.oad.events[ev]; E.prev = E.res && E.by !== 'money-manual' ? { res: E.res, by: E.by } : E.prev || null; E.res = money; E.by = 'money-manual'; E.manual = { by: mem.name, at: now }; d.pro.oad.log = (d.pro.oad.log || []).concat({ at: now, by: mem.name, what: 'Prize money entered for ' + E.name, money }).slice(-100); d.u = now; return d; });
        send(res, 200, { game: await full(g, u) }); return true; }
      if (op === 'endseason' && c.pro.game === 'oad') { if (!org) throw bad(403, 'Only the organizer ends the season'); const g = await mutC(c.id, (d) => { d.pro.oad.ended = d.pro.oad.ended || now; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; }
      if (op === 'pick' && c.pro.game === 'oad') {
        const ev = clean(b.event, 20); let bd = null; try { bd = await D.feed.board(c.pro.tour, ev); } catch (e) {} if (!bd) throw bad(503, 'Could not read that tournament. Try again in a minute.');
        const E0 = c.pro.oad.events[ev], la = minT(E0 && E0.lockAt, feedLock(bd)); if (!la || isLocked(la, bd, now)) throw bad(409, 'Picks for this tournament locked at its first tee time');
        const gf = bd.golfers.find((x) => x.id === String(b.golfer)); if (!gf || gf.st !== 'active') throw bad(400, 'Pick a golfer in the field');
        const g = await mutC(c.id, (d) => { const O = d.pro.oad, E = O.events[ev] = O.events[ev] || { name: bd.event.name, lockAt: la, picks: {} }; E.lockAt = minT(E.lockAt, la);
          if (E.picks[mem.pid] && g16(d)) throw bad(409, G16MSG);
          const used = (O.used[mem.pid] || []).filter((x) => !(E.picks[mem.pid] && E.picks[mem.pid].g === x)); if (used.includes(gf.id)) throw bad(409, 'You already used ' + gf.name + ' this season. One and done: never the same golfer twice.');
          E.picks[mem.pid] = { g: gf.id, n: gf.name, at: now }; O.used[mem.pid] = used.concat(gf.id); d.u = now; return d; });
        await recPlays(g, 'golf-oad', [mem.pid], c.id + ':' + ev); send(res, 200, { game: await full(g, u) }); return true;
      }
      throw bad(404, 'not found');
    }
    // ----- golf day -----
    const d0 = c.day;
    if (op === 'setup') { // organizer, before the round starts: format, net, allowances, extras, heads-up options, flights
      if (!org) throw bad(403, 'Only the organizer changes the setup'); if (d0.status !== 'setup') throw bad(409, 'The round has started; setup is locked');
      const x = cleanDay(Object.assign({}, pub(c).day, b.day || {}), d0), was = casualOf(c), course = b.course ? cleanCourse(b.course) : null;
      let g = await mutC(c.id, (d) => { if (d.day.status !== 'setup') throw bad(409, 'The round has started; setup is locked'); // checked INSIDE the write
        Object.assign(d.day, x); if (course) d.day.course = course; d.day.teams.forEach((t) => (t.slots = Math.max(t.players.length, Math.min(4, num(t.slots, 1, 4) || d.day.teamSize)))); demoteSelfTyped(d, now); d.u = now; return d; });
      if (c.ent && g.day.lockAt && g.day.lockAt !== d0.lockAt) { try { await D.eventSetup(c.orgE, EID(c.id), { title: c.title, sport: 'golf', lockAt: g.day.lockAt }); } catch (e) {} }
      if (casualOf(g) !== was) { // money or flights were switched on or off: the number to play off changes (confirmed index <-> full index), so ask stats again
        const fresh = {}; for (const m of g.members) if (keyOfMember(m)) fresh[m.pid] = await hcpOf(keyOfMember(m), hOpts(g)); g = await mutC(c.id, (d) => { if (d.day.status !== 'setup') return { nochange: true, v: d }; Object.keys(fresh).forEach((p) => { if (d.members.some((m) => m.pid === p)) applyIdx(d.day, p, fresh[p]); }); d.u = now; return d; }); }
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'suggest') { // P1 "Suggest partners": ranked suggestions with a one-line reason. It ONLY suggests: nothing is saved, the organizer chooses.
      rate('read', u.mk, ip); if (!org) throw bad(403, 'Only the organizer builds the teams'); const size = Math.max(2, Math.min(4, num(b.teamSize, 2, 4) || Math.max(2, d0.teamSize)));
      if (S.FORMATS[d0.fmt].size[1] < 2 && !b.teamSize) throw bad(409, 'This format has no partners');
      const mode = ['balanced', 'rotate', 'hot'].includes(b.mode) ? b.mode : 'balanced', n = d0.course.par.length;
      const players = c.members.map((m) => ({ id: m.pid, name: m.name, hcp: S.playHcp(chOf(d0, m.pid), 100, n) }));
      const history = mode === 'balanced' ? [] : await pairHistory(c);
      const list = D.pairing().suggestPartners(players, { mode, teamSize: size, history });
      send(res, 200, { mode, teamSize: size, modes: [['balanced', 'Balanced'], ['rotate', 'Rotate'], ['hot', 'Hot pairs']], suggestions: list.map((x) => ({ reason: x.reason, hcps: x.hcps, teams: x.teams.map((t) => t.map((pid) => ({ pid, name: (c.members.find((m) => m.pid === pid) || {}).name || 'Player', hi: hinfo(d0, pid) }))) })), note: 'Suggestions only. You choose the teams. Handicaps: ' + HCP_LABEL + '. ' + HCP_NOTE, history: history.length }); return true;
    }
    if (op === 'team') { // organizer: add / rename / remove a team, set slots, assign a player, set the scorer, set a handicap
      rate('write', u.mk, ip); const a = String(b.op || ''); let guest = null; const maxP = a === 'guest' ? await limits.maxPeople(c.orgE, c.id) : 0;
      let dirH = null, dirWhy = ''; if (a === 'hcp' && c.ent && org) { // E-H: the director's add / change goes through the stats module (storage, lock and log live there), then the game takes `use`
        const pm = c.members.find((m) => m.pid === String(b.pid)); if (!pm) throw bad(404, 'Not a member'); const h = num(b.hcp, -10, 54); if (h == null) throw bad(400, 'Handicap -10 to 54');
        if (hLocked(d0, now)) throw bad(409, 'Handicaps are locked: the tournament has started'); dirWhy = clean(b.reason, 80); if (dirWhy.length < 3) throw bad(400, 'Give a reason for the tournament handicap (3+ characters)');
        await D.eventOverride(u.e, EID(c.id), keyOfMember(pm), { hcp: h, reason: dirWhy, name: pm.name, byName: mem.name }); dirH = await hcpOf(keyOfMember(pm), hOpts(c)); } // stored and LOGGED by the stats module only (one log)
      let pending = false;
      if (a === 'guest') guest = { gid: rnd(10).toLowerCase(), token: crypto.randomBytes(16).toString('hex') }; // lower case: the stats / Calcutta guest key form 'g:<guest id>' // claim token shown once to the organizer; only its hash is stored
      const g = await mutC(c.id, (d) => { const D2 = d.day; const T = (id) => { const t = D2.teams.find((x) => x.tid === String(id)); if (!t) throw bad(404, 'No such team'); return t; };
        if (a === 'hcp') { // H1 + E-H: the Oddable Handicap Index is the handicap. A typed number only for a player with no index yet; in an Enterprise
          // tournament the director (organizer) may set or override ANY player's handicap for this tournament only, with a reason, logged, until lockAt.
          const p = String(b.pid); if (!d.members.some((m) => m.pid === p)) throw bad(404, 'Not a member'); const h = num(b.hcp, -10, 54); if (h == null) throw bad(400, 'Handicap -10 to 54');
          if (hLocked(D2, now)) throw bad(409, 'Handicaps are locked: the ' + (d.ent ? 'tournament' : 'round') + ' has started');
          D2.hsrc = D2.hsrc || {}; const v = Math.round(h * 10) / 10, old = D2.hcp[p] == null ? null : D2.hcp[p];
          if (d.ent && isOrg(d, u.mk)) { if (!dirH) throw bad(409, 'Try again'); applyIdx(D2, p, dirH); D2.tset[p] = Object.assign({}, D2.tset[p], { v, by: mem.name, at: now, reason: dirWhy }); d.u = now; return d; }
          const self = p === mem.pid; if (!isOrg(d, u.mk) && !self) throw bad(403, 'Only the organizer sets other players\' handicaps');
          if (D2.hsrc[p] === 'oddable' || D2.hsrc[p] === 'tournament') throw bad(409, D2.hsrc[p] === 'oddable' ? 'This player has an ' + HCP_LABEL + ' from their rounds in the app; it is the handicap. ' + HCP_NOTE : 'The tournament director set this handicap.');
          // review fix: nobody sets their OWN number where money is shown. It is only asked for: the organizer (or, for the organizer's own number,
          // another player who is not on the organizer's team) has to OK it. In an Enterprise tournament the director sets it, with a reason.
          if (self && moneyOn(d) && !D2.solo) { askTyped(D2, p, v, now); pending = true; d.u = now; return d; }
          if (d.ent && !isOrg(d, u.mk) && !self) throw bad(403, 'The tournament director sets handicaps');
          setTyped(D2, p, v, mem, now); audit(D2, { at: now, by: mem.name, what: 'handicap', pid: p, from: old, to: v }); d.u = now; return d; }
        if (a === 'hcpok') { // OK (or turn down) a number a player asked for in a money game
          const p = String(b.pid), rq = (D2.hreq || {})[p], pm = d.members.find((m) => m.pid === p); if (!pm || !rq) throw bad(404, 'No handicap is waiting for an OK'); if (hLocked(D2, now)) throw bad(409, 'Handicaps are locked: the ' + (d.ent ? 'tournament' : 'round') + ' has started');
          if (p === mem.pid) throw bad(403, 'Someone else has to OK your handicap.'); if (d.ent) throw bad(409, 'In a tournament the director sets the handicap, with a reason.');
          if (pm.mk === d.org) { const oT = D2.teams.find((t) => t.players.includes(p)); if (teamSide(oT, mem.pid)) throw bad(403, 'A player who is not on the organizer\'s team has to OK the organizer\'s handicap.'); }
          else if (!isOrg(d, u.mk) && !isCo(d, mem)) throw bad(403, 'Only the organizer OKs handicaps');
          if (b.on === false) { delete D2.hreq[p]; audit(D2, { at: now, by: mem.name, what: 'handicap turned down', pid: p, from: rq.v }); }
          else { setTyped(D2, p, rq.v, pm, rq.at, mem.name); audit(D2, { at: now, by: mem.name, what: 'handicap OK', pid: p, to: rq.v }); }
          d.u = now; return d; }
        if (a === 'co') { // the organizer names (or removes) a co-organizer: someone who can settle disputes and confirm cards on teams they are not part of
          if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer names a co-organizer'); if (D2.status === 'final') throw bad(409, 'The round is final'); const p = String(b.pid), pm = d.members.find((m) => m.pid === p); if (!pm || pm.guest || pm.mk === d.org) throw bad(400, 'Pick a player with an Oddable account');
          d.co = (d.co || []).filter((x) => x !== p); if (b.on !== false) d.co.push(p); audit(D2, { at: now, by: mem.name, what: b.on !== false ? 'co-organizer named' : 'co-organizer removed', pid: p, note: pm.name }); d.u = now; return d; }
        if (a === 'withdraw') { // DID NOT FINISH: the commissioner marks a team withdrawn (or puts it back) while the round is live. Logged, and every player is told.
          if (!isOrg(d, u.mk) && !isCo(d, mem)) throw bad(403, 'Only the organizer marks a team withdrawn'); if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. Reopen scoring first.' : 'The round has not started'); const t = T(b.tid); D2.wd = D2.wd || {};
          if (b.on === false) { if (!D2.wd[t.tid]) return { nochange: true, v: d }; delete D2.wd[t.tid]; audit(D2, { at: now, by: mem.name, tid: t.tid, what: 'withdrawal undone' }); notify(d, 'wd', mem, t.name + ' is back in: ' + mem.name + ' undid the withdrawal.'); }
          else { const why = clean(b.reason, 120); if (why.length < 3) throw bad(400, 'Give a reason for marking the team withdrawn (3+ characters)'); if (D2.wd[t.tid]) return { nochange: true, v: d }; D2.wd[t.tid] = { by: mem.name, at: now, reason: why };
            audit(D2, { at: now, by: mem.name, tid: t.tid, what: 'withdrawn', note: why }); notify(d, 'wd', mem, t.name + ' was marked did not finish by ' + mem.name + ': ' + why + '. No place and no prize money.'); }
          d.u = now; return d; }
        if (a === 'scorer') { const t = T(b.tid); if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer picks scorers'); if (D2.status === 'final') throw bad(409, 'The round is final'); if (!t.players.includes(String(b.pid))) throw bad(400, 'The scorer must be on the team'); t.scorer = String(b.pid); d.u = now; return d; }
        if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer changes teams'); if (D2.status !== 'setup') throw bad(409, 'Teams are set: the round has started');
        if (a === 'guest') { // a player typed in by name, without an Oddable account (claimable later through the stats module's claim flow)
          if (d.members.length >= maxP) throw bad(409, 'Up to ' + maxP + ' golfers. ' + PRICE); const nm = clean(b.name, 24); if (nm.length < 2) throw bad(400, 'Guest name (2+ characters)');
          const m = { pid: newPid(d), mk: null, guest: true, gid: guest.gid, tok: crypto.createHash('sha256').update(guest.token).digest('hex'), name: nm, joined: now, paid: false }; d.members.push(m); applyIdx(D2, m.pid, NOH); { const gh = num(b.hcp, -10, 54); if (gh != null && !d.ent) setTyped(D2, m.pid, gh, mem, now); } // a guest has no Oddable index: the organizer sets the number
          if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(m.pid); if (!t.scorer) t.scorer = d.members.find((x) => x.mk === d.org).pid; }
          guest.pid = m.pid; d.u = now; return d; }
        if (a === 'add') { if (D2.teams.length >= 100) throw bad(409, 'Too many teams'); let n = D2.teams.length + 1; while (D2.teams.some((x) => x.tid === 'T' + n)) n++; D2.teams.push({ tid: 'T' + n, name: clean(b.name, 24) || 'Team ' + n, slots: Math.max(1, Math.min(4, num(b.slots, 1, 4) || D2.teamSize)), players: [], scorer: null }); }
        else if (a === 'rename') { const t = T(b.tid); t.name = clean(b.name, 24) || t.name; if (b.slots != null) t.slots = Math.max(t.players.length, Math.min(4, num(b.slots, 1, 4) || t.slots)); }
        else if (a === 'remove') { const t = T(b.tid); D2.teams = D2.teams.filter((x) => x !== t); D2.matches = D2.matches.filter((m) => m.kind !== 'team' || (m.a !== t.tid && m.b !== t.tid)); }
        else if (a === 'assign') { const p = String(b.pid); if (!d.members.some((m) => m.pid === p && !m.left)) throw bad(404, 'Not a member'); D2.teams.forEach((x) => { x.players = x.players.filter((y) => y !== p); if (x.scorer === p) x.scorer = x.players[0] || null; }); if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(p); if (!t.scorer) t.scorer = p; } }
        else throw bad(400, 'Unknown team change');
        d.u = now; return d; });
      if (guest) await mutIdx((x) => { x.mine['g:' + guest.gid] = [c.id]; return {}; });
      send(res, pending ? 202 : 200, Object.assign({ game: await full(g, u) }, guest ? { guest } : {}, pending ? { pending: true, note: 'Asked. In a money game your handicap counts once ' + (org ? 'another player who is not on your team' : 'the organizer') + ' OKs it.' } : {})); return true; // 202 = asked, not set
    }
    if (op === 'match') { // organizer: add / remove / draw heads-up matches (set-up only); the side that is down: press (Nassau); the other side: accept / decline
      rate('write', u.mk, ip); const a = String(b.op || '');
      const g = await mutC(c.id, (d) => { const D2 = d.day, H = D2.heads, boss = isOrg(d, u.mk) || isCo(d, mem);
        // who is on a side of the match: its players and the scorer(s) of their team(s)
        const sideT = (m, s) => (m.kind === 'team' ? D2.teams.filter((t) => t.tid === m[s]) : D2.teams.filter((t) => t.players.includes(m[s])));
        const onSide = (m, s) => (m.kind === 'team' ? sideT(m, s).some((t) => teamSide(t, mem.pid)) : m[s] === mem.pid || sideT(m, s).some((t) => t.scorer === mem.pid));
        const scores = (m, s) => (m.kind === 'player' && m[s] === mem.pid) || sideT(m, s).some((t) => t.scorer === mem.pid);
        if (a === 'press' || a === 'accept' || a === 'decline') { if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final' : 'The round has not started'); } // checked INSIDE the write
        if (a === 'press') { const m = D2.matches.find((x) => x.mid === String(b.mid)); if (!m || m.type !== 'nassau') throw bad(404, 'No such Nassau');
          const inA = onSide(m, 'a'), inB = onSide(m, 'b'), neutral = boss && !inA && !inB; if (!neutral && !scores(m, 'a') && !scores(m, 'b') && !(isOrg(d, u.mk) && (inA || inB))) throw bad(403, 'Only a scorer in this match or the organizer adds a press');
          const from = num(b.from, 1, 18), nine = from <= 9 ? 'front' : 'back'; if (!Number.isInteger(from)) throw bad(400, 'Press from which hole?'); if (m.press === 'auto2') throw bad(409, 'This Nassau presses by itself when a side goes 2 down. No manual presses.'); if (from === 1 || from === 10) throw bad(400, 'A press from hole ' + from + ' is the same as the ' + (from === 1 ? 'front' : 'back') + ' nine bet. Press from a later hole.'); if ((m.presses || []).length >= 8) throw bad(409, 'Too many presses');
          if ((m.presses || []).some((x) => x.from === from)) throw bad(409, 'There is already a press from hole ' + from);
          // review fix: a press is a new bet from the NEXT hole that has not been played (counted from the holes really played, also after the nine's
          // first bet was closed out), called by the side that is DOWN in that nine's newest bet. Never back-dated, never twice from one hole.
          const ms = matchState(d, m), st = ms.nassau, next = ms.next[nine], bets = [st[nine]].concat(st.presses.filter((x) => x.nine === nine).map((x) => x.m)), newest = bets[bets.length - 1];
          if (next == null) throw bad(409, 'Hole ' + from + ' has been played: the ' + nine + ' nine is finished. No press.');
          if (from < next) throw bad(409, 'Hole ' + from + ' has been played. A press starts on the next hole (' + next + ').'); if (from > next) throw bad(409, 'A press starts on the next hole to be played (' + next + ').');
          if (newest.up === 0) throw bad(409, 'The bet is all square: only the side that is down can press.');
          const down = newest.up < 0 ? 'a' : 'b'; if (!neutral && !(isOrg(d, u.mk) ? onSide(m, down) : scores(m, down))) throw bad(403, 'Only the side that is down can press.');
          // "press must be accepted": it counts once the OTHER side accepts, before that hole is played. Only a commissioner who is NOT in the match
          // (does not play or score on either side) can put a press straight in; the organizer's own press is an offer like anyone else's (review fix).
          const stt = neutral ? 'accepted' : 'offered'; m.presses = (m.presses || []).concat({ nine, from, by: mem.name, bp: mem.pid, at: now, st: stt, side: down }); audit(D2, { at: now, by: mem.name, what: stt === 'offered' ? 'press offered' : 'press', mid: m.mid, hole: from }); d.u = now; return d; }
        if (a === 'accept' || a === 'decline') { const m = D2.matches.find((x) => x.mid === String(b.mid)); if (!m || m.type !== 'nassau') throw bad(404, 'No such Nassau'); const from = num(b.from, 1, 18), p = (m.presses || []).find((x) => x.from === from && x.st === 'offered'); if (!p) throw bad(404, 'No press offered from that hole');
          const other = p.side === 'a' ? 'b' : 'a', neutral = boss && !onSide(m, 'a') && !onSide(m, 'b'), mineO = isOrg(d, u.mk) ? onSide(m, other) && !onSide(m, p.side) : scores(m, other) && !onSide(m, p.side);
          if (a === 'accept' && !neutral && !mineO) throw bad(403, 'The other side (or an organizer who is not in this match) answers a press.');
          if (a === 'decline' && !neutral && !mineO && p.bp !== mem.pid) throw bad(403, 'The other side (or an organizer who is not in this match) answers a press.'); // the one who offered it may take it back
          if (a === 'accept') { const next = matchState(d, m).next[p.nine]; if (next == null || from < next) { m.presses = m.presses.filter((x) => x !== p); audit(D2, { at: now, by: mem.name, what: 'press expired', mid: m.mid, hole: from }); d.u = now; return d; } p.st = 'accepted'; p.acc = mem.name; p.accAt = now; }
          else m.presses = m.presses.filter((x) => x !== p);
          audit(D2, { at: now, by: mem.name, what: a === 'accept' ? 'press accepted' : 'press declined', mid: m.mid, hole: from }); d.u = now; return d; }
        // review fix: matches are set before play. Once the round is live a match can only be added or removed while NEITHER side has a hole on its card; never after Final.
        if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer sets up matches'); if (D2.status === 'final') throw bad(409, 'The round is final');
        const begunM = (m) => ['a', 'b'].some((s) => sideT(m, s).some((t) => Object.keys(D2.scores[t.tid] || {}).length > 0)), lateNo = (m) => { if (D2.status !== 'setup' && begunM(m)) throw bad(409, 'Matches are set: these sides have started playing.'); };
        if (a === 'draw' && D2.status !== 'setup') throw bad(409, 'Matches are set: the round has started');
        const ids = H.kind === 'player' ? D2.teams.flatMap((t) => t.players) : D2.teams.filter((t) => t.players.length).map((t) => t.tid);
        const mk = (x, y, round) => ({ mid: rnd(6), kind: H.kind, type: H.type, a: x, b: y, amt: H.amt, net: d.day.net !== 'gross', offLow: H.offLow, auto: H.auto, press: H.press || 'accept', pct: H.pct, presses: [], round: round || null });
        if (a === 'add') { const x = String(b.a), y = String(b.b); if (x === y || !ids.includes(x) || !ids.includes(y)) throw bad(400, 'Pick two different ' + (H.kind === 'player' ? 'players' : 'teams')); if (D2.matches.length >= 200) throw bad(409, 'Too many matches'); const nm0 = mk(x, y); lateNo(nm0); D2.matches.push(nm0); }
        else if (a === 'remove') { const m0 = D2.matches.find((m) => m.mid === String(b.mid)); if (m0) lateNo(m0); D2.matches = D2.matches.filter((m) => m.mid !== String(b.mid)); }
        else if (a === 'draw') { // random draw / bracket round 1 (seeded in list order) / same foursome (players of the same team pair off, team vs team for teams in list order)
          let L = ids.slice(); if (H.pair === 'random') { for (let i = L.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [L[i], L[j]] = [L[j], L[i]]; } }
          const pairs = []; if (H.pair === 'bracket') { for (let i = 0; i < Math.floor(L.length / 2); i++) pairs.push([L[i], L[L.length - 1 - i]]); } else if (H.pair === 'foursome' && H.kind === 'player') { D2.teams.forEach((t) => { for (let i = 0; i + 1 < t.players.length; i += 2) pairs.push([t.players[i], t.players[i + 1]]); }); } else for (let i = 0; i + 1 < L.length; i += 2) pairs.push([L[i], L[i + 1]]);
          D2.matches = pairs.map(([x, y]) => mk(x, y, H.pair === 'bracket' ? 1 : null));
        } else throw bad(400, 'Unknown match change');
        d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'start' || op === 'final' || op === 'reopen') {
      if (!org) throw bad(403, 'Only the organizer starts or finishes the round');
      const fresh = {}; if (op === 'start' && d0.status === 'setup') { for (const m of c.members) if (keyOfMember(m)) fresh[m.pid] = await hcpOf(keyOfMember(m), hOpts(c)); } // H1: the latest index at the first tee
      let need = null, started = false;
      const g = await mutC(c.id, (d) => { const D2 = d.day; need = null; started = false; // every status check is INSIDE the write
        if (op === 'start') { if (D2.status !== 'setup') return { nochange: true, v: d }; if (!D2.teams.some((t) => t.players.length)) throw bad(409, 'Put players on teams first');
          Object.keys(fresh).forEach((p) => { if (d.members.some((m) => m.pid === p)) applyIdx(D2, p, fresh[p]); });
          // review fix: a NET MONEY game does not start until every player has a number: never 0 strokes by default where money is shown (the confirmed index, the director's, or one the organizer set or OK'd)
          if (moneyOn(d) && netOn(D2) && !D2.solo) { const miss = D2.teams.flatMap((t) => t.players).filter((p) => (D2.hsrc[p] || 'none') === 'none'); if (miss.length) { need = miss; d.u = now; return d; } } // the fresh numbers are kept; the start is refused below
          D2.teams.forEach((t) => { if (t.players.length && !t.scorer) t.scorer = t.players[0]; }); D2.status = 'live'; D2.lockAt = minT(D2.lockAt, now); D2.flights = flightPlan(d); started = true; }
        else if (op === 'final') { if (D2.status === 'final') return { nochange: true, v: d }; if (D2.status !== 'live') throw bad(409, 'The round has not started');
          const dis = D2.teams.some((t) => Object.values(D2.scores[t.tid] || {}).some((h) => h.st === 'disputed')); if (dis) throw bad(409, 'Settle the disputed holes first');
          const money = moneyOn(d) && !D2.solo, n = D2.course.par.length, bd = dayBoard(d);
          // review fix: with money on the round every team is through all its holes, or is marked withdrawn (did not finish). No Final over a short card.
          const short = bd.rows.filter((r) => !r.wd && r.thru < n); if (money && short.length) throw bad(409, short.map((r) => r.name + ' has played ' + r.thru + ' of ' + n + ' holes').join('; ') + '. Finish the card, or mark the team withdrawn (did not finish: no place, no prize money).', { incomplete: short.map((r) => ({ tid: r.tid, name: r.name, thru: r.thru })) });
          // Playbook: money on the line and holes nobody confirmed -> no Final, unless the commissioner forces it with a reason (logged, shown to everyone).
          // review fix: a forced finish NEVER covers the forcer's own side: holes of a team they play on or score for, holes they typed themselves, or a
          // side-game winner on their team. Another team's scorer confirms those. (Only exception: nobody else in the game has an account to confirm with.)
          const un = unconfirmed(d, mem); if (un.n && money) { const why = clean(b.reason, 120), others = d.members.some((m) => m.mk && m.mk !== u.mk && !m.left), mine = others ? un.own : 0;
            const msg = un.n + ' hole' + (un.n === 1 ? ' was' : 's were') + ' never confirmed' + (un.side ? ' (' + un.side + ' side-game winner' + (un.side === 1 ? '' : 's') + ' too)' : '');
            if (mine) throw bad(409, msg + '. ' + mine + ' of them ' + (mine === 1 ? 'is' : 'are') + ' on your own team or entered by you: another team\'s scorer has to confirm ' + (mine === 1 ? 'it' : 'them') + '. A forced finish cannot cover your own side.', { unconfirmed: un.n, side: un.side, own: mine, canForce: false });
            if (!b.force) throw bad(409, msg + ". Have another team's scorer confirm them, or finish anyway with a reason.", { unconfirmed: un.n, side: un.side, own: 0, canForce: true });
            if (why.length < 3) throw bad(400, 'Give a reason for finishing with unconfirmed holes (3+ characters)'); D2.forced = { by: mem.name, at: now, reason: why, holes: un.n, side: un.side, alone: !others };
            audit(D2, { at: now, by: mem.name, what: 'final forced', note: un.n + ' unconfirmed: ' + why }); notify(d, 'forced', mem, mem.name + ' finished the round with ' + un.n + ' hole' + (un.n === 1 ? '' : 's') + ' never confirmed. Reason: ' + why); } else delete D2.forced;
          D2.status = 'final'; D2.finalAt = now; }
        else { // REOPEN (review fix): only a Final round, only with a reason; it is logged and every player is told. Nothing else changes a Final round.
          if (D2.status !== 'final') throw bad(409, 'Only a finished round can be reopened'); const why = clean(b.reason, 120); if (why.length < 3) throw bad(400, 'Give a reason for reopening the round (3+ characters). Every player is told.');
          D2.status = 'live'; delete D2.forced; D2.reopens = (D2.reopens || []).concat({ at: now, by: mem.name, reason: why }).slice(-20); audit(D2, { at: now, by: mem.name, what: 'reopen', note: why });
          notify(d, 'reopen', mem, mem.name + ' reopened the round after it was final. Reason: ' + why + '. Scores, winners and payouts can change until it is finished again; changed holes need a fresh confirmation.'); d.u = now; return d; }
        audit(D2, { at: now, by: mem.name, what: op }); d.u = now; return d; });
      if (need) { const nm = nameMap(g); throw bad(409, need.map((p) => nm[p] || 'Player').join(', ') + (need.length === 1 ? ' has' : ' have') + ' no handicap yet. In a net money game every player needs a number before the round starts: the organizer (or tournament director) sets or OKs it.', { needHcp: need }); }
      if (started && c.ent) { try { await D.eventSetup(c.orgE, EID(c.id), { title: c.title, sport: 'golf', lockAt: g.day.lockAt }); } catch (e) { /* already locked there */ } } // only once the round HAS started (a refused Start locks nothing)
      if (started) await recPlays(g, 'golf-day', g.day.teams.flatMap((t) => t.players)); // Enterprise billing: one play per player
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'score') { // the team's scorer (or the organizer) enters a hole; offline-safe: eid makes a retry harmless; rev guards against overwriting someone else's newer entry
      rate('score', u.mk, ip); if (d0.status !== 'live') throw bad(409, d0.status === 'setup' ? 'The round has not started' : 'The round is final');
      const { t, ok } = canScore(c, u.mk, String(b.tid)); if (!ok) throw bad(403, "Only this team's scorer can enter its scores"); const { hole, e } = entryOf(c, t, b); const eid = clean(b.eid, 40);
      const out = await mutC(c.id, (d) => { const D2 = d.day; if (eid && D2.eids.includes(eid)) return { nochange: true, v: { dup: true, d } };
        if (D2.status !== 'live') throw bad(409, D2.status === 'setup' ? 'The round has not started' : 'The round is final'); if (!canScore(d, u.mk, t.tid).ok) throw bad(403, "Only this team's scorer can enter its scores"); // checked INSIDE the write
        if ((D2.wd || {})[t.tid]) throw bad(409, 'This team was marked withdrawn (did not finish).');
        const sc = D2.scores[t.tid] = D2.scores[t.tid] || {}, cur = sc[hole];
        if (cur && cur.st === 'confirmed' && !isOrg(d, u.mk)) throw bad(409, 'Hole ' + hole + ' is confirmed. Ask the organizer to change it.');
        if (cur && cur.st === 'disputed') throw bad(409, 'Hole ' + hole + ' is disputed. It has to be settled first.');
        // stale-write guard: only against SOMEONE ELSE'S newer entry. The same scorer's later correction always wins (two offline corrections of one hole, review fix).
        if (cur && b.rev != null && Number(b.rev) !== cur.rev && !same(cur, e) && cur.bp !== mem.pid) throw bad(409, 'Hole ' + hole + ' was changed by ' + (cur.by || 'someone') + '. Check it and enter again.', { current: cur });
        if (cur && same(cur, e)) { if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } return { v: d }; }
        sc[hole] = Object.assign(e, { by: mem.name, bp: mem.pid, at: now, rev: ((cur && cur.rev) || 0) + 1, st: 'entered' }); // any change = a new version that needs a fresh confirm
        audit(D2, { at: now, by: mem.name, tid: t.tid, hole, what: cur ? 'changed' : 'entered', from: cur ? { g: cur.g, p: cur.p } : null, to: { g: e.g, p: e.p, drive: e.drive } });
        if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } d.u = now; return { v: d }; });
      const g = out && out.d ? out.d : out.v || out; send(res, 200, { game: await full(g, u), dup: !!(out && out.dup) }); return true;
    }
    if (op === 'confirm' || op === 'dispute') {
      // TWO PEOPLE, NOT BOTH FROM THE TEAM. A hole the team entered is confirmed by someone who does not play on or score for that team (another team's
      // scorer, the organizer or a co-organizer). A hole typed by an outsider (the organizer keeping a team's card) is confirmed by that team's scorer or by
      // another outsider. Nobody confirms a version they typed. CONFIRM PINS WHAT WAS SEEN (review fix): the phone sends the hole versions it showed
      // (`revs`); without them the versions this server last sent that member are used. A hole that changed since is not confirmed.
      rate('score', u.mk, ip); const tid = String(b.tid); if (!d0.teams.some((x) => x.tid === tid)) throw bad(404, 'No such team');
      const from = num(op === 'dispute' ? b.hole : b.from, 1, 18), to = op === 'dispute' ? from : num(b.to, 1, 18); if (from == null || to == null || to < from) throw bad(400, 'Which holes?');
      const seen = b.revs && typeof b.revs === 'object' ? b.revs : (SEEN.get(c.id + '|' + mem.pid) || {})[tid] || null;
      const g = await mutC(c.id, (d) => { const D2 = d.day; if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. It has to be reopened before anything changes.' : 'The round has not started'); // INSIDE the write
        const t = D2.teams.find((x) => x.tid === tid), me = memberOf(d, u.mk); if (!t || !me) throw bad(404, 'No such team'); const mine = teamSide(t, me.pid), boss = isOrg(d, u.mk) || isCo(d, me), other = D2.teams.some((x) => x.tid !== t.tid && x.scorer === me.pid);
        if (!boss && !other && !(mine && t.scorer === me.pid)) throw bad(403, "Another team's scorer (or the organizer) confirms. You can't confirm your own team.");
        const sc = D2.scores[t.tid] || {}, stale = [], own = [], self = []; let n = 0;
        for (let h = from; h <= to; h++) { const x = sc[h]; if (!x) continue; const outside = !!x.bp && !teamSide(t, x.bp);
          if (mine && !outside) { own.push(h); continue; } // the team's own entry: someone from outside the team decides
          if (op === 'confirm') { if (x.st !== 'entered') continue; if (x.bp === me.pid) { self.push(h); continue; } if (!seen || Number(seen[h]) !== x.rev) { stale.push(h); continue; }
            x.st = 'confirmed'; x.cf = me.name; x.cfPid = me.pid; x.cfAt = now; } else { if (x.st === 'disputed') continue; x.st = 'disputed'; x.note = clean(b.note, 120); x.df = me.name; x.dfPid = me.pid; }
          n++; }
        if (stale.length) throw bad(409, 'Hole' + (stale.length === 1 ? ' ' : 's ') + stale.join(', ') + (seen ? ' changed since you looked at the card.' : ': open the card first.') + ' Check ' + (stale.length === 1 ? 'it' : 'them') + ' and confirm again. Nothing was confirmed.', { stale });
        if (!n) { if (own.length) throw bad(403, "You can't confirm a card for a team you play on or score for. Another team's scorer confirms it."); if (self.length) throw bad(403, 'You typed ' + (self.length === 1 ? 'that hole' : 'those holes') + ' yourself. Someone else confirms ' + (self.length === 1 ? 'it' : 'them') + '.'); throw bad(409, op === 'confirm' ? 'No entered holes in that range' : 'That hole has no score yet'); }
        audit(D2, { at: now, by: me.name, tid: t.tid, hole: from, to, what: op === 'confirm' ? 'confirmed' : 'disputed', note: op === 'dispute' ? clean(b.note, 120) : undefined }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'resolve') {
      // SETTLE A DISPUTE (review fix): only a hole that IS disputed, only in a live round, never by someone on that team's side. The organizer or a
      // co-organizer settles other teams' holes. A hole on a team the ORGANIZER plays on or scores for is settled by a co-organizer or by another
      // team's scorer; a settlement typed by another team's scorer still needs the team's scorer (or another outsider) to confirm it.
      rate('score', u.mk, ip); const t0 = d0.teams.find((x) => x.tid === String(b.tid)); if (!t0) throw bad(404, 'No such team'); const { hole, e } = entryOf(c, t0, b);
      const g = await mutC(c.id, (d) => { const D2 = d.day; if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. It has to be reopened before anything changes.' : 'The round has not started');
        const t = D2.teams.find((x) => x.tid === t0.tid), me = memberOf(d, u.mk); if (!t || !me) throw bad(404, 'No such team'); const sc = D2.scores[t.tid] = D2.scores[t.tid] || {}, cur = sc[hole];
        if (!cur || cur.st !== 'disputed') throw bad(409, 'Hole ' + hole + ' is not disputed. Only a disputed hole can be settled.');
        const boss = isOrg(d, u.mk) || isCo(d, me), orgM = d.members.find((m) => m.mk === d.org), orgSide = teamSide(t, orgM && orgM.pid), other = D2.teams.some((x) => x.tid !== t.tid && x.scorer === me.pid);
        if (teamSide(t, me.pid)) throw bad(403, 'You play on or score for this team. ' + (isOrg(d, u.mk) ? "Another team's scorer or a co-organizer settles it." : 'The organizer settles it.'));
        if (!boss && !(other && orgSide)) throw bad(403, 'Only the organizer settles disputes');
        const settled = boss; // a neutral organizer / co-organizer settles for good; another team's scorer proposes, and it still needs a confirm
        sc[hole] = Object.assign(e, { by: me.name, bp: me.pid, at: now, rev: (cur.rev || 0) + 1, st: settled ? 'confirmed' : 'entered' }, settled ? { cf: me.name + (isOrg(d, u.mk) ? ' (organizer)' : ' (co-organizer)'), cfPid: me.pid, cfAt: now } : {});
        audit(D2, { at: now, by: me.name, tid: t.tid, hole, what: settled ? 'settled' : 'settlement entered', from: { g: cur.g, p: cur.p, note: cur.note }, to: { g: e.g, p: e.p } }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'extraconfirm') { // Playbook: a closest-to-the-pin / longest-drive winner is confirmed like a score, by someone NOT on the winner's team who did not enter it
      const kind = b.kind === 'ld' ? 'ld' : 'ctp', hole = num(b.hole, 1, 18);
      const g = await mutC(c.id, (d) => { const D2 = d.day; if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. It has to be reopened before anything changes.' : 'The round has not started'); // INSIDE the write
        const x = ((D2.win || {})[kind] || {})[hole], me = memberOf(d, u.mk); if (!x || !me) throw bad(404, 'No winner entered for that hole'); if (b.who != null && String(b.who) !== x.who) throw bad(409, 'The winner changed. Check it again.'); if (x.st === 'confirmed') return { nochange: true, v: d };
        const wT = D2.teams.find((t) => t.tid === x.who || t.players.includes(x.who));
        if (!isOrg(d, u.mk) && !isCo(d, me) && !D2.teams.some((t) => t.scorer === me.pid)) throw bad(403, "Another team's scorer (or the organizer) confirms the winner"); if (x.who === me.pid || teamSide(wT, me.pid) || x.bp === me.pid) throw bad(403, "Someone who is not on the winner's team, and did not enter it, confirms the winner.");
        x.st = 'confirmed'; x.cf = me.name; x.cfPid = me.pid; x.cfAt = now; audit(D2, { at: now, by: me.name, hole, what: kind + ' confirmed' }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'extra' || op === 'extrareopen') { // closest to the pin / longest drive winner: organizer or any scorer enters it. LIVE ROUNDS ONLY (review fix).
      const kind = b.kind === 'ld' ? 'ld' : 'ctp', hole = num(b.hole, 1, 18); if (!d0.extras[kind].includes(hole)) throw bad(400, 'That hole has no ' + (kind === 'ld' ? 'longest drive' : 'closest to the pin'));
      const who = String(b.who || ''); if (op === 'extra' && who && !c.members.some((m) => m.pid === who) && !d0.teams.some((t) => t.tid === who)) throw bad(400, 'Pick the winner');
      const g = await mutC(c.id, (d) => { const D2 = d.day, me = memberOf(d, u.mk); if (D2.status !== 'live') throw bad(409, D2.status === 'final' ? 'The round is final. The organizer has to reopen it (with a reason) before a winner can change.' : 'The round has not started'); // INSIDE the write
        D2.win[kind] = D2.win[kind] || {}; const cur = D2.win[kind][hole];
        if (op === 'extrareopen') { // a CONFIRMED winner changes only this way: the organizer (or a co-organizer) reopens it with a reason, logged and sent to every player; the new entry needs a fresh confirm
          if (!isOrg(d, u.mk) && !isCo(d, me)) throw bad(403, 'Only the organizer reopens a confirmed winner'); if (!cur || cur.st !== 'confirmed') throw bad(409, 'That winner is not confirmed. Enter the right one.'); const why = clean(b.reason, 120); if (why.length < 3) throw bad(400, 'Give a reason for reopening this winner (3+ characters). Every player is told.');
          cur.st = 'reopened'; cur.ro = { by: me.name, at: now, reason: why }; audit(D2, { at: now, by: me.name, hole, what: kind + ' reopened', note: why }); notify(d, 'side', me, me.name + ' reopened the ' + (kind === 'ld' ? 'longest drive' : 'closest to the pin') + ' winner on hole ' + hole + '. Reason: ' + why + '. It needs a fresh confirmation.'); d.u = now; return d; }
        if (!isOrg(d, u.mk) && !isCo(d, me) && !D2.teams.some((t) => t.scorer === me.pid)) throw bad(403, 'Only a scorer or the organizer enters winners');
        if (cur && cur.st === 'confirmed') throw bad(409, 'That winner is confirmed. It changes only if the organizer reopens it with a reason, and then it is confirmed again.');
        if (!who) delete D2.win[kind][hole]; else D2.win[kind][hole] = { who, note: clean(b.note, 40), by: me.name, bp: me.pid, at: now, st: 'entered' }; audit(D2, { at: now, by: me.name, hole, what: kind + (who ? ' winner' : ' cleared'), to: who || null }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    throw bad(404, 'not found');
  } catch (e) { if (!e.status) console.error('golf:', e.message); send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Golf error, try again' }, e.extra || {})); return true; }
}

// ---------- adapter (for Groups and the Calcutta engine) ----------
// attachToGroup(gameId, groupId, contestId): called BY THE GROUPS MODULE after it has checked that the caller is that group's commissioner
// (groups.attachGame). It only accepts an attach that the golf organizer has just asked for through /golf/attach (or create with a group), so a
// commissioner cannot pull someone else's golf game into a group, and nobody can attach to a group they do not run. `attach` is the same function
// (older wiring registers it under that name).
async function attachToGroup(id, groupId, contestId) { const gid = clean(groupId, 20), k = String(id) + '|' + gid, t = ATT.get(k); if (!t || t < D.now()) throw bad(403, 'Only the organizer of this golf game, as commissioner of that group, can attach it');
  return mutC(id, (d) => { d.groupId = gid; d.contestId = contestId ? clean(contestId, 20) : null; d.u = D.now(); return { ok: true }; }); }
const attach = attachToGroup;
// potSummary(contestId): information only (Oddable never collects, holds or pays money). perSkin = the value of ONE skin (it was mislabelled per entrant).
async function potSummary(id) { const c = await getC(id), p = c.pot, pc = poolC(c);
  const o = { id: c.id, kind: c.kind, title: c.title, pot: p.pot, entry: p.entry, entrants: entrantsOf(c), paid: paidPids(c).size, expected: p.entry * entrantsOf(c), potTotal: pc.potC / 100, take: pc.takeC / 100, pool: pc.poolC / 100 };
  if (c.day) o.extras = { perSkin: c.day.extras.skins.on ? c.day.extras.skins.amt : 0, ctp: c.day.extras.ctp.length * c.day.extras.ctpAmt, ld: c.day.extras.ld.length * c.day.extras.ldAmt, perMatch: c.day.heads.on ? c.day.heads.amt : 0, matches: c.day.matches.length };
  return o; }
// golfers(eventId, tour): lots source for the Calcutta engine: every golfer in the field, in feed order (the engine decides any "field" bundle).
async function golfers(eventId, tour) { const b = await D.feed.board(F.TOURS[tour] ? tour : 'pga', eventId); return b.golfers.filter((g) => g.st !== 'wd' || g.started).map((g) => ({ id: 'g:' + g.id, name: g.name, label: g.name, src: 'golf-pro', eventId: b.event.id, st: g.st, pos: g.pos, toPar: g.toPar })); }
// teams(contestId): a golf day's teams as lots, with display names only (safe to show).
async function teams(id) { const c = await getC(id); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); const nm = nameMap(c), bd = dayBoard(c); return c.day.teams.filter((t) => t.players.length).map((t) => { const r = bd.rows.find((x) => x.tid === t.tid) || {}; return { id: 't:' + c.id + ':' + t.tid, name: t.name, label: t.name + ' (' + t.players.map((p) => nm[p]).join(', ') + ')', src: 'golf-day', players: t.players.map((p) => nm[p]), place: r.place || null, thru: r.thru || 0 }; }); }
// Players of record for the Calcutta engine (calcutta-calc HANDOFF "Round 3"): each player as an ACCOUNT ID, or 'g:<guest id>' for a guest, so players can
// buy back their own team and get their S-ALL record. SERVER TO SERVER ONLY: this never goes into a golf response, and the engine keeps keys, not ids.
async function teamsOfRecord(id) { const c = await getC(id); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return c.day.teams.filter((t) => t.players.length).map((t) => ({ id: 't:' + c.id + ':' + t.tid, name: t.name, abbr: t.name.slice(0, 4).toUpperCase(),
  // Round 4 contract: an account that joined the golf day ITSELF is sent as { key: <account id>, name, accepted: true } (it shows in that player's dashboard at once); a guest as 'g:<guest id>'
  players: t.players.map((p) => c.members.find((m) => m.pid === p)).filter(Boolean).map((m) => (m.guest ? 'g:' + m.gid : m.e ? { key: m.e, name: m.name, accepted: true } : null)).filter(Boolean) })); }
// Who is asking (calcutta-calc "Round 4", item 5): the engine passes { viewer: <account id> }. A golf day's teams are shown only to people IN that golf day,
// and only its organizer may build a Calcutta on it. No viewer, a stranger, an unreadable game: refused (null / false), never the list.
const viewerIn = (c, ctx) => { const v = ctx && ctx.viewer ? String(ctx.viewer) : ''; if (!v) return null; return c.members.find((m) => m.e === v && !m.left) || null; };
// GOLF CALCUTTA (manager decision Nov 16 2026): golf registers itself with the Calcutta engine so tour fields and golf-day teams can be auctioned.
// Lot source contract (calcutta.js "PLUGGED SOURCES"): teams() -> lots, results(calc) -> {<lotId>: {wins, winT, reached, reachT, champ, out, place}},
// startTime(calc) -> ms | null, started(calc) -> true once play is under way. Which golf thing a Calcutta is about is read from calc.golf:
//   { gameId }            a golf day's teams (local: its own players are the players of record)      lot ids 't:<gameId>:<tid>'
//   { tour, eventId }     a tour event's field (default: this week's PGA TOUR event)                  lot ids 'g:<golferId>'
// started() NEVER answers true by default (the engine treats true as permanent): a read error, an unknown game id or a missing start time is THROWN,
// and the engine fails closed for as long as that lasts. results() answers {} when it cannot read (nothing is paid).
const calcRef = (calc) => { const g = (calc && (calc.golf || calc.ref || (calc.rules && calc.rules.golf))) || {}; return g.gameId ? { gameId: String(g.gameId) } : { tour: F.TOURS[g.tour] ? g.tour : 'pga', eventId: g.eventId ? clean(g.eventId, 20) : '' }; };
const noRes = (o) => Object.assign({ wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false }, o);
const calcuttaSource = {
  golf: true,
  organizer: async (calc, ctx) => { const r = calcRef(calc); if (!r.gameId) return !!(ctx && ctx.viewer); const c = await getC(r.gameId), m = viewerIn(c, ctx); return !!m && c.kind === 'day' && isOrg(c, m.mk); },
  teams: async (calc, ctx) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); if (!viewerIn(c, ctx)) return null; return teamsOfRecord(r.gameId); } return (await golfers(r.eventId, r.tour)).map((g) => ({ id: g.id, name: g.name, abbr: g.name.split(' ').slice(-1)[0].slice(0, 4).toUpperCase() })); },
  // the scheduled end (the engine opens a commissioner correction 24 h after it when no result came): a tour event's last day; a golf day = 6 hours after its first tee time (noon Central of its date when no tee time was set)
  endTime: async (calc) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return (c.day.lockAt || Date.parse(c.day.date + 'T18:00:00Z')) + 6 * 3600e3; } const b = await D.feed.board(r.tour, r.eventId); return (b && b.event && (b.event.end || (b.event.start ? b.event.start + 4 * DAY : null))) || null; },
  startTime: async (calc) => { const r = calcRef(calc); if (r.gameId) { const c = await getC(r.gameId); return c.day.lockAt || null; } const b = await D.feed.board(r.tour, r.eventId); return feedLock(b); },
  started: async (calc) => { const r = calcRef(calc); // every failure below is thrown, never turned into "started"
    if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); return c.day.status !== 'setup' || (c.day.lockAt != null && D.now() >= c.day.lockAt); }
    const b = await D.feed.board(r.tour, r.eventId); if (!b || !b.event) throw new Error('golf: no leaderboard for that event'); if (begun(b)) return true; const la = feedLock(b); if (!la) throw new Error('golf: the feed has no start time for that event'); return D.now() >= la; },
  results: async (calc) => { try { const r = calcRef(calc);
      if (r.gameId) { const c = await getC(r.gameId); if (c.kind !== 'day' || c.day.status !== 'final') return {}; const bd = dayBoard(c), out = {}; bd.rows.forEach((x) => { if (x.place) out['t:' + c.id + ':' + x.tid] = noRes({ place: x.place, champ: x.place === 1 && bd.rows.filter((y) => y.place === 1).length === 1 }); else if (x.dnf) out['t:' + c.id + ':' + x.tid] = noRes({ out: true }); }); return out; }
      const b = await D.feed.board(r.tour, r.eventId); if (!b.event.done) return {}; const out = {}; b.golfers.forEach((g) => { const pl = parseInt(String(g.pos).replace(/^T/, ''), 10); out['g:' + g.id] = noRes(g.st === 'active' && pl ? { place: pl, champ: pl === 1 && b.golfers.filter((x) => x.pos === g.pos).length === 1 } : { out: true }); }); return out; } catch (e) { return {}; } },
};
// Called once at start-up (server.js) with the Calcutta module: registers the sources and remembers the module for attach.
let CALC = null;
function registerCalcutta(calcMod) { if (!calcMod || typeof calcMod.registerSource !== 'function') return false; calcMod.registerSource('golf', calcuttaSource); calcMod.registerSource('golf-day', Object.assign({}, calcuttaSource, { local: true })); CALC = calcMod; return true; }
// Organizer links a golf game to a Calcutta built in the Calcutta screen: the golf game remembers it and the Calcutta is attached to the same group/contest.
async function linkCalcutta(gameId, calcId, accountKey) { const cid = clean(calcId, 40); if (!cid) throw bad(400, 'Which Calcutta?'); const g = await mutC(gameId, (d) => { if (d.org !== mkOf(accountKey)) throw bad(403, 'Only the organizer links a Calcutta'); d.calcId = cid; d.u = D.now(); return d; });
  if (CALC && typeof CALC.attachToGroup === 'function' && g.groupId) await CALC.attachToGroup(cid, g.groupId, g.contestId || g.id); return { ok: true, calcId: cid, attached: !!(CALC && g.groupId) }; }
// Bets vs the group: Groups' grading only knows football, so a golf bet is classified 'golf' and is honor-system (the member settles it by hand).
function isGolfBet(b) { if (!b) return false; if (String(b.lg || '').toLowerCase() === 'golf') return true; const t = String(b.kt || '') + ' ' + String(b.text || ''); return /\b(PGA|LPGA|LIV|GOLF|MASTERS|US OPEN GOLF|RYDER)\b/i.test(t) || /^KX(PGA|GOLF)/i.test(String(b.kt || '')); }

// ---------- stats contract (consumed by the stats coder: calcutta-stats odds-api/stats.js validate + tot) ----------
// statsFor(userKey, {from, to}) -> normalized records. userKey = the account id from acct.who() (or 'guest:<gid>'). Dates are America/Chicago days.
// Kinds (review fix, Nov 16 2026): 'golf-round' = a round (result W only for the outright winner of a final golf day), 'match' = a heads-up match,
// 'event' = a side prize won (skins, closest to the pin, longest drive) with result 'W' and won = $ (information only), 'golf-pool' = a pool finish
// (result null + place; pick six once the event is final, one and done once the season is over; a running season has no place = open).
// verified = every hole confirmed by someone NOT on that team (never for a solo round).
// S-ALL money on a finished play: entry (stake), payout (won) and net (pl = payout - entry). Always present once the play is final, 0 included.
const money = (c, cents, paid) => ({ stake: paid === false ? 0 : c.pot.entry || 0, won: Math.round(cents || 0) / 100, pl: Math.round((cents || 0) - (paid === false ? 0 : c.pot.entry || 0) * 100) / 100 });
const by0 = (bd) => (bd.payBy === 'gross' ? 'gross' : 'net');
// Split cents among people exactly (leftover cents one each in list order).
const shareC = (cents, ids) => { const o = {}; if (!ids.length) return o; const each = Math.floor(cents / ids.length); let left = cents - each * ids.length; ids.forEach((p) => { o[p] = each + (left > 0 ? 1 : 0); if (left > 0) left--; }); return o; };
// SIDE MONEY TO THE CENT (review fix): a prize won by a TEAM (team skins, team closest to the pin) is ONE prize split among the team's players, not one
// prize per player, so the records add up to the real money. Where an entry fee is charged, only players marked paid take a share (an unpaid player
// shows no winnings). -> { skins: {pid: cents}, units: {pid: skins}, inSkins: Set(pid), side: {'ctp3': {pid: cents}} }
function sideMoney(c, bd) { const d = c.day, elig = (p) => { const m = c.members.find((x) => x.pid === p); return !!m && (!(c.pot.entry > 0) || !!m.paid); }, team = S.FORMATS[d.fmt].ball === 'team', out = { skins: {}, units: {}, inSkins: new Set(), side: {} };
  const ppl = (id) => { const t = d.teams.find((x) => x.tid === id); return t ? t.players : [id]; };
  if (bd.skins) { d.teams.filter((t) => t.players.length && !(d.wd || {})[t.tid]).forEach((t) => t.players.forEach((p) => out.inSkins.add(p))); const amt = d.extras.skins.amt || 0, ids = Object.keys(bd.skins.wonC || {}); let acc = 0, given = 0;
    ids.forEach((id) => { acc += bd.skins.wonC[id]; const upto = Math.round(acc * amt), cents = upto - given; given = upto; const all = ppl(id), ps = all.filter(elig), sh = shareC(cents, ps); all.forEach((p) => { out.units[p] = Math.round(bd.skins.wonC[id] / all.length * 10) / 1000; out.skins[p] = sh[p] || 0; }); }); }
  ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((hole) => { const w = d.win[k][hole]; if (w.st !== 'confirmed') return; const all = ppl(w.who), sh = shareC(Math.round(((k === 'ctp' ? d.extras.ctpAmt : d.extras.ldAmt) || 0) * 100), all.filter(elig)); out.side[k + hole] = {}; all.forEach((p) => (out.side[k + hole][p] = sh[p] || 0)); }));
  return out; }
async function statsFor(userKey, opt) {
  opt = opt || {}; const gk = /^guest:/.test(String(userKey)) ? String(userKey).slice(6) : null, mk = gk ? null : mkOf(userKey), from = opt.from || '0000-00-00', to = opt.to || '9999-99-99';
  const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[gk ? 'g:' + gk : mk] || [], out = [];
  for (const id of ids) {
    let c; try { c = await getC(id); } catch (e) { continue; } const m = gk ? c.members.find((x) => x.guest && x.gid === gk) : anyMember(c, mk); if (!m) continue; const nm = nameMap(c); // a player who left a pool keeps the result (the entry stayed in)
    if (c.kind === 'day') {
      const d = c.day, date = d.date; if (date < from || date > to) continue; const t = d.teams.find((x) => x.players.includes(m.pid)), bd = dayBoard(c), n = d.course.par.length, cid = d.course.id || null, fin = d.status === 'final', SM = sideMoney(c, bd), unpaid = (c.pot.entry || 0) > 0 && !m.paid;
      if (t) { const row = bd.rows.find((x) => x.tid === t.tid), h = holesOf(c, t.tid), team = S.FORMATS[d.fmt].ball === 'team';
        let score = null, toPar = null, putts = null, thru = 0; const hs = d.course.par.map((_, i) => { const e = h[i + 1]; if (!e) return null; const v = team ? Number(e.g) : Number(e.p && e.p[m.pid]); return v >= 1 ? v : null; });
        if (team) { score = row.gross; toPar = row.toParG; thru = row.thru; } else { let s0 = 0, pp = 0; d.course.par.forEach((par, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[m.pid]); if (g >= 1) { s0 += g; pp += par; thru++; } }); score = thru ? s0 : null; toPar = thru ? s0 - pp : null; }
        // putts are one number per hole entry: credited only in individual formats, to a one-player team or to the scorer who typed them for themself
        if (!team) Object.values(h).forEach((e) => { if (e.putts != null && (t.players.length === 1 || e.bp === m.pid)) putts = (putts || 0) + e.putts; });
        // verified = every hole agreed by two people who are not both from this team (never a solo round)
        const verified = !d.solo && Object.keys(h).length > 0 && Object.values(h).every((e) => e.st === 'confirmed' && e.cfPid && (!teamSide(t, e.cfPid) || (!!e.bp && !teamSide(t, e.bp))));
        const pay = fin && !d.solo && c.members.length > 1 ? dayPay(c, bd).pids : null, mny = fin ? money(c, pay ? pay[m.pid] : 0, !!m.paid) : { stake: m.paid ? c.pot.entry || undefined : undefined };
        // What counts toward the index (review fix): only a player's OWN ball for the whole round. Scrambles, alternate shot, Chapman and a SHAMBLE (the
        // team's drive is used) never do; best ball does, when this player holed out on every hole. The stats module decides; these flags tell it.
        const ownBall = !team && d.fmt !== 'shamble' && thru === n, wonRound = fin && row.place === 1 && !d.solo && bd.rows.filter((x) => x.place === 1).length === 1;
        if (thru) out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':round:' + m.pid, date, sport: 'golf', kind: 'golf-round', groupId: c.groupId || undefined, contestId: c.id, title: c.title + ' · ' + d.course.name, result: wonRound ? 'W' : null, place: row.place && !d.solo ? { n: row.place, of: bd.rows.length } : undefined, score, toPar, verified, extra: { net: team ? row.net : (S.FORMATS[d.fmt].ball === 'player' && thru ? score - d.course.par.reduce((a, _, i) => a + (hs[i] != null ? S.strokesOn(S.playHcp(chOf(d, m.pid), d.pct, n), d.course.hcp[i], n) : 0), 0) : null), teamNet: row.net, toParNet: row.toParN, courseId: cid, course: d.course.name, tees: d.course.tees, rating: d.course.rating ?? null, slope: d.course.slope ?? null, holes: thru, of: n, putts, format: d.fmt, solo: !!d.solo, confirmed: !d.solo && c.members.length > 1, team: team ? t.name : undefined, teamScore: row.gross, teamBall: team || d.fmt === 'shamble', ownBall, hcpCounts: ownBall, dnf: fin && row.dnf ? true : undefined, withdrawn: row.wd ? true : undefined, flight: bd.flights && row.flight != null ? bd.flights[row.flight].name : undefined, flightPlace: bd.flights && row.flight != null ? row[by0(bd) === 'net' ? 'fPlaceN' : 'fPlaceG'] || undefined : undefined, unpaid: fin && unpaid ? true : undefined, holeScores: hs, pars: d.course.par, hcpIdx: d.course.hcp, at: d.finalAt || c.created, who: team ? t.players.map((p) => nm[p]) : undefined, playingHcp: S.playHcp(chOf(d, m.pid), d.pct, n), hcpSrc: (d.hsrc || {})[m.pid] || 'none', oddableIndex: ((d.odx || {})[m.pid] || {}).index ?? null, guestId: m.guest ? m.gid : undefined, final: fin } }, mny));
        // skins: EVERY player in the skins game gets a record (winners W with their exact share, the rest L with 0), so nobody's dashboard misses the play
        if (fin && bd.skins && SM.inSkins.has(m.pid)) { const cents = SM.skins[m.pid] || 0, un = SM.units[m.pid] || 0, w = un > 0; out.push({ src: 'golf', id: 'golf:' + c.id + ':skins:' + m.pid, date, sport: 'golf', kind: 'event', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · skins', result: w ? 'W' : 'L', stake: 0, won: cents / 100, pl: cents / 100, units: un, verified, extra: { side: 'skins', skins: un, perSkin: d.extras.skins.amt || 0, team: team ? t.name : undefined, unpaid: w && unpaid ? true : undefined, course: d.course.name, courseId: cid } }); }
        ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((hole) => { const w = d.win[k][hole], sh = SM.side[k + hole]; if (!sh || !(w.who === m.pid || w.who === t.tid)) return; out.push({ src: 'golf', id: 'golf:' + c.id + ':' + k + hole + ':' + m.pid, date, sport: 'golf', kind: 'event', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (k === 'ctp' ? 'closest to the pin' : 'longest drive') + ' #' + hole, result: 'W', stake: 0, won: (sh[m.pid] || 0) / 100, pl: (sh[m.pid] || 0) / 100, verified: true, extra: { side: k, hole: Number(hole), note: w.note, team: w.who === t.tid ? t.name : undefined, unpaid: unpaid ? true : undefined, course: d.course.name, courseId: cid } }); }));
      }
      // A heads-up match is ONE bet between two sides: a team's stake and winnings are split among its players. Money reads like a round's:
      // entry (stake), payout (won = what comes back: 2 x the bet for a win, the bet for a halved match, 0 for a loss), net (pl = won - stake).
      // A Nassau is 3 bets plus every press: stake = one bet (extra.bets = how many), net = the sum of them.
      bd.matches.forEach((x) => { const mine = x.kind === 'player' ? [x.a, x.b].indexOf(m.pid) : t ? [x.a, x.b].indexOf(t.tid) : -1; if (mine < 0) return; const ms = x.m || (x.nassau && x.nassau.total); if (!ms || !ms.done) return;
        const res = ms.res === 'T' ? 'T' : (ms.res === 'W') === (mine === 0) ? 'W' : 'L', sgn = mine === 0 ? 1 : -1, opp = mine === 0 ? x.b : x.a, oppName = x.kind === 'player' ? nm[opp] : (d.teams.find((y) => y.tid === opp) || {}).name;
        const ps = x.kind === 'player' ? [m.pid] : t.players, bets = x.nassau ? 3 + x.nassau.presses.length : 1, cut0 = (dollars) => { const tot = Math.round(Math.abs(dollars) * 100), sh = shareC(tot, ps)[m.pid] || 0; return (dollars < 0 ? -sh : sh) / 100; };
        const stake1 = cut0(x.amt || 0), plM = !x.amt ? 0 : cut0(x.nassau ? sgn * S.nassauMoney(x.nassau, x.amt) : res === 'W' ? x.amt : res === 'L' ? -x.amt : 0), entry = Math.round(stake1 * bets * 100) / 100;
        out.push({ src: 'golf', id: 'golf:' + c.id + ':match:' + x.mid + ':' + m.pid, date, sport: 'golf', kind: 'match', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (x.type === 'nassau' ? 'Nassau' : 'match') + ' vs ' + oppName, result: res, stake: stake1, pl: plM, won: Math.round((entry + plM) * 100) / 100, opponent: oppName, verified: false, extra: Object.assign({ text: ms.text, short: ms.short, type: x.type, courseId: cid, bets, entry, perMatch: x.amt || 0, players: ps.length }, x.nassau ? { front: x.nassau.front.short, back: x.nassau.back.short, presses: x.nassau.presses.map((p) => ({ from: p.from, short: p.m.short })) } : {}) }); });
    } else if (c.pro.game === 'six') {
      let b = null; try { b = await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) {} if (!b || !b.event.done) continue; const date = chiDay(b.event.end || b.event.start || D.now()); if (date < from || date > to) continue;
      const ents = Object.keys(c.pro.entries).filter((p) => c.pro.entries[p].picks && c.pro.entries[p].picks.length === 6).map((p) => Object.assign({ pid: p, name: nm[p] }, c.pro.entries[p])), lead = b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0];
      const rk = S.rankSix(ents, fieldMap(b), c.pro.mc, c.pro.tb, lead ? lead.toPar : null), mine = rk.find((x) => x.pid === m.pid); if (!mine) continue;
      out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':pool:' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + b.event.name, result: null, place: { n: mine.place, of: rk.length }, score: mine.total, toPar: mine.total, verified: true, extra: { game: 'pick six', event: b.event.name, tour: c.pro.tour } }, money(c, payPids(c, rk.map((x) => ({ key: x.pid, place: x.place, pids: [x.pid] })))[m.pid], !!m.paid)));
    } else { // one and done: ONE record per season; place only once the season is over (organizer ended it, or the Central date is past Dec 31 of the season year)
      const O = c.pro.oad, evs = Object.keys(O.events).map((k) => O.events[k]), settled = evs.filter((E) => E.res); if (!settled.length) continue;
      const last = settled.reduce((a, E) => Math.max(a, E.lockAt || 0), 0), over = !!O.ended || chiDay(D.now()) > String(O.season).slice(0, 4) + '-12-31', date = chiDay(over && O.ended ? O.ended : last || D.now()); if (date < from || date > to) continue;
      const tot = {}; c.members.forEach((x) => (tot[x.pid] = 0)); settled.forEach((E) => Object.keys(E.picks).forEach((p) => { tot[p] = (tot[p] || 0) + (E.res[E.picks[p].g] || 0); }));
      const rows = c.members.map((x) => ({ pid: x.pid, v: Math.round(tot[x.pid] * 100) / 100 })).sort((a, b) => b.v - a.v), place = rows.filter((x) => x.v > tot[m.pid]).length + 1;
      const mnO = over ? money(c, payPids(c, rows.map((x) => ({ key: x.pid, place: rows.filter((y) => y.v > x.v).length + 1, pids: [x.pid] })))[m.pid], !!m.paid) : { stake: m.paid ? c.pot.entry || undefined : undefined };
      out.push(Object.assign({ src: 'golf', id: 'golf:' + c.id + ':oad:' + O.season + ':' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · one and done ' + O.season, result: null, place: over ? { n: place, of: rows.length } : undefined, score: Math.round(tot[m.pid] * 100) / 100, verified: true, extra: { game: 'one and done', season: O.season, events: settled.length, picks: settled.filter((E) => E.picks[m.pid]).map((E) => ({ event: E.name, golfer: E.picks[m.pid].n, pts: E.res[E.picks[m.pid].g] || 0 })), scoredBy: settled[settled.length - 1].by, live: !over } }, mnO));
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

module.exports = { calcuttaSource, registerCalcutta, linkCalcutta, handicapFor: (k, o) => D.handicapFor(k, o), pairHistory, HCP_LABEL, HCP_NOTE, handle, attach, attachToGroup, potSummary, golfers, teams, teamsOfRecord, dayPay, statsFor, isGolfBet, limits, coursesOwnedBy, dayBoard, matchState, _deps: D, _mk: mkOf, _reset: () => { RL.clear(); SEEN.clear(); ATT.clear(); ENTC.at = 0; ENTC.keys = {}; } };
