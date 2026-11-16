// Run: node odds-api/events.fix.test.js [name ...]   Review fixes (independent review of local-v1 @2836bbc). In-memory database, fake sign-in and clock, no network.
const assert = require('assert'), http = require('http'), E = require('./events'), D = E._deps;
let db = {};
D.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); return t.startsWith('t-') ? 'acct-' + t.slice(2) : null; } });
D.enterprise = async () => false;
let ipn = 0; D.ip = () => '7.7.' + (ipn % 250) + '.' + (ipn++ % 251);
const Z = (s) => Date.parse(s), DAY = 864e5; let NOW; D.now = () => NOW; const START = Z('2026-11-21T15:00:00Z');
const srv = http.createServer(async (req, res) => { if (!(await E.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P;
const call = async (who, op, b) => { const r = await fetch('http://127.0.0.1:' + P + '/events/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, body: JSON.stringify(b || {}) }); return { s: r.status, j: JSON.parse(await r.text()) }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const no = (r, s, m) => assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300));
const base = (o) => Object.assign({ title: 'Fix test', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: START, to: 11, winBy: 2, bestOf: 1, seeding: 'manual', courts: 2, pools: 1, playoff: 0, entry: 0, split: 'none', take: { kind: 'none' }, myName: 'Ann' }, o || {});
const reset = () => { db = {}; E._reset(); NOW = Z('2026-11-17T18:00:00Z'); };
const T = {};
module.exports = { T };
const only = process.argv.slice(2);
srv.listen(0, async () => {
  P = srv.address().port; let n = 0, fail = 0;
  for (const k of Object.keys(T)) { if (only.length && !only.includes(k)) continue; reset(); try { await T[k](); n++; console.log('  ok', k); } catch (e) { fail++; console.log('  FAIL', k, '-', e.message.split('\n')[0]); } }
  console.log(fail ? '\nFAILED ' + fail + ' of ' + (n + fail) : '\nPASS ' + n + ' review-fix checks'); srv.close(); process.exit(fail ? 1 : 0);
});
// ---------- tests (one per review item) ----------
// 1 (HIGH) a commissioner who plays cannot make their own score final by entering it again or "correcting" it
T.commOwnMatch = async () => {
  let ev = ok(await call('ann', 'create', base({ playIn: true, entrants: [] }))).event; const id = ev.id;
  ok(await call('bob', 'join', { code: ev.code, as: 'player', myName: 'Bob' }));
  NOW = START + 1000; ev = ok(await call('ann', 'get', { id })).event; const m = ev.matches[0], mine = ev.myEntries[0];
  const annWin = m.a === mine ? [[11, 0]] : [[0, 11]], bobWin = m.a === mine ? [[0, 11]] : [[11, 0]];
  ev = ok(await call('ann', 'score', { id, m: m.id, games: annWin })).event; assert.strictEqual(ev.matches[0].state, 'pending', 'own entry waits for Bob');
  no(await call('ann', 'score', { id, m: m.id, games: annWin }), 403, 'second entry by the commissioner on her own pending match');
  no(await call('ann', 'confirm', { id, m: m.id }), 403, 'commissioner confirms own score');
  ev = ok(await call('bob', 'confirm', { id, m: m.id })).event; assert.strictEqual(ev.matches[0].state, 'confirmed');
  no(await call('ann', 'score', { id, m: m.id, games: bobWin }), 403, 'commissioner "corrects" her own confirmed match');
  // a dispute on her own match: she decides (the brief's rule), and that entry is final
  let ev2 = ok(await call('ann', 'create', base({ title: 'Fix test 2', start: START + DAY, playIn: true, entrants: [] }))).event; const id2 = ev2.id;
  NOW = Z('2026-11-17T18:00:00Z'); ok(await call('bob', 'join', { code: ev2.code, as: 'player', myName: 'Bob' })); NOW = START + DAY + 1000;
  ev2 = ok(await call('ann', 'get', { id: id2 })).event; const m2 = ev2.matches[0];
  ok(await call('ann', 'score', { id: id2, m: m2.id, games: m2.a === ev2.myEntries[0] ? [[11, 0]] : [[0, 11]] })); ok(await call('bob', 'dispute', { id: id2, m: m2.id, note: 'no' }));
  ev2 = ok(await call('ann', 'score', { id: id2, m: m2.id, games: m2.a === ev2.myEntries[0] ? [[11, 9]] : [[9, 11]] })).event; assert.strictEqual(ev2.matches[0].state, 'confirmed', 'dispute: commissioner decides');
  // against a typed-in guest (no account) the commissioner's own entry is final
  let ev3 = ok(await call('ann', 'create', base({ title: 'Fix test 3', start: START + 2 * DAY, playIn: true, entrants: [{ name: 'Gus' }] }))).event; NOW = START + 2 * DAY + 1000;
  ev3 = ok(await call('ann', 'get', { id: ev3.id })).event; ev3 = ok(await call('ann', 'score', { id: ev3.id, m: ev3.matches[0].id, games: [[11, 4]] })).event; assert.strictEqual(ev3.matches[0].state, 'confirmed', 'vs guest: final');
};
// 2 (MED-HIGH) a typed-in guest's spot is taken only with that guest's claim code; "commissioner adds players" is honored; strangers do not see guest names
T.guestSeats = async () => {
  let ev = ok(await call('ann', 'create', base({ self: false, unit: 'doubles', entrants: [{ name: 'Gail / Hal' }, { name: 'Ivy' }] }))).event; const id = ev.id, code = ev.code;
  no(await call('mal', 'join', { code, as: 'player', myName: 'Mal' }), 403, 'self-join when the commissioner adds players');
  const pv = ok(await call('mal', 'preview', { code })).event; const txt = JSON.stringify(pv);
  assert.ok(!/Gail|Hal|Ivy/.test(txt), 'stranger preview must not show guest names: ' + txt.slice(0, 400));
  const gail = (await D.S.dbGet('lock:evt:' + id)).data.entrants[0];
  no(await call('mal', 'join', { code, as: 'player', myName: 'Mal', eid: gail.eid, gid: gail.players[0].gid }), 403, 'taking a named guest seat without the claim code');
  const ivy = (await D.S.dbGet('lock:evt:' + id)).data.entrants[1];
  no(await call('mal', 'join', { code, as: 'player', myName: 'Mal', eid: ivy.eid, gid: ivy.players[1].gid }), 403, 'blank partner spot when the commissioner adds players');
  const cc = ok(await call('ann', 'get', { id })).event.entrants[0].players[0].claim; ok(await call('gail', 'claim', { claim: cc, myName: 'Gail' }), 'claim code still works');
  // self-join on: blank partner spot of a pair is joinable; the named one is not
  let ev2 = ok(await call('ann', 'create', base({ title: 'Open doubles', unit: 'doubles', entrants: [{ name: 'Ivy' }] }))).event;
  const pv2 = ok(await call('nat', 'preview', { code: ev2.code })).event; assert.ok(!/Ivy/.test(JSON.stringify(pv2)), 'no guest names to strangers');
  assert.strictEqual(pv2.open.length, 1); assert.strictEqual(pv2.open[0].seats.length, 1, 'only the blank partner spot');
  const r = ok(await call('nat', 'join', { code: ev2.code, as: 'player', myName: 'Nat', eid: pv2.open[0].eid, gid: pv2.open[0].seats[0].gid })).event; assert.ok(r.entrants[0].players.some((p) => p.me));
  const ivy2 = (await D.S.dbGet('lock:evt:' + ev2.id)).data.entrants[0];
  no(await call('oz', 'join', { code: ev2.code, as: 'player', myName: 'Oz', eid: ivy2.eid, gid: ivy2.players[0].gid }), 403, 'named guest seat needs the claim code');
};
// 3 (MED) a pool result corrected after the playoff was set: rebuild the playoff if none of it is played, refuse once it is
T.poolFixAfterPlayoff = async () => {
  let ev = ok(await call('ann', 'create', base({ playIn: false, playoff: 2, entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; const id = ev.id;
  NOW = START + 1000; ev = ok(await call('ann', 'get', { id })).event; const nm = (e) => ev.entrants.find((x) => x.eid === e).name;
  // A beats everyone, B beats C and D, C beats D -> playoff A v B
  for (const m of ev.matches) { const order = 'ABCD', wa = order.indexOf(nm(m.a)) < order.indexOf(nm(m.b)); ok(await call('ann', 'score', { id, m: m.id, games: wa ? [[11, 5]] : [[5, 11]] })); }
  ev = ok(await call('ann', 'get', { id })).event; let fin = ev.matches.find((m) => m.st === 'po'); assert.deepStrictEqual([fin.an, fin.bn].sort(), ['A', 'B']);
  // correct C v B to C winning, and C v A to C winning: C is now 3-0... (C beat A, B, D) -> playoff must become C v A or C v B by the new table
  const cb = ev.matches.find((m) => m.st === 'pool' && [nm(m.a), nm(m.b)].sort().join() === 'B,C'), ca = ev.matches.find((m) => m.st === 'pool' && [nm(m.a), nm(m.b)].sort().join() === 'A,C');
  ok(await call('ann', 'score', { id, m: cb.id, games: nm(cb.a) === 'C' ? [[11, 2]] : [[2, 11]] })); ev = ok(await call('ann', 'score', { id, m: ca.id, games: nm(ca.a) === 'C' ? [[11, 2]] : [[2, 11]] })).event;
  fin = ev.matches.find((m) => m.st === 'po'); const top2 = ev.tables[0].slice(0, 2).map((r) => r.name).sort();
  assert.deepStrictEqual([fin.an, fin.bn].sort(), top2, 'playoff follows the corrected table ' + JSON.stringify(top2));
  assert.strictEqual(ev.matches.filter((m) => m.st === 'po').length, 1, 'one playoff, not two');
  // once the playoff is played, pool corrections are refused
  ok(await call('ann', 'score', { id, m: fin.id, games: [[11, 9]] }));
  const da = ev.matches.find((m) => m.st === 'pool' && [nm(m.a), nm(m.b)].sort().join() === 'A,D');
  no(await call('ann', 'score', { id, m: da.id, games: nm(da.a) === 'D' ? [[11, 2]] : [[2, 11]] }), 409, 'pool correction after the playoff was played');
};
