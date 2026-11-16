// Shared people limits for EVERY Oddable game type (owner decision G15, Nov 16 2026): groups, contests, Calcuttas, golf days, pro golf pools, local events.
// - Standard (individual) accounts: anything they create tops out at 8 PEOPLE, commissioner included.
// - Enterprise accounts (courses, clubs, leagues): the owner turns on an `enterprise` flag on the ACCOUNT; their games go up to ENTERPRISE_MAX_PEOPLE (default 500).
// - The owner can also give one group or game `extraSeats` (raises that one cap above 8). No self-serve, no payments (pricing for extra seats: owner, later).
// - "Contact us" requests (name, organization, contact, people, what they want to run) are saved for the owner's dashboard.
// - Enterprise usage counter (for the owner's billing later, no payments now): per enterprise account per month, each game's distinct players.
// Storage (Supabase oddable_sync, 'lock:' rows): 'lock:ent' {acct:{key:{on,at}}, seats:{id:n}}, 'lock:entreq' {list:[...]}, 'lock:entuse' {key:{'YYYY-MM':{gameId:{n,title}}}}.
// Accounts are identified by keyOf(account id from acct.who) = a one-way hash, never the phone. Engines call: const L = require('./limits'); await L.maxPeople(L.keyOf(e), gameId).
const crypto = require('crypto');
const D = { S: require('./sync'), acct: () => require('./acct'), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
const STANDARD = 8;
const CEILING = () => Math.max(STANDARD, Math.min(5000, Math.round(Number(process.env.ENTERPRISE_MAX_PEOPLE) || 500)));
// ONE shared string (owner, Nov 16 2026: $500/month license + $20 per player per game). Change it here only; every engine and the catalog use it.
const ENTERPRISE_TEXT = 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.';
const CAP_TEXT = 'Up to 8 people. Need more? Ask about Oddable for clubs and courses.';
const keyOf = (e) => crypto.createHash('sha256').update('oddable-acct|' + String(e || '')).digest('hex').slice(0, 24);
const bad = (status, error) => Object.assign(new Error(error), { status });
let C = { at: 0, v: null };
async function ent(fresh) { if (!fresh && C.v && D.now() - C.at < 30e3) return C.v; const r = await D.S.dbGet('lock:ent').catch(() => null); C = { at: D.now(), v: (r && r.data) || { acct: {}, seats: {} } }; return C.v; }
async function rmw(key, init, fn) {
  for (let i = 0; i < 12; i++) { let row = await D.S.dbGet(key); if (!row) { await D.S.dbPut({ id: key, salt: 'x', pinhash: 'x', data: init, updated: 1 }, true); row = await D.S.dbGet(key); if (!row) continue; }
    const data = JSON.parse(JSON.stringify(row.data || {})); const out = fn(data); if (await D.S.dbPatchIf(key, row.updated, data, Math.max(D.now(), Number(row.updated || 0) + 1))) return out; await D.sleep(3 + Math.random() * 20); }
  throw bad(409, 'Busy, try again');
}
const isEnterprise = async (key) => !!(((await ent()).acct || {})[key] || {}).on;
// The most people one group/game may hold: the enterprise ceiling for an enterprise creator, else 8 + any owner-set extra seats for that group/game.
async function maxPeople(accountKey, groupOrGameId) {
  const E = await ent(); if (((E.acct || {})[accountKey] || {}).on) return CEILING();
  const x = Math.max(0, Math.round(Number((E.seats || {})[String(groupOrGameId || '')]) || 0)); return Math.min(CEILING(), STANDARD + x);
}
const capMsg = (n) => 'This game is full (' + n + ' people). ' + ENTERPRISE_TEXT;
// Enterprise usage: record the distinct players of one game this month (call when a game starts / ends; idempotent, keeps the highest count).
async function recordUse(accountKey, gameId, players, title) {
  if (!(await isEnterprise(accountKey))) return false; const mo = new Date(D.now()).toISOString().slice(0, 7);
  await rmw('lock:entuse', {}, (x) => { const a = (x[accountKey] = x[accountKey] || {}), m = (a[mo] = a[mo] || {}), o = m[String(gameId)] || { n: 0 }; m[String(gameId)] = { n: Math.max(o.n, Math.round(Number(players) || 0)), title: String(title || o.title || '').slice(0, 40) }; });
  return true;
}
// ---------- routes: /groups/ent/contact (signed in), /groups/ent/admin (owner only) ----------
const RL = new Map(); const limited = (k, n, ms) => { const t = D.now(), a = (RL.get(k) || []).filter((x) => t - x < ms); if (a.length >= n) return true; a.push(t); RL.set(k, a); if (RL.size > 20000) RL.clear(); return false; };
const clean = (s, n) => String(s == null ? '' : s).replace(/[<>&"'`\\\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
async function contact(e, ip, b) {
  if (limited('c|' + keyOf(e), 3, 3600e3) || limited('ci|' + ip, 6, 3600e3)) throw bad(429, 'Thanks, we already have your request. Try again later.');
  const q = { id: crypto.randomBytes(6).toString('hex'), at: D.now(), acct: keyOf(e), name: clean(b.name, 60), org: clean(b.org, 80), reach: clean(b.reach, 80), people: Math.max(0, Math.min(100000, Math.round(Number(b.people) || 0))), what: clean(b.what, 400), done: false };
  if (q.name.length < 2 || q.reach.length < 5) throw bad(400, 'Add your name and a phone number or email');
  await rmw('lock:entreq', { list: [] }, (x) => { x.list = (x.list || []).concat(q).slice(-500); }); return { ok: true };
}
async function resolveAcct(b) { // the owner names an account by its player tag (first 8 of the sync id, as the owner dashboard shows) or an email account
  const A = D.acct();
  if (b.k && /^[0-9a-f]{8}$/.test(String(b.k))) { const ids = (await D.S.dbIds()).filter((id) => id.startsWith(String(b.k))); if (ids.length !== 1) throw bad(404, ids.length ? 'More than one player with that tag' : 'No player with that tag'); return keyOf(A.phoneEmail(ids[0])); }
  if (b.email && /^[^@\s]+@[^@\s]+$/.test(String(b.email))) return keyOf(String(b.email).toLowerCase());
  if (b.key && /^[0-9a-f]{24}$/.test(String(b.key))) return String(b.key);
  throw bad(400, 'Name the account (player tag or email)');
}
async function admin(b) {
  const op = String(b.op || 'list');
  if (op === 'enterprise') { const key = await resolveAcct(b); await rmw('lock:ent', { acct: {}, seats: {} }, (x) => { x.acct = x.acct || {}; if (b.on) x.acct[key] = { on: true, at: D.now(), note: clean(b.note, 80) }; else delete x.acct[key]; }); C.at = 0; return { ok: true, key, enterprise: !!b.on }; }
  if (op === 'seats') { const id = String(b.id || ''); if (!/^[A-Za-z0-9:_-]{4,40}$/.test(id)) throw bad(400, 'Which group or game?'); const n = Math.round(Number(b.n)); if (!(n >= 0 && n <= CEILING() - STANDARD)) throw bad(400, 'Extra seats: 0 to ' + (CEILING() - STANDARD)); await rmw('lock:ent', { acct: {}, seats: {} }, (x) => { x.seats = x.seats || {}; if (n) x.seats[id] = n; else delete x.seats[id]; }); C.at = 0; return { ok: true, id, extraSeats: n }; }
  if (op === 'done') { await rmw('lock:entreq', { list: [] }, (x) => { (x.list || []).forEach((q) => { if (q.id === String(b.id)) q.done = !!b.done; }); }); return { ok: true }; }
  const E = await ent(true), R = await D.S.dbGet('lock:entreq').catch(() => null), U = await D.S.dbGet('lock:entuse').catch(() => null);
  const use = {}; Object.keys((U && U.data) || {}).forEach((k) => { use[k] = Object.keys(U.data[k]).sort().reverse().map((mo) => { const g = U.data[k][mo]; const games = Object.keys(g).map((id) => ({ id, title: g[id].title, players: g[id].n })); return { month: mo, games: games.length, playerGames: games.reduce((a, x) => a + x.players, 0), list: games }; }); });
  return { requests: ((R && R.data && R.data.list) || []).slice().reverse(), enterprise: Object.keys(E.acct || {}).map((k) => Object.assign({ key: k }, E.acct[k], { use: use[k] || [] })), seats: E.seats || {}, standard: STANDARD, ceiling: CEILING(), text: ENTERPRISE_TEXT };
}
module.exports = { STANDARD, CEILING, ENTERPRISE_TEXT, CAP_TEXT, keyOf, maxPeople, isEnterprise, capMsg, recordUse, contact, admin, _deps: D, _reset: () => { C = { at: 0, v: null }; RL.clear(); } };
