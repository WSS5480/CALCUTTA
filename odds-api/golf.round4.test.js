// Golf review round 4 (Nov 17 2026): THE NEUTRAL RULE tightened at its definitions (C1, H1 to H4, M2 to M5), the other session's list (H5 to H7,
// 9-hole rounding, skins on withdrawal, Golf alone without stats) and My courses. No network, no database (in-memory fakes).
// Run: node odds-api/golf.round4.test.js      Proof (fails on 584be99, passes here): OLD=584be99 TEST=golf.round4.test.js python3 scripts/golf-proof.py
// /tmp (GOLF_ROOT=<that copy>/odds-api/) and prints one line per check. Each check is independent: one failing does not hide the others.
'use strict';
const assert = require('assert'), { Readable } = require('stream');
const ROOT = process.env.GOLF_ROOT || __dirname + '/';
const G = require(ROOT + 'golf'), D = G._deps, FS = require(ROOT + 'golf.fakestats');
let db = {}, slowLo = 0, slowHi = 0;
const wait = () => (slowHi ? new Promise((r) => setTimeout(r, slowLo + Math.random() * (slowHi - slowLo))) : Promise.resolve());
D.S = { dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; }, dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
const ACC = (w) => w + '@phone.oddable';
D.acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
D.ip = () => '1.1.1.' + Math.floor(Math.random() * 250);
D.limitsMod = () => null; // this file tests golf's own rules: the Enterprise flag comes from the stand-in row 'lock:ent', also in the merged build
let NOW = Date.parse('2026-11-18T18:00:00Z'); D.now = () => NOW;
const TEE = Date.parse('2026-11-19T12:00:00Z'), mkG = (i) => ({ id: 'p' + i, name: 'Golfer ' + String(i).padStart(2, '0'), pos: '', toPar: null, today: null, thru: '', rounds: [], st: 'active', tee: TEE + i * 60e3, started: false, earn: null, sort: i });
const W = { done: false }; D.feed = { events: async () => [{ id: 'E1', name: 'Test Classic' }], board: async (tour, ev) => ({ event: { id: ev, tour, name: 'Test Classic', start: TEE, end: TEE + 4 * 864e5, state: W.done ? 'post' : 'pre', done: W.done }, golfers: Array.from({ length: 50 }, (_, i) => Object.assign(mkG(i + 1), W.done ? { toPar: i - 10, pos: String(i + 1), started: true } : {})), firstTee: TEE + 60e3, earnings: false }) };
let GROUPS = null; D.groups = () => GROUPS;
const call = (who, op, b) => { const req = Readable.from([Buffer.from(JSON.stringify(Object.assign({ myName: who ? who[0].toUpperCase() + who.slice(1) : '' }, b || {})))]); req.url = '/golf/' + op; req.method = 'POST'; req.headers = { 'x-token': who ? 't-' + who : '' };
  return new Promise((ok) => { const res = { setHeader() {}, end(t) { ok({ s: res.statusCode, j: JSON.parse(t) }); } }; G.handle(req, res); }); };
const ok = (r, m) => { assert.ok(r.s === 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j.error || r.j.note || '').slice(0, 300)); return r; };
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10];
const COURSE = { name: 'Test CC', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 71.2, slope: 125 };
const fresh = () => { db = {}; G._reset(); FS.install(G, {}); GROUPS = null; NOW = Date.parse('2026-11-18T18:00:00Z'); W.done = false; slowLo = slowHi = 0; };
// SET-UP HELPERS (not the thing under test). `sg` has the first person who may sign a waiting action sign it; on 2fa88eb nothing ever waits, so it does nothing.
const sg = async (r, id) => { if (r.s !== 202 || !r.j.n) return r; const q = r.j.game.pending.find((x) => x.n === r.j.n); return q && q.who.length ? call(q.who[0].toLowerCase(), 'sign', { id, n: q.n }) : r; };
const okS = (r) => { assert.ok(r.s === 200 || r.s === 202, 'set-up -> ' + r.s + ' ' + JSON.stringify(r.j.error || '')); return r; };
// names[0] organizes. tOf(i) = team of player i (default: one-player teams, the organizer on T1). opt.orgOut: the organizer does not play.
async function mk(names, day, pot, opt) { opt = opt || {}; const tOf = opt.tOf || ((i) => 'T' + (opt.orgOut ? i : i + 1));
  let r = ok(await call(names[0], 'create', { kind: 'day', title: opt.title || 'Money day', course: COURSE, day: Object.assign({ fmt: 'stroke', teams: opt.nT || names.length - (opt.orgOut ? 1 : 0), teamSize: opt.size || 1, net: 'net' }, day || {}), pot: pot === undefined ? { entry: 10 } : pot }), 'create'); const id = r.j.game.id, code = r.j.game.code;
  for (let i = 1; i < names.length; i++) ok(await call(names[i], 'join', { code, tid: tOf(i) }), 'join ' + names[i]); if (!opt.orgOut) ok(await call(names[0], 'team', { id, op: 'assign', pid: r.j.game.me, tid: tOf(0) }), 'assign');
  const g = (await call(names[0], 'get', { id })).j.game, pid = {}; g.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid));
  if (!opt.noPaid) for (const n of names) if (!(opt.orgOut && n === names[0])) ok(await call(names[0], 'paid', { id, pid: pid[n], paid: true }), 'paid before the start');
  return { id, code, pid }; }
// every player gets the number 0 through whatever the tree asks for (set by the organizer, OK'd, signed)
async function nums(names, id, pid, opt) { opt = opt || {}; for (let i = opt.orgOut ? 1 : 0; i < names.length; i++) { let r = await call(names[0], 'team', { id, op: 'hcp', pid: pid[names[i]], hcp: (opt.v || [])[i] || 0, reason: 'test set-up' });
    if (r.s === 202 && !r.j.n) { let done = false; for (let k = 1; k < names.length && !done; k++) { const q = await call(names[k], 'team', { id, op: 'hcpok', pid: pid[names[i]] }); done = q.s === 200; } assert.ok(done, 'someone OKs the organizer\'s own number'); } else okS(await sg(r, id)); } }
const card = async (who, id, tid, p, f, to) => { for (let h = 1; h <= (to || 18); h++) ok(await call(who, 'score', { id, tid, hole: h, p: typeof p === 'function' ? p(h) : { [p]: f(h) }, eid: who + tid + h + Math.random() }), 'score'); };
const conf = async (who, id, tid) => { const g = (await call(who, 'get', { id })).j.game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); return call(who, 'confirm', { id, tid, from: 1, to: 18, revs }); };
// Ann (organizer, Team 1) is second, Bob (Team 2) leads, Cat (Team 3) is last; $10 each, all paid, every hole confirmed.
async function three(day, opt) { const N = ['ann', 'bob', 'cat'], x = await mk(N, day, { entry: 10 }, opt); await nums(N, x.id, x.pid); ok(await call('ann', 'start', { id: x.id }), 'start');
  await card('ann', x.id, 'T1', x.pid.ann, (h) => PAR[h - 1] + 1, (opt || {}).annTo); await card('bob', x.id, 'T2', x.pid.bob, (h) => PAR[h - 1], (opt || {}).bobTo); await card('cat', x.id, 'T3', x.pid.cat, (h) => PAR[h - 1] + 2);
  ok(await conf('bob', x.id, 'T1')); ok(await conf('cat', x.id, 'T2')); ok(await conf('ann', x.id, 'T3')); return x; }
const board = async (id) => (await call('ann', 'get', { id })).j.game;
const first = (g) => g.board.rows[0].name, paidOut = (g) => (g.payout.paid || []).map((x) => x.name + ' ' + x.amt).join(', ');
const S = require(ROOT + 'golf-score'), D0 = { stats: D.stats, handicapFor: D.handicapFor, eventSetup: D.eventSetup, eventOverride: D.eventOverride, eventLog: D.eventLog };
const noStats = () => Object.assign(D, D0); // Golf alone: the build has no stats module
const who = (r) => (r.j.game.pending.find((q) => q.n === r.j.n) || { who: [] }).who.slice().sort();
const guest = async (org, id, name, tid) => { const r = ok(await call(org, 'team', { id, op: 'guest', name, tid }), 'guest'); return r.j.guest.pid; };
const CHECKS = [];
const chk = (name, fn) => CHECKS.push([name, fn]);
// Ann organizes and stays off every team; her typed-in guest "Ann S" is Team 1 and she keeps that card. Bob (Team 2) leads, Cat is Team 3. $10, gross.
async function annS(bobTo) { const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { orgOut: true, nT: 3, tOf: (i) => 'T' + (i + 1) }), id = x.id; const gp = await guest('ann', id, 'Ann S', 'T1'); ok(await call('ann', 'paid', { id, pid: gp, paid: true })); ok(await call('ann', 'start', { id }));
  await card('ann', id, 'T1', gp, (h) => PAR[h - 1] + 1); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1], bobTo); await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1] + 2); ok(await conf('bob', id, 'T1')); ok(await conf('cat', id, 'T2')); ok(await conf('bob', id, 'T3')); return Object.assign(x, { gp }); }

chk('C1 an organizer who keeps a typed-in guest\'s card is INTERESTED: she cannot rewrite the leader\'s confirmed holes, withdraw him or un-pay him alone', async () => {
  const { id, pid } = await annS(); let r; assert.strictEqual((await call('ann', 'get', { id })).j.game.interested, true, 'keeps a card = interested');
  for (let h = 1; h <= 8; h++) { r = await call('ann', 'score', { id, tid: 'T2', hole: h, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 202, 'hole ' + h + ' only waits'); assert.ok(who(r).includes('Bob')); }
  // round 5 (TEST 2): a helper who does not gain may sign, but Bob, the harmed side, is told and his objection puts it back
  r = ok(await call('cat', 'sign', { id, n: (await board(id)).pending.find((q) => q.hole === 1).n })); assert.strictEqual(r.j.game.day.scores.T2[1].p[pid.bob], 15); const hb = (await call('bob', 'get', { id })).j.game.harm[0]; assert.ok(hb.canObject && hb.mine);
  r = ok(await call('bob', 'object', { id, h: hb.h })); assert.strictEqual(r.j.game.day.scores.T2[1].p[pid.bob], PAR[0], 'put back'); assert.ok(r.j.partial === undefined);
  r = ok(await call('cat', 'uphold', { id, h: hb.h })); assert.ok(r.j.partial, 'one other team is not enough to uphold it'); assert.strictEqual(r.j.game.day.scores.T2[1].p[pid.bob], PAR[0]);
  let g = await board(id); assert.ok([1, 2, 3, 4, 5, 6, 7, 8].every((h) => g.day.scores.T2[h].p[pid.bob] === PAR[h - 1] && g.day.scores.T2[h].st === 'confirmed'), 'Bob\'s card is untouched');
  r = await call('ann', 'paid', { id, pid: pid.bob, paid: false, reason: 'did not pay' }); assert.strictEqual(r.s, 202); assert.ok(who(r).includes('Bob')); assert.ok(/not paid \(was paid\)/.test(r.j.game.pending.find((q) => q.n === r.j.n).text));
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(first(r.j.game), 'Team 2'); assert.strictEqual(paidOut(r.j.game), 'Bob 30', 'the $30 goes to the real winner');
  // the leader with 17 holes cannot be marked did-not-finish by her (and a helper) either
  fresh(); const y = await annS(17); r = await call('ann', 'team', { id: y.id, op: 'withdraw', tid: 'T2', reason: 'left' }); assert.strictEqual(r.s, 409, 'round 5 (N1): not before the expected finish'); assert.strictEqual((await board(y.id)).day.wd.T2, undefined);
});
chk('C1 a stake counts too: an organizer on no team who holds a lot in the linked Calcutta is interested (setLotHolders)', async () => {
  const N = ['org', 'bob', 'cat'], { id } = await mk(N, { net: 'gross' }, { entry: 10 }, { orgOut: true }); assert.strictEqual((await call('org', 'get', { id })).j.game.interested, false, 'no card, no team, no stake: neutral');
  await G.linkCalcutta(id, 'CALC1', ACC('org')); assert.strictEqual((await call('org', 'get', { id })).j.game.interested, true, 'a linked Calcutta with unknown holders: the organizer counts as holding a lot');
  await G.setLotHolders(id, [ACC('bob')]); assert.strictEqual((await call('org', 'get', { id })).j.game.interested, false, 'the Calcutta says who holds lots: not her'); await G.setLotHolders(id, [ACC('org')]); assert.strictEqual((await call('org', 'get', { id })).j.game.interested, true);
  let r = await call('org', 'setup', { id, day: { net: 'gross', extras: { skins: { on: true, amt: 5 } } } }); assert.strictEqual(r.s, 202, 'so a rule change only waits');
});
chk('H1 organizer plus ONE helper on another team cannot touch a third team\'s card, standing or paid mark: only that team\'s own account signs', async () => {
  const { id, pid } = await three(); let r;
  for (const h of [1, 2, 3, 5, 6, 7, 8, 9]) { r = await call('ann', 'score', { id, tid: 'T2', hole: h, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 202); assert.ok(who(r).includes('Bob')); }
  { const q = (await board(id)).pending.find((x) => x.hole === 2), c1 = await call('cat', 'sign', { id, n: q.n }); if (c1.s === 200) { const h = (await call('bob', 'get', { id })).j.game.harm.find((e) => e.st === 'open'); ok(await call('bob', 'object', { id, h: h.h }), 'round 5: Bob objects and it is put back'); } assert.strictEqual((await board(id)).day.scores.T2[2].p[pid.bob], PAR[1]); }
  assert.ok(/Team 2 hole 9 \(confirmed\): Bob 5 → Bob 15/.test(r.j.game.pending.find((q) => q.n === r.j.n).text), 'M4: the signer sees old → new');
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
  // before the holes are confirmed: no blind overwrite, and the team itself confirms what an outsider typed
  fresh(); const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross' }); ok(await call('ann', 'start', { id: x.id })); await card('bob', x.id, 'T2', x.pid.bob, (h) => PAR[h - 1], 8);
  r = await call('ann', 'score', { id: x.id, tid: 'T2', hole: 1, p: { [x.pid.bob]: 15 } }); assert.strictEqual(r.s, 409, 'no rev: refused'); assert.strictEqual(r.j.needRev, true);
  r = ok(await call('ann', 'score', { id: x.id, tid: 'T2', hole: 1, p: { [x.pid.bob]: 15 }, rev: 1 })); assert.strictEqual(r.j.game.day.scores.T2[1].st, 'entered');
  r = await conf('cat', x.id, 'T2'); ok(r, 'Cat confirms what Bob typed himself'); assert.strictEqual(r.j.game.day.scores.T2[1].st, 'entered', 'but not the hole the organizer typed over'); assert.strictEqual(r.j.game.day.scores.T2[2].st, 'confirmed');
  r = ok(await conf('bob', x.id, 'T2')); assert.strictEqual(r.j.game.day.scores.T2[1].cf, 'Bob', 'Team 2\'s own player confirms it');
});
chk('H1 a team with no account (all typed-in guests): a neutral third account signs, and the board says "changed without the team\'s sign-off"', async () => {
  const N = ['ann', 'bob'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 3 }), id = x.id; const gp = await guest('ann', id, 'Gus', 'T3'); ok(await call('ann', 'paid', { id, pid: gp, paid: true })); ok(await call('ann', 'start', { id }));
  await card('ann', id, 'T3', gp, (h) => PAR[h - 1]); ok(await conf('bob', id, 'T3')); let r = await call('ann', 'score', { id, tid: 'T3', hole: 2, p: { [gp]: 9 } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob']);
  r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.board.rows.find((t) => t.tid === 'T3').nso, 1); assert.ok(/hole 2/.test(r.j.game.day.nso.T3[0].what)); assert.strictEqual(r.j.game.board.rows.find((t) => t.tid === 'T2').nso, undefined);
});
chk('H2 one and done: the prize money and the end of the season go through the rule (a playing organizer only asks; the other entrant signs)', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'OAD', pro: { tour: 'pga', game: 'oad' }, pot: { entry: 10 } })); const id = r.j.game.id; ok(await call('bob', 'join', { code: r.j.game.code }));
  ok(await call('ann', 'pick', { id, event: 'E1', golfer: 'p9' })); ok(await call('bob', 'pick', { id, event: 'E1', golfer: 'p1' })); NOW = TEE + 5 * 864e5; W.done = true; await call('ann', 'get', { id }); NOW += 11 * 60e3; r = ok(await call('ann', 'get', { id })); assert.strictEqual(r.j.game.table[0].name, 'Bob');
  r = await call('ann', 'oadmoney', { id, event: 'E1', money: { p9: 5000000, p1: 0 } }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.table[0].name, 'Bob', 'nothing changed'); assert.deepStrictEqual(who(r), ['Bob']);
  assert.ok(/Golfer 09 .* → \$5,000,000/.test(r.j.game.pending[0].text), 'old → new for every golfer'); assert.ok((await call('bob', 'get', { id })).j.game.unseen >= 1, 'Bob has it waiting (and is told it makes him worse off)');
  r = await call('ann', 'endseason', { id }); assert.strictEqual(r.s, 202); assert.strictEqual((await call('ann', 'sign', { id, n: r.j.n })).s, 403); r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.ok(r.j.game.plog.some((p) => p.kind === 'endseason' && p.st === 'signed' && p.sig === 'Bob'));
});
chk('H3 a money game cannot start without two accounts on different teams; it can be played as a casual game with no money shown', async () => {
  let r = ok(await call('ann', 'create', { kind: 'day', title: 'Guests', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'gross', extras: { skins: { on: true, amt: 5 } } }, pot: { entry: 10 } })); const id = r.j.game.id; ok(await call('ann', 'team', { id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); await guest('ann', id, 'Gus', 'T2'); await guest('ann', id, 'Hal', 'T3');
  r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409); assert.strictEqual(r.j.needTwo, true); assert.ok(/two players with their own Oddable account/.test(r.j.error));
  ok(await call('zed', 'join', { code: (await board(id)).code })); r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409, 'an account that only joined (on no team) does not count');
  r = ok(await call('ann', 'start', { id, casual: true })); assert.deepStrictEqual([r.j.game.day.status, r.j.game.day.money, r.j.game.pot.entry, r.j.game.day.extras.skins.amt], ['live', false, 0, 0], 'started with no money shown');
  fresh(); const x = await mk(['ann', 'bob'], { net: 'gross' }); ok(await call('ann', 'start', { id: x.id }), 'two accounts on two teams: a money game starts');
});
chk('H3/H4 Enterprise, no fee, guests only: one forced Final alone, then the round is closed for good (no reopen without a signer); a playing director cannot finish over short or unconfirmed cards', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); const id = r.j.game.id; const g1 = await guest('club', id, 'Gus', 'T1'), g2 = await guest('club', id, 'Hal', 'T2');
  ok(await call('club', 'start', { id })); await card('club', id, 'T1', g1, (h) => PAR[h - 1]); await card('club', id, 'T2', g2, (h) => PAR[h - 1] + 1);
  r = await call('club', 'final', { id }); assert.strictEqual(r.s, 409, 'H4: unconfirmed holes block a plain Final in a tournament with no fee'); r = ok(await call('club', 'final', { id, force: true, reason: 'paper cards' })); assert.strictEqual(r.j.game.day.forced.alone, true);
  r = await call('club', 'reopen', { id, reason: 'change my mind' }); assert.strictEqual(r.s, 409); assert.ok(/closed for good/.test(r.j.error)); assert.strictEqual((await board0('club', id)).day.status, 'final');
  // H4: the director plays, his 18 holes are unconfirmed and Bob has 5 of 18
  fresh(); db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); const i2 = r.j.game.id, me = r.j.game.me; ok(await call('club', 'team', { id: i2, op: 'assign', pid: me, tid: 'T1' })); r = ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T2' })); const bob = r.j.game.me;
  ok(await call('club', 'start', { id: i2 })); await card('club', i2, 'T1', me, (h) => PAR[h - 1]); await card('bob', i2, 'T2', bob, (h) => PAR[h - 1], 5);
  r = await call('club', 'final', { id: i2 }); assert.strictEqual(r.s, 409); assert.ok(/Team 2 has played 5 of 18 holes/.test(r.j.error)); r = await call('club', 'final', { id: i2, force: true, reason: 'done' }); assert.strictEqual(r.s, 409); assert.strictEqual((await board0('club', i2)).day.status, 'live');
});
chk('M2 + H7 removing people: before the start the organizer; after it the affected side signs; an account that has not played a hole 10 minutes in is removed by the organizer alone, with a notice; money follows', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], x = await mk(N, { net: 'gross' }), id = x.id; let r = ok(await call('ann', 'team', { id, op: 'kick', pid: x.pid.dan }), 'before the start'); assert.ok(!r.j.game.members.some((m) => m.name === 'Dan')); assert.strictEqual((await call('dan', 'get', { id })).s, 404);
  ok(await call('zed', 'join', { code: x.code })); ok(await call('yan', 'join', { code: x.code })); ok(await call('ann', 'start', { id })); assert.strictEqual((await call('bob', 'leave', { id })).s, 409, 'a player cannot walk out of a started round'); ok(await call('yan', 'leave', { id }), 'someone who only joined can leave after the start'); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1], 3); await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1], 3); const zed = (await board(id)).members.find((m) => m.name === 'Zed').pid;
  assert.strictEqual((await call('bob', 'team', { id, op: 'kick', pid: zed, reason: 'not here' })).s, 403, 'only the organizer'); NOW += 5 * 60e3; r = await call('ann', 'team', { id, op: 'kick', pid: zed, reason: 'not here' }); assert.strictEqual(r.s, 202, '5 minutes in: under the rule'); assert.ok(!who(r).includes('Zed'), 'round 5: an account that plays nothing never signs'); ok(await call('ann', 'sign', { id, n: r.j.n, ok: false }));
  NOW += 6 * 60e3; r = ok(await call('ann', 'team', { id, op: 'kick', pid: zed, reason: 'never showed up' }), '11 minutes in, no hole played'); assert.ok(!r.j.game.members.some((m) => m.name === 'Zed')); assert.ok((await call('bob', 'get', { id })).j.game.notices.some((n) => /Ann: remove Zed from the game\. Reason: never showed up/.test(n.text)), 'every player is told');
  r = await call('ann', 'team', { id, op: 'kick', pid: x.pid.cat, reason: 'walked off' }); assert.strictEqual(r.s, 202, 'Cat has played holes'); assert.deepStrictEqual(who(r), ['Cat']); assert.strictEqual((await call('bob', 'sign', { id, n: r.j.n })).s, 403); assert.strictEqual(r.j.game.payout.pot, 30);
  r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.deepStrictEqual([r.j.game.payout.pot, r.j.game.board.rows.length, r.j.game.day.teams.some((t) => t.tid === 'T3')], [20, 2, false], 'the pot and the board are worked out again without her');
});
chk('M3 a waiting request belongs to the person who asked: nobody else\'s request replaces it or pushes it off the list', async () => {
  const { id, pid } = await three(); let r = await call('bob', 'score', { id, tid: 'T2', hole: 1, p: { [pid.bob]: 3 } }); assert.strictEqual(r.s, 202); const nB = r.j.n;
  r = await call('ann', 'score', { id, tid: 'T2', hole: 1, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(r.j.game.pending.map((q) => q.by).sort(), ['Ann', 'Bob'], 'both wait');
  for (let k = 0; k < 3; k++) for (let h = 1; h <= 18; h++) await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: 2 + k } }); r = await call('ann', 'score', { id, tid: 'T3', hole: 1, p: { [pid.cat]: 9 } });
  const g = await board(id); assert.ok(g.pending.some((q) => q.n === nB), 'Bob\'s request is still there after the organizer asked for many more'); assert.ok(g.pending.filter((q) => q.by === 'Ann').length <= 40);
  r = ok(await call('ann', 'sign', { id, n: nB }), 'and it can still be signed'); assert.strictEqual(r.j.game.day.scores.T2[1].p[pid.bob], 3); assert.ok(!r.j.game.pending.some((q) => q.tid === 'T2' && q.hole === 1), 'the organizer\'s request for the hole that moved is dropped');
});
chk('M4 the signer sees old → new for every rule that changes (also the match settings); a newer request of the same person replaces her older one', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross', extras: { skins: { on: true, amt: 5 } }, hu: { on: true, kind: 'team', type: 'match', amt: 0, pct: 90 } }), id = x.id;
  let r = await call('ann', 'setup', { id, day: { net: 'gross', extras: { skins: { on: true, amt: 500 } }, hu: { on: true, kind: 'team', type: 'match', amt: 0, pct: 50, offLow: false } } }); assert.strictEqual(r.s, 202); const t = r.j.game.pending[0].text;
  assert.ok(/skins \$5 → \$500/.test(t) && /match handicap percent 90% → 50%/.test(t) && /strokes off the low player on → off/.test(t), t);
  r = await call('ann', 'paid', { id, pid: x.pid.bob, paid: false }); // (set-up: the paid list is still the organizer's)
  r = await call('ann', 'setup', { id, day: { net: 'gross', extras: { skins: { on: true, amt: 500 } }, hu: { on: true, kind: 'team', type: 'match', amt: 0, pct: 90 } } }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.pending.length, 1, 'her newer request replaces her own older one'); assert.ok(!/match handicap/.test(r.j.game.pending[0].text));
  r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.extras.skins.amt, 500);
});
chk('M5 naming or removing a co-organizer is logged and announced, and is refused while that person has a request or a signature waiting', async () => {
  const { id, pid } = await three(); let r = ok(await call('ann', 'team', { id, op: 'co', pid: pid.cat })); assert.ok(r.j.game.plog.some((p) => p.kind === 'co' && /name Cat co-organizer/.test(p.text))); assert.ok((await call('bob', 'get', { id })).j.game.notices.some((n) => /Ann: name Cat co-organizer/.test(n.text)));
  r = await call('ann', 'score', { id, tid: 'T1', hole: 1, p: { [pid.ann]: 2 } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob'], 'a fellow organizer does not sign');
  r = await call('ann', 'team', { id, op: 'co', pid: pid.cat, on: false }); assert.strictEqual(r.s, 409, 'removing Cat now would make her a signer of the waiting request'); r = await call('ann', 'team', { id, op: 'co', pid: pid.bob }); assert.strictEqual(r.s, 409, 'nor can the one who could sign be made co-organizer'); assert.strictEqual(r.j.pending, true);
});
chk('Sign all handicaps: one signer reviews the list and signs every waiting handicap in one action; each one is still logged', async () => {
  const N = ['ann', 'bob', 'cat', 'dan', 'eve'], { id, pid } = await mk(N, { net: 'net' }); for (const [w, v] of [['bob', 10], ['cat', 12], ['dan', 14]]) assert.strictEqual((await call(w, 'team', { id, op: 'hcp', pid: pid[w], hcp: v })).s, 202);
  let g0 = (await call('ann', 'get', { id })).j.game; assert.ok([pid.bob, pid.cat, pid.dan].every((p) => g0.day.hreq[p].raise === true && g0.day.hreq[p].canOk === true), 'round 5: the list shows each one raises, and that she may sign it');
  let r = ok(await call('ann', 'signall', { id }), 'the organizer plays on another team and gains nothing: her one Sign all IS the second signature'); assert.strictEqual(r.j.signed, 3); assert.deepStrictEqual([r.j.game.day.hi[pid.bob].used, r.j.game.day.hi[pid.cat].used, r.j.game.day.hi[pid.dan].used], [10, 12, 14]); assert.strictEqual(r.j.game.plog.filter((p) => p.kind === 'hcp' && p.st === 'signed' && p.sig === 'Ann').length, 3, 'each one is in the log');
  assert.strictEqual((await call('eve', 'signall', { id })).s, 409, 'nothing left to sign');
});
chk('H5 a finished pick-six pool keeps its final standings on the game and never needs the tour feed again', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'Six', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' }, pot: { entry: 10 } })); const id = r.j.game.id, T = r.j.game.tiers; ok(await call('bob', 'join', { code: r.j.game.code }));
  const g0 = (await call('ann', 'get', { id })).j.game; for (const [w, k] of [['ann', 1], ['bob', 0]]) ok(await call(w, 'pick', { id, picks: T.map((t) => t[k]) })); for (const m of g0.members) ok(await call('ann', 'paid', { id, pid: m.pid, paid: true }));
  NOW = TEE + 5 * 864e5; W.done = true; await call('ann', 'get', { id }); const feed = D.feed, dead = { events: async () => { throw new Error('down'); }, board: async () => { throw new Error('feed gone'); } };
  D.feed = dead; try { r = ok(await call('bob', 'get', { id })); assert.deepStrictEqual([r.j.game.entries[0].name, r.j.game.entries[0].payout], ['Bob', 20], 'seen final once, then the feed dies: the board is still there'); } finally { D.feed = feed; }
  NOW += 11 * 60e3; r = ok(await call('ann', 'get', { id })); const win = r.j.game.entries[0]; assert.deepStrictEqual([win.name, win.payout], ['Bob', 20]);
  D.feed = dead; NOW += 30 * 864e5;
  try { r = ok(await call('bob', 'get', { id })); assert.deepStrictEqual([r.j.game.entries[0].name, r.j.game.entries[0].payout, r.j.game.entries.length, r.j.game.feed.ok], ['Bob', 20, 2, true], '30 days later with the feed gone: the same board'); } finally { D.feed = feed; }
});
chk('H6 one and done: a "final" reading is kept only after two matching reads 10 minutes apart; the organizer can refresh it under the rule for 48 hours', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'OAD', pro: { tour: 'pga', game: 'oad' }, pot: { entry: 10 } })); const id = r.j.game.id; ok(await call('bob', 'join', { code: r.j.game.code })); ok(await call('ann', 'pick', { id, event: 'E1', golfer: 'p2' })); ok(await call('bob', 'pick', { id, event: 'E1', golfer: 'p1' }));
  const ev = async (w) => (await call(w || 'ann', 'get', { id })).j.game.oad.events.find((e) => e.id === 'E1'), feed = D.feed, real = feed.board; NOW = TEE + 5 * 864e5; W.done = true;
  // a bad first reading: the two golfers the wrong way round
  D.feed = Object.assign({}, feed, { board: async (t, e) => { const b = await real(t, e); const a = b.golfers.find((g) => g.id === 'p1'), c = b.golfers.find((g) => g.id === 'p2'); a.pos = '2'; c.pos = '1'; return b; } });
  try { assert.strictEqual((await ev()).res, null, 'first read: not kept'); NOW += 60e3; assert.strictEqual((await ev()).res, null, 'a minute later: still not'); D.feed = feed; NOW += 11 * 60e3; assert.strictEqual((await ev()).res, null, 'the reading changed: the clock starts again'); NOW += 11 * 60e3; const e = await ev(); assert.ok(e.res && e.res.p1 > e.res.p2, 'two matching reads: kept, and it is the right one'); } finally { D.feed = feed; }
  D.feed = Object.assign({}, feed, { board: async (t, e) => { const b = await real(t, e); b.golfers.find((g) => g.id === 'p1').pos = '3'; b.golfers.find((g) => g.id === 'p3').pos = '1'; return b; } });
  try { assert.strictEqual((await call('bob', 'oadrefresh', { id, event: 'E1' })).s, 403); r = await call('ann', 'oadrefresh', { id, event: 'E1' }); assert.strictEqual(r.s, 202, 'she has an entry: the refresh waits'); assert.ok(/refresh the result of Test Classic from the tour feed: Golfer 01 \d+ → \d+/.test(r.j.game.pending[0].text), r.j.game.pending[0].text);
    r = ok(await call('bob', 'sign', { id, n: r.j.n })); const e = r.j.game.oad.events.find((q) => q.id === 'E1'); assert.ok(e.res.p1 < 100); NOW += 49 * 3600e3; r = await call('ann', 'oadrefresh', { id, event: 'E1' }); assert.strictEqual(r.s, 409); assert.ok(/48 hours/.test(r.j.error)); } finally { D.feed = feed; }
});
chk('9-hole handicap: one rounding only, right for every index from 0.0 to 54.0', async () => {
  let n = 0; for (const [slope, cr9, par9] of [[113, 35.0, 36], [125, 35.6, 36], [131, 36.4, 35], [98, 33.1, 36], [155, 37.9, 36]]) { const course = { par: [4, 4, 3, 5, 4, 4, 3, 4, 5].map((p, i) => (i === 0 ? p + par9 - 36 : p)), slope, rating: cr9 };
    for (let k = 0; k <= 540; k++) { const idx = k / 10, exact = (idx / 2) * (slope / 113) + (cr9 - par9), frac = Math.abs(exact - Math.floor(exact) - 0.5); if (frac < 1e-6) continue; const want = Math.round(exact), got = S.playHcp(S.courseHcp(idx, course), 100, 9); assert.strictEqual(got, want, 'index ' + idx + ' slope ' + slope + ': ' + got + ' not ' + want); n++; } }
  assert.ok(n > 2600); assert.strictEqual(S.courseHcp(12.4, { par: PAR, slope: 125, rating: 71.2 }), 13, 'an 18-hole course handicap is still a whole number');
});
chk('Skins when a team withdraws: skins already won stand and the rest carry among the remaining teams (default); set-up option "void" takes the team out', async () => {
  const run = async (wd) => { fresh(); const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross', extras: { skins: { on: true, amt: 5, wd } } }), id = x.id; ok(await call('ann', 'start', { id }));
    await card('ann', id, 'T1', x.pid.ann, (h) => PAR[h - 1], 4); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1], 4); await card('cat', id, 'T3', x.pid.cat, (h) => (h === 1 ? PAR[0] - 1 : h === 2 ? PAR[1] : PAR[h - 1] + (h === 3 ? 0 : 1)), 3); // Cat wins hole 1, ties hole 2, ties hole 3, then walks off
    NOW += 6 * 3600e3; ok(await sg(await call('ann', 'team', { id, op: 'withdraw', tid: 'T3', reason: 'walked off' }), id)); ok(await call('ann', 'score', { id, tid: 'T1', hole: 4, p: { [x.pid.ann]: PAR[3] - 1 }, rev: 1 })); return (await board(id)).board.skins; };
  let s = await run(); const c1 = Object.keys(s.won); assert.strictEqual(s.wd, 'stand'); assert.strictEqual(s.holes[0].win != null && s.won[s.holes[0].win], 1, 'the skin Cat won on hole 1 stands'); assert.strictEqual(s.holes[3].skins, 3, 'holes 2, 3 and 4 ride to hole 4, played without her'); assert.strictEqual(c1.length, 2);
  s = await run('void'); assert.strictEqual(s.wd, 'void'); assert.strictEqual(s.holes[0].win, null, 'void: her hole 1 skin is gone (the others tied it)'); assert.strictEqual(s.holes[3].skins, 4);
});
chk('Golf alone (no stats module): an Enterprise NET tournament starts on the director\'s numbers (no 503), with its own log', async () => {
  noStats(); db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset();
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club net', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net' }, pot: { entry: 0 } })); const id = r.j.game.id; r = ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T1' })); const bob = r.j.game.me; r = ok(await call('cat', 'join', { code: r.j.game.code, tid: 'T2' })); const cat = r.j.game.me;
  assert.strictEqual((await call('club', 'start', { id })).s, 409, 'no numbers yet'); r = ok(await sg(await call('club', 'team', { id, op: 'hcp', pid: bob, hcp: 12, reason: 'club card' }), id), 'the director sets it (round 5: a raise, Cat signs)'); assert.deepStrictEqual([r.j.game.day.hi[bob].used, r.j.game.day.hi[bob].src], [12, 'tournament']);
  ok(await sg(await call('club', 'team', { id, op: 'hcp', pid: cat, hcp: 20.5, reason: 'club card' }), id)); r = ok(await call('club', 'start', { id })); assert.deepStrictEqual([r.j.game.day.status, r.j.game.day.hi[bob].used, r.j.game.day.hi[cat].used], ['live', 12, 20.5], 'the numbers survive the start');
  assert.deepStrictEqual(r.j.game.day.hlog.map((x) => [x.name, x.new, x.reason]).sort(), [['Bob', 12, 'club card'], ['Cat', 20.5, 'club card']]);
});
chk('M1 My courses: the course used last and the home course are kept on the server by course id', async () => {
  let r = ok(await call('ann', 'courses', {})); assert.deepStrictEqual(r.j.my, { home: null, recent: [] }); r = ok(await call('ann', 'mycourse', { op: 'use', course: COURSE })); const cid = r.j.id; assert.ok(cid); assert.strictEqual(r.j.my.recent[0].name, 'Test CC');
  r = ok(await call('ann', 'mycourse', { op: 'use', course: Object.assign({}, COURSE, { name: 'Other GC', rating: null, slope: null }) })); assert.deepStrictEqual(r.j.my.recent.map((c) => c.name), ['Other GC', 'Test CC'], 'rating and slope are optional');
  r = ok(await call('ann', 'mycourse', { op: 'home', courseId: cid })); assert.deepStrictEqual([r.j.my.home.name, r.j.my.recent.map((c) => c.name)], ['Test CC', ['Other GC']]); assert.deepStrictEqual((await call('bob', 'courses', {})).j.my, { home: null, recent: [] }, 'each account has its own');
  r = ok(await call('ann', 'create', { kind: 'day', title: 'Home', courseId: cid, day: { fmt: 'stroke', teams: 2, teamSize: 1 }, pot: { entry: 0 } })); assert.strictEqual(r.j.game.day.course.name, 'Test CC', 'a game is created from the id alone'); assert.strictEqual((await call('ann', 'mycourse', { op: 'home', courseId: 'NOPE' })).s, 404);
});
const board0 = async (w, id) => (await call(w, 'get', { id })).j.game;

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0], list = process.argv.includes('--list'); let bad = 0;
  if (list) { CHECKS.forEach(([n], i) => console.log(i + '\t' + n)); return; }
  for (let i = 0; i < CHECKS.length; i++) { if (only != null && Number(only) !== i) continue; const [name, fn] = CHECKS[i]; fresh();
    try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 300)); } }
  console.log(bad ? '\n' + bad + ' OF ' + CHECKS.length + ' ROUND 4 CHECKS FAILED' : '\nALL ' + CHECKS.length + ' ROUND 4 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
