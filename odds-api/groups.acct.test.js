// Run: node odds-api/groups.acct.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// GROUPS PHASE 1: the owner-only switch with the REAL sign-in code. Unlike groups.phase1.test.js (which fakes the sign-in), this runs the real acct.js,
// sync.js, limits.js and groups.js together, wired like server.js: real tokens from /acct/owner and /acct/phone, the real OWNER_PHONE rule, the real
// dashboard unlock (/acct/dunlock, x-dash) for the owner's access list, and the real account key of a tester.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', GROUPS_ENABLED: '1', GROUPS_OWNER_ONLY: '1' });
delete process.env.GROUPS_TESTERS; delete process.env.GATE_OFF; delete process.env.GATE_KEY;
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, seen = { outside: [] };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); assert.strictEqual(b.secret, 's3cret'); if (p === '/api/v1/account') return ok({ email: b.email, role: 'user', plan: 'pro', expires_on: null }); return ok({}); }
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) { seen.outside.push(url); throw new Error('unexpected outside call: ' + url); }
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits');
const srv = http.createServer(async (req, res) => { // the same order and the same calls as server.js
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let P, n = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + P + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.7.' + (++n % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const get = async (url, h) => { const r = await real('http://127.0.0.1:' + P + url, { headers: h || {} }); return { s: r.status, j: await r.json() }; };
const NOTIN = { betLock: 0, canBet: false, saved: false }, START = Date.now() + 5 * 864e5;
const CONTEST = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 4, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 0, split: 'none' };
srv.listen(0, '127.0.0.1', async () => {
  P = srv.address().port; let bad = 0; const t = (name) => console.log('  PASS ' + name);
  try {
    // ---- real sign-ins ----
    let r = await post('/acct/owner', { pin: '4321' }); assert.strictEqual(r.s, 200); const tOwner = r.j.token;
    const phoneIn = async (phone, pin, name, viaSync) => { let x; if (viaSync) { x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); } x = await post('/acct/phone', { phone, pin, name, create: !viaSync }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; }; // an owner number cannot be created through /acct/phone (v185), so it signs up through sync first
    const steve = await phoneIn('9565550001', '112233', 'Steve', true), tess = await phoneIn('9565550002', '445566', 'Tess'), stranger = await phoneIn('9565550003', '778899', 'Stranger');
    assert.strictEqual(steve.me.ownerDash, true, 'the OWNER_PHONE account'); assert.ok(!tess.me.ownerDash);
    const H = (tok, more) => Object.assign({ 'x-token': tok }, more || {});
    // ---- who is let in ----
    assert.deepStrictEqual((await get('/groups/on', H(tOwner))).j, { on: true }); assert.deepStrictEqual((await get('/groups/on', H(steve.token))).j, { on: true });
    for (const tok of [tess.token, stranger.token, 'garbage.token', '']) { assert.deepStrictEqual((await get('/groups/on', tok ? H(tok) : {})).j, { on: false }); r = await post('/groups/bet/status', { id: 'b1' }, tok ? H(tok) : {}); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, NOTIN); assert.strictEqual((await post('/groups/mine', {}, tok ? H(tok) : {})).s, 403); }
    t('real tokens: the owner-PIN sign-in and the OWNER_PHONE account are on; every other account and no / bad token get {on:false}, bet/status 200 "not in a group", 403 elsewhere');
    r = await post('/groups/create', { name: 'Owner test', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: CONTEST }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group;
    assert.deepStrictEqual((await post('/groups/bet/status', {}, H(steve.token))).j, { betLock: 1, canBet: true }, 'the owner\'s phone account has a synced row, so it can place group bets'); assert.strictEqual(g.members[0].name, 'Sir Oddable');
    assert.strictEqual((await post('/groups/join', { code: g.code }, H(tOwner))).s, 200); assert.deepStrictEqual((await post('/groups/bet/status', {}, H(tOwner))).j, { betLock: 1, canBet: false }, 'the owner-PIN sign-in can join and run groups but has no synced bets (canBet false)');
    assert.strictEqual((await post('/groups/invite', { type: 'g', code: g.code })).s, 404, 'the public invite banner is "not valid" during the owner-only period'); assert.strictEqual((await post('/groups/join', { code: g.code }, H(tess.token))).s, 403);
    t('the owner creates a real group with his phone account; nobody else can see or join it');
    // ---- the tester list ----
    assert.strictEqual((await post('/groups/access/request', { name: 'Tess from golf' }, H(tess.token))).s, 200);
    assert.strictEqual((await post('/groups/access', {}, H(steve.token))).s, 403, 'owner phone without the dashboard unlock'); assert.strictEqual((await post('/groups/access', {}, H(tess.token))).s, 403);
    r = await post('/acct/dunlock', { pin: '4321' }, H(steve.token)); assert.strictEqual(r.s, 200); const dash = r.j.dash;
    r = await post('/groups/access', {}, H(steve.token, { 'x-dash': dash })); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.requests.length, 1); const key = r.j.requests[0].key; assert.match(key, /^[0-9a-f]{24}$/); assert.strictEqual(r.j.requests[0].name, 'Tess from golf');
    r = await post('/groups/access', { op: 'find', q: 'tess' }, H(tOwner)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.found.length, 1); assert.strictEqual(r.j.found[0].key, key, 'found by the name she signed up with: the same key');
    const all = J(r.j) + J((await post('/groups/access', {}, H(tOwner))).j); assert.ok(!/9565550002/.test(all) && !/@phone\.oddable/.test(all), 'no phone number and no account id in the answers');
    process.env.GROUPS_TESTERS = key; // what the owner pastes into Render
    assert.deepStrictEqual((await get('/groups/on', H(tess.token))).j, { on: true }); r = await post('/groups/join', { code: g.code }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.group.members.length, 3);
    assert.deepStrictEqual((await post('/groups/bet/status', {}, H(tess.token))).j, { betLock: 1, canBet: true }); assert.deepStrictEqual((await post('/groups/bet/status', {}, H(stranger.token))).j, NOTIN); assert.strictEqual((await post('/groups/mine', {}, H(stranger.token))).s, 403);
    t('a tester asks, the owner reads her account key (dashboard unlock needed on his phone), GROUPS_TESTERS lets exactly her in');
    // ---- the two switches ----
    delete process.env.GROUPS_OWNER_ONLY; assert.deepStrictEqual((await post('/groups/bet/status', {}, H(stranger.token))).j, { betLock: 0, canBet: true }); assert.strictEqual((await post('/groups/mine', {}, H(stranger.token))).s, 200);
    delete process.env.GROUPS_ENABLED; for (const tok of [tOwner, steve.token, tess.token, stranger.token]) { assert.deepStrictEqual((await post('/groups/bet/status', {}, H(tok))).j, NOTIN); assert.strictEqual((await post('/groups/mine', {}, H(tok))).s, 403); assert.deepStrictEqual((await get('/groups/on', H(tok))).j, { on: false }); }
    t('GROUPS_OWNER_ONLY removed = open to every signed-in account; GROUPS_ENABLED removed = off for everyone, the owner included');
    assert.deepStrictEqual(seen.outside, [], 'only Supabase, My Apps and ESPN were ever called');
    r = await post('/sync/push', { phone: '9565550003', pin: '778899', data: { bets: [{ id: 'b1', t: 1, stake: 5, gl: 99, sa: 1 }] } }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.data.bets, [{ id: 'b1', t: 1, stake: 5, gl: 99, sa: 1 }], 'Groups off: the sync stores a bet exactly as the phone sent it, as main does');
    t('with Groups off the real /sync/push is main\'s merge (no stamp added, nothing removed)');
  } catch (e) { bad++; console.log('  FAIL ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n        ')); }
  console.log(bad ? '\nGROUPS + REAL SIGN-IN: FAILED' : '\nALL GROUPS + REAL SIGN-IN CHECKS PASSED'); srv.close(); process.exit(bad ? 1 : 0);
});
