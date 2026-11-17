// Run: node odds-api/golfday.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// v273 Golf days. Part A = the scoring maths (pure). Part B = every rule through the REAL acct.js, sync.js, groups.js, events.js and golfday.js wired like
// server.js: the switches (dark = 403 off for everyone, the owner too), an ended account, who may do what, and what another member can read.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
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
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits'), GD = require('./golfday'), GC = require('./golfcourse');
let n = 0, CLOCK = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
GD._deps.now = () => Date.now() + CLOCK;

// =================== A. scoring (pure) ===================
const par18 = {}, si18 = {}; for (let h = 1; h <= 18; h++) { par18[h] = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4][h - 1]; si18[h] = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 16, 4, 2, 12, 6, 18, 10, 14][h - 1]; }
const mkDay = (o) => Object.assign({ id: 'AAAAAAAA', name: 'T', course: { id: 'way/1', name: 'C' }, date: '2026-11-17', format: 'gross', holes: 'all', par: par18, si: si18, players: [], scores: {}, log: [], short: '', closed: 0, started: 0 }, o || {});
{
  assert.deepStrictEqual(GD.holesOf('front'), [1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.deepStrictEqual(GD.holesOf('back'), [10, 11, 12, 13, 14, 15, 16, 17, 18]); assert.strictEqual(GD.holesOf('all').length, 18);
  // strokes given: brute force = deal one stroke at a time, hardest hole first, round and round
  const brute = (d, hcp) => { const hs = GD.holesOf(d.holes), order = hs.slice().sort((a, b) => d.si[a] - d.si[b]), out = {}; hs.forEach((h) => (out[h] = 0)); for (let i = 0; i < hcp; i++) out[order[i % order.length]]++; return out; };
  for (const holes of ['all', 'front', 'back']) for (let hcp = 0; hcp <= 54; hcp++) { const d = mkDay({ holes }), g = GD.strokesGiven(d, hcp); assert.deepStrictEqual(g, brute(d, hcp), holes + ' ' + hcp); assert.strictEqual(Object.values(g).reduce((a, x) => a + x, 0), hcp, 'the strokes given add up to the typed number'); }
  const g10 = GD.strokesGiven(mkDay(), 10); assert.strictEqual(g10[4], 1, 'stroke index 1 gets a stroke'); assert.strictEqual(g10[10], 1, 'stroke index 8'); assert.strictEqual(g10[5], 0, 'stroke index 11 gets none at 10');
  assert.strictEqual(GD.strokesGiven(mkDay(), 20)[4], 2, '20 strokes: index 1 and 2 get two'); assert.strictEqual(GD.strokesGiven(mkDay(), 20)[2], 1);
  assert.deepStrictEqual(Object.values(GD.strokesGiven(mkDay({ si: null }), 18)).reduce((a, x) => a + x, 0), 0, 'no stroke index: no strokes');
  t('playing strokes are dealt by stroke index over the holes in play (18, front 9, back 9; 0 to 54 against a one-at-a-time deal); the total is the typed number');
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6].map((net) => GD.stablefordPts(4, net)), [6, 5, 4, 3, 2, 1, 0]); assert.strictEqual(GD.stablefordPts(3, 9), 0); assert.strictEqual(GD.stablefordPts(5, 5), 2);
  t('Stableford: 2 points for net par, one more per stroke under, one less per stroke over, never below 0');
  const P = (pid, name, hcp) => ({ pid, name, hcp, joined: 1 }), all = (v) => { const o = {}; for (let h = 1; h <= 18; h++) o[h] = typeof v === 'function' ? v(h) : v; return o; };
  // gross: everyone pars except as listed
  let d = mkDay({ players: [P('AAAAAA', 'Ann', 0), P('BBBBBB', 'Bob', 10), P('CCCCCC', 'Cy', 20), P('DDDDDD', 'Dee', 5)], scores: { AAAAAA: all((h) => par18[h]), BBBBBB: all((h) => par18[h] + 1), CCCCCC: all((h) => par18[h] + (h <= 9 ? 1 : 0)), DDDDDD: {} } });
  let b = GD.board(d); assert.deepStrictEqual(b.map((r) => [r.name, r.place, r.tied, r.toPar, r.thru]), [['Ann', 1, false, 0, 18], ['Cy', 2, false, 9, 18], ['Bob', 3, false, 18, 18], ['Dee', 0, false, 0, 0]]); assert.strictEqual(b[3].none, true); assert.strictEqual(b[0].gross, 72); assert.strictEqual(b[0].done, true);
  // net: Bob (+18 gross, 10 strokes) = +8; Cy (+9 gross, 20 strokes) = -11
  d.format = 'net'; b = GD.board(d); assert.deepStrictEqual(b.map((r) => [r.name, r.place, r.toPar, r.net]), [['Cy', 1, -11, 61], ['Ann', 2, 0, 72], ['Bob', 3, 8, 80], ['Dee', 0, 0, 0]]);
  // Stableford: Ann 36; Bob: bogey every hole, a stroke on 10 holes = net par (2) on those, 1 on the other 8 = 28; Cy: 20 strokes
  d.format = 'stableford'; b = GD.board(d); const cyG = GD.strokesGiven(d, 20); let cy = 0; for (let h = 1; h <= 18; h++) cy += Math.max(0, 2 + par18[h] - (par18[h] + (h <= 9 ? 1 : 0) - cyG[h]));
  assert.deepStrictEqual(b.map((r) => [r.name, r.place, r.pts]), [['Cy', 1, cy], ['Ann', 2, 36], ['Bob', 3, 28], ['Dee', 0, 0]]); assert.strictEqual(cy, 47);
  t('leaderboard: gross and net by score to par (low wins), Stableford by net points (high wins); a player with no hole yet has no place');
  // ties share a place, the next place skips; unfinished cards rank by score to par with "thru N"
  d = mkDay({ players: [P('AAAAAA', 'Ann', 0), P('BBBBBB', 'Bob', 0), P('CCCCCC', 'Cy', 0), P('DDDDDD', 'Dee', 0), P('EEEEEE', 'Eve', 0)], scores: { AAAAAA: { 1: 3 }, BBBBBB: { 1: 4, 2: 5, 3: 3 }, CCCCCC: { 1: 4, 2: 5 }, DDDDDD: { 1: 5 }, EEEEEE: { 1: 5, 2: 5, 3: 3, 4: 4 } } });
  b = GD.board(d); assert.deepStrictEqual(b.map((r) => [r.name, r.place, r.tied, r.toPar, r.thru, r.done]), [['Ann', 1, false, -1, 1, false], ['Bob', 2, true, 0, 3, false], ['Cy', 2, true, 0, 2, false], ['Dee', 4, true, 1, 1, false], ['Eve', 4, true, 1, 4, false]]);
  d.format = 'stableford'; b = GD.board(d);
  assert.deepStrictEqual(b.map((r) => r.pts), [7, 6, 4, 3, 1]); assert.deepStrictEqual(b.map((r) => r.name), ['Eve', 'Bob', 'Cy', 'Ann', 'Dee']); assert.deepStrictEqual(b.map((r) => r.place), [1, 2, 3, 4, 5]);
  t('ties share a place ("T2", then 4: no count-back); an unfinished card is ranked by score to par with its "thru"; Stableford ranks by points so far');
  // shortened to nine: only those holes count, with the strokes each hole already had
  d = mkDay({ format: 'net', players: [P('AAAAAA', 'Ann', 18), P('BBBBBB', 'Bob', 0)], scores: { AAAAAA: all((h) => par18[h] + 1), BBBBBB: Object.assign(all((h) => par18[h]), { 12: 9 }) } });
  assert.strictEqual(GD.canShort(d, 'front'), true); assert.strictEqual(GD.canShort(d, 'back'), true); delete d.scores.BBBBBB[18]; assert.strictEqual(GD.canShort(d, 'back'), false, 'one player lacks a back-nine hole'); assert.strictEqual(GD.canShort(d, 'front'), true);
  assert.strictEqual(GD.canShort(mkDay({ holes: 'front', players: d.players, scores: d.scores }), 'front'), false, 'a 9-hole day cannot be shortened'); assert.strictEqual(GD.canShort(mkDay(), 'front'), false, 'no players');
  d.short = 'front'; b = GD.board(d); assert.deepStrictEqual(GD.counting(d), [1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.deepStrictEqual(b.map((r) => [r.name, r.place, r.tied, r.toPar, r.thru, r.of, r.done]), [['Ann', 1, true, 0, 9, 9, true], ['Bob', 1, true, 0, 9, 9, true]], 'the 9 on hole 12 no longer counts; Ann keeps one stroke a hole');
  t('an 18-hole day can be shortened to a nine only when every player has all nine; then only those holes count');
  // set-up checks
  const good = () => ({ course: { id: 'way/123', name: 'Palm View Golf Course', lat: 26.16, lon: -98.25 }, date: '2026-11-17', format: 'net', holes: 'all', par: Object.assign({}, par18), si: Object.assign({}, si18), parOk: true }), NOW = Date.parse('2026-11-17T18:00:00Z');
  const no = (ch, re) => { const x = good(); ch(x); assert.throws(() => GD.cleanDay(x, NOW), (e) => e.status === 400 && re.test(e.message), re + ''); };
  const c = GD.cleanDay(good(), NOW); assert.match(c.id, /^[A-Z2-9]{8}$/); assert.strictEqual(c.name, 'Palm View Golf Course'); assert.deepStrictEqual(c.course, { id: 'way/123', name: 'Palm View Golf Course', lat: 26.16, lon: -98.25 }); assert.deepStrictEqual([c.started, c.closed, c.short, c.players.length], [0, 0, '', 0]);
  no((x) => { x.course.id = 'way/0'; }, /course/); no((x) => { x.course.id = 'https://x'; }, /course/); no((x) => { x.course.name = ''; }, /course/); no((x) => { x.date = '2026-11-16'; }, /past/); no((x) => { x.date = '2026-02-30'; }, /date/); no((x) => { x.date = '2028-01-01'; }, /far/);
  no((x) => { x.format = 'skins'; }, /format/); no((x) => { x.format = 'match'; }, /format/); no((x) => { x.holes = '12'; }, /18 holes/); no((x) => { delete x.par[7]; }, /hole 7/); no((x) => { x.par[3] = 2; }, /hole 3/); no((x) => { x.par[3] = 7; }, /hole 3/); no((x) => { x.par[3] = '4'; }, /hole 3/); no((x) => { x.par[3] = 4.5; }, /hole 3/); no((x) => { delete x.parOk; }, /confirm/); no((x) => { x.parOk = 'yes'; }, /confirm/);
  for (const f of ['net', 'stableford']) { no((x) => { x.format = f; delete x.si; }, /stroke index/); no((x) => { x.format = f; delete x.si[9]; }, /stroke index/); no((x) => { x.format = f; x.si[9] = x.si[8]; }, /stroke index/); no((x) => { x.format = f; x.si[9] = 19; }, /stroke index/); no((x) => { x.format = f; x.si[9] = 0; }, /stroke index/); }
  const gr = good(); gr.format = 'gross'; delete gr.si[9]; assert.strictEqual(GD.cleanDay(gr, NOW).si, null, 'gross with an incomplete stroke index: accepted, no stroke index kept');
  const f9 = good(); f9.holes = 'front'; f9.par = { 1: 4, 2: 5, 3: 3, 4: 4, 5: 4, 6: 3, 7: 5, 8: 4, 9: 4, 10: 9 }; f9.si = { 1: 7, 2: 3, 3: 15, 4: 1, 5: 11, 6: 17, 7: 5, 8: 9, 9: 13 }; const c9 = GD.cleanDay(f9, NOW); assert.deepStrictEqual(Object.keys(c9.par), ['1', '2', '3', '4', '5', '6', '7', '8', '9']); assert.strictEqual(c9.si[4], 1);
  assert.strictEqual(GD.cleanDay(Object.assign(good(), { name: '<b>Sunday</b> 9566871234567890123456789012345678901234567890' }), NOW).name.length, 30);
  assert.ok(!/entry|payout|pot|price|fee|\$/i.test(J(c)), 'a Golf day holds no money field');
  t('set-up: course from the search, date today or later, three formats, 18 / front / back, par 3 to 6 on every hole and confirmed; net and Stableford need a full stroke index, gross does not; no money field');
}

// =================== B. the routes ===================
const srv = http.createServer(async (req, res) => { // the same order and the same calls as server.js
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/golfcourse')) { if (await GC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url.startsWith('/golfday')) { if (await GD.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.7.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const get = async (url, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { headers: h || {} }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok }), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), stranger = await phoneIn('9565550004', '991122', 'Stranger'), late = await phoneIn('9565550005', '335577', 'Late');
    const tOwner = (await post('/acct/owner', { pin: '4321' })).j.token, email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()), plus = (k) => new Date(Date.parse(today + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
    const setup = (o) => Object.assign({ g: 'x', course: { id: 'way/123', name: 'Palm View Golf Course', lat: 26.16, lon: -98.25 }, date: today, format: 'net', holes: 'all', par: par18, si: si18, parOk: true }, o || {});
    const OPS = ['list', 'get', 'create', 'join', 'leave', 'remove', 'hcp', 'score', 'close', 'cancel'];

    // ---- 1. dark ----
    for (const v of [undefined, '0', 'true', ' 1', 'on']) { if (v === undefined) delete process.env.GROUPS_ENABLED; else process.env.GROUPS_ENABLED = v; process.env.GROUPS_OWNER_ONLY = '1';
      const before = dbCalls.n; for (const tok of [tOwner, steve.token, tess.token, '', 'garbage']) for (const op of OPS) { const r = await post('/golfday/' + op, setup({ g: 'ABCDEFGH23' }), H(tok)); assert.strictEqual(r.s, 403, op); assert.deepStrictEqual(r.j, { error: 'Groups is not open for this account yet.', off: true }); }
      assert.strictEqual((await get('/golfday/list', H(tOwner))).s, 403); assert.strictEqual(dbCalls.n, before, 'a blocked caller reads nothing from the database'); }
    delete process.env.GROUPS_OWNER_ONLY; assert.strictEqual(EVENTS.length, 0);
    t('GROUPS_ENABLED unset (or anything but exactly "1"): every /golfday call is 403 {off:true} for everyone, the owner too; nothing is read, nothing is sent');

    // ---- 2. owner-only: the owner and a listed tester; an ended account ----
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    const mkGroup = () => ({ name: 'Sunday crew', join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' });
    let r = await post('/groups/create', mkGroup(), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group, gid = g.id;
    for (const tok of [tess.token, bo.token, stranger.token, late.token, '']) for (const op of OPS) { r = await post('/golfday/' + op, setup({ g: gid }), H(tok)); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.off, true); }
    process.env.GROUPS_TESTERS = [tess, bo, stranger, late].map(() => '').join(''); const keys = []; for (const p of [tess, bo, stranger, late]) keys.push(LIM.keyOf(await email(p.token))); process.env.GROUPS_TESTERS = keys.join(',');
    for (const [p, nm] of [[tess, 'Tess'], [bo, 'Bo'], [late, 'Late']]) { r = await post('/groups/join', { code: g.code, myName: nm }, H(p.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.ok(!r.j.pending); }
    const lateAcct = await email(late.token); ENDED.add(lateAcct); ACCT.uncache(lateAcct);
    for (const op of OPS) { r = await post('/golfday/' + op, setup({ g: gid }), H(late.token)); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.expired, true, op); assert.match(r.j.error, /^Your time has ended\./); }
    t('owner-only: an account not on the list gets 403 {off:true}; an ended account that is on the list gets 403 {expired:true} "Your time has ended" on every call');
    for (const op of OPS) { r = await post('/golfday/' + op, setup({ g: gid }), {}); assert.strictEqual(r.s, 403); } delete process.env.GROUPS_OWNER_ONLY;
    for (const op of OPS) { r = await post('/golfday/' + op, setup({ g: gid }), {}); assert.strictEqual(r.s, 401, 'signed out, Groups open: sign in'); r = await post('/golfday/' + op, setup({ g: gid }), H('garbage')); assert.strictEqual(r.s, 401); }
    process.env.GROUPS_OWNER_ONLY = '1';
    for (const op of OPS) { r = await post('/golfday/' + op, setup({ g: gid, id: 'ABCDEFGH' }), H(stranger.token)); assert.strictEqual(r.s, 403, op); assert.match(r.j.error, /members of this group/); }
    for (const bad of ['', 'x', gid + '#', gid.toLowerCase(), 'lock:grp:x']) { r = await post('/golfday/list', { g: bad }, H(steve.token)); assert.strictEqual(r.s, 404, J(bad)); }
    assert.strictEqual((await get('/golfday/list', H(steve.token))).s, 405);
    t('signed out = 401; on the list but not a member of the group = 403 on every call (rule 10); a made-up group id = 404; GET = 405');

    // ---- 3. start a Golf day (the commissioner only; one open at a time) ----
    r = await post('/golfday/list', { g: gid }, H(tess.token)); assert.strictEqual(r.s, 200); assert.deepStrictEqual([r.j.comm, r.j.open, r.j.past], [false, null, []]); assert.deepStrictEqual(r.j.formats.map((x) => x[0]), ['gross', 'net', 'stableford']); assert.deepStrictEqual(r.j.holes.map((x) => x[0]), ['all', 'front', 'back']);
    r = await post('/golfday/create', setup({ g: gid }), H(tess.token)); assert.strictEqual(r.s, 403); assert.match(r.j.error, /commissioner/);
    for (const [ch, re] of [[{ format: 'skins' }, /format/], [{ holes: 'x' }, /18 holes/], [{ parOk: false }, /confirm/], [{ si: null }, /stroke index/], [{ date: plus(-1) }, /past/], [{ course: { id: 'nope', name: 'X' } }, /course/]]) { r = await post('/golfday/create', setup(Object.assign({ g: gid }, ch)), H(steve.token)); assert.strictEqual(r.s, 400, J(ch)); assert.match(r.j.error, re); }
    assert.strictEqual(EVENTS.filter((e) => e.type === 'golf_start').length, 0);
    r = await post('/golfday/create', setup({ g: gid, date: plus(1), name: 'Saturday game' }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); let day = r.j.day; const did = day.id;
    assert.deepStrictEqual([day.name, day.format, day.holes, day.date, day.started, day.closed, day.comm, day.joined, day.canJoin, day.canScore, day.usesHcp], ['Saturday game', 'net', 'all', plus(1), false, 0, true, false, true, false, true]); assert.deepStrictEqual(day.course, { id: 'way/123', name: 'Palm View Golf Course', lat: 26.16, lon: -98.25 });
    r = await post('/golfday/create', setup({ g: gid }), H(steve.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /already has an open Golf day/);
    await sleep(700); const ev = EVENTS.filter((e) => e.type === 'golf_start'); assert.strictEqual(ev.length, 1, 'one golf_start event, for the one day that was made');
    assert.deepStrictEqual(Object.keys(ev[0]).sort(), ['account', 'detail', 'key', 'secret', 'slug', 'title', 'type'].filter((k) => k in ev[0]).sort()); assert.strictEqual(ev[0].title, 'Golf started: Saturday game'); assert.strictEqual(ev[0].key, 'golf_start|' + gid + '|' + did); assert.strictEqual(ev[0].account, await email(steve.token));
    assert.strictEqual(ev[0].detail, 'Group: Sunday crew. Palm View Golf Course. Stroke play (net). ' + plus(1)); assert.ok(!/956|555-?000|112233|4321|\d{7,}/.test(ev[0].title + ev[0].detail), 'no phone number or PIN in the event'); assert.ok(!/@/.test(ev[0].title + ev[0].detail), 'no email in the event text');
    t('only the commissioner starts a Golf day; one open day per group (rule 11); My Apps is told once with type golf_start (group, day, course, format, date: no phone, email or PIN)');

    // ---- 4. joining (rules 4, 9, 10) ----
    for (const bad of [undefined, -1, 55, 3.5, '10', null]) { r = await post('/golfday/join', { g: gid, id: did, hcp: bad }, H(tess.token)); if (bad == null) { assert.strictEqual(r.s, 200, 'no number = 0 strokes'); await post('/golfday/leave', { g: gid, id: did }, H(tess.token)); } else { assert.strictEqual(r.s, 400, J(bad)); assert.match(r.j.error, /playing strokes/); } }
    r = await post('/golfday/join', { g: gid, id: did, hcp: 10 }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual([r.j.day.joined, r.j.day.myHcp, r.j.day.players, r.j.day.canJoin], [true, 10, 1, false]);
    r = await post('/golfday/join', { g: gid, id: did, hcp: 12 }, H(tess.token)); assert.strictEqual(r.j.day.myHcp, 12); assert.strictEqual(r.j.day.players, 1, 'joining again changes the number, it does not add a second card'); assert.deepStrictEqual([r.j.day.log[0].kind, r.j.day.log[0].by, r.j.day.log[0].who, r.j.day.log[0].old, r.j.day.log[0].new], ['hcp', 'Tess', 'Tess', 10, 12]);
    r = await post('/golfday/join', { g: gid, id: did, hcp: 20 }, H(bo.token)); assert.strictEqual(r.s, 200); r = await post('/golfday/join', { g: gid, id: did, hcp: 0 }, H(steve.token)); assert.strictEqual(r.s, 200); day = r.j.day; const pidOf = (nm) => day.board.find((x) => x.name === nm).pid, pT = pidOf('Tess'), pB = pidOf('Bo'), pS = pidOf('Steve');
    assert.deepStrictEqual(day.board.map((x) => [x.name, x.hcp, x.none, x.thru]), [['Bo', 20, true, 0], ['Steve', 0, true, 0], ['Tess', 12, true, 0]]);
    // the commissioner changes a number before the first score: logged, shown
    r = await post('/golfday/hcp', { g: gid, id: did, pid: pB, hcp: 16 }, H(tess.token)); assert.strictEqual(r.s, 403); r = await post('/golfday/hcp', { g: gid, id: did, pid: pB, hcp: 99 }, H(steve.token)); assert.strictEqual(r.s, 400);
    r = await post('/golfday/hcp', { g: gid, id: did, pid: pB, hcp: 16 }, H(steve.token)); assert.strictEqual(r.s, 200); assert.deepStrictEqual([r.j.day.log[0].kind, r.j.day.log[0].by, r.j.day.log[0].who, r.j.day.log[0].old, r.j.day.log[0].new], ['hcp', 'Steve', 'Bo', 20, 16]); assert.ok(r.j.day.log[0].at > 0);
    r = await post('/golfday/get', { g: gid, id: did }, H(tess.token)); assert.strictEqual(r.j.day.board.find((x) => x.pid === pB).hcp, 16, 'everyone sees the changed number'); assert.strictEqual(r.j.day.log[0].who, 'Bo', 'and the log');
    // remove and leave before the first score
    r = await post('/golfday/remove', { g: gid, id: did, pid: pB }, H(tess.token)); assert.strictEqual(r.s, 403); r = await post('/golfday/remove', { g: gid, id: did, pid: pB }, H(steve.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.day.players, 2); assert.deepStrictEqual([r.j.day.log[0].kind, r.j.day.log[0].who], ['remove', 'Bo']);
    r = await post('/golfday/remove', { g: gid, id: did, pid: pB }, H(steve.token)); assert.strictEqual(r.s, 404); r = await post('/golfday/join', { g: gid, id: did, hcp: 20 }, H(bo.token)); assert.strictEqual(r.s, 200, 'a removed member may join again while joining is open');
    r = await post('/golfday/leave', { g: gid, id: did }, H(bo.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.day.joined, false); r = await post('/golfday/leave', { g: gid, id: did }, H(bo.token)); assert.strictEqual(r.s, 409); r = await post('/golfday/join', { g: gid, id: did, hcp: 20 }, H(bo.token)); assert.strictEqual(r.s, 200);
    t('a member joins with his own playing strokes (0 to 54, whole); the commissioner may change a number or remove a member before the first score, both logged and shown to everyone');

    // ---- 5. scores (rules 5, 6, 12) ----
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 4 }, H(tess.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /open on the day/); assert.strictEqual(r.j.error.includes(plus(1)), true);
    CLOCK = 864e5; // the day of the round
    for (const [b2, code] of [[{ hole: 0, strokes: 4 }, 400], [{ hole: 19, strokes: 4 }, 400], [{ hole: 1.5, strokes: 4 }, 400], [{ hole: '1', strokes: 4 }, 400], [{ hole: 1, strokes: 21 }, 400], [{ hole: 1, strokes: -1 }, 400], [{ hole: 1, strokes: 4.5 }, 400], [{ hole: 1, strokes: '4' }, 400]]) { r = await post('/golfday/score', Object.assign({ g: gid, id: did }, b2), H(tess.token)); assert.strictEqual(r.s, code, J(b2)); }
    r = await post('/golfday/get', { g: gid, id: did }, H(tess.token)); assert.strictEqual(r.j.day.started, false, 'a refused score does not start the round'); assert.strictEqual(r.j.day.canScore, true);
    // a member of the group who has not joined the day cannot score; the commissioner cannot enter a first score for someone else
    await post('/golfday/leave', { g: gid, id: did }, H(bo.token)); r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 4 }, H(bo.token)); assert.strictEqual(r.s, 403); assert.match(r.j.error, /Join this Golf day first/); await post('/golfday/join', { g: gid, id: did, hcp: 20 }, H(bo.token));
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 4, pid: pT }, H(steve.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /enters his own scores/);
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 4, pid: pS }, H(tess.token)); assert.strictEqual(r.s, 403, 'a member cannot touch another member\'s card'); assert.match(r.j.error, /commissioner/);
    r = await post('/golfday/get', { g: gid, id: did }, H(tess.token)); assert.strictEqual(r.j.day.started, false);
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 5 }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); day = r.j.day; assert.strictEqual(day.started, true); assert.strictEqual(day.scores[pT][1], 5); assert.strictEqual(day.log.filter((x) => x.kind === 'edit').length, 0, 'a first entry is not logged as a change');
    assert.deepStrictEqual(day.board.map((x) => [x.name, x.place, x.thru, x.toPar]), [['Tess', 1, 1, 0], ['Bo', 0, 0, 0], ['Steve', 0, 0, 0]], 'it counts at once: 5 on a par 4 with one stroke given (index 7, 12 strokes) = level');
    // joining, removing and changing numbers are closed from the first score
    r = await post('/golfday/leave', { g: gid, id: did }, H(bo.token)); assert.strictEqual(r.s, 409); r = await post('/golfday/remove', { g: gid, id: did, pid: pB }, H(steve.token)); assert.strictEqual(r.s, 409); r = await post('/golfday/hcp', { g: gid, id: did, pid: pB, hcp: 2 }, H(steve.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /frozen/);
    r = await post('/golfday/join', { g: gid, id: did, hcp: 2 }, H(bo.token)); assert.strictEqual(r.s, 409, 'nor may a player re-type his own number'); r = await post('/golfday/cancel', { g: gid, id: did }, H(steve.token)); assert.strictEqual(r.s, 409);
    r = await post('/groups/join', { code: g.code, myName: 'Stranger' }, H(stranger.token)); assert.strictEqual(r.s, 200); r = await post('/golfday/join', { g: gid, id: did, hcp: 2 }, H(stranger.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Joining closed/);
    r = await post('/golfday/get', { g: gid, id: did }, H(stranger.token)); assert.strictEqual(r.s, 200, 'a group member who is not playing can still watch'); assert.deepStrictEqual([r.j.day.joined, r.j.day.canJoin, r.j.day.canScore], [false, false, false]);
    t('scores open on the day of the round; a member enters only his own; a score counts at once; joining, removing, leaving and playing strokes are frozen from the first score');
    // own edit (logged), own clear (logged), the commissioner's correction (logged)
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 5 }, H(tess.token)); assert.strictEqual(r.j.day.log.filter((x) => x.kind === 'edit').length, 0, 'the same number again changes nothing');
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 4 }, H(tess.token)); assert.strictEqual(r.s, 200); let L = r.j.day.log[0]; assert.deepStrictEqual([L.kind, L.by, L.who, L.hole, L.old, L.new], ['edit', 'Tess', 'Tess', 1, 5, 4]); assert.ok(Math.abs(L.at - (Date.now() + CLOCK)) < 5000);
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 6, pid: pT }, H(steve.token)); assert.strictEqual(r.s, 200); L = r.j.day.log[0]; assert.deepStrictEqual([L.kind, L.by, L.who, L.hole, L.old, L.new], ['fix', 'Steve', 'Tess', 1, 4, 6]); assert.strictEqual(r.j.day.scores[pT][1], 6);
    r = await post('/golfday/score', { g: gid, id: did, hole: 1, strokes: 0, pid: pT }, H(steve.token)); assert.strictEqual(r.s, 400, 'the commissioner corrects, he does not wipe');
    r = await post('/golfday/get', { g: gid, id: did }, H(bo.token)); assert.deepStrictEqual(r.j.day.log.slice(0, 2).map((x) => x.kind), ['fix', 'edit'], 'every member sees the log');
    r = await post('/golfday/score', { g: gid, id: did, hole: 2, strokes: 7 }, H(tess.token)); r = await post('/golfday/score', { g: gid, id: did, hole: 2, strokes: null }, H(tess.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.day.scores[pT][2], undefined); L = r.j.day.log[0]; assert.deepStrictEqual([L.kind, L.hole, L.old, L.new], ['clear', 2, 7, null]);
    t('a member changes or clears his own hole (logged); the commissioner corrects a hole a member has entered (logged: who, hole, old, new, when); every member sees the log');

    // ---- 6. a full round, three players, net; the board; closing ----
    const play = async (p, fn, from, to) => { for (let h = from || 1; h <= (to || 18); h++) { const x = await post('/golfday/score', { g: gid, id: did, hole: h, strokes: fn(h) }, H(p.token)); assert.strictEqual(x.s, 200, J(x.j)); } };
    await play(tess, (h) => par18[h] + 1); await play(steve, (h) => par18[h]); await play(bo, (h) => par18[h] + 1, 1, 9);
    r = await post('/golfday/get', { g: gid, id: did }, H(bo.token)); day = r.j.day;
    // Tess: +18 gross, 12 strokes = +6. Steve: 0. Bo: +9 through nine with 20 strokes: front-nine holes each get 1, and index 1 and 2 (holes 4 and 13) get 2: hole 4 is on the front = 10 strokes -> -1
    assert.deepStrictEqual(day.board.map((x) => [x.name, x.place, x.tied, x.toPar, x.thru, x.done]), [['Bo', 1, false, -1, 9, false], ['Steve', 2, false, 0, 18, true], ['Tess', 3, false, 6, 18, true]]); assert.deepStrictEqual(day.canShort, ['front']);
    r = await post('/golfday/close', { g: gid, id: did }, H(tess.token)); assert.strictEqual(r.s, 403); r = await post('/golfday/close', { g: gid, id: did, short: 'back' }, H(steve.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Not every player/); r = await post('/golfday/close', { g: gid, id: did, short: 'middle' }, H(steve.token)); assert.strictEqual(r.s, 400);
    r = await post('/golfday/close', { g: gid, id: did, short: 'front' }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); day = r.j.day; assert.ok(day.closed > 0); assert.strictEqual(day.short, 'front'); assert.deepStrictEqual(day.count, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // front nine only: Tess +9 gross, strokes on the front (index 7,3,1,11,5,9 of 12) = 6 -> +3; Steve 0; Bo -1
    assert.deepStrictEqual(day.board.map((x) => [x.name, x.place, x.toPar, x.thru, x.of, x.done]), [['Bo', 1, -1, 9, 9, true], ['Steve', 2, 0, 9, 9, true], ['Tess', 3, 3, 9, 9, true]]); assert.deepStrictEqual([day.log[0].kind, day.log[0].by, day.log[0].short], ['close', 'Steve', 'front']);
    for (const [op, b2, tok] of [['score', { hole: 1, strokes: 3 }, tess.token], ['score', { hole: 1, strokes: 3, pid: pT }, steve.token], ['join', { hcp: 1 }, stranger.token], ['hcp', { pid: pT, hcp: 1 }, steve.token], ['remove', { pid: pT }, steve.token], ['leave', {}, tess.token], ['close', {}, steve.token], ['cancel', {}, steve.token]]) { r = await post('/golfday/' + op, Object.assign({ g: gid, id: did }, b2), H(tok)); assert.strictEqual(r.s, 409, op); assert.match(r.j.error, /closed/, op); }
    t('the commissioner closes the day; shortened to the front 9 only when every player has those nine, and then only those holes count; a closed day cannot be changed by anyone');

    // ---- 7. a second day: gross, 9 holes, no stroke index; cancel; history ----
    r = await post('/golfday/list', { g: gid }, H(tess.token)); assert.strictEqual(r.j.open, null); assert.deepStrictEqual(r.j.past.map((x) => [x.id, x.short, x.players]), [[did, 'front', 3]]);
    r = await post('/golfday/create', setup({ g: gid, format: 'stableford', si: { 1: 1 }, holes: 'back', date: plus(1) }), H(steve.token)); assert.strictEqual(r.s, 400); assert.strictEqual(r.j.error, GD.NEED_SI);
    r = await post('/golfday/create', setup({ g: gid, format: 'gross', si: { 1: 1 }, holes: 'back', date: plus(1) }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const d2 = r.j.day.id; assert.strictEqual(r.j.day.si, null); assert.strictEqual(r.j.day.usesHcp, false); assert.deepStrictEqual(Object.keys(r.j.day.par), ['10', '11', '12', '13', '14', '15', '16', '17', '18']);
    r = await post('/golfday/join', { g: gid, id: d2, hcp: 30 }, H(tess.token)); assert.strictEqual(r.j.day.myHcp, 0, 'gross: no playing strokes are kept'); r = await post('/golfday/hcp', { g: gid, id: d2, pid: pT, hcp: 3 }, H(steve.token)); assert.strictEqual(r.s, 400);
    r = await post('/golfday/score', { g: gid, id: d2, hole: 3, strokes: 4 }, H(tess.token)); assert.strictEqual(r.s, 400); assert.match(r.j.error, /not in this round/);
    r = await post('/golfday/close', { g: gid, id: d2 }, H(steve.token)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Cancel/);
    r = await post('/golfday/score', { g: gid, id: d2, hole: 10, strokes: 3 }, H(tess.token)); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.day.board.map((x) => [x.name, x.place, x.toPar, x.thru, x.of]), [['Tess', 1, -1, 1, 9]]);
    r = await post('/golfday/close', { g: gid, id: d2, short: 'front' }, H(steve.token)); assert.strictEqual(r.s, 400, 'a 9-hole day cannot be shortened'); r = await post('/golfday/close', { g: gid, id: d2 }, H(steve.token)); assert.strictEqual(r.s, 200);
    r = await post('/golfday/create', setup({ g: gid, format: 'gross', date: plus(1) }), H(steve.token)); const d3 = r.j.day.id; r = await post('/golfday/cancel', { g: gid, id: d3 }, H(tess.token)); assert.strictEqual(r.s, 403); r = await post('/golfday/cancel', { g: gid, id: d3 }, H(steve.token)); assert.deepStrictEqual(r.j, { ok: true, gone: true });
    r = await post('/golfday/get', { g: gid, id: d3 }, H(steve.token)); assert.strictEqual(r.s, 404); r = await post('/golfday/list', { g: gid }, H(steve.token)); assert.strictEqual(r.j.open, null); assert.deepStrictEqual(r.j.past.map((x) => x.id), [d2, did]);
    for (let i = 0; i < 3; i++) { r = await post('/golfday/create', setup({ g: gid, format: 'gross', date: plus(1) }), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); await post('/golfday/cancel', { g: gid, id: r.j.day.id }, H(steve.token)); }
    r = await post('/golfday/create', setup({ g: gid, format: 'gross', date: plus(1) }), H(steve.token)); assert.strictEqual(r.s, 429, 'five Golf days started inside 24 hours by one account (the first one here was the day before), then a pause');
    await sleep(900); assert.strictEqual(EVENTS.filter((e) => e.type === 'golf_start').length, 6, 'one event per Golf day really made, none for a refused one');
    t('gross needs no stroke index and keeps no playing strokes; a 9-hole day takes only its own holes; cancel is for a day with no score; closed days stay in the list; 5 starts a day per account');

    // ---- 8. what another member can read; no money anywhere ----
    const seen = J([(await post('/golfday/list', { g: gid }, H(bo.token))).j, (await post('/golfday/get', { g: gid, id: did }, H(bo.token))).j, (await post('/golfday/get', { g: gid, id: d2 }, H(stranger.token))).j, EVENTS.filter((e) => e.type === 'golf_start').map((e) => [e.title, e.detail, e.key])]);
    for (const [what, re] of [['a phone number', /956\D?555\D?000\d/], ['an account id', /@phone\.oddable/], ['a PIN', /112233|445566|778899|991122|335577|4321/], ['a sync row id', /[0-9a-f]{40}/], ['an email', /[\w.]+@[\w.]+\.[a-z]{2,}/i], ['a member key', /"mk"|"sid"|pinhash|salt/]]) assert.ok(!re.test(seen), 'another member\'s view holds ' + what);
    assert.ok(!/entry|payout|"pot|price|fee|paid|\$/i.test(seen), 'no money word in any Golf day answer');
    const row = DB['lock:gd:' + gid]; assert.ok(row && Array.isArray(row.data.days), 'one row per group, under the lock: prefix'); assert.ok(!/@|956555|pinhash":"[0-9a-f]{20}/.test(J(row.data)), 'the stored days hold names and member ids only');
    t('a member sees names, short member ids, scores and the log: no phone number, account id, email, PIN or key; no money field in any answer or in the stored row');

    // ---- 9. the flag-colour hook is untouched (rule 13), and Groups itself still works ----
    assert.strictEqual(await GC._deps.organizer({ headers: H(steve.token) }, 'way/123'), false, 'golfcourse.js D.organizer still answers false');
    r = await post('/groups/get', { id: gid }, H(steve.token)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.group.members.length, 5);
    const mc = await G.memberCheck(gid, await email(tess.token)); assert.deepStrictEqual(Object.keys(mc).sort(), ['comm', 'group', 'member', 'name', 'pid']); assert.strictEqual(mc.group, 'Sunday crew');
    delete process.env.GROUPS_ENABLED; r = await post('/golfday/get', { g: gid, id: did }, H(steve.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true);
    t('the course flag-colour hook still answers false; switching GROUPS_ENABLED off again blocks Golf days at once (nothing is deleted)');
  } catch (e) { failed = 1; console.error('  FAIL after ' + n + ' passed:', e && e.stack || e); }
  srv.close(); console.log(failed ? 'golfday.test: FAILED' : 'golfday.test: all ' + n + ' passed'); setTimeout(() => process.exit(failed), 50);
});
