// Run: node odds-api/groups.fix1.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// REVIEW FIXES before Groups is ever switched on (Nov 16 2026). The REAL acct.js / sync.js / limits.js / groups.js, wired like server.js.
//   F1  a group id sent by the phone is checked (10 characters, A-Z and 2-9) before it goes into a database key. Reproduced by the reviewer:
//       {"id":"<real id>#"} on /groups/request and /groups/cancel reached the database address, where "#" starts the URL fragment, so the
//       `updated=eq.N` guard of the conditional write was cut off (an unguarded write to the group row).
//   F2  POST /groups/invite with a `type` of "__proto__" / "constructor" answers the normal 404, not 500.
//   F3  sync.js puts a row id into the database address with the unsafe characters encoded; ordinary ids give the same address, byte for byte.
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', GROUPS_ENABLED: '1' });
delete process.env.GROUPS_OWNER_ONLY; delete process.env.GROUPS_TESTERS; delete process.env.GATE_OFF; delete process.env.GATE_KEY; delete process.env.OWNER_PHONE;
const J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, seen = { outside: [], db: [] };
global.fetch = async (url, opt) => { // the fake database reads the address the way a real HTTP client sends it: `new URL()` drops everything after "#"
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); if (p === '/api/v1/account') return ok({ email: b.email, role: 'user', plan: 'pro', expires_on: null }); return ok({}); }
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) { seen.outside.push(url); throw new Error('unexpected outside call: ' + url); }
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  seen.db.push({ m, url, id: eq('id'), guarded: q.has('updated') });
  if (m === 'GET') { const id = eq('id'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups');
const srv = http.createServer(async (req, res) => { // the same order and the same calls as server.js
  try {
    if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
    if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
    if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
    res.statusCode = 404; res.end('{"error":"not found"}');
  } catch (e) { res.statusCode = 500; res.end('{"error":"groups error"}'); } // what server.js answers when a handler throws
});
let P, n = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + P + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.8.' + (++n % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: typeof b === 'string' ? b : J(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const START = Date.now() + 5 * 864e5;
const CONTEST = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START, runs: 'w4', types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 4, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 0, split: 'none' };
srv.listen(0, '127.0.0.1', async () => {
  P = srv.address().port; let bad = 0; const t = (name) => console.log('  PASS ' + name);
  try {
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: { bets: [] } }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const ann = await phoneIn('9565550011', '112233', 'Ann'), bob = await phoneIn('9565550012', '445566', 'Bob');
    const H = (tok) => ({ 'x-token': tok });
    let r = await post('/groups/create', { name: 'Fix one', take: { kind: 'none', v: 0 }, join: { requests: true, open: true, auto: false, max: 8, late: 'no' }, contest: CONTEST }, H(ann.token)); assert.strictEqual(r.s, 200, J(r.j));
    const gid = r.j.group.id, key = 'lock:grp:' + gid; assert.match(gid, /^[A-Z2-9]{10}$/); assert.ok(DB[key], 'the group row exists');

    // ---- F1: the reviewer's reproduction ----
    const BADIDS = [gid + '#', gid + '#x', gid + '&updated=eq.1', gid + '&select=id', gid + '?', gid + ' ', gid + '%23', gid.toLowerCase(), gid.slice(0, 9), gid + 'A', '#', '', '../' + gid, gid + '\n', gid + '&id=eq.lock:names'];
    const OPS = [['request', { myName: 'Bob' }], ['cancel', {}], ['leave', {}], ['delete', {}], ['paid', { pid: 'p1', paid: true }], ['decide', { pid: 'p1', ok: true }], ['edit', { name: 'x' }], ['contest/delete', { cid: 'c1' }], ['sidepot', { cid: 'c1', in: true }]];
    const before = J(DB[key]); let tried = 0;
    for (const id of BADIDS) for (const [op, more] of OPS) {
      seen.db.length = 0; r = await post('/groups/' + op, Object.assign({ id }, more), H(bob.token)); tried++;
      assert.ok(r.s >= 400 && r.s < 500, op + ' ' + J(id) + ' is refused with a 4xx, got ' + r.s + ' ' + J(r.j));
      if (op === 'request' || op === 'cancel') assert.strictEqual(r.s, 404, op + ' ' + J(id) + ' -> 404 Group not found, got ' + r.s + ' ' + J(r.j));
      const w = seen.db.filter((x) => x.m === 'PATCH' && (!x.guarded || /[#?\s]|%23/.test(x.url.split('?').slice(1).join('?').replace(/&updated=eq\.\d+$/, '').replace(/^id=eq\./, ''))));
      assert.deepStrictEqual(w, [], op + ' ' + J(id) + ': no conditional write without its `updated` guard, and no odd character in a database address');
      assert.ok(!seen.db.some((x) => /lock:grp:/.test(x.url) && x.url.indexOf('lock:grp:' + gid + '&select') < 0 && x.url.indexOf('lock:grp:' + gid + '&updated=eq.') < 0), op + ' ' + J(id) + ': the group table is never asked for an id that is not a real group id');
      assert.strictEqual(J(DB[key]), before, op + ' ' + J(id) + ': the group row is untouched');
    }
    t('F1 ' + tried + ' calls with a bad group id (' + BADIDS.length + ' ids x ' + OPS.length + ' routes, incl. "<real id>#" on /request and /cancel): all refused, no unguarded write, group row untouched');
    // the real id still works, and its writes carry the guard
    seen.db.length = 0; r = await post('/groups/request', { id: gid, myName: 'Bob' }, H(bob.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(DB[key].data.reqs.length, 1);
    r = await post('/groups/cancel', { id: gid }, H(bob.token)); assert.strictEqual(r.s, 200, J(r.j)); assert.strictEqual(DB[key].data.reqs.length, 0);
    const pw = seen.db.filter((x) => x.m === 'PATCH'); assert.ok(pw.length >= 2); assert.ok(pw.every((x) => x.guarded), 'every conditional write carries updated=eq.N');
    t('F1 the real id still works on /request and /cancel, every write guarded');
    // the stale-write guard itself: a write made with an old `updated` must not land
    const row = await SYNC.dbGet(key); DB[key].updated = Number(DB[key].updated) + 5;
    assert.strictEqual(await SYNC.dbPatchIf(key, row.updated, { id: gid, hacked: 1 }, Date.now()), false, 'a stale conditional write is refused');
    assert.strictEqual(await SYNC.dbPatchIf(key + '#', row.updated, { id: gid, hacked: 1 }, Date.now()), false, 'sync.js: "#" in an id no longer cuts the guard off (F3)'); assert.ok(!DB[key].data.hacked);
    assert.strictEqual(await SYNC.dbGet(key + '#'), null, 'sync.js: an id with "#" is looked up as written, and is not there');
    t('F3 sync.js dbGet / dbPatchIf: "#" in an id cannot drop the `updated` guard or read another row');
    // F3 differential: ordinary ids give the same address as main's code, byte for byte
    const mainGet = (id) => `https://fake.supabase.co/rest/v1/oddable_sync?id=eq.${id}&select=*`, mainPatch = (id, was) => `https://fake.supabase.co/rest/v1/oddable_sync?id=eq.${id}&updated=eq.${Number(was || 0)}`;
    const crypto = require('crypto'), ids = ['lock:names', 'lock:gidx', 'lock:gaccess', 'lock:ent', 'lock:entreq', 'lock:entuse', 'lock:nfl', 'lock:cfb', 'lock:alert:2026', 'lock:props:2026-w11', 'plog:2026-11-16', key, 'lock:gl:' + gid + ':c1', 'lock:gl:' + gid + ':c_9-x.2', 'lock:gcode:ABCD2345', 'lock:gm:' + 'a'.repeat(24), 'lock:gb:' + '0f'.repeat(12), undefined, null, 0, 12345];
    const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', HEX = '0123456789abcdef', ANY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-_.~';
    const rnd = (a, k) => Array.from(crypto.randomBytes(k)).map((x) => a[x % a.length]).join('');
    for (let i = 0; i < 20000; i++) ids.push(i % 4 === 0 ? crypto.createHash('sha256').update('oddable|' + i).digest('hex') : i % 4 === 1 ? 'lock:grp:' + rnd(AL, 10) : i % 4 === 2 ? 'lock:gm:' + rnd(HEX, 24) : rnd(ANY, 1 + (i % 60)));
    let same = 0; const keep = global.fetch, cap = []; global.fetch = async (u) => { cap.push(String(u)); return { ok: true, status: 200, json: async () => [], text: async () => '[]' }; };
    try { for (const id of ids) { cap.length = 0; await SYNC.dbGet(id); await SYNC.dbPatchIf(id, 1794600000000 + same, {}, 1); assert.strictEqual(cap[0], mainGet(id)); assert.strictEqual(cap[1], mainPatch(id, 1794600000000 + same)); same++; } } finally { global.fetch = keep; }
    t('F3 ' + same + ' ordinary ids (account hashes, lock:* rows, group ids, random letters / digits / : - _ . ~): database addresses identical to main, byte for byte');

    // ---- F2: invite type lookup ----
    for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '__defineGetter__', 'prototype']) for (const code of ['ABCD-2345', 'x', '', '__proto__']) {
      r = await post('/groups/invite', { type, code }); assert.strictEqual(r.s, 404, 'invite type ' + type + ' code ' + J(code) + ' -> 404, got ' + r.s + ' ' + J(r.j)); assert.strictEqual(r.j.error, 'This kind of game is coming soon to Oddable.');
    }
    r = await post('/groups/invite', '{"__proto__":{"type":"g"},"type":"constructor","code":"ABCD-2345"}'); assert.strictEqual(r.s, 404, J(r.j));
    r = await post('/groups/invite', { type: 'g', code: 'ZZZZ-9999' }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.');
    r = await post('/groups/invite', { type: 'c', code: 'ABCD2345' }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j, { type: 'c', kind: 'Calcutta', title: '' });
    r = await post('/groups/invite', { type: 'nope', code: 'ABCD2345' }); assert.strictEqual(r.s, 404);
    const gg = DB[key].data; r = await post('/groups/invite', { type: 'g', code: gg.code }); assert.strictEqual(r.s, 200, J(r.j)); assert.deepStrictEqual(r.j, { type: 'g', kind: 'group', title: 'Fix one' });
    t('F2 /groups/invite: type "__proto__" / "constructor" / other Object names answer the normal 404 (was 500); real types answer as before');
    assert.deepStrictEqual(seen.outside, [], 'only Supabase, My Apps and ESPN were ever called');
  } catch (e) { bad++; console.log('  FAIL ' + String((e && e.stack) || e).split('\n').slice(0, 6).join('\n        ')); }
  console.log(bad ? '\nGROUPS REVIEW FIXES: FAILED' : '\nALL GROUPS REVIEW-FIX CHECKS PASSED'); srv.close(); process.exit(bad ? 1 : 0);
});
