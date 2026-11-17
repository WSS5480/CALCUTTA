// Golf review round 6 (Nov 17 2026): THE DIRECTION RULE replaces the benefit test. One check per numbered item of the manager's brief (each fails on
// aa1e60e and passes here), the reviewer's X1-X6, the Medium items, and the honest-play guards. No network, no database (in-memory fakes).
// Run: node odds-api/golf.round6.test.js [--list | <number>]     Proof: OLD=aa1e60e TEST=golf.round6.test.js python3 scripts/golf-proof.py
'use strict';
const assert = require('assert'), { Readable } = require('stream');
const ROOT = process.env.GOLF_ROOT || __dirname + '/';
const G = require(ROOT + 'golf'), D = G._deps, FS = require(ROOT + 'golf.fakestats');
let db = {}, slowLo = 0, slowHi = 0;
const wait = () => (slowHi ? new Promise((r) => setTimeout(r, slowLo + Math.random() * (slowHi - slowLo))) : Promise.resolve());
D.S = { dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; }, dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
const ACC = (w) => w + '@phone.oddable', NEWACCT = new Set();
D.acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, since: async (e) => (NEWACCT.has(String(e).split('@')[0]) ? Date.parse('2026-11-18T12:00:00Z') : Date.parse('2025-01-01T00:00:00Z')), /* sign-up stamps: NEWACCT = accounts made today (the bar is 1 day, owner GOLF-AGE) */ isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
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
const fresh = () => { db = {}; G._reset(); NEWACCT.clear(); FS.install(G, {}); GROUPS = null; NOW = Date.parse('2026-11-18T18:00:00Z'); W.done = false; slowLo = slowHi = 0; };
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
const H = 3600e3, pend = (r) => (r.j.game ? r.j.game.pending.length : 0), M = 60e3;
const quiet = (r, m) => { ok(r, m); assert.strictEqual(pend(r), 0, (m || '') + ': nothing waits for a signature'); assert.strictEqual(((r.j.game || {}).harm || []).length, 0, (m || '') + ': nothing to object to'); return r; };
const four = async (cards, opt) => { const N = ['ann', 'bob', 'cat', 'dan'], x = await mk(N, { net: 'gross' }, Object.assign({ entry: 10 }, (opt || {}).pot), { nT: 4 }), id = x.id; await nums(N, id, x.pid); ok(await call('ann', 'start', { id }));
  for (let i = 0; i < 4; i++) await card(N[i], id, 'T' + (i + 1), x.pid[N[i]], cards[i], (opt || {}).to); ok(await conf('bob', id, 'T1')); ok(await conf('cat', id, 'T2')); ok(await conf('dan', id, 'T3')); ok(await conf('ann', id, 'T4')); return x; };

chk('1 DIRECTION (X1): lowering your own confirmed holes one at a time needs another team each time; every other team is told with the running total and can object, after Final too (the round reopens)', async () => {
  const x = await three({ net: 'gross' }, { annTo: 9, bobTo: 9 }), id = x.id, pid = x.pid; let r;
  for (const h of [1, 2, 3, 4, 5, 6, 7, 8]) { r = await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: PAR[h - 1] }, eid: 'x1' + h }); assert.strictEqual(r.s, 202, 'hole ' + h); assert.ok(!who(r).includes('Ann'));
    assert.ok(r.j.game.notices.some((n) => n.kind === 'harm' && new RegExp('Ann has lowered ' + h + ' hole').test(n.text)), 'told at once, with the running total'); ok(await call('cat', 'sign', { id, n: r.j.n })); }
  let gb = (await call('bob', 'get', { id })).j.game; assert.ok(gb.notices.some((n) => /Ann has lowered 8 holes by 8 strokes since they were confirmed/.test(n.text)), 'X1: "Ann has lowered 8 holes by 8 strokes since they were confirmed"');
  assert.strictEqual(gb.harm.filter((e) => e.canObject).length, 8, 'Bob can object to each one'); assert.ok(gb.harm.every((e) => e.sides.join() === 'Team 2'), 'Cat signed, so the team left to object is Team 2');
  for (let h = 10; h <= 18; h++) { ok(await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: PAR[h - 1] - (h === 10 ? 1 : 0) }, eid: 'a' + h })); ok(await call('bob', 'score', { id, tid: 'T2', hole: h, p: { [pid.bob]: PAR[h - 1] + (h === 10 ? 1 : 0) }, eid: 'b' + h })); }
  ok(await conf('bob', id, 'T1')); ok(await conf('cat', id, 'T2')); r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Ann 30', 'what the eight changes would pay');
  NOW += 10 * M; r = ok(await call('bob', 'object', { id, h: gb.harm[7].h }), 'inside 30 minutes, after Final'); assert.ok(r.j.reopened); assert.strictEqual(r.j.game.day.status, 'live', 'the round reopens by itself'); assert.ok(r.j.game.day.reopens[0].auto);
  for (const e of gb.harm.slice(0, 7)) ok(await call('bob', 'object', { id, h: e.h })); r = ok(await call('ann', 'final', { id }));
  assert.ok([1, 2, 3, 4, 5, 6, 7, 8].every((h) => r.j.game.day.scores.T1[h].p[pid.ann] === PAR[h - 1] + 1), 'all eight put back'); assert.ok(r.j.game.payout.contested, 'nobody upheld them and Ann still claims them: contested, players settle it');
  assert.strictEqual(paidOut(r.j.game), '', 'no winner is named for the contested pot');
  for (const e of gb.harm) ok(await call('ann', 'uphold', { id, h: e.h, drop: true }), 'Ann withdraws her changes'); r = await board(id); assert.strictEqual(paidOut(r), 'Bob 30');
});
chk('2 BETS (X6): a money match added after the start needs BOTH sides, whoever proposes it', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], x = await mk(N, { net: 'gross', heads: { on: true, kind: 'player', type: 'match', amt: 50 } }, { entry: 10 }, { orgOut: true, nT: 3, tOf: (i) => 'T' + i }), id = x.id, pid = x.pid;
  ok(await call('ann', 'start', { id })); await card('dan', id, 'T3', pid.dan, (h) => PAR[h - 1], 2);
  let r = await call('ann', 'match', { id, op: 'add', a: pid.bob, b: pid.cat }); assert.strictEqual(r.s, 202, 'X6: was 200 alone'); assert.strictEqual(r.j.game.day.matches.length, 0); assert.deepStrictEqual(who(r), ['Bob', 'Cat']);
  assert.strictEqual((await call('dan', 'sign', { id, n: r.j.n })).s, 403, 'not a bystander'); r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.ok(r.j.partial, 'one side is not enough'); assert.strictEqual(r.j.game.day.matches.length, 0);
  r = ok(await call('cat', 'sign', { id, n: r.j.game.pending[0].n })); assert.strictEqual(r.j.game.day.matches.length, 1, 'both sides signed');
  r = await call('ann', 'match', { id, op: 'remove', mid: r.j.game.day.matches[0].mid }); assert.strictEqual(r.s, 202, 'removing it too'); assert.deepStrictEqual(who(r), ['Bob', 'Cat']);
});
chk('3 OBJECTIONS AND FINAL (X4): a higher score for another team is signed by that team only; its "no" can be overruled by two other teams; Final waits 15 minutes; objections stay open 30 minutes past Final', async () => {
  const x = await four([(h) => PAR[h - 1] + 1, (h) => PAR[h - 1], (h) => PAR[h - 1] + 3, (h) => PAR[h - 1] + 4]), id = x.id, pid = x.pid;
  let r = await call('ann', 'score', { id, tid: 'T2', hole: 5, p: { [pid.bob]: PAR[4] + 2 } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob']); const n = r.j.n;
  assert.strictEqual((await call('cat', 'sign', { id, n })).s, 403, 'X4: a friend on another team cannot sign it (was 200)');
  r = ok(await call('bob', 'sign', { id, n, ok: false })); assert.strictEqual(r.j.game.pending[0].dec, 'Bob', 'Bob said no: it stays, visible'); assert.strictEqual(r.j.game.day.scores.T2[5].p[pid.bob], PAR[4]);
  assert.strictEqual((await call('ann', 'uphold', { id, n })).s, 403, 'not the team that asked'); r = ok(await call('cat', 'uphold', { id, n })); assert.ok(r.j.partial); r = ok(await call('dan', 'uphold', { id, n }), 'a second team: the result does not depend on who taps first');
  assert.strictEqual(r.j.game.day.scores.T2[5].p[pid.bob], PAR[4] + 2); r = await call('ann', 'final', { id }); assert.strictEqual(r.s, 409, 'Final waits 15 minutes after a change made a team worse without its signature'); assert.ok(r.j.holdUntil);
  NOW += 16 * M; ok(await call('ann', 'final', { id }));
  // objections past Final: Bob lowers two of his own holes, Cat signs, Ann finishes at once; Ann objects 10 minutes later and the round reopens; 40 minutes later it is too late
  fresh(); const y = await three({ net: 'gross' }); for (const h of [3, 4]) { r = await call('bob', 'score', { id: y.id, tid: 'T2', hole: h, p: { [y.pid.bob]: PAR[h - 1] - 1 } }); assert.strictEqual(r.s, 202); ok(await call('cat', 'sign', { id: y.id, n: r.j.n })); }
  r = ok(await call('ann', 'final', { id: y.id }), 'a change that helps a team does not hold Final'); const hs = (await call('ann', 'get', { id: y.id })).j.game.harm; assert.strictEqual(hs.length, 2);
  NOW += 10 * M; r = ok(await call('ann', 'object', { id: y.id, h: hs[0].h })); assert.deepStrictEqual([r.j.game.day.status, r.j.game.day.scores.T2[4].p[y.pid.bob]], ['live', PAR[3]], 'reopened and put back');
  NOW += 30 * M; r = await call('ann', 'object', { id: y.id, h: hs[1].h }); assert.strictEqual(r.s, 200, 'round 7 fix 1: the round is open again, so a change to a confirmed hole can still be objected to');
});
chk('4 NO REFEREE (X3): 18 fake birdies confirmed by a friend and disputed by another team: the places they decide are CONTESTED, both numbers shown, no winner named; uncontested places still pay; disputes stay open 30 minutes after Final', async () => {
  const x = await four([(h) => PAR[h - 1] - (h <= 5 ? 1 : 0), (h) => PAR[h - 1] - 1, (h) => PAR[h - 1] + (h <= 3 ? 1 : 0), (h) => PAR[h - 1] + (h <= 6 ? 1 : 0)], { pot: { split: '50 30 20' } }), id = x.id, pid = x.pid;
  for (let h = 1; h <= 18; h++) ok(await call('ann', 'dispute', { id, tid: 'T2', hole: h, note: 'he made par', want: { p: { [pid.bob]: PAR[h - 1] } } }));
  let r = await call('cat', 'resolve', { id, tid: 'T2', hole: 1, p: { [pid.bob]: PAR[0] } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob'], 'only Bob can concede it');
  r = ok(await call('ann', 'final', { id })); const g = r.j.game; assert.ok(g.payout.contested, 'contested'); assert.ok(/Contested — players settle this themselves/.test(g.payout.contested.note));
  assert.deepStrictEqual(g.payout.paid.map((p) => p.name + ' ' + p.amt), ['Cat 8'], 'X3: no "Bob 20"; the third place is the same either way and pays');
  const row = g.board.rows.find((y) => y.tid === 'T2'); assert.ok(row.contested && row.alt && row.alt.some((a) => a.toParG === 0), 'the board shows both numbers'); assert.ok(g.board.rows.find((y) => y.tid === 'T1').contested);
  NOW += 20 * M; assert.strictEqual((await call('dan', 'dispute', { id, tid: 'T3', hole: 1, note: 'was a 5', want: { p: { [pid.cat]: PAR[0] + 3 } } })).s, 403, 'round 7 fix 5: Dan confirmed that card'); ok(await call('bob', 'dispute', { id, tid: 'T3', hole: 1, note: 'was a 5', want: { p: { [pid.cat]: PAR[0] + 3 } } }), 'any other team can dispute a confirmed hole until 30 minutes after Final');
  NOW += 11 * M; assert.strictEqual((await call('bob', 'dispute', { id, tid: 'T3', hole: 2, note: 'was a 5', want: { p: { [pid.cat]: PAR[1] + 3 } } })).s, 409, 'not after');
});
chk('5 REMOVED PLAYERS AND SIGNERS (X2, X5): removal takes the player\'s own signature (or, unreachable after the expected finish, two other teams); the removed keep a read-only seat and object; signers must be established', async () => {
  const x = await four([(h) => PAR[h - 1], (h) => PAR[h - 1] + 1, (h) => PAR[h - 1] + 2, (h) => PAR[h - 1] + 3], { to: 9 }), id = x.id; let r = await call('ann', 'team', { id, op: 'kick', pid: x.pid.dan, reason: 'rules' });
  assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Dan']); assert.strictEqual((await call('bob', 'sign', { id, n: r.j.n })).s, 403, 'X2: was 200'); r = ok(await call('dan', 'sign', { id, n: r.j.n, ok: false })); assert.strictEqual(pend(r), 0, 'his no ends it');
  NOW += 6 * H; r = await call('ann', 'team', { id, op: 'kick', pid: x.pid.dan, reason: 'went home, phone off' }); assert.strictEqual(r.s, 202); const nk = r.j.n; r = ok(await call('bob', 'sign', { id, n: nk })); assert.ok(r.j.partial, 'after the expected finish: two other teams'); r = ok(await call('cat', 'sign', { id, n: nk }));
  assert.ok(!r.j.game.day.teams.some((t) => t.tid === 'T4'), 'his one-player team goes with him'); r = await call('dan', 'get', { id }); ok(r, 'a read-only seat'); assert.strictEqual(r.j.game.role, 'ro'); const e = r.j.game.harm.find((y) => y.canObject); assert.ok(e, 'he can object');
  assert.strictEqual((await call('dan', 'score', { id, tid: 'T4', hole: 10, p: { [x.pid.dan]: 4 } })).s, 404, 'read-only'); r = ok(await call('dan', 'object', { id, h: e.h })); assert.ok(r.j.game.day.teams.find((t) => t.tid === 'T4').players.some((p) => p.pid === x.pid.dan), 'Dan is back'); assert.strictEqual(Object.keys(r.j.game.day.scores.T4).length, 9, 'with his card');
  // X5: the organizer's second phone (a day-old account) cannot sign
  fresh(); NEWACCT.add('ann2'); const N = ['ann', 'bob', 'ann2'], y = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 3 }); await nums(N, y.id, y.pid); ok(await call('ann', 'start', { id: y.id }));
  await card('ann', y.id, 'T1', y.pid.ann, (h) => PAR[h - 1] + 1, 2); ok(await conf('bob', y.id, 'T1')); r = await call('ann', 'score', { id: y.id, tid: 'T1', hole: 1, p: { [y.pid.ann]: PAR[0] } }); assert.deepStrictEqual(who(r), ['Bob'], 'not the new account');
  r = await call('ann2', 'sign', { id: y.id, n: r.j.n }); assert.strictEqual(r.s, 403); assert.ok(/signer too new/.test(r.j.error), r.j.error);
  // with the stats module: its co-sign test decides (signerCheck)
  // round 7 fix 3: with the stats module its sign-up stamp (sinceOf) is used, at the ONE bar (1 day, owner GOLF-AGE)
  D.stats().sinceOf = async (e) => ({ known: true, t: /^bob@/.test(e) ? NOW - 12 * 3600e3 : Date.parse('2025-01-01T00:00:00Z') }); G._reset(); r = await call('bob', 'sign', { id: y.id, n: (await board(y.id)).pending[0].n }); delete D.stats().sinceOf;
  assert.strictEqual(r.s, 403); assert.ok(/less than 1 day old/.test(r.j.error), r.j.error);
});
chk('6 ENTERPRISE: the director who plays nothing sets numbers and settles disputes alone; a playing director cannot; players object before Start (logged, director decides); every number is shown to all, beside the Oddable number', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net' }, pot: { entry: 0 } })); const id = r.j.game.id, code = r.j.game.code, me = r.j.game.me;
  const P = {}; for (const [w, t] of [['bob', 'T1'], ['cat', 'T2']]) { r = ok(await call(w, 'join', { code, tid: t })); P[w] = r.j.game.me; } r = await call('club', 'team', { id, op: 'assign', pid: me, tid: 'T3' }); assert.strictEqual(r.s, 409, 'round 7 fix 2: the director never plays'); assert.ok(r.j.director);
  r = ok(await call('club', 'team', { id, op: 'hcp', pid: P.bob, hcp: 12, reason: 'club card' }), 'alone'); ok(await call('club', 'team', { id, op: 'hcp', pid: P.cat, hcp: 20, reason: 'club card' }));
  r = ok(await call('bob', 'team', { id, op: 'hcpobject', pid: P.bob, note: 'I am a 14 now' })); assert.strictEqual(r.j.game.day.hobj[P.bob][0].note, 'I am a 14 now');
  r = (await call('club', 'get', { id })).j.game; assert.ok(r.notices.some((n) => /Bob objects to Bob's tournament handicap: I am a 14 now\. The director decides\./.test(n.text))); assert.ok(r.day.audit.some((a) => a.what === 'handicap objection'));
  const gc = (await call('cat', 'get', { id })).j.game; assert.strictEqual(gc.day.hlog.length, 2, 'every number is shown to every player'); assert.ok(/Oddable: no rounds yet · Tournament 12\.0, set by director/.test(gc.day.hi[P.bob].text), 'E-H: the Oddable number shows beside it');
  ok(await call('club', 'start', { id })); await card('bob', id, 'T1', P.bob, (h) => PAR[h - 1], 2); await card('cat', id, 'T2', P.cat, (h) => PAR[h - 1], 2); ok(await conf('cat', id, 'T1'));
  ok(await call('cat', 'dispute', { id, tid: 'T1', hole: 1, note: 'was a 5', want: { p: { [P.bob]: 5 } } })); r = ok(await call('club', 'resolve', { id, tid: 'T1', hole: 1, p: { [P.bob]: 5 } }), 'the director settles alone'); assert.strictEqual(r.j.game.day.scores.T1[1].p[P.bob], 5);
});
chk('M rain: "Shorten to 9" is signed by every team with a card, then the front nine counts and the round can be Final', async () => {
  const x = await three({ net: 'gross' }, { annTo: 9, bobTo: 9 }), id = x.id; let r = await call('bob', 'short9', { id }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Ann', 'Cat']); const n9 = r.j.n;
  r = ok(await call('ann', 'sign', { id, n: n9 })); assert.ok(r.j.partial); r = ok(await call('cat', 'sign', { id, n: n9 })); assert.strictEqual(r.j.game.day.course.par.length, 9); assert.ok(!r.j.game.day.scores.T3[10], 'holes 10 to 18 set aside');
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
});
chk('M late player: joins an existing team before that team has posted hole 3 (other teams told; in a money game one other team signs)', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross', teamSize: 2 }, { entry: 10 }, { nT: 3 }), id = x.id; await nums(N, id, x.pid); ok(await call('ann', 'start', { id })); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1], 2);
  let r = await call('zed', 'join', { code: x.code, tid: 'T2' }); assert.strictEqual(r.s, 202, 'was 409 "Teams are set"'); assert.ok(!who(r).includes('Bob')); r = ok(await call('cat', 'sign', { id, n: r.j.n }));
  assert.strictEqual(r.j.game.day.teams.find((t) => t.tid === 'T2').players.length, 2); assert.ok(r.j.game.notices.some((n) => /Zed joined Team 2 late/.test(n.text)));
  await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1], 3); r = await call('yan', 'join', { code: x.code, tid: 'T3' }); assert.strictEqual(r.s, 409); assert.ok(/hole 3/.test(r.j.error));
});
chk('HONEST: a typo against yourself = 1 tap; a same-minute typo fix in your favour = ONE signature; a 3-team $10 gross game played honestly has no prompt after the start', async () => {
  const x = await three({ net: 'gross' }, { annTo: 9, bobTo: 9 }), id = x.id; let r = quiet(await call('bob', 'score', { id, tid: 'T2', hole: 3, p: { [x.pid.bob]: PAR[2] + 1 } }), 'typo against yourself');
  r = await call('bob', 'score', { id, tid: 'T2', hole: 4, p: { [x.pid.bob]: PAR[3] - 1 } }); assert.strictEqual(r.s, 202); r = ok(await call('ann', 'sign', { id, n: r.j.n })); assert.ok(r.j.done || !r.j.partial); assert.strictEqual(pend(r), 0, 'one signature was enough');
  fresh(); const N = ['ann', 'bob', 'cat'], y = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 3 }); await nums(N, y.id, y.pid); quiet(await call('ann', 'start', { id: y.id }), 'start');
  for (const [w, t, d] of [['ann', 'T1', 1], ['bob', 'T2', 0], ['cat', 'T3', 2]]) for (let h = 1; h <= 18; h++) quiet(await call(w, 'score', { id: y.id, tid: t, hole: h, p: { [y.pid[w]]: PAR[h - 1] + (h % 6 === 0 ? d : 0) } }), w + ' ' + h);
  for (const [w, t] of [['bob', 'T1'], ['cat', 'T2'], ['ann', 'T3']]) quiet(await conf(w, y.id, t), 'confirm ' + t); r = quiet(await call('ann', 'final', { id: y.id }), 'final'); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
});
(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0], list = process.argv.includes('--list'); let bad = 0;
  if (list) { CHECKS.forEach(([n], i) => console.log(i + '\t' + n)); return; }
  for (let i = 0; i < CHECKS.length; i++) { if (only != null && Number(only) !== i) continue; const [name, fn] = CHECKS[i]; fresh(); D.handicapFor = D0.handicapFor;
    try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 300)); } }
  console.log(bad ? '\n' + bad + ' OF ' + CHECKS.length + ' ROUND 6 CHECKS FAILED' : '\nALL ' + CHECKS.length + ' ROUND 6 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
