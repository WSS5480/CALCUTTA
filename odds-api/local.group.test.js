// Run: node odds-api/local.group.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// Pickleball as a group game (branch pb-group): every rule of the GROUP GATE in odds-api/local.js, through the REAL acct.js, sync.js, groups.js,
// limits.js, events.js (activity) and local.js, wired like server.js. The switches (dark = 403 off for everyone, the owner too, nothing read), owner-only,
// testers, an ended account, signed out, not a member, a made-up group, routes a group may not use; the commissioner starts, pickleball only, money forced
// off; games scoped to their group; join by id; claim codes per group; every format played end to end through the gate; the 8-person cap from limits.js
// with no price sentence; the activity hook (key = game id, no contact data); what another member can read.
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
const OPS = ['list', 'create', 'preview', 'join', 'claim', 'get', 'edit', 'entrant', 'draw', 'leave', 'delete', 'finish', 'solo', 'score', 'confirm', 'dispute', 'live', 'pick', 'picklock', 'challenge', 'accept', 'decline', 'tiebreak', 'poreset', 'poredraw', 'partners', 'teams', 'trate', 'peek', 'mine', 'paid'];
const PRICE = /\$500|per player per game|Contact us|license/i;

srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), stranger = await phoneIn('9565550004', '991122', 'Stranger'), late = await phoneIn('9565550005', '335577', 'Late'), cy = await phoneIn('9565550006', '224466', 'Cy');
    const tOwner = (await post('/acct/owner', { pin: '4321' })).j.token, email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;
    const L8 = (o) => Object.assign({ title: 'Saturday Smash', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: Date.now() + CLOCK + 3600e3, to: 11, winBy: 2, bestOf: 1, scoring: 'sideout', seeding: 'random', courts: 2, pools: 1, playoff: 0, playIn: true, self: true, spectators: true, entrants: [] }, o || {});
    const lc = (op, b, tok) => post('/local/' + op, b, H(tok));
    const okk = (r, what) => { assert.strictEqual(r.s, 200, (what || '') + ' ' + r.s + ' ' + r.txt); return r.j; };
    const no = (r, code, what) => { assert.strictEqual(r.s, code, (what || '') + ' ' + r.s + ' ' + r.txt); return r.j; };

    // ---- 1. dark: GROUPS_ENABLED anything but exactly "1" ----
    for (const v of [undefined, '0', 'true', ' 1', 'on']) { if (v === undefined) delete process.env.GROUPS_ENABLED; else process.env.GROUPS_ENABLED = v; process.env.GROUPS_OWNER_ONLY = '1';
      const before = dbCalls.n; for (const tok of [tOwner, steve.token, tess.token, '', 'garbage']) for (const op of OPS) { const r = await lc(op, L8({ g: 'ABCDEFGH23', id: 'ABCDEFGH23' }), tok); assert.strictEqual(r.s, 403, op); assert.deepStrictEqual(r.j, { error: 'Groups is not open for this account yet.', off: true }); }
      assert.strictEqual((await get('/local/list', H(tOwner))).s, 403); assert.strictEqual((await post('/local', {}, H(tOwner))).s, 403); assert.strictEqual(dbCalls.n, before, 'a blocked caller reads nothing from the database'); }
    delete process.env.GROUPS_OWNER_ONLY; assert.strictEqual(EVENTS.length, 0);
    t('GROUPS_ENABLED unset (or anything but exactly "1"): every /local call (31 routes, peek / mine / paid too) is 403 {off:true} for everyone, the owner too; nothing is read, nothing is sent');

    // ---- 2. owner-only, testers, ended, signed out, not a member, a made-up group, GET, routes a group may not use ----
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    const mkGroup = (nm) => ({ name: nm || 'Sunday crew', join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' });
    let r = await post('/groups/create', mkGroup(), H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const g = r.j.group, gid = g.id;
    for (const tok of [tess.token, bo.token, stranger.token, late.token, cy.token, '']) for (const op of OPS) { r = await lc(op, L8({ g: gid }), tok); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.off, true); }
    const keys = []; for (const p of [tess, bo, stranger, late, cy]) keys.push(LIM.keyOf(await email(p.token))); process.env.GROUPS_TESTERS = keys.join(',');
    for (const [p, nm] of [[tess, 'Tess'], [bo, 'Bo'], [late, 'Late'], [cy, 'Cy']]) { r = await post('/groups/join', { code: g.code, myName: nm }, H(p.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.ok(!r.j.pending); }
    const lateAcct = await email(late.token); ENDED.add(lateAcct); ACCT.uncache(lateAcct);
    for (const op of OPS) { r = await lc(op, L8({ g: gid }), late.token); assert.strictEqual(r.s, 403, op); assert.strictEqual(r.j.expired, true, op); assert.match(r.j.error, /^Your time has ended\./); }
    t('owner-only: an account not on the list gets 403 {off:true}; a listed tester whose time ended gets 403 {expired:true} "Your time has ended" on every call');
    for (const op of OPS) { r = await lc(op, L8({ g: gid }), ''); assert.strictEqual(r.s, 403); } delete process.env.GROUPS_OWNER_ONLY;
    for (const op of OPS) { no(await lc(op, L8({ g: gid }), ''), 401, 'signed out ' + op); no(await lc(op, L8({ g: gid }), 'garbage'), 401); }
    process.env.GROUPS_OWNER_ONLY = '1';
    for (const op of OPS.filter((o) => !['peek', 'mine', 'paid'].includes(o))) { r = no(await lc(op, L8({ g: gid, id: 'ABCDEFGH23' }), stranger.token), 403, op); assert.match(r.error, /members of this group/); }
    for (const bad of ['', 'x', gid + '#', gid.toLowerCase(), 'lock:grp:x', 'ABCDEFGH23']) { r = await lc('list', { g: bad }, steve.token); assert.ok(r.s === 404 || (bad === 'ABCDEFGH23' && r.s === 403), J(bad) + r.s); }
    for (const op of ['peek', 'mine', 'paid', 'nope', '', 'list/x']) no(await lc(op, { g: gid, code: 'ABCD-1234', id: 'ABCDEFGH23', pid: 'x', paid: true }, steve.token), 404, 'route not open in a group: ' + op);
    assert.strictEqual((await get('/local/list', H(steve.token))).s, 405);
    t('signed out = 401; on the list but not a member of the group = 403 on every route; a made-up group id = 404; the public peek, "all my events" and Mark paid are 404 in a group; GET = 405');

    // ---- 3. start a game: the commissioner only, pickleball only, money forced off, the activity hook ----
    no(await lc('create', L8({ g: gid }), tess.token), 403, 'a member'); r = no(await lc('create', L8({ g: gid, sport: 'tennis' }), steve.token), 400); assert.strictEqual(r.error, L.GROUP.SOON);
    for (const sp of ['golf', 'cornhole', 'basketball', 'other']) no(await lc('create', L8({ g: gid, sport: sp }), steve.token), 400, sp);
    assert.strictEqual(EVENTS.filter((e) => e.type === 'pickleball_start').length, 0);
    r = await lc('create', L8({ g: gid, title: 'Thursday round robin', entry: 50, split: '100', take: { kind: 'pct', v: 20 }, pot: 'side', entrants: [{ name: 'Gus' }, { name: 'Hal' }] }), steve.token); let ev = okk(r, 'create').event; const rrId = ev.id;
    assert.deepStrictEqual([ev.money.entry, ev.money.split, ev.money.pot, ev.inGroup, ev.entText, ev.role, ev.sport], [0, 'none', 'main', true, L.GROUP.CAP, 'comm', 'pickleball']); assert.ok(!PRICE.test(r.txt), 'no price sentence in a group answer');
    assert.strictEqual(DB['lock:evt:' + rrId].data.group.gid, gid, 'stored under its group');
    await sleep(700); let pe = EVENTS.filter((e) => e.type === 'pickleball_start'); assert.strictEqual(pe.length, 1, 'one pickleball_start for the one game made');
    assert.strictEqual(pe[0].key, rrId, 'key = the game id'); assert.strictEqual(pe[0].title, 'Pickleball started: Thursday round robin'); assert.strictEqual(pe[0].account, await email(steve.token));
    assert.match(pe[0].detail, /^Group: Sunday crew\. Round robin\. singles\. \d{4}-\d{2}-\d{2}$/); assert.ok(!/956|555-?000|112233|4321|\d{7,}|@/.test(pe[0].title + pe[0].detail), 'no phone, PIN or email in the event text');
    r = no(await lc('edit', { g: gid, id: rrId, entry: 25, split: '100', sport: 'tennis' }, steve.token), 400, 'edit to another sport'); r = await lc('edit', { g: gid, id: rrId, entry: 25, split: '100' }, steve.token); if (r.s === 200) assert.strictEqual(r.j.event.money.entry, 0, 'an edit cannot add money');
    t('only the commissioner starts a game; pickleball only (others: "coming soon"); entry / split / take / side pot are forced off; My Apps is told once: pickleball_start, key = game id, group / format / unit / date, no contact data');

    // ---- 4. scoped to the group: list, preview and join by id, another group, claim codes ----
    r = await post('/groups/create', Object.assign(mkGroup('Other crew'), { myName: 'Tess' }), H(tess.token)); const g2 = r.j.group, gid2 = g2.id; assert.strictEqual(r.s, 200, J(r.j));
    r = await post('/groups/join', { code: g2.code, myName: 'Cy' }, H(cy.token)); assert.strictEqual(r.s, 200);
    const other = okk(await lc('create', L8({ g: gid2, title: 'Other game', entrants: [{ name: 'Zed' }] }), tess.token)).event;
    let lst = okk(await lc('list', { g: gid }, bo.token)); assert.deepStrictEqual(lst.events.map((x) => [x.id, x.role]), [[rrId, 'none']], 'a member sees every game of the group, with role none until joining'); assert.ok(lst.events.every((x) => x.inGroup && x.entText === L.GROUP.CAP));
    lst = okk(await lc('list', { g: gid2 }, tess.token)); assert.deepStrictEqual(lst.events.map((x) => x.id), [other.id], 'and only that group\'s');
    no(await lc('list', { g: gid2 }, bo.token), 403, 'not a member of the other group'); no(await lc('get', { g: gid, id: other.id }, steve.token), 404, 'a game of another group, named under this group'); no(await lc('get', { g: gid2, id: rrId }, cy.token), 404);
    no(await lc('preview', { g: gid, id: other.id }, bo.token), 404); no(await lc('join', { g: gid, id: other.id, as: 'player' }, bo.token), 404); no(await lc('join', { g: gid, code: other.code, as: 'player' }, bo.token), 404, 'a code of another group\'s game');
    for (const op of ['score', 'draw', 'delete', 'finish', 'entrant', 'pick']) no(await lc(op, { g: gid, id: other.id, m: 'x' }, steve.token), 404, op);
    r = okk(await lc('preview', { g: gid, id: rrId }, bo.token)); assert.strictEqual(r.event.role, 'none'); assert.ok(!r.event.code || typeof r.event.code === 'string');
    assert.ok(Array.isArray(r.event.entrants) && r.event.entrants.length >= 1 && r.event.entrants.every((x) => typeof x.name === 'string' && x.players.every((p) => Object.keys(p).sort().join() === 'blank,guest,name')), 'a member who is not in the game sees who is entered: names only (no claim codes, ratings or accounts) ' + J(r.event.entrants));
    ev = okk(await lc('join', { g: gid, id: rrId, as: 'player', entryName: 'Bo' }, bo.token)).event; assert.strictEqual(ev.role, 'player'); assert.ok(ev.entrants.some((x) => x.name === 'Bo'));
    ev = okk(await lc('join', { g: gid, id: rrId, as: 'spectator' }, cy.token)).event; assert.strictEqual(ev.role, 'spectator');
    lst = okk(await lc('list', { g: gid }, bo.token)); assert.deepStrictEqual(lst.events.map((x) => x.role), ['player']);
    const st = okk(await lc('get', { g: gid, id: rrId }, steve.token)).event, gus = st.entrants.find((x) => x.name === 'Gus').players[0]; assert.ok(gus.claim, 'the commissioner sees the claim code');
    const oth = okk(await lc('get', { g: gid2, id: other.id }, tess.token)).event, zed = oth.entrants.find((x) => x.name === 'Zed').players[0];
    no(await lc('claim', { g: gid, claim: zed.claim }, bo.token), 404, 'a claim code of another group\'s game'); r = okk(await lc('claim', { g: gid, claim: gus.claim }, tess.token)); assert.ok(r.event.entrants.find((x) => x.name === 'Gus').players[0].me, 'claimed in its own group');
    t('a member lists every game of the group (role none until joining), opens and joins one by its id; games, codes and claim codes of another group are 404; a member of one group cannot reach the other');

    // ---- 5. the cap: the real limits.js, 8 people (organizer, players, spectators, typed-in players); no price sentence ----
    const cap = okk(await lc('create', L8({ g: gid, title: 'Full house', entrants: ['B', 'C', 'D', 'E', 'F', 'G'].map((x) => ({ name: x })) }), steve.token)).event; assert.strictEqual(cap.cap, 8); assert.strictEqual(cap.people, 7);
    okk(await lc('join', { g: gid, id: cap.id, as: 'spectator' }, bo.token)); r = no(await lc('join', { g: gid, id: cap.id, as: 'spectator' }, cy.token), 403, 'the 9th person');
    assert.match(r.error, /8 people max/); assert.ok(!PRICE.test(r.error), 'no price sentence: ' + r.error); assert.ok(r.error.length > 20);
    r = no(await lc('create', L8({ g: gid, entrants: 'ABCDEFGH'.split('').map((x) => ({ name: x })) }), steve.token), 403); assert.ok(!PRICE.test(r.error), r.error);
    okk(await lc('delete', { g: gid, id: cap.id }, steve.token));
    assert.strictEqual(cap.entText, 'Up to 8 people per game, counting the organizer, players, spectators and typed-in players.');
    { const L0 = L._deps.limits; L._deps.limits = () => Object.assign({}, LIM, { maxPeople: async () => 12 }); // S2: an account limits.js allows 12 (owner-granted seats / enterprise)
      const big = okk(await lc('create', L8({ g: gid, title: 'Twelve', entrants: [{ name: 'Tess & Bo' }, { name: '<b>Kim</b>' }] }), steve.token)).event; assert.deepStrictEqual(big.entrants.map((x) => x.name).slice(0, 2), ['Tess & Bo', 'bKim/b'], 'P8: "&" is kept in names, tags are still removed'); assert.strictEqual(big.cap, 12); assert.match(big.entText, /^Up to 12 people per game/, 'the real number, not a fixed 8');
      assert.match(okk(await lc('list', { g: gid }, steve.token)).capText, /^Up to 12 people per game/); L._deps.limits = L0; okk(await lc('delete', { g: gid, id: big.id }, steve.token)); }
    t('limits.js caps a group game at 8 people (the organizer, spectators and typed-in players count); the refusal never carries the price sentence');

    // ---- 6. every format, end to end through the gate ----
    const drive = async (id, tok) => { // the commissioner enters every playable score (final: the other side is a typed-in player), round by round
      for (let k = 0; k < 40; k++) { const e = okk(await lc('get', { g: gid, id }, tok)).event, m = e.matches.find((x) => x.state === 'ready' && x.a && x.b && x.a !== 'BYE' && x.b !== 'BYE' && x.canScore); if (!m) return e;
        const won = (e.entrants.find((x) => x.eid === m.a) || {}).seed < (e.entrants.find((x) => x.eid === m.b) || {}).seed; okk(await lc('score', { g: gid, id, m: m.id, games: [won ? [11, 6] : [6, 11]], v: m.v, op: 'o' + k + Math.random().toString(36).slice(2, 7) }, tok), 'score ' + m.id); }
      throw new Error('too many rounds');
    };
    const guests = (k) => 'Abe Ben Cal Dan Eli Fay Gil'.split(' ').slice(0, k).map((x) => ({ name: x }));
    const played = {};
    L._reset(); // the engine allows 6 new games an hour per account; this test starts more
    // round robin + top-2 playoff
    ev = okk(await lc('create', L8({ g: gid, title: 'RR', playIn: false, playoff: 2, entrants: guests(4) }), steve.token)).event; okk(await lc('draw', { g: gid, id: ev.id }, steve.token)); ev = await drive(ev.id, steve.token);
    if (!ev.fin && ev.canFinish) ev = okk(await lc('finish', { g: gid, id: ev.id }, steve.token)).event; assert.ok(ev.fin, 'round robin finished'); assert.ok(ev.placeRows && ev.placeRows[0].place === 1); assert.ok(ev.tables && ev.tables[0].length === 4); played.rr = ev.placeRows[0].name;
    // single elimination with spectator pick'em
    ev = okk(await lc('create', L8({ g: gid, title: 'SE', fmt: 'se', playIn: false, pickem: true, entrants: guests(4) }), steve.token)).event; const seId = ev.id; okk(await lc('join', { g: gid, id: seId, as: 'spectator' }, tess.token)); okk(await lc('draw', { g: gid, id: seId }, steve.token));
    let sp = okk(await lc('get', { g: gid, id: seId }, tess.token)).event; assert.ok(sp.pickem && sp.pickem.open.length >= 1, 'pick\'em open'); const pm = sp.pickem.open[0]; okk(await lc('pick', { g: gid, id: seId, m: pm, side: 'a' }, tess.token)); no(await lc('pick', { g: gid, id: seId, m: pm, side: 'b' }, tess.token), 409, 'a pick is locked');
    ev = await drive(seId, steve.token); assert.ok(ev.fin, 'bracket finished by its last match'); assert.strictEqual(ev.placeRows[0].place, 1); played.se = ev.placeRows[0].name;
    sp = okk(await lc('get', { g: gid, id: seId }, tess.token)).event; assert.ok(sp.pickem.table.length >= 1 && sp.pickem.table[0].n >= 1, 'pick\'em leaderboard');
    // double elimination (bracket reset rule shown)
    ev = okk(await lc('create', L8({ g: gid, title: 'DE', fmt: 'de', playIn: false, entrants: guests(4) }), steve.token)).event; okk(await lc('draw', { g: gid, id: ev.id }, steve.token)); ev = await drive(ev.id, steve.token); assert.ok(ev.fin, 'double elimination finished'); assert.ok(ev.matches.some((m) => m.st === 'l'), 'losers bracket'); played.de = ev.placeRows[0].name;
    L._reset(); // the engine allows 6 new games an hour per account; this test starts more
    // ladder: challenge up, accept, play, swap; the commissioner finishes
    ev = okk(await lc('create', L8({ g: gid, title: 'Ladder', fmt: 'ladder', endDay: new Date(Date.now() + CLOCK + 10 * 864e5).toISOString().slice(0, 10), playIn: false, seeding: 'manual', entrants: guests(4) }), steve.token)).event; const ldId = ev.id;
    ev = okk(await lc('join', { g: gid, id: ldId, as: 'player', entryName: 'Bo' }, bo.token)).event; assert.strictEqual(ev.started, false);
    { const e0 = ev.entrants; no(await lc('challenge', { g: gid, id: ldId, a: e0.find((x) => x.name === 'Bo').eid, b: e0[0].eid }, bo.token), 409, 'no challenge before the start or the draw'); }
    ev = okk(await lc('draw', { g: gid, id: ldId }, steve.token)).event; assert.strictEqual(ev.started, true, 'P2: an early draw counts as the start');
    const lad = ev.ladder, boE = ev.entrants.find((x) => x.name === 'Bo').eid, boRank = lad.find((x) => x.eid === boE).rank, target = lad.find((x) => x.rank === boRank - 1);
    assert.ok(Date.now() + CLOCK < ev.start, 'still before the start time'); // P2 (review): after an early draw challenges are open at once, as the phone shows
    ev = okk(await lc('challenge', { g: gid, id: ldId, a: boE, b: target.eid }, bo.token)).event; const lm = ev.matches.find((m) => m.st === 'lad' && m.state === 'ready'); assert.ok(lm, 'a ladder challenge is on at once'); assert.ok(lm.exp > Date.now() + CLOCK, 'with a play-by date');
    no(await lc('challenge', { g: gid, id: ldId, a: boE, b: lad.find((x) => x.rank === 1).eid === target.eid ? lad[lad.length - 1].eid : lad.find((x) => x.rank === 1).eid }, bo.token), 409, 'one open challenge at a time, or out of reach');
    const boSide = lm.a === boE ? 'a' : 'b'; ev = okk(await lc('score', { g: gid, id: ldId, m: lm.id, games: [boSide === 'a' ? [11, 4] : [4, 11]], v: lm.v, op: 'lad1' }, steve.token)).event;
    assert.strictEqual(ev.ladder.find((x) => x.eid === boE).rank, boRank - 1, 'the winner takes the higher spot'); ev = okk(await lc('finish', { g: gid, id: ldId }, steve.token)).event; assert.ok(ev.fin); played.ladder = 'ok';
    // heads-up challenges (doubles): after the start, challenge, accept, score, the other side's account confirms
    ev = okk(await lc('create', L8({ g: gid, title: 'H2H', fmt: 'h2h', unit: 'doubles', endDay: new Date(Date.now() + CLOCK + 5 * 864e5).toISOString().slice(0, 10), playIn: true, entrants: [] }), steve.token)).event; const hId = ev.id;
    ev = okk(await lc('join', { g: gid, id: hId, as: 'player', entryName: 'Bo / Cy' }, bo.token)).event; const pairB = ev.entrants.find((x) => x.name === 'Bo / Cy'); okk(await lc('join', { g: gid, id: hId, as: 'player', eid: pairB.eid, gid: pairB.players.find((p) => p.blank).gid }, cy.token));
    ev = okk(await lc('get', { g: gid, id: hId }, steve.token)).event; const mineE = ev.entrants.find((x) => x.eid !== pairB.eid);
    if (mineE.players.some((p) => p.blank)) ev = okk(await lc('entrant', { g: gid, id: hId, do: 'partner', eid: mineE.eid, name: 'Pat' }, steve.token)).event;
    CLOCK += 2 * 3600e3; ev = okk(await lc('challenge', { g: gid, id: hId, a: pairB.eid, b: mineE.eid }, bo.token)).event; let hm = ev.matches.find((m) => m.state === 'offered'); assert.ok(hm, 'a member\'s challenge waits for an answer');
    no(await lc('accept', { g: gid, id: hId, m: hm.id }, cy.token), 403, 'only the challenged side answers'); okk(await lc('accept', { g: gid, id: hId, m: hm.id }, steve.token)); ev = okk(await lc('get', { g: gid, id: hId }, bo.token)).event; hm = ev.matches.find((m) => m.id === hm.id); assert.strictEqual(hm.state, 'ready');
    ev = okk(await lc('score', { g: gid, id: hId, m: hm.id, games: [[11, 9]], v: hm.v, op: 'h1' }, cy.token)).event; hm = ev.matches.find((m) => m.id === hm.id); assert.strictEqual(hm.state, 'pending', 'waits for the other side');
    ev = okk(await lc('confirm', { g: gid, id: hId, m: hm.id, v: hm.v, op: 'c1' }, steve.token)).event; assert.strictEqual(ev.matches.find((m) => m.id === hm.id).state, 'confirmed'); assert.ok(ev.records && ev.records.length === 2);
    ev = okk(await lc('finish', { g: gid, id: hId }, steve.token)).event; assert.ok(ev.fin); played.h2h = 'ok';
    L._reset(); // the engine allows 6 new games an hour per account; this test starts more
    // solo / skills score
    ev = okk(await lc('create', L8({ g: gid, title: 'Serves in', fmt: 'solo', start: Date.now() + CLOCK + 90e3, endDay: new Date(Date.now() + CLOCK + 2 * 864e5).toISOString().slice(0, 10), unitLabel: 'serves', playIn: true, entrants: [{ name: 'Abe' }] }), steve.token)).event; const soId = ev.id;
    okk(await lc('join', { g: gid, id: soId, as: 'player', entryName: 'Bo' }, bo.token)); CLOCK += 3 * 6e4; ev = okk(await lc('get', { g: gid, id: soId }, bo.token)).event;
    okk(await lc('solo', { g: gid, id: soId, eid: ev.entrants.find((x) => x.name === 'Bo').eid, score: 17 }, bo.token)); no(await lc('solo', { g: gid, id: soId, eid: ev.entrants.find((x) => x.name === 'Abe').eid, score: 30 }, bo.token), 403, 'only your own score');
    ev = okk(await lc('solo', { g: gid, id: soId, eid: ev.entrants.find((x) => x.name === 'Abe').eid, score: 12 }, steve.token)).event; assert.deepStrictEqual(ev.solo.map((x) => [x.name, x.place]), [['Bo', 1], ['Abe', 2]]);
    ev = okk(await lc('finish', { g: gid, id: soId }, steve.token)).event; assert.ok(ev.fin); played.solo = 'ok';
    // partner suggestions in a doubles round robin (the shared pairing.js)
    ev = okk(await lc('create', L8({ g: gid, title: 'Doubles', unit: 'doubles', playIn: true, entrants: [{ name: 'Abe / Ben' }] }), steve.token)).event; no(await lc('partners', { g: gid, id: ev.id }, bo.token), 404, 'a member who has not joined uses preview'); r = okk(await lc('partners', { g: gid, id: ev.id, mode: 'balanced' }, steve.token)); assert.strictEqual(r.mode, 'balanced'); assert.ok(Array.isArray(r.suggestions));
    okk(await lc('delete', { g: gid, id: ev.id }, steve.token));
    assert.deepStrictEqual(Object.keys(played).sort(), ['de', 'h2h', 'ladder', 'rr', 'se', 'solo']);
    t('every format through the gate: round robin + playoff (finish), single elimination with spectator pick\'em (locked picks, leaderboard), double elimination (losers bracket), ladder (challenge with a play-by date, one open at a time, the winner moves up), heads-up doubles (the other side confirms), solo skills score; partner suggestions');

    // ---- 7. what another member can read; no money anywhere a member sees ----
    const seen = J([okk(await lc('list', { g: gid }, bo.token)), okk(await lc('get', { g: gid, id: rrId }, bo.token)), okk(await lc('preview', { g: gid, id: seId }, cy.token)), okk(await lc('get', { g: gid, id: hId }, cy.token)), EVENTS.filter((e) => e.type === 'pickleball_start').map((e) => [e.title, e.detail, e.key])]);
    for (const [what, re] of [['a phone number', /956\D?555\D?000\d/], ['an account id', /@phone\.oddable/], ['a PIN', /112233|445566|778899|991122|335577|224466|4321/], ['an email', /[\w.]+@[\w.]+\.[a-z]{2,}/i], ['a member key', /"mk"|"ak"|"ce"|pinhash|salt/], ['a price', PRICE]]) assert.ok(!re.test(seen), 'another member\'s view holds ' + what);
    assert.ok(!/"entry":[1-9]|"total":[1-9]|"pool":[1-9]/.test(seen), 'no money amount');
    assert.ok(!/claim":"/.test(J(okk(await lc('get', { g: gid, id: rrId }, bo.token)))), 'claim codes are for the commissioner only');
    t('a member sees names, scores and the history: no phone number, account id, email, PIN, member key, claim code, price or money amount');

    // ---- 8. switching Groups off blocks pickleball at once; nothing is deleted ----
    delete process.env.GROUPS_ENABLED; r = await lc('get', { g: gid, id: rrId }, steve.token); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true); assert.ok(DB['lock:evt:' + rrId], 'nothing deleted');
    process.env.GROUPS_ENABLED = '1'; delete process.env.GROUPS_OWNER_ONLY; delete process.env.GROUPS_TESTERS; okk(await lc('get', { g: gid, id: rrId }, bo.token), 'Groups open to everyone: a member reads the game');
    t('switching GROUPS_ENABLED off again blocks every pickleball route at once (nothing deleted); with Groups open to everyone a member works without the tester list');
  } catch (e) { failed = 1; console.error('  FAIL after ' + n + ' passed:', e && e.stack || e); }
  srv.close(); console.log(failed ? 'local.group.test: FAILED' : 'local.group.test: all ' + n + ' passed'); setTimeout(() => process.exit(failed), 50);
});
