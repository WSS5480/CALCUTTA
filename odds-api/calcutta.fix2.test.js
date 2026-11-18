// Run: node odds-api/calcutta.fix2.test.js   (no network: Supabase, ESPN and My Apps are in-memory fakes behind global fetch)
// calc-live, the re-reviews of cd6965a (Nov 17 2026): the second fix round, checked through the REAL acct.js, sync.js, groups.js, limits.js,
// calcutta.js and calcutta-pga.js wired like server.js (the same fakes as calcutta.fixes.test.js). Dates are fixed (the clock is moved).
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, calls = { db: 0, espn: 0 };
const TEAMS = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), abbreviation: 'T' + (i + 1), displayName: 'Team ' + (i + 1) })), CFB = Array.from({ length: 136 }, (_, i) => ({ id: String(1000 + i), abbreviation: 'C' + i, displayName: 'College ' + i }));
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
  if (url.startsWith('https://site.api.espn.com/')) { calls.espn++; if (/\/teams\?/.test(url)) return ok({ sports: [{ leagues: [{ teams: (/college-football/.test(url) ? CFB : TEAMS).map((t) => ({ team: t })) }] }] }); const m = /dates=(\d{8})/.exec(url); return ok({ events: (m && NFL.pages[m[1]]) || [] }); }
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
// H1 round 2: what acct.expiredState answers per account ('ok' | 'ended'); FAIL = My Apps down (every ask answers 'unknown'). ASKS = who was asked.
const STATE = {}, ASKS = []; let FAIL = false; C._deps.acct = ((A0) => () => Object.assign({}, A0(), { expiredState: async (e) => { ASKS.push(e); return FAIL ? 'unknown' : STATE[e] || 'ok'; } }))(C._deps.acct);
const LIM = require('./limits');
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
const mkGroup = (nm) => ({ name: nm, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' });

srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port;
  try {
    process.env.GROUPS_ENABLED = '1'; at('2026-11-17T18:00:00Z'); // a Tuesday
    const phoneIn = async (phone, pin, name) => { await post('/sync/signup', { phone, pin, data: { bets: [] } }); const x = await post('/acct/phone', { phone, pin, name }); return x.j; };
    const P = []; for (let i = 0; i < 7; i++) P.push(await phoneIn('95655500' + String(10 + i), '7' + String(10000 + i), ['Steve', 'Tess', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'][i]));
    const [steve, tess, bo] = P;
    let r = await post('/groups/create', mkGroup('Big crew'), H(steve.token)); const g = r.j.group; await LIM.admin({ op: 'seats', id: g.id, n: 4 }); LIM._reset();
    for (let k = 1; k < 7; k++) { r = await post('/groups/join', { code: g.code, myName: ['', 'Tess', 'Bo', 'Cy', 'Di', 'Ed', 'Flo'][k] }, H(P[k].token)); assert.strictEqual(r.s, 200, 'group join ' + k + J(r.j)); }

    // ---- 1. BLOCKER (F10 / gjoin): owner-set extra seats survive a restart for both the preview and the join (tcap.js) ----
    const custom = (nm) => ({ g: g.id, name: nm, ev: 'custom', lots: ['L1', 'L2', 'L3', 'L4', 'L5'].map((n0) => ({ teams: [{ name: n0 }] })), rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 25, unsold: 'roll', main: true, take: { kind: 'none', v: 0 }, order: 'listed', mode: 'manual' });
    r = await post('/calcutta/create', custom('Member-guest'), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const cS = r.j.calc;
    for (let k = 0; k < 4; k++) { r = await post('/calcutta/enter', { id: cS.id, lot: cS.lots[k].id, amt: 10, name: 'Guest ' + (k + 1) }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); }
    for (let k = 1; k < 4; k++) { r = await post('/calcutta/gjoin', { id: cS.id }, H(P[k].token)); assert.strictEqual(r.s, 200, J(r.j)); } // 8 people: the commissioner, 4 guests, 3 members
    r = await post('/calcutta/gjoin', { id: cS.id }, H(P[4].token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'cap'], 'standard 8: the 9th is refused'); assert.ok(!/contact us/i.test(r.j.error), 'item 10: no "Contact us" in the full message: ' + r.j.error);
    assert.ok(/Need more than 8\?/.test(r.j.error), 'Calcutta\'s own pricing line');
    await LIM.admin({ op: 'seats', id: cS.id, n: 4 }); LIM._reset(); C._reset(); // the owner adds 4 seats, then a restart (every engine cache empty)
    r = await post('/calcutta/gjoin', { id: cS.id, preview: true }, H(P[4].token)); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual([r.j.calc.count, r.j.calc.max], [4, 12], 'the preview after a restart shows the real max (4 members; the 4 guests are names on lots)');
    C._reset(); r = await post('/calcutta/gjoin', { id: cS.id }, H(P[4].token)); assert.strictEqual(r.s, 200, 'the join after a restart: ' + J(r.j)); assert.strictEqual(r.j.calc.max, 12);
    t('BLOCKER gjoin: after owner-set extra seats and a restart, the gjoin preview shows max 12 and the join goes in (capLoad runs before both); item 10: the full message has Calcutta\'s pricing line and no "Contact us"');

    // ---- 2. H1: My Apps down never lets an ended account back in; an account never answered for is asked again 30 s later ----
    C._reset(); ASKS.length = 0; r = await post('/calcutta/mine', {}, H(tess.token)); assert.strictEqual(r.s, 200); const eT = ASKS[ASKS.length - 1]; assert.ok(eT);
    STATE[eT] = 'ended'; CLOCK += 125e3; r = await post('/calcutta/mine', {}, H(tess.token)); assert.strictEqual(r.s, 200, 'the 2-minute answer is old: still served while it is asked again'); await sleep(30);
    r = await post('/calcutta/mine', {}, H(tess.token)); assert.deepStrictEqual([r.s, r.j.expired], [403, true], 'then the new answer: ended');
    FAIL = true; let shut = 0; for (let k = 0; k < 8; k++) { CLOCK += 40e3; r = await post('/calcutta/mine', {}, H(tess.token)); if (r.s === 403) shut++; await sleep(20); }
    assert.strictEqual(shut, 8, 'My Apps down for 5 minutes: the ended account is kept out on every call (was: let back in for the whole outage)');
    const asked = ASKS.filter((x) => x === eT).length; assert.ok(asked >= 4, 'and it is asked again about every 30 s while My Apps is down (' + asked + ' asks)');
    FAIL = false; STATE[eT] = 'ok'; CLOCK += 40e3; await post('/calcutta/mine', {}, H(tess.token)); await sleep(30); r = await post('/calcutta/mine', {}, H(tess.token)); assert.strictEqual(r.s, 200, 'paid again: back in once My Apps says so');
    C._reset(); ASKS.length = 0; FAIL = true; r = await post('/calcutta/mine', {}, H(bo.token)); assert.strictEqual(r.s, 200, 'never answered for and My Apps down: let in provisionally'); const eB = ASKS[ASKS.length - 1];
    const nB = () => ASKS.filter((x) => x === eB).length; CLOCK += 10e3; await post('/calcutta/mine', {}, H(bo.token)); assert.strictEqual(nB(), 1, 'not asked again within 30 s');
    CLOCK += 25e3; FAIL = false; STATE[eB] = 'ended'; r = await post('/calcutta/mine', {}, H(bo.token)); assert.strictEqual(nB(), 2, 'asked again 35 s later (not 2 minutes)'); await sleep(30);
    r = await post('/calcutta/mine', {}, H(bo.token)); assert.deepStrictEqual([r.s, r.j.expired], [403, true], 'and the ended answer shuts the provisional door'); STATE[eB] = 'ok'; C._reset();
    t('H1: acct.expiredState answers ended / ok / unknown; on unknown the last KNOWN answer stands (an ended account stays out through a 5-minute My Apps outage, ' + asked + ' re-asks); an account never answered for is let in and re-asked 30 s later');

    // ---- 3. F4: open without an ESPN read only 12 h or more before the start, or within 10 min of the last good read; unreadable tee times lock early ----
    PGAS._reset(); C._reset(); at('2026-11-17T18:00:00Z'); r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); const f5 = r.j.teams; assert.strictEqual(f5.length, 5);
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'PGA manual', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const idM = r.j.calc.id; await polls(idM, steve.token, 2);
    // the start is midnight Eastern Thursday (2026-11-19T05:00Z); no tee time listed
    at('2026-11-18T16:00:00Z'); GOLF.down = true; PGAS._reset(); C._reset(); r = await post('/calcutta/enter', { id: idM, lot: 'L1', amt: 20, name: 'Uncle Ray' }, H(steve.token)); assert.strictEqual(r.s, 200, '13 h before, ESPN down: open ' + J(r.j));
    at('2026-11-18T18:00:00Z'); GOLF.down = false; PGAS._reset(); C._reset(); await polls(idM, steve.token, 2); GOLF.down = true; PGAS._reset(); // a good read at 18:00, then ESPN goes down
    at('2026-11-18T18:05:00Z'); r = await post('/calcutta/enter', { id: idM, lot: 'L2', amt: 20, name: 'Aunt May' }, H(steve.token)); assert.strictEqual(r.s, 200, '11 h before, ESPN down, last good read 5 min ago: open ' + J(r.j));
    at('2026-11-18T18:12:00Z'); r = await post('/calcutta/enter', { id: idM, lot: 'L3', amt: 20, name: 'Cousin Lu' }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'feed'], '11 h before, last good read 12 min ago: the old lock (fail closed)');
    C._reset(); r = await post('/calcutta/enter', { id: idM, lot: 'L3', amt: 20, name: 'Cousin Lu' }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.code], [409, 'feed'], 'and after a restart (no read at all)'); GOLF.down = false; PGAS._reset();
    const lockAt = async (tee) => { GOLF.tee = tee; PGAS._reset(); C._reset(); at('2026-11-17T18:00:00Z'); r = await post('/calcutta/create', calcBody({ g: g.id, name: 'PGA tee', ev: 'golf', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const id = r.j.calc.id; await polls(id, steve.token, 2); return (await post('/calcutta/get', { id }, H(steve.token))).j.calc.kick; };
    assert.strictEqual(await lockAt('Thu Nov 19 07:45:00 EST 2026'), Date.parse('2026-11-19T12:45:00Z'), 'a zoned tee time: the first tee');
    assert.strictEqual(await lockAt('Thu Nov 19 07:45:00 JST 2026'), Date.parse('2026-11-18T22:45:00Z'), 'JST parsed (Japan, UTC+9)');
    assert.strictEqual(await lockAt('Thu Nov 19 07:45:00 AST 2026'), Date.parse('2026-11-19T11:45:00Z'), 'AST parsed (Atlantic, UTC-4)');
    const early = Date.parse('2026-11-19T05:00:00Z') - 15 * 36e5;
    assert.strictEqual(await lockAt('2026-11-19T07:45:00'), early, 'an ISO time with no zone is not guessed: the conservative lock (15 h before the start date)');
    assert.strictEqual(await lockAt('Thu Nov 19 07:45:00 XYZ 2026'), early, 'an unknown zone: the conservative lock');
    GOLF.tee = null; PGAS._reset();
    t('F4: ESPN unreadable: open 12 h+ before the start (13 h: 200) or within 10 min of the last good read (5 min: 200); 11 h before with an older read or none: 409 feed; tee times: EST / JST / AST parsed, a zoneless ISO or unknown zone = the conservative lock');

    // ---- 4. F1: a postponed or moved lot-team game holds the weekend open until it is final, at most until Thursday 12 AM CT ----
    C._reset(); at('2026-11-17T18:00:00Z');
    const mkG = (i, state, sa, sb, date, name) => ({ id: 'g' + i, date: date || '2026-11-22T18:00Z', season: { type: 2 }, week: { number: 12 }, status: { type: { state, completed: state === 'post', name: name || (state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') } }, competitions: [{ competitors: [{ team: { id: String(2 * i + 1) }, score: String(sa), winner: state === 'post' && sa > sb }, { team: { id: String(2 * i + 2) }, score: String(sb), winner: state === 'post' && sb > sa }] }] });
    const lotsW = Array.from({ length: 26 }, (_, i) => ({ teams: [team(i + 1)] }));
    const wk = async (nm) => { NFL.pages = { '20261122': Array.from({ length: 13 }, (_, i) => mkG(i, 'pre', 0, 0)) }; r = await post('/calcutta/create', calcBody({ g: g.id, name: nm, ev: 'nfl_wk', mode: 'manual', lots: lotsW, rows: [{ k: 'win', n: 13, pct: 5 }, { k: 'big', n: 1, pct: 35 }], unsold: 'roll' }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const id = r.j.calc.id;
      for (let i = 0; i < 26; i++) { r = await post('/calcutta/enter', { id, lot: 'L' + (i + 1), amt: 10, name: 'Buyer ' + (i % 4) }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); } return id; };
    const brd = async (id) => { C._reset(); await post('/calcutta/board', { id }, H(steve.token)); await sleep(300); return (await post('/calcutta/board', { id }, H(steve.token))).j.board; };
    const sunday = (last) => Array.from({ length: 12 }, (_, i) => mkG(i, 'post', 30, 20)).concat(last ? [last] : []);
    // (a) postponed on Sunday's page, played Tuesday
    const idP = await wk('Postponed'); at('2026-11-22T12:00:00Z'); await brd(idP);
    NFL.pages['20261122'] = sunday(mkG(12, 'pre', 0, 0, null, 'STATUS_POSTPONED')); NFL.pages['20261124'] = [mkG(12, 'pre', 0, 0, '2026-11-24T23:00Z')];
    at('2026-11-24T18:00:00Z'); let B = await brd(idP); assert.deepStrictEqual([B.over, B.waiting.sort()], [false, ['Team 25', 'Team 26']], 'Tuesday, the postponed game not played yet: not over, "Waiting on" its teams'); assert.deepStrictEqual(B.waitGames.map((x) => x.slice().sort()), [['Team 25', 'Team 26']], 'v278: the same wait as ONE game (the phone says "the Team 25 vs Team 26 game")');
    assert.ok(C2(B.inPlay) > 0, 'its win slot is still in play');
    NFL.pages['20261124'] = [mkG(12, 'post', 10, 41, '2026-11-24T23:00Z')]; at('2026-11-25T15:00:00Z'); B = await brd(idP);
    assert.deepStrictEqual([B.over, B.waiting, B.unused.slots, C2(B.inPlay)], [true, [], 0, 0], 'Wednesday: final; all 13 win slots filled, nothing unused');
    const l26 = B.lots.find((l) => l.name === 'Team 26'); assert.strictEqual(C2(l26.earned), C2(26 * 10 * 0.05 + 26 * 10 * 0.35), 'its result counts: a win and the biggest margin (31)');
    // (b) moved off the weekend pages (seen on Sunday's page before), never played: waits until Thursday 12 AM CT, then its slot is unused
    C._reset(); at('2026-11-17T18:00:00Z'); const idV = await wk('Moved'); at('2026-11-22T12:00:00Z'); await brd(idV);
    NFL.pages['20261122'] = sunday(null); NFL.pages['20261124'] = [mkG(12, 'pre', 0, 0, '2026-11-24T23:00Z')];
    at('2026-11-24T18:00:00Z'); B = await brd(idV); assert.deepStrictEqual([B.over, B.waiting.sort()], [false, ['Team 25', 'Team 26']], 'moved to Tuesday: waiting');
    at('2026-11-26T05:30:00Z'); B = await brd(idV); assert.deepStrictEqual([B.over, B.waiting.length], [false, 2], 'Wednesday 11:30 PM CT: still waiting');
    at('2026-11-26T06:30:00Z'); B = await brd(idV); assert.deepStrictEqual([B.over, B.waiting, B.unused.slots, C2(B.unused.amt), C2(B.inPlay)], [true, [], 1, 1300, 0], 'Thursday 12:30 AM CT: the wait is over; its win slot is unused and rolled');
    // (c) moved before any read saw it on the weekend pages: found on Tuesday's page by its ESPN week (12); a week-13 game on Wednesday never holds it
    C._reset(); at('2026-11-17T18:00:00Z'); const idN = await wk('Moved unseen'); NFL.pages['20261122'] = sunday(null); NFL.pages['20261124'] = [mkG(12, 'pre', 0, 0, '2026-11-24T23:00Z')];
    at('2026-11-24T18:00:00Z'); B = await brd(idN); assert.deepStrictEqual([B.over, B.waiting.length], [false, 2], 'a same-week game on Tuesday\'s page holds it, though no read saw it before');
    NFL.pages['20261124'] = [mkG(12, 'post', 10, 41, '2026-11-24T23:00Z')]; NFL.pages['20261125'] = [Object.assign(mkG(0, 'pre', 0, 0, '2026-11-26T01:00Z'), { id: 'n13', week: { number: 13 } })];
    at('2026-11-25T15:00:00Z'); B = await brd(idN); assert.deepStrictEqual([B.over, B.unused.slots], [true, 0], 'played Tuesday: over; next week\'s game (week 13) of a lot team on Wednesday is not waited on');
    t('F1: a lot team\'s game postponed (or moved off the weekend pages) holds the weekend open, the board says "Waiting on" its teams; played Tuesday = its result counts; never played = over at Thursday 12 AM CT and its slots follow the unsold rule');

    // ---- 5. F2: "Rest of the field" has no 70-team cap and follows the field ----
    C._reset(); at('2026-11-17T18:00:00Z'); NFL.pages = {};
    r = await post('/calcutta/teams', { ev: 'cfb_wk' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const cf = r.j.teams; assert.ok(cf.length > 70, 'the college list: ' + cf.length);
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'CFB rest', ev: 'cfb_wk', lots: [{ teams: [cf[0]] }, { teams: [cf[1]] }, { rest: true }], rows: [{ k: 'win', n: 10, pct: 5 }, { k: 'big', n: 1, pct: 50 }] }), H(steve.token));
    assert.strictEqual(r.s, 200, 'a college rest lot of ' + (cf.length - 2) + ' teams: ' + J(r.j)); assert.deepStrictEqual([r.j.calc.lots[2].teams.length, r.j.calc.lots[2].rest], [cf.length - 2, true]);
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'CFB named', ev: 'cfb_wk', lots: [{ teams: [cf[0]] }, { teams: cf.slice(1, 73) }], rows: [{ k: 'win', n: 10, pct: 5 }, { k: 'big', n: 1, pct: 50 }] }), H(steve.token)); assert.deepStrictEqual([r.s, r.j.error], [400, 'A lot holds up to 70 teams (this one has 72)'], 'a named lot keeps the 70 cap');
    GOLF.state = 'pre'; PGAS._reset(); C._reset(); r = await post('/calcutta/teams', { ev: 'golf' }, H(steve.token)); const fg = r.j.teams;
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'PGA rest', ev: 'golf', mode: 'manual', rows: [{ k: 'place', r: 1, n: 1, pct: 70 }, { k: 'place', r: 2, n: 1, pct: 30 }], lots: [{ teams: [fg[0]] }, { teams: [fg[1]] }, { rest: true }] }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const idR = r.j.calc.id;
    for (let i = 0; i < 3; i++) { r = await post('/calcutta/enter', { id: idR, lot: 'L' + (i + 1), amt: 20, name: 'Buyer ' + i }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); }
    GOLFERS.push(['17', 'Nina Newcomer', -20]); GOLF.state = 'post'; PGAS._reset(); C._reset(); at('2026-11-24T12:00:00Z'); // a golfer added to the field after the Calcutta was made wins it
    await post('/calcutta/board', { id: idR }, H(steve.token)); await sleep(300); B = (await post('/calcutta/board', { id: idR }, H(steve.token))).j.board;
    const rl = B.lots.find((l) => l.id === 'L3'); assert.ok(rl.teams.some((x) => x.name === 'Nina Newcomer'), 'the added golfer is in "Rest of the field" (named from the board)');
    assert.deepStrictEqual([B.over, B.unused.slots, C2(rl.earned)], [true, 0, 4200], 'the 1st place is paid to the rest lot (70% of $60), nothing unused'); GOLFERS.pop(); GOLF.state = 'pre'; PGAS._reset();
    t('F2: "Rest of the field" has no 70-team cap (a college rest lot of ' + (cf.length - 2) + ' teams; a named lot still 70) and follows the field: a golfer added later belongs to it and the 1st place is paid to it');

    // ---- 6. item 7: the final flag comes from the same board read as the results; the cached results are read again once the event turns final ----
    C._reset(); at('2026-11-20T15:00:00Z'); GOLF.state = 'in'; PGAS._reset(); const fin0 = PGAS.source.final; PGAS.source.final = async () => true; // a second read that says final while the board read says in progress
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'PGA same read', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token));
    if (r.s !== 200) { GOLF.state = 'pre'; PGAS._reset(); at('2026-11-17T18:00:00Z'); r = await post('/calcutta/create', calcBody({ g: g.id, name: 'PGA same read', ev: 'golf', mode: 'manual', rows: PLACES, lots: f5.map((x) => ({ teams: [x] })) }), H(steve.token)); }
    assert.strictEqual(r.s, 200, J(r.j)); const idF = r.j.calc.id; for (let i = 0; i < 5; i++) await post('/calcutta/enter', { id: idF, lot: 'L' + (i + 1), amt: 20, name: 'B' + i }, H(steve.token));
    GOLF.state = 'in'; PGAS._reset(); C._reset(); at('2026-11-20T15:00:00Z'); await post('/calcutta/board', { id: idF }, H(steve.token)); await sleep(300); B = (await post('/calcutta/board', { id: idF }, H(steve.token))).j.board;
    assert.deepStrictEqual([B.over, C2(B.paidOut)], [false, 0], 'the board read says in progress: not over, whatever a second read says'); PGAS.source.final = fin0;
    GOLF.state = 'post'; PGAS._reset(); at('2026-11-22T23:30:00Z'); let over = false; for (let k = 0; k < 6 && !over; k++) { CLOCK += 61e3; await post('/calcutta/board', { id: idF }, H(steve.token)); await sleep(250); B = (await post('/calcutta/board', { id: idF }, H(steve.token))).j.board; over = B.over; }
    assert.ok(over && C2(B.paidOut) === 10000, 'turned final: the cached results are read again and paid (without a restart)');
    const e0 = calls.espn; for (let k = 0; k < 3; k++) { CLOCK += 61e3; PGAS._reset(); await post('/calcutta/board', { id: idF }, H(steve.token)); } assert.strictEqual(calls.espn, e0, 'final results are kept: no more reads');
    t('item 7: "final" is read from the same board read as the results (a second read saying final while the board says in progress changes nothing); the cache re-reads once the event turns final, then reads no more');

    // ---- 7. item 10 + F12: Calcutta never shows "Contact us"; pga_season is a season ----
    r = await post('/calcutta/mine', {}, H(steve.token)); assert.ok(!/contact us/i.test(J(r.j)), 'mine: no "Contact us"'); assert.ok(/Need more than 8\?/.test(r.j.capText));
    assert.strictEqual(C.EVENTS.pga_season.season, true, 'pga_season is marked season: true');
    t('item 10: no Calcutta answer carries "Contact us" (Calcutta keeps its own pricing line; limits.js ENTERPRISE_TEXT unchanged); pga_season season: true');

    // ---- 8. round 3: week matching is regular season only; a new id stands in for a postponed one; the rest lot takes only the event's own teams ----
    const gg = (id, date, a, b, state, sa, sb, st, wkn, name) => ({ id, date, season: { type: st }, week: { number: wkn }, status: { type: { state, completed: state === 'post', name: name || (state === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') } }, competitions: [{ competitors: [{ team: { id: String(a) }, score: String(sa), winner: state === 'post' && sa > sb }, { team: { id: String(b) }, score: String(sb), winner: state === 'post' && sb > sa }] }] });
    const rows4 = [{ k: 'win', n: 4, pct: 20 }, { k: 'big', n: 1, pct: 20 }], ids4 = cf.slice(0, 4).map((x) => x.id);
    // (a) bowl season: CFP first round Sat Dec 19 and a Tuesday bowl share season type 3 week 1; the bowl is never waited on or paid
    C._reset(); at('2026-12-15T18:00:00Z'); NFL.pages = { '20261219': [gg('cfp1', '2026-12-19T20:00Z', ids4[0], ids4[1], 'pre', 0, 0, 3, 1)] };
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'Bowls', ev: 'cfb_wk', mode: 'manual', lots: cf.slice(0, 4).map((x) => ({ teams: [x] })), rows: rows4 }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const idBw = r.j.calc.id;
    for (let i = 1; i <= 4; i++) await post('/calcutta/enter', { id: idBw, lot: 'L' + i, amt: 25, name: 'Buyer ' + i }, H(steve.token));
    NFL.pages = { '20261219': [gg('cfp1', '2026-12-19T20:00Z', ids4[0], ids4[1], 'post', 30, 20, 3, 1)], '20261222': [gg('bowl1', '2026-12-23T00:00Z', ids4[2], ids4[3], 'pre', 0, 0, 3, 1)] };
    at('2026-12-22T15:00:00Z'); B = await brd(idBw); assert.deepStrictEqual([B.over, B.waiting], [true, []], 'Tuesday of bowl week: the Tuesday bowl (type 3 week 1 too) does not hold the CFP weekend');
    NFL.pages['20261222'] = [gg('bowl1', '2026-12-23T00:00Z', ids4[2], ids4[3], 'post', 41, 3, 3, 1)]; at('2026-12-23T15:00:00Z'); B = await brd(idBw);
    assert.strictEqual(C2(B.lots.find((l) => l.id === 'L3').earned), 0, 'and the bowl win is not paid on the CFP weekend');
    // (b) regular season: ESPN gives the rescheduled game a NEW id; the old postponed id stops holding once the new game is final
    C._reset(); at('2026-11-17T18:00:00Z'); NFL.pages = { '20261122': [gg('s1', '2026-11-22T18:00Z', 1, 2, 'pre', 0, 0, 2, 12), gg('p1', '2026-11-22T21:00Z', 3, 4, 'pre', 0, 0, 2, 12)] };
    r = await post('/calcutta/create', calcBody({ g: g.id, name: 'New id', ev: 'nfl_wk', mode: 'manual', lots: [1, 2, 3, 4].map((k) => ({ teams: [team(k)] })), rows: rows4 }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const idNi = r.j.calc.id;
    for (let i = 1; i <= 4; i++) await post('/calcutta/enter', { id: idNi, lot: 'L' + i, amt: 25, name: 'Buyer ' + i }, H(steve.token));
    NFL.pages = { '20261122': [gg('s1', '2026-11-22T18:00Z', 1, 2, 'post', 30, 20, 2, 12), gg('p1', '2026-11-22T21:00Z', 3, 4, 'pre', 0, 0, 2, 12, 'STATUS_POSTPONED')], '20261124': [gg('p1new', '2026-11-24T23:00Z', 3, 4, 'pre', 0, 0, 2, 12)] };
    at('2026-11-24T18:00:00Z'); B = await brd(idNi); assert.deepStrictEqual([B.over, B.waiting.sort()], [false, ['Team 3', 'Team 4']], 'postponed, replacement (new id) not played yet: waiting');
    NFL.pages['20261124'] = [gg('p1new', '2026-11-24T23:00Z', 3, 4, 'post', 27, 3, 2, 12)]; at('2026-11-25T15:00:00Z'); B = await brd(idNi);
    assert.deepStrictEqual([B.over, B.waiting, B.unused.slots], [true, [], 2], 'the new-id game is final: the old postponed id no longer holds it (2 win slots nobody filled)');
    assert.ok(C2(B.lots.find((l) => l.id === 'L3').earned) > 0, 'and Team 3\'s win in the replacement game is paid');
    // (c) a lot team loses to an FCS team outside the event's own list: that team never joins "Rest of the field"
    for (const warm of [false, true]) { C._reset(); at('2026-11-17T18:00:00Z'); NFL.pages = {};
      r = await post('/calcutta/create', calcBody({ g: g.id, name: 'FCS', ev: 'cfb_wk', mode: 'manual', lots: [{ teams: [cf[0]] }, { teams: [cf[1]] }, { rest: true }], rows: rows4 }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const idFc = r.j.calc.id;
      for (let i = 1; i <= 3; i++) await post('/calcutta/enter', { id: idFc, lot: 'L' + i, amt: 25, name: 'Buyer ' + i }, H(steve.token));
      NFL.pages = { '20261121': [gg('f1', '2026-11-21T18:00Z', cf[0].id, '900', 'post', 10, 31, 2, 12), gg('f2', '2026-11-21T22:00Z', cf[1].id, cf[2].id, 'post', 20, 17, 2, 12)] };
      at('2026-11-24T15:00:00Z'); C._reset(); if (warm) await post('/calcutta/teams', { ev: 'cfb_wk' }, H(steve.token)); await post('/calcutta/board', { id: idFc }, H(steve.token)); await sleep(300); B = (await post('/calcutta/board', { id: idFc }, H(steve.token))).j.board;
      const rl3 = B.lots.find((l) => l.id === 'L3'); assert.ok(!rl3.teams.some((x) => x.id === '900'), 'the FCS team is not in the rest lot (' + (warm ? 'team list cached' : 'after a restart') + ')'); assert.strictEqual(C2(rl3.earned), 0, 'and its win does not pay the rest lot'); }
    t('round 3 F1 / F2: in bowl season (type 3 week 1 for weeks) only watched ids count, so a Tuesday bowl is neither waited on nor paid; a rescheduled game with a NEW id stands in for the postponed one; an FCS opponent outside the team list never joins "Rest of the field"');

    console.log('\nPASS ' + n + ' calcutta fix-round-2 checks');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close(); process.exit(process.exitCode || 0);
});
