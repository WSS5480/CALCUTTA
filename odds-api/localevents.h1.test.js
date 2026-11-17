// Run: node odds-api/localevents.h1.test.js   (review H1, no network: Supabase and My Apps are in-memory fakes behind global fetch, header copied from localevents.main.test.js)
// A brand-new person opens an EVENT link for an event that belongs to a group: the preview says so and gives only what is needed to ASK to join the group
// (its name and this person's state), never its members or its invite codes. The ask is Groups' own request: the commissioner still approves, the event
// stays closed until then, and once the person is in the group the same event link opens the normal join screen.
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
srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    Object.assign(process.env, { GROUPS_ENABLED: '1', LOCALEVENTS_ENABLED: '1' });
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const ppl = {}; for (const [i, nm] of ['Steve', 'Tess', 'Newbie', 'Nope', 'Other'].entries()) ppl[nm] = await phoneIn('95655510' + String(i + 1).padStart(2, '0'), '2211' + String(33 + i), nm);
    const ev0 = () => ({ title: 'Saturday Smash', sport: 'pickleball', fmt: 'rr', unit: 'singles', to: 11, winBy: 2, bestOf: 1, start: Date.now() + 864e5, playIn: true, myName: 'Steve', entrants: [], self: true, spectators: true, seeding: 'random', courts: 2, pools: 1, playoff: 0, scorer: 'a', entry: 0, pot: 'main', split: 'none', take: { kind: 'none', v: 0 } });
    const grp = async (name, requests) => { const r = await post('/groups/create', { name, join: { requests, open: false, auto: false, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: Date.now() + 5 * 864e5, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName: 'Steve' }, H(ppl.Steve.token)); assert.strictEqual(r.s, 200, J(r.j)); return r.j.group; };
    const g = await grp('Dink crew', true), gid = g.id, gcode = g.code, mcode = DB['lock:grp:' + gid].data.mcode;
    // Tess asks with the group code and is approved, so the group has a member besides the commissioner (her name must never reach the stranger)
    let r = await post('/groups/join', { code: gcode, myName: 'Tess' }, H(ppl.Tess.token)); assert.strictEqual(r.j.pending, true, J(r.j));
    const decide = async (nm, ok) => { const q = DB['lock:grp:' + gid].data.reqs.find((x) => x.name === nm); assert.ok(q, nm + ' asked'); const x = await post('/groups/decide', { id: gid, pid: q.pid, ok }, H(ppl.Steve.token)); assert.strictEqual(x.s, 200, J(x.j)); };
    await decide('Tess', true);
    r = await post('/levents/create', Object.assign(ev0(), { groupId: gid }), H(ppl.Steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const ev = r.j.event;
    t('setup: a group that takes requests (approval on), a member, an event in the group');

    r = await post('/levents/preview', { code: ev.code }, H(ppl.Newbie.token)); assert.strictEqual(r.s, 200, J(r.j));
    assert.strictEqual(r.j.event.groupOnly, true); assert.deepStrictEqual(r.j.event.groupAsk, { name: 'Dink crew', state: 'ask' }); assert.strictEqual(r.j.event.group.id, gid);
    const txt = J(r.j); assert.ok(!txt.includes('Tess'), 'no member names'); assert.ok(!txt.includes(gcode) && !(mcode && txt.includes(mcode)), 'no group invite codes'); assert.ok(!/"members"|"reqs"|"mk"|@phone/.test(txt), 'no member lists or account ids');
    t('preview for a non-member: groupOnly + groupAsk {name, state:"ask"} and the group id; no members, no group codes, no account ids');

    r = await post('/levents/join', { code: ev.code, as: 'player', myName: 'Newbie' }, H(ppl.Newbie.token)); assert.deepStrictEqual([r.s, r.j.code], [403, 'group'], 'not in the group yet: refused');
    r = await post('/groups/request', { id: gid, myName: 'Newbie' }, H(ppl.Newbie.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.pending, true);
    r = await post('/levents/preview', { code: ev.code }, H(ppl.Newbie.token)); assert.deepStrictEqual(r.j.event.groupAsk, { name: 'Dink crew', state: 'pending' });
    r = await post('/levents/join', { code: ev.code, as: 'player', myName: 'Newbie' }, H(ppl.Newbie.token)); assert.deepStrictEqual([r.s, r.j.code], [403, 'group'], 'a request is not a seat: approval still applies');
    assert.ok(!DB['lock:grp:' + gid].data.members.some((m) => m.name === 'Newbie'), 'the request did not add him');
    t('"Ask to join" = Groups\' own /groups/request: pending; the event stays closed until the commissioner approves');

    await decide('Newbie', true);
    r = await post('/levents/preview', { code: ev.code }, H(ppl.Newbie.token)); assert.strictEqual(r.s, 200); assert.ok(!r.j.event.groupOnly && !('groupAsk' in r.j.event), J(r.j.event).slice(0, 200)); assert.strictEqual(r.j.event.role, 'none');
    r = await post('/levents/join', { code: ev.code, as: 'player', myName: 'Newbie' }, H(ppl.Newbie.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(r.j.event.role, 'player');
    t('approved: the same event link now gives the normal join screen, and he joins');

    r = await post('/groups/request', { id: gid, myName: 'Nope' }, H(ppl.Nope.token)); assert.strictEqual(r.s, 200); await decide('Nope', false);
    r = await post('/levents/preview', { code: ev.code }, H(ppl.Nope.token)); assert.deepStrictEqual(r.j.event.groupAsk, { name: 'Dink crew', state: 'no' });
    r = await post('/groups/request', { id: gid, myName: 'Nope' }, H(ppl.Nope.token)); assert.strictEqual(r.s, 409, 'said no stays no');
    const g2 = await grp('Closed crew', false); r = await post('/levents/create', Object.assign(ev0(), { groupId: g2.id, title: 'Closed night' }), H(ppl.Steve.token)); assert.strictEqual(r.s, 200, J(r.j));
    r = await post('/levents/preview', { code: r.j.event.code }, H(ppl.Other.token)); assert.deepStrictEqual(r.j.event.groupAsk, { name: 'Closed crew', state: 'closed' });
    r = await post('/groups/request', { id: g2.id, myName: 'Other' }, H(ppl.Other.token)); assert.strictEqual(r.s, 409, 'a closed group takes no requests');
    t('a "no" from the commissioner shows state "no"; a group not taking requests shows "closed" and Groups refuses the ask');

    // the phone: the box comes first in the preview, with the ask button; the wait is wiped with the person's data
    const fs = require('fs'), path = require('path'), pj = fs.readFileSync(path.join(__dirname, '..', 'pics', 'localevents.js'), 'utf8'), gt = fs.readFileSync(path.join(__dirname, '..', 'pics', 'gate.js'), 'utf8');
    assert.ok(/if \(e\.groupOnly\) return groupAskV\(e\) \+ '<h1>'/.test(pj), 'the group box is drawn before the title');
    assert.ok(/data-a="gask">Ask to join ' \+ nm/.test(pj) && /fetch\(GAPI \+ 'request'/.test(pj) && !/OddGroups\.join\(/.test(pj), 'the ask uses /groups/request (never a group code)');
    assert.ok(/localStorage\.removeItem\('oevt-gwait'\)/.test(gt), 'the waiting event goes with the person\'s data');
    t('phone: "This event belongs to a group" + "Ask to join <group>" come first; the ask is /groups/request; the wait is wiped on sign-out / person switch');
  } catch (e) { failed++; console.error('FAIL', e && e.stack || e); }
  console.log(failed ? '\nFAILED' : '\nPASS ' + n + ' H1 checks'); srv.close(); process.exit(failed ? 1 : 0);
});
