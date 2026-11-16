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
// oddHcp(accountKey): the player's unofficial Oddable handicap from the stats module (plugged in by the stats coder), used only to PREFILL; null = unknown.
const D = { S: require('./sync'), acct: () => require('./acct'), now: () => Date.now(), ip: (req) => require('./ip').clientIp(req), feed: F, courses: CO, oddHcp: async () => null, ownerOk: (req) => require('./acct').ownerOk(req) };
const ROW = (id) => 'lock:golf:' + id, IDX = 'lock:golf:idx', CRS = 'lock:golf:courses', ENT = 'lock:ent';
const DAY = 864e5;
const PRICE = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'; // shared text (OWNER-DECISIONS, Limits and pricing)
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const bad = (status, error, extra) => Object.assign(new Error(error), { status, extra });
const body = (req) => new Promise((ok, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 40000) c.push(d); }); req.on('end', () => { if (n > 40000) return no(bad(413, 'Too big')); try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(bad(400, 'Bad request')); } }); req.on('error', no); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const clean = (n, max) => String(n == null ? '' : n).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 24);
const chiDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const okDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += ALPH[b[i] % 32]; return s; };
const normCode = (c) => { const x = String(c || '').toUpperCase().replace(/^GOLF\./, '').replace(/[^A-Z0-9]/g, ''); return x.length === 10 ? x : ''; }; // 10 chars of 32 = 50 random bits
const sameCode = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const mkOf = (e) => crypto.createHash('sha256').update('oddable-golf|' + e).digest('hex').slice(0, 24);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// ---------- people cap (owner Nov 16 2026: standard accounts top out at 8 people, organizer included; enterprise lifts it) ----------
// STAND-IN with the same name/signature as Groups' limits.maxPeople(accountKey). The manager swaps this for the Groups export at merge.
const ENTC = { at: 0, keys: {} };
const limits = {
  maxPeople: async (accountKey, groupOrGameId) => { // eslint-disable-line no-unused-vars
    if (D.now() - ENTC.at > 60e3) { try { const r = await D.S.dbGet(ENT); ENTC.keys = (r && r.data && r.data.keys) || {}; } catch (e) {} ENTC.at = D.now(); } return ENTC.keys[accountKey] ? 400 : 8; },
};

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
const memberOf = (c, mk) => c.members.find((m) => m.mk === mk);
const isOrg = (c, mk) => c.org === mk;
const newPid = (c) => { let p; do { p = rnd(6); } while (c.members.some((m) => m.pid === p)); return p; };

// ---------- validation ----------
function cleanPot(p) {
  p = p || {}; const entry = num(p.entry || 0, 0, 10000); if (entry == null || Math.round(entry) !== entry) throw bad(400, 'Entry must be a whole dollar amount from 0 to 10,000');
  const k = ['none', 'pct', 'flat'].includes(p.take && p.take.kind) ? p.take.kind : 'none'; let v = 0;
  if (k === 'pct') { v = num(p.take.v, 0, 50); if (v == null || !Number.isInteger(v)) throw bad(400, "Organizer's take: a whole percent from 0 to 50"); }
  if (k === 'flat') { v = num(p.take.v, 0, 1e6); if (v == null) throw bad(400, "Organizer's take: a dollar amount, not negative"); }
  return { entry, take: { kind: k, v }, pot: p.pot === 'side' ? 'side' : 'main' };
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
  if (c.city) o.city = clean(c.city, 40);
  return o;
}
function cleanDay(b, prev) {
  const fmt = String(b.fmt || ''); if (!S.FORMATS[fmt]) throw bad(400, 'Pick a format'); const F0 = S.FORMATS[fmt];
  const net = ['gross', 'net', 'both'].includes(b.net) ? b.net : 'net';
  const allow = (Array.isArray(b.allow) ? b.allow : F0.allow || []).slice(0, 4).map((x) => num(x, 0, 100)); if (allow.some((x) => x == null)) throw bad(400, 'Allowances are percents from 0 to 100');
  const pct = num(b.pct == null ? (F0.pct || 100) : b.pct, 0, 100); if (pct == null) throw bad(400, 'Handicap percent 0 to 100');
  const count = fmt === 'shamble' || fmt === 'bestball' ? (num(b.count, 1, 2) || F0.count) : null;
  const drives = fmt === 'texas' ? num(b.drives == null ? F0.drives : b.drives, 1, 9) : null; if (fmt === 'texas' && drives == null) throw bad(400, 'Drives per player: 1 to 9');
  const date = okDay(b.date) ? b.date : chiDay(D.now());
  const ex = b.extras || {}, holesN = (prev && prev.course && prev.course.holes) || 18, hl = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((h) => Number.isInteger(h) && h >= 1 && h <= holesN))].slice(0, 6);
  const extras = { skins: { on: !!(ex.skins && ex.skins.on), net: !!(ex.skins && ex.skins.net), amt: num((ex.skins && ex.skins.amt) || 0, 0, 10000) || 0 }, ctp: hl(ex.ctp), ld: hl(ex.ld), ctpAmt: num(ex.ctpAmt || 0, 0, 10000) || 0, ldAmt: num(ex.ldAmt || 0, 0, 10000) || 0 };
  const hu = b.hu || {}, heads = { on: !!hu.on, pair: ['bracket', 'foursome', 'pick', 'random'].includes(hu.pair) ? hu.pair : 'pick', kind: hu.kind === 'player' ? 'player' : 'team', type: hu.type === 'nassau' ? 'nassau' : 'match', amt: num(hu.amt || 0, 0, 10000) || 0, auto: num(hu.auto || 0, 0, 4) || 0, offLow: hu.offLow !== false };
  return { fmt, net, allow, pct, count, drives, date, extras, heads, teamSize: Math.max(F0.size[0], Math.min(F0.size[1], num(b.teamSize, 1, 4) || F0.size[1])) };
}

// ---------- invite code + index ----------
async function newCodeFor(id, mk) { return mutIdx((d) => { let code; do { code = rnd(10); } while (d.codes[code]); d.codes[code] = id; d.mine[mk] = (d.mine[mk] || []).concat(id).slice(-200); return code; }); }
async function addMine(mk, id) { await mutIdx((d) => { const a = d.mine[mk] || []; if (a.includes(id)) return { nochange: true }; d.mine[mk] = a.concat(id).slice(-200); return {}; }); }
async function byCode(code, k) { const c = normCode(code); if (!c) { fail(k); throw bad(404, 'No golf game with that code'); } const r = await D.S.dbGet(IDX); const codes = (r && r.data && r.data.codes) || {}; let id = null; Object.keys(codes).forEach((x) => { if (sameCode(x, c)) id = codes[x]; }); if (!id) { fail(k); throw bad(404, 'No golf game with that code'); } return getC(id); }

// ---------- pro: feed + tiers ----------
async function boardOf(c) { try { return await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) { return null; } }
function fieldMap(b) { const m = {}; (b ? b.golfers : []).forEach((g) => (m[g.id] = g)); return m; }
function buildTiers(b, rank) { // order = the organizer's ranking list (names, one per line) first, the rest in feed order. No odds are used (they would cost Odds API credits).
  const gs = b.golfers.slice(), key = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
  const pos = {}; (rank || []).forEach((n, i) => { const k = key(n); if (k && pos[k] == null) pos[k] = i; });
  gs.sort((x, y) => (pos[key(x.name)] ?? 1e6) - (pos[key(y.name)] ?? 1e6) || x.sort - y.sort);
  return S.tiers(gs.map((g) => g.id));
}
const lockAt = (c, b) => (b && (b.firstTee || b.event.start)) || c.pro.lockAt || null;

// ---------- golf day: computed board ----------
function dayCtx(c) { const d = c.day, hcp = {}; c.members.forEach((m) => (hcp[m.pid] = S.playHcp(d.hcp[m.pid] || 0, d.pct))); return { fmt: d.fmt, course: d.course, hcp, count: d.count }; }
function teamCtx(c, t, net) { const d = c.day, x = dayCtx(c); x.net = net; x.thcp = S.teamHcp(t.players.map((p) => d.hcp[p] || 0), d.allow); return x; }
function holesOf(c, tid) { const h = {}, s = (c.day.scores[tid] || {}); Object.keys(s).forEach((k) => (h[k] = s[k])); return h; }
function dayBoard(c) {
  const d = c.day, n = d.course.par.length, by = d.net === 'gross' ? 'gross' : 'net', st = d.fmt === 'stableford';
  const rows = d.teams.filter((t) => t.players.length).map((t) => { const rN = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, true)), rG = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, false));
    const sc = d.scores[t.tid] || {}, disp = Object.keys(sc).filter((h) => sc[h].st === 'disputed').map(Number), conf = Object.keys(sc).filter((h) => sc[h].st === 'confirmed').length;
    const r = { tid: t.tid, name: t.name, thru: rN.thru, gross: rG.gross, net: rN.net, toParG: rG.toParG, toParN: rN.toParN, pts: rN.pts, ptsG: rG.pts, thcp: S.FORMATS[d.fmt].ball === 'team' ? S.teamHcp(t.players.map((p) => d.hcp[p] || 0), d.allow) : null, disputed: disp, confirmed: conf, of: Object.keys(sc).length };
    if (d.fmt === 'texas') r.drives = S.texasDrives(t.players, Object.keys(sc).sort((a, b) => a - b).map((h) => sc[h].drive).filter(Boolean), d.drives, n);
    return r; });
  const key = (r) => (st ? -(by === 'net' ? r.pts : r.ptsG) : by === 'net' ? r.toParN : r.toParG);
  rows.sort((a, b) => (b.thru > 0) - (a.thru > 0) || key(a) - key(b) || a.name.localeCompare(b.name));
  let p = 0; rows.forEach((r, i) => { if (!i || key(rows[i - 1]) !== key(r) || (rows[i - 1].thru > 0) !== (r.thru > 0)) p = i + 1; r.place = r.thru ? p : null; });
  const out = { rows, by, holes: n };
  if (d.net === 'both') { const g = rows.map((r) => ({ tid: r.tid, v: st ? -r.ptsG : r.toParG, thru: r.thru })).sort((a, b) => (b.thru > 0) - (a.thru > 0) || a.v - b.v); out.gross = g.map((x) => x.tid); }
  // skins (per team for team-ball formats, per player otherwise)
  if (d.extras.skins.on || d.fmt === 'skins') {
    const net = d.fmt === 'skins' ? d.net !== 'gross' : d.extras.skins.net, ents = [];
    if (S.FORMATS[d.fmt].ball === 'team') d.teams.filter((t) => t.players.length).forEach((t) => { const r = S.teamRound(t, holesOf(c, t.tid), teamCtx(c, t, net)); ents.push({ id: t.tid, s: r.per.map((x) => (x ? (net ? x.net : x.gross) : null)) }); });
    else { const x = dayCtx(c); d.teams.forEach((t) => t.players.forEach((pid) => { const h = holesOf(c, t.tid); ents.push({ id: pid, s: d.course.par.map((_, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[pid]); return g >= 1 ? g - (net ? S.strokesOn(x.hcp[pid] || 0, d.course.hcp[i], n) : 0) : null; }) }); })); }
    out.skins = Object.assign(S.skins(ents, n), { net });
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
function sideHcp(c, m, side) { const d = c.day, id = m[side]; if (m.kind === 'player') return S.playHcp(d.hcp[id] || 0, d.pct); const t = d.teams.find((x) => x.tid === id); if (!t) return 0; return S.FORMATS[d.fmt].ball === 'team' ? Math.round(S.teamHcp(t.players.map((p) => d.hcp[p] || 0), d.allow)) : Math.round(t.players.reduce((a, p) => a + S.playHcp(d.hcp[p] || 0, d.pct), 0) / Math.max(1, t.players.length)); }
function matchState(c, m) {
  const d = c.day, n = d.course.par.length; let a = sideScores(c, m, 'a'), b = sideScores(c, m, 'b');
  if (m.net) { let ha = sideHcp(c, m, 'a'), hb = sideHcp(c, m, 'b'); if (m.offLow !== false) { const lo = Math.min(ha, hb); ha -= lo; hb -= lo; } a = a.map((v, i) => (v == null ? null : v - S.strokesOn(ha, d.course.hcp[i], n))); b = b.map((v, i) => (v == null ? null : v - S.strokesOn(hb, d.course.hcp[i], n))); }
  const o = { mid: m.mid, kind: m.kind, type: m.type, a: m.a, b: m.b, amt: m.amt, net: !!m.net, round: m.round || null };
  if (m.type === 'nassau' && n === 18) o.nassau = S.nassau(a, b, m.presses, m.auto); else o.m = S.match(a, b, 0, n);
  return o;
}

// ---------- views ----------
function nameMap(c) { const m = {}; c.members.forEach((x) => (m[x.pid] = x.name)); return m; }
function pub(c) { return { id: c.id, kind: c.kind, title: c.title, pot: c.pot, orgName: (c.members.find((m) => m.mk === c.org) || {}).name || '', count: c.members.length, max: c.max, groupId: c.groupId || null, courseId: c.courseId || null, created: c.created,
  pro: c.pro ? { tour: c.pro.tour, eventId: c.pro.eventId, eventName: c.pro.eventName, game: c.pro.game, mc: c.pro.mc, tb: c.pro.tb, lockAt: c.pro.lockAt } : null,
  day: c.day ? { course: c.day.course, fmt: c.day.fmt, net: c.day.net, allow: c.day.allow, pct: c.day.pct, count: c.day.count, drives: c.day.drives, date: c.day.date, extras: c.day.extras, heads: c.day.heads, teamSize: c.day.teamSize, status: c.day.status, open: c.day.teams.filter((t) => t.players.length < t.slots).map((t) => ({ tid: t.tid, name: t.name, free: t.slots - t.players.length })) } : null }; }
async function full(c, u) {
  const o = pub(c), me0 = memberOf(c, u.mk), now = D.now(); o.role = isOrg(c, u.mk) ? 'org' : me0 ? 'member' : 'none'; o.me = me0 ? me0.pid : null; o.code = me0 ? c.code : undefined;
  o.members = c.members.map((m) => ({ pid: m.pid, name: m.name, org: m.mk === c.org, paid: !!m.paid, guest: !!m.guest }));
  if (c.kind === 'pro') {
    const b = await boardOf(c), fm = fieldMap(b), la = lockAt(c, b), locked = la ? now >= la : false; o.pro.lockAt = la; o.pro.locked = locked;
    o.feed = b ? { ok: true, event: b.event, earnings: b.earnings } : { ok: false };
    o.golfers = b ? b.golfers.map((g) => ({ id: g.id, name: g.name, pos: g.pos, toPar: g.toPar, today: g.today, thru: g.thru, st: g.st, tee: g.tee, started: g.started, r: g.rounds })) : [];
    if (c.pro.game === 'six') {
      const tiers = c.pro.tiers || (b && b.golfers.length >= 12 ? buildTiers(b, c.pro.rank) : null); o.tiers = tiers;
      const ents = Object.keys(c.pro.entries).map((pid) => Object.assign({ pid, name: (c.members.find((m) => m.pid === pid) || {}).name || 'Player' }, c.pro.entries[pid]));
      const lead = b ? b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0] : null;
      const ranked = b ? S.rankSix(ents.filter((e) => e.picks && e.picks.length === 6), fm, c.pro.mc, c.pro.tb, b.event.done && lead ? lead.toPar : null) : [];
      o.entries = ranked.map((r) => { const mine = r.pid === o.me, show = mine || locked; return { pid: r.pid, name: r.name, place: r.place, total: r.total, n: r.n, alive: r.alive, today: show ? r.per.filter((x) => r.counting.includes(x.id)).reduce((a, x) => a + ((fm[x.id] && fm[x.id].today) || 0), 0) : null, picks: show ? r.picks : null, counting: show ? r.counting : null, per: show ? r.per.map((x) => ({ id: x.id, v: x.r ? x.r.v : null, mc: !!(x.r && x.r.mc), wd0: !!(x.r && x.r.wd0) })) : null, guess: show ? r.guess : null, swap: show ? r.swap || null : null }; });
      o.waiting = ents.filter((e) => !(e.picks && e.picks.length === 6)).map((e) => ({ pid: e.pid, name: e.name }));
      const mine = c.pro.entries[o.me]; o.mine = mine ? { picks: mine.picks, guess: mine.guess, swap: mine.swap || null } : null;
      if (!locked) o.entries.forEach((e) => { if (e.pid !== o.me) { e.total = null; e.place = null; } });
    } else {
      const oad = c.pro.oad; o.oad = { season: oad.season, events: Object.keys(oad.events).map((ev) => { const E = oad.events[ev], lk = E.lockAt && now >= E.lockAt; return { id: ev, name: E.name, lockAt: E.lockAt, locked: !!lk, res: E.res || null, by: E.by || null, picks: Object.keys(E.picks).filter((p) => lk || p === o.me).map((p) => ({ pid: p, golfer: E.picks[p].g, name: E.picks[p].n, pts: E.res ? (E.res[E.picks[p].g] || 0) : null })) }; }), used: (oad.used[o.me] || []) };
      const tot = {}; c.members.forEach((m) => (tot[m.pid] = 0)); Object.values(oad.events).forEach((E) => { if (!E.res) return; Object.keys(E.picks).forEach((p) => { tot[p] = (tot[p] || 0) + (E.res[E.picks[p].g] || 0); }); });
      o.table = c.members.map((m) => ({ pid: m.pid, name: m.name, total: Math.round(tot[m.pid] * 100) / 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)); o.table.forEach((r, i, a) => (r.place = i && a[i - 1].total === r.total ? a[i - 1].place : i + 1));
    }
  } else {
    const d = c.day; o.day.teams = d.teams.map((t) => ({ tid: t.tid, name: t.name, slots: t.slots, players: t.players.map((p) => ({ pid: p, name: nameMap(c)[p] || 'Player', hcp: d.hcp[p] == null ? null : d.hcp[p] })), scorer: t.scorer }));
    o.day.hcp = d.hcp; o.day.hsrc = d.hsrc || {}; o.day.solo = !!d.solo; o.day.unassigned = c.members.filter((m) => !d.teams.some((t) => t.players.includes(m.pid))).map((m) => ({ pid: m.pid, name: m.name }));
    o.day.matches = d.matches; o.day.win = d.win;
    o.day.scores = d.scores; o.board = dayBoard(c); o.day.audit = d.audit.slice(-60).reverse();
    const myT = d.teams.find((t) => t.players.includes(o.me)); o.day.myTeam = myT ? myT.tid : null; o.day.iScore = d.teams.filter((t) => t.scorer === o.me).map((t) => t.tid);
  }
  return o;
}

// ---------- saved courses ----------
// Dedupe by name + tees. A user's own entry can be edited until a round uses it. Courses picked from OpenGolfAPI are stored when SELECTED (no bulk copy).
async function saveCourse(c, by, quiet) {
  const key = (c.name + '|' + c.tees).toLowerCase().replace(/[^a-z0-9|]/g, ''), now = D.now(), x = Object.assign({}, c); delete x.id;
  return mutateRow(CRS, () => ({ courses: {} }), (d) => { d.courses = d.courses || {}; const hit = Object.entries(d.courses).find(([, y]) => y.key === key);
    if (hit) { const [id, y] = hit; if (quiet || y.by !== by) return { nochange: true, v: { id, dup: true } }; if (y.used) throw bad(409, 'This course has been used in a round. Save it under a different tees name.'); d.courses[id] = Object.assign(x, { key, by, used: 0, at: y.at || now }); return { id }; }
    if (Object.keys(d.courses).length >= 3000) { if (quiet) return { nochange: true, v: null }; throw bad(503, 'Course list is full'); } let id; do { id = rnd(8); } while (d.courses[id]); d.courses[id] = Object.assign(x, { key, by, used: 0, at: now }); return { id }; });
}
async function hcpOf(accountKey) { try { const h = await D.oddHcp(accountKey); return Number.isFinite(Number(h)) && h !== null ? Math.round(Number(h) * 10) / 10 : null; } catch (e) { return null; } }

// ---------- create ----------
async function create(u, b, ip) {
  rate('create', u.mk, ip); const now = D.now(), kind = b.kind === 'day' ? 'day' : b.kind === 'pro' ? 'pro' : null; if (!kind) throw bad(400, 'Pick Pro tournament or Our golf day');
  const title = clean(b.title, 40); if (title.length < 2) throw bad(400, 'Give it a name (2+ characters)');
  let id; do { id = rnd(10); } while (await D.S.dbGet(ROW(id)));
  const c = { id, kind, title, org: u.mk, orgE: u.e, created: now, pot: cleanPot(b.pot), groupId: b.groupId ? clean(b.groupId, 20) : null, members: [], max: await limits.maxPeople(u.e, id) };
  c.members.push({ pid: newPid(c), mk: u.mk, name: nameFor(u, b.myName), joined: now, paid: false });
  if (kind === 'pro') {
    const P = b.pro || {}, tour = F.TOURS[P.tour] ? P.tour : null; if (!tour) throw bad(400, 'Pick a tour');
    const game = P.game === 'oad' ? 'oad' : P.game === 'six' ? 'six' : null; if (!game) throw bad(400, 'Pick a game');
    c.pro = { tour, game, mc: ['w1', 'p10', 'out'].includes(P.mc) ? P.mc : 'w1', tb: P.tb === 'best' ? 'best' : 'score', rank: (Array.isArray(P.rank) ? P.rank : String(P.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200), entries: {}, oad: { season: clean(P.season || String(new Date(now).getUTCFullYear()), 8), events: {}, used: {} } };
    if (game === 'six') {
      const ev = clean(P.eventId, 20); if (!ev) throw bad(400, 'Pick a tournament'); let bd = null; try { bd = await D.feed.board(tour, ev); } catch (e) {}
      if (!bd) throw bad(503, 'Could not read the tour leaderboard. Try again in a minute.');
      const la = lockAt({ pro: {} }, bd); if (!la || la <= now) throw bad(409, 'Picks for that tournament are already locked (first tee time has passed)');
      Object.assign(c.pro, { eventId: ev, eventName: bd.event.name, start: bd.event.start, lockAt: la, tiers: bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null });
    }
  } else {
    let course; if (b.courseId) { const r = await D.S.dbGet(CRS), cc = r && r.data && r.data.courses && r.data.courses[String(b.courseId)]; if (!cc) throw bad(404, 'Course not found'); course = cleanCourse(cc); course.id = String(b.courseId); } else course = cleanCourse(b.course);
    c.day = Object.assign(cleanDay(b.day || {}, { course }), { course, teams: [], hcp: {}, matches: [], win: { ctp: {}, ld: {} }, scores: {}, audit: [], eids: [], status: 'setup' });
    const oh = await hcpOf(u.e); const myH = num((b.day || {}).myHcp, -10, 54); c.day.hcp[c.members[0].pid] = myH ?? oh ?? 0; c.day.hsrc = { [c.members[0].pid]: myH != null ? 'typed' : oh != null ? 'oddable' : 'none' };
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
  return c;
}

// ---------- golf day: score entry ----------
function canScore(c, mk, tid) { const me0 = memberOf(c, mk); const t = c.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); return { t, ok: isOrg(c, mk) || (me0 && t.scorer === me0.pid), me0 }; }
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
      let api = { ok: false, results: [] }; if (q.length >= 3 || b.state || b.near) { try { api = { ok: true, results: await D.courses.search(q, clean(b.state, 4), clean(b.near, 40)), attribution: CO.ATTR }; } catch (e) { api = { ok: false, results: [], error: 'Course search is not available right now. Pick a saved course or type one in.' }; } }
      let owned = []; try { owned = await coursesOwnedBy(u.e); } catch (e) {} // a golf course / club account sees its own course(s) first
      send(res, 200, { courses: saved, owned, api }); return true; }
    if (op === 'coursedetail') { rate('read', u.mk, ip); let c; try { c = await D.courses.detail(String(b.extId || '')); } catch (e) { throw bad(503, 'Could not load that course. Type it in instead.'); } send(res, 200, { course: c }); return true; }
    if (op === 'course') { rate('write', u.mk, ip); const c = cleanCourse(b.course); const out = await saveCourse(c, u.mk, false); send(res, 200, out || {}); return true; }
    if (op === 'mine') { rate('read', u.mk, ip); const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[u.mk] || [], out = []; for (const id of ids.slice(-30).reverse()) { try { const c = await getC(id); if (memberOf(c, u.mk)) out.push(Object.assign(pub(c), { role: isOrg(c, u.mk) ? 'org' : 'member' })); } catch (e) {} } send(res, 200, { games: out }); return true; }
    if (op === 'create') { const c = await create(u, b, ip); send(res, 200, { game: await full(c, u) }); return true; }
    if (op === 'look' || op === 'join') { // signed-in look-up by code (rules, entry/take, main/side, open team slots) and join
      if (fails('a|' + u.mk) >= 10 || fails('i|' + ip) >= 10) throw bad(429, 'Too many wrong codes. Wait 15 minutes.'); rate('code', u.mk, ip);
      let c; try { c = await byCode(b.code, 'a|' + u.mk); } catch (e) { fail('i|' + ip); throw e; }
      if (op === 'look') { send(res, 200, { game: memberOf(c, u.mk) ? await full(c, u) : Object.assign(pub(c), { role: 'none' }) }); return true; }
      const max = await limits.maxPeople(c.orgE, c.id); const tid = b.tid ? String(b.tid) : null;
      const g = await mutC(c.id, (d) => { let m = memberOf(d, u.mk);
        if (!m) { if (d.members.length >= Math.max(max, 0)) throw bad(409, 'This game is full (up to ' + max + ' golfers). ' + PRICE); if (d.kind === 'day' && d.day.status === 'final') throw bad(409, 'This golf day is over'); m = { pid: newPid(d), mk: u.mk, name: nameFor(u, b.myName), joined: now, paid: false }; d.members.push(m); if (d.kind === 'day') d.day.hcp[m.pid] = num(b.hcp, -10, 54) ?? 0; }
        else if (!tid) return { nochange: true, v: d };
        if (tid && d.kind === 'day') { const t = d.day.teams.find((x) => x.tid === tid); if (!t) throw bad(404, 'No such team'); if (!t.players.includes(m.pid)) { if (t.players.length >= t.slots) throw bad(409, 'That team is full'); if (d.day.status !== 'setup') throw bad(409, 'Teams are set: the round has started'); d.day.teams.forEach((x) => (x.players = x.players.filter((p) => p !== m.pid))); t.players.push(m.pid); if (!t.scorer) t.scorer = m.pid; } }
        d.u = now; return d; });
      await addMine(u.mk, c.id); send(res, 200, { game: await full(g, u) }); return true;
    }
    // ----- everything below needs an id and membership -----
    let c = await getC(b.id); const mem = memberOf(c, u.mk), org = isOrg(c, u.mk);
    if (!mem) throw bad(404, 'Golf game not found');
    if (op === 'get') { rate('read', u.mk, ip); if (c.kind === 'pro' && c.pro.game === 'oad') c = await oadSettle(c); send(res, 200, { game: await full(c, u), now }); return true; }
    if (op === 'leave') { await mutC(c.id, (d) => { if (isOrg(d, u.mk)) throw bad(409, 'The organizer cannot leave'); if (d.kind === 'day' && d.day.status !== 'setup') throw bad(409, 'The round has started'); if (d.kind === 'pro' && d.pro.game === 'six' && d.pro.lockAt && now >= d.pro.lockAt) throw bad(409, 'Picks are locked'); const p = memberOf(d, u.mk).pid; d.members = d.members.filter((m) => m.mk !== u.mk); if (d.day) d.day.teams.forEach((t) => { t.players = t.players.filter((x) => x !== p); if (t.scorer === p) t.scorer = t.players[0] || null; }); if (d.pro) delete d.pro.entries[p]; d.u = now; return {}; }); send(res, 200, { ok: true }); return true; }
    if (op === 'paid') { if (!org) throw bad(403, 'Only the organizer marks entries paid'); const g = await mutC(c.id, (d) => { const m = d.members.find((x) => x.pid === String(b.pid)); if (!m) throw bad(404, 'Not a member'); m.paid = !!b.paid; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; }
    if (op === 'attach') { if (!org) throw bad(403, 'Only the organizer can attach this to a group'); const gid = clean(b.groupId, 20); if (!gid) throw bad(400, 'Which group?'); const g = await mutC(c.id, (d) => { d.groupId = gid; d.contestId = clean(b.contestId, 20) || null; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true; }
    if (c.kind === 'pro') {
      rate('write', u.mk, ip);
      if (op === 'tiers') { // organizer: rebuild the six tiers from a ranking list (before picks lock)
        if (!org) throw bad(403, 'Only the organizer sets the tiers'); const bd = await boardOf(c); if (!bd || bd.golfers.length < 12) throw bad(503, 'The field is not posted yet');
        if (now >= lockAt(c, bd)) throw bad(409, 'Picks are locked'); if (Object.values(c.pro.entries).some((e) => e.picks && e.picks.length)) throw bad(409, 'Someone already picked. Tiers are fixed now.');
        const rank = (Array.isArray(b.rank) ? b.rank : String(b.rank || '').split(/\n/)).map((x) => clean(x, 50)).filter(Boolean).slice(0, 200);
        const g = await mutC(c.id, (d) => { d.pro.rank = rank; d.pro.tiers = buildTiers(bd, rank); d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'pick' && c.pro.game === 'six') {
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard to check the lock. Try again in a minute.'); // fail closed
        const la = lockAt(c, bd); if (!la || now >= la) throw bad(409, 'Picks locked at the first tee time');
        const tiers = c.pro.tiers || (bd.golfers.length >= 12 ? buildTiers(bd, c.pro.rank) : null); if (!tiers) throw bad(409, 'The field is not posted yet');
        const picks = (Array.isArray(b.picks) ? b.picks : []).map(String); if (picks.length !== 6) throw bad(400, 'Pick one golfer from each of the six tiers');
        picks.forEach((id, i) => { if (!tiers[i].includes(id)) throw bad(400, 'Tier ' + (i + 1) + ': that golfer is not in this tier'); });
        const guess = c.pro.tb === 'score' ? num(b.guess, -40, 40) : null; if (c.pro.tb === 'score' && (guess == null || !Number.isInteger(guess))) throw bad(400, 'Tiebreaker: guess the winning score to par (e.g. -15)');
        const g = await mutC(c.id, (d) => { if (!d.pro.tiers) d.pro.tiers = tiers; d.pro.lockAt = la; d.pro.entries[mem.pid] = { picks, guess, swap: null, at: now }; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'swap' && c.pro.game === 'six') { // one free swap for a golfer who withdrew before teeing off
        const bd = await boardOf(c); if (!bd) throw bad(503, 'Could not read the leaderboard. Try again in a minute.'); const fm = fieldMap(bd), e = c.pro.entries[mem.pid];
        if (!e || !e.picks) throw bad(404, 'No picks to swap'); if (e.swap) throw bad(409, 'You already used your one swap');
        const i = e.picks.indexOf(String(b.from)), f = fm[String(b.from)], t = fm[String(b.to)]; if (i < 0 || !f) throw bad(400, 'Pick the golfer to replace');
        if (!(f.st === 'wd' && !f.started)) throw bad(409, 'Swaps are only for a golfer who withdrew before teeing off');
        if (!t || !c.pro.tiers[i].includes(t.id) || t.st !== 'active' || t.started || (t.tee && now >= t.tee) || e.picks.includes(t.id)) throw bad(400, 'The new golfer must be from the same tier and not have teed off yet');
        const g = await mutC(c.id, (d) => { const x = d.pro.entries[mem.pid]; if (x.swap) throw bad(409, 'You already used your one swap'); x.picks[i] = t.id; x.swap = { from: f.id, to: t.id, at: now }; d.u = now; return d; }); send(res, 200, { game: await full(g, u) }); return true;
      }
      if (op === 'pick' && c.pro.game === 'oad') {
        const ev = clean(b.event, 20); let bd = null; try { bd = await D.feed.board(c.pro.tour, ev); } catch (e) {} if (!bd) throw bad(503, 'Could not read that tournament. Try again in a minute.');
        const la = lockAt({ pro: {} }, bd); if (!la || now >= la) throw bad(409, 'Picks for this tournament locked at its first tee time');
        const gf = bd.golfers.find((x) => x.id === String(b.golfer)); if (!gf || gf.st !== 'active') throw bad(400, 'Pick a golfer in the field');
        const g = await mutC(c.id, (d) => { const O = d.pro.oad, E = O.events[ev] = O.events[ev] || { name: bd.event.name, lockAt: la, picks: {} }; E.lockAt = la;
          const used = (O.used[mem.pid] || []).filter((x) => !(E.picks[mem.pid] && E.picks[mem.pid].g === x)); if (used.includes(gf.id)) throw bad(409, 'You already used ' + gf.name + ' this season. One and done: never the same golfer twice.');
          E.picks[mem.pid] = { g: gf.id, n: gf.name, at: now }; O.used[mem.pid] = used.concat(gf.id); d.u = now; return d; });
        send(res, 200, { game: await full(g, u) }); return true;
      }
      throw bad(404, 'not found');
    }
    // ----- golf day -----
    const d0 = c.day;
    if (op === 'setup') { // organizer, before the round starts: format, net, allowances, extras, heads-up options
      if (!org) throw bad(403, 'Only the organizer changes the setup'); if (d0.status !== 'setup') throw bad(409, 'The round has started; setup is locked');
      const x = cleanDay(Object.assign({}, pub(c).day, b.day || {}), d0); const g = await mutC(c.id, (d) => { Object.assign(d.day, x); if (b.course) d.day.course = cleanCourse(b.course); d.day.teams.forEach((t) => (t.slots = Math.max(t.players.length, Math.min(4, num(t.slots, 1, 4) || d.day.teamSize)))); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'team') { // organizer: add / rename / remove a team, set slots, assign a player, set the scorer, set a handicap
      rate('write', u.mk, ip); const a = String(b.op || ''); let guest = null; const maxP = a === 'guest' ? await limits.maxPeople(c.orgE, c.id) : 0;
      if (a === 'guest') guest = { gid: rnd(10), token: crypto.randomBytes(16).toString('hex') }; // claim token shown once to the organizer; only its hash is stored
      const g = await mutC(c.id, (d) => { const D2 = d.day; const T = (id) => { const t = D2.teams.find((x) => x.tid === String(id)); if (!t) throw bad(404, 'No such team'); return t; };
        if (a === 'hcp') { const p = String(b.pid); if (!d.members.some((m) => m.pid === p)) throw bad(404, 'Not a member'); if (!isOrg(d, u.mk) && p !== mem.pid) throw bad(403, 'Only the organizer sets other players\' handicaps'); if (D2.status !== 'setup') throw bad(409, 'Handicaps lock when the round starts'); const h = num(b.hcp, -10, 54); if (h == null) throw bad(400, 'Handicap -10 to 54'); D2.hcp[p] = Math.round(h * 10) / 10; d.u = now; return d; }
        if (a === 'scorer') { const t = T(b.tid); if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer picks scorers'); if (!t.players.includes(String(b.pid))) throw bad(400, 'The scorer must be on the team'); t.scorer = String(b.pid); d.u = now; return d; }
        if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer changes teams'); if (D2.status !== 'setup') throw bad(409, 'Teams are set: the round has started');
        if (a === 'guest') { // a player typed in by name, without an Oddable account (claimable later through the stats module's claim flow)
          if (d.members.length >= maxP) throw bad(409, 'Up to ' + maxP + ' golfers. ' + PRICE); const nm = clean(b.name, 24); if (nm.length < 2) throw bad(400, 'Guest name (2+ characters)');
          const m = { pid: newPid(d), mk: null, guest: true, gid: guest.gid, tok: crypto.createHash('sha256').update(guest.token).digest('hex'), name: nm, joined: now, paid: false }; d.members.push(m); D2.hcp[m.pid] = num(b.hcp, -10, 54) ?? 0;
          if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(m.pid); if (!t.scorer) t.scorer = d.members.find((x) => x.mk === d.org).pid; }
          guest.pid = m.pid; d.u = now; return d; }
        if (a === 'add') { if (D2.teams.length >= 100) throw bad(409, 'Too many teams'); let n = D2.teams.length + 1; while (D2.teams.some((x) => x.tid === 'T' + n)) n++; D2.teams.push({ tid: 'T' + n, name: clean(b.name, 24) || 'Team ' + n, slots: Math.max(1, Math.min(4, num(b.slots, 1, 4) || D2.teamSize)), players: [], scorer: null }); }
        else if (a === 'rename') { const t = T(b.tid); t.name = clean(b.name, 24) || t.name; if (b.slots != null) t.slots = Math.max(t.players.length, Math.min(4, num(b.slots, 1, 4) || t.slots)); }
        else if (a === 'remove') { const t = T(b.tid); D2.teams = D2.teams.filter((x) => x !== t); D2.matches = D2.matches.filter((m) => m.kind !== 'team' || (m.a !== t.tid && m.b !== t.tid)); }
        else if (a === 'assign') { const p = String(b.pid); if (!d.members.some((m) => m.pid === p)) throw bad(404, 'Not a member'); D2.teams.forEach((x) => { x.players = x.players.filter((y) => y !== p); if (x.scorer === p) x.scorer = x.players[0] || null; }); if (b.tid) { const t = T(b.tid); if (t.players.length >= t.slots) throw bad(409, 'That team is full'); t.players.push(p); if (!t.scorer) t.scorer = p; } }
        else throw bad(400, 'Unknown team change');
        d.u = now; return d; });
      if (guest) await mutIdx((x) => { x.mine['g:' + guest.gid] = [c.id]; return {}; });
      send(res, 200, Object.assign({ game: await full(g, u) }, guest ? { guest } : {})); return true;
    }
    if (op === 'match') { // organizer: add / remove / draw heads-up matches; scorer of either side or organizer: press (Nassau)
      rate('write', u.mk, ip); const a = String(b.op || '');
      const g = await mutC(c.id, (d) => { const D2 = d.day, H = D2.heads;
        if (a === 'press') { const m = D2.matches.find((x) => x.mid === String(b.mid)); if (!m || m.type !== 'nassau') throw bad(404, 'No such Nassau'); const sides = m.kind === 'team' ? [m.a, m.b] : D2.teams.filter((t) => t.players.includes(m.a) || t.players.includes(m.b)).map((t) => t.tid); if (!isOrg(d, u.mk) && !D2.teams.some((t) => sides.includes(t.tid) && t.scorer === mem.pid)) throw bad(403, 'Only a scorer in this match or the organizer adds a press'); const from = num(b.from, 1, 18), nine = from <= 9 ? 'front' : 'back'; if (!Number.isInteger(from)) throw bad(400, 'Press from which hole?'); if ((m.presses || []).length >= 8) throw bad(409, 'Too many presses'); m.presses = (m.presses || []).concat({ nine, from, by: mem.name, at: now }); audit(D2, { at: now, by: mem.name, what: 'press', mid: m.mid, hole: from }); d.u = now; return d; }
        if (!isOrg(d, u.mk)) throw bad(403, 'Only the organizer sets up matches');
        const ids = H.kind === 'player' ? D2.teams.flatMap((t) => t.players) : D2.teams.filter((t) => t.players.length).map((t) => t.tid);
        const mk = (x, y, round) => ({ mid: rnd(6), kind: H.kind, type: H.type, a: x, b: y, amt: H.amt, net: d.day.net !== 'gross', offLow: H.offLow, auto: H.auto, presses: [], round: round || null });
        if (a === 'add') { const x = String(b.a), y = String(b.b); if (x === y || !ids.includes(x) || !ids.includes(y)) throw bad(400, 'Pick two different ' + (H.kind === 'player' ? 'players' : 'teams')); if (D2.matches.length >= 200) throw bad(409, 'Too many matches'); D2.matches.push(mk(x, y)); }
        else if (a === 'remove') D2.matches = D2.matches.filter((m) => m.mid !== String(b.mid));
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
      const g = await mutC(c.id, (d) => { const D2 = d.day; if (op === 'start') { if (D2.status !== 'setup') return { nochange: true, v: d }; if (!D2.teams.some((t) => t.players.length)) throw bad(409, 'Put players on teams first'); D2.teams.forEach((t) => { if (t.players.length && !t.scorer) t.scorer = t.players[0]; }); D2.status = 'live'; }
        else if (op === 'final') { const dis = D2.teams.some((t) => Object.values(D2.scores[t.tid] || {}).some((h) => h.st === 'disputed')); if (dis) throw bad(409, 'Settle the disputed holes first'); D2.status = 'final'; } else D2.status = 'live';
        audit(D2, { at: now, by: mem.name, what: op }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'score') { // the team's scorer (or the organizer) enters a hole; offline-safe: eid makes a retry harmless; rev guards against overwriting someone else's newer entry
      rate('score', u.mk, ip); if (d0.status !== 'live') throw bad(409, d0.status === 'setup' ? 'The round has not started' : 'The round is final');
      const { t, ok } = canScore(c, u.mk, String(b.tid)); if (!ok) throw bad(403, "Only this team's scorer can enter its scores"); const { hole, e } = entryOf(c, t, b); const eid = clean(b.eid, 40);
      const out = await mutC(c.id, (d) => { const D2 = d.day; if (eid && D2.eids.includes(eid)) return { nochange: true, v: { dup: true, d } };
        const sc = D2.scores[t.tid] = D2.scores[t.tid] || {}, cur = sc[hole];
        if (cur && cur.st === 'confirmed' && !isOrg(d, u.mk)) throw bad(409, 'Hole ' + hole + ' is confirmed. Ask the organizer to change it.');
        if (cur && b.rev != null && Number(b.rev) !== cur.rev && !same(cur, e)) throw bad(409, 'Hole ' + hole + ' was changed by ' + (cur.by || 'someone') + '. Check it and enter again.', { current: cur });
        if (cur && same(cur, e)) { if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } return { v: d }; }
        sc[hole] = Object.assign(e, { by: mem.name, at: now, rev: ((cur && cur.rev) || 0) + 1, st: 'entered' });
        audit(D2, { at: now, by: mem.name, tid: t.tid, hole, what: cur ? 'changed' : 'entered', from: cur ? { g: cur.g, p: cur.p } : null, to: { g: e.g, p: e.p, drive: e.drive } });
        if (eid) { D2.eids.push(eid); D2.eids = D2.eids.slice(-800); } d.u = now; return { v: d }; });
      const g = out && out.d ? out.d : out.v || out; send(res, 200, { game: await full(g, u), dup: !!(out && out.dup) }); return true;
    }
    if (op === 'confirm' || op === 'dispute') { // another team's scorer (or the organizer) confirms a team's holes (e.g. at the turn) or flags one for the organizer
      rate('score', u.mk, ip); const t = d0.teams.find((x) => x.tid === String(b.tid)); if (!t) throw bad(404, 'No such team');
      const otherScorer = d0.teams.some((x) => x.tid !== t.tid && x.scorer === mem.pid); if (!org && !otherScorer) throw bad(403, "Another team's scorer (or the organizer) confirms. You can't confirm your own team.");
      const from = num(op === 'dispute' ? b.hole : b.from, 1, 18), to = op === 'dispute' ? from : num(b.to, 1, 18); if (from == null || to == null || to < from) throw bad(400, 'Which holes?');
      const g = await mutC(c.id, (d) => { const sc = d.day.scores[t.tid] || {}; let n = 0;
        for (let h = from; h <= to; h++) { const x = sc[h]; if (!x) continue; if (op === 'confirm') { if (x.st === 'disputed') continue; x.st = 'confirmed'; x.cf = mem.name; x.cfAt = now; } else { x.st = 'disputed'; x.note = clean(b.note, 120); x.df = mem.name; } n++; }
        if (!n) throw bad(409, op === 'confirm' ? 'No entered holes in that range' : 'That hole has no score yet');
        audit(d.day, { at: now, by: mem.name, tid: t.tid, hole: from, to, what: op === 'confirm' ? 'confirmed' : 'disputed', note: op === 'dispute' ? clean(b.note, 120) : undefined }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'resolve') { // organizer settles a disputed hole with the right score (kept in the audit trail)
      if (!org) throw bad(403, 'Only the organizer settles disputes'); const t = d0.teams.find((x) => x.tid === String(b.tid)); if (!t) throw bad(404, 'No such team'); const { hole, e } = entryOf(c, t, b);
      const g = await mutC(c.id, (d) => { const sc = d.day.scores[t.tid] = d.day.scores[t.tid] || {}, cur = sc[hole]; sc[hole] = Object.assign(e, { by: mem.name, at: now, rev: ((cur && cur.rev) || 0) + 1, st: 'confirmed', cf: mem.name + ' (organizer)', cfAt: now }); audit(d.day, { at: now, by: mem.name, tid: t.tid, hole, what: 'settled', from: cur ? { g: cur.g, p: cur.p, note: cur.note } : null, to: { g: e.g, p: e.p } }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    if (op === 'extra') { // closest to the pin / longest drive winner: organizer or any scorer enters it
      const kind = b.kind === 'ld' ? 'ld' : 'ctp', hole = num(b.hole, 1, 18); if (!d0.extras[kind].includes(hole)) throw bad(400, 'That hole has no ' + (kind === 'ld' ? 'longest drive' : 'closest to the pin'));
      if (!org && !d0.teams.some((t) => t.scorer === mem.pid)) throw bad(403, 'Only a scorer or the organizer enters winners');
      const who = String(b.who || ''); if (who && !c.members.some((m) => m.pid === who) && !d0.teams.some((t) => t.tid === who)) throw bad(400, 'Pick the winner');
      const g = await mutC(c.id, (d) => { d.day.win[kind] = d.day.win[kind] || {}; if (!who) delete d.day.win[kind][hole]; else d.day.win[kind][hole] = { who, note: clean(b.note, 40), by: mem.name, at: now }; audit(d.day, { at: now, by: mem.name, hole, what: kind + (who ? ' winner' : ' cleared'), to: who || null }); d.u = now; return d; });
      send(res, 200, { game: await full(g, u) }); return true;
    }
    throw bad(404, 'not found');
  } catch (e) { if (!e.status) console.error('golf:', e.message); send(res, e.status || 500, Object.assign({ error: e.status ? e.message : 'Golf error, try again' }, e.extra || {})); return true; }
}

// ---------- adapter (for Groups and the Calcutta engine) ----------
// attach(contestId, groupId, accountKey): organizer-only link of a standalone golf game to a group contest.
async function attach(id, groupId, accountKey, contestId) { return mutC(id, (d) => { if (d.org !== mkOf(accountKey)) throw bad(403, 'Only the organizer can attach'); d.groupId = clean(groupId, 20); d.contestId = contestId ? clean(contestId, 20) : null; d.u = D.now(); return { ok: true }; }); }
// potSummary(contestId): information only (Oddable never collects, holds or pays money).
async function potSummary(id) { const c = await getC(id), p = c.pot, paid = c.members.filter((m) => m.paid).length, potC = Math.round(p.entry * 100) * paid, takeC = p.take.kind === 'pct' ? Math.round(potC * p.take.v / 100) : p.take.kind === 'flat' ? Math.min(Math.round(p.take.v * 100), potC) : 0;
  const o = { id: c.id, kind: c.kind, title: c.title, pot: p.pot, entry: p.entry, entrants: c.members.length, paid, expected: p.entry * c.members.length, potTotal: potC / 100, take: takeC / 100, pool: (potC - takeC) / 100 };
  if (c.day) o.extras = { skinsPerEntrant: c.day.extras.skins.on ? c.day.extras.skins.amt : 0, ctp: c.day.extras.ctp.length * c.day.extras.ctpAmt, ld: c.day.extras.ld.length * c.day.extras.ldAmt, perMatch: c.day.heads.on ? c.day.heads.amt : 0, matches: c.day.matches.length };
  return o; }
// golfers(eventId, tour): lots source for the Calcutta engine: every golfer in the field, in feed order (the engine decides any "field" bundle).
async function golfers(eventId, tour) { const b = await D.feed.board(F.TOURS[tour] ? tour : 'pga', eventId); return b.golfers.filter((g) => g.st !== 'wd' || g.started).map((g) => ({ id: 'g:' + g.id, name: g.name, label: g.name, src: 'golf-pro', eventId: b.event.id, st: g.st, pos: g.pos, toPar: g.toPar })); }
// teams(contestId): lots source for a golf day's team Calcutta (no auction here).
async function teams(id) { const c = await getC(id); if (c.kind !== 'day') throw bad(400, 'Not a golf day'); const nm = nameMap(c), bd = dayBoard(c); return c.day.teams.filter((t) => t.players.length).map((t) => { const r = bd.rows.find((x) => x.tid === t.tid) || {}; return { id: 't:' + c.id + ':' + t.tid, name: t.name, label: t.name + ' (' + t.players.map((p) => nm[p]).join(', ') + ')', src: 'golf-day', players: t.players.map((p) => nm[p]), place: r.place || null, thru: r.thru || 0 }; }); }
// Bets vs the group: Groups' grading only knows football, so a golf bet is classified 'golf' and is honor-system (the member settles it by hand).
function isGolfBet(b) { if (!b) return false; if (String(b.lg || '').toLowerCase() === 'golf') return true; const t = String(b.kt || '') + ' ' + String(b.text || ''); return /\b(PGA|LPGA|LIV|GOLF|MASTERS|US OPEN GOLF|RYDER)\b/i.test(t) || /^KX(PGA|GOLF)/i.test(String(b.kt || '')); }

// ---------- stats contract (consumed by the stats coder) ----------
// statsFor(userKey, {from, to}) -> normalized records. userKey = the account id from acct.who(). Dates are America/Chicago days.
async function statsFor(userKey, opt) {
  opt = opt || {}; const gk = /^guest:/.test(String(userKey)) ? String(userKey).slice(6) : null, mk = gk ? null : mkOf(userKey), from = opt.from || '0000-00-00', to = opt.to || '9999-99-99';
  const r = await D.S.dbGet(IDX), ids = ((r && r.data && r.data.mine) || {})[gk ? 'g:' + gk : mk] || [], out = [];
  for (const id of ids) {
    let c; try { c = await getC(id); } catch (e) { continue; } const m = gk ? c.members.find((x) => x.guest && x.gid === gk) : memberOf(c, mk); if (!m) continue; const nm = nameMap(c);
    if (c.kind === 'day') {
      const d = c.day, date = d.date; if (date < from || date > to) continue; const t = d.teams.find((x) => x.players.includes(m.pid)), bd = dayBoard(c), n = d.course.par.length;
      if (t) { const row = bd.rows.find((x) => x.tid === t.tid), h = holesOf(c, t.tid), team = S.FORMATS[d.fmt].ball === 'team';
        let score = null, toPar = null, putts = null, thru = 0; const hs = d.course.par.map((_, i) => { const e = h[i + 1]; if (!e) return null; const v = team ? Number(e.g) : Number(e.p && e.p[m.pid]); return v >= 1 ? v : null; });
        if (team) { score = row.gross; toPar = row.toParG; thru = row.thru; } else { let s = 0, pp = 0; d.course.par.forEach((par, i) => { const e = h[i + 1], g = e && e.p && Number(e.p[m.pid]); if (g >= 1) { s += g; pp += par; thru++; } }); score = thru ? s : null; toPar = thru ? s - pp : null; }
        Object.values(h).forEach((e) => { if (e.putts != null) putts = (putts || 0) + e.putts; });
        const allConf = Object.keys(h).length > 0 && Object.values(h).every((e) => e.st === 'confirmed');
        if (thru) out.push({ src: 'golf', id: 'golf:' + c.id + ':round:' + m.pid, date, sport: 'golf', kind: 'golf-round', groupId: c.groupId || undefined, contestId: c.id, title: c.title + ' · ' + d.course.name, result: d.status === 'final' && row.place === 1 ? 'W' : null, place: row.place ? { n: row.place, of: bd.rows.length } : undefined, stake: c.pot.entry || undefined, score, toPar, verified: allConf, extra: { courseId: d.course.id || null, course: d.course.name, tees: d.course.tees, rating: d.course.rating ?? null, slope: d.course.slope ?? null, holes: thru, of: n, putts, format: d.fmt, solo: !!d.solo, team: team ? t.name : undefined, teamScore: row.gross, teamBall: team, holeScores: hs, pars: d.course.par, hcpIdx: d.course.hcp, who: team ? t.players.map((p) => nm[p]) : undefined, playingHcp: S.playHcp(d.hcp[m.pid] || 0, d.pct), guestId: m.guest ? m.gid : undefined, final: d.status === 'final' } });
        if (bd.skins) { const won = bd.skins.won[team ? t.tid : m.pid] || 0; if (won) out.push({ src: 'golf', id: 'golf:' + c.id + ':skins:' + m.pid, date, sport: 'golf', kind: 'golf-round', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · skins', result: null, won: d.extras.skins.amt ? won * d.extras.skins.amt : undefined, units: won, verified: allConf, extra: { side: 'skins', skins: won, course: d.course.name, courseId: d.course.id || null } }); }
        ['ctp', 'ld'].forEach((k) => Object.keys(d.win[k] || {}).forEach((hole) => { const w = d.win[k][hole]; if (w.who === m.pid || w.who === t.tid) out.push({ src: 'golf', id: 'golf:' + c.id + ':' + k + hole + ':' + m.pid, date, sport: 'golf', kind: 'golf-round', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (k === 'ctp' ? 'closest to the pin' : 'longest drive') + ' #' + hole, result: 'W', won: (k === 'ctp' ? d.extras.ctpAmt : d.extras.ldAmt) || undefined, verified: false, extra: { side: k, hole: Number(hole), note: w.note, course: d.course.name, courseId: d.course.id || null } }); }));
      }
      bd.matches.forEach((x) => { const mine = x.kind === 'player' ? [x.a, x.b].indexOf(m.pid) : t ? [x.a, x.b].indexOf(t.tid) : -1; if (mine < 0) return; const ms = x.m || (x.nassau && x.nassau.total); if (!ms || !ms.done) return;
        const res = ms.res === 'T' ? 'T' : (ms.res === 'W') === (mine === 0) ? 'W' : 'L', opp = mine === 0 ? x.b : x.a, oppName = x.kind === 'player' ? nm[opp] : (d.teams.find((y) => y.tid === opp) || {}).name;
        out.push({ src: 'golf', id: 'golf:' + c.id + ':match:' + x.mid + ':' + m.pid, date, sport: 'golf', kind: 'match', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + (x.type === 'nassau' ? 'Nassau' : 'match') + ' vs ' + oppName, result: res, stake: x.amt || undefined, pl: x.amt ? (res === 'W' ? x.amt : res === 'L' ? -x.amt : 0) : undefined, opponent: oppName, verified: false, extra: { text: ms.text, short: ms.short, type: x.type, courseId: d.course.id || null } }); });
    } else if (c.pro.game === 'six') {
      let b = null; try { b = await D.feed.board(c.pro.tour, c.pro.eventId); } catch (e) {} if (!b || !b.event.done) continue; const date = chiDay(b.event.end || b.event.start || D.now()); if (date < from || date > to) continue;
      const ents = Object.keys(c.pro.entries).filter((p) => c.pro.entries[p].picks && c.pro.entries[p].picks.length === 6).map((p) => Object.assign({ pid: p, name: nm[p] }, c.pro.entries[p])), lead = b.golfers.filter((g) => g.st === 'active' && g.toPar != null).sort((x, y) => x.toPar - y.toPar)[0];
      const rk = S.rankSix(ents, fieldMap(b), c.pro.mc, c.pro.tb, lead ? lead.toPar : null), mine = rk.find((x) => x.pid === m.pid); if (!mine) continue;
      out.push({ src: 'golf', id: 'golf:' + c.id + ':pool:' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + b.event.name, result: mine.place === 1 ? 'W' : null, place: { n: mine.place, of: rk.length }, stake: c.pot.entry || undefined, score: mine.total, toPar: mine.total, verified: true, extra: { game: 'pick six', event: b.event.name, tour: c.pro.tour } });
    } else {
      Object.keys(c.pro.oad.events).forEach((ev) => { const E = c.pro.oad.events[ev], pk = E.picks[m.pid]; if (!E.res || !pk) return; const date = chiDay(E.lockAt || D.now()); if (date < from || date > to) return;
        out.push({ src: 'golf', id: 'golf:' + c.id + ':oad:' + ev + ':' + m.pid, date, sport: 'golf', kind: 'golf-pool', contestId: c.id, groupId: c.groupId || undefined, title: c.title + ' · ' + E.name + ' · ' + pk.n, result: null, score: E.res[pk.g] || 0, verified: true, extra: { game: 'one and done', golfer: pk.n, scoredBy: E.by } }); });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

module.exports = { handle, attach, potSummary, golfers, teams, statsFor, isGolfBet, limits, coursesOwnedBy, dayBoard, matchState, _deps: D, _mk: mkOf, _reset: () => { RL.clear(); ENTC.at = 0; ENTC.keys = {}; } };
