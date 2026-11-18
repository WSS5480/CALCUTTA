// Run: node odds-api/join.test.js   (no network: My Apps and the Supabase table are fakes behind global.fetch)
// v276: "prove-and-join" (My Apps contract 5j, builds .42/.43; owner's choice "A", manager decision (a) Nov 17 2026). A phone account whose email answers
// `taken` joins the account that email already opens. The PHONE id stays the person's Oddable identity (token, owner powers, Groups, bets row);
// the plan / access / pay is read through the joined account. An email sign-in of that account lands on the phone id. An older My Apps (no join routes)
// answers `nojoin`.
process.env.MYAPPS_URL = 'https://myapps.test'; process.env.MYAPPS_SECRET = 'sek-ret-XYZ'; process.env.GATE_KEY = 'test-gate-key'; process.env.OWNER_PIN = '4321';
process.env.SUPABASE_URL = 'https://db.test'; process.env.SUPABASE_KEY = 'service-key'; delete process.env.GATE_OFF; process.env.EVENTS_ENABLED = '0';
process.env.OWNER_PHONE = '9565550000'; process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1'; delete process.env.GROUPS_TESTERS;
const assert = require('assert'), http = require('http');
const A = require('./acct'), S = require('./sync'), R = require('./recover');
const tokE = (t) => JSON.parse(Buffer.from(String(t).split('.')[0], 'base64url').toString()).e;
// ---- the fake table (oddable_sync), same shape as recover.test.js ----
const DB = new Map();
function db(url, o) {
  const u = new URL(url), q = u.searchParams, m = (o && o.method) || 'GET', J = (j, st) => ({ ok: !st || st < 300, status: st || 200, json: async () => j, text: async () => JSON.stringify(j) });
  const idq = q.get('id'), id = idq && idq.startsWith('eq.') ? idq.slice(3) : null;
  if (m === 'GET') { if (id != null) { const r = DB.get(id); return J(r ? [JSON.parse(JSON.stringify(r))] : []); } return J([...DB.values()].filter((r) => !(idq === 'not.like.lock:*' && r.id.startsWith('lock:'))).map((r) => (q.get('select') === 'id' ? { id: r.id } : JSON.parse(JSON.stringify(r))))); }
  if (m === 'POST') { const row = JSON.parse(o.body); if (DB.has(row.id) && /ignore-duplicates/.test(o.headers.Prefer)) return J([], 201); DB.set(row.id, row); return J([], 201); }
  if (m === 'PATCH') { const r = DB.get(id), upd = q.get('updated'), b = JSON.parse(o.body); if (!r || (upd != null && String(r.updated) !== upd.slice(3))) return J([]); Object.assign(r, b); return J([JSON.parse(JSON.stringify(r))]); }
  return J({}, 400);
}
// ---- the fake My Apps, contract 5j as built in .42/.43 ----
let calls = [], old = false; const USERS = new Map(), JOIN = new Map(), PEND = new Map(); // account -> {pw, role, plan, exp, joined_to}; phone -> target
const CODE = '424242';
function myapps(path, d) {
  const acct = (e) => USERS.get(e);
  if (old && /^\/api\/v1\/link\/join/.test(path)) return { status: 404, j: { ok: false, error: 'No such endpoint' } };
  if (path === '/api/v1/auth/register') { if (USERS.has(d.email)) return { status: 409, j: { error: 'An account already uses that email' } }; USERS.set(d.email, { pw: d.password, role: 'user', plan: 'free', exp: null }); return { status: 200, j: { ok: true, account: d.email } }; }
  if (path === '/api/v1/auth/login') {
    const u = acct(d.email); if (!u || u.pw !== d.password) return { status: 401, j: { ok: false, error: 'Wrong email or password' } };
    if (u.joined_to) return { status: 200, j: { ok: true, account: u.joined_to, via: 'join', phone_account: d.email, role: acct(u.joined_to).role } };
    const ph = [...JOIN.entries()].find((x) => x[1] === d.email);
    return { status: 200, j: Object.assign({ ok: true, account: d.email, via: 'account', role: u.role }, ph ? { phone_account: ph[0] } : {}) };
  }
  if (path === '/api/v1/account') {
    const u = acct(d.email); if (!u) return { status: 404, j: { error: 'No such account' } };
    return { status: 200, j: Object.assign({ ok: true, email: d.email, role: u.role, plan: u.joined_to ? 'free' : u.plan, expires_on: u.joined_to ? null : u.exp, source: 'trial', pending: false, price: 99, has_contact: !u.joined_to && !/@phone\./.test(d.email), contact_verified: false, contact_hint: '', has_email_login: !/@phone\./.test(d.email), influencer: false, ref_locked: true }, u.joined_to ? { joined_to: u.joined_to } : {}) };
  }
  if (path === '/api/v1/pay/info') return { status: 200, j: { ok: true, price: 99, configured: true } };
  if (path === '/api/v1/pay/request') return { status: 200, j: { ok: true, ref: 'R1', amount: 99 } };
  if (path === '/api/v1/link') return USERS.has(d.email) ? { status: 409, j: { ok: false, error: 'taken' } } : { status: 200, j: { ok: true, pending: true, sent: true, login_hint: 'x' } };
  if (path === '/api/v1/link/join') return { status: 200, j: { ok: true, sent: true, login_hint: d.email[0] + '•••@' + d.email.split('@')[1] } };
  if (path === '/api/v1/link/join/verify') {
    if (d.code !== CODE) return { status: 400, j: { ok: false, error: 'code' } };
    const tgt = PEND.get(d.account); if (!tgt || !USERS.has(tgt)) return { status: 409, j: { ok: false, error: 'taken' } };
    if ([...JOIN.values()].includes(tgt)) return { status: 409, j: { ok: false, error: 'joined' } };
    JOIN.set(d.account, tgt); acct(d.account).joined_to = tgt; return { status: 200, j: { ok: true, account: tgt, login_hint: tgt[0] + '•••' } };
  }
  return { status: 404, j: { ok: false, error: 'No such endpoint' } };
}
global.fetch = async (url, o) => {
  if (String(url).startsWith('https://db.test')) return db(String(url), o);
  const path = String(url).replace('https://myapps.test', ''), data = JSON.parse(o.body); calls.push({ path, data });
  if (path === '/api/v1/link/join' && !old) PEND.set(data.account, data.email);
  const a = myapps(path, data); return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.j };
};
const srv = http.createServer(async (req, res) => { // the same order as server.js
  try { if (/^\/acct\/(link|ref|recover)(\/|\?|$)/.test(req.url) && (await R.handle(req, res))) return; if (req.url.startsWith('/acct') && (await A.handle(req, res))) return; if (req.url.startsWith('/sync') && (await S.handle(req, res))) return; } catch (e) { res.statusCode = 500; res.end('{}'); return; }
  res.statusCode = 404; res.end('{"none":1}');
});
let ipn = 0;
const hit = (path, body, o) => new Promise((done, fail) => {
  o = o || {}; const h = { 'content-type': 'application/json', 'x-forwarded-for': '10.8.' + (++ipn >> 8) + '.' + (ipn & 255) + ', 1.1.1.1, 2.2.2.2' }; if (o.token) h['x-token'] = o.token;
  const r = http.request({ port: srv.address().port, path, method: 'POST', headers: h }, (res) => { let t = ''; res.on('data', (d) => (t += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (e) {} done({ status: res.statusCode, j }); }); });
  r.on('error', fail); r.write(JSON.stringify(body || {})); r.end();
});
let n = 0; const t = (name) => { n++; process.stdout.write('  ok ' + n + ' ' + name + '\n'); };
const BETS = { bets: [{ id: 'b1', t: 5, stake: 20, side: 'KC', line: -2.5 }, { id: 'b2', t: 6, stake: 10, text: 'parlay' }] };
const STEVE = 'steve.owner@jn.test', PAT = 'pat@jn.test', OPHONE = '9565550000', PPHONE = '9565551234', PIN = '123456';

(async () => {
  await new Promise((r) => srv.listen(0, r));
  try {
    // existing email accounts: the owner's console account (role owner, a plan ending later) and a customer
    USERS.set(STEVE, { pw: 'steve-pass-1', role: 'owner', plan: 'pro', exp: '2031-01-01' });
    USERS.set(PAT, { pw: 'pat-pass-11', role: 'user', plan: 'pro', exp: '2030-05-05' });
    // ---- the owner's phone: sign up, bets, then adding his email answers taken ----
    let r = await hit('/acct/phone', { phone: OPHONE, pin: PIN, create: false });
    if (r.status !== 200) { const c = await hit('/sync/signup', { phone: OPHONE, pin: PIN }); void c; r = await hit('/acct/phone', { phone: OPHONE, pin: PIN, create: false }); }
    assert.strictEqual(r.status, 200, JSON.stringify(r.j)); const OT = r.j.token, OPE = A.phoneEmail(S.idOf(OPHONE));
    assert.strictEqual(tokE(OT), OPE); assert.strictEqual(r.j.me.ownerDash, true); assert.strictEqual(r.j.me.groups, true);
    r = await hit('/sync/push', { phone: OPHONE, pin: PIN, data: BETS }); assert.strictEqual(r.status, 200);
    r = await hit('/acct/link', { email: STEVE, password: 'whatever-123' }, { token: OT }); assert.strictEqual(r.status, 409); assert.strictEqual(r.j.code, 'taken');
    t('owner phone: signed in (owner dashboard + Groups), 2 bets, adding his email answers taken');

    // ---- join: code mailed, wrong code, right code ----
    calls = []; r = await hit('/acct/link/join', { email: ' Steve.Owner@jn.test ', account: 'someone@else.test' }, { token: OT });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, sent: true, hint: 's•••@jn.test' });
    assert.strictEqual(calls[0].data.account, OPE, 'the account comes from the token, never the body'); assert.strictEqual(calls[0].data.email, STEVE);
    r = await hit('/acct/link/join/verify', { code: '000000' }, { token: OT }); assert.strictEqual(r.status, 400); assert.strictEqual(r.j.code, 'code');
    r = await hit('/acct/link/join/verify', { code: 'abc' }, { token: OT }); assert.strictEqual(r.status, 400);
    r = await hit('/acct/link/join', { email: 'nope' }, { token: OT }); assert.strictEqual(r.status, 400); assert.strictEqual(r.j.code, 'email');
    r = await hit('/acct/link/join', { email: STEVE }); assert.strictEqual(r.status, 401, 'signed in only');
    t('join start: account from the token, email cleaned; wrong / bad code refused; signed out = 401');
    r = await hit('/acct/link/join/verify', { code: CODE }, { token: OT });
    assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.ok, true); assert.strictEqual(r.j.joined, true);
    assert.strictEqual(r.j.me.email, OPE, 'the phone id stays the identity'); assert.strictEqual(r.j.me.ownerDash, true); assert.strictEqual(r.j.me.groups, true);
    assert.strictEqual(r.j.me.plan, 'pro'); assert.strictEqual(r.j.me.expires_on, '2031-01-01', 'plan read through the joined account'); assert.strictEqual(r.j.me.has_email_login, true);
    assert.ok(!('token' in r.j), 'the same token: nothing to swap');
    t('join verify: same phone identity, owner dashboard + Groups kept, plan from the joined account');

    // ---- after the join: cell number + PIN sign-in ----
    r = await hit('/acct/phone', { phone: OPHONE, pin: PIN, create: false });
    assert.strictEqual(r.status, 200); assert.strictEqual(tokE(r.j.token), OPE); assert.strictEqual(r.j.me.email, OPE); assert.strictEqual(r.j.me.ownerDash, true); assert.strictEqual(r.j.me.groups, true);
    assert.strictEqual(r.j.me.expires_on, '2031-01-01'); assert.strictEqual(r.j.me.allowed, true);
    r = await hit('/sync/pull', { phone: OPHONE, pin: PIN }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j.data.bets.map((b) => b.id).sort(), ['b1', 'b2']);
    r = await hit('/acct/me', {}, { token: OT }); assert.strictEqual(r.j.me.email, OPE); assert.strictEqual(r.j.me.ownerDash, true); assert.strictEqual(r.j.me.expires_on, '2031-01-01');
    t('cell number + PIN after the join: phone token, owner dashboard, Groups, bets, plan from the joined account');

    // ---- email sign-in of the joined account (another device): lands on the phone id, gets the bets by token ----
    r = await hit('/acct/login', { email: STEVE, password: 'steve-pass-1' });
    assert.strictEqual(r.status, 200); assert.strictEqual(tokE(r.j.token), OPE, 'token minted for the phone id'); assert.strictEqual(r.j.me.email, OPE); assert.strictEqual(r.j.me.ownerDash, true); assert.strictEqual(r.j.me.groups, true);
    const ET = r.j.token;
    r = await hit('/sync/pull', { token: ET }); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.deepStrictEqual(r.j.data.bets.map((b) => b.id).sort(), ['b1', 'b2']);
    t('email + password of the joined account: phone identity, owner dashboard, its bets synced with the token');

    // ---- plan calls go through the joined account; identity calls stay on the phone ----
    calls = []; r = await hit('/acct/pay', {}, { token: OT }); assert.strictEqual(r.status, 200);
    assert.strictEqual(calls.find((c) => c.path === '/api/v1/pay/request').data.account, STEVE, 'pay goes onto the account that holds the plan');
    calls = []; await hit('/acct/me', {}, { token: OT }); assert.strictEqual(calls.find((c) => c.path === '/api/v1/pay/info').data.account, STEVE);
    assert.strictEqual(await A.planAcct(OPE), STEVE); assert.strictEqual(await A.planAcct('owner'), 'owner');
    t('pay / pay info go through the joined account');

    // ---- a second phone cannot join the same account; an ordinary customer phone joins its own account ----
    r = await hit('/acct/phone', { phone: PPHONE, pin: PIN, create: true, name: 'Pat' }); assert.strictEqual(r.status, 200, JSON.stringify(r.j)); const PT = r.j.token, PPE = A.phoneEmail(S.idOf(PPHONE));
    assert.strictEqual(r.j.me.ownerDash, undefined); assert.strictEqual(r.j.me.groups, undefined);
    await hit('/acct/link/join', { email: STEVE }, { token: PT }); r = await hit('/acct/link/join/verify', { code: CODE }, { token: PT });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.j.code, 'joined'); assert.ok(/different email/.test(r.j.error));
    await hit('/acct/link/join', { email: PAT }, { token: PT }); r = await hit('/acct/link/join/verify', { code: CODE }, { token: PT });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.j.me.email, PPE); assert.strictEqual(r.j.me.role, 'user'); assert.strictEqual(r.j.me.ownerDash, undefined); assert.strictEqual(r.j.me.groups, undefined, 'no new owner powers');
    assert.strictEqual(r.j.me.expires_on, '2030-05-05');
    r = await hit('/acct/login', { email: PAT, password: 'pat-pass-11' }); assert.strictEqual(tokE(r.j.token), PPE); assert.strictEqual(r.j.me.ownerDash, undefined);
    t('second join to the same account = joined; a customer phone joins its own account with no owner powers');

    // ---- an older My Apps (no join routes): nojoin, so the phone shows only "Use a different email" ----
    old = true; const NP = '9565557777';
    r = await hit('/acct/phone', { phone: NP, pin: PIN, create: true, name: 'Neo' }); const NT = r.j.token;
    r = await hit('/acct/link/join', { email: PAT }, { token: NT }); assert.strictEqual(r.status, 200); assert.deepStrictEqual([r.j.ok, r.j.code], [false, 'nojoin']);
    r = await hit('/acct/link/join/verify', { code: CODE }, { token: NT }); assert.deepStrictEqual([r.j.ok, r.j.code], [false, 'nojoin']);
    old = false;
    t('older My Apps: join answers nojoin (200), nothing breaks');

    // ---- an email account cannot join; nothing logged ----
    r = await hit('/acct/link/join', { email: PAT }, { token: (await hit('/acct/login', { email: 'nobody@x.test', password: 'x' })).j.token || 'x.y' }); assert.strictEqual(r.status, 401);
    t('no token = 401');
    console.log('join.test.js: all ' + n + ' passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.close();
})();
