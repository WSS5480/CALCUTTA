// Run: node odds-api/calcutta.fixes.test.js   (no network: Supabase, ESPN and My Apps are in-memory fakes behind global fetch)
// calc-live, review of fc5a111 (Nov 17 2026): the fixes, checked through the REAL acct.js, sync.js, groups.js, limits.js, events.js, calcutta.js and
// calcutta-pga.js wired like server.js. The two reviewers' repros (probe1-4, money, money2, the slow My Apps run t9, the double-tapped Undo t12) are
// here as assertions. Dates are fixed (the clock is moved), so the suite does not depend on the day it runs.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, calls = { db: 0, espn: 0 };
const TEAMS = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), abbreviation: 'T' + (i + 1), displayName: 'Team ' + (i + 1) }));
// this week's PGA Tour event (the shape pics/pga.js reads). GOLF.tee = a first tee time listed per golfer (ESPN's "Thu Nov 19 07:45:00 EST 2026")
const GOLF = { state: 'pre', down: false, delay: 0, tee: null, urls: [] }, GOLFERS = [['11', 'Ana Alvarez', -12], ['12', 'Ben Brooks', -12], ['13', 'Cy Cole', -9], ['14', 'Dee Diaz', 4], ['15', 'Eli Evans', -5]];
const golfBoard = () => ({ events: [{ id: '401700', name: 'Fall Classic', date: '2026-11-19T05:00Z', endDate: '2026-11-22T23:00Z', status: { type: { state: GOLF.state, completed: GOLF.state === 'post', name: GOLF.state === 'post' ? 'STATUS_FINAL' : GOLF.state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED' } }, tournament: { numberOfRounds: 4 },
  competitions: [{ competitors: GOLFERS.map(([id, nm, par], i) => { const n = GOLF.state === 'pre' ? 0 : GOLF.state === 'in' ? 1 : par > 0 ? 2 : 4; const ls = Array.from({ length: n }, (_, k) => ({ period: k + 1, value: 70, displayValue: k === 0 ? (par > 0 ? '+' + par : String(par)) : 'E', linescores: Array.from({ length: 18 }, () => ({ value: 4 })) }));
    if (GOLF.tee && !ls.length) ls.push({ period: 1, value: 0, displayValue: '-', statistics: { categories: [{ stats: [{ displayValue: GOLF.tee }] }] } }); return { id, order: i + 1, athlete: { displayName: nm }, score: n ? (par > 0 ? '+' + par : String(par)) : '-', linescores: ls }; }) }] }] });
const NFL = { pages: {} };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); if (p === '/api/v1/account') return ok({ email: b.email, role: 'user', plan: 'pro', expires_on: null }); return ok({ ok: true }); }
  if (url.startsWith('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard')) { calls.espn++; GOLF.urls.push(url); if (GOLF.delay) await new Promise((ok) => setTimeout(ok, GOLF.delay)); if (GOLF.down) return { ok: false, status: 503, json: async () => ({}) }; return ok(golfBoard()); }
  if (url.startsWith('https://site.api.espn.com/')) { calls.espn++; if (/\/teams\?/.test(url)) return ok({ sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: t })) }] }] }); const m = /dates=(\d{8})/.exec(url); return ok({ events: (m && NFL.pages[m[1]]) || [] }); }
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  calls.db++;
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), C = require('./calcutta');
const PGAS = require('./calcutta-pga'); PGAS.register(C);
let n = 0, CLOCK = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
C._deps.now = () => Date.now() + CLOCK; const at = (iso) => { CLOCK = Date.parse(iso) - Date.now(); };
// H1: My Apps can be made slow for the "has this account's time ended?" check only (acct.expired answers false when My Apps fails, as in acct.js)
let SLOW = 0; const A0 = C._deps.acct; C._deps.acct = () => Object.assign({}, A0(), { expiredState: async (e) => { if (SLOW) { await new Promise((ok) => setTimeout(ok, SLOW)); return 'unknown'; } return A0().expiredState(e); } }); // My Apps hanging then failing = 'unknown' (acct.expiredState)
const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url.startsWith('/calcutta')) { if (await C.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.9.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok }), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const team = (k) => ({ id: String(k), name: 'Team ' + k });
const calcBody = (o) => Object.assign({ name: 'Playoff Calcutta', ev: 'nfl_po', lots: [1, 2, 3, 4].map((k) => ({ teams: [team(k)] })).concat([{ name: 'The field', teams: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(team) }]), rows: [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13 }, { k: 'champ', n: 1, pct: 35 }], minBid: 5, inc: 5, timer: 25, buyBack: false, main: true, take: { kind: 'none' }, order: 'listed', mode: 'live', unsold: 'roll' }, o || {});
const PLACES = [{ k: 'place', r: 1, n: 1, pct: 50 }, { k: 'place', r: 2, n: 1, pct: 20 }, { k: 'place', r: 3, n: 1, pct: 10 }, { k: 'place', r: 4, n: 1, pct: 10 }, { k: 'place', r: 5, n: 1, pct: 10 }];
const polls = async (id, tok, k) => { for (let i = 0; i < (k || 4); i++) { await post('/calcutta/state', { id, rev: 0 }, H(tok)); await sleep(80); } };
const C2 = (x) => Math.round(x * 100);

srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port;
  try {
    process.env.GROUPS_ENABLED = '1'; at('2026-11-17T18:00:00Z'); // a Tuesday
    const phoneIn = async (phone, pin, name) => { await post('/sync/signup', { phone, pin, data: { bets: [] } }); const x = await post('/acct/phone', { phone, pin, name }); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), str = await phoneIn('9565550004', '991122', 'Stranger'), late = await phoneIn('9565550005', '335577', 'Late');
    const mkGroup = (nm, my) => ({ name: nm, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: my });
    let r = await post('/groups/create', mkGroup('Group A', 'Steve'), H(steve.token)); const gA = r.j.group;
    for (const [p, nm] of [[tess, 'Tess'], [bo, 'Bo']]) await post('/groups/join', { code: gA.code, myName: nm }, H(p.token));
    r = await post('/groups/create', mkGroup('Group B', 'Stranger'), H(str.token)); const gB = r.j.group; await post('/groups/join', { code: gB.code, myName: 'Late' }, H(late.token));

    // ---- 1. F10: another group's Calcutta is 404 on every route, before any feed is read (probe1) ----
    r = await post('/calcutta/teams', { ev: 'golf' }, H(str.token)); const f5 = r.j.teams; assert.strictEqual(f5.length, 5);
    r = await post('/calcutta/create', calcBody({ g: gB.id, name: 'B golf', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(str.token)); assert.strictEqual(r.s, 200, J(r.j)); const idB = r.j.calc.id;
    const u0 = GOLF.urls.length, e0 = calls.espn; PGAS._reset(); C._reset(); at('2026-11-17T18:10:00Z');
    for (const [op, b] of [['get', {}], ['state', { rev: 0 }], ['board', {}], ['bid', { lot: 'L1', amt: 5 }], ['ctl', { op: 'start' }], ['enter', { lot: 'L1', amt: 5, name: 'Zed' }], ['unenter', { lot: 'L1' }], ['result', { team: f5[0].id, place: 1 }], ['buyback', { lot: 'L1' }], ['por', { lot: 'L1' }], ['edit', {}], ['delete', {}], ['close', {}]]) {
      r = await post('/calcutta/' + op, Object.assign({ id: idB }, b), H(steve.token)); assert.strictEqual(r.s, 404, op + ' ' + J(r.j)); }
    for (const b of [{ id: idB }, { id: idB, preview: true }]) { r = await post('/calcutta/gjoin', b, H(tess.token)); assert.strictEqual(r.s, 404, 'gjoin ' + J(b)); }
    assert.strictEqual(GOLF.urls.length, u0, 'no golf feed read for a stranger'); assert.strictEqual(calls.espn, e0, 'no ESPN read at all');
    r = await post('/calcutta/mine', {}, H(steve.token)); assert.strictEqual(r.j.calcs.length, 0);
    t('F10: every route on another group\'s Calcutta (get, state, board, bid, ctl, enter, unenter, result, buyback, por, edit, delete, close, gjoin, preview) is 404, and nothing is read from a feed first');

    // ---- 2. L9 + the race: one clock inside the transaction (probe1) ----
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Race' }), H(steve.token)); const idR = r.j.calc.id; for (const p of [tess, bo]) await post('/calcutta/gjoin', { id: idR }, H(p.token));
    await post('/calcutta/ctl', { id: idR, op: 'start' }, H(steve.token));
    let wins = 0; for (let k = 0; k < 15; k++) { const amt = 5 + k * 10; const rs = await Promise.all([post('/calcutta/bid', { id: idR, lot: 'L1', amt }, H(tess.token)), post('/calcutta/bid', { id: idR, lot: 'L1', amt }, H(bo.token))]); if (rs.filter((x) => x.s === 200).length === 1) wins++; C._reset(); }
    assert.strictEqual(wins, 15, 'two bids of the same amount at once: exactly one wins, every time');
    r = await post('/calcutta/get', { id: idR }, H(steve.token)); const hb = r.j.calc.a.high, last = DB['lock:calc:' + idR].data.bids.L1.slice(-1)[0]; assert.strictEqual(r.j.calc.a.endsAt, last.at + 25000, 'L9: the new end time = the bid\'s own time + the timer (one clock)');
    CLOCK += r.j.calc.a.endsAt - (Date.now() + CLOCK) + 1; r = await post('/calcutta/bid', { id: idR, lot: 'L1', amt: hb.amt + 100 }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'sold'], 'a bid 1 ms after the bell: the lot is sold');
    t('L9: a bid and the bell use the clock the transaction settled with; two equal bids at once: exactly one wins (15 of 15); 1 ms after the bell = sold');

    // ---- 3. M3 + M1: Undo names the bid it removes; a double tap or a new bid in between is refused; the notice names the bidder ----
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Undo' }), H(steve.token)); const idU = r.j.calc.id; for (const p of [tess, bo]) await post('/calcutta/gjoin', { id: idU }, H(p.token));
    await post('/calcutta/ctl', { id: idU, op: 'start' }, H(steve.token)); await post('/calcutta/bid', { id: idU, lot: 'L1', amt: 5 }, H(tess.token)); r = await post('/calcutta/bid', { id: idU, lot: 'L1', amt: 15 }, H(bo.token)); const boPid = r.j.calc.me, tessPid = (await post('/calcutta/get', { id: idU }, H(tess.token))).j.calc.me;
    r = await post('/calcutta/get', { id: idU }, H(steve.token)); assert.deepStrictEqual(r.j.calc.a.undo, { k: 'bid', pid: boPid, name: 'Bo', amt: 15 }, 'the commissioner\'s screen names the bid Undo removes ("Remove Bo\'s $15 bid?")');
    r = await post('/calcutta/ctl', { id: idU, op: 'undo', expect: { pid: tessPid, amt: 5 } }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'changed'], 'the screen showed an older high bid');
    const [u1, u2] = await Promise.all([post('/calcutta/ctl', { id: idU, op: 'undo', expect: { pid: boPid, amt: 15 } }, H(steve.token)), post('/calcutta/ctl', { id: idU, op: 'undo', expect: { pid: boPid, amt: 15 } }, H(steve.token))]);
    assert.deepStrictEqual([u1.s, u2.s].sort(), [200, 409], 'a double tap removes one bid'); r = await post('/calcutta/get', { id: idU }, H(bo.token)); assert.deepStrictEqual([r.j.calc.a.high.pid, r.j.calc.a.high.amt], [tessPid, 5], 'Tess\'s $5 is the high bid again');
    const nt = r.j.calc.notices[0]; assert.deepStrictEqual([nt.k, nt.pid, nt.amt], ['undo', boPid, 15], 'the notice says whose bid it was (the phone tells Bo "your $15 bid")');
    await post('/calcutta/ctl', { id: idU, op: 'sold' }, H(steve.token)); r = await post('/calcutta/ctl', { id: idU, op: 'undo', expect: { pid: tessPid, amt: 5 } }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'changed'], 'a bid undo never undoes a sale');
    r = await post('/calcutta/ctl', { id: idU, op: 'undo', expect: { lot: 'L1' } }, H(steve.token)); assert.strictEqual(r.s, 200, 'the sale undo names its lot'); r = await post('/calcutta/ctl', { id: idU, op: 'undo' }, H(steve.token)); assert.strictEqual(r.s, 200, 'an undo without expect still works (older phones)');
    t('M3: Undo sends the bid it means (pid + amount) or the sale (lot): a changed high bid or a double tap = 409 changed, one bid removed; M1: the undo notice carries whose bid (k undo, pid, amt)');

    // ---- 4. H1: My Apps slow or asleep never holds a bid or a poll ----
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Slow' }), H(steve.token)); const idS = r.j.calc.id; await post('/calcutta/gjoin', { id: idS }, H(tess.token)); await post('/calcutta/ctl', { id: idS, op: 'start' }, H(steve.token));
    await post('/calcutta/state', { id: idS, rev: 0 }, H(tess.token)); CLOCK += 125e3; SLOW = 20000; // the 2-minute answer is old; My Apps now hangs 20 s
    let t0 = Date.now(); r = await post('/calcutta/bid', { id: idS, lot: 'L1', amt: 5 }, H(tess.token)); const dBid = Date.now() - t0; assert.strictEqual(r.s, 200, J(r.j)); assert.ok(dBid < 1000, 'bid took ' + dBid + ' ms');
    t0 = Date.now(); r = await post('/calcutta/state', { id: idS, rev: 0 }, H(tess.token)); const dPoll = Date.now() - t0; assert.strictEqual(r.s, 200); assert.ok(dPoll < 1000, 'poll took ' + dPoll + ' ms');
    t0 = Date.now(); r = await post('/calcutta/mine', {}, H(bo.token)); const dNew = Date.now() - t0; assert.strictEqual(r.s, 200); assert.ok(dNew < 1600, 'an account never asked waits at most ~1.2 s: ' + dNew + ' ms');
    t0 = Date.now(); r = await post('/calcutta/mine', {}, H(bo.token)); assert.ok(Date.now() - t0 < 1000, 'and not again'); SLOW = 0;
    t('H1: My Apps hanging 20 s: a bid ' + dBid + ' ms and a poll ' + dPoll + ' ms (the last answer, re-asked behind); an account never asked waits at most ~1.2 s (' + dNew + ' ms) and is let in');

    // ---- 5. F2: a golf field lot of up to 200 golfers; "Rest of the field"; the right message (probe2) ----
    for (let i = 16; i <= 160; i++) GOLFERS.push([String(i), 'Golfer ' + i, (i % 9) - 4]); PGAS._reset(); C._reset();
    r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); const field = r.j.teams; assert.strictEqual(field.length, 150);
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA 20+field', ev: 'golf', rows: PLACES, lots: field.slice(0, 20).map((x) => ({ teams: [x] })).concat([{ name: 'The field', teams: field.slice(20) }]) }), H(steve.token)); assert.strictEqual(r.s, 200, '20 singles + a field of 130: ' + J(r.j)); assert.strictEqual(r.j.calc.lots[20].teams.length, 130);
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA rest', ev: 'golf', rows: PLACES, lots: field.slice(0, 20).map((x) => ({ teams: [x] })).concat([{ rest: true }]) }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j));
    const rest = r.j.calc.lots[20]; assert.deepStrictEqual([rest.name, rest.teams.length, rest.field], ['Rest of the field', 130, true], 'the server fills "Rest of the field" with every golfer no other lot names');
    assert.ok(!rest.teams.some((x) => field.slice(0, 20).some((y) => y.id === x.id)));
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Two rests', ev: 'golf', rows: PLACES, lots: [{ teams: [field[0]] }, { rest: true }, { rest: true }] }), H(steve.token)); assert.strictEqual(r.s, 400);
    C._reset(); const big = field.concat(Array.from({ length: 52 }, (_, i) => ({ id: 'e401700d20261119:px' + i, name: 'X' + i }))); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Too big', ev: 'golf', rows: PLACES, lots: [{ teams: [field[0]] }, { teams: big.slice(1, 202) }] }), H(steve.token));
    assert.deepStrictEqual([r.s, r.j.error], [400, 'A lot holds up to 200 golfers (this one has 201)'], 'the message says what is wrong (was "Each lot needs at least one team")');
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Too big', lots: [{ teams: [team(1)] }, { teams: Array.from({ length: 71 }, (_, i) => team('z' + i)) }] }), H(steve.token)); assert.deepStrictEqual([r.s, r.j.error], [400, 'A lot holds up to 70 teams (this one has 71)']);
    GOLFERS.length = 5; PGAS._reset();
    t('F2: a golf field lot holds up to 200 golfers (20 singles + a field of 130 now works); { rest: true } = "Rest of the field", filled by the server; 201 golfers / 71 teams: a message that says so');

    // ---- 6. F5: the PGA lock is the first tee time once ESPN lists it; midnight Eastern only when it does not (probe2) ----
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA live', ev: 'golf', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); const idG = r.j.calc.id; await post('/calcutta/gjoin', { id: idG }, H(tess.token));
    GOLF.tee = 'Thu Nov 19 07:45:00 EST 2026'; PGAS._reset(); at('2026-11-19T04:30:00Z'); await polls(idG, tess.token);
    r = await post('/calcutta/ctl', { id: idG, op: 'start' }, H(steve.token)); assert.strictEqual(r.s, 200, 'start Wed 10:30 PM CT'); r = await post('/calcutta/bid', { id: idG, lot: 'L1', amt: 5 }, H(tess.token)); assert.strictEqual(r.s, 200);
    at('2026-11-19T05:00:30Z'); PGAS._reset(); await polls(idG, tess.token); r = await post('/calcutta/get', { id: idG }, H(tess.token));
    assert.deepStrictEqual([r.j.calc.started, r.j.calc.a.status, r.j.calc.kick], [false, 'live', Date.parse('2026-11-19T12:45:00Z')], 'midnight Eastern passed, the first tee is at 7:45 AM: still open, and the lock time shown is the tee time');
    at('2026-11-19T12:45:01Z'); PGAS._reset(); await polls(idG, tess.token); r = await post('/calcutta/get', { id: idG }, H(tess.token)); assert.deepStrictEqual([r.j.calc.started, r.j.calc.a.status], [true, 'closed'], 'locked at the first tee');
    GOLF.tee = null; C._reset(); PGAS._reset(); at('2026-11-18T18:00:00Z'); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA no tee', ev: 'golf', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); const idG2 = r.j.calc.id; await polls(idG2, steve.token);
    r = await post('/calcutta/get', { id: idG2 }, H(steve.token)); assert.strictEqual(r.j.calc.kick, Date.parse('2026-11-19T05:00:00Z'), 'no tee time listed: the start date (midnight Eastern) is the fallback');
    t('F5: the PGA Calcutta locks at the first tee time once ESPN lists it (open at 11:00 PM CT Wednesday, locked at 7:45 AM ET Thursday); midnight Eastern only as the fallback');

    // ---- 7. F4: a source whose start is over an hour away never answers "feed" on its own slowness (probe3) ----
    C._reset(); PGAS._reset(); at('2026-11-17T18:00:00Z'); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA early', ev: 'golf', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); const idE = r.j.calc.id; await post('/calcutta/gjoin', { id: idE }, H(tess.token));
    await polls(idE, steve.token, 2); await post('/calcutta/ctl', { id: idE, op: 'start' }, H(steve.token));
    C._reset(); PGAS._reset(); GOLF.delay = 1500; CLOCK += 120e3; // a restart (memory gone) and a slow ESPN, two days before the event
    t0 = Date.now(); r = await post('/calcutta/bid', { id: idE, lot: 'L1', amt: 5 }, H(tess.token)); assert.strictEqual(r.s, 200, 'first bid after a restart, ESPN slow: ' + J(r.j)); assert.ok(Date.now() - t0 < 1000, 'and it did not wait on ESPN');
    GOLF.delay = 0; GOLF.down = true; C._reset(); PGAS._reset(); CLOCK += 70e3; r = await post('/calcutta/bid', { id: idE, lot: 'L1', amt: 10 }, H(steve.token)); assert.notStrictEqual(r.j.code, 'feed', 'ESPN down 2 days before: no "feed" lock');
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA by hand', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); assert.strictEqual(r.s, 502, 'creating needs the field: ESPN down = could not load'); GOLF.down = false; PGAS._reset();
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA by hand', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); const idM = r.j.calc.id; await polls(idM, steve.token, 2);
    GOLF.down = true; PGAS._reset(); C._reset(); r = await post('/calcutta/enter', { id: idM, lot: 'L1', amt: 20, name: 'Uncle Ray' }, H(steve.token)); assert.strictEqual(r.s, 200, 'enter while ESPN is down 2 days before: open ' + J(r.j));
    at('2026-11-19T04:30:00Z'); r = await post('/calcutta/enter', { id: idM, lot: 'L2', amt: 20, name: 'Aunt May' }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'feed'], 'within the hour of its start: a source that cannot answer locks (fail closed, not for good)'); assert.ok(!DB['lock:calc:' + idM].data.startedAt); GOLF.down = false; PGAS._reset();
    t('F4: a source whose known start is over an hour away answers "open" without waiting (first bid after a restart with ESPN slow: 200 at once; ESPN down two days before: no 409 feed); within the hour it still fails closed');

    // ---- 8. F6: no golfers once the event is under way or over (probe3) ----
    for (const st of ['in', 'post']) { GOLF.state = st; PGAS._reset(); C._reset(); r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.teams.length, r.j.code], [200, 0, 'underway'], st); assert.ok(/already started|is over/.test(r.j.msg), r.j.msg);
      r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Late PGA', ev: 'golf', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'underway'], 'create ' + st); }
    GOLF.state = 'pre'; PGAS._reset();
    t('F6: teams answers no golfers with a clear sentence (code underway) once the event is in progress or final, and create is refused the same way');

    // ---- 9. F3 + F2: final board: a lotted golfer missing from it is out; no correction opens; places nobody lotted go the unsold way (probe4, money2) ----
    GOLFERS.push(['16', 'Zed Zane', 0]); PGAS._reset(); C._reset(); at('2026-11-17T18:00:00Z');
    r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); const f6 = r.j.teams; const rows3 = [{ k: 'place', r: 1, n: 1, pct: 60 }, { k: 'place', r: 2, n: 1, pct: 25 }, { k: 'place', r: 3, n: 1, pct: 15 }];
    r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'PGA final', ev: 'golf', mode: 'manual', rows: rows3, lots: f6.slice(2).map((x) => ({ teams: [x] })) }), H(steve.token)); const idF = r.j.calc.id; // Ana and Ben (tied 1st) are in no lot
    for (let i = 0; i < 4; i++) { r = await post('/calcutta/enter', { id: idF, lot: 'L' + (i + 1), amt: 25, name: 'Buyer ' + i }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); }
    GOLFERS.pop(); GOLF.state = 'post'; PGAS._reset(); C._reset(); at('2026-11-24T12:00:00Z'); await post('/calcutta/board', { id: idF }, H(steve.token)); await sleep(300); r = await post('/calcutta/board', { id: idF }, H(steve.token)); let B = r.j.board;
    const zed = B.lots.find((l) => l.name === 'Zed Zane').teams[0]; assert.deepStrictEqual([zed.r && zed.r.out, !!zed.fix], [true, false], 'F3: missing from the final board = out, no correction offered');
    assert.deepStrictEqual([B.over, C2(B.inPlay), C2(B.paidOut), C2(B.pool)], [true, 0, 10000, 10000], 'F2: the source says final: over, nothing in play, everything paid');
    assert.strictEqual(B.unused.slots, 2, '1st and 2nd went to golfers in no lot'); assert.strictEqual(C2(B.unused.amt), 8500); assert.strictEqual(C2(B.rolled), 8500, 'rolled into the sold lots (roll rule)');
    r = await post('/calcutta/result', { id: idF, team: f6[5].id, place: 1, reason: 'Zed won it', confirm: true }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'feedonly'], 'F3: no correction once the source says final');
    t('F3: a lotted golfer missing from the final board is out and no correction opens; F2: a final board makes the Calcutta over, and paid places nobody lotted follow the unsold rule (85% rolled here)');

    // ---- 10. F1: a weekend event is over once its window passed and every lot-team game is final; unfilled win slots go the unsold way (probe2) ----
    GOLF.state = 'pre'; C._reset(); at('2026-11-17T18:00:00Z');
    const mkG = (i, state, sa, sb) => ({ id: 'g' + i, date: '2026-11-22T18:00Z', season: { type: 2 }, week: { number: 12 }, status: { type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } }, competitions: [{ competitors: [{ team: { id: String(2 * i + 1) }, score: String(sa), winner: state === 'post' && sa > sb }, { team: { id: String(2 * i + 2) }, score: String(sb), winner: state === 'post' && sb > sa }] }] });
    NFL.pages['20261122'] = Array.from({ length: 13 }, (_, i) => mkG(i, 'pre', 0, 0)); const lotsW = Array.from({ length: 26 }, (_, i) => ({ teams: [team(i + 1)] }));
    const wk = async (uns) => { r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Week 12 ' + uns, ev: 'nfl_wk', mode: 'manual', lots: lotsW, rows: [{ k: 'win', n: 16, pct: 5 }, { k: 'big', n: 1, pct: 20 }], unsold: uns }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const id = r.j.calc.id;
      for (let i = 0; i < 25; i++) { r = await post('/calcutta/enter', { id, lot: 'L' + (i + 1), amt: 10, name: 'Buyer ' + (i % 4) }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); } return id; }; // L26 unsold
    const idW = await wk('roll'), idW2 = await wk('carry'); assert.deepStrictEqual(DB['lock:calc:' + idW].data.win, { from: '2026-11-19', to: '2026-11-23' });
    NFL.pages['20261122'] = Array.from({ length: 13 }, (_, i) => mkG(i, 'post', i === 12 ? 10 : 30, i === 12 ? 31 : 20)); // team 26 (unsold) wins by 21: the biggest margin
    const brd = async (id) => { C._reset(); await post('/calcutta/board', { id }, H(steve.token)); await sleep(300); return (await post('/calcutta/board', { id }, H(steve.token))).j.board; };
    at('2026-11-23T18:00:00Z'); B = await brd(idW); assert.deepStrictEqual([B.over, B.unused.slots, C2(B.inPlay)], [false, 0, 3750], 'Monday: the window has not passed, the 3 unfilled win slots are still in play');
    at('2026-11-24T18:00:00Z'); B = await brd(idW); assert.deepStrictEqual([B.over, B.unused.slots, C2(B.unused.amt), C2(B.inPlay), C2(B.paidOut), C2(B.pool)], [true, 3, 3750, 0, 25000, 25000], 'Tuesday: over; 3 win slots unused ($37.50) + the unsold lot\'s $62.50 (a win and the biggest margin) rolled');
    assert.deepStrictEqual(B.rows.map((x) => [x.k, x.hits, x.unused]), [['win', 13, 3], ['big', 1, 0]]); assert.strictEqual(C2(B.rolled), 3750 + 6250);
    B = await brd(idW2); assert.deepStrictEqual([B.over, C2(B.carry), C2(B.inPlay), B.carryTo], [true, 10000, 0, 'this group\'s next Calcutta (the commissioner holds it until then; Oddable never holds money)'], 'carry rule: the unused slots carry with the unsold lot\'s winnings');
    t('F1: "this weekend" is over once its Thu-Mon window has passed and every lot-team game is final; the win slots nobody filled (3 here) follow the unsold rule (rolled, or carried) and the board counts them');

    // ---- 11. F1 for nfl_season ties, and the money repros (money.js / money2.js) ----
    const lot = (id) => ({ id, name: id, teams: [{ id: 't' + id, name: id }], field: false, por: [] }), mem = [{ pid: 'p1', mk: 'k1', name: 'Ann' }, { pid: 'p2', mk: 'k2', name: 'Bob' }];
    const sold = (ids) => Object.fromEntries(ids.map((x, i) => [x, { pid: i % 2 ? 'p2' : 'p1', name: '', amt: 10, at: i, how: 'entered', bb: null }]));
    const season = { id: 'X', ev: 'nfl_season', rules: { rows: [{ k: 'win', n: 10, bp: 500 }, { k: 'champ', n: 1, bp: 5000 }], take: { kind: 'none', v: 0 }, unsold: 'roll' }, lots: ['A', 'B'].map(lot), members: mem, a: { order: [] }, sold: sold(['A', 'B']) };
    const W = (n0) => ({ wins: n0, winT: Array.from({ length: n0 }, (_, i) => i + 1), reached: 0, reachT: {}, champ: false, out: false });
    let m = C.money(season, { tA: W(4), tB: W(3) }); assert.deepStrictEqual([m.over, C2(m.inPlay), m.unused.slots], [false, 1300, 0], 'season under way: the 3 slots ties left are still in play');
    m = C.money(season, { tA: Object.assign(W(4), { champ: true }), tB: W(3) }); assert.deepStrictEqual([m.over, m.unused.slots, C2(m.unused.amt), C2(m.inPlay), C2(m.paidOut)], [true, 3, 300, 0, 2000], 'champion known: the 3 win slots ties left are rolled');
    const g2 = { id: 'X', ev: 'golf', rules: { rows: PLACES.map((x) => ({ k: 'place', r: x.r, n: 1, bp: x.pct * 100 })), take: { kind: 'none', v: 0 }, unsold: 'roll' }, lots: ['A', 'B', 'C', 'D', 'E', 'F'].map(lot), members: mem, a: { order: [] }, sold: sold(['A', 'B', 'C', 'D', 'E']) };
    const R2 = { tNOT: { place: 1 }, tA: { place: 2 }, tF: { place: 3 }, tB: { place: 4 }, tC: { place: 5 }, tD: { place: 6 }, tE: { out: true } };
    m = C.money(g2, R2); assert.deepStrictEqual([m.over, C2(m.inPlay)], [false, 2500], 'money2: the winner in no lot, no final flag: not over (1st place still in play)');
    Object.defineProperty(R2, '_fin', { value: true }); m = C.money(g2, R2); assert.deepStrictEqual([m.over, C2(m.inPlay), m.unused.slots, C2(m.unused.amt), C2(m.paidOut), C2(m.pool)], [true, 0, 1, 2500, 5000, 5000], 'money2 with the source final: over; 1st place (nobody lotted) rolled');
    const base = (take, rows, s, uns) => ({ id: 'X', ev: 'custom', rules: { rows, take, unsold: uns || 'roll', minBid: 1, inc: 1, timer: 25, buyBack: true, main: true }, lots: ['A', 'B', 'C', 'D'].map(lot), sold: s, members: [{ pid: 'p1', mk: 'k1', name: 'Ann' }, { pid: 'p2', mk: 'k2', name: 'Bob' }, { pid: 'p3', mk: 'k3', name: 'Cy' }], a: { order: ['A', 'B', 'C', 'D'] } });
    const rowsP = [{ k: 'place', r: 1, n: 1, bp: 5000 }, { k: 'place', r: 2, n: 1, bp: 3000 }, { k: 'place', r: 3, n: 1, bp: 2000 }];
    const s1 = { A: { pid: 'p1', name: '', amt: 33, at: 1, how: 'entered', bb: null }, B: { pid: 'p2', name: '', amt: 34, at: 2, how: 'entered', bb: { pid: 'p3', name: '', k: 'k3', at: 3 } }, C: { pid: 'p3', name: '', amt: 35, at: 3, how: 'entered', bb: null }, D: { pid: 'p1', name: '', amt: 1, at: 4, how: 'entered', bb: null } };
    m = C.money(base({ kind: 'pct', v: 7 }, rowsP, s1), { tA: { place: 1 }, tB: { place: 2 }, tC: { place: 2 }, tD: { out: true } });
    assert.deepStrictEqual([m.pot, m.take, m.pool, m.paidOut, m.inPlay, m.over], [103, 7.21, 95.79, 95.79, 0, true], 'money.js: 7% take, a tie for 2nd split to the cent');
    assert.deepStrictEqual(m.lots.map((l) => [l.id, l.earned]), [['A', 47.9], ['B', 23.95], ['C', 23.94], ['D', 0]]);
    t('F1 for a season: the win slots ties leave unfilled roll once the champion is known; the reviewers\' money repros (7% take with a tie; the winner in no lot, now over and paid once the source is final)');

    // ---- 12. F8: a Calcutta stays reachable after its group is deleted (the phone falls back to "mine") ----
    C._reset(); r = await post('/groups/create', mkGroup('Short lived', 'Steve'), H(steve.token)); const gX = r.j.group; await post('/groups/join', { code: gX.code, myName: 'Tess' }, H(tess.token));
    r = await post('/calcutta/create', calcBody({ g: gX.id, name: 'Orphan' }), H(steve.token)); const idO = r.j.calc.id; await post('/calcutta/gjoin', { id: idO }, H(tess.token));
    r = await post('/groups/delete', { id: gX.id }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j));
    r = await post('/calcutta/list', { g: gX.id }, H(tess.token)); assert.deepStrictEqual([r.s, r.j.code], [403, 'group'], 'the group is gone (the phone falls back to mine on this answer)');
    r = await post('/calcutta/mine', {}, H(tess.token)); const o = r.j.calcs.find((x) => x.id === idO); assert.ok(o && o.group && o.group.groupId === gX.id && o.joined === true && o.people === 2, 'still in "mine", with the group it came from (same row shape as list)');
    r = await post('/calcutta/get', { id: idO }, H(tess.token)); assert.strictEqual(r.s, 200); r = await post('/calcutta/board', { id: idO }, H(steve.token)); assert.strictEqual(r.s, 200);
    t('F8: after its group is deleted a Calcutta is still listed in "mine" (with the old group id, so the phone can show it) and opens for its members');

    // ---- 13. F12 (round 2): nothing leaves by age; above 3000 full entries the oldest closed are made slim (still listed, still counted) ----
    const now = Date.now() + CLOCK, ix = DB['lock:calcs'].data.calcs, e1 = (st, ev, ago) => ({ name: 'x', comm: 'c', mks: ['a', 'b'], code: 'C', status: st, ev, created: now - ago, act: now - ago, group: { groupId: 'G', name: 'Gx' }, pn: 0, pks: [], gks: [] });
    Object.assign(ix, { OLDCLOSED01: e1('closed', 'nfl_po', 200 * 864e5), NEWCLOSED01: e1('closed', 'nfl_po', 20 * 864e5), SEASONGONE1: e1('closed', 'nfl_season', 420 * 864e5), OLDLIVE0001: e1('live', 'nfl_po', 300 * 864e5) });
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Prune' }), H(steve.token)); assert.strictEqual(r.s, 200); let keys = Object.keys(DB['lock:calcs'].data.calcs);
    assert.deepStrictEqual(['OLDCLOSED01', 'NEWCLOSED01', 'SEASONGONE1', 'OLDLIVE0001'].map((k) => keys.includes(k) && !DB['lock:calcs'].data.calcs[k].slim), [true, true, true, true], 'no entry leaves (or is slimmed) by age');
    for (let i = 0; i < 3005; i++) DB['lock:calcs'].data.calcs['FILL' + String(i).padStart(6, '0')] = e1('closed', 'nfl_po', (30 + i / 1000) * 864e5);
    C._reset(); r = await post('/calcutta/create', calcBody({ g: gA.id, name: 'Bound' }), H(steve.token)); assert.strictEqual(r.s, 200); const IX = DB['lock:calcs'].data.calcs; keys = Object.keys(IX);
    const fullN = keys.filter((k) => !IX[k].slim).length; assert.ok(fullN <= 3000, 'at most 3000 full entries: ' + fullN); assert.ok(!IX[r.j.calc.id].slim && !IX[idO].slim && !IX.OLDLIVE0001.slim, 'the newest and every open one stay full');
    assert.ok(IX.SEASONGONE1.slim && IX.OLDCLOSED01.slim && !IX.FILL000000.slim, 'the oldest closed are made slim first'); assert.ok(!('code' in IX.SEASONGONE1) && IX.SEASONGONE1.mks.length === 2 && IX.SEASONGONE1.group.groupId === 'G', 'a slim entry keeps what mine, list and stats read');
    assert.ok(['FILL000000', 'FILL003004', 'OLDCLOSED01', 'SEASONGONE1'].every((k) => keys.includes(k)), 'nothing is deleted below the hard cap of 20000');
    t('F12 round 2: no Calcutta leaves My Calcuttas / list / stats by age; above 3000 full entries the oldest closed become slim entries (still listed and counted); open ones and the rows are never touched');

    console.log('\nPASS ' + n + ' calcutta fix checks');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close(); process.exit(process.exitCode || 0);
});
