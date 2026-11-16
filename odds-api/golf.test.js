// Run: node odds-api/golf.test.js   (no network, no database: Supabase, ESPN, OpenGolfAPI and sign-in are in-memory fakes)
'use strict';
const assert = require('assert'), http = require('http'), S = require('./golf-score'), FEED = require('./golf-feed'), CO = require('./golf-courses'), G = require('./golf'), D = G._deps;
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const eq = assert.deepStrictEqual;

// ======================= pure engine, hand-worked =======================
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10];
const COURSE = { name: 'Test CC', tees: 'White', holes: 18, par: PAR, hcp: SI };
(function engine() {
  // net strokes by hole index
  assert.strictEqual(S.strokesOn(20, 1), 2); assert.strictEqual(S.strokesOn(20, 2), 2); assert.strictEqual(S.strokesOn(20, 3), 1); assert.strictEqual(S.strokesOn(20, 18), 1);
  assert.strictEqual(S.strokesOn(5, 5), 1); assert.strictEqual(S.strokesOn(5, 6), 0); assert.strictEqual(S.strokesOn(38, 2), 3); assert.strictEqual(S.strokesOn(38, 3), 2);
  assert.strictEqual(S.strokesOn(-2, 17), -1); assert.strictEqual(S.strokesOn(-2, 16), 0); assert.strictEqual(S.strokesOn(0, 1), 0); assert.strictEqual(S.strokesOn(4, 4, 9), 1); assert.strictEqual(S.strokesOn(4, 5, 9), 0);
  t('strokes by hole index: 20 -> 2 on SI 1-2, 1 elsewhere; 38 -> 3/2; plus 2 gives back on SI 17-18; 9-hole');
  // team allowance (commissioner-set numbers): 4-person scramble 25/20/15/10 of 8,12,20,30 (low first) = 2 + 2.4 + 3 + 3 = 10.4 -> 10 strokes (SI 1-10)
  assert.strictEqual(S.teamHcp([30, 8, 20, 12], [25, 20, 15, 10]), 10.4);
  const team = { tid: 'T1', players: ['a', 'b', 'c', 'd'] }, ctx = { fmt: 'scramble4', course: COURSE, net: true, thcp: 10.4 };
  eq(S.teamHole(team, { g: 4 }, 0, ctx), { gross: 4, net: 3 }); // hole 1 SI 7 <= 10 -> 1 stroke
  eq(S.teamHole(team, { g: 3 }, 2, ctx), { gross: 3, net: 3 }); // hole 3 SI 15 -> none
  t('net scramble: team allowance 25/20/15/10 -> 10.4 -> hole SI 7 gets a stroke, SI 15 does not');
  // Texas scramble drive count: minimum 4 each
  let x = S.texasDrives(['A', 'B', 'C', 'D'], [].concat(Array(6).fill('A'), Array(4).fill('B'), Array(3).fill('C'), ['D']), 4, 18);
  eq(x.need, { A: 0, B: 0, C: 1, D: 3 }); assert.strictEqual(x.left, 4); assert.strictEqual(x.impossible, false); eq(x.warn, ['D']);
  x = S.texasDrives(['A', 'B', 'C', 'D'], [].concat(Array(7).fill('A'), Array(4).fill('B'), Array(3).fill('C'), ['D']), 4, 18);
  assert.strictEqual(x.left, 3); assert.strictEqual(x.impossible, true); eq(x.warn, ['C', 'D']);
  t('Texas scramble: D needs 3 drives with 4 holes left -> warning; one more A drive -> 4 needed in 3 holes -> impossible');
  // Florida step-aside
  assert.strictEqual(S.floridaCheck(['A', 'B', 'A', 'C'], 4), null);
  assert.ok(/sit out/.test(S.floridaCheck(['A', 'A', 'B'], 3))); assert.ok(/One shot per stroke/.test(S.floridaCheck(['A', 'B'], 3)));
  t('Florida: the player whose shot was used cannot have the next shot used; one shot per stroke');
  // Shamble, best 2 net, 80%: hcps 10,20,0,5 -> 8,16,0,4; hole 1 (par 4, SI 7): A 4-1=3, B 5-1=4, C 6, D 3 -> best two A+D = 6 net, 7 gross
  const T4 = { tid: 'T', players: ['A', 'B', 'C', 'D'] }, hc = { A: S.playHcp(10, 80), B: S.playHcp(20, 80), C: 0, D: S.playHcp(5, 80) };
  eq(hc, { A: 8, B: 16, C: 0, D: 4 });
  let r = S.teamHole(T4, { p: { A: 4, B: 5, C: 6, D: 3 } }, 0, { fmt: 'shamble', course: COURSE, net: true, hcp: hc, count: 2 });
  assert.strictEqual(r.net, 6); assert.strictEqual(r.gross, 7); assert.strictEqual(r.par, 8); eq(r.used.sort(), ['A', 'D']);
  t('shamble best 2 net at 80%: 8/16/0/4 strokes, net 3/4/6/3 -> A + D = 6 net (7 gross), par 8');
  // Best ball 2 of 4 gross
  r = S.teamHole(T4, { p: { A: 5, B: 4, C: 6, D: 4 } }, 0, { fmt: 'bestball', course: COURSE, net: false, hcp: {}, count: 2 }); assert.strictEqual(r.gross, 8); assert.strictEqual(r.par, 8);
  r = S.teamHole(T4, { p: { A: 5, B: 4, C: 6, D: 4 } }, 0, { fmt: 'bestball', course: COURSE, net: false, hcp: {}, count: 1 }); assert.strictEqual(r.gross, 4);
  t('best ball 2 of 4: 5,4,6,4 -> 8 (par 8); 1 of 4 -> 4');
  // Alternate shot 50/50 of 10 and 14 = 12; hole 4 (par 5, SI 1) gross 5 -> net 4
  assert.strictEqual(S.teamHcp([10, 14], [50, 50]), 12); eq(S.teamHole({ players: ['a', 'b'] }, { g: 5 }, 3, { fmt: 'altshot', course: COURSE, net: true, thcp: 12 }), { gross: 5, net: 4 });
  // Chapman 60/40 of 10 and 20 = 6 + 8 = 14; hole 9 (SI 9) gets a stroke, hole 7 (SI 17) does not
  assert.strictEqual(S.teamHcp([20, 10], [60, 40]), 14); eq(S.teamHole({ players: ['a', 'b'] }, { g: 5 }, 8, { fmt: 'chapman', course: COURSE, net: true, thcp: 14 }), { gross: 5, net: 4 }); eq(S.teamHole({ players: ['a', 'b'] }, { g: 3 }, 6, { fmt: 'chapman', course: COURSE, net: true, thcp: 14 }), { gross: 3, net: 3 });
  t('alternate shot 50/50 (10,14 -> 12) and Chapman 60/40 (10,20 -> 14) net by hole index');
  // Stableford points vs net
  eq([6, 5, 4, 3, 2].map((n) => S.STABLEFORD(n, 4)), [0, 1, 2, 3, 4]); assert.strictEqual(S.STABLEFORD(2, 5), 5); assert.strictEqual(S.STABLEFORD(9, 4), 0);
  r = S.teamHole({ players: ['A'] }, { p: { A: 5 } }, 0, { fmt: 'stableford', course: COURSE, net: true, hcp: { A: 18 } }); assert.strictEqual(r.pts, 2); // gross 5 - 1 stroke = net par = 2 points
  t('Stableford: net double+ 0, bogey 1, par 2, birdie 3, eagle 4, albatross 5; gross 5 with a stroke on a par 4 = 2 points');
  // Match play states
  const A = (arr) => arr.concat(Array(18 - arr.length).fill(null));
  let m = S.match(A([3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]), A([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]), 0, 18);
  assert.strictEqual(m.up, 2); assert.strictEqual(m.left, 2); assert.strictEqual(m.dormie, true); assert.strictEqual(m.done, false); assert.strictEqual(m.text, '2 up');
  m = S.match(A([3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]), A(Array(15).fill(4)), 0, 18); assert.strictEqual(m.closed, true); assert.strictEqual(m.text, '4&3'); assert.strictEqual(m.res, 'W');
  m = S.match(A(Array(4).fill(5)), A(Array(4).fill(4)), 0, 18); assert.strictEqual(m.text, '4 down'); assert.strictEqual(m.left, 14);
  m = S.match(Array(18).fill(4), Array(18).fill(4), 0, 18); assert.strictEqual(m.text, 'Halved'); assert.strictEqual(m.res, 'T');
  m = S.match(A([3, 4, 4]), A([4, 4, 4]), 0, 18); assert.strictEqual(m.text, '1 up'); assert.strictEqual(m.left, 15); assert.strictEqual(m.dormie, false);
  m = S.match(A(Array(15).fill(4).map((v, i) => (i < 3 ? 3 : 4))), A(Array(15).fill(4)), 0, 18); assert.strictEqual(m.dormie, true); assert.strictEqual(m.text, '3 up'); // 3 up, 3 to play
  t('match play: 2 up with 2 left = dormie; 4 up with 3 left = closed out 4&3; 4 down; halved; 3 up with 3 left = dormie');
  // Nassau with a press: B wins 1-2, A presses from 3, A wins 3-5, rest halved
  const na = [5, 5, 3, 3, 3, 4, 4, 4, 4].concat(Array(9).fill(4)), nb = [4, 4, 4, 4, 4, 4, 4, 4, 4].concat(Array(9).fill(4));
  let n = S.nassau(na, nb, [{ nine: 'front', from: 3 }]);
  assert.strictEqual(n.front.text, '1 up'); assert.strictEqual(n.front.res, 'W'); assert.strictEqual(n.back.text, 'Halved'); assert.strictEqual(n.total.text, '1 up'); assert.strictEqual(n.total.res, 'W');
  assert.strictEqual(n.presses.length, 1); assert.strictEqual(n.presses[0].m.text, '3&2'); assert.strictEqual(n.presses[0].m.res, 'W');
  n = S.nassau(na, nb, [], 2); assert.strictEqual(n.presses.length, 2); assert.strictEqual(n.presses[0].from, 3); assert.strictEqual(n.presses[0].m.text, '3&2'); assert.strictEqual(n.presses[1].from, 5); assert.strictEqual(n.presses[1].m.text, '1 up');
  t('Nassau: front 1 up, back halved, total 1 up; press from 3 won 3&2; auto-press at 2 down: A presses at 3, then B (2 down in that press after hole 4) presses at 5, A wins it 1 up');
  // Skins gross with carry-over
  const sk = S.skins([{ id: 'P1', s: [4, 3, 4, 5] }, { id: 'P2', s: [4, 4, 4, 4] }, { id: 'P3', s: [5, 4, 4, 5] }], 4);
  eq(sk.won, { P1: 2, P2: 2 }); assert.strictEqual(sk.carry, 0); assert.strictEqual(sk.holes[0].carried, 1);
  const sk2 = S.skins([{ id: 'P1', s: [4, 4, null] }, { id: 'P2', s: [4, 4, 3] }], 3); eq(sk2.won, {}); assert.strictEqual(sk2.carry, 2);
  // gross vs net skins through the golf day board (P2 gets a stroke on every hole: 18 handicap)
  const mkDay = (net) => ({ members: [{ pid: 'P1', name: 'One' }, { pid: 'P2', name: 'Two' }], day: { fmt: 'stroke', net: 'net', pct: 100, allow: [], course: COURSE, hcp: { P1: 0, P2: 18 }, teams: [{ tid: 'T1', name: 'One', players: ['P1'] }, { tid: 'T2', name: 'Two', players: ['P2'] }], matches: [], win: {}, extras: { skins: { on: true, net, amt: 5 }, ctp: [], ld: [] },
    scores: { T1: { 1: { p: { P1: 4 } }, 2: { p: { P1: 4 } }, 3: { p: { P1: 3 } }, 4: { p: { P1: 5 } } }, T2: { 1: { p: { P2: 5 } }, 2: { p: { P2: 5 } }, 3: { p: { P2: 4 } }, 4: { p: { P2: 5 } } } } } });
  const gS = G.dayBoard(mkDay(false)).skins, nS = G.dayBoard(mkDay(true)).skins;
  eq(gS.won, { P1: 3 }); assert.strictEqual(gS.carry, 1); eq(nS.won, { P2: 4 }); assert.strictEqual(nS.carry, 0);
  t('gross skins: P1 wins holes 1-3, hole 4 tied and carried; net skins: holes 1-3 tie on net and carry, P2 wins hole 4 for 4 skins');
  t('skins: tie carries, P1 wins hole 2 for 2 skins, P2 wins hole 4 for 2; unplayed hole stops with 2 carried');
  // Pick six
  const FLD = { g1: { st: 'active', toPar: -10, started: true }, g2: { st: 'active', toPar: -8, started: true }, g6: { st: 'active', toPar: 0, started: true }, g7: { st: 'active', toPar: 2, started: true }, g8: { st: 'cut', toPar: 5, started: true }, g9: { st: 'wd', toPar: 3, started: true }, g10: { st: 'wd', toPar: null, started: false } };
  const Y = ['g1', 'g8', 'g9', 'g10', 'g7', 'g6'];
  let p = S.pickSix(Y, FLD, 'w1'); assert.strictEqual(p.total, -5); eq(p.counting, ['g1', 'g6', 'g7', 'g8']); // -10 + 0 + 2 + (worst made cut 2 + 1 = 3)
  p = S.pickSix(Y, FLD, 'p10'); assert.strictEqual(p.total, 5); // -10 + 0 + 2 + (3 + 10 = 13)
  p = S.pickSix(Y, FLD, 'out'); assert.strictEqual(p.n, 3); assert.strictEqual(p.total, -8);
  const X = ['g1', 'g2', 'g8', 'g9', 'g6', 'g7'];
  const rk = S.rankSix([{ name: 'X', picks: X, guess: -12 }, { name: 'Y', picks: Y, guess: -20 }, { name: 'Z', picks: X, guess: -15 }], FLD, 'out', 'score', -14);
  eq(rk.map((x) => x.name), ['Z', 'X', 'Y']); eq(rk.map((x) => x.place), [1, 2, 3]); // X and Z tie at -16; Z's guess -15 is closer to -14; Y has only 3 counting -> last
  const rb = S.rankSix([{ name: 'X', picks: X }, { name: 'Y', picks: Y }], FLD, 'w1', 'best'); eq(rb.map((x) => x.total), [-16, -5]);
  t('pick six best four: missed cut worst+1 = -5, own+10 = 5, out-of-four = 3 counting (ranked last); tiebreak by winning-score guess');
  assert.strictEqual(S.finishPoints(1, 1), 100); assert.strictEqual(S.finishPoints(3, 2), 42.5); assert.strictEqual(S.finishPoints(40, 1), 0);
  t('one and done finish points: 1st 100, T3 of two = (45+40)/2');
  assert.strictEqual(S.checkCourse({ par: PAR, hcp: SI }), null); assert.ok(S.checkCourse({ par: PAR, hcp: SI.map(() => 1) })); assert.ok(S.checkCourse({ par: PAR.slice(0, 17), hcp: SI }));
  t('course check: every hole needs par 3-6 and a different handicap index');
})();

// ======================= feed + course parsers (fixtures) =======================
(function parsers() {
  const fx = require('./fixtures/espn-golf-leaderboard.json'), b = FEED.parseBoard(fx, 'pga');
  eq(b.golfers.map((g) => g.name), ['Bea Bravo', 'Ann Alpha', 'Eve Even', 'Cal Cutline', 'Dee Done']);
  const by = {}; b.golfers.forEach((g) => (by[g.name] = g));
  assert.strictEqual(by['Bea Bravo'].toPar, -10); assert.strictEqual(by['Bea Bravo'].thru, 'F'); assert.strictEqual(by['Ann Alpha'].toPar, -8); assert.strictEqual(by['Ann Alpha'].thru, '12'); assert.strictEqual(by['Ann Alpha'].pos, 'T2'); eq(by['Ann Alpha'].rounds, [68, 70, 34]);
  assert.strictEqual(by['Eve Even'].toPar, 0); assert.strictEqual(by['Eve Even'].thru, '9'); assert.strictEqual(by['Cal Cutline'].st, 'cut'); assert.strictEqual(by['Cal Cutline'].toPar, 5);
  assert.strictEqual(by['Dee Done'].st, 'wd'); assert.strictEqual(by['Dee Done'].started, false); assert.strictEqual(b.firstTee, Date.parse('2026-11-19T12:40Z')); assert.strictEqual(b.event.round, 3); assert.strictEqual(b.earnings, false);
  t('ESPN fixture: order by sortOrder, to-par (object/string/E), thru (number/object/F), CUT and WD status, rounds, first tee time');
  const c = CO.normCourse(require('./fixtures/opengolfapi-course.json'));
  assert.strictEqual(c.tees.length, 2); eq(c.tees[0].holes, [{ n: 1, par: 4, hcp: 3, yards: 410 }, { n: 2, par: 3, hcp: 17, yards: 180 }]); assert.strictEqual(c.tees[1].holes[0].yards, 380); assert.strictEqual(c.tees[0].rating, 72.1); assert.strictEqual(c.tees[0].slope, 128); assert.ok(/ODbL/.test(c.attribution));
  t('OpenGolfAPI fixture: tees with rating/slope/yards, holes sorted with par, index and that tee\'s yards');
})();

// ======================= server: fakes =======================
let db = {}, slow = 0, lost = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
D.S = {
  dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
const ACC = (w) => w + '@phone.oddable';
D.acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
let NOW = Date.parse('2026-11-18T18:00:00Z'); D.now = () => NOW;
// fake tour feed (event E1 first tee Nov 19 12:00Z)
const TEE = Date.parse('2026-11-19T12:00:00Z');
const mkG = (i, o) => Object.assign({ id: 'p' + i, name: 'Golfer ' + String(i).padStart(2, '0'), pos: '', toPar: null, today: null, thru: '', rounds: [], st: 'active', tee: TEE + i * 60e3, started: false, earn: null, sort: i }, o || {});
let FIELD = Array.from({ length: 50 }, (_, i) => mkG(i + 1)), EV = { E1: { done: false }, E2: { done: false, tee: Date.parse('2026-11-26T12:00:00Z') } }, feedDown = false;
D.feed = { events: async () => [{ id: 'E1', name: 'Test Classic' }], board: async (tour, ev) => { if (feedDown) throw new Error('down'); const e = EV[ev] || EV.E1; const gs = (e.field || FIELD).map((g) => Object.assign({}, g)); return { event: { id: ev, tour, name: ev === 'E2' ? 'Next Open' : 'Test Classic', start: e.tee || TEE, end: (e.tee || TEE) + 4 * 864e5, state: e.done ? 'post' : 'pre', done: !!e.done }, golfers: gs, firstTee: Math.min(...gs.map((g) => g.tee || Infinity).filter(Number.isFinite)) || null, earnings: !!e.earnings }; } };
D.courses = { search: async () => { throw new Error('down'); }, detail: async () => CO.normCourse(require('./fixtures/opengolfapi-course.json')), ATTR: CO.ATTR };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/golf/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(Object.assign({ myName: who ? who[0].toUpperCase() + who.slice(1) : '' }, b || {})) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));

srv.listen(0, async () => {
  P = srv.address().port; let r;
  try {
    r = await call(null, 'mine'); assert.strictEqual(r.s, 401); t('signed-out request refused (401)');
    // ---------------- PRO: pick six ----------------
    r = await call('ann', 'create', { kind: 'pro', title: 'Sunday Crew six', pro: { tour: 'pga', game: 'six', eventId: 'E1', mc: 'w1', tb: 'score', rank: 'Golfer 50\nGolfer 49' }, pot: { entry: 20, take: { kind: 'pct', v: 10 } } }); ok(r, 'create pro');
    const pro = r.j.game; assert.strictEqual(pro.role, 'org'); assert.strictEqual(pro.tiers.length, 6); eq(pro.tiers[0].slice(0, 2), ['p50', 'p49']); eq(pro.tiers.map((x) => x.length), [6, 6, 8, 10, 12, 8]); assert.ok(/^[A-Z2-9]{10}$/.test(pro.code));
    t('pick six created: six tiers (6/6/8/10/12/rest) from the organizer ranking list, then feed order');
    r = await call(null, 'preview', { code: 'golf.' + pro.code.toLowerCase() }); ok(r, 'public preview'); eq(Object.keys(r.j).sort(), ['kind', 'title']); assert.strictEqual(r.j.title, 'Sunday Crew six');
    for (let i = 0; i < 10; i++) { r = await call(null, 'preview', { code: 'ZZZZZZZZZ' + i }, '5.5.5.5'); assert.strictEqual(r.s, 404); }
    r = await call(null, 'preview', { code: pro.code }, '5.5.5.5'); assert.strictEqual(r.s, 429);
    t('public preview by code returns only title + kind; 10 wrong codes block the IP');
    r = await call('bob', 'join', { code: pro.code }); ok(r); const bobPid = r.j.game.me; r = await call('cat', 'join', { code: pro.code }); ok(r);
    const T = pro.tiers, pk = (k) => T.map((tier) => tier[k]);
    r = await call('bob', 'pick', { id: pro.id, picks: pk(0) }); assert.strictEqual(r.s, 400, 'tiebreak guess required');
    r = await call('bob', 'pick', { id: pro.id, picks: [T[1][0]].concat(pk(0).slice(1)), guess: -12 }); assert.strictEqual(r.s, 400, 'wrong tier');
    r = await call('bob', 'pick', { id: pro.id, picks: pk(0), guess: -12 }); ok(r); r = await call('cat', 'pick', { id: pro.id, picks: pk(1), guess: -18 }); ok(r);
    r = await call('ann', 'get', { id: pro.id }); ok(r); const eB = r.j.game.entries.find((x) => x.pid === bobPid); assert.strictEqual(eB.picks, null, 'others\' picks hidden before the lock'); assert.strictEqual(eB.total, null);
    feedDown = true; r = await call('cat', 'pick', { id: pro.id, picks: pk(2), guess: -18 }); assert.strictEqual(r.s, 503, 'feed down: fail closed'); feedDown = false;
    NOW = TEE + 61e3; r = await call('cat', 'pick', { id: pro.id, picks: pk(2), guess: -18 }); assert.strictEqual(r.s, 409); assert.ok(/locked/i.test(r.j.error));
    r = await call('ann', 'get', { id: pro.id }); assert.ok(r.j.game.entries.find((x) => x.pid === bobPid).picks, 'shown after the lock');
    t('picks: one per tier, guess required, hidden from others until the first tee, refused after the first tee time (server clock), fail closed when the feed is down');
    // WD swap: bob's tier-6 golfer withdraws before teeing off
    const wdId = pk(0)[5], rep = T[5][3]; FIELD = FIELD.map((g) => (g.id === wdId ? Object.assign(g, { st: 'wd', started: false }) : g.id === rep ? Object.assign(g, { tee: NOW + 3600e3 }) : g));
    r = await call('bob', 'swap', { id: pro.id, from: pk(0)[0], to: rep }); assert.strictEqual(r.s, 409, 'only a WD-before-tee golfer');
    r = await call('bob', 'swap', { id: pro.id, from: wdId, to: T[4][0] }); assert.strictEqual(r.s, 400, 'same tier');
    r = await call('bob', 'swap', { id: pro.id, from: wdId, to: rep }); ok(r); assert.strictEqual(r.j.game.mine.picks[5], rep); assert.ok(r.j.game.mine.swap);
    FIELD = FIELD.map((g) => (g.id === pk(0)[4] ? Object.assign(g, { st: 'wd', started: false }) : g));
    r = await call('bob', 'swap', { id: pro.id, from: pk(0)[4], to: T[4][3] }); assert.strictEqual(r.s, 409); assert.ok(/already used/.test(r.j.error));
    t('WD before teeing off: one free swap within the same tier to a golfer not yet teed off; a second swap refused');
    // scoring through the server: play it out
    FIELD = FIELD.map((g, i) => Object.assign(g, { started: true, toPar: g.st === 'wd' ? null : -10 + (i % 15), thru: 'F' })); EV.E1.done = true;
    r = await call('cat', 'get', { id: pro.id }); ok(r); assert.ok(r.j.game.entries.length === 2 && r.j.game.entries[0].place === 1 && r.j.game.entries[0].n === 4);
    t('pool board: entries ranked by best four once the event runs');
    // ---------------- PRO: one and done ----------------
    NOW = Date.parse('2026-11-18T18:00:00Z');
    r = await call('ann', 'create', { kind: 'pro', title: 'OAD 2026', pro: { tour: 'pga', game: 'oad' } }); ok(r); const oad = r.j.game; await call('bob', 'join', { code: oad.code });
    EV.E3 = { done: false, tee: Date.parse('2026-11-25T12:00:00Z') }; EV.E1.done = false;
    r = await call('bob', 'pick', { id: oad.id, event: 'E1', golfer: 'p7' }); ok(r); r = await call('bob', 'pick', { id: oad.id, event: 'E3', golfer: 'p7' }); assert.strictEqual(r.s, 409); assert.ok(/never the same golfer/.test(r.j.error));
    r = await call('bob', 'pick', { id: oad.id, event: 'E1', golfer: 'p8' }); ok(r, 'changing this event\'s pick frees the old golfer'); r = await call('bob', 'pick', { id: oad.id, event: 'E3', golfer: 'p7' }); ok(r);
    EV.E1.done = true; FIELD = FIELD.map((g) => Object.assign(g, { pos: g.id === 'p8' ? '1' : g.pos }));
    NOW = TEE + 5 * 864e5; r = await call('bob', 'get', { id: oad.id }); ok(r); const ev1 = r.j.game.oad.events.find((e) => e.id === 'E1'); assert.strictEqual(ev1.by, 'points'); assert.strictEqual(r.j.game.table.find((x) => x.pid === r.j.game.me).total, 100);
    t('one and done: reuse refused across the season; changing a pick before lock frees the golfer; scored by finish points (feed has no prize money) -> win = 100');
    NOW = Date.parse('2026-11-18T18:00:00Z');
    // ---------------- GOLF DAY ----------------
    const course = { name: 'Palm Valley', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 70.1, slope: 121 };
    r = await call('ann', 'create', { kind: 'day', title: 'Crew Golf Day', course: Object.assign({}, course, { slope: 160 }), day: { fmt: 'scramble4' } }); assert.strictEqual(r.s, 400); assert.ok(/Slope/.test(r.j.error));
    r = await call('ann', 'create', { kind: 'day', title: 'Crew Golf Day', course: Object.assign({}, course, { rating: 40 }), day: { fmt: 'scramble4' } }); assert.strictEqual(r.s, 400);
    t('course check: slope 55-155 and rating near par');
    r = await call('ann', 'create', { kind: 'day', title: 'Crew Golf Day', course, day: { fmt: 'bestball', count: 2, pct: 100, teams: 2, teamSize: 4, net: 'net', extras: { skins: { on: true, net: true, amt: 5 }, ctp: [3], ld: [4] }, hu: { on: true, kind: 'team', type: 'nassau', amt: 20, pair: 'pick' }, myHcp: 10 } }); ok(r, 'create day');
    const day = r.j.game; assert.strictEqual(day.day.teams.length, 2);
    r = await call('ann', 'courses', { q: 'palm' }); ok(r); assert.strictEqual(r.j.courses.length, 1, 'typed-in course saved'); assert.strictEqual(r.j.api.ok, false, 'API down: saved list still answers');
    // 8-person cap (standard): ann + 7 more
    const ppl = ['bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal']; for (const w of ppl) { r = await call(w, 'join', { code: day.code, hcp: 12 }); ok(r, w); }
    r = await call('ivy', 'join', { code: day.code }); assert.strictEqual(r.s, 409); assert.ok(/Up to 8|up to 8/.test(r.j.error));
    db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('ann')]: true } }, updated: 1 }; G._reset(); r = await call('ivy', 'join', { code: day.code }); ok(r, 'enterprise organizer lifts the cap');
    r = await call('ann', 'leave', { id: day.id }); assert.strictEqual(r.s, 409); r = await call('ivy', 'leave', { id: day.id }); ok(r); delete db['lock:ent']; G._reset();
    t('8-person cap for standard accounts (9th refused with the contact line); enterprise flag lifts it');
    // teams: claim + assign
    r = await call('bob', 'join', { code: day.code, tid: 'T1' }); ok(r); r = await call('bob', 'team', { id: day.id, op: 'assign', pid: r.j.game.me, tid: 'T2' }); assert.strictEqual(r.s, 403, 'only the organizer assigns');
    let g = (await call('ann', 'get', { id: day.id })).j.game; const pid = {}; g.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid));
    for (const w of ['ann', 'cat', 'dan']) { r = await call('ann', 'team', { id: day.id, op: 'assign', pid: pid[w], tid: 'T1' }); ok(r); }
    for (const w of ['eve', 'fay', 'gus', 'hal']) { r = await call('ann', 'team', { id: day.id, op: 'assign', pid: pid[w], tid: 'T2' }); ok(r); }
    r = await call('ann', 'team', { id: day.id, op: 'assign', pid: pid.hal, tid: 'T1' }); assert.strictEqual(r.s, 409, 'team full');
    r = await call('ann', 'team', { id: day.id, op: 'scorer', tid: 'T2', pid: pid.eve }); ok(r); r = await call('ann', 'team', { id: day.id, op: 'scorer', tid: 'T1', pid: pid.bob }); ok(r);
    r = await call('ann', 'team', { id: day.id, op: 'hcp', pid: pid.cat, hcp: 20 }); ok(r);
    r = await call('ann', 'match', { id: day.id, op: 'add', a: 'T1', b: 'T2' }); ok(r); const mid = r.j.game.day.matches[0].mid;
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: { [pid.bob]: 4 } }); assert.strictEqual(r.s, 409, 'not started');
    r = await call('ann', 'start', { id: day.id }); ok(r);
    t('teams: player claims an open slot, organizer assigns, team full refused, scorers set, round starts');
    // scorer rules
    const full = (n) => ({ [pid.bob]: n, [pid.ann]: n, [pid.cat]: n, [pid.dan]: n });
    r = await call('cat', 'score', { id: day.id, tid: 'T1', hole: 1, p: full(4) }); assert.strictEqual(r.s, 403, 'not the scorer');
    r = await call('bob', 'score', { id: day.id, tid: 'T2', hole: 1, p: {} }); assert.strictEqual(r.s, 403, 'other team');
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: { [pid.bob]: 4 } }); assert.strictEqual(r.s, 400, 'every player needs a score');
    // concurrency: 9 holes in parallel with random DB delays
    slow = 25; lost = 0; const rs = await Promise.all(Array.from({ length: 9 }, (_, i) => call('bob', 'score', { id: day.id, tid: 'T1', hole: i + 1, p: full(PAR[i]), eid: 'e' + i }))); slow = 0;
    rs.forEach((x) => ok(x)); g = (await call('bob', 'get', { id: day.id })).j.game; assert.strictEqual(Object.keys(g.day.scores.T1).length, 9);
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: full(PAR[0]), eid: 'e0' }); ok(r); assert.strictEqual(r.j.dup, true);
    t('9 holes entered at once (' + lost + ' conflicting writes redone, none lost); a retried entry (same eid) is harmless');
    // stale rev -> 409 with the current value
    r = await call('ann', 'score', { id: day.id, tid: 'T1', hole: 2, p: full(6), rev: 1 }); ok(r, 'organizer corrects hole 2');
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 2, p: full(5), rev: 1 }); assert.strictEqual(r.s, 409); assert.ok(r.j.current && r.j.current.rev === 2);
    t('a stale phone (old rev) cannot overwrite a newer entry: 409 with the current score');
    // T2 holes 1-9: all par except they bogey everything after hole 4
    for (let i = 0; i < 9; i++) { r = await call('eve', 'score', { id: day.id, tid: 'T2', hole: i + 1, p: { [pid.eve]: PAR[i] + (i > 3 ? 1 : 0), [pid.fay]: PAR[i] + 1, [pid.gus]: PAR[i] + 2, [pid.hal]: PAR[i] + 2 } }); ok(r); }
    // confirm / dispute
    r = await call('bob', 'confirm', { id: day.id, tid: 'T1', from: 1, to: 9 }); assert.strictEqual(r.s, 403, 'cannot confirm your own team');
    r = await call('cat', 'confirm', { id: day.id, tid: 'T2', from: 1, to: 9 }); assert.strictEqual(r.s, 403, 'not a scorer');
    r = await call('eve', 'dispute', { id: day.id, tid: 'T1', hole: 3, note: 'Was a 4' }); ok(r); r = await call('eve', 'confirm', { id: day.id, tid: 'T1', from: 1, to: 9 }); ok(r);
    g = r.j.game; assert.strictEqual(g.day.scores.T1[3].st, 'disputed'); assert.strictEqual(g.day.scores.T1[1].st, 'confirmed');
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: full(3) }); assert.strictEqual(r.s, 409, 'confirmed hole locked for the scorer');
    r = await call('ann', 'final', { id: day.id }); assert.strictEqual(r.s, 409, 'disputes block final');
    r = await call('ann', 'resolve', { id: day.id, tid: 'T1', hole: 3, p: full(4) }); ok(r); assert.strictEqual(r.j.game.day.scores.T1[3].st, 'confirmed');
    assert.ok(r.j.game.day.audit.some((a) => a.what === 'disputed') && r.j.game.day.audit.some((a) => a.what === 'settled' && a.from && a.from.note === 'Was a 4'));
    t('confirm/dispute: other team\'s scorer confirms the turn, flags hole 3; confirmed holes lock; organizer settles; audit keeps who/what/before');
    // the board after nine: T1 best two net
    const bd = r.j.game.board; assert.strictEqual(bd.rows[0].tid, 'T1'); assert.strictEqual(bd.rows[0].thru, 9);
    const mt = bd.matches.find((x) => x.mid === mid); assert.ok(mt.nassau); assert.ok(mt.nassau.front.played >= 7 && mt.nassau.front.up > 0, JSON.stringify(mt.nassau.front));
    r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 10 }); ok(r, 'scorer presses');
    r = await call('cat', 'match', { id: day.id, op: 'press', mid, from: 11 }); assert.strictEqual(r.s, 403);
    assert.ok(bd.skins && bd.skins.net === true);
    r = await call('bob', 'extra', { id: day.id, kind: 'ctp', hole: 3, who: pid.cat, note: '4 ft 2 in' }); ok(r); r = await call('cat', 'extra', { id: day.id, kind: 'ctp', hole: 3, who: pid.cat }); assert.strictEqual(r.s, 403);
    r = await call('bob', 'extra', { id: day.id, kind: 'ld', hole: 9, who: pid.cat }); assert.strictEqual(r.s, 400);
    t('board: T1 leads after 9; Nassau front tracked; press by a scorer only; closest to the pin entered by a scorer');
    // guests + solo
    r = await call('ann', 'team', { id: day.id, op: 'guest', name: 'Uncle Joe' }); assert.strictEqual(r.s, 409, 'cap counts guests too (8)');
    r = await call('zed', 'create', { kind: 'day', solo: true, title: 'Solo round', course, day: { fmt: 'stroke', myHcp: 9 } }); ok(r); const solo = r.j.game; assert.strictEqual(solo.day.status, 'live'); assert.strictEqual(solo.day.teams[0].players.length, 1);
    for (let i = 0; i < 18; i++) { r = await call('zed', 'score', { id: solo.id, tid: 'T1', hole: i + 1, p: { [solo.me]: PAR[i] + (i % 3 === 0 ? 1 : 0) }, putts: 2 }); ok(r); }
    r = await call('zed', 'final', { id: solo.id }); ok(r);
    r = await call('zed', 'create', { kind: 'day', title: 'Guest day', course, day: { fmt: 'scramble2', teams: 1 } }); ok(r); const gd = r.j.game;
    r = await call('zed', 'team', { id: gd.id, op: 'guest', name: 'Uncle Joe', hcp: 18, tid: 'T1' }); ok(r); assert.ok(r.j.guest && /^[0-9a-f]{32}$/.test(r.j.guest.token)); const guest = r.j.guest;
    assert.ok(!JSON.stringify(r.j.game).includes(guest.token), 'token not in the game view');
    t('one-player round is a valid game (live at once, 18 holes, final); guests typed in by name get a claim token shown once');
    // ---------------- stats contract ----------------
    const st = await G.statsFor(ACC('zed'), { from: '2026-01-01', to: '2026-12-31' }); const rd = st.find((x) => x.kind === 'golf-round');
    assert.strictEqual(rd.src, 'golf'); assert.strictEqual(rd.sport, 'golf'); assert.strictEqual(rd.score, 72 + 6); assert.strictEqual(rd.toPar, 6); assert.strictEqual(rd.extra.course, 'Palm Valley'); assert.strictEqual(rd.extra.holes, 18); assert.strictEqual(rd.extra.putts, 36); assert.strictEqual(rd.extra.slope, 121); assert.strictEqual(rd.extra.holeScores.length, 18); assert.strictEqual(rd.extra.solo, true); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rd.date)); assert.strictEqual(typeof rd.verified, 'boolean');
    const sa = await G.statsFor(ACC('cat'), {}); assert.ok(sa.some((x) => x.kind === 'golf-pool' && x.place && x.place.of === 2)); assert.ok(sa.some((x) => x.kind === 'golf-round' && /closest/.test(x.title) && x.result === 'W'));
    assert.ok(sa.some((x) => x.kind === 'golf-round' && x.extra && x.extra.course === 'Palm Valley' && x.extra.holes === 9 && x.extra.who === undefined));
    const sb = await G.statsFor(ACC('bob'), {}); assert.ok(sb.some((x) => x.kind === 'golf-pool' && /Next Open|Test Classic/.test(x.title)), 'one and done record');
    const sg = await G.statsFor('guest:' + guest.gid, {}); assert.strictEqual(sg.length, 0, 'guest has no strokes yet'); assert.deepStrictEqual(await G.statsFor(ACC('nobody'), {}), []);
    assert.strictEqual((await G.statsFor(ACC('zed'), { from: '2027-01-01' })).length, 0, 'date filter');
    t('statsFor: solo round (score, toPar, course, slope, putts, hole-by-hole), pool place, one-and-done, closest-to-pin win, guest keys, date filter');
    // ---------------- adapter ----------------
    const lots = await G.teams(day.id); assert.strictEqual(lots.length, 2); assert.ok(lots[0].id.startsWith('t:' + day.id));
    const gl = await G.golfers('E1', 'pga'); assert.ok(gl.length >= 48 && gl[0].id.startsWith('g:'));
    const ps = await G.potSummary(pro.id); assert.strictEqual(ps.entry, 20); assert.strictEqual(ps.entrants, 3); assert.strictEqual(ps.potTotal, 0);
    await assert.rejects(G.attach(day.id, 'GRP1', ACC('bob'))); await G.attach(day.id, 'GRP1', ACC('ann'), 'C1'); assert.strictEqual((await call('ann', 'get', { id: day.id })).j.game.groupId, 'GRP1');
    assert.strictEqual(G.isGolfBet({ lg: 'golf' }), true); assert.strictEqual(G.isGolfBet({ kt: 'KXPGATOUR-26' }), true); assert.strictEqual(G.isGolfBet({ home: 'KC', away: 'BUF' }), false);
    t('adapter: teams() and golfers() lots, potSummary, attach (organizer only), isGolfBet');
    // ---------------- privacy ----------------
    const all = raw.join('\n'); ['@phone.oddable', '"mk"', '"org":"', 'orgE', '"tok"'].forEach((s) => assert.ok(!all.includes(s), 'leaked ' + s));
    t('no account ids, member keys or guest token hashes in any response');
    console.log('\nALL ' + pass + ' CHECKS PASSED'); srv.close(); process.exit(0);
  } catch (e) { console.error('FAIL', e); srv.close(); process.exit(1); }
});
