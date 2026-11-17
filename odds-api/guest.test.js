// Run: node odds-api/guest.test.js   (no network: My Apps, the database, ESPN and sign-in are in-memory fakes)
// v268 "expired = guest until they pay" on the server: acct.js expired(), the Groups access check (groups.js) and the bet alerts (betwatch.js).
process.env.MYAPPS_URL = 'https://myapps.test'; process.env.MYAPPS_SECRET = 'sek'; process.env.GATE_KEY = 'k'; delete process.env.GATE_OFF;
const assert = require('assert'), http = require('http');
let n = 0; const t = (name) => { n++; console.log('  ok ' + n + ' ' + name); };
const req = (srv, method, path, body, tok) => new Promise((done, fail) => { const r = http.request({ port: srv.address().port, path, method, headers: Object.assign({ 'content-type': 'application/json' }, tok ? { 'x-token': tok } : {}) }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { let j = {}; try { j = JSON.parse(b || '{}'); } catch (e) {} done({ s: res.statusCode, j }); }); }); r.on('error', fail); if (method === 'POST') r.write(JSON.stringify(body || {})); r.end(); });
(async () => {
  const realFetch = global.fetch; const servers = [];
  try {
    // ---------- 1. acct.js expired() ----------
    const A = require('./acct'); let maCalls = 0, acctOf = {}, maDown = false;
    global.fetch = async (url, o) => { maCalls++; if (maDown) throw new Error('down'); const d = JSON.parse(o.body), a = acctOf[d.email]; assert(String(url).endsWith('/api/v1/account'), 'only the account read: ' + url); return a === undefined ? { ok: false, status: 404, json: async () => ({}) } : a === 500 ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, status: 200, json: async () => a }; };
    const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + d * 864e5));
    acctOf = { 'free@x': { email: 'free@x', role: 'user', plan: 'pro', expires_on: null }, 'paid@x': { email: 'paid@x', role: 'user', plan: 'pro', expires_on: day(5) }, 'today@x': { email: 'today@x', role: 'user', plan: 'pro', expires_on: day(0) },
      'ended@x': { email: 'ended@x', role: 'user', plan: 'pro', expires_on: day(-1) }, 'trialover@x': { email: 'trialover@x', role: 'user', plan: 'free', expires_on: null }, 'boss@x': { email: 'boss@x', role: 'owner', plan: 'free', expires_on: day(-9) }, 'err@x': 500 };
    assert.strictEqual(await A.expired('free@x'), false); t('an account with no end date (free for now) is never expired');
    assert.strictEqual(await A.expired('paid@x'), false); assert.strictEqual(await A.expired('today@x'), false); t('an end date today or later is not expired');
    assert.strictEqual(await A.expired('ended@x'), true); assert.strictEqual(await A.expired('trialover@x'), true); t('an end date in the past, or a plan that is no longer pro, is expired');
    assert.strictEqual(await A.expired('boss@x'), false); assert.strictEqual(await A.expired('owner'), false); assert.strictEqual(await A.expired(''), false); assert.strictEqual(await A.expired(null), false); t('owner role, the owner-PIN sign-in and no account are never expired');
    assert.strictEqual(await A.expired('nobody@x'), false); assert.strictEqual(await A.expired('err@x'), false); maDown = true; assert.strictEqual(await A.expired('down@x'), false); maDown = false; t('unknown account, My Apps error, My Apps down = not expired (nobody is locked out on a guess)');
    { const c = maCalls; await A.expired('ended@x'); await A.expired('ended@x'); assert.strictEqual(maCalls, c); t('the answer comes from the 2-minute cache: no new My Apps call'); }
    process.env.GATE_OFF = '1'; { const c = maCalls; assert.strictEqual(await A.expired('ended@x'), false); assert.strictEqual(await A.expired('new@x'), false); assert.strictEqual(maCalls, c); } delete process.env.GATE_OFF; t('gate off: never expired, My Apps not asked');

    // ---------- 2. Groups: an expired account is not let in; dark behaviour unchanged ----------
    const G = require('./groups'), GD = G._deps; let asked = [], EXP = {};
    GD.S = { dbGet: async () => null, dbPut: async () => {}, dbPatchIf: async () => true, dbIds: async () => [] };
    const fakeAcct = (withExpired) => () => Object.assign({ who: (rq) => { const w = String(rq.headers['x-token'] || ''); return w ? w + '@phone.oddable' : null; }, phoneEmail: (id) => id + '@phone.oddable', isOwnerPhone: () => false, ownerOk: () => false, namesGet: async () => ({}), ownerName: () => 'Sir Oddable' },
      withExpired ? { expired: async (e) => { asked.push(e); if (EXP[e] === 'throw') throw new Error('x'); return !!EXP[e]; } } : {});
    GD.acct = fakeAcct(true); GD.ip = () => '1.1.1.1';
    const gs = http.createServer(async (rq, rs) => { if (!(await G.handle(rq, rs))) { rs.statusCode = 404; rs.end('{}'); } }); await new Promise((r) => gs.listen(0, '127.0.0.1', r)); servers.push(gs);
    EXP = { 'gone@phone.oddable': true, 'boom@phone.oddable': 'throw' };
    const OPS = [['GET', '/groups/on'], ['POST', '/groups/on'], ['POST', '/groups/limits'], ['POST', '/groups/bet/status'], ['POST', '/groups/create'], ['POST', '/groups/invite'], ['POST', '/groups/access/request'], ['POST', '/groups/list']];
    // dark (GROUPS_ENABLED unset): the answers of today, for a paid, an expired and a signed-out caller alike, and expired() is never asked
    delete process.env.GROUPS_ENABLED; delete process.env.GROUPS_OWNER_ONLY; delete process.env.GROUPS_TESTERS; asked = [];
    const dark = {}; for (const who of ['ok', 'gone', '']) for (const [m, p] of OPS) dark[who + ' ' + m + ' ' + p] = await req(gs, m, p, {}, who);
    assert.strictEqual(asked.length, 0, 'expired() asked while Groups is off'); 
    for (const [m, p] of OPS) { const a = dark['ok ' + m + ' ' + p], b = dark['gone ' + m + ' ' + p], c = dark[' ' + m + ' ' + p]; assert.deepStrictEqual(b, a, p); assert.deepStrictEqual(c, a, p); }
    assert.deepStrictEqual(dark['ok GET /groups/on'], { s: 200, j: { on: false } }); assert.deepStrictEqual(dark['ok POST /groups/bet/status'], { s: 200, j: { betLock: 0, canBet: false, saved: false } }); assert.deepStrictEqual(dark['ok POST /groups/create'], { s: 403, j: { error: 'Groups is not open for this account yet.', off: true } }); assert.strictEqual(dark['ok POST /groups/invite'].s, 404);
    GD.acct = fakeAcct(false); for (const who of ['ok', 'gone', '']) for (const [m, p] of OPS) assert.deepStrictEqual(await req(gs, m, p, {}, who), dark[who + ' ' + m + ' ' + p], 'dark, acct.js without expired(): ' + p); GD.acct = fakeAcct(true);
    t('Groups OFF (dark): every answer is the same for paid / expired / signed-out and the same as before v268; My Apps is never asked (' + OPS.length * 3 + ' calls x 2)');
    // owner-only test period: a non-tester is refused by the switch first, and is not asked about either
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1'; asked = [];
    assert.deepStrictEqual(await req(gs, 'GET', '/groups/on', null, 'gone'), { s: 200, j: { on: false } }); assert.deepStrictEqual(await req(gs, 'POST', '/groups/create', {}, 'gone'), { s: 403, j: { error: 'Groups is not open for this account yet.', off: true } }); assert.strictEqual(asked.length, 0); delete process.env.GROUPS_OWNER_ONLY; t('owner-only period: the switch answers first (unchanged), expired() not asked');
    // Groups ON
    asked = []; let r = await req(gs, 'GET', '/groups/on', null, 'ok'); assert.deepStrictEqual(r, { s: 200, j: { on: true } }); r = await req(gs, 'GET', '/groups/on', null, 'gone'); assert.deepStrictEqual(r, { s: 200, j: { on: false } }); t('Groups ON: /groups/on says true for a paid account, false for an expired one');
    for (const p of ['/groups/create', '/groups/list', '/groups/limits', '/groups/bet/add', '/groups/join', '/groups/get', '/groups/access/request', '/groups/anything']) { r = await req(gs, 'POST', p, { id: 'x' }, 'gone'); assert.deepStrictEqual(r, { s: 403, j: { error: 'Your time has ended. Pay to use Groups again.', expired: true } }, p); } t('Groups ON: every group call from an expired account is refused with the pay message (create, list, join, add a bet, ...)');
    r = await req(gs, 'POST', '/groups/bet/status', {}, 'gone'); assert.deepStrictEqual(r, { s: 200, j: { betLock: 0, canBet: false, saved: false } }); t('Groups ON: bet/status for an expired account keeps the safe "not in a group" answer (a status call never blocks a bet)');
    r = await req(gs, 'POST', '/groups/limits', {}, 'ok'); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert(r.j.max > 0); r = await req(gs, 'POST', '/groups/limits', {}, 'boom'); assert.strictEqual(r.s, 200); t('Groups ON: a paid account is let in as before; if the check itself fails the account is let in (not expired on a guess)');
    r = await req(gs, 'POST', '/groups/invite', { type: 'nope', code: 'ABCD' }, ''); assert.notStrictEqual(r.j.expired, true); assert(asked.indexOf(null) < 0 && asked.indexOf('') < 0); t('Groups ON: a signed-out invite preview is not asked about and not affected');
    GD.acct = fakeAcct(false); r = await req(gs, 'POST', '/groups/limits', {}, 'gone'); assert.strictEqual(r.s, 200); GD.acct = fakeAcct(true); t('an acct.js without expired() lets everybody in (older test fakes keep working)');
    delete process.env.GROUPS_ENABLED;

    // ---------- 3. bet alerts: nothing is sent to an expired account, nothing of his is changed, and they come back when he pays ----------
    const W = require('./betwatch'), LG = require('./grade').LG, D = W._deps; let NOW = Date.parse('2026-11-16T19:00:00Z'), rows = {}, espn = {}, sent = [], wexp = {}, wasked = 0;
    const env = { BETPUSH_ENABLED: '1', SUPABASE_URL: 'https://db.test', SUPABASE_KEY: 'k' };
    D.now = () => NOW; D.env = (k) => env[k]; D.log = () => {}; D.LG = () => LG; D.timer = () => 1;
    D.fetch = async (url) => { const m = /sports\/(.+)\/scoreboard\?dates=(\d{8})/.exec(String(url)); assert(m, 'unexpected call ' + url); return { ok: true, json: async () => ({ events: JSON.parse(JSON.stringify(espn[m[1] + '|' + m[2]] || [])) }) }; };
    D.S = () => ({ dbGet: async (id) => (rows[id] ? JSON.parse(JSON.stringify(rows[id])) : null), dbPut: async (row, ign) => { if (ign && rows[row.id]) return; rows[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!rows[id] || rows[id].updated !== was) return false; rows[id].data = JSON.parse(JSON.stringify(data)); rows[id].updated = upd; return true; }, dbIds: async () => Object.keys(rows).filter((k) => !k.startsWith('lock:')) });
    D.A = () => ({ who: (rq) => rq.headers['x-token'] || null, maReady: () => true, phoneEmail: (id) => 'h' + id + '@phone.oddable', expired: async (e) => { wasked++; return !!wexp[e]; },
      ma: async (path, data) => { if (path === '/api/v1/push/subscribe') return { ok: true, status: 200, j: { ok: true } }; assert.strictEqual(path, '/api/v1/push/send'); sent.push(data); return { ok: true, status: 200, j: { ok: true, sent: 1 } }; } });
    const ev = (a, h, st) => ({ id: '401', date: new Date(NOW - 36e5).toISOString(), status: { period: 1, type: { state: st || 'in', shortDetail: 'Q1' } }, competitions: [{ competitors: [{ homeAway: 'home', score: String(h), team: { abbreviation: 'BAL' } }, { homeAway: 'away', score: String(a), team: { abbreviation: 'LAC' } }] }] });
    const NFL = 'football/nfl|20261116', acct = (rid) => 'h' + rid + '@phone.oddable';
    const player = (rid) => { rows[rid] = { id: rid, salt: 's', pinhash: 'p', data: { bets: [{ id: 'b' + rid, gid: '401', side: 'LAC', type: 'sp', line: 4.5, stake: 50 }] }, updated: 5 }; const p = rows['lock:betpush'] || (rows['lock:betpush'] = { id: 'lock:betpush', salt: 'x', pinhash: 'x', data: { p: {} }, updated: 1 }); p.data.p[acct(rid)] = { on: 1, mode: 'bets', bb: 'q', fin: 1, rid, dev: 1, t: 1 }; };
    W._reset(); player('aaa'); player('bbb'); wexp[acct('bbb')] = true;
    const step = async () => { NOW += 30e3; return W.tick(); };
    espn[NFL] = [ev(0, 0)]; await step(); assert.strictEqual(sent.length, 0); // first look is silent
    espn[NFL] = [ev(7, 0)]; await step(); assert.deepStrictEqual(sent.map((x) => x.account), [acct('aaa')]); t('a score: the paid bettor gets the alert, the expired bettor gets none');
    const keep = JSON.stringify([rows['bbb'], rows['lock:betpush'].data.p[acct('bbb')]]); espn[NFL] = [ev(7, 3)]; await step(); espn[NFL] = [ev(14, 3)]; await step();
    assert.deepStrictEqual(sent.map((x) => x.account), [acct('aaa'), acct('aaa'), acct('aaa')]); assert.strictEqual(JSON.stringify([rows['bbb'], rows['lock:betpush'].data.p[acct('bbb')]]), keep); assert(!(W._m().st.n[acct('bbb')] > 0)); t('while expired: still nothing sent, his bets row and his alert setting are untouched, nothing counted against his daily cap');
    wexp[acct('bbb')] = false; espn[NFL] = [ev(14, 10)]; await step(); assert.deepStrictEqual(sent.slice(3).map((x) => x.account).sort(), [acct('aaa'), acct('bbb')]); t('after he pays the very next score reaches him again (nothing to turn back on)');
    const ws = http.createServer(async (rq, rs) => { if (!(await W.handle(rq, rs))) { rs.statusCode = 404; rs.end('{}'); } }); await new Promise((r2) => ws.listen(0, '127.0.0.1', r2)); servers.push(ws);
    wexp[acct('bbb')] = true; r = await req(ws, 'POST', '/betpush/set', { on: true, mode: 'bets' }, acct('bbb')); assert.deepStrictEqual(r, { s: 403, j: { ok: false, expired: true, error: 'Your time has ended. Pay to get alerts for your bets again.' } });
    r = await req(ws, 'POST', '/betpush/test', {}, acct('bbb')); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.expired, true); r = await req(ws, 'GET', '/betpush/status', null, acct('bbb')); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.on, true);
    r = await req(ws, 'POST', '/betpush/set', { on: false }, acct('bbb')); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.on, false); r = await req(ws, 'POST', '/betpush/set', { on: true, mode: 'bets' }, acct('aaa')); assert.strictEqual(r.s, 200); t('routes: an expired account cannot turn alerts on or send a test, can still read its setting and turn alerts off; a paid account is unchanged');
    env.BETPUSH_ENABLED = ''; const c0 = wasked; NOW += 30e3; await W.tick(); r = await req(ws, 'POST', '/betpush/set', { on: true }, acct('bbb')); assert.strictEqual(wasked, c0); t('alerts switched off at the server (BETPUSH_ENABLED unset): expired() is never asked');
    console.log('guest.test.js: ' + n + ' tests passed');
  } catch (e) { console.error('FAILED after ' + n + ' tests:', e); process.exitCode = 1; }
  finally { global.fetch = realFetch; servers.forEach((s) => s.close()); setTimeout(() => process.exit(process.exitCode || 0), 50); }
})();
