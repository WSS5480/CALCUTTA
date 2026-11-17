// Run: node odds-api/localevents.main.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// MAIN PORT of the pickleball / local games engine (localevents.js) as a GROUP game. Every check goes through the REAL acct.js, sync.js, groups.js,
// limits.js, events.js (Activity) and localevents.js wired like server.js: the switch (LOCALEVENTS_ENABLED) and the Groups switches, the `me` flag, the
// group-only rule, the group list (glist), join from the group, the invite link and the 8-person cap, and that the group row itself is never changed.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED', 'LOCALEVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const ENDED = new Set(), J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, EVENTS = [], dbCalls = { n: 0 };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); assert.strictEqual(b.secret, 's3cret'); if (p === '/api/v1/event') { EVENTS.push(b); return ok({ ok: true }); } if (p === '/api/v1/account') return ok(Object.assign({ email: b.email, role: 'user', plan: 'pro', expires_on: null }, ENDED.has(b.email) ? { expires_on: '2026-01-01' } : {})); return ok({}); }
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  dbCalls.n++;
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits'), LE = require('./localevents');
let n = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
const srv = http.createServer(async (req, res) => { // the same order as server.js
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url.startsWith('/levents')) { if (await LE.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.7.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const get = async (url, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { headers: h || {} }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok }), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPS = ['peek', 'mine', 'glist', 'create', 'preview', 'join', 'gjoin', 'get', 'score', 'confirm', 'finish'];
srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const ppl = {}; for (const [i, nm] of ['Steve', 'Tess', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Stranger', 'Late'].entries()) ppl[nm] = await phoneIn('95655500' + String(i + 1).padStart(2, '0'), '1122' + String(33 + i), nm);
    const tOwner = (await post('/acct/owner', { pin: '4321' })).j.token, email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;
    const steve = ppl.Steve, tess = ppl.Tess;
    const ev0 = () => ({ title: 'Saturday Smash', sport: 'pickleball', fmt: 'rr', unit: 'singles', to: 11, winBy: 2, bestOf: 1, start: Date.now() + 864e5, playIn: true, myName: 'Steve', entrants: [], self: true, spectators: true, seeding: 'random', courts: 2, pools: 1, playoff: 0, scorer: 'a', entry: 0, pot: 'main', split: 'none', take: { kind: 'none', v: 0 } });

    // ---- 1. dark: switch unset (or anything but "1"), Groups on or off ----
    for (const gv of [undefined, '1']) for (const v of [undefined, '0', 'true', ' 1', 'on', 'yes']) {
      if (gv === undefined) delete process.env.GROUPS_ENABLED; else process.env.GROUPS_ENABLED = gv; if (v === undefined) delete process.env.LOCALEVENTS_ENABLED; else process.env.LOCALEVENTS_ENABLED = v;
      const before = dbCalls.n; for (const tok of [tOwner, steve.token, tess.token, '', 'garbage']) for (const op of OPS) { const r = await post('/levents/' + op, { code: 'ABCD-EFGH', groupId: 'ABCDEFGH23', id: 'X' }, H(tok)); assert.strictEqual(r.s, 403, op + ' ' + v); assert.deepStrictEqual(r.j, { error: 'Pickleball & local games are not open for this account yet.', off: true }); }
      assert.strictEqual((await get('/levents/mine', H(tOwner))).s, 403); assert.strictEqual(dbCalls.n, before, 'a blocked caller reads nothing from the database');
      const st = await get('/acct/status'); assert.ok(!('levents' in st.j), '/acct/status says nothing'); const me = (await post('/acct/me', {}, H(steve.token))).j.me; assert.ok(!('levents' in me), 'me says nothing');
    }
    process.env.LOCALEVENTS_ENABLED = '1'; delete process.env.GROUPS_ENABLED;
    { const r = await post('/levents/mine', {}, H(tOwner)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true, 'LOCALEVENTS_ENABLED=1 without Groups = still off'); assert.ok(!('levents' in (await get('/acct/status')).j)); }
    assert.strictEqual(EVENTS.length, 0);
    t('LOCALEVENTS_ENABLED unset (or anything but exactly "1"), or Groups off: every /levents call is 403 {off:true} for everyone, the owner too; nothing read; /acct/status and me are unchanged');

    // ---- 2. owner-only (the Groups list), the flag, an ended account ----
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    assert.strictEqual((await get('/acct/status')).j.levents, true, '/acct/status: the game exists');
    assert.strictEqual((await post('/acct/me', {}, H(steve.token))).j.me.levents, true, 'the owner phone has the flag'); assert.ok(!('levents' in (await post('/acct/me', {}, H(tess.token))).j.me), 'not on the list = no flag');
    let r = await post('/levents/mine', {}, H(tess.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true);
    r = await post('/levents/peek', { code: 'ABCD-EFGH' }, {}); assert.strictEqual(r.s, 403, 'signed out during the owner-only test: off (like Groups invite previews)');
    const keys = {}; for (const nm of Object.keys(ppl)) keys[nm] = LIM.keyOf(await email(ppl[nm].token)); process.env.GROUPS_TESTERS = Object.keys(ppl).filter((x) => x !== 'Steve').map((x) => keys[x]).join(',');
    assert.strictEqual((await post('/acct/me', {}, H(tess.token))).j.me.levents, true, 'a tester gets the flag');
    process.env.LOCALEVENTS_ENABLED = '0'; assert.ok(!('levents' in (await post('/acct/me', {}, H(tess.token))).j.me), 'switch off again: the flag goes, Groups stays'); assert.strictEqual((await post('/acct/me', {}, H(tess.token))).j.me.groups, true); process.env.LOCALEVENTS_ENABLED = '1';
    const lateAcct = await email(ppl.Late.token); ENDED.add(lateAcct); ACCT.uncache(lateAcct);
    r = await post('/levents/mine', {}, H(ppl.Late.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.expired, true); assert.match(r.j.error, /^Your time has ended\./);
    t('owner-only test: the owner and the Groups testers only (me.levents and /acct/status.levents only while both switches are on); an ended account gets 403 expired');

    // ---- 3. group only: create needs a group and its commissioner; the group row is untouched ----
    r = await post('/groups/create', { name: 'Dink crew', join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group, gid = g.id;
    for (const nm of ['Tess', 'Bo', 'Cy', 'Dee', 'Eve', 'Fay', 'Late']) { const x = await post('/groups/join', { code: g.code, myName: nm }, H(ppl[nm].token)); if (nm !== 'Late') assert.strictEqual(x.s, 200, nm + ' ' + J(x.j)); }
    const grow0 = J(DB['lock:grp:' + gid] && DB['lock:grp:' + gid].data && DB['lock:grp:' + gid].data.contests);
    r = await post('/levents/create', ev0(), H(steve.token)); assert.strictEqual(r.s, 400); assert.match(r.j.error, /from your group/);
    r = await post('/levents/create', Object.assign(ev0(), { groupId: gid, myName: 'Tess' }), H(tess.token)); assert.strictEqual(r.s, 403); assert.match(r.j.error, /commissioner/);
    r = await post('/levents/create', Object.assign(ev0(), { groupId: gid }), H(ppl.Stranger.token)); assert.strictEqual(r.s, 403);
    r = await post('/levents/create', Object.assign(ev0(), { groupId: gid }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const ev = r.j.event;
    assert.strictEqual(J(DB['lock:grp:' + gid].data.contests), grow0, 'the group row (its contests) is not changed: like Golf days, the event keeps the group id');
    for (let w = 0; w < 100 && !EVENTS.some((x) => x.type === 'pickleball_start'); w++) await sleep(100); await sleep(300); const act = EVENTS.filter((x) => x.type === 'pickleball_start'); assert.strictEqual(act.length, 1, J(EVENTS)); assert.strictEqual(act[0].title, 'Pickleball started: Saturday Smash'); assert.strictEqual(act[0].key, 'pickleball_start|' + gid + '|' + ev.id); assert.match(act[0].detail, /Group: Dink crew/); assert.strictEqual(act[0].account, await email(steve.token));
    assert.ok(!/@|9565550|acct|lock:/.test(J(act[0].detail) + act[0].title), 'no contact data in the Activity text');
    t('create: only from a group (400 without), only by that group\'s commissioner (403 member / stranger); the group row is untouched; one pickleball_start Activity event to My Apps');

    // ---- 4. glist: members only; one group's events ----
    r = await post('/levents/glist', { groupId: gid }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual([r.j.comm, r.j.events.length, r.j.events[0].id, r.j.events[0].role], [false, 1, ev.id, 'none']);
    r = await post('/levents/glist', { groupId: gid }, H(steve.token)); assert.deepStrictEqual([r.j.comm, r.j.events[0].role], [true, 'comm']);
    r = await post('/levents/glist', { groupId: gid }, H(ppl.Stranger.token)); assert.strictEqual(r.s, 403); assert.match(r.j.error, /members of this group/);
    for (const bad of ['', 'x#', 'lock:grp:x' + 'x'.repeat(40)]) { r = await post('/levents/glist', { groupId: bad }, H(steve.token)); assert.strictEqual(r.s, 404, J(bad)); }
    r = await post('/levents/glist', { groupId: 'NOPENOPE22' }, H(steve.token)); assert.strictEqual(r.s, 403);
    assert.ok(!/@phone|9565550|"mk"|"ak"|"ce"/.test(J(r.j) + J((await post('/levents/glist', { groupId: gid }, H(tess.token))).j)), 'no account ids or member keys in the list');
    t('glist: one group\'s events for its members (role, people, state), commissioner flag; a non-member 403; bad ids 404; nothing private');

    // ---- 5. join from the group; invite link; members only; cap 8 ----
    r = await post('/levents/gjoin', { id: ev.id, preview: true }, H(tess.token)); assert.strictEqual(r.s, 200); r = await post('/levents/gjoin', { id: ev.id, as: 'player', myName: 'Tess' }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.event.role, 'player');
    r = await post('/levents/gjoin', { id: ev.id, as: 'player', myName: 'X' }, H(ppl.Stranger.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'group');
    r = await post('/levents/preview', { code: ev.code }, H(ppl.Stranger.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.event.groupOnly, true, 'a stranger with the link sees "this event belongs to a group"');
    r = await post('/levents/join', { code: ev.code, as: 'player', myName: 'X' }, H(ppl.Stranger.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'group');
    r = await post('/levents/join', { code: ev.code, as: 'player', myName: 'Bo' }, H(ppl.Bo.token)); assert.strictEqual(r.s, 200, 'a member joins with the invite link'); 
    for (const nm of ['Cy', 'Dee', 'Eve', 'Fay']) { r = await post('/levents/gjoin', { id: ev.id, as: 'player', myName: nm }, H(ppl[nm].token)); assert.strictEqual(r.s, 200, nm + J(r.j)); }
    // 7 people now (Steve + 6); Gus fills the group (8 max) and the event
    r = await post('/groups/join', { code: g.code, myName: 'Gus' }, H(ppl.Gus.token)); const gusIn = r.s === 200;
    if (gusIn) { r = await post('/levents/gjoin', { id: ev.id, as: 'player', myName: 'Gus' }, H(ppl.Gus.token)); assert.strictEqual(r.s, 200, J(r.j)); }
    const mem = DB['lock:evt:' + ev.id].data.members.length; assert.strictEqual(mem, gusIn ? 8 : 7, 'everyone who joined is in'); assert.ok(mem <= 8, 'never more than 8 people (the 9th is refused in localevents.fix.test.js capWording)');
    t('join from the group (members only, gjoin), the invite link works for members, a stranger with the link sees "belongs to a group" and is refused; never more than 8 people');

    // ---- 6. switch off again: blocked at once, nothing deleted ----
    delete process.env.LOCALEVENTS_ENABLED; const before = dbCalls.n; r = await post('/levents/get', { id: ev.id }, H(steve.token)); assert.strictEqual(r.s, 403); assert.strictEqual(dbCalls.n, before); assert.ok(DB['lock:evt:' + ev.id], 'the event row is kept');
    process.env.LOCALEVENTS_ENABLED = '1'; r = await post('/levents/get', { id: ev.id }, H(steve.token)); assert.strictEqual(r.s, 200);
    t('switching LOCALEVENTS_ENABLED off blocks every call at once (nothing read, nothing deleted); on again = as it was');

    // ---- 7. review M2 / main preserved: every touched main file is main's plus added lines (and the two listed replacements shared with feat/calcutta-on-main) ----
    require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '..', 'scripts', 'localevents', 'main-preserved.js')], { stdio: 'pipe' });
    t('main\'s code preserved in every touched file (scripts/localevents/main-preserved.js)');
  } catch (e) { failed++; console.error('FAIL', e && e.stack || e); }
  console.log(failed ? '\nFAILED' : '\nPASS ' + n + ' main-line checks'); srv.close(); process.exit(failed ? 1 : 0);
});
