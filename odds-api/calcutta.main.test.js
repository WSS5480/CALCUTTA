// Run: node odds-api/calcutta.main.test.js   (no network: Supabase, ESPN and My Apps are in-memory fakes behind global fetch)
// MAIN (branch calc-live, Nov 17 2026): the Calcutta auction as a GROUP GAME, through the REAL acct.js, sync.js, groups.js, limits.js, events.js and
// calcutta.js wired like server.js. What this suite checks is what the port added on main: the Groups switches (dark = 403 off for everyone, the owner
// too, with nothing read), an ended account, a Calcutta born inside a group and joined from it, no way in by code, the owner's Activity events
// (calcutta_start / calcutta_sold, once each, with the auction id as key), nothing private in any answer. The engine's own rules (bids, clock, money,
// freeze, results) are the four ported suites: calcutta.test.js, calcutta.review.test.js, calcutta.round3.test.js, calcutta.round4.test.js.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const ENDED = new Set(), J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, EVENTS = [], calls = { db: 0, espn: 0 };
const TEAMS = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), abbreviation: 'T' + (i + 1), displayName: 'Team ' + (i + 1) }));
// this week's PGA Tour event, the scoreboard shape pics/pga.js reads (see its header): state 'pre' -> 'in' -> 'post'
const GOLF = { state: 'pre', down: false, urls: [] }, GOLFERS = [['11', 'Ana Alvarez', -12], ['12', 'Ben Brooks', -12], ['13', 'Cy Cole', -9], ['14', 'Dee Diaz', 4], ['15', 'Eli Evans', -5]];
const golfBoard = () => ({ events: [{ id: '401700', name: 'Fall Classic', date: '2026-11-19T05:00Z', endDate: '2026-11-22T23:00Z', status: { type: { state: GOLF.state, completed: GOLF.state === 'post', name: GOLF.state === 'post' ? 'STATUS_FINAL' : GOLF.state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED' } }, tournament: { numberOfRounds: 4 },
  competitions: [{ competitors: GOLFERS.map(([id, nm, par], i) => { const n = GOLF.state === 'pre' ? 0 : GOLF.state === 'in' ? 1 : par > 0 ? 2 : 4; return { id, order: i + 1, athlete: { displayName: nm }, score: n ? (par > 0 ? '+' + par : String(par)) : '-', linescores: Array.from({ length: n }, (_, k) => ({ period: k + 1, value: 70, displayValue: k === 0 ? (par > 0 ? '+' + par : String(par)) : 'E', linescores: Array.from({ length: 18 }, () => ({ value: 4 })) })) }; }) }] }] });
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); assert.strictEqual(b.secret, 's3cret'); if (p === '/api/v1/event') { EVENTS.push(b); return ok({ ok: true }); } if (p === '/api/v1/account') return ok(Object.assign({ email: b.email, role: 'user', plan: 'pro', expires_on: null }, ENDED.has(b.email) ? { expires_on: '2026-01-01' } : {})); return ok({}); }
  if (url.startsWith('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard')) { calls.espn++; GOLF.urls.push(url); if (GOLF.down) return { ok: false, status: 503, json: async () => ({}) }; return ok(golfBoard()); }
  if (url.startsWith('https://site.api.espn.com/')) { calls.espn++; if (/\/teams\?/.test(url)) return ok({ sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: t })) }] }] }); return ok({ events: [] }); }
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  calls.db++;
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits'), C = require('./calcutta');
const PGAS = require('./calcutta-pga'); PGAS.register(C); // as server.js does on the first /calcutta call
let n = 0, CLOCK = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
C._deps.now = () => Date.now() + CLOCK; // the auction clock (a bid's timer) can be moved forward without waiting
assert.strictEqual(C._cfg.groupOnly, true, 'the live app creates Calcuttas inside a group only');

const srv = http.createServer(async (req, res) => { // the same order and the same calls as server.js
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url.startsWith('/calcutta')) { if (await C.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.8.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} if (url.startsWith('/calcutta')) SEEN.push(txt); return { s: r.status, j }; };
const get = async (url, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { headers: h || {} }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok }), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), SEEN = [];
const OPS = ['peek', 'events', 'teams', 'mine', 'list', 'create', 'gjoin', 'preview', 'join', 'get', 'state', 'board', 'bid', 'ctl', 'buyback', 'por', 'enter', 'unenter', 'result', 'edit', 'delete', 'close', 'guestlink', 'claim'];
const team = (k) => ({ id: String(k), name: 'Team ' + k });
const calcBody = (o) => Object.assign({ name: 'Playoff Calcutta', ev: 'nfl_po', lots: [1, 2, 3, 4].map((k) => ({ teams: [team(k)] })).concat([{ name: 'The field', teams: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(team) }]), rows: [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13 }, { k: 'champ', n: 1, pct: 35 }], minBid: 5, inc: 5, timer: 25, buyBack: false, main: true, take: { kind: 'pct', v: 10 }, order: 'listed', mode: 'live', unsold: 'roll' }, o || {});

srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), stranger = await phoneIn('9565550004', '991122', 'Stranger'), late = await phoneIn('9565550005', '335577', 'Late');
    const tOwner = (await post('/acct/owner', { pin: '4321' })).j.token, email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;
    const secrets = [];

    // ---- 1. dark: no GROUPS_* variable (or anything but exactly "1") ----
    for (const v of [undefined, '0', 'true', ' 1', 'on']) { if (v === undefined) delete process.env.GROUPS_ENABLED; else process.env.GROUPS_ENABLED = v; process.env.GROUPS_OWNER_ONLY = '1';
      const b0 = calls.db, e0 = calls.espn; for (const tok of [tOwner, steve.token, tess.token, '', 'garbage']) for (const op of OPS) { const r = await post('/calcutta/' + op, calcBody({ g: 'ABCDEFGH23', id: 'ABCDEFGH23', code: 'ABCDEFGHJKLM' }), H(tok)); assert.strictEqual(r.s, 403, op); assert.deepStrictEqual(r.j, { error: 'Groups is not open for this account yet.', off: true }, op); }
      assert.strictEqual((await get('/calcutta/mine', H(tOwner))).s, 403); assert.strictEqual(calls.db, b0, 'a blocked caller reads nothing from the database'); assert.strictEqual(calls.espn, e0, 'nor from ESPN'); }
    delete process.env.GROUPS_OWNER_ONLY; await sleep(300); assert.strictEqual(EVENTS.length, 0);
    t('dark (GROUPS_ENABLED unset or not exactly "1"): all ' + OPS.length + ' /calcutta calls, the public peek included, are 403 {off:true} for everyone, the owner too; nothing read, nothing sent');

    // ---- 2. owner-only: the owner and listed testers; an ended account ----
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    const mkGroup = () => ({ name: 'Sunday crew', join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' });
    let r = await post('/groups/create', mkGroup(), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group, gid = g.id;
    for (const tok of [tess.token, bo.token, stranger.token, late.token, '']) for (const op of OPS) { r = await post('/calcutta/' + op, calcBody({ g: gid }), H(tok)); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.off, true, op); }
    const keys = []; for (const p of [tess, bo, stranger, late]) { const em = await email(p.token); secrets.push(em); keys.push(LIM.keyOf(em)); } process.env.GROUPS_TESTERS = keys.join(','); secrets.push(await email(steve.token));
    for (const [p, nm] of [[tess, 'Tess'], [bo, 'Bo'], [late, 'Late']]) { r = await post('/groups/join', { code: g.code, myName: nm }, H(p.token)); assert.strictEqual(r.s, 200, J(r.j)); }
    const lateAcct = await email(late.token); ENDED.add(lateAcct); ACCT.uncache(lateAcct);
    for (const op of OPS) { r = await post('/calcutta/' + op, calcBody({ g: gid }), H(late.token)); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.expired, true, op); assert.match(r.j.error, /^Your time has ended\./); }
    r = await post('/calcutta/events', {}, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); r = await post('/calcutta/events', {}, H(tess.token)); assert.strictEqual(r.s, 200);
    t('owner-only: an account not on the list gets 403 {off:true}; an ended account on the list gets 403 {expired:true} "Your time has ended" on every call; the owner and testers get in');

    // ---- 3. a Calcutta is born inside a group, by its commissioner ----
    r = await post('/calcutta/create', calcBody(), H(steve.token)); assert.strictEqual(r.s, 404, J(r.j)); assert.match(r.j.error, /Group not found/);
    r = await post('/calcutta/create', calcBody({ g: 'ZZZZZZZZZZ' }), H(steve.token)); assert.strictEqual(r.s, 403, 'a group that does not exist');
    r = await post('/calcutta/create', calcBody({ g: gid }), H(stranger.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'group', 'not a member of that group');
    r = await post('/calcutta/create', calcBody({ g: gid }), H(tess.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'groupcomm', 'a member, not the commissioner');
    r = await post('/calcutta/create', calcBody({ g: gid, ev: 'pga_season' }), H(steve.token)); assert.strictEqual(r.s, 400); assert.match(r.j.error, /coming soon/);
    r = await post('/calcutta/create', calcBody({ g: gid }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const c1 = r.j.calc, id = c1.id;
    assert.deepStrictEqual(c1.group, { groupId: gid, contestId: '' }); assert.strictEqual(c1.role, 'comm'); assert.strictEqual(c1.members[0].name, 'Steve', 'the name the group shows');
    r = await post('/calcutta/events', {}, H(steve.token)); const evs = r.j.events; ['nfl_po', 'nfl_season', 'cfp', 'nfl_wk', 'cfb_wk', 'custom', 'golf'].forEach((k) => assert.ok(evs.find((e) => e.key === k && e.on), k + ' on')); ['pga_season', 'golf-day', 'local'].forEach((k) => assert.ok(evs.find((e) => e.key === k && !e.on), k + ' coming soon'));
    t('create: only inside a group (no group = 404, not a member = 403 group, a member = 403 groupcomm), by its commissioner; football main / side / weekly, custom and this week’s PGA event on; PGA season, golf day, local events "coming soon"');

    // ---- 4. the group's list; joining from the group; no way in by code ----
    r = await post('/calcutta/list', { g: gid }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual(r.j.calcs.map((x) => [x.id, x.name, x.joined, x.comm, x.status, x.people]), [[id, 'Playoff Calcutta', false, false, 'setup', 1]]); assert.strictEqual(r.j.comm, false); assert.strictEqual(r.j.group, 'Sunday crew');
    r = await post('/calcutta/list', { g: gid }, H(steve.token)); assert.strictEqual(r.j.comm, true); assert.strictEqual(r.j.calcs[0].comm, true); assert.strictEqual(r.j.calcs[0].joined, true);
    r = await post('/calcutta/list', { g: gid }, H(stranger.token)); assert.strictEqual(r.s, 403); r = await post('/calcutta/list', { g: 'nope' }, H(tess.token)); assert.strictEqual(r.s, 404);
    r = await post('/calcutta/get', { id }, H(tess.token)); assert.strictEqual(r.s, 404, 'not joined yet: nothing to read');
    r = await post('/calcutta/gjoin', { id, preview: true }, H(tess.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.calc.role, 'none');
    r = await post('/calcutta/gjoin', { id }, H(stranger.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'group');
    r = await post('/calcutta/gjoin', { id, myName: 'Somebody Else' }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.calc.role, 'member'); assert.ok(r.j.calc.members.some((m) => m.name === 'Tess'), 'the group\'s name, not a typed one');
    r = await post('/calcutta/gjoin', { id }, H(bo.token)); assert.strictEqual(r.s, 200);
    const code = c1.code; assert.match(code, /^[A-Z2-9]{12}$/);
    r = await post('/calcutta/peek', { code }, H(stranger.token)); assert.strictEqual(r.s, 404); r = await post('/calcutta/preview', { code }, H(stranger.token)); assert.strictEqual(r.s, 404); r = await post('/calcutta/join', { code }, H(stranger.token)); assert.strictEqual(r.s, 404);
    r = await post('/calcutta/list', { g: gid }, H(tess.token)); assert.strictEqual(r.j.calcs[0].joined, true); assert.strictEqual(r.j.calcs[0].people, 3);
    t('list = the group\'s Calcuttas for its members (403 for others); members join from the group (gjoin, preview first) with the name the group shows; no peek, preview or join by code');

    // ---- 5. a live auction and the owner's Activity events ----
    await sleep(300); const ev0 = EVENTS.length; assert.strictEqual(EVENTS.filter((e) => /^calcutta/.test(e.type)).length, 0, 'making a Calcutta is not "started"');
    r = await post('/calcutta/bid', { id, lot: 'L1', amt: 5 }, H(tess.token)); assert.strictEqual(r.s, 409, 'not started');
    r = await post('/calcutta/ctl', { id, op: 'start' }, H(tess.token)); assert.strictEqual(r.s, 403);
    r = await post('/calcutta/ctl', { id, op: 'start' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.calc.a.status, 'live'); assert.strictEqual(r.j.calc.a.cur, 'L1');
    r = await post('/calcutta/bid', { id, lot: 'L1', amt: 10 }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); const e1 = r.j.calc.a.endsAt;
    CLOCK += 5000; r = await post('/calcutta/bid', { id, lot: 'L1', amt: 15 }, H(bo.token)); assert.strictEqual(r.s, 200); assert.ok(r.j.calc.a.endsAt >= e1 + 5000 - 50, 'every bid resets the timer');
    r = await post('/calcutta/ctl', { id, op: 'pause' }, H(steve.token)); assert.strictEqual(r.j.calc.a.paused, true); r = await post('/calcutta/bid', { id, lot: 'L1', amt: 20 }, H(tess.token)); assert.strictEqual(r.s, 409);
    r = await post('/calcutta/ctl', { id, op: 'resume' }, H(steve.token)); assert.strictEqual(r.j.calc.a.paused, false);
    CLOCK += 26000; r = await post('/calcutta/state', { id, rev: 0 }, H(tess.token)); assert.strictEqual(r.s, 200); assert.ok(r.j.calc.sold.some((s) => s.lot === 'L1' && s.amt === 15 && s.holder.name === 'Bo'), 'the timer sold L1 to Bo during a poll');
    CLOCK += 9000; r = await post('/calcutta/state', { id, rev: 0 }, H(bo.token)); assert.strictEqual(r.j.calc.a.cur, 'L2', 'the next lot opens by itself');
    r = await post('/calcutta/bid', { id, lot: 'L2', amt: 5 }, H(steve.token)); assert.strictEqual(r.s, 200); r = await post('/calcutta/ctl', { id, op: 'sold' }, H(steve.token)); assert.strictEqual(r.s, 200);
    r = await post('/calcutta/ctl', { id, op: 'undo' }, H(steve.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.calc.a.cur, 'L2', 'undo the sale: back on the block');
    CLOCK += 2000; r = await post('/calcutta/ctl', { id, op: 'sold' }, H(steve.token)); assert.strictEqual(r.s, 200, 'sold again');
    r = await post('/calcutta/ctl', { id, op: 'next' }, H(steve.token)); assert.strictEqual(r.j.calc.a.cur, 'L3');
    await sleep(900); const ce = EVENTS.slice(ev0).filter((e) => /^calcutta/.test(e.type));
    assert.deepStrictEqual(ce.map((e) => [e.type, e.title, e.key]), [['calcutta_start', 'Calcutta started: Playoff Calcutta', 'calcutta_start|' + id], ['calcutta_sold', 'Calcutta sold: Team 1', ce[1].key], ['calcutta_sold', 'Calcutta sold: Team 2', ce[2].key], ['calcutta_sold', 'Calcutta sold: Team 2', ce[3].key]]);
    assert.match(ce[1].key, new RegExp('^calcutta_sold\\|' + id + '\\|L1\\|\\d+$')); assert.notStrictEqual(ce[2].key, ce[3].key, 'an undone and re-sold lot is told again with its own key');
    assert.strictEqual(ce[1].detail, 'To Bo for $15. Group: Sunday crew'); assert.strictEqual(ce[2].detail, 'To Steve for $5. Group: Sunday crew'); assert.match(ce[0].detail, /^Group: Sunday crew\. NFL playoffs\. Live auction$/);
    // a poll that changes nothing tells nothing again
    r = await post('/calcutta/state', { id, rev: 0 }, H(tess.token)); r = await post('/calcutta/board', { id }, H(tess.token)); assert.strictEqual(r.s, 200); await sleep(400); assert.strictEqual(EVENTS.slice(ev0).filter((e) => /^calcutta/.test(e.type)).length, 4);
    t('live auction through the gate (start, bids reset the timer, pause / resume, the timer sells during a poll, next lot by itself, Sold now, Undo, re-sale); Activity: one calcutta_start, one calcutta_sold per sale (keys = auction id + lot + sale time)');

    // ---- 6. held in person: the first lot entered starts it ----
    r = await post('/calcutta/create', calcBody({ g: gid, name: 'Bar night', mode: 'manual', main: false }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const id2 = r.j.calc.id; assert.strictEqual(r.j.calc.rules.main, false, 'a side Calcutta');
    await post('/calcutta/gjoin', { id: id2 }, H(tess.token)); const tessPid = (await post('/calcutta/get', { id: id2 }, H(tess.token))).j.calc.me;
    const ev1 = EVENTS.length; r = await post('/calcutta/enter', { id: id2, lot: 'L1', amt: 40, pid: tessPid }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); r = await post('/calcutta/enter', { id: id2, lot: 'L1', amt: 45, pid: tessPid }, H(steve.token)); assert.strictEqual(r.s, 200, 'a change');
    r = await post('/calcutta/enter', { id: id2, lot: 'L2', amt: 30, name: 'Uncle Ray' }, H(steve.token)); assert.strictEqual(r.s, 200);
    await sleep(900); const me2 = EVENTS.slice(ev1).filter((e) => /^calcutta/.test(e.type)); assert.deepStrictEqual(me2.map((e) => [e.type, e.title]), [['calcutta_start', 'Calcutta started: Bar night'], ['calcutta_sold', 'Calcutta sold: Team 1'], ['calcutta_sold', 'Calcutta sold: Team 2']], 'a changed entry is not a new sale'); assert.match(me2[0].detail, /Held in person$/);
    r = await post('/calcutta/list', { g: gid }, H(tess.token)); assert.deepStrictEqual(r.j.calcs.map((x) => x.name).sort(), ['Bar night', 'Playoff Calcutta']);
    r = await post('/calcutta/claim', { token: 'ABCDEFGHJK-ABCDEFGHJKLMNPQRSTUV' }, H(tess.token)); assert.strictEqual(r.s, 404); r = await post('/calcutta/guestlink', { id: id2, guest: 'x' }, H(steve.token)); assert.strictEqual(r.s, 404, 'no guest claim links in a group');
    C._reset(); // the create limit per account (5 in a while) was spent on part 3's refusals
    r = await post('/calcutta/create', calcBody({ g: gid, name: 'Club pairs', ev: 'custom', mode: 'manual', buyBack: true, lots: [{ name: 'Lee / Cruz', teams: [{ id: 'a', name: 'Lee / Cruz' }], por: [{ guest: true, name: 'Lee' }] }, { name: 'Diaz / Kim', teams: [{ id: 'b', name: 'Diaz / Kim' }] }], rows: [{ k: 'place', r: 1, n: 1, pct: 100 }] }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.guestLinks, undefined, 'a guest is a name on a lot, no link handed out'); assert.strictEqual(r.j.calc.rules.buyBack, true, 'buy back half on a custom (local) Calcutta');
    t('held in person: the first entered lot = calcutta_start, each new lot = calcutta_sold, a changed entry tells nothing; a Side Calcutta is listed with the group too; custom lots with buy back half; no guest claim links');

    // ---- 6b. this week's PGA Tour event (calcutta-pga.js over pics/pga.js) ----
    C._reset(); // the create limit (per account) was spent on the refusals in part 3; a fresh process
    r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const field = r.j.teams; assert.deepStrictEqual(field.map((x) => [x.id, x.name]), GOLFERS.map(([id, nm]) => ['e401700d20261119:p' + id, nm]));
    r = await post('/calcutta/teams', { ev: 'golf', golf: { tour: 'pga', eventId: '999' } }, H(steve.token)); assert.deepStrictEqual(r.j.teams, [], 'another event: no field');
    r = await post('/calcutta/create', calcBody({ g: gid, name: 'Fall Classic', ev: 'golf', mode: 'manual', lots: field.slice(0, 3).map((x) => ({ teams: [x] })).concat([{ name: 'The field', teams: field.slice(3) }]), rows: [{ k: 'place', r: 1, n: 1, pct: 60 }, { k: 'place', r: 2, n: 1, pct: 25 }, { k: 'place', r: 3, n: 1, pct: 15 }] }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const gc = r.j.calc.id; assert.strictEqual((await post('/calcutta/gjoin', { id: gc }, H(tess.token))).s, 200);
    r = await post('/calcutta/create', calcBody({ g: gid, name: 'x', ev: 'golf', buyBack: true, lots: field.slice(0, 2).map((x) => ({ teams: [x] })) }), H(steve.token)); assert.strictEqual(r.s, 400, 'pro golfers: no buy back');
    r = await post('/calcutta/enter', { id: gc, lot: 'L1', amt: 50, name: 'Uncle Ray' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); r = await post('/calcutta/enter', { id: gc, lot: 'L2', amt: 40, name: 'Aunt May' }, H(steve.token)); assert.strictEqual(r.s, 200);
    GOLF.state = 'in'; PGAS._reset(); CLOCK += 10000; r = await post('/calcutta/enter', { id: gc, lot: 'L3', amt: 30, name: 'Cousin Al' }, H(steve.token)); assert.strictEqual(r.s, 409, 'play under way: ownership is frozen for good');
    GOLF.down = true; PGAS._reset(); CLOCK += 10000; r = await post('/calcutta/state', { id: gc, rev: 0 }, H(steve.token)); assert.strictEqual(r.s, 200); GOLF.down = false;
    GOLF.state = 'post'; PGAS._reset(); CLOCK += 6 * 6e4; await post('/calcutta/board', { id: gc }, H(tess.token)); await sleep(300); /* a page shows the last read and reads again behind it (5 min cache) */ r = await post('/calcutta/board', { id: gc }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j));
    const pl = {}; r.j.board.lots.forEach((l) => l.teams.forEach((x) => { pl[x.name] = x.r ? (x.r.out ? 'out' : x.r.place) : null; })); assert.deepStrictEqual(pl, { 'Ana Alvarez': 1, 'Ben Brooks': 1, 'Cy Cole': 3, 'Dee Diaz': 'out', 'Eli Evans': 4 }, 'a tie at the top shares 1st; the missed cut is out');
    assert.ok(GOLF.urls.some((u) => /scoreboard$/.test(u)), 'the scoreboard of this week');
    t('PGA Tour event: the field from the scoreboard (via pics/pga.js) as lots, no buy back for pros, frozen once play starts, final places with ties, the missed cut out');

    // ---- 7. events switched off; nothing private anywhere ----
    process.env.EVENTS_ENABLED = '0'; const ev2 = EVENTS.length; CLOCK += 1000; r = await post('/calcutta/bid', { id, lot: 'L3', amt: 5 }, H(tess.token)); assert.strictEqual(r.s, 200); r = await post('/calcutta/ctl', { id, op: 'sold' }, H(steve.token)); assert.strictEqual(r.s, 200); await sleep(600); assert.strictEqual(EVENTS.length, ev2, 'EVENTS_ENABLED=0: nothing sent'); delete process.env.EVENTS_ENABLED;
    const all = SEEN.join('\n') + J(EVENTS.filter((e) => /^calcutta/.test(e.type))); /* the Calcutta answers and the Calcutta events (the group events carry the acting account to the owner's own My Apps by design, events.js) */ secrets.forEach((s) => { const i = all.indexOf(s); assert.ok(i < 0, 'an account email in an answer or event: ' + all.slice(Math.max(0, i - 300), i + 60)); });
    [steve, tess, bo, stranger, late].forEach((p) => { assert.ok(!all.includes(p.token.slice(-24)), 'a token'); }); assert.ok(!/9565550\d{3}|956-555|"mk"|"ak"|@phone\.oddable/.test(all), 'no phone number, member key or account key');
    assert.ok(!/"pay(ment)?Url|checkout|cashapp|venmo|stripe/i.test(all), 'no payment path');
    t('EVENTS_ENABLED=0 sends nothing; no account email, phone number, token, member key or payment path in any answer or event');

    // ---- 8. switched off again: blocked at once, nothing read ----
    delete process.env.GROUPS_ENABLED; const b1 = calls.db; for (const op of OPS) { r = await post('/calcutta/' + op, { id, g: gid }, H(steve.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true); } assert.strictEqual(calls.db, b1);
    t('GROUPS_ENABLED removed: every call is 403 {off:true} at once, nothing read; the rows stay (nothing deleted)');
  } catch (e) { failed++; console.error('FAIL', e); }
  srv.close(); console.log(failed ? '\nFAILED' : '\nPASS ' + n + ' calcutta main-line checks'); process.exit(failed ? 1 : 0);
});
