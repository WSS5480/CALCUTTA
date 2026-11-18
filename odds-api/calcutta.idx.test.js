// v276 (server review A1): an auction sold out by the TIMER (the lazy clock inside a poll, not Sold now) used to leave the Calcutta index 'live':
// the Games card said 'auction running', the 20-open cap counted it and F12 never slimmed it. mutCalc now syncs the index on any status change.
// Also: a deleted Calcutta never comes back in the index (the delete race the A1 hook opened, fixed the same day).
// Run: node odds-api/calcutta.idx.test.js (no network; the same fakes as calcutta.main.test.js)
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
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); x = await post('/acct/phone', { phone, pin, name }); return x.j; };
    process.env.GROUPS_ENABLED = '1';
    const A = await phoneIn('9565552001', '112233', 'Ann'), B = await phoneIn('9565552002', '445566', 'Bo');
    const mkGroup = () => ({ name: 'Idx crew', join: { requests: false, open: true, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Ann' });
    let r = await post('/groups/create', mkGroup(), H(A.token)); const g = r.j.group; await post('/groups/join', { code: g.code, myName: 'Bo' }, H(B.token));
    const body = calcBody({ g: g.id }); body.lots = body.lots.slice(0, 2); r = await post('/calcutta/create', body, H(A.token)); assert.strictEqual(r.s, 200, J(r.j)); const id = r.j.calc.id;
    await post('/calcutta/gjoin', { id }, H(B.token)); r = await post('/calcutta/ctl', { id, op: 'start' }, H(A.token)); assert.strictEqual(r.s, 200, J(r.j));
    for (let k = 0; k < 2; k++) { const c = (await post('/calcutta/get', { id }, H(A.token))).j.calc; if (!c.a.cur) { CLOCK += 10000; continue; } r = await post('/calcutta/bid', { id, lot: c.a.cur, amt: 10 }, H(B.token)); assert.strictEqual(r.s, 200, J(r.j)); CLOCK += 30000; /* the bell rings */ await post('/calcutta/state', { id }, H(A.token)); CLOCK += 10000; await post('/calcutta/state', { id }, H(A.token)); }
    const c = (await post('/calcutta/get', { id }, H(A.token))).j.calc; console.log('row status:', c.a.status, 'sold:', c.sold.length);
    await new Promise((r2) => setTimeout(r2, 1200));
    assert.strictEqual(c.a.status, 'closed', 'the timer sold every lot'); t('the timer sold both lots inside polls: the row is closed');
    const l = (await post('/calcutta/list', { g: g.id }, H(B.token))).j; assert.deepStrictEqual(l.calcs.map((x) => x.status), ['closed'], 'the group list (the Games card) reads closed, not live'); t('the group list (Games card) says closed');
    const m = (await post('/calcutta/mine', {}, H(B.token))).j; assert.deepStrictEqual(m.calcs.map((x) => x.status), ['closed'], 'My Calcuttas reads closed'); t('My Calcuttas says closed');
    // v276 regression check (server review): a delete sets status 'closed' + deleted. The A1 hook must not sync it, and syncIdx must never write a
    // deleted Calcutta back, or the late write lands after the delete route removed the entry and the Calcutta comes back as a 'closed' ghost
    // (list, mine, the Games card; tapping it gives 404). Database calls get a random 0-15 ms delay here so the writes can interleave.
    const f0 = global.fetch; global.fetch = async (u, o) => { if (String(u).startsWith('https://fake.supabase.co')) await new Promise((r2) => setTimeout(r2, Math.random() * 15)); return f0(u, o); };
    const gone = [];
    for (let round = 0; round < 3; round++) for (let q = 0; q < 4; q++) { if (!q) C._reset(); /* the create rate limit, not the index, is cleared between rounds */ const rr = await post('/calcutta/create', body, H(A.token)); assert.strictEqual(rr.s, 200, J(rr.j)); const did = rr.j.calc.id; const dd = await post('/calcutta/delete', { id: did }, H(A.token)); assert.strictEqual(dd.s, 200, J(dd.j)); gone.push(did); }
    await new Promise((r2) => setTimeout(r2, 800)); global.fetch = f0;
    const l2 = (await post('/calcutta/list', { g: g.id }, H(A.token))).j.calcs.map((x) => x.id), m2 = (await post('/calcutta/mine', {}, H(A.token))).j.calcs.map((x) => x.id);
    assert.deepStrictEqual(l2.filter((x) => gone.includes(x)), [], 'deleted Calcuttas in the group list'); assert.deepStrictEqual(m2.filter((x) => gone.includes(x)), [], 'deleted Calcuttas in My Calcuttas');
    assert.deepStrictEqual(l2, [id], 'only the sold-out Calcutta is left in the list'); t('12 creates + deletes with slow database calls: no deleted Calcutta comes back in the list or My Calcuttas');
    console.log('calcutta.idx.test.js: ' + n + ' passed');
  } catch (e) { failed++; console.error('FAIL', e && e.stack); }
  srv.close(); process.exit(failed ? 1 : 0);
});
