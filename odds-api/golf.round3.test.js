// Golf review round 3 (Nov 16 2026): THE NEUTRAL RULE and the other round-3 fixes. No network, no database (in-memory fakes).
// Run: node odds-api/golf.round3.test.js
// Every check here FAILS on 2fa88eb and passes on this tree: `python3 scripts/golf-proof.py` runs this same file against a copy of 2fa88eb made under
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

const CHECKS = [];
const chk = (name, fn) => CHECKS.push([name, fn]);

chk('H1 dispute-then-settle: a playing organizer cannot rewrite an opponent\'s confirmed card; the one who disputes never settles; a settlement waits for the team\'s scorer or a neutral', async () => {
  const { id, pid } = await three(); let r = await call('ann', 'dispute', { id, tid: 'T2', hole: 4 }); assert.strictEqual(r.s, 400, 'a confirmed hole is only disputed with a note');
  for (const h of [1, 2, 3, 4, 5, 6, 7, 8]) { ok(await call('ann', 'dispute', { id, tid: 'T2', hole: h, note: 'wrong score' })); r = await call('ann', 'resolve', { id, tid: 'T2', hole: h, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 403, 'hole ' + h + ': the one who raised the dispute never settles it'); }
  let g = await board(id); assert.ok([1, 2, 3, 4, 5, 6, 7, 8].every((h) => g.day.scores.T2[h].p[pid.bob] === PAR[h - 1] && g.day.scores.T2[h].st === 'disputed'), 'Bob\'s scores are untouched'); assert.ok((await call('bob', 'get', { id })).j.game.notices.some((n) => /Ann disputed Team 2 hole 4, which was confirmed: wrong score/.test(n.text)), 'the team is told');
  assert.strictEqual((await call('ann', 'final', { id })).s, 409, 'no Final over disputed holes');
  r = await call('cat', 'resolve', { id, tid: 'T2', hole: 4, p: { [pid.bob]: 15 } }); assert.strictEqual(r.s, 202, 'another team\'s player only ASKS'); assert.strictEqual(r.j.game.day.scores.T2[4].p[pid.bob], PAR[3], 'pending changes nothing'); assert.deepStrictEqual(r.j.game.pending[0].who, ['Bob'], 'Ann is an organizer AND the one who would gain: only Bob\'s own side can sign here');
  assert.strictEqual((await call('ann', 'sign', { id, n: r.j.n })).s, 403); assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'not by the one who asked');
  ok(await call('bob', 'sign', { id, n: r.j.n, ok: false }), 'Bob turns it down'); for (const h of [1, 2, 3, 4, 5, 6, 7, 8]) ok(await call('ann', 'dispute', { id, tid: 'T2', hole: h, off: true }), 'she takes her dispute back');
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(first(r.j.game), 'Team 2'); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
});
chk('H2 organizer retypes an opponent\'s confirmed holes and his partner co-organizer confirms: nothing changes', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk(N, { fmt: 'bestball', teamSize: 2 }, { entry: 10 }, { nT: 2, size: 2, tOf: (i) => (i < 2 ? 'T1' : 'T2') }); await nums(N, id, pid);
  ok(await call('ann', 'team', { id, op: 'co', pid: pid.bob })); ok(await call('ann', 'start', { id }));
  await card('ann', id, 'T1', (h) => ({ [pid.ann]: PAR[h - 1] + 1, [pid.bob]: PAR[h - 1] + 1 })); await card('cat', id, 'T2', (h) => ({ [pid.cat]: PAR[h - 1], [pid.dan]: PAR[h - 1] })); ok(await conf('cat', id, 'T1')); ok(await conf('ann', id, 'T2'));
  let r; for (let h = 1; h <= 6; h++) { r = await call('ann', 'score', { id, tid: 'T2', hole: h, p: { [pid.cat]: 15, [pid.dan]: 15 } }); assert.strictEqual(r.s, 202, 'a change to a confirmed hole is only asked for'); }
  assert.ok(r.j.game.pending.every((q) => !q.who.includes('Bob') && q.who.includes('Cat')), 'her partner can never sign; the team itself (or a neutral) can');
  r = await conf('bob', id, 'T2'); assert.notStrictEqual(r.s, 200, 'the co-organizer partner confirms nothing'); for (const q of (await board(id)).pending) assert.strictEqual((await call('bob', 'sign', { id, n: q.n })).s, 403);
  let g = await board(id); assert.ok([1, 2, 3, 4, 5, 6].every((h) => g.day.scores.T2[h].p[pid.cat] === PAR[h - 1] && g.day.scores.T2[h].st === 'confirmed'));
  // co-organizer on the rival team: dispute + settle alone
  let n2 = 0; for (let h = 7; h <= 12; h++) { await call('bob', 'dispute', { id, tid: 'T2', hole: h, note: 'no way' }); r = await call('bob', 'resolve', { id, tid: 'T2', hole: h, p: { [pid.cat]: 15, [pid.dan]: 15 } }); if (r.s === 200) n2++; await call('bob', 'dispute', { id, tid: 'T2', hole: h, off: true }); } assert.strictEqual(n2, 0, 'a playing co-organizer settles nothing alone');
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(first(r.j.game), 'Team 2'); assert.strictEqual(paidOut(r.j.game), 'Cat 20, Dan 20');
});
chk('H3 a team with a complete card can never be marked did not finish; for a short card a playing organizer needs that team or a neutral to sign', async () => {
  let { id } = await three(); let r = await call('ann', 'team', { id, op: 'withdraw', tid: 'T2', reason: 'left early' }); assert.strictEqual(r.s, 409); assert.ok(/complete card/.test(r.j.error)); r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
  fresh(); const N = ['ann', 'bob', 'cat'], x = await mk(N); id = x.id; await nums(N, id, x.pid); ok(await call('ann', 'start', { id })); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1], 9);
  r = await call('ann', 'team', { id, op: 'withdraw', tid: 'T2', reason: 'left early' }); assert.strictEqual(r.s, 202); assert.deepStrictEqual([r.j.game.day.wd.T2, r.j.game.pending[0].who.sort()], [undefined, ['Bob', 'Cat']], 'still in; Bob himself or the neutral can sign');
  r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.deepStrictEqual([r.j.game.day.wd.T2.by, r.j.game.day.wd.T2.sig], ['Ann', 'Cat']); assert.ok(r.j.game.plog.some((p) => p.st === 'signed' && p.kind === 'withdraw' && p.by === 'Ann' && p.sig === 'Cat'), 'logged with both names');
  assert.ok((await call('bob', 'get', { id })).j.game.notices.some((n) => /Ann, signed by Cat: mark Team 2 did not finish: left early/.test(n.text)), 'announced to all players');
});
chk('M1 after a reopen the paid list changes only through the rule: asked, signed by a neutral, logged and announced; the reopen itself needs a signature', async () => {
  const { id, pid } = await three(); let r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Bob 30');
  r = await call('ann', 'reopen', { id, reason: 'fix paid list' }); assert.strictEqual(r.s, 202, 'a playing organizer\'s reopen waits'); assert.strictEqual(r.j.game.day.status, 'final'); assert.strictEqual((await call('ann', 'paid', { id, pid: pid.bob, paid: false })).s, 409, 'still final: the paid list is closed');
  r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.status, 'live');
  r = await call('ann', 'paid', { id, pid: pid.bob, paid: false }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.members.find((m) => m.pid === pid.bob).paid, true, 'Bob is still paid'); const n = r.j.n;
  r = ok(await call('ann', 'final', { id })); assert.strictEqual(paidOut(r.j.game), 'Bob 30', 'finishing again pays the same winner'); assert.strictEqual(r.j.game.pending.length, 0);
  // and when a neutral does sign such a change, it is in the history and every player is told
  r = await sg(await call('ann', 'reopen', { id, reason: 'Cat never paid' }), id); ok(r); r = await call('ann', 'paid', { id, pid: pid.cat, paid: false, reason: 'cheque bounced' }); assert.strictEqual(r.s, 202); r = ok(await call('bob', 'sign', { id, n: r.j.n }));
  assert.ok(r.j.game.day.audit.some((a) => a.what === 'marked not paid' && a.by === 'Ann' && a.sig === 'Bob' && a.note === 'Cat'), 'in the score history'); assert.ok((await call('cat', 'get', { id })).j.game.notices.some((x) => /Ann, signed by Bob: mark Cat not paid\. Reason: cheque bounced/.test(x.text)), 'Cat is told'); assert.ok(n > 0);
});
chk('M2 finished pool: nobody can be marked NOT paid; a late payment needs a reason and, from a playing organizer, a second signature', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'Six', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' }, pot: { entry: 10 } })); const id = r.j.game.id, T = r.j.game.tiers; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: r.j.game.code }));
  const g0 = (await call('ann', 'get', { id })).j.game, pid = {}; g0.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid)); for (const [w, k] of [['ann', 1], ['bob', 2], ['cat', 0]]) ok(await call(w, 'pick', { id, picks: T.map((t) => t[k]) }));
  ok(await call('ann', 'paid', { id, pid: pid.ann, paid: true })); ok(await call('ann', 'paid', { id, pid: pid.cat, paid: true })); // before the first tee: the organizer keeps the list
  NOW = TEE + 5 * 864e5; W.done = true; let g = (await call('ann', 'get', { id })).j.game; const win = g.entries[0]; assert.strictEqual(win.name, 'Cat'); assert.strictEqual(win.payout, 20);
  r = await call('ann', 'paid', { id, pid: pid.cat, paid: false, reason: 'never paid me' }); assert.strictEqual(r.s, 409, 'closed, reason or not'); assert.ok(/Nobody can be marked not paid/.test(r.j.error)); g = (await call('ann', 'get', { id })).j.game; assert.strictEqual(g.entries.find((e) => e.pid === pid.cat).payout, 20);
  r = await call('ann', 'paid', { id, pid: pid.bob, paid: true }); assert.strictEqual(r.s, 409, 'a late payment needs a reason'); r = await call('ann', 'paid', { id, pid: pid.bob, paid: true, reason: 'paid cash Thursday' }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.members.find((m) => m.pid === pid.bob).paid, false);
  r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.deepStrictEqual([r.j.game.paidLog[0].by, r.j.game.paidLog[0].sig, r.j.game.paidLog[0].name, r.j.game.paidLog[0].paid], ['Ann', 'Cat', 'Bob', true]);
});
chk('M5 the organizer cannot set a team mate\'s (or anyone\'s) handicap alone in a net money game: it waits for a player from another team', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk(N, { fmt: 'bestball', teamSize: 2 }, { entry: 10 }, { nT: 2, size: 2, tOf: (i) => (i < 2 ? 'T1' : 'T2') });
  let r = await call('ann', 'team', { id, op: 'hcp', pid: pid.bob, hcp: 54 }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.day.hi[pid.bob].used, null, 'Bob has no number yet'); assert.deepStrictEqual(r.j.game.pending[0].who.sort(), ['Cat', 'Dan']);
  assert.strictEqual((await call('bob', 'sign', { id, n: r.j.n })).s, 403); assert.strictEqual((await call('ann', 'start', { id })).s, 409, 'no start while numbers are missing');
  r = ok(await call('dan', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.hi[pid.bob].used, 54); assert.ok(/Set by Ann: 54\.0, signed by Dan$/.test(r.j.game.day.hi[pid.bob].text));
});
chk('H5 Enterprise tournament with no fee: a player never sets his own number, Start waits for every number, a director who does not play sets them alone (logged, all told)', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net' }, pot: { entry: 0 } })); const id = r.j.game.id; assert.strictEqual(r.j.game.ent, true);
  r = ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T1', hcp: 40 })); const bob = r.j.game.me; assert.deepStrictEqual([r.j.game.day.hi[bob].used, r.j.game.day.hi[bob].ask], [null, 40], 'typed on joining: only asked for');
  r = await call('bob', 'team', { id, op: 'hcp', pid: bob, hcp: 45 }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.day.hi[bob].used, null); r = ok(await call('cat', 'join', { code: r.j.game.code, tid: 'T2' })); const cat = r.j.game.me;
  r = await call('club', 'start', { id }); assert.strictEqual(r.s, 409, 'never 0 strokes by default in a tournament'); assert.strictEqual(r.j.needHcp.length, 2);
  r = ok(await call('club', 'team', { id, op: 'hcp', pid: bob, hcp: 12, reason: 'club record' }), 'a director who is not playing acts alone'); assert.strictEqual(r.j.game.day.hi[bob].used, 12); assert.ok(r.j.game.plog.some((p) => p.st === 'alone' && p.kind === 'hcp' && p.by === 'Club'));
  assert.ok((await call('cat', 'get', { id })).j.game.notices.some((n) => /Club \(organizer, not playing\): set Bob's handicap to 12\.0\. Reason: club record/.test(n.text)), 'every player is told'); ok(await call('club', 'team', { id, op: 'hcp', pid: cat, hcp: 20, reason: 'club record' })); ok(await call('club', 'start', { id }));
});
chk('M3 money added after a player typed his own number: the number goes back to "asked" and Start is refused; no money match can be slipped in after the start', async () => {
  let r = ok(await call('ann', 'create', { kind: 'day', title: 'Casual', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net', hu: { on: true, kind: 'team', type: 'nassau', amt: 10 } }, pot: { entry: 0 } })); const id = r.j.game.id, code = r.j.game.code;
  r = ok(await call('bob', 'join', { code, tid: 'T2', hcp: 36 })); const bob = r.j.game.me; assert.strictEqual(r.j.game.day.hi[bob].used, 36, 'casual: his own number counts'); r = ok(await call('cat', 'join', { code, tid: 'T3' }));
  r = await sg(await call('ann', 'match', { id, op: 'add', a: 'T2', b: 'T3' }), id); ok(r); r = await call('ann', 'get', { id }); assert.strictEqual(r.j.game.day.money, true); assert.deepStrictEqual([r.j.game.day.hi[bob].used, r.j.game.day.hi[bob].ask], [null, 36], 'demoted when the money match went in');
  r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409); assert.ok(r.j.needHcp.includes(bob));
  // a casual net game that has started cannot get a money match afterwards
  fresh(); r = ok(await call('ann', 'create', { kind: 'day', title: 'Casual 2', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', hu: { on: true, kind: 'team', type: 'match', amt: 50 } }, pot: { entry: 0 } })); const i2 = r.j.game.id; ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T2', hcp: 36 })); ok(await call('ann', 'team', { id: i2, op: 'assign', pid: r.j.game.me, tid: 'T1' })); ok(await call('ann', 'start', { id: i2 }));
  r = await call('ann', 'match', { id: i2, op: 'add', a: 'T1', b: 'T2' }); assert.strictEqual(r.s, 409); assert.ok(/before the round starts/.test(r.j.error));
});
chk('M4 flights without money: Start is refused until every player has a number (nobody is put in a flight off 0 by default)', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], { id } = await mk(N, { flights: 2 }, { entry: 0 }, { noPaid: true }); const r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409); assert.strictEqual(r.j.needHcp.length, 4); assert.ok(/flighted game/.test(r.j.error));
});
chk('H4 golf never marks a round confirmed: the record says who else had a scored card and which account on another team signed it; guests and joiners never count', async () => {
  // a typed-in guest who never hits a shot
  let r = ok(await call('dan', 'create', { kind: 'day', title: 'Ghost', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); let id = r.j.game.id; ok(await call('dan', 'team', { id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); ok(await call('dan', 'team', { id, op: 'guest', name: 'Ghost', tid: 'T2' }));
  ok(await call('eve', 'join', { code: r.j.game.code })); ok(await call('dan', 'start', { id })); await card('dan', id, 'T1', r.j.game.me, (h) => PAR[h - 1] + 2); ok(await call('dan', 'final', { id }));
  let rec = (await G.statsFor(ACC('dan'), {})).find((x) => x.contestId === id && x.kind === 'golf-round'); assert.strictEqual(rec.extra.confirmed, undefined, 'golf does not say "confirmed"'); assert.deepStrictEqual([rec.extra.card.others, rec.extra.card.by, rec.extra.card.guests], [0, [], 1], 'a guest and an account that only joined are not other cards');
  for (let k = 0; k < 2; k++) { NOW += 60e3; r = ok(await call('dan', 'create', { kind: 'day', title: 'Ghost ' + k, course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); id = r.j.game.id; ok(await call('dan', 'team', { id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); ok(await call('dan', 'team', { id, op: 'guest', name: 'Ghost', tid: 'T2' })); ok(await call('dan', 'start', { id })); await card('dan', id, 'T1', r.j.game.me, (h) => PAR[h - 1] + 2); ok(await call('dan', 'final', { id })); }
  const h = await G.handicapFor(ACC('dan')); assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.use], [3, 0, null], 'three ghost rounds give no number for money games');
  // a real two-account game with every hole signed by the other team
  fresh(); const N = ['rex', 'sue'], x = await mk(N, { net: 'gross' }, { entry: 0 }, { noPaid: true }); ok(await call('rex', 'start', { id: x.id })); await card('rex', x.id, 'T1', x.pid.rex, (hh) => PAR[hh - 1] + 1); await card('sue', x.id, 'T2', x.pid.sue, (hh) => PAR[hh - 1]);
  rec = (await G.statsFor(ACC('rex'), {})).find((y) => y.kind === 'golf-round'); assert.deepStrictEqual([rec.extra.card.others, rec.extra.card.by.length], [1, 0], 'another card, but nobody signed his yet');
  ok(await conf('sue', x.id, 'T1')); rec = (await G.statsFor(ACC('rex'), {})).find((y) => y.kind === 'golf-round'); assert.deepStrictEqual([rec.extra.card.others, rec.extra.card.by.length, rec.extra.card.byName, rec.extra.card.holes, rec.extra.confirmed], [1, 1, 'Sue', 18, undefined]); assert.ok(/^[\w:.-]{6,40}$/.test(rec.extra.card.by[0]) && !/@/.test(rec.extra.card.by[0]), 'a one-way reference, never the account id');
});
chk('NEUTRAL: an organizer who does not play acts alone (logged, every player told); the same organizer who plays can only ask', async () => {
  const N = ['org', 'bob', 'cat'], { id, pid } = await mk(N, {}, { entry: 10 }, { orgOut: true }); let r = ok(await call('org', 'team', { id, op: 'hcp', pid: pid.bob, hcp: 9 })); assert.strictEqual(r.j.game.day.hi[pid.bob].used, 9); assert.strictEqual(r.j.game.interested, false);
  ok(await call('org', 'team', { id, op: 'hcp', pid: pid.cat, hcp: 3 })); ok(await call('org', 'start', { id })); await card('bob', id, 'T1', pid.bob, (h) => PAR[h - 1], 5);
  r = ok(await call('org', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'hurt his back' })); assert.strictEqual(r.j.game.day.wd.T1.by, 'Org'); assert.ok(r.j.game.plog.some((p) => p.st === 'alone' && p.kind === 'withdraw')); assert.ok((await call('cat', 'get', { id })).j.game.notices.some((n) => /Org \(organizer, not playing\): mark Team 1 did not finish: hurt his back/.test(n.text)));
  r = ok(await call('org', 'paid', { id, pid: pid.cat, paid: false, reason: 'refunded' })); assert.ok(r.j.game.day.audit.some((a) => a.what === 'marked not paid' && a.note === 'Cat'), 'a paid change after the start is in the history'); assert.ok((await call('bob', 'get', { id })).j.game.notices.some((n) => /mark Cat not paid/.test(n.text)));
});
chk('NEUTRAL: forced Final and money matches by a playing organizer wait for a signature; with only organizers on the other teams the fallback applies', async () => {
  const N = ['ann', 'bob', 'cat'], x = await mk(N, { hu: { on: true, kind: 'team', type: 'match', amt: 20 } }); const id = x.id; await nums(N, id, x.pid);
  let r = await call('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' }); assert.strictEqual(r.s, 202, 'a money match is a bet: the other side signs'); assert.deepStrictEqual([r.j.game.day.matches.length, r.j.game.pending[0].who], [0, ['Bob']]); assert.strictEqual((await call('cat', 'sign', { id, n: r.j.n })).s, 403, 'not a bystander');
  r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.matches.length, 1);
  r = await call('ann', 'setup', { id, day: { net: 'both', payBy: 'gross' } }); assert.strictEqual(r.s, 202, 'which board the money follows is a rule of the game'); assert.strictEqual(r.j.game.day.payBy, 'net'); ok(await call('ann', 'sign', { id, n: r.j.n, ok: false }));
  ok(await call('ann', 'start', { id })); await card('ann', id, 'T1', x.pid.ann, (h) => PAR[h - 1]); await card('bob', id, 'T2', x.pid.bob, (h) => PAR[h - 1] + 1); await card('cat', id, 'T3', x.pid.cat, (h) => PAR[h - 1] + 2); ok(await conf('bob', id, 'T1')); ok(await conf('ann', id, 'T2'));
  r = await call('ann', 'final', { id, force: true, reason: 'Cat left, card signed on paper' }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.day.status, 'live'); assert.deepStrictEqual(r.j.game.pending[0].who.sort(), ['Bob', 'Cat']);
  r = ok(await call('bob', 'sign', { id, n: r.j.n })); assert.deepStrictEqual([r.j.game.day.status, r.j.game.day.forced.by, r.j.game.day.forced.sig, r.j.game.day.forced.holes], ['final', 'Ann', 'Bob', 18]);
  // every other team has an organizer: the signer must still be off the actor's team and off the affected team
  fresh(); const y = await mk(N); await nums(N, y.id, y.pid); ok(await call('ann', 'team', { id: y.id, op: 'co', pid: y.pid.bob })); ok(await call('ann', 'team', { id: y.id, op: 'co', pid: y.pid.cat })); ok(await call('ann', 'start', { id: y.id })); await card('bob', y.id, 'T2', y.pid.bob, (h) => PAR[h - 1], 3);
  r = await call('ann', 'team', { id: y.id, op: 'withdraw', tid: 'T2', reason: 'went home' }); assert.strictEqual(r.s, 202); assert.deepStrictEqual(r.j.game.pending[0].who.sort(), ['Bob', 'Cat'], 'Bob as the affected side, Cat as the organizer on a third team');
});
chk('M8 60 scorers saving in the same second on a slow database: every save lands, nobody is told "Busy"', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); FS.install(G, {});
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Shotgun', course: COURSE, day: { fmt: 'stroke', teams: 60, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); const id = r.j.game.id, code = r.j.game.code, who = Array.from({ length: 60 }, (_, i) => 'p' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26))), me = {};
  for (let i = 0; i < 60; i++) { r = ok(await call(who[i], 'join', { code, tid: 'T' + (i + 1) })); me[who[i]] = r.j.game.me; } ok(await call('club', 'start', { id }));
  slowLo = 30; slowHi = 80; const t0 = Date.now(), rs = await Promise.all(who.map((w, i) => call(w, 'score', { id, tid: 'T' + (i + 1), hole: 1, p: { [me[w]]: 4 }, eid: 'e' + i }))); slowLo = slowHi = 0;
  assert.deepStrictEqual(rs.map((x) => x.s).filter((s) => s !== 200), [], 'all 60 answered 200'); const g = (await call('club', 'get', { id })).j.game; assert.strictEqual(Object.keys(g.day.scores).filter((t) => g.day.scores[t][1] && g.day.scores[t][1].p).length, 60, 'none lost'); assert.ok(Date.now() - t0 < 60000);
});
chk('M9 + M10 the director\'s handicap log shows handicap changes only, with the director\'s name; at Start golf tells the stats module to lock the event', async () => {
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); const F = FS.install(G, {}), log0 = F.eventLog, set0 = F.eventSetup, sets = [];
  F.eventLog = async (a, b) => { const x = await log0(a, b); x.log = x.log.map((y) => Object.assign({}, y, { by: 'Tournament director' })).concat({ at: NOW, by: 'Tournament director', player: '', field: 'start', old: null, new: NOW, reason: 'Start set' }); return x; }; F.eventSetup = async (a, b, o) => { sets.push(o); return set0(a, b, o); };
  let r = ok(await call('club', 'create', { kind: 'day', title: 'Club day', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', teeTime: NOW + 3 * 3600e3 }, pot: { entry: 0 } })); const id = r.j.game.id; r = ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T1' })); const bob = r.j.game.me;
  r = ok(await call('club', 'team', { id, op: 'hcp', pid: bob, hcp: 14.2, reason: 'club record' })); assert.deepStrictEqual(r.j.game.day.hlog.map((x) => [x.name, x.by, x.new, x.reason]), [['Bob', 'Club', 14.2, 'club record']], 'no "Start set" line, and the director by name');
  sets.length = 0; ok(await call('club', 'start', { id })); assert.ok(sets.length === 1 && sets[0].lockAt > NOW && sets[0].lockAt <= NOW + 5000, 'eventSetup lockAt = a moment after the start: ' + JSON.stringify(sets)); NOW += 2000;
  await assert.rejects(F.eventOverride(ACC('club'), 'golf:' + id, ACC('bob'), { hcp: 30, reason: 'late', name: 'Bob' }), /started|locked/, 'the stats side is locked too, so the two logs cannot disagree');
});
chk('LOW 1 + tiers through the rule: a pick and a tier change sent together cannot leave picks off their tiers; a playing organizer\'s tier change waits', async () => {
  let r = ok(await call('ann', 'create', { kind: 'pro', title: 'Six', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' }, pot: { entry: 10 } })); const id = r.j.game.id, T = r.j.game.tiers; ok(await call('bob', 'join', { code: r.j.game.code }));
  r = await call('ann', 'tiers', { id, rank: 'Golfer 50\nGolfer 49\nGolfer 48' }); assert.strictEqual(r.s, 202, 'others have joined a money pool: the organizer\'s own tier list waits'); assert.deepStrictEqual(r.j.game.tiers, T); const n = r.j.n;
  slowLo = 2; slowHi = 12; const [a, b] = await Promise.all([call('bob', 'pick', { id, picks: T.map((t) => t[0]) }), call('bob', 'sign', { id, n })]); slowLo = slowHi = 0;
  const g = (await call('bob', 'get', { id })).j.game, mine = g.mine && g.mine.picks; assert.ok(!(a.s === 200 && b.s === 200 && mine && !mine.every((p, i) => g.tiers[i].includes(p))), 'picks ' + a.s + ' / tiers ' + b.s); assert.ok(!mine || mine.every((p, i) => g.tiers[i].includes(p)), 'every pick is still in its tier');
});
chk('LOW 3 a flight where no paid team finished: its share goes to the other flight, to the cent', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk(N, { flights: 2, net: 'net' }, { entry: 10 }); await nums(N, id, pid, { v: [1, 2, 20, 22] }); ok(await call('ann', 'start', { id }));
  let g = await board(id); assert.deepStrictEqual([g.day.flights.of.T1, g.day.flights.of.T3], [0, 1]);
  await card('ann', id, 'T1', pid.ann, (h) => PAR[h - 1]); await card('bob', id, 'T2', pid.bob, (h) => PAR[h - 1] + 1); await card('cat', id, 'T3', pid.cat, (h) => PAR[h - 1], 4); await card('dan', id, 'T4', pid.dan, (h) => PAR[h - 1], 4); ok(await conf('bob', id, 'T1')); ok(await conf('ann', id, 'T2'));
  for (const tid of ['T3', 'T4']) ok(await sg(await call('ann', 'team', { id, op: 'withdraw', tid, reason: 'rain' }), id)); const r = ok(await call('ann', 'final', { id })); g = r.j.game;
  assert.strictEqual(g.payout.pool, 40); assert.strictEqual(g.payout.paid.reduce((a, x) => a + x.amt, 0), 40, 'the whole pool is paid: ' + paidOut(g)); assert.ok(g.payout.lines.some((l) => l.flight === 'Flight B' && l.moved === true && l.pool === 0) && g.payout.lines.every((l) => !l.notWon));
});
chk('LOW 5, 8, 10, 11: a tee time moved later moves the handicap lock; an Enterprise day is created without the stats module; a confirm needs the card opened; the record carries the flight place', async () => {
  let r = ok(await call('ann', 'create', { kind: 'day', title: 'Rain', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', teeTime: NOW + 3600e3 }, pot: { entry: 0 } })); r = ok(await call('ann', 'setup', { id: r.j.game.id, day: { teeTime: NOW + 3 * 3600e3 } })); assert.strictEqual(r.j.game.day.lockAt, NOW + 3 * 3600e3, 'L5');
  db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('club')]: true } }, updated: 1 }; G._reset(); D.stats = () => null; r = await call('club', 'create', { kind: 'day', title: 'No stats', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net' }, pot: { entry: 0 } }); assert.strictEqual(r.s, 200, 'L8'); assert.strictEqual(r.j.game.ent, true);
  fresh(); const N = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk(N, { flights: 2 }, { entry: 10 }); await nums(N, id, pid, { v: [1, 2, 20, 22] }); ok(await call('ann', 'start', { id })); const sc = { ann: 2, bob: 0, cat: 2, dan: 3 }; for (let i = 0; i < 4; i++) await card(N[i], id, 'T' + (i + 1), pid[N[i]], (h) => PAR[h - 1] + sc[N[i]]);
  G._reset(); FS.install(G, {}); r = await call('zed', 'confirm', { id, tid: 'T1', from: 1, to: 18, revs: Object.fromEntries(PAR.map((_, i) => [i + 1, 1])) }); assert.strictEqual(r.s, 404); r = await call('bob', 'confirm', { id, tid: 'T1', from: 1, to: 18, revs: Object.fromEntries(PAR.map((_, i) => [i + 1, 1])) }); assert.strictEqual(r.s, 409, 'L10: made-up versions without opening the card'); assert.strictEqual(r.j.openFirst, true);
  ok(await conf('bob', id, 'T1')); ok(await conf('ann', id, 'T2')); ok(await conf('dan', id, 'T3')); ok(await conf('cat', id, 'T4')); ok(await call('ann', 'final', { id }));
  const rec = (await G.statsFor(ACC('cat'), {})).find((x) => x.kind === 'golf-round'); assert.deepStrictEqual([rec.place, rec.extra.placeAll, rec.result], [{ n: 1, of: 2 }, { n: 2, of: 4 }, 'W'], 'L11: the place on the record is the flight place (the one the money follows)');
});
chk('SIDE WINNERS: the confirm is a second signature under the same rule; a confirmed winner is reopened by a playing organizer only with a signature', async () => {
  const N = ['ann', 'bob', 'cat', 'dan'], { id, pid } = await mk(N, { fmt: 'bestball', teamSize: 2, extras: { ctp: [3], ctpAmt: 20 } }, { entry: 10 }, { nT: 2, size: 2, tOf: (i) => (i < 2 ? 'T1' : 'T2') }); await nums(N, id, pid); ok(await call('ann', 'team', { id, op: 'co', pid: pid.bob })); ok(await call('ann', 'start', { id }));
  ok(await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: pid.ann })); let r = await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 403, 'not her partner'); ok(await call('dan', 'extraconfirm', { id, kind: 'ctp', hole: 3 }));
  r = await call('ann', 'extrareopen', { id, kind: 'ctp', hole: 3, reason: 'it was Cat' }); assert.strictEqual(r.s, 202); assert.strictEqual(r.j.game.day.win.ctp[3].st, 'confirmed'); assert.strictEqual((await call('bob', 'sign', { id, n: r.j.n })).s, 403); r = ok(await call('cat', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.win.ctp[3].st, 'reopened');
});
chk('GROUP: a golf game attached to a group is opened and joined from the group by its members only (gjoin), and the people cap still applies', async () => {
  const mem = { GRP1: ['ann', 'bob', 'cat', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'] }; GROUPS = { attachGame: async (gid, e) => { if (ACC(mem[gid][0]) !== e) throw Object.assign(new Error('Only the commissioner'), { status: 403 }); return { cid: 'C1' }; }, memberCheck: async (gid, e) => ((mem[gid] || []).some((w) => ACC(w) === e) ? { member: true } : null) };
  let r = ok(await call('ann', 'create', { kind: 'day', title: 'Group day', course: COURSE, groupId: 'GRP1', day: { fmt: 'stroke', teams: 8, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); const id = r.j.game.id; assert.strictEqual(r.j.game.groupId, 'GRP1');
  r = await call('zed', 'gjoin', { id }); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.code, 'group'); r = await call('zed', 'gjoin', { id, preview: true }); assert.strictEqual(r.s, 403);
  r = ok(await call('bob', 'gjoin', { id, preview: true })); assert.deepStrictEqual([r.j.game.role, r.j.game.title, r.j.game.code], ['none', 'Group day', undefined], 'a member can look first; no join code is handed out'); r = ok(await call('bob', 'gjoin', { id, tid: 'T2' })); assert.strictEqual(r.j.game.role, 'member'); ok(await call('bob', 'gjoin', { id }), 'again: harmless');
  for (const w of ['cat', 'd1', 'd2', 'd3', 'd4', 'd5']) ok(await call(w, 'gjoin', { id })); r = await call('d6', 'gjoin', { id }); assert.strictEqual(r.s, 409, 'the 8-person cap'); assert.ok(/full/.test(r.j.error));
  r = ok(await call('ann', 'create', { kind: 'day', title: 'Not attached', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1 }, pot: { entry: 0 } })); assert.strictEqual((await call('bob', 'gjoin', { id: r.j.game.id })).s, 404, 'only a game that is on a group');
});

(async () => {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0], list = process.argv.includes('--list'); let bad = 0;
  if (list) { CHECKS.forEach(([n], i) => console.log(i + '\t' + n)); return; }
  for (let i = 0; i < CHECKS.length; i++) { if (only != null && Number(only) !== i) continue; const [name, fn] = CHECKS[i]; fresh();
    try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message).replace(/\s+/g, ' ').slice(0, 300)); } }
  console.log(bad ? '\n' + bad + ' OF ' + CHECKS.length + ' ROUND 3 CHECKS FAILED' : '\nALL ' + CHECKS.length + ' ROUND 3 CHECKS PASSED'); process.exit(bad ? 1 : 0);
})();
