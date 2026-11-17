// Run: node odds-api/sync.phase1.test.js   (no network, no database: Supabase is an in-memory fake behind global fetch)
// GROUPS PHASE 1 (Nov 16 2026): the shared bet-sync path, which EVERY user's bets pass through. Proves, with the real files:
//   S1  GROUPS_ENABLED unset: the new odds-api/sync.js stores exactly what main's sync.js stores (sync.main.fixture.js = main at f740005), field for field,
//       for the same adds, edits, deletes and results from two phones running main's CURRENT phone code (pics/sync.js of this tree, unchanged by Phase 1).
//   S2  GROUPS_ENABLED=1: the same, the only difference being the arrival stamp `sa` on each bet.
//   S3  the phones lose nothing, duplicate nothing, and a deleted bet never comes back (even from a phone that was offline when it was deleted).
//   S4  ROLLBACK: data written by the new server (stamps, even a locked group bet) is read and synced correctly by main's sync.js; and forward again.
//   S5  merge(): random rows, off = main byte for byte; on = main apart from `sa` when no group bet is involved.
//   S6  the lock (on): a stored group bet cannot be edited or deleted by a phone, a phone cannot make a group bet, a stamp never moves.
//   S7  the kill switch taken away again (off after on): the merge is main's again, stored stamps and locks are plain fields.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path'), { EventEmitter } = require('events');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'k'; delete process.env.GROUPS_ENABLED; delete process.env.GROUPS_OWNER_ONLY;
const J = (x) => JSON.stringify(x), C = (x) => JSON.parse(J(x));
// ---- fake PostgREST (table oddable_sync) ----
const DB = {};
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => C(j), text: async () => J(j) });
  if (m === 'GET') { const id = eq('id'); return ok(id ? (DB[id] ? [DB[id]] : []) : Object.values(DB)); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const NEW = require('./sync.js'), MAIN = require('./sync.main.fixture.js');
let SERVER = NEW, IP = '5.5.5.5';
const serve = (urlPath, bodyObj) => new Promise((done) => {
  const req = new EventEmitter(); req.url = urlPath; req.method = 'POST'; req.headers = { 'x-forwarded-for': IP }; req.socket = { remoteAddress: IP };
  const out = { statusCode: 200, h: {}, setHeader(k, v) { this.h[k] = v; }, end(s) { done({ status: this.statusCode, body: s }); } };
  Promise.resolve(SERVER.handle(req, out)).catch((e) => done({ status: 500, body: J({ error: String(e) }) }));
  setImmediate(() => { req.emit('data', Buffer.from(J(bodyObj))); req.emit('end'); });
});
// ---- a phone: main's real pics/sync.js in a sandbox with its own localStorage; timers are run by hand ----
const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'pics', 'sync.js'), 'utf8');
function phone(label) {
  const store = {}, T = [], listeners = {}, P = { label, reloads: 0, pushes: 0, interval: null, store }; let inflight = 0;
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, key: (i) => Object.keys(store)[i], get length() { return Object.keys(store).length; } };
  const sb = { localStorage: ls, console, JSON, Date, Math, Object, Array, String, Number, Set, Map, Promise, Error, RegExp, parseInt, isNaN,
    document: { hidden: false, activeElement: null, getElementById: () => null, querySelector: () => null, addEventListener: (n, f) => { listeners[n] = f; }, createElement: () => ({ style: {}, appendChild() {}, set innerHTML(v) {}, insertAdjacentHTML() {} }), head: { appendChild() {} }, body: { appendChild() {} } },
    location: { reload: () => { P.reloads++; } },
    setTimeout: (fn, ms) => { T.push({ fn, ms: ms || 0 }); return T.length; }, setInterval: (fn) => { P.interval = fn; return 1; },
    fetch: async (url, opt) => { inflight++; P.pushes++; try { const r = await serve(new URL(url).pathname, JSON.parse(opt.body)); return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => JSON.parse(r.body) }; } finally { inflight--; } } };
  sb.window = sb; vm.createContext(sb);
  P.settle = async () => { for (let i = 0; i < 400; i++) { await new Promise((r) => setTimeout(r, 2)); const run = T.filter((t) => t.ms <= 1000); if (run.length) { T.length = 0; run.forEach((t) => { try { t.fn(); } catch (e) {} }); continue; } if (!inflight) { await new Promise((r) => setTimeout(r, 12)); if (!inflight && !T.some((t) => t.ms <= 1000)) return; } } throw new Error(label + ' never settled'); };
  P.boot = () => { vm.runInContext(CLIENT, sb); T.forEach((t) => { if (t.ms === 2500) t.ms = 0; }); }; // the first sync, 2.5 s after the page opens
  P.foreground = async () => { if (listeners.visibilitychange) listeners.visibilitychange(); await P.settle(); }; // the tab is shown again: pull + apply
  P.tick10s = async () => { if (P.interval) P.interval(); await P.settle(); }; // the 10-second loop: push when something changed
  P.bets = () => JSON.parse(store.bets26 || '[]'); P.setBets = (b) => { store.bets26 = J(b); }; P.ids = () => P.bets().map((b) => String(b.id)).sort();
  P.signIn = (ph, pin) => { store['sync-phone'] = ph; store['sync-pin'] = pin; };
  return P;
}
const mkBet = (id, o) => Object.assign({ id, t: Number(id), type: 'ml', side: 'KC', odds: 130, stake: 10, lg: 'nfl', gid: '502', day: '2026-11-22', home: 'BUF', away: 'KC' }, o || {});
const noSa = (data) => { const d = C(data); d.bets = (d.bets || []).map((b) => { delete b.sa; return b; }); return d; };
const rowOf = () => DB[Object.keys(DB).find((k) => !k.startsWith('lock:'))];
// The same steps for every server: adds, an edit, a delete, a result, two phones changing things at once, a phone that was offline during the delete, idle rounds.
async function scenario(server, ip, keep) {
  SERVER = server; IP = ip; if (!keep) Object.keys(DB).forEach((k) => delete DB[k]);
  const PHN = '9565550101', PIN = '246810'; const su = await serve('/sync/signup', { phone: PHN, pin: PIN, data: { bets: [], pins: ['x1'], log: { '2026-11-01': { n: 1, w: 1 } } } }); assert.strictEqual(su.status, 200, su.body);
  const A = phone('phone A'), B = phone('phone B'), Cc = phone('phone C (offline for a while)'); [A, B, Cc].forEach((p) => p.signIn(PHN, PIN)); A.boot(); B.boot(); Cc.boot(); await A.settle(); await B.settle(); await Cc.settle();
  const out = {};
  A.setBets([mkBet('1001'), mkBet('1002', { side: 'BUF', odds: -150 })]); await A.tick10s(); await B.foreground(); await Cc.foreground(); out.add = [A.ids(), B.ids(), Cc.ids()]; // C has 1001 and 1002, then goes offline
  B.setBets(B.bets().map((b) => (String(b.id) === '1001' ? Object.assign({}, b, { stake: 25, t: 2001 }) : b)).concat(mkBet('1003'))); await B.tick10s(); await A.foreground(); out.edit = [A.bets().find((b) => String(b.id) === '1001').stake, A.ids()];
  A.setBets(A.bets().filter((b) => String(b.id) !== '1002')); await A.tick10s(); await B.foreground(); await A.foreground(); out.del = [A.ids(), B.ids()];
  A.setBets(A.bets().map((b) => (String(b.id) === '1003' ? Object.assign({}, b, { res: 'won', fin: 'won', finPL: 13 }) : b))); await A.tick10s(); await B.foreground(); out.result = C(B.bets().find((b) => String(b.id) === '1003'));
  A.setBets(A.bets().concat(mkBet('1004'))); B.setBets(B.bets().concat(mkBet('1005', { kind: 'parlay', legs: [{ side: 'KC', gid: '502' }, { side: 'MIA', gid: '509' }], mult: 6 }))); await Promise.all([A.tick10s(), B.tick10s()]); await A.foreground(); await B.foreground(); out.both = [A.ids(), B.ids()]; // both phones add at the same time
  Cc.setBets(Cc.bets().concat(mkBet('1006'))); await Cc.tick10s(); await Cc.foreground(); await A.foreground(); await B.foreground(); out.offline = [A.ids(), B.ids(), Cc.ids()]; // C still held the deleted 1002 when it came back
  const p0 = A.pushes + B.pushes + Cc.pushes; for (let i = 0; i < 4; i++) { await A.tick10s(); await B.tick10s(); await Cc.tick10s(); } out.idle = A.pushes + B.pushes + Cc.pushes - p0;
  out.reloads = [A.reloads, B.reloads, Cc.reloads]; out.row = C(rowOf().data); out.phones = { A, B, Cc }; return out;
}
const WANT = ['1001', '1003', '1004', '1005', '1006'];
const tests = []; const test = (n, f) => tests.push([n, f]);

test('S1 GROUPS_ENABLED unset: the new sync.js stores exactly what main\'s stores (every field, no stamp), with main\'s phone code on three phones', async () => {
  delete process.env.GROUPS_ENABLED;
  const m = await scenario(MAIN, '5.5.1.1'), n = await scenario(NEW, '5.5.1.2');
  assert.deepStrictEqual(n.row, m.row, 'the stored row is the same, field for field'); assert.ok(n.row.bets.every((b) => !('sa' in b) && !('gl' in b)), 'no stamp, no lock field while Groups is off');
  ['add', 'edit', 'del', 'result', 'both', 'offline', 'idle', 'reloads'].forEach((k) => assert.deepStrictEqual(n[k], m[k], 'the phones saw the same thing at step "' + k + '"'));
  assert.deepStrictEqual(n.row.bets.map((b) => String(b.id)).sort(), WANT); assert.deepStrictEqual(n.row.pins, ['x1']); assert.deepStrictEqual(n.row.log, { '2026-11-01': { n: 1, w: 1 } });
});
test('S2 GROUPS_ENABLED=1: the same steps store the same row as main; the ONLY difference is the arrival stamp `sa` on each bet', async () => {
  delete process.env.GROUPS_ENABLED; const m = await scenario(MAIN, '5.5.2.1'); process.env.GROUPS_ENABLED = '1'; const n = await scenario(NEW, '5.5.2.2'); delete process.env.GROUPS_ENABLED;
  assert.ok(n.row.bets.every((b) => Number(b.sa) > 0), 'every bet has a server stamp'); assert.deepStrictEqual(noSa(n.row), m.row, 'apart from `sa` the stored row is main\'s, field for field');
  ['add', 'edit', 'del', 'both', 'offline', 'idle', 'reloads'].forEach((k) => assert.deepStrictEqual(n[k], m[k], 'the phones saw the same thing at step "' + k + '"'));
  const r = Object.assign({}, n.result); delete r.sa; assert.deepStrictEqual(r, m.result);
});
test('S3 main\'s phone code against the new server (off and on): nothing lost, nothing doubled, a deleted bet never comes back, no push or reload loop when idle', async () => {
  for (const on of [false, true]) {
    if (on) process.env.GROUPS_ENABLED = '1'; else delete process.env.GROUPS_ENABLED;
    const n = await scenario(NEW, on ? '5.5.3.2' : '5.5.3.1'), tag = on ? ' (on)' : ' (off)';
    assert.deepStrictEqual(n.add, [['1001', '1002'], ['1001', '1002'], ['1001', '1002']], 'adds reach every phone' + tag);
    assert.deepStrictEqual(n.edit, [25, ['1001', '1002', '1003']], 'an edit and an add from the other phone arrive' + tag);
    assert.deepStrictEqual(n.del, [['1001', '1003'], ['1001', '1003']], 'a delete reaches the other phone' + tag);
    assert.strictEqual(n.result.res, 'won'); assert.strictEqual(n.result.finPL, 13);
    assert.deepStrictEqual(n.both, [['1001', '1003', '1004', '1005'], ['1001', '1003', '1004', '1005']], 'two phones adding at once: both bets kept' + tag);
    assert.deepStrictEqual(n.offline, [WANT, WANT, WANT], 'the phone that was offline gets everything and its copy of the deleted bet 1002 does NOT come back' + tag);
    const ids = n.row.bets.map((b) => String(b.id)); assert.deepStrictEqual(ids.slice().sort(), WANT, 'stored' + tag); assert.strictEqual(new Set(ids).size, ids.length, 'no bet stored twice' + tag); assert.ok(n.row.tomb.map(String).includes('1002'), 'the delete is remembered');
    assert.strictEqual(n.idle, 0, 'no pushes while nothing changes' + tag); assert.ok(n.reloads.every((x) => x <= 1), 'no reload loop' + tag + ' ' + J(n.reloads));
    Object.values(n.phones).forEach((p) => { const pb = p.bets(); assert.strictEqual(new Set(pb.map((b) => String(b.id))).size, pb.length, p.label + ' holds no bet twice' + tag); assert.strictEqual(pb.find((b) => String(b.id) === '1001').stake, 25, p.label + ' has the edit' + tag); });
  }
  delete process.env.GROUPS_ENABLED;
});
test('S4 ROLLBACK: a row written by the new server with Groups on (stamps, and a locked group bet) is read and synced correctly by main\'s sync.js; and forward again', async () => {
  process.env.GROUPS_ENABLED = '1'; const n = await scenario(NEW, '5.5.4.1'); const { A, B } = n.phones;
  const row = rowOf(), T0 = Date.now(); row.data.bets.push(Object.assign(mkBet('1007', { stake: 40 }), { t: T0, sa: T0, gl: T0 })); row.updated = Number(row.updated) + 1; // what /groups/bet/add writes into My Bets (groups.js mirror)
  await A.foreground(); await B.foreground(); assert.ok(A.ids().includes('1007') && B.ids().includes('1007'), 'the locked bet reached the phones');
  A.setBets(A.bets().filter((b) => String(b.id) !== '1007')); await A.tick10s(); await A.foreground(); assert.ok(A.ids().includes('1007'), 'new server, Groups on: a phone cannot delete a locked group bet (it comes back)');
  // ---- roll back to main's sync.js on the same data ----
  delete process.env.GROUPS_ENABLED; SERVER = MAIN; IP = '5.5.4.2';
  let pl = JSON.parse((await serve('/sync/pull', { phone: '9565550101', pin: '246810' })).body); assert.strictEqual(pl.ok, true); assert.deepStrictEqual(pl.data.bets.map((b) => String(b.id)).sort(), WANT.concat('1007'), 'main reads every bet the new server stored');
  B.setBets(B.bets().concat(mkBet('1008'))); await B.tick10s(); await A.foreground(); assert.ok(A.ids().includes('1008'), 'after the rollback an add still syncs');
  A.setBets(A.bets().filter((b) => String(b.id) !== '1003')); await A.tick10s(); await B.foreground(); assert.ok(!B.ids().includes('1003'), 'and a delete still syncs');
  A.setBets(A.bets().map((b) => (String(b.id) === '1004' ? Object.assign({}, b, { stake: 77, t: Date.now() + 5 }) : b))); await A.tick10s(); await B.foreground(); assert.strictEqual(B.bets().find((b) => String(b.id) === '1004').stake, 77, 'and an edit');
  let st = rowOf().data; assert.deepStrictEqual(st.bets.map((b) => String(b.id)).sort(), ['1001', '1004', '1005', '1006', '1007', '1008'], 'nothing lost, nothing doubled after the rollback');
  assert.ok(st.bets.filter((b) => String(b.id) !== '1008').every((b) => Number(b.sa) > 0), 'the old stamps are simply carried along as plain fields (main ignores them)');
  A.setBets(A.bets().filter((b) => String(b.id) !== '1007')); await A.tick10s(); await B.foreground(); assert.ok(!rowOf().data.bets.some((b) => String(b.id) === '1007') && !B.ids().includes('1007'), 'under main\'s code the once-locked bet is an ordinary bet (deletable): nothing breaks; the group book, not this copy, is what a contest reads');
  // ---- forward again ----
  process.env.GROUPS_ENABLED = '1'; SERVER = NEW; IP = '5.5.4.3';
  B.setBets(B.bets().concat(mkBet('1009'))); await B.tick10s(); await A.foreground(); st = rowOf().data;
  assert.deepStrictEqual(st.bets.map((b) => String(b.id)).sort(), ['1001', '1004', '1005', '1006', '1008', '1009']); assert.ok(st.bets.every((b) => Number(b.sa) > 0), 'bets added during the rollback get a stamp on the next write (the row\'s previous write time)'); assert.deepStrictEqual(A.ids(), B.ids());
  delete process.env.GROUPS_ENABLED;
});
// ---- merge() on its own ----
let seed = 20261116; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }, ri = (n) => Math.floor(rnd() * n), pick = (a) => a[ri(a.length)];
const IDS = ['1', '2', '3', '4', '5', 'b6', 'k7', 8, 9];
const rbet = (gl) => { const b = { id: pick(IDS), stake: ri(100) }; if (rnd() < 0.8) b.t = ri(5) * 100; if (rnd() < 0.3) b.res = pick(['won', 'lost', null]); if (rnd() < 0.2) { b.fin = pick(['won', 'lost', 'push']); b.finPL = ri(100) - 50; }
  if (rnd() < 0.3) { b.kind = 'parlay'; b.legs = Array.from({ length: 2 + ri(2) }, () => (rnd() < 0.5 ? { side: 'KC', res: pick(['won', 'lost']) } : { side: 'BUF' })); } if (gl && rnd() < 0.3) b.gl = pick([500, 700]); if (gl && rnd() < 0.3) b.sa = pick([100, 250]); return b; };
const uniq = (l) => { const m = new Map(); l.forEach((x) => m.set(String(x.id), x)); return [...m.values()]; };
const rside = (stored, gl) => { const o = {}; if (rnd() < 0.9) { o.bets = Array.from({ length: ri(7) }, () => rbet(gl)); if (stored) o.bets = uniq(o.bets); else if (rnd() < 0.1) o.bets.push(null); } if (rnd() < 0.6) o.tomb = Array.from({ length: ri(4) }, () => pick(IDS));
  if (rnd() < 0.3) { o.log = { '2026-11-01': { n: ri(4) } }; o.logAt = ri(3); } if (rnd() < 0.3) { o.pins = ['a', 'b'].slice(0, ri(3)); o.pinsAt = ri(3); } if (rnd() < 0.2) o.locks = { k: { t: ri(5) } }; if (rnd() < 0.2) o.splk = { nfl: { g1: { r: ri(2) } } }; if (rnd() < 0.2) o.kdel = ['x']; return o; };
test('S5 merge(): 20,000 random rows. Off = main byte for byte (even rows that carry stamps and locks); on = main apart from `sa` whenever no group bet is involved; inputs never changed', async () => {
  for (let i = 0; i < 20000; i++) {
    const gl = i % 2 === 1, a = rside(true, gl), b = rside(false, gl), ja = J(a), jb = J(b);
    delete process.env.GROUPS_ENABLED; assert.strictEqual(J(NEW.merge(a, b, 5000, 4000)), J(MAIN.merge(a, b)), 'off: differs from main at case ' + i);
    if (!gl) { process.env.GROUPS_ENABLED = '1'; const x = NEW.merge(a, b, 5000, 4000); assert.ok(x.bets.every((y) => y.sa === 5000 || y.sa === 4000), 'stamped'); assert.strictEqual(J(noSa(x)), J(MAIN.merge(a, b)), 'on, no group bets: differs from main beyond `sa` at case ' + i); }
    assert.strictEqual(J(a), ja, 'stored input changed'); assert.strictEqual(J(b), jb, 'incoming input changed');
  }
  delete process.env.GROUPS_ENABLED;
});
test('S6 the lock, Groups on: a stored group bet cannot be edited, swapped or deleted by a phone; only its result marks are taken; a phone cannot make a group bet; a stamp never moves', async () => {
  process.env.GROUPS_ENABLED = '1';
  const st = { bets: [{ id: 'g1', side: 'KC', stake: 100, odds: 130, t: 900, sa: 900, gl: 900 }, { id: 'n1', side: 'BUF', stake: 5, t: 100, sa: 100 }], tomb: [] };
  let x = NEW.merge(st, { bets: [{ id: 'g1', side: 'BUF', stake: 1, odds: 5000, t: 99999, res: 'won', fin: 'won', finPL: 5000, sa: 1, gl: 1 }, { id: 'n1', side: 'BUF', stake: 6, t: 200, sa: 1 }, { id: 'n2', side: 'MIA', stake: 7, t: 300, gl: 12345, sa: 1 }], tomb: ['g1'] }, 2000, 1500);
  const g1 = x.bets.find((b) => b.id === 'g1'), n1 = x.bets.find((b) => b.id === 'n1'), n2 = x.bets.find((b) => b.id === 'n2');
  assert.deepStrictEqual([g1.side, g1.stake, g1.odds, g1.t, g1.gl, g1.sa], ['KC', 100, 130, 900, 900, 900], 'the stored group bet wins over the phone\'s edit'); assert.deepStrictEqual([g1.res, g1.fin, g1.finPL], ['won', 'won', 5000], 'the phone\'s own result marks are shown (never used for grading)');
  assert.ok(!x.tomb.includes('g1'), 'its delete is dropped'); assert.deepStrictEqual([n1.stake, n1.sa], [6, 100], 'an ordinary bet is edited as before and keeps its first stamp'); assert.ok(!('gl' in n2) && n2.sa === 2000, 'a phone-sent lock is removed and a phone-sent stamp ignored');
  x = NEW.merge({ bets: [{ id: 'old', stake: 1, t: 1 }] }, { bets: [{ id: 'old', stake: 1, t: 1 }, { id: 'new', stake: 2, t: 2 }] }, 2000, 1500); assert.deepStrictEqual(x.bets.map((b) => [b.id, b.sa]), [['old', 1500], ['new', 2000]], 'a bet stored before stamps existed gets the row\'s previous write time; a new one gets now');
  delete process.env.GROUPS_ENABLED;
});
test('S7 the switch taken away again (off after on): the merge is main\'s again; stored stamps and locks are plain fields a phone can change like any other', async () => {
  delete process.env.GROUPS_ENABLED;
  const st = { bets: [{ id: 'g1', side: 'KC', stake: 100, t: 900, sa: 900, gl: 900 }], tomb: [] }, inc = { bets: [{ id: 'g1', side: 'BUF', stake: 1, t: 99999 }], tomb: [] };
  assert.strictEqual(J(NEW.merge(st, inc, 2000, 1500)), J(MAIN.merge(st, inc))); assert.strictEqual(NEW.merge(st, inc, 2000, 1500).bets[0].side, 'BUF');
  assert.strictEqual(J(NEW.merge(st, { bets: [], tomb: ['g1'] })), J(MAIN.merge(st, { bets: [], tomb: ['g1'] }))); assert.strictEqual(NEW.merge(st, { bets: [], tomb: ['g1'] }).bets.length, 0);
  assert.strictEqual(NEW.groupsOn(), false); process.env.GROUPS_ENABLED = 'true'; assert.strictEqual(NEW.groupsOn(), false, 'only the exact value 1 turns it on'); process.env.GROUPS_ENABLED = '1'; assert.strictEqual(NEW.groupsOn(), true); delete process.env.GROUPS_ENABLED;
});
test('S8 the player list (owner dashboard, My Apps feed) and the id list: if the database refuses the new lock-row filter, main\'s own query is used and the answer is the same', async () => {
  Object.keys(DB).forEach((k) => delete DB[k]); DB.aaaa = { id: 'aaaa', updated: 5, data: { bets: [mkBet('1')] } }; DB['lock:grp:X'] = { id: 'lock:grp:X', updated: 1, data: {} };
  const real = global.fetch, seen = []; let refuse = false;
  global.fetch = async (url, opt) => { seen.push(String(url)); if (refuse && /not\.like/.test(String(url))) return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad filter' }; return real(url, opt); };
  try {
    delete process.env.GROUPS_ENABLED; const a0 = await NEW.adminUsers(null); assert.deepStrictEqual(seen, ['https://fake.supabase.co/rest/v1/oddable_sync?select=id,updated,data&limit=2000'], 'Groups off: ONE query, main\'s own, exactly as before'); seen.length = 0; const m0 = await MAIN.adminUsers(null); assert.deepStrictEqual(seen, ['https://fake.supabase.co/rest/v1/oddable_sync?select=id,updated,data&limit=2000']); assert.deepStrictEqual(a0, m0); seen.length = 0;
    process.env.GROUPS_ENABLED = '1'; const a1 = await NEW.adminUsers(null), i1 = await NEW.dbIds(); assert.ok(seen.every((u) => /id=not\.like\.lock:\*/.test(u)), 'the filtered query is tried first');
    refuse = true; seen.length = 0; const a2 = await NEW.adminUsers(null), i2 = await NEW.dbIds(); assert.strictEqual(seen.length, 4, 'refused, then the plain query'); assert.ok(seen[1].endsWith('oddable_sync?select=id,updated,data&limit=2000'), 'main\'s exact player-list query');
    assert.deepStrictEqual(a2, a1); assert.deepStrictEqual(i2, i1); assert.deepStrictEqual(i1, ['aaaa']); assert.deepStrictEqual(a1.map((u) => u.id), ['aaaa'], 'lock rows are never players, with or without the filter');
    global.fetch = real; assert.deepStrictEqual(await NEW.adminUsers(null), await MAIN.adminUsers(null), 'same player list as main\'s code'); assert.deepStrictEqual(a1, a0);
  } finally { global.fetch = real; delete process.env.GROUPS_ENABLED; }
});
(async () => {
  let bad = 0;
  for (const [n, f] of tests) { try { await f(); console.log('  PASS ' + n); } catch (e) { bad++; console.log('  FAIL ' + n + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 8).join('\n        ')); } }
  console.log(bad ? '\n' + bad + ' OF ' + tests.length + ' SYNC PHASE-1 CHECKS FAILED' : '\nALL ' + tests.length + ' SYNC PHASE-1 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
