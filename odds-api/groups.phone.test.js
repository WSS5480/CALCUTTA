// Run: node odds-api/groups.phone.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// v272, GROUPS PHASE 2 (owner-only on the phone). The server side of "the phone shows Groups only when the server says so", with the REAL acct.js, sync.js,
// limits.js and groups.js wired like server.js:
//   - /acct/status carries `groups: true` only while GROUPS_ENABLED=1; every `me` (sign-in answers and /acct/me) carries `groups: true` only for an account the
//     switches let in. With the variables unset both answers are those of v271, field for field.
//   - an ended account that is on the list still gets the flag (the phone shows the Groups tab with its "Your time has ended" lock) and every /groups call is refused.
//   - the calls pics/groups.js makes (create with no entry and no payout, members' link -> request -> approve, direct join, leave, delete, status).
//   - what another member can read about a member: a name and a short member id. Never a phone number, an account id, an email, a PIN or a sync row id.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', });
delete process.env.GROUPS_ENABLED; delete process.env.GROUPS_OWNER_ONLY;
delete process.env.GROUPS_TESTERS; delete process.env.GATE_OFF; delete process.env.GATE_KEY;
const ENDED = new Set(); const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, seen = { outside: [] };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); assert.strictEqual(b.secret, 's3cret'); if (p === '/api/v1/account') return ok(Object.assign({ email: b.email, role: 'user', plan: 'pro', expires_on: null }, ENDED.has(b.email) ? { expires_on: '2026-01-01' } : {})); return ok({}); }
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
  P = srv.address().port; let bad = 0, n = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
  const H = (tok, more) => Object.assign({ 'x-token': tok }, more || {});
  const has = (o) => Object.prototype.hasOwnProperty.call(o || {}, 'groups');
  try {
    let r = await post('/acct/owner', { pin: '4321' }); assert.strictEqual(r.s, 200); const tOwner = r.j.token; assert.ok(!has(r.j.me), 'dark: the owner sign-in answer has no groups field');
    const phoneIn = async (phone, pin, name, viaSync) => { let x; if (viaSync) { x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); } x = await post('/acct/phone', { phone, pin, name, create: !viaSync }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve', true), tess = await phoneIn('9565550002', '445566', 'Tess'), stranger = await phoneIn('9565550003', '778899', 'Stranger'), late = await phoneIn('9565550004', '991122', 'Late');
    const ALL = [['owner PIN', tOwner], ['owner phone', steve.token], ['tester', tess.token], ['stranger', stranger.token], ['ended', late.token]];
    const me = async (tok) => { const x = await post('/acct/me', {}, H(tok)); assert.strictEqual(x.s, 200, J(x.j)); return x.j.me; };
    const again = async (phone, pin) => (await post('/acct/phone', { phone, pin })).j.me;

    // ---- 1. dark: nothing new anywhere ----
    assert.deepStrictEqual((await get('/acct/status')).j, { gate: true, guest: true });
    for (const j of [steve, tess, stranger, late]) assert.ok(!has(j.me), 'dark: a phone sign-in answer has no groups field');
    for (const [who, tok] of ALL) assert.ok(!has(await me(tok)), 'dark: /acct/me has no groups field for ' + who);
    for (const v of ['0', 'true', 'yes', ' 1', '1 ', 'on']) { process.env.GROUPS_ENABLED = v; assert.deepStrictEqual((await get('/acct/status')).j, { gate: true, guest: true }, J(v)); assert.ok(!has(await me(tOwner)), J(v)); assert.ok(!has(await me(steve.token)), J(v)); }
    delete process.env.GROUPS_ENABLED; process.env.GROUPS_OWNER_ONLY = '1'; process.env.GROUPS_TESTERS = LIM.keyOf(ACCT.phoneEmail ? 'x' : 'x');
    assert.deepStrictEqual((await get('/acct/status')).j, { gate: true, guest: true }); for (const [who, tok] of ALL) assert.ok(!has(await me(tok)), 'GROUPS_ENABLED unset, the other two set: still nothing for ' + who);
    delete process.env.GROUPS_OWNER_ONLY; delete process.env.GROUPS_TESTERS;
    t('GROUPS_ENABLED unset (or anything but exactly "1"): /acct/status and every `me` are v271\'s, with no groups field, for the owner too');

    // ---- 2. owner-only ----
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    assert.deepStrictEqual((await get('/acct/status')).j, { gate: true, guest: true, groups: true });
    assert.strictEqual((await me(tOwner)).groups, true); assert.strictEqual((await me(steve.token)).groups, true); assert.strictEqual((await post('/acct/owner', { pin: '4321' })).j.me.groups, true); assert.strictEqual((await again('9565550001', '112233')).groups, true);
    for (const tok of [tess.token, stranger.token, late.token]) assert.ok(!has(await me(tok)));
    assert.ok(!has(await again('9565550003', '778899')), 'a stranger signing in again: no field');
    r = await post('/acct/me', {}, H('garbage')); assert.strictEqual(r.s, 401); assert.ok(!/groups/.test(J(r.j)));
    t('GROUPS_OWNER_ONLY=1: only the owner-PIN sign-in and the OWNER_PHONE account get `groups: true` (sign-in answers and /acct/me); everyone else gets no field');
    const key = (await (async () => { await post('/groups/access/request', { name: 'Tess' }, H(tess.token)); return (await post('/groups/access', {}, H(tOwner))).j.requests[0].key; })());
    process.env.GROUPS_TESTERS = key; assert.strictEqual((await me(tess.token)).groups, true); assert.strictEqual((await again('9565550002', '445566')).groups, true); assert.ok(!has(await me(stranger.token)));
    process.env.GROUPS_TESTERS = key.toUpperCase() + ', 9565550003, stranger@x.test'; assert.strictEqual((await me(tess.token)).groups, true); assert.ok(!has(await me(stranger.token)), 'a phone number or an email in GROUPS_TESTERS lets nobody in');
    t('GROUPS_TESTERS (account keys) adds exactly the listed tester; a phone number or an email in the list is ignored');
    for (const [who, tok] of ALL) { const m = await me(tok), on = (await get('/groups/on', H(tok))).j.on; if (who !== 'ended') assert.strictEqual(!!m.groups, on, 'the flag and /groups/on agree for ' + who); }
    t('the flag on `me` agrees with /groups/on for every kind of account');

    // ---- 3. an ended account on the list: flag yes (the phone shows the lock), every Groups call refused ----
    const lateAcct = (await me(late.token)).email; assert.match(lateAcct, /@phone\.oddable$/);
    process.env.GROUPS_TESTERS = key + ',' + LIM.keyOf(lateAcct); assert.strictEqual((await me(late.token)).groups, true); assert.strictEqual((await me(late.token)).allowed, true);
    ENDED.add(lateAcct); ACCT.uncache(lateAcct); const lm = await me(late.token); assert.strictEqual(lm.allowed, false, 'My Apps says the time has ended'); assert.strictEqual(lm.groups, true, 'still flagged: the phone shows Groups with the lock');
    assert.deepStrictEqual((await get('/groups/on', H(late.token))).j, { on: false });
    for (const op of ['mine', 'create', 'join', 'preview', 'get', 'leave', 'standings', 'bet/add', 'access/request']) { r = await post('/groups/' + op, { code: 'ABCD-EFGH' }, H(late.token)); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.expired, true, op); assert.match(r.j.error, /^Your time has ended\./, op); }
    assert.deepStrictEqual((await post('/groups/bet/status', {}, H(late.token))).j, NOTIN);
    t('an ended account that is on the list keeps the flag, and every /groups call answers 403 "Your time has ended" (bet/status stays the safe "not in a group")');

    // ---- 4. the calls the phone makes ----
    const mk = () => ({ name: 'Sunday crew', join: { requests: true, open: false, auto: false, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: START, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' });
    r = await post('/groups/create', mk(), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group;
    assert.match(g.id, /^[A-Z2-9]{10}$/); assert.match(g.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.match(g.link, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.notStrictEqual(g.code, g.link);
    assert.strictEqual(g.contests[0].rules.entry, 0); assert.strictEqual(g.contests[0].rules.split, 'none'); assert.deepStrictEqual(g.money.take, { kind: 'none', v: 0 }); assert.strictEqual(g.pots.main.pool || 0, 0, 'no money in the pot');
    for (const bad2 of [{ max: 9 }, { max: 100 }]) { const b = mk(); Object.assign(b.join, bad2); assert.strictEqual((await post('/groups/create', b, H(steve.token))).s, 400, 'more than 8 people is refused'); }
    t('create as the phone sends it: one picks contest, entry 0, no payout, up to 8 people; ids and codes are random letters and digits');
    r = await post('/groups/preview', { code: g.link.replace('-', '').toLowerCase() }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.group.role, 'none'); assert.strictEqual(r.j.group.needsOk, true); assert.strictEqual(r.j.group.members, undefined, 'a non-member does not get the member list'); assert.strictEqual(r.j.group.code, undefined); assert.strictEqual(r.j.group.link, undefined);
    r = await post('/groups/join', { code: g.link, myName: 'Tess' }, H(tess.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.pending, true);
    r = await post('/groups/mine', {}, H(tess.token)); assert.deepStrictEqual(r.j.pending, [{ id: g.id, name: 'Sunday crew' }]); assert.deepStrictEqual(r.j.groups, []);
    r = await post('/groups/get', { id: g.id }, H(steve.token)); assert.strictEqual(r.j.group.reqs.length, 1); const pid = r.j.group.reqs[0].pid;
    r = await post('/groups/decide', { id: g.id, pid, ok: true }, H(steve.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.group.members.length, 2);
    r = await post('/groups/mine', {}, H(tess.token)); assert.strictEqual(r.j.groups.length, 1); assert.strictEqual(r.j.betLock, 1); const tg = r.j.groups[0]; assert.strictEqual(tg.role, 'member'); assert.strictEqual(tg.code, undefined, 'a member never gets the commissioner\'s code'); assert.strictEqual(tg.link, g.link);
    assert.deepStrictEqual((await post('/groups/bet/status', {}, H(tess.token))).j, { betLock: 1, canBet: true });
    r = await post('/groups/standings', { id: g.id, cid: tg.contests[0].cid }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.rows.length, 2);
    assert.strictEqual((await post('/groups/leave', { id: g.id }, H(steve.token))).s, 409, 'the commissioner cannot leave'); assert.strictEqual((await post('/groups/leave', { id: g.id }, H(tess.token))).s, 200);
    assert.deepStrictEqual((await post('/groups/bet/status', {}, H(tess.token))).j, { betLock: 0, canBet: true }); assert.strictEqual((await post('/groups/mine', {}, H(tess.token))).j.groups.length, 0);
    t('members\' link -> request -> the commissioner approves -> member (betLock 1) -> standings -> leave (betLock 0); the commissioner cannot leave');
    r = await post('/groups/join', { code: g.link }, H(tess.token)); r = await post('/groups/get', { id: g.id }, H(steve.token)); await post('/groups/decide', { id: g.id, pid: r.j.group.reqs[0].pid, ok: true }, H(steve.token));
    // ---- 5. what the others can read ----
    const seenBy = J([(await post('/groups/mine', {}, H(tess.token))).j, (await post('/groups/get', { id: g.id }, H(tess.token))).j, (await post('/groups/standings', { id: g.id }, H(tess.token))).j, (await post('/groups/preview', { code: g.link }, H(tess.token))).j]);
    const steveRow = Object.keys(DB).find((k) => /^[0-9a-f]{64}$/.test(k) && DB[k] && DB[k].data && Array.isArray(DB[k].data.bets)); assert.ok(steveRow, 'there are real account rows in the fake database');
    for (const [what, re] of [['a phone number', /956\D?555\D?000\d/], ['an account id', /@phone\.oddable/], ['a PIN', /112233|445566|778899|991122/], ['a sync row id', /[0-9a-f]{40}/], ['an email', /[\w.]+@[\w.]+\.[a-z]{2,}/i], ['the member key', /"mk"|"sid"|"owner":"[0-9a-f]{24}"|pinhash|salt/]]) assert.ok(!re.test(seenBy), 'another member\'s view holds ' + what);
    assert.ok(!seenBy.includes(g.code), 'the commissioner\'s code is not in a member\'s view');
    const mem = (await post('/groups/get', { id: g.id }, H(tess.token))).j.group.members; assert.deepStrictEqual(Object.keys(mem[0]).sort(), ['comm', 'joined', 'name', 'noBets', 'paid', 'pid', 'sides']); assert.ok(mem.every((m) => /^[A-Za-z0-9]{2,12}$/.test(m.pid)), 'member ids are short random ids: ' + J(mem.map((m) => m.pid)));
    assert.strictEqual((await post('/groups/get', { id: g.id }, H(stranger.token))).s, 403, 'not on the list: nothing'); process.env.GROUPS_TESTERS += ',' + LIM.keyOf((await me(stranger.token)).email);
    assert.strictEqual((await post('/groups/get', { id: g.id }, H(stranger.token))).s, 404, 'on the list but not in the group: "Group not found"'); assert.strictEqual((await post('/groups/standings', { id: g.id }, H(stranger.token))).s, 404);
    t('a member sees names and short member ids only: no phone number, account id, email, PIN, sync row id or member key; a non-member sees nothing of the group');
    assert.strictEqual((await post('/groups/delete', { id: g.id }, H(tess.token))).s, 403); assert.strictEqual((await post('/groups/delete', { id: g.id }, H(steve.token))).s, 200); assert.strictEqual((await post('/groups/mine', {}, H(steve.token))).j.groups.length, 0);
    t('only the commissioner deletes the group (before the start)');

    // ---- 6. open to everyone, then off again: OWNER_ME was never changed ----
    delete process.env.GROUPS_OWNER_ONLY; for (const [who, tok] of ALL) assert.strictEqual((await me(tok)).groups, true, who);
    delete process.env.GROUPS_ENABLED; assert.deepStrictEqual((await get('/acct/status')).j, { gate: true, guest: true }); for (const [who, tok] of ALL) assert.ok(!has(await me(tok)), 'off again: ' + who); assert.ok(!has((await post('/acct/owner', { pin: '4321' })).j.me));
    t('GROUPS_OWNER_ONLY removed = every account is flagged; GROUPS_ENABLED removed = the field is gone for everyone (roll back with no deploy)');
    assert.deepStrictEqual(seen.outside, [], 'only Supabase, My Apps and ESPN were ever called');
  } catch (e) { bad++; console.log('  FAIL ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n        ')); }
  console.log(bad ? '\nGROUPS PHASE 2 (PHONE SWITCH): FAILED' : '\nALL ' + n + ' GROUPS PHASE 2 (PHONE SWITCH) CHECKS PASSED'); srv.close(); process.exit(bad ? 1 : 0);
});
