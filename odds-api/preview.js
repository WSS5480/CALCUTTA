// TEST PREVIEW ONLY (branch `preview`, env PREVIEW=1). Never loaded on the live service (server.js requires it only when PREVIEW=1).
// What it does:
//   - demo accounts (cell number + PIN rows in sync.js's MEMORY store; nothing touches Supabase, My Apps, the Odds API or the owner PIN)
//   - "Demo user" switcher routes: GET /preview/status, POST /preview/as {role}. The demo people are PUBLIC personas: anyone with the link may be any of
//     them. Real testers who make their own account (cell + PIN) are protected: tokens are signed with a secret made at start (server.js), so they
//     cannot be forged. POST /preview/reseed needs the admin secret (env PREVIEW_ADMIN, 12+ characters; unset = off) and is rate-limited.
//   - seeds believable demo data through the REAL engine routes (groups, calcutta, golf, events, stats), so every screen has content
//   - wires the shared contracts the branches left as stand-ins (limits, stats providers, Oddable handicap / rating)
//   - preview-only stand-ins for the features whose engines are not committed yet (partner suggestions P1, tournament handicap overrides E-H):
//     POST /preview/pairing, POST /preview/hcp. Each answer carries `inProgress: true` and the screen says "Preview: in progress".
// Money: display only, like the rest of Oddable. Nothing is collected, held or paid.
const crypto = require('crypto');
const { Readable } = require('stream');
const S = require('./sync');
const A = require('./acct');
const PIN = '111111';
// role = what the switcher shows. The first three are the ones the owner asked for; the rest fill the games.
const USERS = [
  { role: 'commish', label: 'Commissioner', name: 'Coach Mo', phone: '9565550101', blurb: 'Runs the group, the Calcuttas and the golf day.' },
  { role: 'player', label: 'Player', name: 'RGV Ray', phone: '9565550102', blurb: 'Plays in everything. Good place to see My stats.' },
  { role: 'director', label: 'Tournament director', name: 'Pro Shop Pat', phone: '9565550103', blurb: 'Enterprise account (course). Can set tournament handicaps.' },
  { role: 'p4', label: 'Player', name: 'Lefty Lou', phone: '9565550104' },
  { role: 'p5', label: 'Player', name: 'Birdie Bea', phone: '9565550105' },
  { role: 'p6', label: 'Player', name: 'Dinker Dee', phone: '9565550106' },
  { role: 'p7', label: 'Player', name: 'Ace Abe', phone: '9565550107' },
  { role: 'p8', label: 'Player', name: 'Tex Tina', phone: '9565550108' },
];
USERS.forEach((u) => { u.id = S.idOf(u.phone); });
const byRole = (r) => USERS.find((u) => u.role === r);
const emailOf = (u) => A.phoneEmail(u.id);
const tokenOf = (u) => A._pv.mint(emailOf(u));
const STATE = { at: 0, done: false, steps: [], ids: {} };
const step = async (name, fn) => { try { await fn(); STATE.steps.push({ name, ok: true }); } catch (e) { STATE.steps.push({ name, ok: false, err: String((e && e.message) || e).slice(0, 300) }); console.error('preview seed [' + name + ']:', e && e.stack); } };

// ---------- in-process request to a real engine route (same path a phone uses) ----------
let IPN = 1;
function call(mod, role, path, b, method) {
  return new Promise((resolve, reject) => {
    const u = role ? byRole(role) : null, raw = Buffer.from(JSON.stringify(b || {}));
    const req = Readable.from(method === 'GET' ? [] : [raw]); req.method = method || 'POST'; req.url = path;
    req.headers = { 'content-type': 'application/json', 'x-token': u ? tokenOf(u) : '', 'x-forwarded-for': '10.' + (IPN >> 16 & 255) + '.' + (IPN >> 8 & 255) + '.' + (IPN++ & 255) + ', 10.0.0.2, 10.0.0.3' };
    req.socket = { remoteAddress: '127.0.0.1' };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; }, writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); return this; },
      end(t) { let j = null; try { j = JSON.parse(String(t || '{}')); } catch (e) { j = { raw: String(t) }; } resolve({ s: this.statusCode, j }); } };
    Promise.resolve(require('./' + mod).handle(req, res)).then((h) => { if (!h) resolve({ s: 404, j: { error: 'no route ' + path } }); }, reject);
  });
}
// same, but throws unless 200 (seeding wants to stop a step on the first refusal and report it)
async function ok(mod, role, path, b) { const r = await call(mod, role, path, b); if (r.s !== 200) throw new Error(path + ' as ' + role + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 200)); return r.j; }

// ---------- accounts ----------
async function makeUsers() {
  const names = {};
  for (const u of USERS) {
    const salt = crypto.createHash('sha256').update('pv|' + u.phone).digest('hex').slice(0, 32);
    await S.dbPut({ id: u.id, salt, pinhash: crypto.scryptSync(PIN, salt, 32).toString('hex'), data: { bets: [], log: {}, pins: [] }, updated: Date.now() - 30 * 864e5, created_at: new Date(Date.now() - 200 * 864e5).toISOString() }, true); // demo people have been members since spring: stats only accepts plays dated after the account existed
    names[u.id.slice(0, 8)] = u.name;
  }
  await S.dbPut({ id: 'lock:names', salt: 'x', pinhash: 'x', data: { names }, updated: 1 });
}

// ---------- routes ----------
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((yes, no) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n <= 20000) c.push(d); }); req.on('end', () => { try { yes(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { no(e); } }); req.on('error', no); });
const pub = (u) => ({ role: u.role, label: u.label, name: u.name, blurb: u.blurb || '' });
async function handle(req, res) {
  const path = req.url.split('?')[0];
  if (path === '/preview/status') { send(res, 200, { preview: true, seeded: STATE.done, at: STATE.at, steps: STATE.steps, users: USERS.slice(0, 3).map(pub), others: USERS.slice(3).map(pub), store: 'memory', note: 'Test data only. It is rebuilt whenever this test server restarts.' }); return true; }
  if (path === '/preview/coursecheck') { send(res, 200, { lines: require('./preview-coursecheck').last().map((x) => x.slice(0, 400)) }); return true; } // read-only: the check runs once at start, never on request
  if (req.method !== 'POST') return false;
  let b; try { b = await body(req); } catch (e) { send(res, 400, { error: 'bad request' }); return true; }
  if (path === '/preview/as') {
    const u = byRole(String(b.role || '')); if (!u) { send(res, 404, { error: 'No such demo user' }); return true; }
    send(res, 200, { token: tokenOf(u), phone: u.phone, pin: PIN, user: pub(u), ids: STATE.ids, seeded: STATE.done,
      me: { email: 'Test preview account', role: 'user', plan: 'pro', expires_on: null, source: 'preview', allowed: true, pending: false, price: 99, link: null, tag: null, payReady: false } });
    return true;
  }
  if (path === '/preview/reseed') { // admin only: env PREVIEW_ADMIN (never in the repo, never in the page); unset = switched off
    const ip = require('./ip').clientIp(req), t = Date.now(), tries = (ADMIN_TRY.get(ip) || []).filter((x) => t - x < 600e3); if (tries.length >= 5) { send(res, 429, { error: 'Too many tries. Wait 10 minutes.' }); return true; } tries.push(t); ADMIN_TRY.set(ip, tries); if (ADMIN_TRY.size > 2000) ADMIN_TRY.clear();
    if (!adminOk(req.headers['x-preview-admin'] || b.admin)) { send(res, 403, { error: 'Not allowed' }); return true; }
    if (t - LAST_RESEED < 60e3) { send(res, 429, { error: 'Reseeded less than a minute ago' }); return true; } LAST_RESEED = t;
    await boot(true); send(res, 200, { ok: true, steps: STATE.steps }); return true; }
  const X = require('./preview-extra');
  if (X.routes[path]) { const e = A.who(req); if (!e) { send(res, 401, { error: 'Sign in again' }); return true; } try { send(res, 200, await X.routes[path](e, b, { USERS, emailOf, STATE })); } catch (er) { send(res, er.status || 500, { error: er.message }); } return true; }
  return false;
}

const ADMIN_TRY = new Map(); let LAST_RESEED = 0;
function adminOk(got) { const want = String(process.env.PREVIEW_ADMIN || ''); if (want.length < 12) return false; const a = Buffer.from(String(got || '')), w = Buffer.from(want); return a.length === w.length && crypto.timingSafeEqual(a, w); }
let BOOTING = null;
async function boot(again) {
  if (BOOTING) return BOOTING;
  BOOTING = (async () => {
    if (!S.memory()) throw new Error('preview needs the memory store');
    if (again) { S._mem.clear(); ['groups', 'calcutta', 'golf', 'events', 'stats', 'limits'].forEach((m) => { try { const M = require('./' + m); if (M._reset) M._reset(); } catch (e) {} }); }
    if (process.env.PREVIEW_COURSE_MOCK) require(process.env.PREVIEW_COURSE_MOCK)(require('./golf-courses')); // local Playwright only: canned OpenGolfAPI answers (the sandbox cannot reach the API)
    STATE.steps = []; STATE.done = false; STATE.ids = {};
    await step('demo accounts', makeUsers);
    const seed = require('./preview-seed');
    await seed.run({ step, call, ok, USERS, byRole, emailOf, STATE, S, A });
    STATE.done = true; STATE.at = Date.now();
    if (!again) require('./preview-coursecheck').run().catch((e) => console.error('coursecheck:', e && e.message));
    console.log('preview seeded:', STATE.steps.map((s) => (s.ok ? 'ok ' : 'FAIL ') + s.name + (s.err ? ' (' + s.err + ')' : '')).join(' | '));
  })().finally(() => { BOOTING = null; });
  return BOOTING;
}
module.exports = { handle, boot, USERS, call, ok, STATE, PIN };
