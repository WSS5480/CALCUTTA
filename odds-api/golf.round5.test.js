// Golf review round 5 (Nov 17 2026): THE TWO STRUCTURAL TESTS (benefit test, harmed party) and N1 to N6, plus the usability guard (honest play
// stays easy). No network, no database (in-memory fakes). One check per item; each N check fails on 13f503e and passes here.
// Run: node odds-api/golf.round5.test.js [--list | <number>]     Proof: OLD=13f503e TEST=golf.round5.test.js python3 scripts/golf-proof.py
'use strict';
const assert = require('assert'), { Readable } = require('stream');
const ROOT = process.env.GOLF_ROOT || __dirname + '/';
const G = require(ROOT + 'golf'), D = G._deps, FS = require(ROOT + 'golf.fakestats');
let db = {}, slowLo = 0, slowHi = 0;
const wait = () => (slowHi ? new Promise((r) => setTimeout(r, slowLo + Math.random() * (slowHi - slowLo))) : Promise.resolve());
D.S = { dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; }, dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
const ACC = (w) => w + '@phone.oddable';
D.acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, since: async () => Date.parse('2025-01-01T00:00:00Z'), /* v1.6: an established account (signers must be) */ isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
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


const H = 3600e3, pend = (r) => (r.j.game ? r.j.game.pending.length : 0);
// neutral Ann (no team, no card). Bob T1, Cat T2. $10 gross. Bob has `bobTo` holes (default 18), Cat 18 at +2; all confirmed.
async function neutral(bobTo) { const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { orgOut: true, nT: 2, tOf: (i) => 'T' + i }), id = x.id; ok(await call('ann', 'start', { id }));
  await card('bob', id, 'T1', x.pid.bob, (h) => PAR[h - 1], bobTo); await card('cat', id, 'T2', x.pid.cat, (h) => PAR[h - 1] + 2); ok(await conf('cat', id, 'T1')); ok(await conf('bob', id, 'T2')); return x; }

chk('N1 did not finish: never on idle time, never alone (a neutral organizer too), only after the expected finish; the team puts itself back in and keeps scoring', async () => {
  const { id, pid } = await neutral(9); NOW += 31 * 60e3; let r = await call('ann', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'walked off' });
  assert.strictEqual(r.s, 409, '31 idle minutes are not enough (was 200 alone)'); assert.ok(/expected finish/.test(r.j.error)); assert.ok(!(await board(id)).day.wd.T1);
  NOW += 5 * H; r = await call('ann', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'walked off' }); assert.strictEqual(r.s, 202, 'after the expected finish it still needs a signature, even from a neutral organizer');
  assert.ok(!who(r).includes('Cat'), 'Cat gains from it: she cannot sign'); assert.ok(r.j.game.notices.some((n) => n.kind === 'harm' && /Team 1/.test(n.text)), 'the harmed team is told at once');
  r = ok(await call('bob', 'sign', { id, n: r.j.n }), 'the team agrees'); assert.ok(r.j.game.day.wd.T1);
  r = await call('bob', 'team', { id, op: 'withdraw', tid: 'T1', on: false }); assert.strictEqual(r.s, 202, 'round 6 (direction rule): did-not-finish undone helps the team, so another team signs'); r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.ok(!r.j.game.day.wd.T1); ok(await call('bob', 'score', { id, tid: 'T1', hole: 10, p: { [pid.bob]: 4 } }), 'and keeps scoring');
});
chk('N2 remove: a playing organizer cannot remove a rival alone 10 minutes in; only an account on no team with no card goes by the 10-minute rule', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 3 }), id = x.id; ok(await call('zed', 'join', { code: x.code })); ok(await call('ann', 'start', { id })); NOW += 11 * 60e3;
  let r = await call('ann', 'team', { id, op: 'kick', pid: x.pid.bob, reason: 'not here' }); assert.strictEqual(r.s, 202, 'was 200 alone'); assert.ok((await board(id)).members.some((m) => m.name === 'Bob'), 'Bob is still in');
  const zed = (await board(id)).members.find((m) => m.name === 'Zed').pid; r = ok(await call('ann', 'team', { id, op: 'kick', pid: zed, reason: 'never showed up' }), 'an account on no team, no card: the 10-minute rule'); assert.ok(!r.j.game.members.some((m) => m.name === 'Zed'));
});
chk('N3 forced Final: no team with unconfirmed holes signs; the time-out Final ranks those teams "not confirmed" only 2 h after the expected finish and after they were told', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 3 }), id = x.id; await nums(N, id, x.pid); ok(await call('ann', 'start', { id }));
  await card('ann', id, 'T1', x.pid.ann, (h) => PAR[h - 1] + 1); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1]); await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1] - 1); ok(await conf('bob', id, 'T1')); ok(await conf('ann', id, 'T2'));
  let r = await call('ann', 'final', { id, force: true, reason: 'cards signed on paper' }); assert.strictEqual(r.s, 202); assert.ok(!who(r).includes('Cat'), 'Cat\'s holes were never confirmed: Cat never signs'); assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'was 200');
  ok(await call('bob', 'sign', { id, n: r.j.n, ok: false }), 'Bob turns it down'); r = await call('ann', 'final', { id }); assert.strictEqual(r.s, 409); assert.ok(r.j.until);
  NOW += 8 * H; r = await call('ann', 'final', { id }); assert.strictEqual(r.s, 409, 'first they are told'); assert.deepStrictEqual(r.j.told, ['Team 3']); assert.ok((await call('cat', 'get', { id })).j.game.notices.some((n) => n.kind === 'harm' && /never confirmed/.test(n.text)));
  NOW += 16 * 60e3; r = ok(await call('ann', 'final', { id }), 'the time-out Final'); const g = r.j.game, c = g.board.rows.find((y) => y.tid === 'T3'); assert.deepStrictEqual([c.nc, c.place], [true, null], 'Cat ranks "not confirmed"'); assert.strictEqual(paidOut(g), 'Bob 30');
});
chk('N4 one and done: the signer of typed prize money is an entrant who does not move up; typed figures say "typed by organizer"', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'OAD', pro: { tour: 'pga', game: 'oad' }, pot: { entry: 10 } })); const id = r.j.game.id; ok(await call('bob', 'join', { code: r.j.game.code })); ok(await call('cat', 'join', { code: r.j.game.code }));
  ok(await call('bob', 'pick', { id, event: 'E1', golfer: 'p1' })); ok(await call('cat', 'pick', { id, event: 'E1', golfer: 'p9' })); NOW = TEE + 5 * 864e5; W.done = true; await call('ann', 'get', { id }); NOW += 11 * 60e3; ok(await call('ann', 'get', { id }));
  r = await call('ann', 'oadmoney', { id, event: 'E1', money: { p9: 5000000, p1: 0 } }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob'], 'only the entrant who does not move up');
  assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'Cat moves up: was 200'); r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.oad.events.find((e) => e.id === 'E1').typed, 'typed by organizer');
});
chk('N5 disputes: a confirmed hole in a money game is never settled by one person, only to one of the two numbers; unsettled at Final it stands as confirmed, flagged', async () => {
  const { id, pid } = await neutral(); let r = await call('cat', 'dispute', { id, tid: 'T1', hole: 1, note: 'wrong score' }); assert.strictEqual(r.s, 400, 'say what it should be');
  ok(await call('cat', 'dispute', { id, tid: 'T1', hole: 1, note: 'wrong score', want: { p: { [pid.bob]: 7 } } }));
  r = await call('ann', 'resolve', { id, tid: 'T1', hole: 1, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 409, 'not one of the two numbers');
  r = await call('ann', 'resolve', { id, tid: 'T1', hole: 1, p: { [pid.bob]: 7 } }); assert.strictEqual(r.s, 202, 'no referee alone (was 200)'); assert.strictEqual(r.j.game.day.scores.T1[1].p[pid.bob], PAR[0]);
  assert.deepStrictEqual(who(r), ['Bob'], 'round 6: a higher number on Team 1\'s card: Team 1\'s own player signs'); assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'round 6: the disputing team cannot sign it'); assert.strictEqual(r.j.game.day.scores.T1[1].p[pid.bob], PAR[0]);
  r = ok(await call('ann', 'final', { id }), 'an unsettled dispute does not block Final'); const h1 = r.j.game.day.scores.T1[1]; assert.deepStrictEqual([h1.st, h1.p[pid.bob]], ['disputed', PAR[0]], 'round 6 (item 4): it stays disputed'); assert.strictEqual(paidOut(r.j.game), 'Bob 20', 'it decides no place: Bob still wins by 30 either way'); assert.ok(!r.j.game.payout.contested);
});
chk('N6 handicaps: a higher number needs a player on another team who does not gain (a neutral organizer cannot OK it); a lower one needs the player; Sign all shows which ones raise', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { net: 'net' }, { entry: 10 }, { orgOut: true, nT: 2, tOf: (i) => 'T' + i }), id = x.id;
  let r = await call('cat', 'team', { id, op: 'hcp', pid: x.pid.cat, hcp: 36 }); assert.strictEqual(r.s, 202); assert.ok(r.j.game.day.hreq[x.pid.cat].raise);
  r = await call('ann', 'team', { id, op: 'hcpok', pid: x.pid.cat }); assert.strictEqual(r.s, 403, 'a neutral organizer plays nothing: she cannot OK a raise (was 200)'); assert.ok(r.j.raise);
  r = ok(await call('bob', 'team', { id, op: 'hcpok', pid: x.pid.cat }), 'Bob, on the other team, does not gain'); assert.strictEqual(r.j.game.day.hi[x.pid.cat].used, 36);
  r = ok(await call('cat', 'team', { id, op: 'hcp', pid: x.pid.cat, hcp: 30 }), 'lowering his own number counts at once'); assert.strictEqual(r.j.game.day.hi[x.pid.cat].used, 30);
  r = await call('ann', 'team', { id, op: 'hcp', pid: x.pid.cat, hcp: 20 }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Cat'], 'the organizer lowering it: the player signs');
  fresh(); const y = await mk(N, { net: 'net' }, { entry: 10 }, { nT: 3, tOf: (i) => ['T3', 'T1', 'T2'][i] }); r = await call('ann', 'team', { id: y.id, op: 'hcp', pid: y.pid.cat, hcp: 36 });
  assert.strictEqual(r.s, 202); assert.deepStrictEqual(who(r), ['Bob'], 'a playing organizer sets her friend higher: only the other team'); assert.strictEqual((await call('cat', 'sign', { id: y.id, n: r.j.n })).s, 403, 'not the friend it helps (was 200)');
});
chk('TEST 2: the harmed team objects and the change is put back; two non-gaining players from two different other teams uphold it', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], x = await mk(N, { net: 'gross' }, { entry: 10 }, { nT: 4 }), id = x.id; await nums(N, id, x.pid); ok(await call('ann', 'start', { id }));
  await card('ann', id, 'T1', x.pid.ann, (h) => PAR[h - 1] + 1); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1]); await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1] + 3); await card('dan', id, 'T4', x.pid.dan, (h) => PAR[h - 1] + 4);
  ok(await conf('bob', id, 'T1')); ok(await conf('ann', id, 'T2')); ok(await conf('dan', id, 'T3')); ok(await conf('cat', id, 'T4'));
  let r = await call('ann', 'score', { id, tid: 'T2', hole: 5, p: { [x.pid.bob]: 9 } }); assert.strictEqual(r.s, 202); assert.ok(r.j.game.pending[0].harm.includes('Team 2'));
  assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'round 6: a higher number for Team 2: only Team 2 signs'); const n = r.j.n;
  r = ok(await call('bob', 'sign', { id, n, ok: false }), 'round 6 (item 3): Bob says no; it stays, and can be overruled'); assert.strictEqual(r.j.game.pending[0].dec, 'Bob'); assert.strictEqual(r.j.game.day.scores.T2[5].p[x.pid.bob], PAR[4]);
  assert.strictEqual((await call('ann', 'uphold', { id, n })).s, 403, 'not the team that asked'); r = ok(await call('cat', 'uphold', { id, n })); assert.ok(r.j.partial); r = ok(await call('dan', 'uphold', { id, n })); assert.strictEqual(r.j.game.day.scores.T2[5].p[x.pid.bob], 9, 'two other teams overruled the no');
  r = await call('ann', 'final', { id }); assert.strictEqual(r.s, 409, 'round 6 (X4): Final waits 15 minutes after a change made a team worse without its signature'); assert.ok(r.j.holdUntil); NOW += 16 * 60e3; ok(await call('ann', 'final', { id }));
});
chk('Payout table: a rising split ("10 30 60") is refused', async () => {
  const r = await call('ann', 'create', { kind: 'day', title: 'Rising', course: COURSE, day: { fmt: 'stroke', teams: 4, teamSize: 1 }, pot: { entry: 10, split: '10 30 60' } }); assert.strictEqual(r.s, 400); assert.ok(/lower place/.test(r.j.error));
  ok(await call('ann', 'create', { kind: 'day', title: 'Falling', course: COURSE, day: { fmt: 'stroke', teams: 4, teamSize: 1 }, pot: { entry: 10, split: '60 30 10' } }));
});
// USABILITY GUARD: what honest players see. Every answer is checked: no 202, nothing waiting, nobody worse off. The only prompt allowed is ONE "Sign all".
const quiet = (r, m) => { ok(r, m); assert.strictEqual(pend(r), 0, (m || '') + ': nothing waits for a signature'); assert.strictEqual(((r.j.game || {}).harm || []).length, 0, 'nobody is worse off'); return r; };
chk('USABILITY: a normal 8-player net skins + pot day, 2 teams per group, no interventions: no signature prompts except ONE "Sign all" for the handicaps at the start', async () => {
  const USE = { ann: 8, bob: 12.4, cat: 15, dan: 20.1, fay: 4.2, gus: 18 }; D.handicapFor = async (k) => { const w = String(k).split('@')[0], v = USE[w]; return v != null ? { oddable: { index: v, rounds: 20, text: 'Oddable ' + v }, confirmedIndex: v, rounds: 20, confirmedRounds: 20, use: v } : { oddable: { index: null, rounds: 0 }, rounds: 0, use: null }; };
  const team = { ann: 'T1', bob: 'T1', cat: 'T2', eve: 'T2', dan: 'T3', hal: 'T3', fay: 'T4', gus: 'T4' }, P = {}; let r = quiet(await call('ann', 'create', { kind: 'day', title: 'Saturday', course: COURSE, day: { fmt: 'stroke', teams: 4, teamSize: 2, net: 'net', extras: { skins: { on: true, amt: 5, net: true } } }, pot: { entry: 10 } })); const id = r.j.game.id, code = r.j.game.code; P.ann = r.j.game.me;
  quiet(await call('ann', 'team', { id, op: 'assign', pid: P.ann, tid: 'T1' })); let prompts = 0;
  for (const w of ['bob', 'cat', 'eve', 'dan', 'hal', 'fay', 'gus']) { r = await call(w, 'join', Object.assign({ code, tid: team[w] }, USE[w] == null ? { hcp: w === 'eve' ? 22 : 9.5 } : {})); quiet(r, 'join ' + w); P[w] = r.j.game.me; }
  for (const w of Object.keys(P)) quiet(await call('ann', 'paid', { id, pid: P[w], paid: true }), 'paid before the start');
  let g = (await call('ann', 'get', { id })).j.game; assert.deepStrictEqual(Object.keys(g.day.hreq).sort(), [P.eve, P.hal].sort(), 'only the two new players asked for a number');
  r = quiet(await call('ann', 'signall', { id }), 'ONE Sign all'); prompts++; assert.strictEqual(r.j.signed, 2);
  quiet(await call('ann', 'start', { id }), 'start');
  const sc = (w, h) => PAR[h - 1] + ((h + w.length) % 3 === 0 ? 1 : 0) + (w === 'hal' && h === 7 ? 1 : 0), scorer = { T1: 'ann', T2: 'cat', T3: 'dan', T4: 'fay' }, pl = { T1: ['ann', 'bob'], T2: ['cat', 'eve'], T3: ['dan', 'hal'], T4: ['fay', 'gus'] };
  for (let h = 1; h <= 18; h++) for (const t of ['T1', 'T2', 'T3', 'T4']) { const p = {}; pl[t].forEach((w) => (p[P[w]] = sc(w, h))); quiet(await call(scorer[t], 'score', { id, tid: t, hole: h, p, eid: t + h }), 'score ' + t + ' ' + h); }
  for (const [w, t] of [['cat', 'T1'], ['ann', 'T2'], ['fay', 'T3'], ['dan', 'T4']]) quiet(await conf(w, id, t), 'the other team in the group confirms ' + t);
  r = quiet(await call('ann', 'final', { id }), 'final'); assert.strictEqual(r.j.game.day.status, 'final'); assert.ok(r.j.game.payout.paid.length > 0); assert.strictEqual(prompts, 1);
});
chk('USABILITY: a 4-player casual round (no money): zero prompts', async () => {
  let r = quiet(await call('ann', 'create', { kind: 'day', title: 'Casual', course: COURSE, day: { fmt: 'stroke', teams: 4, teamSize: 1, net: 'net' }, pot: { entry: 0 } })); const id = r.j.game.id, code = r.j.game.code, P = { ann: r.j.game.me };
  quiet(await call('ann', 'team', { id, op: 'assign', pid: P.ann, tid: 'T1' })); quiet(await call('ann', 'team', { id, op: 'hcp', pid: P.ann, hcp: 10 }));
  for (const [w, t] of [['bob', 'T2'], ['cat', 'T3'], ['dan', 'T4']]) { r = quiet(await call(w, 'join', { code, tid: t, hcp: 14 })); P[w] = r.j.game.me; }
  quiet(await call('ann', 'start', { id })); for (const [w, t] of [['ann', 'T1'], ['bob', 'T2'], ['cat', 'T3'], ['dan', 'T4']]) for (let h = 1; h <= 18; h++) quiet(await call(w, 'score', { id, tid: t, hole: h, p: { [P[w]]: PAR[h - 1] + (h % 4 === 0 ? 1 : 0) } }));
  r = quiet(await call('ann', 'final', { id })); assert.strictEqual(r.j.game.day.status, 'final');
});

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0], list = process.argv.includes('--list'); let bad = 0;
  if (list) { CHECKS.forEach(([n], i) => console.log(i + '\t' + n)); return; }
  for (let i = 0; i < CHECKS.length; i++) { if (only != null && Number(only) !== i) continue; const [name, fn] = CHECKS[i]; fresh(); D.handicapFor = D0.handicapFor;
    try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 300)); } }
  console.log(bad ? '\n' + bad + ' OF ' + CHECKS.length + ' ROUND 5 CHECKS FAILED' : '\nALL ' + CHECKS.length + ' ROUND 5 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
