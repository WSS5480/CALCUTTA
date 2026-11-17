// Run: node odds-api/local.race.test.js   (no network: in-memory fakes)
// Review fix S1 (Nov 17 2026): the shared index row lock:evtidx under concurrent writes (the reviewer's S3c / S3d), a failed index write after the game row
// was written (no orphan game, no error, repaired later), retried joins and claims are successes, unchanged entries are not rewritten.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const ENDED = new Set(), J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, EVENTS = [], dbCalls = { n: 0 };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); assert.strictEqual(b.secret, 's3cret'); if (p === '/api/v1/event') { EVENTS.push(b); return ok({ ok: true }); } if (p === '/api/v1/account') return ok(Object.assign({ email: b.email, role: 'user', plan: 'pro', expires_on: null }, ENDED.has(b.email) ? { expires_on: '2026-01-01' } : {})); return ok({}); } // as golfday.test.js
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  dbCalls.n++;
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
let LAT = 0; const _ff = global.fetch; global.fetch = async (u, o) => { if (LAT && String(u).startsWith('https://fake.supabase.co')) await new Promise((r) => setTimeout(r, Math.random() * LAT)); return _ff(u, o); };
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits'), L = require('./local');
let n = 0, CLOCK = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
L._deps.now = () => Date.now() + CLOCK;

const srv = http.createServer(async (req, res) => { // the same order and the same calls as server.js
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url === '/local' || req.url.startsWith('/local/') || req.url.startsWith('/local?')) { try { if (await L.handle(req, res)) return; } catch (e) { res.statusCode = 500; return res.end('{"error":"pickleball error"}'); } }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.7.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) {} return { s: r.status, j, txt }; };
const get = async (url, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { headers: h || {} }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok }), sleep = (ms) => new Promise((r) => setTimeout(r, ms));

srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    process.env.GROUPS_ENABLED = '1';
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const P = []; for (let i = 1; i <= 6; i++) P.push(await phoneIn('95655500' + String(10 + i), '1122' + (30 + i), 'P' + i)); const [steve, bo, cy, dee, eve, fay] = P;
    const mkGroup = (nm, my) => ({ name: nm, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: my });
    let r = await post('/groups/create', mkGroup('Race crew', 'Steve'), H(steve.token)); const gid = r.j.group.id, code = r.j.group.code;
    for (const [p, nm] of [[bo, 'Bo'], [cy, 'Cy'], [dee, 'Dee'], [eve, 'Eve'], [fay, 'Fay']]) assert.strictEqual((await post('/groups/join', { code, myName: nm }, H(p.token))).s, 200);
    const L8 = (o) => Object.assign({ g: gid, title: 'Race', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: Date.now() + 3600e3, to: 11, winBy: 2, bestOf: 1, seeding: 'random', courts: 2, pools: 1, playoff: 0, playIn: false, self: true, spectators: true, entrants: [] }, o || {});
    const lc = (op, b, tok) => post('/local/' + op, b, H(tok));
    const idx = () => (DB['lock:evtidx'] && DB['lock:evtidx'].data.ev) || {}, rows = () => Object.keys(DB).filter((k) => k.startsWith('lock:evt:') && !DB[k].data.deleted).map((k) => k.slice(9));

    // ---- 1. reviewer's S3c: 20 joins to 10 games at once, every one writing the shared index row ----
    const gs = []; for (let i = 0; i < 10; i++) { L._reset(); gs.push((await lc('create', L8({ title: 'Idx' + i }), steve.token)).j.event); } L._reset();
    LAT = 30; let jr = await Promise.all([].concat(...gs.map((ge) => [bo, cy].map((p) => lc('join', { g: gid, id: ge.id, as: 'spectator' }, p.token)))));
    assert.deepStrictEqual(jr.map((x) => x.s), jr.map(() => 200), 'every concurrent join answers 200: ' + jr.map((x) => x.s + (x.j && x.j.error ? ' ' + x.j.error : '')).join(','));
    gs.forEach((ge) => assert.ok(['Bo', 'Cy'].every((nm) => DB['lock:evt:' + ge.id].data.members.some((m) => m.name === nm)), 'both joins written'));
    t('S3c: 20 joins to 10 games at once (each writes the one shared index row): all 200, all written');

    // ---- 2. reviewer's S3d: 6 creates + 20 joins at once: no orphan game, no duplicate, one pickleball_start each ----
    L._reset();
    const cr = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => lc('create', L8({ title: 'Par' + i }), steve.token)).concat([].concat(...gs.map((ge) => [dee, eve].map((p) => lc('join', { g: gid, id: ge.id, as: 'spectator' }, p.token))))));
    assert.deepStrictEqual(cr.map((x) => x.s), cr.map(() => 200), 'all 200: ' + cr.map((x) => x.s).join(',')); LAT = 0; await sleep(300);
    assert.deepStrictEqual(rows().filter((id) => !idx()[id]), [], 'no game row is missing from the index'); assert.strictEqual(rows().length, Object.keys(idx()).length);
    const titles = rows().map((id) => DB['lock:evt:' + id].data.title).filter((x) => /^Par/.test(x)).sort(); assert.deepStrictEqual(titles, ['Par1', 'Par2', 'Par3', 'Par4', 'Par5', 'Par6'], 'each create once');
    for (let w = 0; w < 50 && EVENTS.filter((e) => e.type === 'pickleball_start' && /: Par\d$/.test(e.title)).length < 6; w++) await sleep(200); /* events.js sends its queue with a gap between events */ await sleep(300); const pars = EVENTS.filter((e) => e.type === 'pickleball_start' && /: Par\d$/.test(e.title)).map((e) => e.title).sort(); assert.deepStrictEqual(pars, [1, 2, 3, 4, 5, 6].map((i) => 'Pickleball started: Par' + i), 'one pickleball_start per game ' + J(pars));
    const lst = (await lc('list', { g: gid }, bo.token)).j.events.map((x) => x.title); assert.ok(['Par1', 'Par6', 'Idx0'].every((x) => lst.includes(x)));
    t('S3d: 6 creates and 20 joins at once: all 200, every game row in the index, no duplicates, one pickleball_start per game, all listed');

    // ---- 3. the index write fails outright: the game still counts (200, listed, found by code, event sent), and is re-indexed later ----
    const S0 = L._deps.S; let block = true; L._deps.S = Object.assign({}, S0, { dbPatchIf: async (id, ...a) => (block && id === 'lock:evtidx' ? false : S0.dbPatchIf(id, ...a)) }); L._deps.sleep = async () => {};
    L._reset(); r = await lc('create', L8({ title: 'Lost index', entrants: [{ name: 'Gus' }] }), steve.token); assert.strictEqual(r.s, 200, 'create answers 200 although the index write failed: ' + r.txt); const lost = r.j.event;
    assert.ok(!idx()[lost.id], 'not in the index yet'); assert.deepStrictEqual(L._idxQueue(), [lost.id], 'waiting to be re-indexed');
    assert.ok((await lc('list', { g: gid }, bo.token)).j.events.some((x) => x.id === lost.id), 'listed for members meanwhile');
    assert.strictEqual((await lc('preview', { g: gid, id: lost.id }, bo.token)).s, 200); assert.strictEqual((await lc('preview', { g: gid, code: lost.code }, bo.token)).s, 200, 'found by its code meanwhile');
    for (let w = 0; w < 50 && !EVENTS.some((e) => e.type === 'pickleball_start' && e.key === lost.id); w++) await sleep(200); assert.ok(EVENTS.some((e) => e.type === 'pickleball_start' && e.key === lost.id), 'pickleball_start sent');
    r = await lc('join', { g: gid, id: lost.id, as: 'player', entryName: 'Bo' }, bo.token); assert.strictEqual(r.s, 200, 'a join while the index is stuck still answers 200');
    r = await lc('join', { g: gid, id: lost.id, as: 'player', entryName: 'Bo' }, bo.token); assert.strictEqual(r.s, 200, 'the same join again (a retry) = 200, no second entry'); assert.strictEqual(r.j.event.entrants.filter((e) => e.name === 'Bo').length, 1);
    const gus = lost.entrants.find((e) => e.name === 'Gus').players[0].claim;
    r = await lc('claim', { g: gid, claim: gus }, cy.token); assert.strictEqual(r.s, 200, r.txt); r = await lc('claim', { g: gid, claim: gus }, cy.token); assert.strictEqual(r.s, 200, 'the same claim again (a retry after a lost answer) = 200: ' + r.txt);
    assert.strictEqual((await lc('claim', { g: gid, claim: gus }, dee.token)).s, 404, 'someone else cannot use a used claim code');
    block = false; await lc('list', { g: gid }, bo.token); assert.ok(idx()[lost.id] && idx()[lost.id].mk.length === 3, 'repaired from the CURRENT game row (3 members) once the index is writable'); assert.deepStrictEqual(L._idxQueue(), []);
    L._deps.S = S0; delete L._deps.sleep; L._deps.sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    t('the index write fails: create / join / claim still answer 200, the game is listed and found by code, pickleball_start is sent; a retried join or claim is a success, not an error; the index is repaired from the current row');

    // ---- 4. an unchanged index entry is not rewritten ----
    const before = DB['lock:evtidx'].updated; r = await lc('join', { g: gid, id: gs[0].id, as: 'spectator' }, bo.token); assert.strictEqual(r.s, 200); assert.strictEqual(DB['lock:evtidx'].updated, before, 'a join that changes nothing does not touch the index row');
    r = await lc('get', { g: gid, id: gs[0].id }, bo.token); assert.strictEqual(DB['lock:evtidx'].updated, before);
    t('an unchanged index entry is not rewritten (a repeated join, a read)');
  } catch (e) { failed = 1; console.error('  FAIL after ' + n + ' passed:', e && e.stack || e); }
  srv.close(); console.log(failed ? 'local.race.test: FAILED' : 'local.race.test: all ' + n + ' passed'); setTimeout(() => process.exit(failed), 50);
});
