// Run: node odds-api/golfday.v287.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// v287 (owner answers Nov 18 2026, d + e): `here` (the open Golf days at a course today that the caller plays in), `flags` (the commissioner's colours for the day),
// and the phone's score queue (pics/golfgps.js saveScore / flush) against the REAL server: offline = kept, sent later once, refusal = dropped and listed.
// (Harness copied from golfday.test.js.) Part A = the scoring maths (pure). Part B = every rule through the REAL acct.js, sync.js, groups.js, events.js and golfday.js wired like
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
const par18 = {}, si18 = {}; for (let h = 1; h <= 18; h++) { par18[h] = [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4][h - 1]; si18[h] = [7, 3, 15, 1, 11, 17, 5, 9, 13, 8, 16, 4, 2, 12, 6, 18, 10, 14][h - 1]; }
// pure: cleanFlags
assert.strictEqual(GD.cleanFlags(null), null); assert.strictEqual(GD.cleanFlags(undefined), null);
assert.deepStrictEqual(GD.cleanFlags({ red: 'short', white: 'center', blue: 'long', yellow: 'long', green: 'x' }), { red: 'short', white: 'center', blue: 'long', yellow: 'long' });
for (const bad of [{ red: 'short' }, { red: 'front', white: 'center', blue: 'long', yellow: 'long' }, [], 'red', 5]) assert.throws(() => GD.cleanFlags(bad), (e) => e.status === 400);
t('flags: all four colours, each Short / Center / Long (the words golfcourse.js stores); anything else is 400; null = back to the course\'s colours');
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
    const tOwner = (await post('/acct/owner', { pin: '4321' })).j.token, email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;

    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), stranger = await phoneIn('9565550004', '991122', 'Stranger');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()), plus = (k) => new Date(Date.parse(today + 'T12:00:00Z') + k * 864e5).toISOString().slice(0, 10);
    const setup = (o) => Object.assign({ course: { id: 'way/123', name: 'Palm View Golf Course', lat: 26.16, lon: -98.25 }, date: today, format: 'gross', holes: 'all', par: par18, si: si18, parOk: true }, o || {});
    const mkGroup = (name) => ({ name, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, noContest: true, myName: 'Steve' });
    const MAP = { red: 'short', white: 'center', blue: 'long', yellow: 'long' }, MAP2 = { red: 'long', white: 'short', blue: 'center', yellow: 'short' };

    // ---- dark: here and flags are blocked like every other call, nothing read ----
    delete process.env.GROUPS_ENABLED; let before = dbCalls.n;
    for (const op of ['here', 'flags']) for (const tok of [steve.token, '']) { const r = await post('/golfday/' + op, { course: 'way/123', g: 'ABCDEFGH23', id: 'ABCDEFGH', flags: MAP }, H(tok)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true); }
    assert.strictEqual(dbCalls.n, before); process.env.GROUPS_ENABLED = '1';
    let r = await post('/golfday/here', { course: 'way/123' }, {}); assert.strictEqual(r.s, 401);
    r = await post('/golfday/here', { course: 'nope' }, H(steve.token)); assert.strictEqual(r.s, 400);
    r = await post('/golfday/here', { course: 'way/123' }, H(steve.token)); assert.deepStrictEqual([r.s, r.j.days], [200, []], 'in no group: nothing');
    t('dark: here and flags are 403 {off:true} with nothing read; signed out 401; a bad course 400; in no group = no days');

    // two groups, two open days on the same course today; a third group's day on another course; a fourth's day tomorrow
    const mk = async (tok, name) => { const x = await post('/groups/create', mkGroup(name), H(tok)); assert.strictEqual(x.s, 200, J(x.j)); return x.j.group; };
    const gA = await mk(steve.token, 'Alpha'), gB = await mk(steve.token, 'Bravo'), gC = await mk(steve.token, 'Charlie'), gD = await mk(steve.token, 'Delta');
    for (const gg of [gA, gB, gC, gD]) for (const [p, nm] of [[tess, 'Tess'], [bo, 'Bo']]) { const x = await post('/groups/join', { code: gg.code, myName: nm }, H(p.token)); assert.strictEqual(x.s, 200, J(x.j)); }
    const day = async (gg, o) => { const x = await post('/golfday/create', setup(Object.assign({ g: gg.id }, o)), H(steve.token)); assert.strictEqual(x.s, 200, J(x.j)); return x.j.day.id; };
    const dA = await day(gA, { name: 'Alpha day' }), dB = await day(gB, { name: 'Bravo day' }), dC = await day(gC, { course: { id: 'way/999', name: 'Other' } }), dD = await day(gD, { date: plus(1) });
    for (const [gg, id] of [[gA, dA], [gB, dB], [gC, dC], [gD, dD]]) for (const p of [tess]) { const x = await post('/golfday/join', { g: gg.id, id }, H(p.token)); assert.strictEqual(x.s, 200, J(x.j)); }
    await post('/golfday/join', { g: gA.id, id: dA }, H(bo.token)); // Bo plays only Alpha
    r = await post('/golfday/here', { course: 'way/123' }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j));
    assert.deepStrictEqual(r.j.days.map((x) => [x.group, x.g, x.day.id, x.day.joined, x.day.canScore, x.day.course.id]), [['Alpha', gA.id, dA, true, true, 'way/123'], ['Bravo', gB.id, dB, true, true, 'way/123']], 'today, this course, played in; not the other course, not tomorrow');
    assert.deepStrictEqual(Object.keys(r.j.days[0].day.par).length, 18); assert.strictEqual(r.j.days[0].day.flags, null);
    r = await post('/golfday/here', { course: 'way/123' }, H(bo.token)); assert.deepStrictEqual(r.j.days.map((x) => x.day.id), [dA], 'Bo plays only Alpha');
    r = await post('/golfday/here', { course: 'way/123' }, H(steve.token)); assert.deepStrictEqual(r.j.days, [], 'the commissioner who has not joined: no Log my score');
    r = await post('/golfday/here', { course: 'way/123' }, H(stranger.token)); assert.deepStrictEqual(r.j.days, [], 'not a member of any of them');
    r = await post('/golfday/here', { course: 'way/999' }, H(tess.token)); assert.deepStrictEqual(r.j.days.map((x) => x.day.id), [dC]);
    const seen = J(r.j); assert.ok(!/956\D?555|@phone|112233|445566|"mk"|"sid"/.test(seen), 'no phone number, account id, PIN or key');
    t('here: only the open days at that course, dated today (Chicago), that the caller PLAYS in, across all his groups; a member not playing, a non-member and the commissioner who did not join get none');

    // flags: commissioner only, logged, shown to all, cleared; closed = refused
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: MAP }, H(tess.token)); assert.strictEqual(r.s, 403); assert.match(r.j.error, /commissioner/);
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: MAP }, H(stranger.token)); assert.strictEqual(r.s, 403);
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: { red: 'short' } }, H(steve.token)); assert.strictEqual(r.s, 400);
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: MAP2 }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual(r.j.day.flags.map, MAP2); assert.strictEqual(r.j.day.flags.by, 'Steve');
    let L = r.j.day.log[0]; assert.deepStrictEqual([L.kind, L.by, L.map], ['flags', 'Steve', MAP2]);
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: MAP2 }, H(steve.token)); assert.strictEqual(r.j.day.log.filter((x) => x.kind === 'flags').length, 1, 'the same colours again: no new line');
    r = await post('/golfday/get', { g: gA.id, id: dA }, H(bo.token)); assert.deepStrictEqual(r.j.day.flags.map, MAP2, 'every player sees them');
    r = await post('/golfday/here', { course: 'way/123' }, H(tess.token)); assert.deepStrictEqual(r.j.days[0].day.flags.map, MAP2); assert.strictEqual(r.j.days[1].day.flags, null, 'the other group\'s day is not touched');
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: null }, H(steve.token)); assert.strictEqual(r.j.day.flags, null); L = r.j.day.log[0]; assert.deepStrictEqual([L.kind, L.map], ['flags', null]);
    r = await post('/golfday/flags', { g: gA.id, id: dA, flags: MAP }, H(steve.token)); assert.deepStrictEqual(r.j.day.flags.map, MAP);
    const gcRow = Object.keys(DB).filter((k) => k.startsWith('lock:golfmark:')); assert.deepStrictEqual(gcRow, [], 'the course\'s own colours (golfcourse.js) are not written');
    assert.strictEqual(await GC._deps.organizer({ headers: H(steve.token) }, 'way/123'), false, 'golfcourse.js D.organizer still answers false');
    t('flags: only the commissioner sets the day\'s colours (403 for a player or a stranger); logged once per change; every player sees them; null clears; the course\'s own colours are not touched');

    // ---- the phone's queue (pics/golfgps.js) against this server ----
    const GG = require('../pics/golfgps.js'); let OFF = false, SENT = 0; const scoreCalls = [];
    GG._deps.api = 'http://127.0.0.1:' + PORT + '/golfcourse';
    GG._deps.fetch = async (url, opt) => { if (OFF) throw new TypeError('Failed to fetch'); if (/\/golfday\/score$/.test(url)) { SENT++; scoreCalls.push(JSON.parse(opt.body)); } return real(url, opt); };
    GG._deps.set('odd-tok', tess.token);
    const A = { g: gA.id, id: dA, name: 'Alpha day' };
    let x = await GG.saveScore(A, 1, 5); assert.ok(x.day && !x.queued); assert.strictEqual(x.day.scores[x.day.me][1], 5); assert.strictEqual(GG.qCount(), 0);
    OFF = true; x = await GG.saveScore(A, 2, 6); assert.deepStrictEqual([x.queued, x.why], [true, 'offline']); x = await GG.saveScore(A, 3, 4); x = await GG.saveScore(A, 2, 7);
    assert.strictEqual(GG.qCount(gA.id, dA), 2, 'hole 2 twice = one waiting value (the newest)'); assert.deepStrictEqual(GG.queued(gA.id, dA), { 2: 7, 3: 4 });
    let f = await GG.flush(); assert.deepStrictEqual(f, { sent: 0, gone: 0, left: 2 }, 'still offline: kept');
    OFF = false; const events = []; GG.onQ((ev) => events.push(ev.type)); SENT = 0;
    f = await GG.flush(); assert.deepStrictEqual(f, { sent: 2, gone: 0, left: 0 }); assert.strictEqual(SENT, 2, 'each waiting hole sent once');
    f = await GG.flush(); assert.strictEqual(SENT, 2, 'nothing sent twice');
    r = await post('/golfday/get', { g: gA.id, id: dA }, H(tess.token)); const me = r.j.day.me; assert.deepStrictEqual([r.j.day.scores[me][1], r.j.day.scores[me][2], r.j.day.scores[me][3]], [5, 7, 4], 'the newest value of hole 2 won');
    assert.strictEqual(r.j.day.board.find((b) => b.pid === me).thru, 3, 'three holes, not four: no double counting'); assert.deepStrictEqual(events, ['sent', 'sent']);
    t('queue: with no signal a score is kept on the phone (newest per hole wins); flush while offline keeps it; back online each waiting hole is sent once; the server has the newest value and counts it once');
    // a waiting score sent after the day was closed: refused, dropped, listed; a clear offline
    OFF = true; await GG.saveScore(A, 4, 5); await GG.saveScore(A, 3, null); OFF = false;
    r = await post('/golfday/close', { g: gA.id, id: dA }, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j));
    f = await GG.flush(); assert.deepStrictEqual(f, { sent: 0, gone: 2, left: 0 }, 'refused by the server: dropped, not retried');
    const rf = GG.refused(); assert.strictEqual(rf.length, 2); assert.match(rf[0].error, /closed/); assert.deepStrictEqual(rf.map((y) => [y.hole, y.s]), [[4, 5], [3, null]]);
    r = await post('/golfday/get', { g: gA.id, id: dA }, H(tess.token)); assert.strictEqual(r.j.day.scores[me][4], undefined); assert.strictEqual(r.j.day.scores[me][3], 4, 'a closed day changes for nobody');
    GG.dismissRefused(); assert.deepStrictEqual(GG.refused(), []);
    await assert.rejects(GG.saveScore(A, 5, 4), (e) => /closed/.test(e.message) && !e.keep, 'online and refused: the error is shown, nothing queued'); assert.strictEqual(GG.qCount(), 0);
    t('queue: a waiting score the server refuses (day closed meanwhile) is dropped and listed with the server\'s words; online refusals throw and queue nothing');
    // server asleep (502) = kept; 401 = kept; 403 not in this group = dropped
    const realF = GG._deps.fetch; GG._deps.fetch = async (url, opt) => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
    const B = { g: gB.id, id: dB, name: 'Bravo day' }; x = await GG.saveScore(B, 1, 4); assert.deepStrictEqual([x.queued, x.why], [true, 'server']); GG._deps.fetch = realF;
    GG._deps.set('odd-tok', stranger.token); f = await GG.flush(); assert.deepStrictEqual(f, { sent: 0, gone: 1, left: 0 }, 'a stranger\'s phone: 403 = dropped'); GG.dismissRefused();
    GG._deps.set('odd-tok', tess.token); GG._deps.fetch = async (url, opt) => ({ ok: false, status: 502, json: async () => ({}) }); x = await GG.saveScore(B, 1, 4); GG._deps.fetch = realF;
    GG._deps.set('odd-tok', ''); f = await GG.flush(); assert.strictEqual(f.left, 1, 'signed out: kept'); GG._deps.set('odd-tok', tess.token);
    f = await GG.flush(); assert.deepStrictEqual(f, { sent: 1, gone: 0, left: 0 });
    // dayHere from the phone: the gd link, then the kept copy with no signal
    let h = await GG.dayHere('way/123', gB.id + '.' + dB); assert.deepStrictEqual(h.days.map((y) => y.day.id), [dB], 'the gd link opens that day (Alpha is closed now)');
    h = await GG.dayHere('way/123'); assert.deepStrictEqual(h.days.map((y) => y.day.id), [dB]);
    OFF = true; h = await GG.dayHere('way/123'); assert.deepStrictEqual([h.offline, h.days.map((y) => y.day.id)], [true, [dB]], 'no signal: the copy kept on the phone'); h = await GG.dayHere('way/999'); assert.deepStrictEqual(h.days, [], 'not for another course'); OFF = false;
    const fd = await GG.saveDayFlags({ g: gB.id, id: dB }, { red: 'back', white: 'front', blue: 'center', yellow: 'center' }).catch((e) => e); assert.strictEqual(fd.status, 403, 'a player cannot set the day\'s colours from the phone either');
    GG._deps.set('odd-tok', steve.token); const okf = await GG.saveDayFlags({ g: gB.id, id: dB }, { red: 'back', white: 'front', blue: 'center', yellow: 'center' }); assert.deepStrictEqual(okf.day.flags.map, { red: 'long', white: 'short', blue: 'center', yellow: 'center' });
    const course = { id: 'way/123', holes: [], dayFlags: { map: okf.day.flags.map, comm: false, name: 'Bravo day' } }; const fm = GG.flagMap(course); assert.deepStrictEqual([fm.src, fm.locked, fm.canChange, fm.map.red, fm.map.white], ['day', true, false, 'back', 'front']);
    delete course.dayFlags; assert.strictEqual(GG.flagMap(course).src, 'default', 'outside a Golf day nothing changes');
    t('queue: server asleep (502) or signed out = kept and sent later; a refusal (403) = dropped; dayHere opens the linked day, keeps a copy for no signal (this course, today only); the day\'s colours win in flagMap only while set');
  } catch (e) { failed = 1; console.error('  FAIL after ' + n + ' passed:', e && e.stack || e); }
  srv.close(); console.log(failed ? 'golfday.v287.test: FAILED' : 'golfday.v287.test: all ' + n + ' passed'); setTimeout(() => process.exit(failed), 50);
});
