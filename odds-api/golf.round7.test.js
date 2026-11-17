// Golf review round 7 (Nov 17 2026): the six must-fix items. The reviewer's failing cases (A1, F1, E1, B1, D1, G1 in /tmp/revgolf7/t/r7.js) as passing
// checks. Each fails on 04dfcd4 and passes here. No network, no database (in-memory fakes).
// Run: node odds-api/golf.round7.test.js [--list | <number>]     Proof: OLD=04dfcd4 TEST=golf.round7.test.js python3 scripts/golf-proof.py
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


const lower8 = async (id, pid) => { for (const h of [1, 2, 3, 4, 5, 6, 7, 8]) { const r = await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: PAR[h - 1] }, eid: 'x1' + h }); assert.strictEqual(r.s, 202); ok(await call('cat', 'sign', { id, n: r.j.n })); } };
const back9 = async (id, pid) => { for (let h = 10; h <= 18; h++) { ok(await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: PAR[h - 1] - (h === 10 ? 1 : 0) }, eid: 'a' + h })); ok(await call('bob', 'score', { id, tid: 'T2', hole: h, p: { [pid.bob]: PAR[h - 1] + (h === 10 ? 1 : 0) }, eid: 'b' + h })); } ok(await conf('bob', id, 'T1')); ok(await conf('cat', id, 'T2')); };
const harmOf = async (w, id) => (await call(w, 'get', { id })).j.game.harm || [];

chk('1 (A1) changes to confirmed holes stay open to objection until 30 minutes after Final; the Final row and the Final notice say "Ann lowered 8 confirmed holes by 8"', async () => {
  let x = await three({ net: 'gross' }, { annTo: 9, bobTo: 9 }), id = x.id, pid = x.pid; await lower8(id, pid); NOW += 2 * H; await back9(id, pid);
  let r = ok(await call('ann', 'final', { id }), 'final'); assert.strictEqual(r.j.game.day.status, 'final');
  const row = r.j.game.board.rows.find((y) => y.tid === 'T1'); assert.strictEqual(row.low, 'Ann lowered 8 confirmed holes by 8', 'on the Final board row');
  assert.ok(!r.j.game.board.rows.find((y) => y.tid === 'T2').low, 'only the team that lowered its own card');
  const gb = (await call('bob', 'get', { id })).j.game; assert.ok(gb.notices.some((n) => n.kind === 'final' && /Ann lowered 8 confirmed holes by 8/.test(n.text) && /Open to disputes until/.test(n.text)), 'in the Final notice');
  const hs = gb.harm.filter((e) => e.canObject); assert.strictEqual(hs.length, 8, 'all 8 changes, made 2 hours ago, can still be objected to after Final'); assert.ok(hs.every((e) => e.open && e.until === r.j.game.payout.finalAt + 30 * M));
  NOW += 29 * M; r = ok(await call('bob', 'object', { id, h: hs[0].h }), 'A1: was 409 "The 30 minutes ... ended"'); assert.ok(r.j.reopened); assert.strictEqual(r.j.game.day.status, 'live', 'the round reopens by itself');
  // too late: 31 minutes after Final
  fresh(); x = await three({ net: 'gross' }, { annTo: 9, bobTo: 9 }); await lower8(x.id, x.pid); NOW += 2 * H; await back9(x.id, x.pid); ok(await call('ann', 'final', { id: x.id }));
  NOW += 31 * M; const h1 = (await harmOf('bob', x.id))[0]; assert.ok(!h1.canObject); r = await call('bob', 'object', { id: x.id, h: h1.h }); assert.strictEqual(r.s, 409); assert.ok(/ended at/.test(r.j.error), r.j.error);
  // a change made just before Final keeps its own 30 minutes
  fresh(); x = await three({ net: 'gross' }); r = await call('bob', 'score', { id: x.id, tid: 'T2', hole: 3, p: { [x.pid.bob]: PAR[2] - 1 } }); ok(await call('cat', 'sign', { id: x.id, n: r.j.n })); NOW += 20 * M; ok(await call('ann', 'final', { id: x.id })); NOW += 35 * M;
  const e2 = (await harmOf('ann', x.id))[0]; assert.ok(!e2.canObject, 'Final + 30 has passed'); assert.strictEqual((await call('ann', 'object', { id: x.id, h: e2.h })).s, 409);
});
chk('2 (F1) a tournament director cannot put himself on a team or take a pool entry, and Start is refused unless he is still neutral (also a Calcutta lot bought later)', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net' }, pot: { entry: 20 } })); const id = r.j.game.id, code = r.j.game.code, me = r.j.game.me;
  const P = {}; for (const [w, t] of [['bob', 'T1'], ['cat', 'T2'], ['dan', 'T3']]) { r = ok(await call(w, 'join', { code, tid: t })); P[w] = r.j.game.me; }
  for (const [p, v] of [[P.bob, 10], [P.cat, 10], [P.dan, 12], [me, 30]]) ok(await call('club', 'team', { id, op: 'hcp', pid: p, hcp: v, reason: 'club card' }));
  r = await call('club', 'team', { id, op: 'assign', pid: me, tid: 'T3' }); assert.strictEqual(r.s, 409, 'F1: was 200'); assert.ok(r.j.director); r = await call('club', 'join', { code, tid: 'T3' }); assert.strictEqual(r.s, 409, 'not by joining a team either');
  const cb = async () => (await call('club', 'get', { id })).j.game; assert.ok(!(await cb()).day.teams.some((t) => t.players.some((p) => p.pid === me)));
  for (const p of [P.bob, P.cat, P.dan]) ok(await call('club', 'paid', { id, pid: p, paid: true }));
  // a Calcutta lot bought after the numbers were set: Start is refused
  const k = Object.keys(db).find((x) => db[x].data && db[x].data.id === id); db[k].data.calcId = 'calc1'; G._reset(); FS.install(G, {}); await G.setLotHolders(id, [ACC('club')]);
  r = await call('club', 'start', { id }); assert.strictEqual(r.s, 409, 'the director holds a lot'); assert.ok(r.j.notNeutral); assert.strictEqual((await cb()).day.status, 'setup');
  await G.setLotHolders(id, [ACC('bob')]); ok(await call('club', 'start', { id }), 'neutral again: it starts');
  // a pool: no entry for the director
  fresh(); db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  r = ok(await call('club', 'create', { kind: 'pro', title: 'Club six', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' }, pot: { entry: 10 } })); const pg = r.j.game;
  r = await call('club', 'pick', { id: pg.id, picks: pg.tiers.map((x) => x[0]) }); assert.strictEqual(r.s, 409, 'no pool entry for the director'); assert.ok(r.j.director);
});
chk('3 (E1) the money switch: GOLF_MONEY_ENABLED turns on only with the stats sign-up stamp (sinceOf, old accounts filled in); ONE bar, 1 day (owner GOLF-AGE), used for every signer', async () => {
  const err = console.error, said = []; console.error = (m) => said.push(String(m)); const st = D.stats();
  try { let s = await G.moneySwitch({}); assert.deepStrictEqual([s.on, s.asked], [false, false]);
    s = await G.moneySwitch({ GOLF_MONEY_ENABLED: '1' }); assert.strictEqual(s.on, false, 'no sinceOf: refused'); assert.ok(/does not export sinceOf/.test(s.why)); assert.ok(said.some((m) => /golf money stays OFF/.test(m)), 'said loudly in the log');
    st.sinceOf = async () => ({ known: true, t: 1 }); s = await G.moneySwitch({ GOLF_MONEY_ENABLED: 'true' }); assert.strictEqual(s.on, false, 'old accounts not filled in: refused'); assert.ok(/filled in/.test(s.why));
    st.sinceBackfilled = async () => true; s = await G.moneySwitch({ GOLF_MONEY_ENABLED: 'on' }); assert.deepStrictEqual([s.on, s.minDays], [true, 1]); assert.strictEqual(G.SIGNER_MIN_DAYS, 1);
    D.stats = () => null; s = await G.moneySwitch({ GOLF_MONEY_ENABLED: '1' }); assert.strictEqual(s.on, false); assert.ok(/not in this build/.test(s.why)); D.stats = () => st;
  } finally { console.error = err; }
  // E1: main's acct.js has no `since`; with the stats stamp (filled in) the typo in your favour gets its signers instead of a 409
  const A0 = D.acct; D.acct = () => { const a = A0(); delete a.since; return a; };
  try { st.sinceOf = async (e) => ({ known: true, t: /^cat@/.test(e) ? NOW - 20 * H : NOW - 26 * H }); G._reset();
    const x = await three({ net: 'gross' }); let r = await call('bob', 'score', { id: x.id, tid: 'T2', hole: 4, p: { [x.pid.bob]: PAR[3] - 1 }, eid: 'e1' }); assert.strictEqual(r.s, 202, 'E1: was 409 "Nobody in this game can sign this"');
    assert.deepStrictEqual(who(r), ['Ann'], 'ONE bar: Ann (26 hours) may sign for another team, Cat (20 hours) may not'); assert.ok(/at least 1 day old/.test(JSON.stringify(r.j.game.pending)), 'plain words, not "established player"');
    const c2 = await call('cat', 'sign', { id: x.id, n: r.j.n }); assert.strictEqual(c2.s, 403); assert.ok(/less than 1 day old/.test(c2.j.error), c2.j.error); ok(await call('ann', 'sign', { id: x.id, n: r.j.n }));
  } finally { D.acct = A0; delete st.sinceOf; delete st.sinceBackfilled; }
});
chk('4 (D1) the payout says when to settle up: "Open to disputes until <time>", and "Payout settled" once it passes', async () => {
  const x = await three({ net: 'gross' }), id = x.id; let r = ok(await call('ann', 'final', { id })); const p = r.j.game.payout, fa = r.j.game.payout.finalAt; assert.ok(fa > 0);
  assert.deepStrictEqual([p.finalAt, p.settleAt, p.settled], [fa, fa + 30 * M, false]); assert.ok(!r.j.game.notices.some((n) => n.kind === 'settled'));
  NOW += 31 * M; let g = (await call('bob', 'get', { id })).j.game; assert.strictEqual(g.payout.settled, true); const n = g.notices.find((y) => y.kind === 'settled'); assert.ok(n && n.new && /Payout settled/.test(n.text));
  g = ok(await call('bob', 'seen', { id })).j.game; assert.ok(!g.notices.find((y) => y.kind === 'settled').new, '"Got it" clears it');
  // an objection still open on a confirmed hole moves the time: Final + 30 (fix 1) is the latest it can be
});
chk('5 (B1) after Final a team cannot dispute a hole it confirmed itself; before Final it can (honest second thoughts); other teams still can', async () => {
  const x = await three({ net: 'gross' }), id = x.id, pid = x.pid; // Cat confirmed Bob's card (T2)
  ok(await call('cat', 'dispute', { id, tid: 'T2', hole: 2, note: 'second thoughts', want: { p: { [pid.bob]: PAR[1] + 1 } } }), 'before Final: allowed'); ok(await call('cat', 'dispute', { id, tid: 'T2', hole: 2, off: true }), 'and taken back');
  ok(await call('ann', 'final', { id })); let r = await call('cat', 'dispute', { id, tid: 'T2', hole: 1, note: 'he had 5', want: { p: { [pid.bob]: PAR[0] + 1 } } }); assert.strictEqual(r.s, 403, 'B1: was 200'); assert.ok(/confirmed itself/.test(r.j.error));
  const g = await board(id); assert.ok(!g.payout.contested, 'Bob\'s win stands'); assert.strictEqual(paidOut(g).split(', ')[0], 'Bob ' + paidOut(g).split(', ')[0].split(' ')[1]);
  ok(await call('ann', 'dispute', { id, tid: 'T2', hole: 1, note: 'he had 5', want: { p: { [pid.bob]: PAR[0] + 1 } } }), 'a team that did not confirm it still can');
});
chk('6 (G1) wording: a bet after the start needs Bob AND Cat to sign', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], x = await mk(N, { net: 'gross', heads: { on: true, kind: 'player', type: 'match', amt: 50 } }, { entry: 10 }, { orgOut: true, nT: 3, tOf: (i) => 'T' + i }), id = x.id, pid = x.pid; await nums(N, id, pid, { orgOut: true }); ok(await call('ann', 'start', { id }));
  const r = await call('ann', 'match', { id, op: 'add', a: pid.bob, b: pid.cat }); assert.strictEqual(r.s, 202); assert.ok(/It needs (Bob AND Cat|Cat AND Bob) to sign/.test(r.j.note), r.j.note);
});
(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0], list = process.argv.includes('--list'); let bad = 0;
  if (list) { CHECKS.forEach(([n], i) => console.log(i + '\t' + n)); return; }
  for (let i = 0; i < CHECKS.length; i++) { if (only != null && Number(only) !== i) continue; const [name, fn] = CHECKS[i]; fresh(); D.handicapFor = D0.handicapFor;
    try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 300)); } }
  console.log(bad ? '\n' + bad + ' OF ' + CHECKS.length + ' ROUND 7 CHECKS FAILED' : '\nALL ' + CHECKS.length + ' ROUND 7 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
