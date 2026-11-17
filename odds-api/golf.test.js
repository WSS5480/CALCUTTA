// Run: node odds-api/golf.test.js   (no network, no database: Supabase, ESPN, OpenGolfAPI and sign-in are in-memory fakes)
'use strict';
const assert = require('assert'), http = require('http'), S = require('./golf-score'), FEED = require('./golf-feed'), CO = require('./golf-courses'), G = require('./golf'), D = G._deps;
require('./golf.fakestats').install(G); // the stats module is not in this branch: a fake with the same handicap contract (golf keeps no index or log of its own)
// THE SUITE BRINGS ITS OWN LIMITS AND GROUPS (integration, Nov 16 2026), so it runs unchanged in the merged build, where limits.js and groups.js exist: its
// Enterprise checks use golf's own 'lock:ent' stand-in row and its attach checks plug in their own fake Groups module. Nobody has to pin anything by hand.
D.limitsMod = () => null; D.groups = () => null;
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


// ======================= golf day boards, hand-worked over full rounds =======================
(function boards() {
  const base = (fmt, teams, hcp, scores, o) => ({ members: Object.keys(hcp).map((p) => ({ pid: p, name: p })), day: Object.assign({ fmt, net: 'net', pct: 100, allow: [], count: null, drives: null, course: COURSE, hcp, teams, matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] }, scores }, o || {}) });
  const all = (f) => { const o = {}; PAR.forEach((par, i) => (o[i + 1] = f(par, i))); return o; };
  // 4-person scramble, COMMISSIONER-SET allowance 30/20/10/0 (not the default): 8,12,20,30 -> 2.4 + 2.4 + 2 + 0 = 6.8 -> 7 strokes on SI 1-7. Gross par every hole: 72 gross, 65 net.
  let c = base('scramble4', [{ tid: 'T1', name: 'A', players: ['a', 'b', 'c', 'd'] }], { a: 30, b: 8, c: 20, d: 12 }, { T1: all((par) => ({ g: par })) }, { allow: [30, 20, 10, 0] });
  let r = G.dayBoard(c).rows[0]; assert.strictEqual(r.thcp, 6.8); assert.strictEqual(r.gross, 72); assert.strictEqual(r.net, 65); assert.strictEqual(r.toParN, -7); assert.strictEqual(r.thru, 18);
  c.day.net = 'gross'; r = G.dayBoard(c).rows[0]; assert.strictEqual(G.dayBoard(c).by, 'gross'); assert.strictEqual(r.toParG, 0);
  t('4-person scramble net with a commissioner-set allowance 30/20/10/0: team 6.8 -> 7 strokes on index 1-7, par round = 65 net (-7); gross view E');
  // Texas scramble drive count through the board: 3 players, min 4 drives; drives A x10, B x4, C x2 after 16 holes -> C needs 2 with 2 left (warning), not impossible
  const dr = [].concat(Array(10).fill('A'), Array(4).fill('B'), Array(2).fill('C')); c = base('texas', [{ tid: 'T1', name: 'Tx', players: ['A', 'B', 'C'] }], { A: 0, B: 0, C: 0 }, { T1: {} }, { drives: 4 });
  dr.forEach((p, i) => (c.day.scores.T1[i + 1] = { g: PAR[i], drive: p })); r = G.dayBoard(c).rows[0];
  eq(r.drives.count, { A: 10, B: 4, C: 2 }); eq(r.drives.need, { A: 0, B: 0, C: 2 }); assert.strictEqual(r.drives.left, 2); assert.strictEqual(r.drives.impossible, false); eq(r.drives.warn, ['C']);
  t('Texas scramble board: drives counted per player from the entered holes (10/4/2 after 16), C needs 2 with 2 left -> warned');
  // Best ball 2 of 4 gross over two holes: hole 1 (par 4) 5,4,6,4 -> 8; hole 2 (par 4) 3,5,5,4 -> 7 -> 15 gross vs par 16 = -1
  c = base('bestball', [{ tid: 'T1', name: 'BB', players: ['a', 'b', 'c', 'd'] }], { a: 0, b: 0, c: 0, d: 0 }, { T1: { 1: { p: { a: 5, b: 4, c: 6, d: 4 } }, 2: { p: { a: 3, b: 5, c: 5, d: 4 } } } }, { count: 2, net: 'gross' });
  r = G.dayBoard(c).rows[0]; assert.strictEqual(r.gross, 15); assert.strictEqual(r.toParG, -1); assert.strictEqual(r.thru, 2);
  t('best ball 2 of 4 board: 8 + 7 = 15 against par 16 (-1) after 2 holes');
  // Shamble best 1 net at 80%, one hole: handicaps 10/20 -> 8/16; hole 4 (par 5, SI 1): a 6-1 = 5, b 7-1 = 6 -> 5 net
  c = base('shamble', [{ tid: 'T1', name: 'Sh', players: ['a', 'b'] }], { a: 10, b: 20 }, { T1: { 4: { p: { a: 6, b: 7 } } } }, { count: 1, pct: 80 });
  r = G.dayBoard(c).rows[0]; assert.strictEqual(r.net, 5); assert.strictEqual(r.toParN, 0);
  t('shamble best 1 net at 80% (8/16 strokes): hole index 1, 6 and 7 gross -> 5 net = par');
  // Alternate shot and Chapman over a full par round: team 12 (50/50 of 10,14) -> 12 strokes -> 60 net; Chapman 60/40 of 10,20 = 14 -> 58 net
  c = base('altshot', [{ tid: 'T1', name: 'Alt', players: ['a', 'b'] }], { a: 10, b: 14 }, { T1: all((par) => ({ g: par })) }, { allow: [50, 50] }); assert.strictEqual(G.dayBoard(c).rows[0].net, 60);
  c = base('chapman', [{ tid: 'T1', name: 'Ch', players: ['a', 'b'] }], { a: 20, b: 10 }, { T1: all((par) => ({ g: par })) }, { allow: [60, 40] }); assert.strictEqual(G.dayBoard(c).rows[0].net, 58);
  t('alternate shot 50/50 (team 12) and Chapman 60/40 (team 14) over a par round: 60 and 58 net');
  // Stableford over 18: 18-handicap player making bogey every hole = net par = 2 points x 18 = 36; scratch player at par = 36 too, birdie on 1 -> 37 wins
  c = base('stableford', [{ tid: 'T1', name: 'High', players: ['h'] }, { tid: 'T2', name: 'Low', players: ['l'] }], { h: 18, l: 0 }, { T1: all((par) => ({ p: { h: par + 1 } })), T2: all((par, i) => ({ p: { l: par - (i === 0 ? 1 : 0) } })) });
  let b = G.dayBoard(c); assert.strictEqual(b.rows[0].name, 'Low'); assert.strictEqual(b.rows[0].pts, 37); assert.strictEqual(b.rows[1].pts, 36); assert.strictEqual(b.rows[0].place, 1);
  t('Stableford board: bogey golfer off 18 = 36 points, scratch with one birdie = 37 and leads (most points wins)');
  // Stroke play net with a commissioner percent (50%): 20 -> 10 strokes; 82 gross -> 72 net
  c = base('stroke', [{ tid: 'T1', name: 'S', players: ['s'] }], { s: 20 }, { T1: all((par, i) => ({ p: { s: par + (i < 10 ? 1 : 0) } })) }, { pct: 50 }); r = G.dayBoard(c).rows[0]; assert.strictEqual(r.gross, 82); assert.strictEqual(r.net, 72);
  t('stroke play net at a commissioner-set 50%: 20 handicap -> 10 strokes, 82 gross -> 72 net');
  // Net skins at 50% with carry-over: P2 (18 -> 9 strokes, SI 1-9). Hole 1 (SI 7): P1 4, P2 5-1=4 tie (carry); hole 2 (SI 3): P1 5, P2 5-1=4 -> P2 wins 2 skins; hole 3 (SI 15): P1 3, P2 4 -> P1 1
  c = base('skins', [{ tid: 'T1', name: 'One', players: ['P1'] }, { tid: 'T2', name: 'Two', players: ['P2'] }], { P1: 0, P2: 18 }, { T1: { 1: { p: { P1: 4 } }, 2: { p: { P1: 5 } }, 3: { p: { P1: 3 } } }, T2: { 1: { p: { P2: 5 } }, 2: { p: { P2: 5 } }, 3: { p: { P2: 4 } } } }, { pct: 50 });
  b = G.dayBoard(c); eq(b.skins.won, { P2: 2, P1: 1 }); assert.strictEqual(b.skins.net, true); assert.strictEqual(b.skins.holes[0].carried, 1);
  c.day.net = 'gross'; b = G.dayBoard(c); eq(b.skins.won, { P1: 3 }); assert.strictEqual(b.skins.carry, 0); // gross: hole 1 P1 4<5 wins, hole 2 tie carries, hole 3 P1 wins 2
  t('skins format: net at 50% (P2 wins hole 2 for 2 after a carry, P1 wins hole 3); gross: P1 wins hole 1, hole 2 carries, P1 takes 2 on hole 3 (3 in all)');
  // Heads-up player match, net, strokes off the low side: P1 4, P2 10 -> P2 gets 6 strokes on SI 1-6. Both make par everywhere except P1 birdies holes 1, 3, 7 (SI 7, 15, 17)
  // net: P2 wins holes with SI 1-6 = holes 2,4,6,11,13,15 (6 holes); P1 wins 1,3,7 -> P2 3 up after 18 (match ends 3 up when decided: closed out?)
  c = base('stroke', [{ tid: 'T1', name: 'One', players: ['P1'] }, { tid: 'T2', name: 'Two', players: ['P2'] }], { P1: 4, P2: 10 }, { T1: all((par, i) => ({ p: { P1: par - ([0, 2, 6].includes(i) ? 1 : 0) } })), T2: all((par) => ({ p: { P2: par } })) });
  const m = G.matchState(c, { mid: 'm1', kind: 'player', type: 'match', a: 'P1', b: 'P2', net: true, offLow: true });
  // hole by hole (a=P1): 1 W, 2 L(SI3), 3 W, 4 L(SI1), 5 -, 6 L(SI5), 7 W, 8-10 -, 11 L(SI4), 12 -, 13 L(SI2) -> P2 2 up with 5 left; 14 -, 15 L(SI6) -> 3 up with 3 left (dormie); 16 halved -> P2 wins 3&2
  assert.strictEqual(m.m.res, 'L'); assert.strictEqual(m.m.text, '3&2'); assert.strictEqual(m.m.played, 16); assert.ok(m.m.closed);
  const m2 = G.matchState(c, { mid: 'm2', kind: 'player', type: 'match', a: 'P1', b: 'P2', net: false }); assert.strictEqual(m2.m.res, 'W'); assert.strictEqual(m2.m.text, '3&2'); assert.strictEqual(m2.m.short, '3&2'); assert.ok(m2.m.closed);
  t('heads-up net match, strokes off the low side by hole index (6 to P2 on index 1-6): dormie after 15, P2 closes it out 3&2 on 16; gross: P1 wins 3&2');
  // short forms + dormie
  let s0 = S.match(Array(18).fill(null), Array(18).fill(null), 0, 18); assert.strictEqual(s0.short, 'AS'); assert.strictEqual(s0.text, 'All square');
  s0 = S.match([3, 3, 4].concat(Array(15).fill(null)), [4, 4, 4].concat(Array(15).fill(null)), 0, 18); assert.strictEqual(s0.short, '2 UP');
  s0 = S.match(Array(16).fill(4).map((v, i) => (i < 2 ? 3 : 4)).concat([null, null]), Array(16).fill(4).concat([null, null]), 0, 18); assert.ok(s0.dormie); assert.strictEqual(s0.short, '2 UP');
  s0 = S.match(Array(18).fill(4), Array(18).fill(4), 0, 18); assert.strictEqual(s0.short, 'HALVED');
  t('match short forms: AS before a hole, 2 UP, dormie 2 UP with 2 to play, HALVED');
  // Nassau through the board with a manual press on the back nine (player vs player, gross)
  c = base('nassau', [{ tid: 'T1', name: 'One', players: ['P1'] }, { tid: 'T2', name: 'Two', players: ['P2'] }], { P1: 0, P2: 0 }, { T1: all((par, i) => ({ p: { P1: par + (i >= 9 && i <= 11 ? 1 : 0) } })), T2: all((par, i) => ({ p: { P2: par - (i === 0 ? 1 : 0) } })) }, { net: 'gross' });
  const nz = G.matchState(c, { mid: 'n', kind: 'player', type: 'nassau', a: 'P1', b: 'P2', net: false, presses: [{ nine: 'back', from: 13 }] }).nassau;
  // front: P2 wins hole 1 -> P2 1 up; back: P2 wins 10, 11, 12 -> 3 up, halved to 16 -> 3&2; total P2 4 up; press from 13: halved
  assert.strictEqual(nz.front.res, 'L'); assert.strictEqual(nz.back.res, 'L'); assert.strictEqual(nz.back.text, '3&2'); assert.strictEqual(nz.total.res, 'L'); assert.strictEqual(nz.total.text, '4&3'); assert.strictEqual(nz.presses[0].m.text, 'Halved');
  t('Nassau board: front lost 1 up, back lost 3&2, total closed out 4&3, back-nine press from 13 halved');
})();


// ======================= review fixes (Nov 16 2026), pure =======================
(function reviewPure() {
  const all = (f) => { const o = {}; PAR.forEach((par, i) => (o[i + 1] = f(par, i))); return o; };
  // R5 four-ball net, hand-worked: A = 0 + 18, B = 9 + 9, best ball net, 100%, strokes off the low player (0): a1 0, a2 18 (one a hole), b1 9, b2 9 (index 1-9).
  // Everyone makes gross par on every hole except hole 3 (par 3, index 15): a1 4, a2 4, b1 3, b2 4.
  // Per hole net best ball: A = par - 1 everywhere (a2's stroke), except hole 3: A min(4, 4-1) = 3, B = 3 -> halved.
  // B = par - 1 on index 1-9, par on index 10-18. So index 1-9 holes are halved and A wins every index 10-18 hole but hole 3:
  // holes 5, 7, 8 (A 3 up after 8), 12 (4 up), 14 (5 up with 4 to play) -> A wins 5&4.
  // (The old method averaged 9 v 9 = no strokes and played team gross: every hole halved but hole 3, which B won -> B 1 up.)
  const c = { members: ['a1', 'a2', 'b1', 'b2'].map((p) => ({ pid: p, name: p })), day: { fmt: 'bestball', net: 'net', pct: 100, count: 1, allow: [], course: COURSE, hcp: { a1: 0, a2: 18, b1: 9, b2: 9 },
    teams: [{ tid: 'A', name: 'A', players: ['a1', 'a2'] }, { tid: 'B', name: 'B', players: ['b1', 'b2'] }], matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] },
    scores: { A: all((par, i) => ({ p: i === 2 ? { a1: 4, a2: 4 } : { a1: par, a2: par } })), B: all((par, i) => ({ p: i === 2 ? { b1: 3, b2: 4 } : { b1: par, b2: par } })) } } };
  const m = G.matchState(c, { mid: 'x', kind: 'team', type: 'match', a: 'A', b: 'B', net: true, offLow: true });
  assert.strictEqual(m.m.holes[2], 0, 'hole 3 halved'); eq(m.m.holes.slice(0, 8), [0, 0, 0, 0, 1, 0, 1, 1]); assert.strictEqual(m.m.res, 'W'); assert.strictEqual(m.m.text, '5&4');
  const m0 = G.matchState(c, { mid: 'y', kind: 'team', type: 'match', a: 'A', b: 'B', net: false }); assert.strictEqual(m0.m.res, 'L'); assert.strictEqual(m0.m.text, '1 up'); // gross best ball: B's birdie on 3
  t('R5 four-ball net (0+18 vs 9+9): strokes per player off the low player, best ball net per hole -> hole 3 halved, A wins 5&4 (gross: B 1 up)');
  // R6 9-hole: an 18 handicap plays as 9 on a 9-hole card (one stroke a hole), not 18 (two a hole)
  const C9 = { name: 'Nine', tees: 'W', holes: 9, par: PAR.slice(0, 9), hcp: [7, 3, 9, 1, 6, 5, 8, 2, 4] };
  assert.strictEqual(S.playHcp(18, 100, 9), 9); assert.strictEqual(S.playHcp(18, 100, 18), 18); assert.strictEqual(S.playHcp(15, 80, 9), 6); assert.strictEqual(S.teamHcp([10, 20], [50, 50], 9), 7.5);
  const c9 = { members: [{ pid: 'p', name: 'p' }], day: { fmt: 'stroke', net: 'net', pct: 100, allow: [], course: C9, hcp: { p: 18 }, teams: [{ tid: 'T', name: 'T', players: ['p'] }], matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] }, scores: { T: Object.fromEntries(C9.par.map((par, i) => [i + 1, { p: { p: par + 1 } }])) } } };
  const r9 = G.dayBoard(c9).rows[0]; assert.strictEqual(r9.gross, 45); assert.strictEqual(r9.net, 36); assert.strictEqual(r9.toParN, 0);
  t('R6 9-hole card: playing handicap = half the 18-hole handicap (18 -> 9, 15 at 80% -> 6, team 10/20 at 50/50 -> 7.5); bogey golf off 18 = net par on nine');
  // R10 skins after the last hole: default split among those tied for low on the last hole; 'none' = nobody
  const sc = [{ id: 'P1', s: [3, 4] }, { id: 'P2', s: [4, 4] }, { id: 'P3', s: [5, 5] }]; // hole 1 P1; hole 2 P1 and P2 tie -> the last skin is split between them
  let k = S.skins(sc, 2); eq(k.won, { P1: 1.5, P2: 0.5 }); eq(k.split, { ids: ['P1', 'P2'], skins: 1, each: 0.5, shares: { P1: 0.5, P2: 0.5 } }); assert.strictEqual(k.carry, 0);
  k = S.skins([{ id: 'P1', s: [4, 4] }, { id: 'P2', s: [4, 4] }], 2); eq(k.won, { P1: 1, P2: 1 }); k = S.skins([{ id: 'P1', s: [4, 4] }, { id: 'P2', s: [4, 4] }], 2, 'none'); eq(k.won, {}); assert.strictEqual(k.dead, 2);
  t('R10 skins carried past the last hole: split among the players tied for low on it (default, commissioner can set none)');
  // R8 small field: tiers shrink in proportion; under 12 golfers no tiers
  eq(S.tiers(Array.from({ length: 14 }, (_, i) => i)).map((x) => x.length), [1, 1, 2, 2, 3, 5]); assert.strictEqual(S.tiers(Array.from({ length: 11 }, (_, i) => i)), null);
  const t30 = S.tiers(Array.from({ length: 30 }, (_, i) => i)); assert.ok(t30.every((x) => x.length > 0)); assert.strictEqual(t30.flat().length, 30); eq(S.tiers(Array.from({ length: 60 }, (_, i) => i)).map((x) => x.length), [6, 6, 8, 10, 12, 18]);
  t('R8 pick six tiers on small fields: 14 golfers -> 1/1/2/2/3/5, 30 -> six non-empty tiers, under 12 -> none; 50+ unchanged');
})();

// ======================= owner rules H1 / S-ALL / P1 (Nov 16 2026), pure =======================
(function ownerPure() {
  // H1 WHS method, hand-worked. Par 72, Course Rating 70.1, Slope 121. Bogey golf = 90: differential = 113/121 x (90 - 70.1) = 18.58 -> 18.6.
  const rd = (f, id) => ({ id, date: '2026-10-0' + id, holes: PAR.map((par, i) => f(par, i)), pars: PAR, si: SI, rating: 70.1, slope: 121 });
  assert.strictEqual(S.whsIndex([rd((x) => x + 1, 1), rd((x) => x + 1, 2)]).index, null, 'two rounds: no index yet');
  let h = S.whsIndex([rd((x) => x + 1, 1), rd((x) => x + 1, 2), rd((x) => x + 1, 3)]); assert.strictEqual(h.index, 16.6, '3 rounds: lowest 1 less 2.0 = 18.6 - 2.0'); assert.strictEqual(h.rounds, 3);
  // 5 rounds (lowest 1, no adjustment): four 90s and one 85 -> 113/121 x 14.9 = 13.91 -> 13.9
  h = S.whsIndex([1, 2, 3, 4].map((i) => rd((x) => x + 1, i)).concat(rd((x, i) => x + (i < 13 ? 1 : 0), 5))); assert.strictEqual(h.index, 13.9);
  // net double bogey cap: with index 16.6 the course handicap here is 16.6 x 121/113 + (70.1 - 72) = 15.9 -> 16 strokes (index 1-16). A 12 on hole 1
  // (par 4, index 7, one stroke) counts as 4 + 2 + 1 = 7: adjusted gross 90 - 5 + 7 = 92 instead of 97 -> differential 113/121 x 21.9 = 20.45 -> 20.5.
  h = S.whsIndex([1, 2, 3].map((i) => rd((x) => x + 1, i)).concat(rd((x, i) => (i === 0 ? 12 : x + 1), 4))); assert.strictEqual(h.diffs[3].ags, 92); assert.strictEqual(h.diffs[3].diff, 20.5); assert.strictEqual(h.index, 17.6, '4 rounds: lowest 1 less 1.0');
  assert.strictEqual(S.courseHcp(16.6, { par: PAR, rating: 70.1, slope: 121 }), 16); assert.strictEqual(S.courseHcp(16.6, { par: PAR }), 16.6, 'no rating/slope: the index is used as is');
  assert.strictEqual(require('./ratings').indexFrom(Array.from({ length: 20 }, (_, i) => 10 + i)).index, 13.5, '20 rounds: best 8 averaged (10..17)'); assert.ok(!/WHS_T|whsIndexOf/.test(require('fs').readFileSync(__dirname + '/golf-score.js', 'utf8')) && /require\('\.\/ratings'\)/.test(require('fs').readFileSync(__dirname + '/golf-score.js', 'utf8')), 'one copy of the WHS maths: ratings.js');
  { const sum = require('crypto').createHash('sha256').update(require('fs').readFileSync(__dirname + '/ratings.js')).digest('hex'), R2 = require('./ratings'); // golf's copy is the stats module's file at e214bcf, or (merged build) whatever newer file stats ships with the same functions
    assert.ok(sum === '21ee115d60821953f8f5ab33b30ccf2464431d99b17156547ce54212c0c1a0b0' || ['courseHandicap', 'strokesOnHole', 'handicapSet'].every((k) => typeof R2[k] === 'function'), 'ratings.js is the stats module\'s file'); }
  t('H1 Oddable Handicap Index, WHS method: no index under 3 rounds; 3 rounds lowest less 2.0 = 16.6; net double bogey cap; best 8 of 20; course handicap = index x slope/113 + (rating - par); all of it from ratings.js (the stats module), no second copy');
  // payouts: small fields pay fewer places; ties share the places they cover, in cents
  eq([2, 3, 4, 6, 7, 11, 12, 19, 20, 60].map((n) => S.defaultSplit(n).length), [1, 1, 2, 2, 3, 3, 4, 4, 6, 6]); assert.ok([2, 5, 9, 15, 40].every((n) => S.defaultSplit(n).reduce((a, x) => a + x, 0) === 100));
  eq(S.payouts(10000, [{ id: 'a', place: 1 }, { id: 'b', place: 2 }, { id: 'c', place: 2 }, { id: 'd', place: 4 }, { id: 'e', place: 5 }], null), { a: 7000, b: 1500, c: 1500, d: 0, e: 0 });
  eq(S.payouts(1001, [{ id: 'a', place: 1 }, { id: 'b', place: 1 }, { id: 'c', place: 3 }, { id: 'd', place: 4 }], null), { a: 501, b: 500, c: 0, d: 0 }); // 70/30 of $10.01, two tied for first share all of it
  eq(S.payouts(9000, [{ id: 'a', place: 1 }, { id: 'b', place: 2 }, { id: 'c', place: 3 }], [60, 30, 10]), { a: 5400, b: 2700, c: 900 }); eq(S.payouts(4000, [{ id: 'a', place: 1 }, { id: 'b', place: 2 }], null), { a: 4000, b: 0 });
  t('R7 payout tiers by field size: 2-3 winner takes all, 4-6 70/30, 7-11 50/30/20, 12-19 four places, 20+ six; commissioner table when set; tied places split in cents');
  // Nassau money with a press: a wins the front 1 up, loses the back 2 down, loses the 18 1 down, the press from 12 is halved -> +5 -5 -5 +0 = -5
  const a = PAR.slice(), b = PAR.slice(); b[0]++; a[9]++; a[10]++; const ns = S.nassau(a, b, [{ nine: 'back', from: 12 }], 0);
  assert.strictEqual(ns.front.res, 'W'); assert.strictEqual(ns.back.res, 'L'); assert.strictEqual(ns.total.res, 'L'); assert.strictEqual(ns.presses[0].m.res, 'T'); assert.strictEqual(S.nassauMoney(ns, 5), -5);
  t('R11 Nassau money: front, back, 18 and every press are each one bet (+5 -5 -5 and a halved press = -5)');
  // P1 suggestPartners(players, {mode, teamSize, history}): the shared contract
  const PR = require('./pairing'), ps = [{ id: 'a', name: 'Ann', hcp: 2 }, { id: 'b', name: 'Bob', hcp: 10 }, { id: 'c', name: 'Cat', hcp: 18 }, { id: 'd', name: 'Dan', hcp: 26 }];
  let sg = PR.suggestPartners(ps, { teamSize: 2 }); eq(sg[0].teams, [['a', 'd'], ['b', 'c']]); eq(sg[0].hcps, [14, 14]); assert.strictEqual(sg[0].mode, 'balanced'); assert.ok(/Team handicaps 14, 14: within 0 strokes/.test(sg[0].reason)); assert.strictEqual(sg.length, 3); assert.ok(sg[0].score <= sg[1].score && sg[1].score <= sg[2].score, 'ranked');
  const hist = [{ players: ['a', 'd'], date: '2026-11-01', result: 'W' }, { players: ['a', 'd'], date: '2026-10-01', result: 'W' }, { players: ['b', 'c'], date: '2026-11-10', result: 'L' }];
  sg = PR.suggestPartners(ps, { mode: 'rotate', teamSize: 2, history: hist }); assert.ok(!sg[0].teams.some((x) => x.join() === 'a,d' || x.join() === 'b,c'), 'rotate avoids pairs who just played together'); assert.ok(/No repeat pairs/.test(sg[0].reason)); assert.ok(/2 repeat pairs; most recent Bob \+ Cat \(2026-11-10\)/.test(sg[2].reason));
  sg = PR.suggestPartners(ps, { mode: 'hot', teamSize: 2, history: hist }); eq(sg[0].teams[0], ['a', 'd']); assert.ok(/Ann \+ Dan: 2 good finishes in 2 rounds together \(2 wins\)/.test(sg[0].reason));
  eq(PR.suggestPartners(ps, { mode: 'nonsense', teamSize: 2 })[0].mode, 'balanced'); eq(PR.suggestPartners(ps.slice(0, 1), {}), []); eq(JSON.stringify(PR.suggestPartners(ps, { teamSize: 2 })), JSON.stringify(PR.suggestPartners(ps, { teamSize: 2 })));
  const big = PR.suggestPartners(Array.from({ length: 16 }, (_, i) => ({ id: 'p' + String(i).padStart(2, '0'), hcp: i * 2 })), { teamSize: 4 }); assert.strictEqual(big[0].teams.length, 4); assert.ok(big[0].teams.every((x) => x.length === 4)); assert.ok(big[0].score <= 1, 'sixteen players, four teams within a stroke');
  t('P1 suggestPartners: Balanced (default) evens team handicaps, Rotate avoids recent partners, Hot pairs picks the best record together; each with a one-line reason; deterministic; only suggests');
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
D.acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, since: async () => Date.parse('2025-01-01T00:00:00Z'), /* v1.6: an established account (signers must be) */ isOwnerPhone: () => false, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
let NOW = Date.parse('2026-11-18T18:00:00Z'); D.now = () => NOW;
// fake tour feed (event E1 first tee Nov 19 12:00Z)
const TEE = Date.parse('2026-11-19T12:00:00Z');
const mkG = (i, o) => Object.assign({ id: 'p' + i, name: 'Golfer ' + String(i).padStart(2, '0'), pos: '', toPar: null, today: null, thru: '', rounds: [], st: 'active', tee: TEE + i * 60e3, started: false, earn: null, sort: i }, o || {});
let FIELD = Array.from({ length: 50 }, (_, i) => mkG(i + 1)), EV = { E1: { done: false }, E2: { done: false, tee: Date.parse('2026-11-26T12:00:00Z') } }, feedDown = false;
D.feed = { events: async () => [{ id: 'E1', name: 'Test Classic' }], board: async (tour, ev) => { if (feedDown) throw new Error('down'); const e = EV[ev] || EV.E1; const gs = (e.field || FIELD).map((g) => Object.assign({}, g)); return { event: { id: ev, tour, name: ev === 'E2' ? 'Next Open' : 'Test Classic', start: e.tee || TEE, end: (e.tee || TEE) + 4 * 864e5, state: e.state || (e.done ? 'post' : 'pre'), done: !!e.done }, golfers: gs, firstTee: Math.min(...gs.map((g) => g.tee || Infinity).filter(Number.isFinite)) || null, earnings: !!e.earnings }; } };
D.courses = { search: async () => { throw new Error('down'); }, detail: async () => CO.normCourse(require('./fixtures/opengolfapi-course.json')), ATTR: CO.ATTR };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/golf/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(Object.assign({ myName: who ? who[0].toUpperCase() + who.slice(1) : '' }, b || {})) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j.error || r.j.note || r.j).slice(0, 400));
// THE NEUTRAL RULE (review round 3): an action by someone who plays in the game answers 202 and waits. `sign` has the first person who may sign it do so
// (test accounts are named after their token: 'ann' -> Ann). `pw` = call + sign.
const sign = async (r, id, by) => { if (r.s !== 202 || !r.j.n) return r; const q = r.j.game.pending.find((x) => x.n === r.j.n); assert.ok(q && q.who.length, 'someone can sign: ' + JSON.stringify(q)); const k = await call(by || q.who[0].toLowerCase(), 'sign', { id, n: q.n }); ok(k, 'sign ' + q.text); return k; };
const pw = async (who, op, b, by) => sign(await call(who, op, b), b.id, by);
// Money-game rule: every player needs a number before Start. The organizer sets the others' (a number a player asked for is used as asked; else 0, the
// old "no handicap" strokes); the organizer's own is only asked for and another player (okW, not on the organizer's team) OKs it.
const hcpAll = async (orgW, id, okW) => { const g = (await call(orgW, 'get', { id })).j.game; for (const m of g.members) { const hi = g.day.hi[m.pid]; if (hi.src !== 'none') continue; const v = hi.ask != null ? hi.ask : 0;
  if (hi.ask != null && m.pid !== g.me) { let done = false; for (const x of g.members) { if (done || x.pid === m.pid || x.guest) continue; done = (await call(x.name.toLowerCase(), 'team', { id, op: 'hcpok', pid: m.pid })).s === 200; } assert.ok(done, 'round 5: a player on another team who does not gain OKs the number ' + m.name + ' asked for'); continue; }
  if (m.pid === g.me) { const r = await call(orgW, 'team', { id, op: 'hcp', pid: m.pid, hcp: v, reason: 'test set-up' }); if (r.s === 202 && !r.j.n) ok(await call(okW, 'team', { id, op: 'hcpok', pid: m.pid }), 'another player OKs the organizer\'s number'); else ok(await sign(r, id)); } else ok(await sign(await call(orgW, 'team', { id, op: 'hcp', pid: m.pid, hcp: v, reason: 'test set-up' }), id)); } };
// A confirm sends the hole versions the confirmer saw (confirm pins what was seen): read the card, then confirm those versions.
const confirmAll = async (who, id, tid, from, to) => { const g = (await call(who, 'get', { id })).j.game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); return call(who, 'confirm', { id, tid, from: from || 1, to: to || 18, revs }); };


// ======================= feed fallback + course API (mocked fetch, no network) =======================
async function netTests() {
  const SBX = require('./fixtures/espn-golf-scoreboard.json'), seen = [];
  const resp = (code, j) => ({ ok: code === 200, status: code, json: async () => j });
  // 1) leaderboard host refuses -> this week's scoreboard (verified shape) is used
  FEED._reset(); let lbCode = 503; FEED._deps.fetch = async (u) => { seen.push(u); if (/leaderboard/.test(u)) return resp(lbCode, {}); if (/dates=20261119/.test(u)) return resp(200, SBX); if (/scoreboard$/.test(u)) return resp(200, Object.assign({}, SBX, { events: [] })); return resp(404, {}); };
  let b = await FEED.board('pga', '401999001'); assert.strictEqual(b.src, 'scoreboard'); assert.ok(seen.some((u) => /scoreboard\?dates=20261119$/.test(u)), 'event looked up by its start day: ' + seen.join(' '));
  const by = {}; b.golfers.forEach((g) => (by[g.name] = g));
  eq(b.golfers.map((g) => g.name), ['Ann Alpha', 'Bea Bravo', 'Eve Even', 'Cal Cutline', 'Dee Done']);
  assert.strictEqual(by['Ann Alpha'].toPar, -12); assert.strictEqual(by['Ann Alpha'].pos, '1'); assert.strictEqual(by['Ann Alpha'].thru, '10'); assert.strictEqual(by['Ann Alpha'].today, -1); eq(by['Ann Alpha'].rounds, [68, 68, 69, 33]);
  assert.strictEqual(by['Bea Bravo'].pos, 'T2'); assert.strictEqual(by['Eve Even'].pos, 'T2');
  assert.strictEqual(by['Cal Cutline'].st, 'cut'); eq(by['Cal Cutline'].rounds, [74, 73]); assert.strictEqual(by['Dee Done'].st, 'wd'); assert.strictEqual(by['Dee Done'].started, true);
  assert.strictEqual(b.firstTee, null); assert.strictEqual(b.event.start, Date.parse('2026-11-19T05:00Z')); assert.strictEqual(b.event.round, 4);
  // pick six on the scoreboard shape: cut golfer = worst made-cut (-9) + 1 = -8 under 'w1'
  const fm = {}; b.golfers.forEach((g) => (fm[g.id] = g)); assert.strictEqual(S.golferScore(fm['103'], fm, 'w1').v, -8); assert.strictEqual(S.golferScore(fm['104'], fm, 'p10').v, 12);
  // 2) leaderboard answers with the richer shape -> used directly (no scoreboard call)
  FEED._reset(); seen.length = 0; const LBX = require('./fixtures/espn-golf-leaderboard.json'); FEED._deps.fetch = async (u) => { seen.push(u); return /leaderboard/.test(u) ? resp(200, LBX) : resp(500, {}); };
  b = await FEED.board('pga', '401999001'); assert.ok(!b.src); assert.strictEqual(seen.length, 1); assert.ok(/^https:\/\/site\.web\.api\.espn\.com\/apis\/site\/v2\/sports\/golf\/leaderboard\?league=pga&event=401999001$/.test(seen[0]));
  // 3) both down -> throws (callers fail closed: picks refused)
  FEED._reset(); FEED._deps.fetch = async () => resp(503, {}); await assert.rejects(FEED.board('pga', '401999001'));
  t('ESPN feed: leaderboard first; on failure the scoreboard (verified shape) by the event\'s start day; order/score strings/"-" rounds; T2 ties; cut and WD inferred; picks lock at event start without tee times');
  { // R2 cut/WD guesses on the scoreboard shape
    const H = (n) => Array.from({ length: n }, (_, i) => ({ period: i + 1, value: 4 })), R = (p, v, dv, n) => ({ period: p, value: v, displayValue: dv, linescores: H(n) }), U = (p) => ({ period: p, value: 0, displayValue: '-' });
    const mk = (cs) => ({ events: [{ id: '9', name: 'Sat', date: '2026-11-19T05:00Z', status: { type: { state: 'in' } }, competitions: [{ status: { period: 3 }, competitors: cs.map((ls, i) => ({ id: 'g' + i, order: i + 1, athlete: { displayName: 'G' + i }, score: '-' + (10 - i), linescores: ls })) }] }] });
    // Saturday morning: 4 golfers in round 3, 5 leaders with only the round-3 placeholder (not teed off), 1 with no round-3 entry
    const sat = [].concat(Array.from({ length: 5 }, () => [R(1, 68, '-4', 18), R(2, 68, '-4', 18), U(3), U(4)]), Array.from({ length: 4 }, () => [R(1, 70, '-2', 18), R(2, 71, '-1', 18), R(3, 20, '-1', 5)]), [[R(1, 75, '+3', 18), R(2, 76, '+4', 18)]]);
    let bb = FEED.parseBoard(mk(sat), 'pga'); eq(bb.golfers.map((g) => g.st), ['active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'active', 'cut']);
    // suspended round 2: three golfers stopped at 14 holes while others started round 3 -> nobody WD, nobody cut yet
    const sus = [].concat(Array.from({ length: 4 }, () => [R(1, 70, '-2', 18), R(2, 70, '-2', 18), R(3, 22, '-2', 6)]), Array.from({ length: 3 }, () => [R(1, 70, '-2', 18), R(2, 52, '-2', 14)]), Array.from({ length: 3 }, () => [R(1, 70, '-2', 18), R(2, 70, '-2', 18), U(3)]));
    bb = FEED.parseBoard(mk(sus), 'pga'); assert.ok(bb.golfers.every((g) => g.st === 'active'), bb.golfers.map((g) => g.st).join(','));
    // final: the golfer who stopped at 4 holes of round 2 is WD
    const fin = mk([[R(1, 70, '-2', 18), R(2, 70, '-2', 18), R(3, 70, '-2', 18), R(4, 70, '-2', 18)], [R(1, 72, 'E', 18), R(2, 18, '+2', 4)], [R(1, 76, '+4', 18), R(2, 76, '+4', 18)]]); fin.events[0].status.type.state = 'post';
    bb = FEED.parseBoard(fin, 'pga'); eq(bb.golfers.map((g) => g.st), ['active', 'wd', 'cut']);
    assert.strictEqual(FEED.parseBoard({ events: [{ id: '1', competitions: [{ competitors: [{ id: '5', athlete: { displayName: "Sean O'Hair" }, score: 'E' }] }] }] }, 'pga').golfers[0].name, "Sean O'Hair");
    t('R2 scoreboard cut/WD: leaders not yet out on Saturday stay active, only the golfer without a round-3 entry is CUT; a suspended round is never WD; WD/cut settled at the final; names keep apostrophes');
  }
  // ---- OpenGolfAPI ----
  CO._reset(); const hits = []; let fail = '';
  const SR = require('./fixtures/opengolfapi-search.json'), CD = require('./fixtures/opengolfapi-course.json');
  CO._deps.fetch = async (u, o) => { hits.push([u, (o && o.headers && o.headers.authorization) || '']); if (fail === 'all') throw new Error('ECONNREFUSED');
    if (u.startsWith('https://api.opengolfapi.org/v1/courses/state/TX')) return resp(200, SR);
    if (u.startsWith('https://api.opengolfapi.org/v1/courses/search')) return fail === 'v1' ? resp(404, {}) : resp(200, SR);
    if (u.startsWith('https://api.opengolfapi.org/api/v1/courses/search')) return resp(200, { courses: [SR.courses[1]] });
    if (u === 'https://api.opengolfapi.org/v1/courses/og-123') return resp(200, CD);
    if (u === 'https://api.opengolfapi.org/v1/courses/og-777') return resp(200, { id: 'og-777', course_name: 'Holes Elsewhere', tees: [{ tee_name: 'Gold', course_rating: 69.5, slope: 118 }] });
    if (u === 'https://api.opengolfapi.org/v1/courses/og-777/holes') return resp(200, { holes: Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, yards: 350 + i })) });
    return resp(404, {}); };
  let L = await CO.search('palm', '', ''); eq(L[0], { extId: 'og-123', name: 'Palm Valley Golf Club', city: 'McAllen', state: 'TX', holes: 18, par: 72 }); assert.ok(/^https:\/\/api\.opengolfapi\.org\/v1\/courses\/search\?q=palm&limit=25$/.test(hits[0][0]), hits[0][0]); assert.strictEqual(hits[0][1], '');
  L = await CO.search('', 'tx', ''); assert.strictEqual(L.length, 2); assert.ok(hits.some(([u]) => u === 'https://api.opengolfapi.org/v1/courses/state/TX?limit=25'));
  process.env.OPENGOLFAPI_KEY = ' k-123 '; fail = 'v1'; L = await CO.search('lakes', 'TX', ''); assert.strictEqual(L[0].name, 'Champion Lakes'); const last = hits[hits.length - 1]; assert.ok(/\/api\/v1\/courses\/search\?q=lakes&state=TX/.test(last[0])); assert.strictEqual(last[1], 'Bearer k-123'); delete process.env.OPENGOLFAPI_KEY; fail = '';
  let cd = await CO.detail('og-123'); assert.strictEqual(cd.name, 'Palm Valley Golf Club'); assert.strictEqual(cd.tees[0].rating, 72.1); assert.strictEqual(cd.tees[0].holes[0].yards, 410); assert.strictEqual(cd.attribution, 'Course data: OpenGolfAPI contributors (ODbL)');
  cd = await CO.detail('og-777'); assert.strictEqual(cd.tees[0].name, 'Gold'); assert.strictEqual(cd.tees[0].holes.length, 9); eq(cd.tees[0].holes[2], { n: 3, par: 4, hcp: 3, yards: 352 }); assert.strictEqual(cd.tees[0].par, 36);
  const n0 = hits.length; await CO.detail('og-123'); assert.strictEqual(hits.length, n0, 'cached 24 h');
  CO._reset(); fail = 'all'; await assert.rejects(CO.search('palm')); const n1 = hits.length; await assert.rejects(CO.search('other')); assert.strictEqual(hits.length, n1, 'backs off 5 min after a failure'); fail = ''; CO._reset();
  await assert.rejects(CO.detail('../etc'));
  t('OpenGolfAPI: /v1 search (course_name/par_total/holes_count), /v1/courses/state/TX, /api/v1 when /v1 is 404, Bearer only when OPENGOLFAPI_KEY is set, detail + /holes fallback, 24 h cache, back-off, attribution, bad ids refused');
  // ---- course search: Show more in the same list, courses near a typed city, and the bundled list when the service is down (Steve's report) ----
  { CO._reset(); const many = (off, n) => ({ total: 60, courses: Array.from({ length: n }, (_, i) => ({ id: 'c' + (off + i), course_name: 'Valley Course ' + (off + i), city: 'Mission', state: 'TX', par_total: 72, holes_count: 18 })) }), asked = [];
    CO._deps.fetch = async (u) => { asked.push(u); const q = new URL(u).searchParams, off = Number(q.get('offset') || 0); if (/\/courses\/search/.test(u) && q.get('q') === 'valley') return resp(200, many(off, Math.min(25, 60 - off))); return resp(404, {}); };
    let p1 = await CO.searchSafe('valley', '', '', 0); assert.strictEqual(p1.ok, true); assert.strictEqual(p1.results.length, 25); assert.strictEqual(p1.total, 60); assert.strictEqual(p1.next, 25, 'more to load: the next page starts at 25');
    const p2 = await CO.searchSafe('valley', '', '', p1.next); assert.strictEqual(p2.results[0].extId, 'c25'); assert.strictEqual(p2.next, 50); const p3 = await CO.searchSafe('valley', '', '', p2.next); assert.strictEqual(p3.results.length, 10); assert.strictEqual(p3.next, null, 'last page: no more');
    assert.ok(asked.some((u) => /offset=25/.test(u)) && asked.some((u) => /offset=50/.test(u)));
    CO._reset(); CO._deps.fetch = async () => { throw new Error('ECONNRESET'); }; const dn = await CO.searchSafe('mcallen', '', '', 0);
    assert.strictEqual(dn.ok, false); assert.strictEqual(dn.down, true); assert.strictEqual(dn.error, "Couldn't reach the course list. Try again."); assert.ok(dn.results.length >= 5 && dn.results.every((c) => c.sample && /^fb-/.test(c.extId)), 'the bundled sample list is offered'); assert.ok(/Sample courses saved in the app/.test(dn.fallback)); assert.ok(dn.results.some((c) => c.name === 'McAllen Country Club'));
    const fb = await CO.detail(dn.results.find((c) => c.name === 'McAllen Country Club').extId); assert.ok(fb.tees.length >= 3 && fb.tees[0].holes.length === 18 && fb.tees[0].rating === 67.4 && fb.tees[0].checked === true, 'a bundled course opens with its tees, lengths and holes, with the service still down');
    assert.strictEqual((await CO.searchSafe('mcallen', '', '', 25)).results.length, 0, 'no second page of samples'); CO._reset();
    t('COURSE SEARCH: "Show more" loads the next 25 of the SAME search (offset), the last page ends it; service down = "Couldn\'t reach the course list" + the bundled sample courses, each opening with tees and lengths'); }
}

srv.listen(0, async () => {
  P = srv.address().port; let r;
  try {
    await netTests();
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
    r = await call('bob', 'pick', { id: pro.id, picks: pk(3), guess: -9 }); assert.strictEqual(r.s, 409, 'G16: locked on entry, a day before the first tee'); assert.ok(/final/.test(r.j.error));
    r = await call('bob', 'get', { id: pro.id }); eq(r.j.game.mine.picks, pk(0)); assert.strictEqual(r.j.game.g16, true); assert.ok(r.j.game.mine.at > 0, 'the server stamp');
    { const a1 = await call('ann', 'create', { kind: 'pro', title: 'Just me', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' } }); ok(a1); const T1 = a1.j.game.tiers; let q = await call('ann', 'pick', { id: a1.j.game.id, picks: T1.map((x) => x[0]) }); ok(q); q = await call('ann', 'pick', { id: a1.j.game.id, picks: T1.map((x) => x[1]) }); ok(q, 'a game with nobody else in it is not group play yet'); }
    t('G16 group picks: saved on the server and locked on entry (re-pick 409 before the first tee, picks unchanged, server time stamp); a one-person game is not group play');
    feedDown = true; r = await call('cat', 'pick', { id: pro.id, picks: pk(2), guess: -18 }); assert.strictEqual(r.s, 503, 'feed down: fail closed'); feedDown = false;
    NOW = TEE + 61e3; r = await call('cat', 'pick', { id: pro.id, picks: pk(2), guess: -18 }); assert.strictEqual(r.s, 409); assert.ok(/closed|final/i.test(r.j.error));
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
    EV.E3 = { done: false, tee: Date.parse('2026-11-25T12:00:00Z') }; EV.E1.done = false; FIELD = FIELD.map((g) => Object.assign(g, { started: false, toPar: null, thru: '' })); // a fresh week: nobody has teed off
    r = await call('bob', 'pick', { id: oad.id, event: 'E1', golfer: 'p8' }); ok(r); r = await call('bob', 'pick', { id: oad.id, event: 'E3', golfer: 'p8' }); assert.strictEqual(r.s, 409); assert.ok(/never the same golfer/.test(r.j.error));
    r = await call('bob', 'pick', { id: oad.id, event: 'E1', golfer: 'p7' }); assert.strictEqual(r.s, 409, 'G16: a group pick is locked the moment it is added'); assert.ok(/final|closed/.test(r.j.error)); r = await call('bob', 'pick', { id: oad.id, event: 'E3', golfer: 'p7' }); ok(r);
    EV.E1.done = true; FIELD = FIELD.map((g) => Object.assign(g, { pos: g.id === 'p8' ? '1' : g.pos }));
    NOW = TEE + 5 * 864e5; r = await call('bob', 'get', { id: oad.id }); ok(r); assert.strictEqual(r.j.game.oad.events.find((e) => e.id === 'E1').by, null, 'H6: the first "final" reading is not kept'); NOW += 11 * 60e3; r = await call('bob', 'get', { id: oad.id }); ok(r); const ev1 = r.j.game.oad.events.find((e) => e.id === 'E1'); assert.strictEqual(ev1.by, 'points'); assert.strictEqual(r.j.game.table.find((x) => x.pid === r.j.game.me).total, 100);
    t('one and done: reuse refused across the season; G16 a pick cannot be changed once added; scored by finish points (feed has no prize money) -> win = 100');
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
    r = await pw('ann', 'team', { id: day.id, op: 'hcp', pid: pid.cat, hcp: 20 }); ok(r);
    r = await pw('ann', 'match', { id: day.id, op: 'add', a: 'T1', b: 'T2' }); ok(r); const mid = r.j.game.day.matches[0].mid;
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: { [pid.bob]: 4 } }); assert.strictEqual(r.s, 409, 'not started');
    await hcpAll('ann', day.id, 'eve'); r = await call('ann', 'start', { id: day.id }); ok(r);
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
    r = await call('zed', 'confirm', { id: day.id, tid: 'T2', from: 1, to: 9 }); assert.strictEqual(r.s, 404, 'not in the game');
    r = await call('eve', 'dispute', { id: day.id, tid: 'T1', hole: 3, note: 'Was a 4' }); assert.strictEqual(r.s, 400, 'round 5 (N5): a money dispute says what the score should be'); r = await call('eve', 'dispute', { id: day.id, tid: 'T1', hole: 3, note: 'Was a 4', want: { p: full(2) } }); ok(r); r = await call('eve', 'confirm', { id: day.id, tid: 'T1', from: 1, to: 9 }); ok(r);
    g = r.j.game; assert.strictEqual(g.day.scores.T1[3].st, 'disputed'); assert.strictEqual(g.day.scores.T1[1].st, 'confirmed');
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 1, p: full(3) }); assert.strictEqual(r.s, 202, 'a confirmed hole is closed for the scorer: a change is only asked for'); assert.strictEqual(r.j.game.day.scores.T1[1].p[pid.bob], PAR[0], 'nothing changed'); assert.strictEqual(r.j.game.pending.length, 1);
    r = await call('cat', 'sign', { id: day.id, n: r.j.n }); assert.strictEqual(r.s, 403, 'a team mate cannot sign it'); r = await call('bob', 'sign', { id: day.id, n: (await call('bob', 'get', { id: day.id })).j.game.pending[0].n, ok: false }); ok(r, 'the one who asked takes it back'); assert.strictEqual(r.j.game.pending.length, 0);
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 3, p: full(5) }); assert.strictEqual(r.s, 409, 'R3: a disputed hole cannot be cleared by re-entering it'); assert.ok(/disputed/.test(r.j.error));
    r = await call('ann', 'confirm', { id: day.id, tid: 'T1', from: 1, to: 9 }); assert.strictEqual(r.s, 403, 'R4: the organizer cannot confirm the card of a team they play on');
    t('R3/R4: a disputed hole stays disputed until the organizer settles it (re-entry 409); nobody confirms their own team\'s card, organizer included');
    r = await call('ann', 'final', { id: day.id }); assert.strictEqual(r.s, 409, 'disputes block final');
    // FIX 1 (fails on 544803e: the organizer settled her own team's hole, and any hole whether disputed or not)
    r = await call('ann', 'resolve', { id: day.id, tid: 'T1', hole: 3, p: full(2) }); assert.strictEqual(r.s, 202, 'the organizer plays on T1: she can only ASK for a settlement'); assert.strictEqual(r.j.game.day.scores.T1[3].st, 'disputed', 'nothing changed'); eq(r.j.game.pending[0].who.sort(), ['Eve', 'Fay', 'Gus', 'Hal'], 'only the other team can sign');
    r = await call('ann', 'sign', { id: day.id, n: r.j.n }); assert.strictEqual(r.s, 403, 'not her own request'); r = await call('eve', 'resolve', { id: day.id, tid: 'T1', hole: 3, p: full(2) }); assert.strictEqual(r.s, 403, 'the one who raised the dispute never settles it'); assert.ok(/You raised this dispute/.test(r.j.error));
    r = await call('ann', 'resolve', { id: day.id, tid: 'T2', hole: 2, p: { [pid.eve]: 9, [pid.fay]: 9, [pid.gus]: 9, [pid.hal]: 9 } }); assert.strictEqual(r.s, 409, 'resolve only works on a DISPUTED hole'); assert.ok(/not disputed/.test(r.j.error));
    r = await call('ann', 'resolve', { id: day.id, tid: 'T1', hole: 2, p: full(2) }); assert.ok([403, 409].includes(r.s), 'not her own undisputed hole either'); assert.strictEqual((await call('ann', 'get', { id: day.id })).j.game.day.scores.T1[2].st, 'confirmed');
    r = await call('fay', 'resolve', { id: day.id, tid: 'T1', hole: 3, p: full(2) }); ok(r, 'round 6 (direction rule): T2 settles T1\'s hole LOWER in a two-team game: it only costs T2 itself, so no witness is needed'); assert.strictEqual(r.j.game.day.scores.T1[3].st, 'confirmed'); assert.strictEqual(r.j.game.day.scores.T1[3].by, 'Fay');
    assert.ok(r.j.game.day.audit.some((a) => a.what === 'disputed') && r.j.game.day.audit.some((a) => a.what === 'settled' && a.by === 'Fay' && a.from && a.from.note === 'Was a 4')); assert.strictEqual(r.j.game.pending.length, 0, 'the organizer\'s older request for the same hole was replaced or dropped');
    t('FIX 1 resolve: only a DISPUTED hole, only in a live round, never on a team the organizer plays on or scores for (another team\'s scorer settles it and the team\'s scorer confirms); audit keeps who/what/before');
    // the board after nine: T1 best two net
    const bd = r.j.game.board; assert.strictEqual(bd.rows[0].tid, 'T1'); assert.strictEqual(bd.rows[0].thru, 9);
    const mt = bd.matches.find((x) => x.mid === mid); assert.ok(mt.nassau); assert.ok(mt.nassau.front.played >= 6 && mt.nassau.front.up > 0, JSON.stringify(mt.nassau.front));
    r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 10 }); assert.strictEqual(r.s, 400, 'a press from 10 is the back-nine bet itself'); r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 1 }); assert.strictEqual(r.s, 400);
    r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 11 }); assert.strictEqual(r.s, 409, 'no back-nine hole played yet: nothing to press'); assert.ok(/next hole/.test(r.j.error));
    r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 5 }); assert.strictEqual(r.s, 409, 'never back-dated'); assert.ok(/has been played/.test(r.j.error));
    r = await call('bob', 'score', { id: day.id, tid: 'T1', hole: 10, p: full(PAR[9]) }); ok(r); r = await call('eve', 'score', { id: day.id, tid: 'T2', hole: 10, p: { [pid.eve]: 7, [pid.fay]: 7, [pid.gus]: 7, [pid.hal]: 7 } }); ok(r); // T2 goes 1 down on the back
    r = await call('bob', 'match', { id: day.id, op: 'press', mid, from: 11 }); assert.strictEqual(r.s, 403, 'the side that is UP cannot press'); assert.ok(/down/.test(r.j.error));
    r = await call('cat', 'match', { id: day.id, op: 'press', mid, from: 11 }); assert.strictEqual(r.s, 403);
    r = await call('eve', 'match', { id: day.id, op: 'press', mid, from: 12 }); assert.strictEqual(r.s, 409, 'only the next hole');
    r = await call('eve', 'match', { id: day.id, op: 'press', mid, from: 11 }); ok(r, 'the scorer of the side that is down offers a press from the next hole'); { const mm = r.j.game.board.matches.find((x) => x.mid === mid); assert.strictEqual(mm.press, 'accept', 'default: a press must be accepted'); assert.strictEqual(mm.nassau.presses.length, 0, 'an offered press is not a bet yet'); eq(mm.offers.map((x) => [x.from, x.side, x.expired]), [[11, 'b', false]]); }
    r = await call('eve', 'match', { id: day.id, op: 'accept', mid, from: 11 }); assert.strictEqual(r.s, 403, 'the side that offered cannot accept its own press');
    r = await call('bob', 'match', { id: day.id, op: 'accept', mid, from: 11 }); ok(r, 'the other side\'s scorer accepts'); assert.strictEqual(r.j.game.board.matches.find((x) => x.mid === mid).nassau.presses.filter((x) => x.from === 11).length, 1); assert.strictEqual(r.j.game.board.matches.find((x) => x.mid === mid).offers.length, 0);
    r = await call('eve', 'match', { id: day.id, op: 'press', mid, from: 11 }); assert.strictEqual(r.s, 409, 'one press per hole');
    assert.ok(bd.skins && bd.skins.net === true);
    r = await call('bob', 'extra', { id: day.id, kind: 'ctp', hole: 3, who: pid.cat, note: '4 ft 2 in' }); ok(r); r = await call('cat', 'extra', { id: day.id, kind: 'ctp', hole: 3, who: pid.cat }); assert.strictEqual(r.s, 403);
    assert.strictEqual(r.j.game === undefined, true); assert.ok(!(await G.statsFor(ACC('cat'), {})).some((x) => x.extra && x.extra.side === 'ctp'), 'an unconfirmed closest-to-the-pin winner is not a result yet');
    r = await call('bob', 'extraconfirm', { id: day.id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 403, 'not by the one who entered it / the winner\'s own team'); r = await call('ann', 'extraconfirm', { id: day.id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 403, 'the organizer plays on the winner\'s team');
    r = await call('eve', 'extraconfirm', { id: day.id, kind: 'ctp', hole: 3 }); ok(r, 'another team\'s scorer confirms'); assert.strictEqual(r.j.game.day.win.ctp[3].st, 'confirmed'); assert.strictEqual(r.j.game.board.extras.ctp[0].win.st, 'confirmed');
    r = await call('bob', 'extra', { id: day.id, kind: 'ld', hole: 9, who: pid.cat }); assert.strictEqual(r.s, 400);
    t('board: T1 leads after 9; Nassau front tracked; R11 presses: must be ACCEPTED by the other side (default) before they count; only the side that is down, only from the next hole to be played, once per hole, never from 1 or 10 (the nine bet itself); closest to the pin entered by a scorer and CONFIRMED by another team\'s scorer before it counts');
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
    const sa = await G.statsFor(ACC('cat'), {}); assert.ok(sa.some((x) => x.kind === 'golf-pool' && x.place && x.place.of === 2)); assert.ok(sa.some((x) => x.kind === 'event' && /closest/.test(x.title) && x.result === 'W'));
    assert.ok(sa.some((x) => x.kind === 'golf-round' && x.extra && x.extra.course === 'Palm Valley' && x.extra.holes === 10 && x.extra.who === undefined));
    const sb = await G.statsFor(ACC('bob'), {}); assert.ok(sb.some((x) => x.kind === 'golf-pool' && /Next Open|Test Classic/.test(x.title)), 'one and done record');
    const sg = await G.statsFor('guest:' + guest.gid, {}); assert.strictEqual(sg.length, 0, 'guest has no strokes yet'); assert.deepStrictEqual(await G.statsFor(ACC('nobody'), {}), []);
    assert.strictEqual((await G.statsFor(ACC('zed'), { from: '2027-01-01' })).length, 0, 'date filter');
    t('statsFor: solo round (score, toPar, course, slope, putts, hole-by-hole), pool place, one-and-done, closest-to-pin win, guest keys, date filter');
    // ---------------- adapter ----------------
    const lots = await G.teams(day.id); assert.strictEqual(lots.length, 2); assert.ok(lots[0].id.startsWith('t:' + day.id));
    const gl = await G.golfers('E1', 'pga'); assert.ok(gl.length >= 48 && gl[0].id.startsWith('g:'));
    const ps = await G.potSummary(pro.id); assert.strictEqual(ps.entry, 20); assert.strictEqual(ps.entrants, 3); assert.strictEqual(ps.potTotal, 0);
    // ATTACH (fails on 544803e: any organizer attached to ANY group id, and `create` took groupId from the request)
    { await assert.rejects(G.attach(day.id, 'GRP1', 'C1'), /commissioner/, 'the adapter refuses an attach nobody asked for through the route');
      r = await call('ann', 'attach', { id: day.id, groupId: 'GRP1' }); assert.strictEqual(r.s, 503, 'no Groups module in the build: nothing is attached'); assert.strictEqual((await call('ann', 'get', { id: day.id })).j.game.groupId, null);
      const COMM = { GRP1: ACC('ann'), GRP2: ACC('zed') }, seen = []; D.groups = () => ({ attachGame: async (gid, e, x) => { seen.push([gid, e, x.type, x.ref]); if (COMM[gid] !== e) throw Object.assign(new Error('Only the commissioner can add games'), { status: 403 }); await G.attachToGroup(x.ref, gid, 'C1'); return { cid: 'C1', pot: 'side' }; } });
      r = await call('ann', 'attach', { id: day.id, groupId: 'GRP2' }); assert.strictEqual(r.s, 403, 'ann runs the golf game but is not GRP2\'s commissioner'); assert.ok(/commissioner/.test(r.j.error)); assert.strictEqual((await call('ann', 'get', { id: day.id })).j.game.groupId, null);
      r = await call('bob', 'attach', { id: day.id, groupId: 'GRP1' }); assert.strictEqual(r.s, 403, 'only the golf organizer');
      r = await call('zed', 'create', { kind: 'day', title: 'Sneaky', course, groupId: 'GRP1', day: { fmt: 'stroke', teams: 1 } }); ok(r); assert.strictEqual(r.j.game.groupId, null, 'create never trusts a groupId from the request'); assert.ok(/commissioner/.test(r.j.attachError));
      r = await call('ann', 'attach', { id: day.id, groupId: 'GRP1' }); ok(r); assert.strictEqual(r.j.game.groupId, 'GRP1'); eq(seen[seen.length - 1], ['GRP1', ACC('ann'), 'golf', day.id]);
      await assert.rejects(G.attachToGroup(day.id, 'GRP2', 'C9'), /commissioner/, 'and the callback cannot be replayed for another group'); D.groups = () => null; }
    assert.strictEqual(G.isGolfBet({ lg: 'golf' }), true); assert.strictEqual(G.isGolfBet({ kt: 'KXPGATOUR-26' }), true); assert.strictEqual(G.isGolfBet({ home: 'KC', away: 'BUF' }), false);
    t('adapter: teams() and golfers() lots, potSummary, isGolfBet; ATTACH TO A GROUP only when the caller is the golf organizer AND that group\'s commissioner (checked by Groups); create never takes a groupId on trust');
    // ---------------- format entry rules, enterprise course links, courseId ----------------
    r = await call('kim', 'create', { kind: 'day', title: 'Florida day', course, day: { fmt: 'florida', teams: 1, teamSize: 3 } }); ok(r); const fl = r.j.game; assert.strictEqual(fl.courseId, solo.courseId, 'same saved course (deduped)'); assert.ok(fl.courseId);
    for (const n of ['Gil', 'Hap']) { r = await call('kim', 'team', { id: fl.id, op: 'guest', name: n, tid: 'T1' }); ok(r); }
    r = await call('kim', 'team', { id: fl.id, op: 'assign', pid: fl.me, tid: 'T1' }); ok(r); r = await call('kim', 'start', { id: fl.id }); ok(r); const flp = r.j.game.day.teams[0].players.map((p) => p.pid);
    r = await call('kim', 'score', { id: fl.id, tid: 'T1', hole: 1, g: 4, shots: [flp[0], flp[0], flp[1], flp[2]] }); assert.strictEqual(r.s, 400); assert.ok(/sit out/.test(r.j.error));
    r = await call('kim', 'score', { id: fl.id, tid: 'T1', hole: 1, g: 4, shots: [flp[0], flp[1]] }); assert.strictEqual(r.s, 400); assert.ok(/One shot per stroke/.test(r.j.error));
    r = await call('kim', 'score', { id: fl.id, tid: 'T1', hole: 1, g: 4, shots: [flp[0], flp[1], flp[0], flp[2]] }); ok(r); assert.deepStrictEqual(r.j.game.day.scores.T1[1].shots, [flp[0], flp[1], flp[0], flp[2]]);
    t('Florida scramble entry: a shot list with the same player twice in a row is refused (step-aside), one shot per stroke, a valid list is stored');
    r = await call('kim', 'create', { kind: 'day', title: 'Texas day', course, day: { fmt: 'texas', teams: 1, teamSize: 2, drives: 3 } }); ok(r); const tx = r.j.game;
    r = await call('kim', 'team', { id: tx.id, op: 'guest', name: 'Ike', tid: 'T1' }); ok(r); r = await call('kim', 'team', { id: tx.id, op: 'assign', pid: tx.me, tid: 'T1' }); ok(r); r = await call('kim', 'start', { id: tx.id }); ok(r); const txp = r.j.game.day.teams[0].players.map((p) => p.pid);
    r = await call('kim', 'score', { id: tx.id, tid: 'T1', hole: 1, g: 4 }); assert.strictEqual(r.s, 400); assert.ok(/drive/.test(r.j.error));
    r = await call('kim', 'score', { id: tx.id, tid: 'T1', hole: 1, g: 4, drive: 'XXXXXX' }); assert.strictEqual(r.s, 400);
    for (let h = 1; h <= 14; h++) { r = await call('kim', 'score', { id: tx.id, tid: 'T1', hole: h, g: PAR[h - 1], drive: txp[0] }); ok(r); }
    let row = r.j.game.board.rows[0]; assert.strictEqual(row.drives.count[txp[0]], 14); assert.strictEqual(row.drives.need[txp[1]], 3); assert.strictEqual(row.drives.left, 4); assert.deepStrictEqual(row.drives.warn, [txp[1]]);
    t('Texas scramble entry: whose drive is required and must be a team player; the board counts drives and warns (3 needed with 4 left)');
    D.ownerOk = (req) => req.headers['x-token'] === 't-boss';
    r = await call('ann', 'ent', { account: ACC('club'), op: 'link', courseId: fl.courseId }); assert.strictEqual(r.s, 401, 'players cannot link courses');
    r = await call('boss', 'ent', { account: ACC('club'), op: 'link', courseId: 'NOPE' }); assert.strictEqual(r.s, 404);
    r = await call('boss', 'ent', { account: ACC('club'), op: 'link', courseId: fl.courseId }); ok(r); assert.strictEqual(r.j.courses.length, 1); assert.strictEqual(r.j.courses[0].name, 'Palm Valley'); assert.strictEqual(r.j.enterprise, false);
    assert.deepStrictEqual((await G.coursesOwnedBy(ACC('club'))).map((x) => x.id), [fl.courseId]); assert.deepStrictEqual(await G.coursesOwnedBy(ACC('nobody')), []);
    r = await call('club', 'create', { kind: 'day', title: 'Club outing', course, day: { fmt: 'scramble4', teams: 3 } }); ok(r); const co = r.j.game; assert.strictEqual(co.max, 8);
    for (let i = 0; i < 7; i++) { r = await call('club', 'team', { id: co.id, op: 'guest', name: 'Guest ' + i }); ok(r); } r = await call('club', 'team', { id: co.id, op: 'guest', name: 'Guest 9' }); assert.strictEqual(r.s, 409);
    r = await call('boss', 'ent', { account: ACC('club'), op: 'enterprise', on: true }); ok(r); assert.strictEqual(r.j.enterprise, true);
    r = await call('club', 'team', { id: co.id, op: 'guest', name: 'Guest 9' }); ok(r, 'enterprise lifts the cap');
    r = await call('boss', 'ent', { account: ACC('club'), op: 'unlink', courseId: fl.courseId }); ok(r); assert.strictEqual(r.j.courses.length, 0);
    const sz = await G.statsFor(ACC('zed'), {}); assert.strictEqual(sz.find((x) => x.kind === 'golf-round').extra.courseId, solo.courseId);
    t('owner links an enterprise account to its course(s) (owner token only); coursesOwnedBy; enterprise flag lifts the 8 cap; events and stats records carry courseId');
    // ---------------- review fixes: lock, course key, verified, putts, stats shape, one-and-done season, names ----------------
    const T0 = NOW, F4 = Array.from({ length: 50 }, (_, i) => mkG(i + 1, { tee: T0 + 2 * 864e5 + i * 60e3 })); EV.E4 = { tee: T0 + 2 * 864e5, field: F4 };
    r = await call('ann', 'create', { kind: 'pro', title: 'Lock test', pro: { tour: 'pga', game: 'six', eventId: 'E4', tb: 'best' } }); ok(r); const lk = r.j.game; await call('bob', 'join', { code: lk.code });
    const pk4 = lk.tiers.map((x) => x[0]); r = await call('bob', 'pick', { id: lk.id, picks: pk4 }); ok(r);
    NOW = T0 + 2 * 864e5 + 3600e3; EV.E4 = { tee: T0 + 5 * 864e5, field: F4.map((g) => Object.assign({}, g, { tee: g.tee + 3 * 864e5 })) }; // the feed now says a later start (glitch / reschedule)
    r = await call('bob', 'pick', { id: lk.id, picks: lk.tiers.map((x) => x[1]) }); assert.strictEqual(r.s, 409, 'R1: the stored lock never moves later'); assert.strictEqual((await call('bob', 'get', { id: lk.id })).j.game.pro.locked, true);
    NOW = T0; EV.E5 = { tee: T0 + 864e5, state: 'in', field: F4 }; r = await call('ann', 'create', { kind: 'pro', title: 'Begun', pro: { tour: 'pga', game: 'six', eventId: 'E5', tb: 'best' } }); assert.strictEqual(r.s, 409, 'R1: feed says in progress');
    EV.E6 = { tee: T0 + 864e5, field: F4.map((g, i) => Object.assign({}, g, { started: i === 0 })) }; r = await call('ann', 'create', { kind: 'pro', title: 'Begun', pro: { tour: 'pga', game: 'six', eventId: 'E6', tb: 'best' } }); assert.strictEqual(r.s, 409, 'R1: a golfer has started');
    EV.E7 = { tee: T0 + 864e5, field: F4.slice(0, 9) }; r = await call('ann', 'create', { kind: 'pro', title: 'Tiny', pro: { tour: 'pga', game: 'six', eventId: 'E7', tb: 'best' } }); assert.strictEqual(r.s, 409); assert.ok(/at least 12/.test(r.j.error), 'R8 clear message');
    NOW = T0; t('R1 picks lock: stored once, only ever earlier (a later feed start does not reopen picks); an event already in progress or with a golfer started is locked; R8 tiny field refused clearly');
    // R9 course key
    const cA = { name: 'Lakeside', tees: 'White', holes: 18, par: PAR, hcp: SI, city: 'Mission' }, cB = Object.assign({}, cA, { city: 'Harlingen' });
    const ra = await call('lee', 'course', { course: cA }), rb = await call('lee', 'course', { course: cB }); ok(ra); ok(rb); assert.notStrictEqual(ra.j.id, rb.j.id, 'R9: same name + tees in another town = another course');
    const rC = await call('lee', 'course', { course: Object.assign({}, cA, { name: "Pete Dye's Links", src: 'opengolfapi', extId: 'og-9', teeKey: 'white-male' }) }), rD = await call('lee', 'course', { course: Object.assign({}, cA, { name: "Pete Dye's Links", city: 'Elsewhere', src: 'opengolfapi', extId: 'og-9', teeKey: 'white-male' }) });
    assert.strictEqual(rC.j.id, rD.j.id, 'API id + tee is the key'); const sv = (await call('lee', 'courses', { q: 'pete' })).j.courses; assert.ok(sv.some((x) => x.name === "Pete Dye's Links"), 'R11 apostrophe kept');
    t('R9 saved courses keyed by API id + tee, else name + city + state + par + tees; R11 course names keep apostrophes');
    // R4/R10 verified and putts: solo is never verified; a 4-player stroke team's putts go only to the scorer's own record
    r = await call('lee', 'create', { kind: 'day', solo: true, title: 'Solo', course, day: { myHcp: 5 } }); ok(r); const so = r.j.game;
    for (let i = 0; i < 18; i++) { r = await call('lee', 'score', { id: so.id, tid: 'T1', hole: i + 1, p: { [so.me]: PAR[i] }, putts: 2 }); ok(r); }
    r = await call('lee', 'confirm', { id: so.id, tid: 'T1', from: 1, to: 18 }); assert.strictEqual(r.s, 403, 'cannot confirm your own solo card');
    let sl = (await G.statsFor(ACC('lee'), {})).find((x) => x.kind === 'golf-round'); assert.strictEqual(sl.verified, false); assert.strictEqual(sl.extra.putts, 36); assert.strictEqual(sl.result, null); assert.strictEqual(sl.place, undefined);
    r = await call('lee', 'create', { kind: 'day', title: "O'Neil's stroke day", course, day: { fmt: 'stroke', teams: 1, teamSize: 2, net: 'gross' }, myName: "Sean O'Neil" }); ok(r); const sd = r.j.game; assert.strictEqual(sd.title, "O'Neil's stroke day"); assert.ok(sd.members.some((x) => x.name === "Sean O'Neil"), 'R11 name keeps the apostrophe');
    r = await call('lee', 'team', { id: sd.id, op: 'guest', name: "Tom O'Hara<b>", tid: 'T1' }); ok(r); assert.ok(r.j.game.members.some((x) => x.name === "Tom O'Hara"), 'tags stripped, apostrophe kept');
    r = await call('lee', 'team', { id: sd.id, op: 'assign', pid: sd.me, tid: 'T1' }); ok(r); r = await call('lee', 'start', { id: sd.id }); ok(r); const two = r.j.game.day.teams[0].players.map((p) => p.pid);
    r = await call('lee', 'score', { id: sd.id, tid: 'T1', hole: 1, p: { [two[0]]: 4, [two[1]]: 5 }, putts: 2 }); ok(r);
    const me2 = (await G.statsFor(ACC('lee'), {})).find((x) => x.contestId === sd.id && x.kind === 'golf-round');
    assert.strictEqual(me2.extra.putts, 2, 'the scorer\'s own putts');
    t('R4/R10 a solo round is never verified (and cannot be self-confirmed); putts typed for a team hole are credited only to the scorer, not to every player');
    // R12 stats shape: skins / CTP / LD = kind 'event' with won; pools = result null + place; one and done = one season record, place once the season is over
    const all12 = (await G.statsFor(ACC('cat'), {})).concat(await G.statsFor(ACC('bob'), {}), await G.statsFor(ACC('ann'), {}), await G.statsFor(ACC('zed'), {}), await G.statsFor(ACC('lee'), {}));
    assert.ok(all12.filter((x) => x.extra && ['skins', 'ctp', 'ld'].includes(x.extra.side)).every((x) => x.kind === 'event' && x.result === 'W'), 'side prizes are events');
    assert.ok(all12.filter((x) => x.kind === 'golf-pool').every((x) => x.result === null), 'pools carry a place, no W/L');
    let oadRec = (await G.statsFor(ACC('bob'), {})).filter((x) => /one and done/.test(x.title)); assert.strictEqual(oadRec.length, 1, 'one record per season'); assert.strictEqual(oadRec[0].place, undefined, 'season still running: no place'); assert.strictEqual(oadRec[0].extra.live, true);
    r = await call('bob', 'endseason', { id: oad.id }); assert.strictEqual(r.s, 403); r = await call('ann', 'endseason', { id: oad.id }); assert.strictEqual(r.s, 202, 'H2: the organizer has an entry, so ending the season is only asked for'); r = await call('bob', 'sign', { id: oad.id, n: r.j.n }); ok(r);
    oadRec = (await G.statsFor(ACC('bob'), {})).filter((x) => /one and done/.test(x.title)); eq(oadRec[0].place, { n: 1, of: 2 }); assert.strictEqual(oadRec[0].score, 100);
    let validate = null; try { validate = require('/home/claude/calcutta-stats/odds-api/stats.js').validate; } catch (e) { /* stats branch not on this machine: shape checked above */ }
    if (validate) all12.concat(oadRec).forEach((x) => { const v = validate(x, 'golf'); assert.ok(v.ok, 'stats validate: ' + v.why + ' ' + x.id); });
    t('R12 stats shape: side prizes are kind event with won; pools have a place and no W/L; one and done is one season record, placed once the organizer ends the season' + (validate ? '; every record passes stats.js validate' : ''));

    // ---------------- owner rules: H1 (Oddable Handicap Index), E-H (tournament handicaps), S-ALL (entry / payout / net), P1 (suggest partners) ----------------
    NOW = Date.parse('2026-11-18T18:00:00Z'); const HC = (w) => G.handicapFor(ACC(w));
    { const h0 = await HC('kimmy'); eq([h0.oddable.index, h0.use, h0.event, h0.setBy], [null, null, null, null]); }
    for (let k = 0; k < 3; k++) { r = await call('kimmy', 'create', { kind: 'day', solo: true, title: 'Bogey ' + k, course, day: {} }); ok(r); const sg0 = r.j.game; if (k === 0) { assert.strictEqual(sg0.day.hi[sg0.me].text, 'Oddable: no rounds yet'); assert.strictEqual(sg0.day.hi[sg0.me].src, 'none'); }
      for (let i = 0; i < 18; i++) ok(await call('kimmy', 'score', { id: sg0.id, tid: 'T1', hole: i + 1, p: { [sg0.me]: PAR[i] + 1 } })); }
    let hk = await HC('kimmy'); assert.strictEqual(hk.oddable.index, 16.6, 'three bogey rounds in the app = 16.6 (hand-worked above)'); assert.strictEqual(hk.oddable.rounds, 3); assert.strictEqual(hk.text, '16.6 · 0 of 3 rounds confirmed', 'the stats module\'s own line'); assert.strictEqual(G.HCP_LABEL, 'Oddable Handicap Index'); assert.strictEqual(G.HCP_NOTE, 'Calculated with the World Handicap System method.');
    assert.strictEqual(hk.use, null, 'ONE SOURCE (stats contract): by default `use` is the CONFIRMED index, and three solo rounds confirm nothing'); assert.strictEqual(hk.needsSet, true); assert.strictEqual((await G.handicapFor(ACC('kimmy'), { casual: true })).use, 16.6, 'a casual game plays off the full index');
    assert.ok(!/SI_handicapFor|SI_eventOverride|SI_eventLog|SI_index/.test(require('fs').readFileSync(__dirname + '/golf.js', 'utf8')), 'golf.js has no handicap stand-in, override store or director log of its own');
    // a standard game: the index IS the handicap (a typed number is ignored / refused); a player with no index may type one
    r = await call('walter', 'create', { kind: 'day', title: 'Friday four', course, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', myHcp: 14 } }); ok(r); const fr = r.j.game; assert.strictEqual(fr.ent, false); assert.strictEqual(fr.day.hi[fr.me].src, 'typed'); assert.strictEqual(fr.day.hi[fr.me].text, 'Oddable: no rounds yet · Entered 14.0');
    r = await call('kimmy', 'join', { code: fr.code, hcp: 3 }); ok(r); const kf = r.j.game.me; assert.strictEqual(r.j.game.day.hcp[kf], 16.6, 'H1: the typed 3 is ignored, the app index is used'); assert.strictEqual(r.j.game.day.hi[kf].text, 'Oddable 16.6 · 0 of 3 rounds confirmed'); assert.strictEqual(r.j.game.day.hi[kf].ch, 16, 'course handicap 15.9 -> 16 strokes');
    r = await call('walter', 'team', { id: fr.id, op: 'hcp', pid: kf, hcp: 5 }); assert.strictEqual(r.s, 409, 'a standard organizer cannot override the Oddable index'); assert.ok(/Oddable Handicap Index/.test(r.j.error) && /World Handicap System method/.test(r.j.error));
    r = await call('kimmy', 'team', { id: fr.id, op: 'hcp', pid: kf, hcp: 5 }); assert.strictEqual(r.s, 409); r = await call('walter', 'team', { id: fr.id, op: 'hcp', pid: fr.me, hcp: 15 }); ok(r, 'no index yet: a typed handicap is fine');
    t('H1 every round in the app counts toward the Oddable Handicap Index (3 solo rounds -> 16.6, WHS method) and it is THE handicap: used on joining, typed numbers only for players with no index');
    // E-H: an Enterprise tournament. Director = the organizer of an enterprise account.
    db['lock:ent'] = { id: 'lock:ent', data: { keys: { [ACC('proshop')]: true } }, updated: 1 }; G._reset();
    NOW += 60e3; const TEE2 = NOW + 2 * 3600e3; // a minute after the solo rounds: rounds are processed in the order they were played
    r = await call('proshop', 'create', { kind: 'day', title: 'Club Championship', course, pot: { entry: 20 }, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net', teeTime: TEE2, hu: { on: true, kind: 'player', type: 'match', amt: 10 } } }); ok(r); const tn = r.j.game; assert.strictEqual(tn.ent, true); assert.strictEqual(tn.day.lockAt, TEE2); assert.strictEqual(tn.day.hlocked, false);
    r = await call('kimmy', 'join', { code: tn.code, tid: 'T2' }); ok(r); const kt = r.j.game.me; assert.strictEqual(r.j.game.day.hi[kt].text, 'Oddable 16.6 · 0 of 3 rounds confirmed');
    r = await call('proshop', 'team', { id: tn.id, op: 'assign', pid: tn.me, tid: 'T1' }); ok(r);
    r = await call('proshop', 'team', { id: tn.id, op: 'guest', name: "Walk-in Joe O'Brien", tid: 'T3' }); ok(r); const joe = r.j.guest; assert.strictEqual(r.j.game.day.hi[joe.pid].text, 'Oddable: no rounds yet');
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: joe.pid, hcp: 20, reason: 'Club card' }); assert.strictEqual(r.s, 403, 'round 6 (item 6): a director who PLAYS in the event cannot set numbers'); assert.ok(r.j.notNeutral);
    ok(await call('proshop', 'team', { id: tn.id, op: 'assign', pid: tn.me }), 'the director steps off the teams'); r = await call('lou', 'join', { code: tn.code, tid: 'T1' }); ok(r); const lt = r.j.game.me; // Lou plays T1 instead
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: joe.pid, hcp: 20 }); assert.strictEqual(r.s, 400, 'a reason is required'); assert.ok(/reason/.test(r.j.error));
    r = await call('kimmy', 'team', { id: tn.id, op: 'hcp', pid: joe.pid, hcp: 20, reason: 'trust me' }); assert.strictEqual(r.s, 403, 'only the director');
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: joe.pid, hcp: 20, reason: 'Club card, no app rounds' }); assert.strictEqual(r.s, 200, 'round 6 (item 6): a director who plays nothing sets numbers ALONE (logged, shown to all)'); assert.strictEqual(db['lock:evr:golf:' + tn.id].data.log.length, 1);
    assert.strictEqual(r.j.game.day.hi[joe.pid].text, 'Oddable: no rounds yet · Tournament 20.0, set by director'); assert.strictEqual(r.j.game.day.hi[joe.pid].src, 'tournament');
    const before = await HC('kimmy');
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: kt, hcp: 10, reason: 'Committee review' }); ok(r, 'the director alone'); r = await call('kimmy', 'team', { id: tn.id, op: 'hcpobject', pid: kt, note: 'I play off 16' }); ok(r, 'item 6: the player objects before Start'); assert.strictEqual(r.j.game.day.hobj[kt][0].note, 'I play off 16'); assert.ok(r.j.game.notices.some((x) => /objects to Kimmy/.test(x.text)));
    assert.strictEqual((await call('lou', 'team', { id: tn.id, op: 'hcpobject', pid: kt, note: 'hers is wrong' })).s, 403, 'only for your own number'); r = await call('proshop', 'get', { id: tn.id }); let tg = r.j.game;
    assert.strictEqual(tg.day.hi[kt].text, 'Oddable 16.6 · 0 of 3 rounds confirmed · Tournament 10.0, set by director', 'the real-results index still shows next to the override'); assert.strictEqual(tg.day.hi[kt].oddable, 16.6); assert.strictEqual(tg.day.hi[kt].used, 10); assert.strictEqual(tg.day.hi[kt].ch, 9);
    assert.strictEqual(tg.day.teams.find((x) => x.tid === 'T2').players[0].hi.text, tg.day.hi[kt].text, 'same line on the player card');
    eq(tg.day.hlog.map((x) => [x.name, x.by, x.old, x.new, x.oddable, x.reason]), [['Kimmy', 'Proshop', 16.6, 10, 16.6, 'Committee review'], ["Walk-in Joe O'Brien", 'Proshop', null, 20, null, 'Club card, no app rounds']]); assert.ok(tg.day.hlog.every((x) => x.at === NOW), 'who, when, old, new, reason');
    eq(await HC('kimmy'), before, 'E-H: the lifetime Oddable Handicap Index is not touched by the director\'s edit');
    { const he = await G.handicapFor(ACC('kimmy'), { eventId: 'golf:' + tn.id }); eq([he.oddable.index, he.event, he.setBy, he.use, he.reason], [16.6, 10, 'tournament', 10, 'Committee review'], 'the stats contract: {oddable, event, setBy, use}'); const hj2 = await G.handicapFor('guest:' + joe.gid, { eventId: 'golf:' + tn.id }); eq([hj2.oddable.index, hj2.event, hj2.use], [null, 20, 20]);
      assert.ok(db['lock:evr:golf:' + tn.id] && db['lock:evr:golf:' + tn.id].data.lockAt === TEE2, 'eventSetup was called for the Enterprise tournament (lockAt = first tee time)'); assert.strictEqual(db['lock:evr:golf:' + fr.id], undefined, 'not for a standard game'); }
    assert.strictEqual((await call('kimmy', 'get', { id: fr.id })).j.game.day.hcp[kf], 16.6, 'only that tournament: her other game still uses 16.6'); assert.strictEqual((await call('kimmy', 'get', { id: tn.id })).j.game.day.hlog.length, 2, 'round 6 (item 6): every number is shown to ALL players');
    r = await pw('proshop', 'match', { id: tn.id, op: 'add', a: kt, b: joe.pid }); ok(r);
    r = await call('proshop', 'suggest', { id: tn.id, teamSize: 2 }); ok(r); assert.strictEqual(r.j.mode, 'balanced'); assert.ok(r.j.suggestions.length >= 1 && /Team handicaps/.test(r.j.suggestions[0].reason)); assert.ok(/Suggestions only/.test(r.j.note)); eq(r.j.modes.map((x) => x[1]), ['Balanced', 'Rotate', 'Hot pairs']);
    assert.ok(r.j.suggestions[0].teams.flat().some((x) => x.hi.text === tg.day.hi[kt].text));
    for (const md of ['rotate', 'hot']) { const q = await call('proshop', 'suggest', { id: tn.id, teamSize: 2, mode: md }); ok(q); assert.strictEqual(q.j.mode, md); assert.ok(q.j.suggestions[0].reason.length > 10); }
    r = await call('kimmy', 'suggest', { id: tn.id, teamSize: 2 }); assert.strictEqual(r.s, 403); eq((await call('proshop', 'get', { id: tn.id })).j.game.day.teams.map((x) => x.players.length), [1, 1, 1], 'suggesting changes nothing');
    t('P1 Suggest partners on the server: Balanced by default, Rotate and Hot pairs, a reason on each, organizer only, nothing is saved');
    // FIX 16 (fails on 544803e): a net money game does not start until every player has a number. The director has none yet.
    r = await call('proshop', 'start', { id: tn.id }); assert.strictEqual(r.s, 409, 'no Start while a player has no handicap'); assert.ok(/Lou has no handicap yet/.test(r.j.error)); eq(r.j.needHcp, [lt]); assert.strictEqual((await call('proshop', 'get', { id: tn.id })).j.game.day.status, 'setup');
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: lt, hcp: 1.8, reason: 'Lou plays off 1.8 (club card)' }); ok(r); assert.strictEqual(r.j.game.day.hi[lt].ch, 0, '1.8 x 121/113 - 1.9 = 0 strokes');
    NOW = TEE2 + 60e3; r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: kt, hcp: 12, reason: 'Late change' }); assert.strictEqual(r.s, 409, 'E-H: refused after lockAt (first tee time) even before Start is tapped'); assert.ok(/closed/.test(r.j.error));
    assert.strictEqual((await call('proshop', 'get', { id: tn.id })).j.game.day.hlocked, true);
    r = await call('proshop', 'start', { id: tn.id }); ok(r); assert.strictEqual(r.j.game.day.lockAt, TEE2, 'lockAt stored once, never later'); assert.strictEqual(r.j.game.day.hi[kt].used, 10, 'starting does not undo the director\'s number');
    r = await call('proshop', 'team', { id: tn.id, op: 'hcp', pid: joe.pid, hcp: 30, reason: 'After start' }); assert.strictEqual(r.s, 409);
    for (const [who, tid, p] of [['lou', 'T1', lt], ['kimmy', 'T2', kt], ['proshop', 'T3', joe.pid]]) for (let i = 0; i < 18; i++) ok(await call(who, 'score', { id: tn.id, tid, hole: i + 1, p: { [p]: PAR[i] } }));
    r = await call('proshop', 'get', { id: tn.id }); assert.strictEqual(r.j.game.payout.pool, 0, 'nobody marked paid yet: the pot is empty'); for (const p of [lt, kt, joe.pid]) ok(await pw('proshop', 'paid', { id: tn.id, pid: p, paid: true })); // after the start a playing director's paid marks are signed by another player
    r = await call('proshop', 'final', { id: tn.id }); assert.strictEqual(r.s, 409, 'money shown + unconfirmed holes: no Final'); assert.ok(/54 holes were never confirmed/.test(r.j.error), r.j.error); assert.strictEqual(r.j.unconfirmed, 54);
    // FIX 2 (fails on 544803e, where this force went through): a forced finish cannot cover the forcer's OWN side: T1 (he plays on it) and T3 (he scores for it and typed it)
    eq([r.j.own, r.j.canForce], [18, false], 'round 6: he scores T3 (a walk-in) only'); r = await call('proshop', 'final', { id: tn.id, force: true, reason: 'Single scorer event, cards signed on paper' }); assert.strictEqual(r.s, 409, 'forcing does not cover his own 36 holes'); assert.ok(/on your own team or entered by you/.test(r.j.error)); assert.strictEqual((await call('proshop', 'get', { id: tn.id })).j.game.day.status, 'live');
    ok(await confirmAll('kimmy', tn.id, 'T1')); ok(await confirmAll('kimmy', tn.id, 'T3'), 'another team\'s scorer confirms the director\'s side');
    r = await call('proshop', 'final', { id: tn.id }); assert.strictEqual(r.s, 409); eq([r.j.unconfirmed, r.j.own, r.j.canForce], [18, 0, true], 'what is left (T2, typed by its own scorer) is not his side: that he may force');
    r = await call('proshop', 'final', { id: tn.id, force: true }); assert.strictEqual(r.s, 400, 'forcing needs a reason'); r = await call('kimmy', 'final', { id: tn.id, force: true, reason: 'let us go' }); assert.strictEqual(r.s, 403);
    r = await call('proshop', 'final', { id: tn.id, force: true, reason: 'Kim signed her card on paper' }); assert.strictEqual(r.s, 202, 'round 6 (direction rule): counting Kim\'s holes helps T2, so a player on another team signs'); ok(await call('lou', 'sign', { id: tn.id, n: r.j.n })); r = await call('proshop', 'get', { id: tn.id }); tg = r.j.game; assert.strictEqual(tg.day.forced.sig, 'Lou'); eq([tg.day.forced.holes, tg.day.forced.by, tg.day.forced.reason], [18, 'Proshop', 'Kim signed her card on paper']); assert.ok(tg.day.audit.some((a) => a.what === 'final forced'));
    assert.ok(tg.notices.some((x) => x.kind === 'forced' && /18 holes never confirmed/.test(x.text)), 'every player is told about a forced finish'); assert.ok((await call('kimmy', 'get', { id: tn.id })).j.game.unseen > 0, 'she is told');
    t('Final: money shown + unconfirmed holes = no Final. FIX 2: a forced finish (reason, logged, every player told) never covers holes on the forcer\'s own team, a team he scores for, or holes he typed; another team\'s scorer confirms those first'); const rowT = (tid) => tg.board.rows.find((x) => x.tid === tid);
    // everyone shoots 72. Joe: 20.0 x 121/113 - 1.9 = 19.5 -> 20 strokes -> net 52. Kim: tournament 10.0 -> 8.8 -> 9 strokes -> net 63 (her own 16.6 would be 16 strokes, net 56). Director: no handicap -> 72.
    assert.strictEqual(rowT('T3').net, 52, 'the guest\'s director-entered handicap is used for net'); assert.strictEqual(rowT('T2').net, 63, 'the override (not 16.6) is used for net'); assert.strictEqual(rowT('T1').net, 72); eq(tg.board.rows.map((x) => [x.tid, x.place]), [['T3', 1], ['T2', 2], ['T1', 3]]);
    assert.strictEqual((await HC('kimmy')).oddable.index, -1.2, 'the tournament round counts by its gross score only: 72 -> differential 1.8. With the stats module\'s current maths (ratings.js e214bcf) that is an exceptional score, 14.8 under her 16.6: 2.0 comes off all four rounds, and 4 rounds = lowest (-0.2) less 1.0 (the same with or without the override)');
    t('E-H Enterprise tournament: director enters a guest handicap and overrides a player (reason required, logged who/when/old/new/reason, "set by director" next to the real-results Oddable index); both are used for net; lifetime index unchanged; edits refused after lockAt');
    // S-ALL: every play carries entry, payout and net. 3 entrants x $20 = $60, small field -> winner takes all.
    eq(tg.payout.split, [100]); assert.strictEqual(tg.payout.pool, 60); eq(tg.payout.paid, [{ pid: joe.pid, name: "Walk-in Joe O'Brien", amt: 60 }]);
    const sK = (await G.statsFor(ACC('kimmy'), {})).filter((x) => x.contestId === tn.id), sJ = await G.statsFor('guest:' + joe.gid, {}), rK = sK.find((x) => x.kind === 'golf-round'), rJ = sJ.find((x) => x.kind === 'golf-round');
    eq([rK.score, rK.place, rK.stake, rK.won, rK.pl, rK.extra.net], [72, { n: 2, of: 3 }, 20, 0, -20, 63]); eq([rJ.score, rJ.place, rJ.stake, rJ.won, rJ.pl, rJ.extra.net, rJ.result], [72, { n: 1, of: 3 }, 20, 60, 40, 52, 'W']);
    eq([rK.extra.hcpSrc, rK.extra.oddableIndex, rK.extra.playingHcp], ['tournament', 16.6, 9]);
    const mK = sK.find((x) => x.kind === 'match'), mJ = sJ.find((x) => x.kind === 'match'); eq([mK.result, mK.stake, mK.won, mK.pl], ['L', 10, 0, -10]); eq([mJ.result, mJ.stake, mJ.won, mJ.pl], ['W', 10, 20, 10], 'LOW fix: a match win reads like a round: entry 10, payout 20 (the bet back plus the win), net +10 (was payout 10)'); // Joe gets 20 - 9 = 11 strokes
    // a pool: 2 entrants x $10, winner takes all
    const F8 = Array.from({ length: 50 }, (_, i) => mkG(i + 1, { tee: NOW + 864e5 + i * 60e3 })); EV.E8 = { tee: NOW + 864e5, field: F8 };
    r = await call('walter', 'create', { kind: 'pro', title: 'Money pool', pot: { entry: 10 }, pro: { tour: 'pga', game: 'six', eventId: 'E8', tb: 'best' } }); ok(r); const mp = r.j.game; eq(mp.payout.split, [100]); await call('stevie', 'join', { code: mp.code });
    ok(await call('walter', 'pick', { id: mp.id, picks: mp.tiers.map((x) => x[0]) })); ok(await call('stevie', 'pick', { id: mp.id, picks: mp.tiers.map((x) => x[1]) })); const mpM = (await call('walter', 'get', { id: mp.id })).j.game.members;
    ok(await pw('walter', 'paid', { id: mp.id, pid: mpM[0].pid, paid: true })); assert.strictEqual((await call('walter', 'get', { id: mp.id })).j.game.payout.pool, 10, 'the pot counts only entrants marked paid: one of two so far'); ok(await pw('walter', 'paid', { id: mp.id, pid: mpM[1].pid, paid: true }));
    NOW += 5 * 864e5; EV.E8 = { done: true, tee: EV.E8.tee, field: F8.map((g, i) => Object.assign({}, g, { started: true, toPar: i - 10, thru: 'F', pos: String(i + 1) })) };
    const pW = (await G.statsFor(ACC('walter'), {})).find((x) => x.contestId === mp.id), pS = (await G.statsFor(ACC('stevie'), {})).find((x) => x.contestId === mp.id);
    eq([pW.kind, pW.place, pW.stake, pW.won, pW.pl], ['golf-pool', { n: 1, of: 2 }, 10, 20, 10]); eq([pS.place, pS.stake, pS.won, pS.pl], [{ n: 2, of: 2 }, 10, 0, -10]); assert.strictEqual(typeof pW.score, 'number');
    assert.strictEqual((await call('walter', 'get', { id: mp.id })).j.game.entries[0].payout, 20);
    // the whole book: every finished play of every kind has score-or-result, entry, payout and net
    const book = []; for (const w of ['ann', 'bob', 'cat', 'zed', 'lee', 'kimmy', 'walter', 'stevie', 'proshop']) book.push(...await G.statsFor(ACC(w), {})); book.push(...sJ);
    const kinds = new Set(book.map((x) => x.kind + (x.extra && x.extra.side ? ':' + x.extra.side : x.extra && x.extra.game ? ':' + x.extra.game : x.extra && x.extra.solo ? ':solo' : '')));
    ['golf-round', 'golf-round:solo', 'golf-pool:pick six', 'golf-pool:one and done', 'match', 'event:ctp'].forEach((k) => assert.ok(kinds.has(k), 'S-ALL: a ' + k + ' record exists (' + [...kinds].join(', ') + ')'));
    const settled = book.filter((x) => (x.kind === 'golf-round' && x.extra.final) || x.kind === 'match' || x.kind === 'event' || (x.kind === 'golf-pool' && x.place));
    assert.ok(settled.length >= 8); settled.forEach((x) => { ['stake', 'won', 'pl'].forEach((k) => assert.strictEqual(typeof x[k], 'number', x.id + ' ' + k)); assert.strictEqual(Math.round((x.won - x.stake * ((x.extra && x.extra.bets) || 1)) * 100), Math.round(x.pl * 100), x.id + ' net = payout - entry, matches included (LOW fix: no special case for a match any more; a Nassau\'s entry = one bet x extra.bets)'); assert.ok(x.score != null || x.result != null || x.place, x.id); });
    if (validate) book.forEach((x) => { const v = validate(x, 'golf'); assert.ok(v.ok, 'stats validate: ' + v.why + ' ' + x.id); });
    t('S-ALL every round, solo round, pool, golf day, heads-up match and side prize gives each player a stats record with score, place, entry, payout and net (winner takes all on a 3-player field: +$40 / -$20)' + (validate ? '; all pass stats.js validate' : ''));
    assert.ok(!/USGA|GHIN/i.test(raw.join('\n')), 'never called USGA or GHIN'); delete db['lock:ent']; G._reset(); NOW = Date.parse('2026-11-18T18:00:00Z');

    // ---------------- Playbook decisions (manager, Nov 16 2026) ----------------
    NOW = Date.parse('2026-11-18T18:00:00Z'); G._reset();
    { // Texas scramble: allowances by team size + the missing-drive penalty chosen at set-up (default 2)
      const mkTx = async (who, size, extra) => (await call(who, 'create', { kind: 'day', title: 'Texas ' + size, course, day: Object.assign({ fmt: 'texas', teams: 1, teamSize: size, net: 'net' }, extra || {}) })).j.game;
      const t2 = await mkTx('tex2', 2), t3 = await mkTx('tex3x', 3), t4 = await mkTx('tex4xx', 4, { drivePen: 3 }), t5 = await mkTx('tex5xxx', 4, { allow: [20, 15, 10, 5] });
      eq([t2.day.allow, t3.day.allow, t4.day.allow, t5.day.allow], [[35, 15], [30, 20, 10], [25, 20, 15, 10], [20, 15, 10, 5]]); eq([t2.day.drivePen, t4.day.drivePen, t2.day.allowStd, t5.day.allowStd], [2, 3, true, false]);
      const sc = (n, who) => Object.fromEntries(PAR.slice(0, n).map((par, i) => [i + 1, { g: par, drive: who(i), st: 'confirmed' }]));
      const mk = (o) => ({ members: ['a', 'b', 'c'].map((p) => ({ pid: p, name: p })), pot: { entry: 0, take: { kind: 'none' } }, day: Object.assign({ fmt: 'texas', net: 'net', pct: 100, allow: [25, 20, 15, 10], allowStd: true, drives: 4, drivePen: 2, course: COURSE, hcp: { a: 10, b: 20, c: 30 }, hsrc: {}, teams: [{ tid: 'T', name: 'T', players: ['a', 'b', 'c'] }], matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] }, scores: {} }, o) });
      // 18 holes, a's drive 12 times, b's 5, c's once: c is 3 drives short -> 3 x 2 = 6 penalty strokes on gross and net
      let bd = G.dayBoard(mk({ scores: { T: sc(18, (i) => (i < 12 ? 'a' : i < 17 ? 'b' : 'c')) } })).rows[0]; eq(bd.pen, { strokes: 6, drives: 3, each: 2 }); assert.strictEqual(bd.gross, 78); assert.strictEqual(bd.toParG, 6);
      // a 3-player team under the untouched 4-player list plays the 3-player allowance: 30% x 10 + 20% x 20 + 10% x 30 = 10.0 (25/20/15 would be 11.0)
      assert.strictEqual(bd.thcp, 10); assert.strictEqual(bd.net, 78 - 10); assert.strictEqual(G.dayBoard(mk({ allowStd: false, scores: { T: sc(18, (i) => 'abc'[i % 3]) } })).rows[0].thcp, 11, 'an edited list is used as typed');
      assert.strictEqual(G.dayBoard(mk({ scores: { T: sc(17, () => 'a') } })).rows[0].pen, undefined, 'no penalty until the round is finished'); assert.strictEqual(G.dayBoard(mk({ drivePen: 0, scores: { T: sc(18, () => 'a') } })).rows[0].pen, undefined, 'penalty 0 = none');
      assert.strictEqual(G.dayBoard(mk({ scores: { T: sc(18, (i) => 'abc'[i % 3]) } })).rows[0].pen, undefined, 'six drives each: nothing missing');
      t('Texas scramble: starting allowances 35/15 (2 players), 30/20/10 (3), 25/20/15/10 (4), editable; a team short a player uses the list for its size; each missing drive costs the set-up penalty (default 2 strokes) at the end of the round');
    }
    { // Best ball starting allowances, all editable
      const mkB = async (who, o) => (await call(who, 'create', { kind: 'day', title: 'BB', course, day: Object.assign({ fmt: 'bestball', teams: 1, net: 'net' }, o) })).j.game.day;
      const b2 = await mkB('bbtwo', { teamSize: 2, count: 1 }), b4 = await mkB('bbfourx', { teamSize: 4, count: 1 }), b42 = await mkB('bbfourxx', { teamSize: 4, count: 2 }), bE = await mkB('bbeditxxx', { teamSize: 2, count: 1, pct: 100, hu: { on: true, pct: 80 } });
      eq([b2.pct, b4.pct, b42.pct, bE.pct], [85, 75, 85, 100], 'LOW fix: best 2 of 4 starts at 85% like the set-up note says (was 90)'); eq([b2.heads.pct, b4.heads.pct, bE.heads.pct], [90, 90, 80]);
      // the four-ball MATCH plays at its own 90%: handicaps 0 and 20 -> 18 strokes in the match (85% stroke play would be 17)
      const c4 = { members: ['a1', 'a2', 'b1', 'b2'].map((p) => ({ pid: p, name: p })), day: { fmt: 'bestball', net: 'net', pct: 85, count: 1, allow: [], heads: { pct: 90 }, course: COURSE, hcp: { a1: 0, a2: 0, b1: 20, b2: 20 }, hsrc: {}, teams: [{ tid: 'A', name: 'A', players: ['a1', 'a2'] }, { tid: 'B', name: 'B', players: ['b1', 'b2'] }], matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] },
        scores: { A: Object.fromEntries(PAR.map((par, i) => [i + 1, { p: { a1: par, a2: par } }])), B: Object.fromEntries(PAR.map((par, i) => [i + 1, { p: { b1: par + 1, b2: par + 1 } }])) } } };
      const m4 = G.matchState(c4, { mid: 'q', kind: 'team', type: 'match', a: 'A', b: 'B', net: true, offLow: true }); assert.strictEqual(m4.m.res, 'T', 'B bogeys every hole with 18 strokes: all square'); assert.strictEqual(G.matchState(c4, { mid: 'q', kind: 'team', type: 'match', a: 'A', b: 'B', net: true, offLow: true, pct: 85 }).m.res, 'W', '17 strokes: A wins the hole with no stroke');
      t('Best ball starting allowances: pairs stroke play 85%, best 1 of 4 75%, four-ball match 90% (others 90%); every one editable at set-up');
    }
    { // Nassau press switch: "auto press at 2 down" (no manual presses) vs "press must be accepted" (default)
      const a = PAR.slice(), b2 = PAR.slice(); b2[0]--; b2[1]--; const c2 = { members: ['x', 'y'].map((p) => ({ pid: p, name: p })), day: { fmt: 'nassau', net: 'gross', pct: 100, allow: [], course: COURSE, hcp: {}, hsrc: {}, teams: [{ tid: 'X', name: 'X', players: ['x'] }, { tid: 'Y', name: 'Y', players: ['y'] }], matches: [], win: {}, extras: { skins: { on: false }, ctp: [], ld: [] },
        scores: { X: Object.fromEntries(a.map((v, i) => [i + 1, { p: { x: v } }])), Y: Object.fromEntries(b2.map((v, i) => [i + 1, { p: { y: v } }])) } } };
      const au = G.matchState(c2, { mid: 'n', kind: 'player', type: 'nassau', a: 'x', b: 'y', auto: 2, press: 'auto2', presses: [] }); eq(au.nassau.presses.map((p) => p.from), [3], 'x is 2 down after two holes: a press starts by itself on hole 3'); assert.strictEqual(au.press, 'auto2');
      const ac = G.matchState(c2, { mid: 'n', kind: 'player', type: 'nassau', a: 'x', b: 'y', auto: 0, press: 'accept', presses: [{ nine: 'front', from: 3, st: 'offered', side: 'a' }, { nine: 'back', from: 12, st: 'accepted', side: 'a' }] }); eq(ac.nassau.presses.map((p) => p.from), [12]); eq(ac.offers.map((o) => [o.from, o.expired]), [[3, true]], 'an offer nobody accepted before that hole was played has expired');
      let r2 = await call('nasauto', 'create', { kind: 'day', title: 'Auto Nassau', course, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross', hu: { on: true, kind: 'team', type: 'nassau', amt: 5, press: 'auto2' } } }); ok(r2); const na = r2.j.game; eq([na.day.heads.press, na.day.heads.auto], ['auto2', 2]);
      r2 = await call('nasdefault', 'create', { kind: 'day', title: 'Nassau', course, day: { fmt: 'stroke', teams: 2, teamSize: 1, hu: { on: true, kind: 'team', type: 'nassau' } } }); eq([r2.j.game.day.heads.press, r2.j.game.day.heads.auto], ['accept', 0], 'default: a press must be accepted');
      const g2 = await call('nasguest1', 'join', { code: na.code, tid: 'T2' }); ok(g2); ok(await call('nasauto', 'team', { id: na.id, op: 'assign', pid: na.me, tid: 'T1' })); r2 = await pw('nasauto', 'match', { id: na.id, op: 'add', a: 'T1', b: 'T2' }); const mid2 = r2.j.game.day.matches[0].mid; ok(await call('nasauto', 'start', { id: na.id }));
      ok(await call('nasauto', 'score', { id: na.id, tid: 'T1', hole: 1, p: { [na.me]: 6 } })); ok(await call('nasauto', 'score', { id: na.id, tid: 'T2', hole: 1, p: { [g2.j.game.me]: 4 } }));
      r2 = await call('nasauto', 'match', { id: na.id, op: 'press', mid: mid2, from: 2 }); assert.strictEqual(r2.s, 409); assert.ok(/presses by itself/.test(r2.j.error));
      t('Nassau presses: set-up switch "auto press at 2 down" (starts by itself, manual presses refused) or "press must be accepted" (default; an unaccepted offer never counts and expires once the hole is played)');
    }
    { // pot = paid entrants only; an unpaid finisher cannot win pot money
      let r3 = await call('paytest', 'create', { kind: 'day', title: 'Paid only', course, pot: { entry: 10 }, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'gross' } }); const pg = r3.j.game; const j1 = (await call('payjoinA', 'join', { code: pg.code, tid: 'T2' })).j.game.me, j2 = (await call('payjoinBB', 'join', { code: pg.code, tid: 'T3' })).j.game.me;
      ok(await call('paytest', 'team', { id: pg.id, op: 'assign', pid: pg.me, tid: 'T1' })); ok(await pw('paytest', 'paid', { id: pg.id, pid: pg.me, paid: true })); ok(await pw('paytest', 'paid', { id: pg.id, pid: j2, paid: true })); ok(await call('paytest', 'start', { id: pg.id }));
      for (const [who, tid, p, d] of [['paytest', 'T1', pg.me, 2], ['payjoinA', 'T2', j1, 0], ['payjoinBB', 'T3', j2, 1]]) for (let i = 0; i < 18; i++) ok(await call(who, 'score', { id: pg.id, tid, hole: i + 1, p: { [p]: PAR[i] + (i < d ? 1 : 0) } }));
      ok(await confirmAll('payjoinA', pg.id, 'T1')); ok(await confirmAll('payjoinA', pg.id, 'T3')); ok(await confirmAll('paytest', pg.id, 'T2'));
      r3 = await call('paytest', 'final', { id: pg.id }); ok(r3); eq([r3.j.game.payout.pot, r3.j.game.payout.paidN, r3.j.game.payout.entrants], [20, 2, 3]); eq(r3.j.game.payout.paid.map((x) => [x.pid, x.amt]), [[j2, 20]], 'the unpaid winner is skipped: the best PAID finisher takes the pot');
      const u1 = (await G.statsFor(ACC('payjoinA'), {})).find((x) => x.contestId === pg.id); eq([u1.place, u1.stake, u1.won, u1.pl], [{ n: 1, of: 3 }, 0, 0, 0]); const u2 = (await G.statsFor(ACC('payjoinBB'), {})).find((x) => x.contestId === pg.id); eq([u2.place.n, u2.stake, u2.won, u2.pl], [2, 10, 20, 10]);
      const ps2 = await G.potSummary(pg.id); assert.strictEqual(ps2.potTotal, 20);
      t('Pot counts only entrants marked paid (same as Groups and local events): 2 of 3 paid -> $20 pot; an unpaid finisher wins no pot money and shows entry 0');
    }
    { // One and done: "Oddable points" label; the organizer can enter prize money instead
      NOW = TEE - 3600e3; { const q = await call('ann', 'oadmoney', { id: oad.id, event: 'E1', money: { p8: 1 } }); assert.strictEqual(q.s, 409, 'not before that tournament starts'); }
      NOW = TEE + 5 * 864e5; let r4 = await call('ann', 'get', { id: oad.id }); NOW += 11 * 60e3; r4 = await call('ann', 'get', { id: oad.id }); assert.strictEqual(r4.j.game.oad.pointsLabel, 'Oddable points'); const E1 = r4.j.game.oad.events.find((e) => e.id === 'E1'); assert.strictEqual(E1.by, 'points'); eq(E1.golfers.map((x) => x.id), ['p8']);
      r4 = await call('bob', 'oadmoney', { id: oad.id, event: 'E1', money: { p8: 1500000 } }); assert.strictEqual(r4.s, 403); r4 = await call('ann', 'oadmoney', { id: oad.id, event: 'E1', money: {} }); assert.strictEqual(r4.s, 400);
      r4 = await call('ann', 'oadmoney', { id: oad.id, event: 'E1', money: { p8: 1512000 } }); if (r4.s === 202) { assert.ok(/→ \$1,512,000/.test(r4.j.game.pending[0].text), 'M4: old → new'); const sg = r4.j.game.pending[0].who[0].toLowerCase(); r4 = await call(sg, 'sign', { id: oad.id, n: r4.j.n }); } ok(r4); const e1 = r4.j.game.oad.events.find((e) => e.id === 'E1'); eq([e1.by, e1.manual.by, e1.picks[0].pts], ['money-manual', 'Ann', 1512000]); assert.strictEqual(r4.j.game.table[0].total, 1512000); assert.ok(/Prize money entered/.test(r4.j.game.oad.log[0].what));
      t('One and done: the points table is labelled "Oddable points"; the organizer can enter the real prize money for a finished tournament instead (organizer only, logged)');
    }
    NOW = Date.parse('2026-11-18T18:00:00Z');
    { // Pick six: neutral default tiers; every edit logged and shown
      const NM = ['Zed Zulu', 'Amy Alpha', 'Bo Bravo', 'Cy Charlie', 'Di Delta', 'Ed Echo', 'Flo Foxtrot', 'Gil Golf', 'Hy Hotel', 'Ida India', 'Jo Juliet', 'Kit Kilo', 'Lu Lima', 'Mo Mike'];
      const F9 = NM.map((n, i) => mkG(i + 1, { name: n, tee: NOW + 864e5 + i * 60e3 })); EV.E9 = { tee: NOW + 864e5, field: F9 };
      let r5 = await call('tierorg', 'create', { kind: 'pro', title: 'Neutral tiers', pro: { tour: 'pga', game: 'six', eventId: 'E9', tb: 'best' } }); ok(r5); let tg9 = r5.j.game; const nameOf = (id) => F9.find((g) => g.id === id).name;
      eq(tg9.tiers.flat().map(nameOf).slice(0, 4), ['Amy Alpha', 'Bo Bravo', 'Cy Charlie', 'Di Delta'], 'alphabetical by last name, not the feed order (Zed Zulu was listed first)'); assert.strictEqual(nameOf(tg9.tiers.flat().slice(-1)[0]), 'Zed Zulu'); eq([tg9.tierBasis.k, tg9.tierLog.length], ['alpha', 0]);
      EV.E9.field = F9.map((g, i) => Object.assign({}, g, { wr: 14 - i })); r5 = await call('tierwrx', 'create', { kind: 'pro', title: 'By ranking', pro: { tour: 'pga', game: 'six', eventId: 'E9', tb: 'best' } }); eq([r5.j.game.tierBasis.k, nameOf(r5.j.game.tiers[0][0])], ['wr', 'Mo Mike'], 'world ranking when the free feed carries it'); EV.E9.field = F9;
      await call('tierjoin1', 'join', { code: tg9.code }); r5 = await call('tierjoin1', 'tiers', { id: tg9.id, rank: ['Zed Zulu'] }); assert.strictEqual(r5.s, 403);
      r5 = await call('tierorg', 'tiers', { id: tg9.id, rank: ['Zed Zulu', 'Mo Mike'] }); ok(r5); assert.strictEqual(nameOf(r5.j.game.tiers[0][0]), 'Zed Zulu'); assert.strictEqual(r5.j.game.tierBasis.k, 'list');
      r5 = await call('tierjoin1', 'get', { id: tg9.id }); eq(r5.j.game.tierLog.map((x) => [x.by, x.n, x.top, x.moved > 0]), [['Tierorg', 2, ['Zed Zulu', 'Mo Mike'], true]], 'every entrant sees who changed the tiers and to what'); assert.ok(/organizer/.test(r5.j.game.tierBasis.text));
      ok(await call('tierjoin1', 'pick', { id: tg9.id, picks: r5.j.game.tiers.map((x) => x[0]) })); r5 = await call('tierorg', 'tiers', { id: tg9.id, rank: [] }); assert.strictEqual(r5.s, 409, 'no edit once anyone has picked');
      r5 = await call('tierset', 'create', { kind: 'pro', title: 'Rigged?', pro: { tour: 'pga', game: 'six', eventId: 'E9', tb: 'best', rank: ['Kit Kilo'] } }); eq([r5.j.game.tierLog.length, r5.j.game.tierBasis.k], [1, 'list'], 'a list given at set-up is logged too');
      t('Pick six tiers: neutral by default (world ranking when the free feed has it, else alphabetical by last name); an organizer edit is allowed only before anyone picks, and is logged and shown to every entrant');
    }
    { // Golf Calcutta: golf registers its lot sources with the Calcutta engine; started() fails closed
      const reg = {}; const fake = { registerSource: (k, src) => { reg[k] = src; }, attachToGroup: async (id, gid, cid) => { reg.attached = [id, gid, cid]; return { id }; } };
      assert.strictEqual(G.registerCalcutta(fake), true); assert.strictEqual(G.registerCalcutta({}), false); eq(Object.keys(reg).sort(), ['golf', 'golf-day']); assert.strictEqual(reg['golf-day'].local, true);
      ['teams', 'results', 'started', 'startTime', 'endTime', 'organizer'].forEach((k) => assert.strictEqual(typeof reg.golf[k], 'function', k));
      let real = null; try { real = require('/home/claude/calcutta-calc/odds-api/calcutta.js'); } catch (e) {} if (real) { assert.strictEqual(G.registerCalcutta(real), true, 'the real Calcutta engine accepts the source'); G.registerCalcutta(fake); }
      EV.EC = { tee: NOW + 864e5, field: Array.from({ length: 20 }, (_, i) => mkG(i + 1, { tee: NOW + 864e5 + i * 60e3 })) }; const pc = { golf: { tour: 'pga', eventId: 'EC' } };
      let lots = await reg.golf.teams(pc); assert.strictEqual(lots.length, 20); eq([lots[0].id, lots[0].name], ['g:p1', 'Golfer 01']); assert.strictEqual(await reg.golf.started(pc), false); assert.strictEqual(await reg.golf.startTime(pc), NOW + 864e5); eq(await reg.golf.results(pc), {});
      // FIX 8 (fails on 544803e, which answered TRUE here; the engine treats true as permanent): a read error, an unknown game or no start time is THROWN
      feedDown = true; await assert.rejects(reg.golf.started(pc), /down/, 'feed down: rethrown, never "started"'); eq(await reg.golf.results(pc), {}, 'and nothing is paid'); feedDown = false;
      { const keep = EV.EC; EV.EC = { tee: NaN, field: keep.field.map((g) => Object.assign({}, g, { tee: null })) }; const bd0 = D.feed.board; D.feed.board = async (t0, ev) => { const b = await bd0(t0, ev); b.event.start = null; b.firstTee = null; return b; };
        await assert.rejects(reg.golf.started(pc), /no start time/, 'a missing start time is thrown, not answered as started'); D.feed.board = bd0; EV.EC = keep; assert.strictEqual(await reg.golf.started(pc), false); }
      EV.EC.field = EV.EC.field.map((g, i) => Object.assign({}, g, { started: i === 0 })); assert.strictEqual(await reg.golf.started(pc), true, 'a golfer has teed off');
      EV.EC = { done: true, tee: NOW - 4 * 864e5, field: EV.EC.field.map((g, i) => Object.assign({}, g, { started: true, toPar: i - 8, pos: i === 0 ? '1' : i < 3 ? 'T2' : String(i + 1), st: i === 19 ? 'cut' : 'active' })) };
      const rs = await reg.golf.results(pc); eq([rs['g:p1'].place, rs['g:p1'].champ, rs['g:p2'].place, rs['g:p2'].champ, rs['g:p20'].out], [1, true, 2, false, true]);
      // a golf day's teams: local lots (players of record), started once the round starts, places when final
      const dc = { golf: { gameId: tn.id } };
      // Calcutta round 4: the source checks WHO asks, and only the day's organizer may build a Calcutta on it (fails on 544803e: no viewer check, no organizer hook)
      eq([await reg['golf-day'].teams(dc), await reg['golf-day'].teams(dc, { viewer: ACC('nobody') }), await reg['golf-day'].teams(dc, {})], [null, null, null], 'no caller or a stranger who knows the game id: nothing'); assert.strictEqual((await reg['golf-day'].teams(dc, { viewer: ACC('kimmy') })).length, 3, 'a player in that golf day sees its teams');
      eq([await reg['golf-day'].organizer(dc, { viewer: ACC('proshop') }), await reg['golf-day'].organizer(dc, { viewer: ACC('kimmy') }), await reg['golf-day'].organizer(dc, {})], [true, false, false], 'only the organizer'); await assert.rejects(reg['golf-day'].organizer({ golf: { gameId: 'NOSUCHGAME' } }, { viewer: ACC('proshop') })); assert.strictEqual(await reg.golf.organizer(pc, { viewer: ACC('kimmy') }), true, 'a tour field needs no organizer');
      eq([await reg['golf-day'].endTime(dc), await reg.golf.endTime(pc)], [tn.day.lockAt + 6 * 3600e3, EV.EC.tee + 4 * 864e5], 'the scheduled end, for the 24-hour correction rule');
      lots = await reg['golf-day'].teams(dc, { viewer: ACC('proshop') }); eq(lots.map((x) => x.id), ['t:' + tn.id + ':T1', 't:' + tn.id + ':T2', 't:' + tn.id + ':T3']); // FIX 9 (fails on 544803e, which sent display names): players of record go to the engine as account ids / 'g:<guest id>'
      eq(lots.map((x) => x.players), [[{ key: ACC('lou'), name: 'Lou', accepted: true }], [{ key: ACC('kimmy'), name: 'Kimmy', accepted: true }], ['g:' + joe.gid]]); assert.ok(/^g:[a-z0-9]{10}$/.test(lots[2].players[0]), 'guest ids are lower case: the stats / Calcutta guest key form');
      eq((await G.teams(tn.id)).map((x) => x.players), [['Lou'], ['Kimmy'], ["Walk-in Joe O'Brien"]], 'the public teams() adapter still shows names only'); assert.strictEqual(await reg['golf-day'].started(dc), true);
      const dr = await reg['golf-day'].results(dc); eq([dr['t:' + tn.id + ':T3'].place, dr['t:' + tn.id + ':T3'].champ, dr['t:' + tn.id + ':T1'].place], [1, true, 3]);
      assert.strictEqual(await reg['golf-day'].started({ golf: { gameId: fr.id } }), false, 'a golf day still in set-up'); eq(await reg['golf-day'].results({ golf: { gameId: fr.id } }), {}); await assert.rejects(reg['golf-day'].started({ golf: { gameId: 'NOSUCHGAME' } }), /not found/, 'FIX 8: an unknown game id is thrown, never "started"'); { const g0 = D.S.dbGet; D.S.dbGet = async () => { throw new Error('db down'); }; await assert.rejects(reg['golf-day'].started(dc), /db down/, 'FIX 8: a database error is rethrown'); D.S.dbGet = g0; }
      D.groups = () => ({ attachGame: async (gid, e, x) => { if (e !== ACC('proshop')) throw Object.assign(new Error('Only the commissioner can add games'), { status: 403 }); await G.attachToGroup(x.ref, gid, 'CT1'); return { cid: 'CT1', pot: 'side' }; } });
      ok(await call('proshop', 'attach', { id: tn.id, groupId: 'GRP9' })); D.groups = () => null; await assert.rejects(G.linkCalcutta(tn.id, 'CALC1', ACC('kimmy'))); const lk2 = await G.linkCalcutta(tn.id, 'CALC1', ACC('proshop')); eq([lk2.attached, reg.attached], [true, ['CALC1', 'GRP9', 'CT1']]);
      t('Golf Calcutta: golf registers "golf" (tour field) and "golf-day" (teams, local) with the Calcutta engine (registerSource), with teams/results/startTime/started; FIX 8 started() never answers true by default (feed down, database error, unknown game or no start time are thrown; nothing is paid); FIX 9 players of record go to the engine as account ids / g:<guest id>, never to a phone; linkCalcutta attaches the Calcutta to the game\'s group');
    }
    // =====================================================================================================================================
    // REVIEW ROUND 2 (Nov 16 2026, "SHIP AFTER FIXES"): trust and money rules. Every check below FAILS on 544803e (see HANDOFF "Golf v1.2").
    // Rule: nobody settles, changes or finalises anything on a team they play on or score for without another team's scorer confirming; every
    // state-changing route checks the round status inside the write; after Final nothing changes except through a logged reopen every player sees.
    // =====================================================================================================================================
    NOW = Date.parse('2026-11-18T18:00:00Z'); G._reset(); FIELD = Array.from({ length: 50 }, (_, i) => mkG(i + 1)); EV = { E1: { done: false }, E2: { done: false, tee: Date.parse('2026-11-26T12:00:00Z') } };
    const crs = Object.assign({}, course, { rating: 71.2, slope: 125 });
    // one-player teams, stroke play: names[0] organizes and plays T1, the others join T2, T3 ... -> { g, pid: {name: pid} }
    const mk1 = async (names, title, day, pot, paid) => { G._reset(); let q = await call(names[0], 'create', { kind: 'day', title, course: crs, day: Object.assign({ fmt: 'stroke', teams: names.length, teamSize: 1, net: 'gross' }, day || {}), pot }); ok(q); const id = q.j.game.id, code = q.j.game.code;
      for (let i = 1; i < names.length; i++) ok(await call(names[i], 'join', { code, tid: 'T' + (i + 1) })); ok(await call(names[0], 'team', { id, op: 'assign', pid: q.j.game.me, tid: 'T1' })); const g0 = (await call(names[0], 'get', { id })).j.game, pid = {}; g0.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid));
      for (const w of paid || names) ok(await call(names[0], 'paid', { id, pid: pid[w], paid: true })); return { id, code, pid }; };
    const play = async (id, who, tid, p, f, from, to) => { for (let h = from || 1; h <= (to || 18); h++) ok(await call(who, 'score', { id, tid, hole: h, p: { [p]: f(h) } })); };
    const cnf = async (id, pairs) => { for (const [who, tid] of pairs) ok(await confirmAll(who, id, tid), who + ' confirms ' + tid); };
    { // ---- FIX 2 + 12: reopen needs a reason, tells everyone; the organizer's own change needs another team's scorer; force cannot cover it; confirm pins versions ----
      const { id, pid } = await mk1(['ann', 'bob'], 'Flip', { extras: { ctp: [3], ctpAmt: 50 } }, { entry: 100 }); ok(await call('ann', 'start', { id }));
      await play(id, 'ann', 'T1', pid.ann, (h) => PAR[h - 1] + 1); await play(id, 'bob', 'T2', pid.bob, (h) => PAR[h - 1]);
      // FIX 12: bob read ann's card BEFORE she changed hole 1; his confirm carries the versions he saw
      const sawT1 = {}; { const gb = (await call('bob', 'get', { id })).j.game; Object.keys(gb.day.scores.T1).forEach((h) => (sawT1[h] = gb.day.scores.T1[h].rev)); }
      ok(await call('ann', 'score', { id, tid: 'T1', hole: 1, p: { [pid.ann]: 2 } })); r = await call('bob', 'confirm', { id, tid: 'T1', from: 1, to: 18, revs: sawT1 }); assert.strictEqual(r.s, 409, 'a hole changed after he looked: nothing is confirmed'); eq(r.j.stale, [1]); assert.ok(/Hole 1 changed since you looked/.test(r.j.error));
      assert.ok(Object.values((await call('bob', 'get', { id })).j.game.day.scores.T1).every((x) => x.st === 'entered'));
      G._reset(); r = await call('bob', 'confirm', { id, tid: 'T1', from: 1, to: 18 }); assert.strictEqual(r.s, 409, 'no versions sent and the server has not shown him the card since: refused'); assert.ok(/open the card first/.test(r.j.error));
      ok(await call('ann', 'score', { id, tid: 'T1', hole: 1, p: { [pid.ann]: PAR[0] + 1 } })); await cnf(id, [['bob', 'T1'], ['ann', 'T2']]);
      { // review round 3: a CONFIRMED hole changes only through the neutral rule. The playing organizer's change is asked for and changes nothing until the other team signs.
        r = await call('ann', 'score', { id, tid: 'T1', hole: 2, p: { [pid.ann]: 2 } }); assert.strictEqual(r.s, 202, 'only asked for'); let q = await call('bob', 'get', { id }); eq([q.j.game.day.scores.T1[2].st, q.j.game.day.scores.T1[2].rev, q.j.game.day.scores.T1[2].p[pid.ann]], ['confirmed', 1, PAR[1] + 1], 'nothing changed'); eq([q.j.game.pending.length, q.j.game.pending[0].canSign, q.j.game.pending[0].by], [1, true, 'Ann'], 'every player sees it waiting');
        r = await call('ann', 'sign', { id, n: r.j.n }); assert.strictEqual(r.s, 403, 'not signed by herself'); r = await call('ann', 'sign', { id, n: q.j.game.pending[0].n, ok: false }); ok(r, 'she takes it back'); assert.strictEqual(r.j.game.pending.length, 0); assert.strictEqual(r.j.game.day.scores.T1[2].p[pid.ann], PAR[1] + 1); }
      t('FIX 12 confirm pins what was seen: the confirm carries the hole versions (or the server uses what it last sent that member); a score changed since then is not confirmed and needs a fresh confirm');
      ok(await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: pid.ann })); ok(await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 })); r = await call('ann', 'final', { id }); ok(r); eq(r.j.game.payout.paid.map((x) => [x.name, x.amt]), [['Bob', 200]]);
      // FIX 4: side-game winners after Final
      r = await call('bob', 'extra', { id, kind: 'ctp', hole: 3, who: pid.bob }); assert.strictEqual(r.s, 409, 'no new winner after Final'); assert.ok(/final/.test(r.j.error)); r = await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 409);
      assert.ok((await G.statsFor(ACC('ann'), {})).some((x) => x.contestId === id && x.extra.side === 'ctp' && x.won === 50), 'the confirmed winner keeps her record');
      // FIX 1: resolve after Final; FIX 14: paid list frozen; score after Final
      r = await call('ann', 'resolve', { id, tid: 'T2', hole: 5, p: { [pid.bob]: 9 } }); assert.strictEqual(r.s, 409, 'resolve never works after Final'); assert.ok(/final/.test(r.j.error));
      r = await pw('ann', 'paid', { id, pid: pid.bob, paid: false }); assert.strictEqual(r.s, 409, 'the paid list is frozen at Final'); assert.strictEqual(r.j.frozen, true); assert.ok(/Reopen scoring/.test(r.j.error)); assert.strictEqual((await call('ann', 'get', { id })).j.game.payout.frozen, true);
      r = await pw('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' }); assert.ok([403, 409].includes(r.s), 'no new bet after Final'); r = await pw('ann', 'team', { id, op: 'withdraw', tid: 'T2', reason: 'sore loser' }); assert.strictEqual(r.s, 409, 'no withdrawing a team after Final');
      // FIX 2: reopen
      r = await call('ann', 'reopen', { id }); assert.strictEqual(r.s, 400, 'reopen needs a reason'); r = await call('ann', 'reopen', { id, reason: ' x ' }); assert.strictEqual(r.s, 400); r = await call('bob', 'reopen', { id, reason: 'I want to' }); assert.strictEqual(r.s, 403);
      r = await call('ann', 'reopen', { id, reason: 'Hole 7 was written down wrong' }); assert.strictEqual(r.s, 202, 'review round 3: a playing organizer\'s reopen only waits'); assert.strictEqual(r.j.game.day.status, 'final'); assert.strictEqual(r.j.game.payout.frozen, true);
      r = await call('bob', 'sign', { id, n: r.j.n }); ok(r, 'the other team signs the reopen'); eq([r.j.game.day.status, r.j.game.day.reopens[0].by, r.j.game.day.reopens[0].sig, r.j.game.day.reopens[0].reason], ['live', 'Ann', 'Bob', 'Hole 7 was written down wrong']); assert.ok(r.j.game.day.audit.some((a) => a.what === 'reopen' && a.sig === 'Bob' && a.note === 'Hole 7 was written down wrong'));
      { const ga = (await call('ann', 'get', { id })).j.game; eq([ga.unseen, ga.notices[0].kind, ga.notices[0].new], [1, 'reopen', true], 'every other player gets the notice'); assert.ok(/Ann, signed by Bob: reopen the round after it was final. Reason: Hole 7 was written down wrong/.test(ga.notices[0].text)); assert.strictEqual((await call('ann', 'mine', {})).j.games.find((x) => x.id === id).unseen, 1, 'and it shows on the game list');
        ok(await call('ann', 'seen', { id })); assert.strictEqual((await call('ann', 'get', { id })).j.game.unseen, 0); assert.strictEqual((await call('bob', 'get', { id })).j.game.notices[0].new, false, 'not new for the one who signed it'); assert.ok(ga.plog.some((x) => x.st === 'signed' && x.kind === 'reopen' && x.by === 'Ann' && x.sig === 'Bob'), 'logged with both names'); }
      r = await call('ann', 'reopen', { id, reason: 'again' }); assert.strictEqual(r.s, 409, 'only a Final round can be reopened');
      // the organizer rewrites her own confirmed card (the D2 / D3 attack): every change only waits, the card stays as confirmed
      for (let h = 1; h <= 18; h++) { r = await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [pid.ann]: PAR[h - 1] - 1 } }); assert.strictEqual(r.s, 202); } { const ga = (await call('ann', 'get', { id })).j.game; assert.strictEqual(ga.pending.length, 18); assert.ok(Object.keys(ga.day.scores.T1).every((h) => ga.day.scores.T1[h].st === 'confirmed' && ga.day.scores.T1[h].p[pid.ann] === PAR[h - 1] + 1), 'her card is untouched'); assert.strictEqual(ga.board.rows[0].name, 'Team 2'); }
      r = await confirmAll('ann', id, 'T1'); assert.strictEqual(r.s, 403, 'nor confirm them herself'); r = await call('ann', 'resolve', { id, tid: 'T1', hole: 1, p: { [pid.ann]: 3 } }); assert.ok([403, 409].includes(r.s), 'nor "settle" them');
      // bob does not agree with hole 7: he flags it (a confirmed hole needs a note); the one who flagged never settles; ann asks for a number and bob signs it
      r = await call('bob', 'dispute', { id, tid: 'T1', hole: 7 }); assert.strictEqual(r.s, 400, 'a confirmed hole is only disputed with a note'); ok(await call('bob', 'dispute', { id, tid: 'T1', hole: 7, note: 'You made 5', want: { p: { [pid.ann]: 5 } } }));
      r = await call('bob', 'resolve', { id, tid: 'T1', hole: 7, p: { [pid.ann]: 9 } }); assert.strictEqual(r.s, 403, 'the one who raised the dispute never settles it');
      r = await call('ann', 'resolve', { id, tid: 'T1', hole: 7, p: { [pid.ann]: 3 } }); assert.strictEqual(r.s, 409, 'round 5 (N5): only one of the two numbers in the dispute'); r = await call('ann', 'resolve', { id, tid: 'T1', hole: 7, p: { [pid.ann]: 5 } }); ok(r, 'she takes Bob\'s number: it only costs her own team, and Bob asked for it'); eq([r.j.game.day.scores.T1[7].st, r.j.game.day.scores.T1[7].p[pid.ann]], ['confirmed', 5]);
      r = await call('ann', 'final', { id }); ok(r, 'now it can be finished, with every hole agreed by both'); assert.strictEqual(r.j.game.day.forced, null); assert.strictEqual(r.j.game.pending.length, 0, 'what was still waiting is dropped at Final');
      t('FIX 2 reopen: reason required, logged, every player notified; the organizer\'s change to her own team after a reopen is unconfirmed until another team\'s scorer confirms it, and Force-Final cannot cover it. FIX 4/14: no side-game winner, paid-list change, new bet or withdrawal after Final');
      // FIX 4: a confirmed winner inside a live round
      ok(await pw('ann', 'reopen', { id, reason: 'Wrong closest to the pin' })); r = await call('bob', 'extra', { id, kind: 'ctp', hole: 3, who: pid.bob }); assert.strictEqual(r.s, 409, 'a CONFIRMED winner cannot be overwritten'); assert.ok(/reopens it with a reason/.test(r.j.error));
      r = await pw('bob', 'extrareopen', { id, kind: 'ctp', hole: 3, reason: 'mine' }); assert.strictEqual(r.s, 403); r = await pw('ann', 'extrareopen', { id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 400, 'reason required');
      r = await pw('ann', 'extrareopen', { id, kind: 'ctp', hole: 3, reason: 'Bob was 2 ft, I was 5 ft' }); ok(r); assert.strictEqual(r.j.game.day.win.ctp[3].st, 'reopened'); assert.ok((await call('bob', 'get', { id })).j.game.notices.some((x) => x.kind === 'side' && /closest to the pin winner on hole 3/.test(x.text)));
      ok(await call('bob', 'extra', { id, kind: 'ctp', hole: 3, who: pid.bob, note: '2 ft' })); r = await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 403, 'the new winner typed it himself: he does not confirm it');
      ok(await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: pid.bob, note: '2 ft' })); r = await call('ann', 'extraconfirm', { id, kind: 'ctp', hole: 3 }); assert.strictEqual(r.s, 403, 'nor the one who typed it');
      r = await call('ann', 'final', { id, force: true, reason: 'nobody left to confirm it' }); assert.strictEqual(r.s, 409, 'and the organizer cannot force a finish over a winner she typed'); ok(await call('bob', 'extraconfirm', { id, kind: 'ctp', hole: 3 }), 'typed by one team, signed by the other (a two-team game: the other side is the only one who can)'); ok(await call('ann', 'final', { id }));
      eq([(await G.statsFor(ACC('bob'), {})).filter((x) => x.contestId === id && x.extra.side === 'ctp').map((x) => x.won), (await G.statsFor(ACC('ann'), {})).filter((x) => x.contestId === id && x.extra.side === 'ctp').length], [[50], 0]);
      t('FIX 4 closest to the pin / longest drive: live rounds only; a confirmed winner changes only through the organizer\'s logged reopen (every player told) and a fresh confirm by someone who is not the winner and did not type it');
    }
    { // ---- FIX 1: the organizer cannot "settle" his own never-disputed card into confirmed (the E1 attack) ----
      const { id, pid } = await mk1(['cy', 'di'], 'Resolve trick', {}, { entry: 100 }); ok(await call('cy', 'start', { id })); await play(id, 'di', 'T2', pid.di, (h) => PAR[h - 1]);
      for (let h = 1; h <= 18; h++) { r = await pw('cy', 'resolve', { id, tid: 'T1', hole: h, p: { [pid.cy]: PAR[h - 1] - 1 } }); assert.ok(r.s === 409 || r.s === 403, 'hole ' + h + ': ' + r.s); }
      assert.strictEqual(Object.keys((await call('cy', 'get', { id })).j.game.day.scores.T1 || {}).length, 0, 'nothing was written'); ok(await confirmAll('cy', id, 'T2')); r = await call('cy', 'final', { id }); assert.strictEqual(r.s, 409, 'and no Final: his own card is not played'); assert.ok(/Team 1 has played 0 of 18 holes/.test(r.j.error));
      // a co-organizer settles a hole on the organizer's team
      const { id: i2, pid: p2 } = await mk1(['cy', 'di', 'ed'], 'Co-org', {}, { entry: 10 }); r = await call('di', 'team', { id: i2, op: 'co', pid: p2.ed }); assert.strictEqual(r.s, 403, 'only the organizer names one'); ok(await call('cy', 'team', { id: i2, op: 'co', pid: p2.ed })); ok(await call('cy', 'start', { id: i2 }));
      { const gv = (await call('ed', 'get', { id: i2 })).j.game; assert.strictEqual(gv.co, true); assert.ok(gv.members.find((m) => m.pid === p2.ed).co); }
      ok(await call('cy', 'score', { id: i2, tid: 'T1', hole: 1, p: { [p2.cy]: 3 } })); ok(await call('ed', 'score', { id: i2, tid: 'T3', hole: 1, p: { [p2.ed]: 4 } })); ok(await call('di', 'dispute', { id: i2, tid: 'T1', hole: 1, note: 'That was a 5', want: { p: { [p2.cy]: 5 } } })); ok(await call('di', 'dispute', { id: i2, tid: 'T3', hole: 1, note: 'check', want: { p: { [p2.ed]: 3 } } }));
      // round 5 (N5): a money dispute is settled when the TWO TEAMS IN IT agree, or by two players from two other teams who do not gain; the number is one of the two in the dispute
      r = await call('ed', 'resolve', { id: i2, tid: 'T3', hole: 1, p: { [p2.ed]: 3 } }); assert.strictEqual(r.s, 202, 'a co-organizer only ASKS to settle his own team\'s hole'); eq(r.j.game.pending[0].who, ['Di'], 'the disputing team agrees; the organizer shares an organizer role with him');
      const nE = r.j.n; r = await call('cy', 'sign', { id: i2, n: nE }); assert.strictEqual(r.s, 403, 'not the organizer for his co-organizer'); assert.ok(/not an organizer/.test(r.j.error));
      r = await call('cy', 'resolve', { id: i2, tid: 'T3', hole: 1, p: { [p2.ed]: 2 } }); assert.strictEqual(r.s, 409, 'only the entered number or the disputed one');
      r = await call('di', 'sign', { id: i2, n: nE }); ok(r, 'the two teams agree'); eq([r.j.game.day.scores.T3[1].st, r.j.game.day.scores.T3[1].p[p2.ed], r.j.game.day.scores.T3[1].cf], ['confirmed', 3, 'Di']);
      r = await call('di', 'resolve', { id: i2, tid: 'T1', hole: 1, p: { [p2.cy]: 5 } }); assert.strictEqual(r.s, 403, 'the one who raised the dispute never settles it');
      r = await call('cy', 'resolve', { id: i2, tid: 'T1', hole: 1, p: { [p2.cy]: 5 } }); if (r.s === 202) { assert.ok(r.j.game.pending.find((q) => q.n === r.j.n).who.includes('Di')); r = await call('di', 'sign', { id: i2, n: r.j.n }); } ok(r, 'the hole\'s own team takes the other team\'s number'); eq([r.j.game.day.scores.T1[1].st, r.j.game.day.scores.T1[1].p[p2.cy]], ['confirmed', 5]);
      t('FIX 1 resolve + THE NEUTRAL RULE: never on an undisputed hole, never by the one who raised the dispute, never after Final; an organizer or co-organizer who plays only asks, and the hole\'s own team or a neutral from another team signs');
    }
    { // ---- FIX 3: Final is blocked while a team in the money is short of holes; did not finish = last, no place, no payout ----
      const { id, pid } = await mk1(['gus', 'hal', 'ivy'], 'Gross day', {}, { entry: 50 }); ok(await call('gus', 'start', { id }));
      await play(id, 'hal', 'T2', pid.hal, (h) => PAR[h - 1] + (h <= 5 ? 1 : 0)); await play(id, 'ivy', 'T3', pid.ivy, (h) => PAR[h - 1] + 1); await play(id, 'gus', 'T1', pid.gus, () => 4, 1, 1); await cnf(id, [['gus', 'T2'], ['gus', 'T3'], ['hal', 'T1']]);
      r = await call('gus', 'final', { id }); assert.strictEqual(r.s, 409, 'the one-hole card cannot win the pot'); assert.ok(/Team 1 has played 1 of 18 holes/.test(r.j.error) && /mark the team withdrawn/.test(r.j.error)); eq(r.j.incomplete, [{ tid: 'T1', name: 'Team 1', thru: 1 }]);
      r = await call('gus', 'final', { id, force: true, reason: 'let it stand' }); assert.strictEqual(r.s, 409, 'no forcing past a short card');
      r = await pw('gus', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'too early' }); assert.strictEqual(r.s, 409, 'round 5 (N1): not before the expected finish'); NOW += 6 * 3600e3;
      r = await pw('hal', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'he left' }); assert.strictEqual(r.s, 403); r = await pw('gus', 'team', { id, op: 'withdraw', tid: 'T1' }); assert.strictEqual(r.s, 400, 'reason required');
      r = await pw('gus', 'team', { id, op: 'withdraw', tid: 'T1', reason: 'Called away after one hole' }); ok(r); { const row = r.j.game.board.rows.find((x) => x.tid === 'T1'); eq([row.dnf, row.place, row.wd.reason, r.j.game.board.rows[2].tid], [true, null, 'Called away after one hole', 'T1'], 'did not finish: no place, ranked last'); }
      assert.ok(r.j.game.day.audit.some((a) => a.what === 'withdrawn' && a.note === 'Called away after one hole')); assert.ok((await call('ivy', 'get', { id })).j.game.notices.some((x) => x.kind === 'wd' && /mark Team 1 did not finish/.test(x.text)), 'logged and everyone is told');
      r = await call('gus', 'score', { id, tid: 'T1', hole: 2, p: { [pid.gus]: 3 } }); assert.strictEqual(r.s, 409, 'a withdrawn team\'s card is closed');
      r = await call('gus', 'final', { id }); ok(r); eq(r.j.game.board.rows.map((x) => [x.name, x.place, x.dnf]), [['Team 2', 1, false], ['Team 3', 2, false], ['Team 1', null, true]]); eq(r.j.game.payout.paid.map((x) => [x.name, x.amt]), [['Hal', 150]], 'no payout for the card that did not finish');
      const sg1 = (await G.statsFor(ACC('gus'), {})).find((x) => x.contestId === id); eq([sg1.place, sg1.result, sg1.stake, sg1.won, sg1.pl, sg1.extra.dnf, sg1.extra.withdrawn], [undefined, null, 50, 0, -50, true, true]); const dres = await G.calcuttaSource.results({ golf: { gameId: id } }); assert.strictEqual(dres['t:' + id + ':T1'].out, true);
      // no money: Final is allowed, but a short card still ranks last as did-not-finish
      const { id: i2, pid: p2 } = await mk1(['gus', 'hal'], 'Friendly', {}, undefined, []); ok(await call('gus', 'start', { id: i2 })); await play(i2, 'hal', 'T2', p2.hal, (h) => PAR[h - 1] + 2); await play(i2, 'gus', 'T1', p2.gus, () => 4, 1, 1);
      r = await call('gus', 'get', { id: i2 }); eq(r.j.game.board.rows.map((x) => [x.name, x.place]), [['Team 1', 1], ['Team 2', 2]], 'live: an unfinished card ranks by its score to par so far'); r = await call('gus', 'final', { id: i2 }); ok(r); eq(r.j.game.board.rows.map((x) => [x.name, x.place, x.dnf]), [['Team 2', 1, false], ['Team 1', null, true]]);
      assert.strictEqual((await G.statsFor(ACC('gus'), {})).find((x) => x.contestId === i2).result, null); assert.strictEqual((await G.statsFor(ACC('hal'), {})).find((x) => x.contestId === i2).result, 'W');
      t('FIX 3 Final is blocked (no force) while a team in a money game is short of holes; the commissioner can mark a team withdrawn (reason, logged, everyone told); an incomplete card ranks last as "did not finish" with no place, no win and no payout');
    }
    { // ---- FIX 6: a custom payout table with fewer finishers than places is re-scaled to 100%, to the cent ----
      eq(S.payouts(10000, [{ id: 'a', place: 1 }, { id: 'b', place: 2 }], [50, 30, 20]), { a: 6250, b: 3750 }); eq(S.payouts(10001, [{ id: 'a', place: 1 }, { id: 'b', place: 2 }], [50, 30, 20]), { a: 6251, b: 3750 }); eq(S.payouts(999, [{ id: 'a', place: 1 }], [60, 30, 10]), { a: 999 });
      for (const pool of [1, 99, 3333, 10001, 123457]) for (const sp of [[50, 30, 20], [40, 25, 20, 15], [34, 33, 33], [97, 1, 1, 1]]) for (let n = 1; n <= 6; n++) { const o = S.payouts(pool, Array.from({ length: n }, (_, i) => ({ id: 'e' + i, place: i + 1 })), sp); assert.strictEqual(Object.values(o).reduce((a, x) => a + x, 0), pool, 'pool ' + pool + ' split ' + sp + ' n ' + n); const tie = S.payouts(pool, Array.from({ length: n }, (_, i) => ({ id: 'e' + i, place: 1 })), sp); assert.strictEqual(Object.values(tie).reduce((a, x) => a + x, 0), pool); }
      eq(S.sharesFor([50, 30, 20], 2), [62.5, 37.5]); eq(S.prizes(10000, [50, 30, 20], 3), [5000, 3000, 2000]);
      const { id, pid } = await mk1(['ann', 'bob', 'cat'], 'Money day', {}, { entry: 10, split: [50, 30, 20] }, ['ann', 'bob']); ok(await call('ann', 'start', { id })); r = await call('ann', 'get', { id }); eq(r.j.game.payout.places, [{ place: 1, pct: 62.5, amt: 12.5 }, { place: 2, pct: 37.5, amt: 7.5 }], 'two paid sides, three places in the table: 50/30 is re-scaled to 62.5/37.5 of the $20');
      for (const w of ['ann', 'bob', 'cat']) await play(id, w, 'T' + (['ann', 'bob', 'cat'].indexOf(w) + 1), pid[w], (h) => PAR[h - 1] + ['ann', 'bob', 'cat'].indexOf(w)); await cnf(id, [['bob', 'T1'], ['ann', 'T2'], ['ann', 'T3']]);
      r = await call('ann', 'final', { id }); ok(r); eq(r.j.game.payout.paid.map((x) => [x.name, x.amt]), [['Ann', 12.5], ['Bob', 7.5]]); assert.strictEqual(r.j.game.payout.paid.reduce((a, x) => a + x.amt, 0), r.j.game.payout.pool, 'the whole pool is paid (544803e paid $16 of $20)');
      t('FIX 6 payout table with fewer finishers than places: the places left are re-scaled to 100% (50/30/20 with two finishers = 62.5/37.5); every pool, split and tie adds up to the cent');
    }
    { // ---- FIX 7 + LOWs: team skins and team closest-to-the-pin are ONE prize split among the team's players; losers get a record; unpaid = no winnings; match money ----
      G._reset(); r = await call('ann', 'create', { kind: 'day', title: 'Scramble money', course: crs, day: { fmt: 'scramble2', teams: 3, teamSize: 2, net: 'net', extras: { skins: { on: true, net: true, amt: 5 }, ctp: [3], ctpAmt: 10 }, hu: { on: true, kind: 'team', type: 'match', amt: 20 } }, pot: { entry: 20, take: { kind: 'pct', v: 10 } } }); ok(r); const id = r.j.game.id, code = r.j.game.code;
      for (const [w, h, tt] of [['bob', 20, 'T1'], ['cat', 4, 'T2'], ['dan', 14, 'T2'], ['eve', 10, 'T3'], ['fay', 30, 'T3']]) { const q = await call(w, 'join', { code, hcp: h, tid: tt }); ok(q); assert.strictEqual(q.j.hcpAsked, true, 'a number typed on joining a money game is only asked for'); }
      ok(await call('ann', 'team', { id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); let gq = (await call('ann', 'get', { id })).j.game; const pid = {}; gq.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid)); for (const n of ['ann', 'bob', 'cat', 'dan', 'eve']) ok(await pw('ann', 'paid', { id, pid: pid[n], paid: true })); // fay never pays
      // FIX 16: nobody sets their own number in a money game
      eq([gq.day.hi[pid.bob].src, gq.day.hi[pid.bob].used, gq.day.hi[pid.bob].ask, / · Asked for 20\.0: waiting for an OK$/.test(gq.day.hi[pid.bob].text)], ['none', null, 20, true]);
      r = await call('bob', 'team', { id, op: 'hcp', pid: pid.bob, hcp: 54 }); assert.strictEqual(r.s, 202, 'asked, not set'); eq([r.j.pending, r.j.game.day.hi[pid.bob].used, r.j.game.day.hi[pid.bob].ask], [true, null, 54]); r = await call('bob', 'team', { id, op: 'hcpok', pid: pid.bob }); assert.strictEqual(r.s, 403, 'not his own OK'); ok(await call('bob', 'team', { id, op: 'hcpok', pid: pid.bob, on: false }), 'he takes his own ask back (round 5: a player on another team could OK it; tested in golf.round5.test.js)');
      r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409, 'no Start in a net money game until every player has a number'); eq(r.j.needHcp.length, 6); assert.strictEqual((await call('ann', 'get', { id })).j.game.day.status, 'setup');
      // M5 (review round 3): the organizer's number for her own TEAM MATE helps her just as much: it only waits, and nobody on her team can sign it
      r = await call('ann', 'team', { id, op: 'hcp', pid: pid.bob, hcp: 20 }); assert.strictEqual(r.s, 202, 'the playing organizer only asks'); eq([r.j.game.day.hi[pid.bob].used, r.j.game.pending[0].who.sort()], [null, ['Cat', 'Dan', 'Eve', 'Fay']]); { const q = await call('bob', 'sign', { id, n: r.j.n }); assert.strictEqual(q.s, 403, 'the team mate it is for cannot sign it'); } ok(await sign(r, id, 'cat'), 'a player from another team signs it');
      for (const w of ['cat', 'dan', 'eve', 'fay']) { r = await call('ann', 'team', { id, op: 'hcpok', pid: pid[w] }); ok(r, 'round 5 (N6): her OK IS the second signature: she plays on another team and does not gain from their numbers'); }
      r = await call('ann', 'team', { id, op: 'hcp', pid: pid.ann, hcp: 8 }); assert.strictEqual(r.s, 202, 'the organizer\'s own number is only asked for too'); r = await call('bob', 'team', { id, op: 'hcpok', pid: pid.ann }); assert.strictEqual(r.s, 403, 'not by her team mate'); r = await call('ann', 'start', { id }); assert.strictEqual(r.s, 409); eq(r.j.needHcp, [pid.ann]);
      r = await call('eve', 'team', { id, op: 'hcpok', pid: pid.ann }); ok(r, 'a player who is not on her team OKs it'); eq([r.j.game.day.hi[pid.ann].src, r.j.game.day.hi[pid.ann].used, / · Entered 8\.0, OK'd by Eve$/.test(r.j.game.day.hi[pid.ann].text), / · Set by Ann: 20\.0, signed by Cat$/.test(r.j.game.day.hi[pid.bob].text)], ['typed', 8, true, true]);
      ok(await pw('ann', 'match', { id, op: 'add', a: 'T1', b: 'T2' })); r = await call('ann', 'start', { id }); ok(r); r = await call('bob', 'team', { id, op: 'hcp', pid: pid.bob, hcp: 40 }); assert.strictEqual(r.s, 409, 'locked once the round starts');
      t('FIX 16 in a money game a player (the organizer too) cannot set his own handicap: it is asked for (202) and counts only once the organizer, or for the organizer\'s own number another player not on his team, OKs it; Start is blocked in a net money game until every player has a number');
      const sc = { T1: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], T2: [4, 4, 2, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], T3: [4, 4, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 4] }, scorer = { T1: 'ann', T2: 'cat', T3: 'eve' };
      for (const tt of Object.keys(sc)) for (let h = 1; h <= 18; h++) ok(await call(scorer[tt], 'score', { id, tid: tt, hole: h, g: sc[tt][h - 1] })); await cnf(id, [['cat', 'T1'], ['eve', 'T2'], ['ann', 'T3']]);
      ok(await call('ann', 'extra', { id, kind: 'ctp', hole: 3, who: 'T2' })); ok(await call('eve', 'extraconfirm', { id, kind: 'ctp', hole: 3 })); r = await call('ann', 'final', { id }); ok(r); gq = r.j.game; eq(gq.board.skins.won, { T3: 16, T2: 2 }); eq(gq.board.matches.map((m) => [m.a, m.b, m.m.res]), [['T1', 'T2', 'W']]);
      const recs = {}; for (const w of ['ann', 'bob', 'cat', 'dan', 'eve', 'fay']) recs[w] = (await G.statsFor(ACC(w), {})).filter((x) => x.contestId === id); const all7 = Object.values(recs).flat(), side = (k) => all7.filter((x) => x.extra && x.extra.side === k);
      eq(Object.keys(recs).map((w) => { const x = recs[w].find((y) => y.extra.side === 'skins'); return [w, x.result, x.units, x.won]; }), [['ann', 'L', 0, 0], ['bob', 'L', 0, 0], ['cat', 'W', 1, 5], ['dan', 'W', 1, 5], ['eve', 'W', 8, 80], ['fay', 'W', 8, 0]], 'team skins are split among the team\'s players (544803e: $180 of records for $90 of skins); skins losers get a record; the unpaid player shows no winnings and her paid partner holds the team\'s prize');
      assert.strictEqual(side('skins').reduce((a, x) => a + x.won, 0), 18 * 5, 'the skins records total the real money: 18 skins at $5'); assert.strictEqual(recs.fay.find((y) => y.extra.side === 'skins').extra.unpaid, true);
      eq(side('ctp').map((x) => x.won), [5, 5], 'one $10 closest-to-the-pin prize, split between the two players of the team (was $10 each)');
      eq(['ann', 'bob', 'cat', 'dan'].map((w) => { const x = recs[w].find((y) => y.kind === 'match'); return [x.result, x.stake, x.won, x.pl]; }), [['W', 10, 20, 10], ['W', 10, 20, 10], ['L', 10, 0, -10], ['L', 10, 0, -10]], 'one $20 match between two teams: $10 a player; entry / payout / net like a round (payout = entry + net)');
      assert.strictEqual(all7.filter((x) => x.kind === 'golf-round').reduce((a, x) => a + x.won, 0), gq.payout.pool); eq(recs.fay.filter((x) => x.won > 0).length, 0, 'an unpaid player shows no winnings anywhere'); eq([recs.fay[0].result, recs.fay[0].stake, recs.fay[0].won, recs.fay[0].extra.unpaid], ['W', 0, 0, true]); eq(recs.eve.find((x) => x.kind === 'golf-round').won, 90);
      const ps = await G.potSummary(id); eq([ps.extras.perSkin, ps.extras.skinsPerEntrant, ps.entrants, ps.paid, ps.pool], [5, undefined, 6, 5, 90], 'LOW: potSummary says "per skin" (it was labelled per entrant)');
      t('FIX 7 team skins and team closest-to-the-pin are ONE prize split among the team\'s players in the records, which add up to the real money. LOW: skins losers get a record, an unpaid player shows no winnings, a match reads entry / payout / net like a round, potSummary says per skin');
      // LOW: skins shares always add up; shamble never counts toward the index, best ball only with the player's own full ball; singles matches at 100%
      { const a4 = Array(18).fill(4), b4 = Array(18).fill(4), c4 = Array(18).fill(4), d5 = Array(18).fill(5); for (let i = 0; i < 13; i++) a4[i] = 3; const sk = S.skins([{ id: 'A', s: a4 }, { id: 'B', s: b4 }, { id: 'C', s: c4 }, { id: 'D', s: d5 }], 18, 'split');
        eq([sk.wonC, sk.total, sk.split.shares], [{ A: 1467, B: 167, C: 166 }, 18, { A: 1.67, B: 1.67, C: 1.66 }], '5 skins riding, 3 tied on the last hole: 1.67 + 1.67 + 1.66 = 5 exactly (was 3 x 1.67 = 5.01)'); }
      for (const [fmt, own, tb] of [['shamble', false, true], ['bestball', true, false]]) { G._reset(); r = await call('sam', 'create', { kind: 'day', title: fmt + ' day', course: crs, day: { fmt, teams: 1, teamSize: 2, count: 1, net: 'gross' } }); ok(r); const q = await call('tia', 'join', { code: r.j.game.code, tid: 'T1' }); ok(await call('sam', 'team', { id: r.j.game.id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); ok(await call('sam', 'start', { id: r.j.game.id }));
        for (let h = 1; h <= 18; h++) ok(await call('sam', 'score', { id: r.j.game.id, tid: 'T1', hole: h, p: { [r.j.game.me]: 5, [q.j.game.me]: 4 } })); const x = (await G.statsFor(ACC('sam'), {})).find((y) => y.contestId === r.j.game.id); eq([x.extra.format, x.extra.ownBall, x.extra.hcpCounts, x.extra.teamBall, x.score], [fmt, own, own, tb, 90], fmt); }
      { const { id: i3, pid: p3 } = await mk1(['sam', 'tia'], 'Singles', { fmt: 'bestball', net: 'net', teamSize: 1, pct: 85, hu: { on: true, kind: 'player', type: 'match', amt: 0 } }); ok(await pw('sam', 'match', { id: i3, op: 'add', a: p3.sam, b: p3.tia })); ok(await call('sam', 'team', { id: i3, op: 'hcp', pid: p3.tia, hcp: 18 }));
        r = await call('sam', 'get', { id: i3 }); eq([r.j.game.day.heads.pct, r.j.game.day.matches[0].pct, r.j.game.board.matches[0].pct, r.j.game.day.pct], [100, 100, 100, 85], 'the format plays at 85%, the singles match at 100%'); }
      t('LOW skins split shares add up exactly; a shamble round never counts toward the index and a best-ball round only as the player\'s own full ball (flags for the stats module); singles matches play at 100%, best 2 of 4 at 85%');
    }
    { // ---- FIX 5: G16 leave / rejoin ----
      G._reset(); r = await call('ann', 'create', { kind: 'pro', title: 'Six', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' }, pot: { entry: 10 } }); ok(r); const g6 = r.j.game, T6 = g6.tiers; ok(await call('bob', 'join', { code: g6.code })); ok(await call('cat', 'join', { code: g6.code }));
      ok(await call('bob', 'pick', { id: g6.id, picks: T6.map((x) => x[0]) })); assert.strictEqual((await call('bob', 'pick', { id: g6.id, picks: T6.map((x) => x[1]) })).s, 409);
      ok(await call('bob', 'leave', { id: g6.id }), 'leaving is allowed'); assert.strictEqual((await call('bob', 'get', { id: g6.id })).s, 404, 'and the game is off his list'); assert.ok(!(await call('bob', 'mine', {})).j.games.some((x) => x.id === g6.id));
      { const ga = (await call('ann', 'get', { id: g6.id })).j.game; eq([ga.count, ga.members.find((m) => m.name === 'Bob').left, ga.entries.map((x) => x.name)], [3, true, ['Bob']], 'but the entry stays in the pool: leaving does not free the picks'); assert.strictEqual((await call('ann', 'look', { code: g6.code })).j.game.role, 'org'); assert.strictEqual((await call('bob', 'look', { code: g6.code })).j.game.back, true); }
      ok(await call('bob', 'join', { code: g6.code })); r = await call('bob', 'pick', { id: g6.id, picks: T6.map((x) => x[1]) }); assert.strictEqual(r.s, 409, 'rejoining restores the same entry, still locked'); eq((await call('bob', 'get', { id: g6.id })).j.game.mine.picks, T6.map((x) => x[0])); assert.strictEqual((await call('ann', 'get', { id: g6.id })).j.game.count, 3, 'no second seat');
      ok(await call('cat', 'leave', { id: g6.id })); assert.strictEqual((await call('ann', 'get', { id: g6.id })).j.game.count, 2, 'someone who never picked simply leaves');
      r = await call('ann', 'create', { kind: 'pro', title: 'OAD', pro: { tour: 'pga', game: 'oad' } }); ok(r); const go = r.j.game; ok(await call('eve', 'join', { code: go.code })); ok(await call('eve', 'pick', { id: go.id, event: 'E1', golfer: 'p1' })); ok(await call('eve', 'leave', { id: go.id })); ok(await call('eve', 'join', { code: go.code }));
      r = await call('eve', 'pick', { id: go.id, event: 'E1', golfer: 'p2' }); assert.strictEqual(r.s, 409, 'one and done: same tournament, the pick made before leaving stands'); NOW = TEE + 6 * 864e5; EV.E1 = { done: true }; EV.E2 = { done: false, tee: TEE + 7 * 864e5, field: FIELD.map((x) => Object.assign({}, x, { tee: x.tee + 7 * 864e5 })) }; r = await call('eve', 'pick', { id: go.id, event: 'E2', golfer: 'p1' }); assert.strictEqual(r.s, 409, 'and the golfer used before leaving stays used'); assert.ok(/already used/.test(r.j.error)); NOW = Date.parse('2026-11-18T18:00:00Z'); EV.E1 = { done: false };
      t('FIX 5 (G16) once a pick exists the entry is tied to the account: leaving keeps the picks in the pool, rejoining restores the same locked entry (pick six and one and done); a member with no pick still leaves normally');
      // ---- FIX 10: withdrawal swap ----
      ok(await call('dan', 'join', { code: g6.code })); ok(await call('dan', 'pick', { id: g6.id, picks: T6.map((x) => x[0]) })); const sw0 = T6[0][0], cand = T6[0].filter((x) => x !== sw0);
      FIELD = FIELD.map((x) => Object.assign({}, x, { tee: null }, x.id === sw0 ? { st: 'wd', started: false } : {}, [cand[0], cand[1]].includes(x.id) ? { started: true, toPar: -6 } : {})); EV.E1 = { state: 'in' }; NOW = TEE + 5 * 3600e3; D.feed.board = ((b0) => async (t0, ev) => { const b = await b0(t0, ev); b.golfers.forEach((x) => { if (x.tee == null) delete x.tee; }); if (!b.golfers.some((x) => x.tee)) b.firstTee = null; return b; })(D.feed.board);
      r = await call('dan', 'swap', { id: g6.id, from: sw0, to: cand[3] }); assert.strictEqual(r.s, 409, 'no tee times in the feed and round 1 is under way: refused'); assert.ok(/Round 1 has started and the tour feed has no tee times/.test(r.j.error)); eq((await call('dan', 'get', { id: g6.id })).j.game.mine.picks[0], sw0);
      FIELD = FIELD.map((x, i) => Object.assign({}, x, { tee: TEE + i * 5400e3 })); // tee times known: golfer i tees off 1.5 x i hours after the first tee; now = 5 hours in
      const late = T6[0].find((x) => x !== sw0 && FIELD.find((y) => y.id === x).tee > NOW && !FIELD.find((y) => y.id === x).started), early = T6[0].find((x) => x !== sw0 && FIELD.find((y) => y.id === x).tee <= NOW && !FIELD.find((y) => y.id === x).started);
      r = await call('dan', 'swap', { id: g6.id, from: sw0, to: early }); assert.strictEqual(r.s, 409, 'after the replacement\'s own tee time: refused, even if no score is posted yet'); assert.ok(/has already teed off/.test(r.j.error));
      r = await call('dan', 'swap', { id: g6.id, from: sw0, to: late }); ok(r, 'before the replacement\'s tee time: allowed, once'); eq(r.j.game.mine.picks[0], late); r = await call('dan', 'swap', { id: g6.id, from: late, to: early }); assert.strictEqual(r.s, 409);
      { const sv = (await call('ann', 'get', { id: g6.id })).j.game.swaps; eq(sv.map((x) => [x.name, x.at, x.from, x.to]), [['Dan', NOW, FIELD.find((y) => y.id === sw0).name, FIELD.find((y) => y.id === late).name]], 'the whole pool sees the swap and its time'); }
      t('FIX 10 withdrawal swap: once, only before the replacement\'s own tee time, or before round 1 starts when the feed has no tee times; shown to the whole pool with the time; otherwise refused');
      // ---- FIX 14: a finished pool's paid list ----
      EV.E1 = { done: true }; r = await pw('ann', 'paid', { id: g6.id, pid: (await call('ann', 'get', { id: g6.id })).j.game.members[1].pid, paid: true }); assert.strictEqual(r.s, 409, 'a finished pool: the paid list is frozen'); eq([r.j.frozen, r.j.needReason], [true, true]);
      r = await pw('ann', 'paid', { id: g6.id, pid: (await call('ann', 'get', { id: g6.id })).j.game.members[1].pid, paid: true, reason: 'Paid cash at the bar on Thursday' }); ok(r); eq([r.j.game.paidLog[0].name, r.j.game.paidLog[0].paid, r.j.game.paidLog[0].reason], ['Bob', true, 'Paid cash at the bar on Thursday']); assert.ok((await call('dan', 'get', { id: g6.id })).j.game.notices.some((x) => x.kind === 'paid' && /mark Bob paid \(was not paid\)\. Reason: Paid cash at the bar/.test(x.text)));
      t('FIX 14 the paid list is frozen at Final: a golf day needs the logged reopen, a finished pool a logged reason that every player is told');
      NOW = Date.parse('2026-11-18T18:00:00Z'); FIELD = Array.from({ length: 50 }, (_, i) => mkG(i + 1)); EV.E1 = { done: false };
    }
    { // ---- FIX 11: presses after a nine is closed out; the organizer's own press needs the other side ----
      const { id, pid } = await mk1(['fa', 'gi', 'ho'], 'Nassau day', { hu: { on: true, kind: 'team', type: 'nassau', amt: 5 } }); const mid9 = (await pw('fa', 'match', { id, op: 'add', a: 'T1', b: 'T2' })).j.game.day.matches[0].mid; ok(await call('fa', 'start', { id }));
      await play(id, 'fa', 'T1', pid.fa, (h) => (h <= 5 ? PAR[h - 1] + 1 : PAR[h - 1] - 1), 1, 7); await play(id, 'gi', 'T2', pid.gi, (h) => PAR[h - 1], 1, 7); // fa loses 1-5 (front closed out 5&4), then wins 6 and 7
      r = await call('fa', 'get', { id }); { const m9 = r.j.game.board.matches[0]; eq([m9.nassau.front.short, m9.nassau.front.played, m9.next.front, m9.next.back], ['5&4', 5, 8, 10], 'the bet stopped counting at 5, the round did not: the next unplayed hole is 8'); }
      r = await call('fa', 'match', { id, op: 'press', mid: mid9, from: 6 }); assert.strictEqual(r.s, 409, 'no back-dated press from a hole already played (and won)'); assert.ok(/Hole 6 has been played. A press starts on the next hole \(8\)/.test(r.j.error));
      r = await call('gi', 'match', { id, op: 'press', mid: mid9, from: 8 }); assert.strictEqual(r.s, 403, 'the side that is up cannot press'); r = await call('ho', 'match', { id, op: 'press', mid: mid9, from: 8 }); assert.strictEqual(r.s, 403, 'not someone outside the match');
      r = await call('fa', 'match', { id, op: 'press', mid: mid9, from: 8 }); ok(r, 'from the next unplayed hole: fine'); { const m9 = r.j.game.board.matches[0]; eq([m9.nassau.presses.length, m9.offers.map((x) => [x.from, x.side, x.by])], [0, [[8, 'a', 'Fa']]], 'the ORGANIZER is in this match: his press is only an offer'); }
      r = await call('fa', 'match', { id, op: 'accept', mid: mid9, from: 8 }); assert.strictEqual(r.s, 403, 'he cannot accept his own press'); r = await call('gi', 'match', { id, op: 'accept', mid: mid9, from: 8 }); ok(r, 'the other side accepts'); eq(r.j.game.board.matches[0].nassau.presses.map((x) => x.from), [8]);
      // an organizer who is NOT in the match may put a press straight in for the side that is down
      const mid2 = await (async () => { const { id: i2, pid: p2 } = await mk1(['ho', 'fa', 'gi'], 'Neutral', { hu: { on: true, kind: 'team', type: 'nassau', amt: 5 } }); const mm = (await pw('ho', 'match', { id: i2, op: 'add', a: 'T2', b: 'T3' })).j.game.day.matches[0].mid; ok(await call('ho', 'start', { id: i2 })); await play(i2, 'fa', 'T2', p2.fa, (h) => PAR[h - 1] + 1, 1, 2); await play(i2, 'gi', 'T3', p2.gi, (h) => PAR[h - 1], 1, 2);
        const q = await call('ho', 'match', { id: i2, op: 'press', mid: mm, from: 3 }); ok(q); eq([q.j.game.board.matches[0].nassau.presses.length, q.j.game.board.matches[0].offers.map((x) => x.from)], [0, [3]], 'L4: an organizer outside the match can only OFFER the press: the side that is up has to agree to the new bet'); { let a2 = await call('ho', 'match', { id: i2, op: 'accept', mid: mm, from: 3 }); assert.strictEqual(a2.s, 403, 'not accepted by the one who offered it'); a2 = await call('fa', 'match', { id: i2, op: 'accept', mid: mm, from: 3 }); assert.strictEqual(a2.s, 403, 'not by the side that is down'); a2 = await call('gi', 'match', { id: i2, op: 'accept', mid: mm, from: 3 }); ok(a2, 'the side that is up accepts'); eq(a2.j.game.board.matches[0].nassau.presses.map((x) => x.from), [3]); } r = await pw('ho', 'match', { id: i2, op: 'remove', mid: mm }); assert.strictEqual(r.s, 409, 'a match in play cannot be removed'); return mm; })(); assert.ok(mid2);
      t('FIX 11 presses: counted from the holes really played, so after a nine is closed out a press starts on the next unplayed hole and is never back-dated; the organizer\'s own press is an offer the other side must accept when he is in the match; matches are fixed once their sides have started');
    }
    { // ---- FIX 13: handicap flights with gross and net boards and a payout per flight; the payout pays what the set-up says ----
      G._reset(); const names6 = ['al', 'bo', 'cy', 'di', 'ed', 'flo'], hc = [2, 6, 11, 15, 21, 28]; r = await call('al', 'create', { kind: 'day', title: 'Flight day', course: crs, day: { fmt: 'stroke', teams: 6, teamSize: 1, net: 'both', flights: 2, payBy: 'both' }, pot: { entry: 20, split: [70, 30] } }); ok(r); const id = r.j.game.id; eq([r.j.game.day.flights.asked, r.j.game.day.payBy], [2, 'both']);
      for (let i = 1; i < 6; i++) ok(await call(names6[i], 'join', { code: r.j.game.code, tid: 'T' + (i + 1) })); ok(await call('al', 'team', { id, op: 'assign', pid: r.j.game.me, tid: 'T1' })); let gq = (await call('al', 'get', { id })).j.game; const pid = {}; gq.members.forEach((m) => (pid[m.name.toLowerCase()] = m.pid));
      for (let i = 1; i < 6; i++) ok(await pw('al', 'team', { id, op: 'hcp', pid: pid[names6[i]], hcp: hc[i] })); assert.strictEqual((await call('al', 'team', { id, op: 'hcp', pid: pid.al, hcp: hc[0] })).s, 202); ok(await call('bo', 'team', { id, op: 'hcpok', pid: pid.al })); for (const w of names6) ok(await pw('al', 'paid', { id, pid: pid[w], paid: true }));
      gq = (await call('al', 'get', { id })).j.game; eq([gq.day.flights.n, gq.day.flights.groups.map((x) => [x.k, x.lo, x.hi, x.teams])], [2, [['A', 2, 11, 3], ['B', 15, 28, 3]]], 'the preview before Start: three low handicaps in Flight A, three high in Flight B');
      r = await call('al', 'start', { id }); ok(r); eq(names6.map((w, i) => r.j.game.day.flights.of['T' + (i + 1)]), [0, 0, 0, 1, 1, 1]);
      // gross: al 72, bo 74, cy 80 | di 85, ed 90, flo 95.  course handicaps (x 125/113 - 0.8): 1, 6, 11 | 16, 22, 30 -> net 71, 68, 69 | 69, 68, 65
      const over = [0, 2, 8, 13, 18, 23]; for (let i = 0; i < 6; i++) await play(id, names6[i], 'T' + (i + 1), pid[names6[i]], (h) => PAR[h - 1] + (h <= over[i] ? 1 : 0) + (h <= over[i] - 18 ? 1 : 0)); await cnf(id, names6.map((w, i) => [names6[(i + 1) % 6], 'T' + (i + 1)]));
      r = await call('al', 'final', { id }); ok(r); gq = r.j.game; const rw = (n) => gq.board.rows.find((x) => x.name === 'Team ' + n);
      eq([1, 2, 3, 4, 5, 6].map((n) => [rw(n).gross, rw(n).net, rw(n).flight, rw(n).fPlaceG, rw(n).fPlaceN]), [[72, 71, 0, 1, 3], [74, 68, 0, 2, 1], [80, 69, 0, 3, 2], [85, 69, 1, 1, 3], [90, 68, 1, 2, 2], [95, 65, 1, 3, 1]]); eq(gq.board.flights.map((f) => [f.name, f.lo, f.hi, f.tids]), [['Flight A', 2, 11, ['T2', 'T3', 'T1']], ['Flight B', 15, 28, ['T6', 'T5', 'T4']]]);
      // pool $120: $60 a flight (3 paid players each), half to the net board and half to the gross board, 70/30
      eq(gq.payout.lines.map((l) => [l.flight, l.board, l.pool, l.places.map((x) => x.amt), l.won.map((x) => [x.name, x.amt])]), [['Flight A', 'net', 30, [21, 9], [['Team 2', 21], ['Team 3', 9]]], ['Flight A', 'gross', 30, [21, 9], [['Team 1', 21], ['Team 2', 9]]], ['Flight B', 'net', 30, [21, 9], [['Team 6', 21], ['Team 5', 9]]], ['Flight B', 'gross', 30, [21, 9], [['Team 4', 21], ['Team 5', 9]]]]);
      eq(gq.payout.paid.map((x) => [x.name, x.amt]).sort(), [['Al', 21], ['Bo', 30], ['Cy', 9], ['Di', 21], ['Ed', 18], ['Flo', 21]]); assert.strictEqual(gq.payout.paid.reduce((a, x) => a + x.amt, 0), 120);
      { const x = (await G.statsFor(ACC('bo'), {})).find((y) => y.contestId === id); eq([x.won, x.pl, x.extra.flight, x.extra.flightPlace], [30, 10, 'Flight A', 1]); }
      // "pays what the set-up says": gross and net boards kept, prize money to the GROSS board only
      const { id: i2, pid: p2 } = await mk1(['al', 'bo'], 'Both boards', { net: 'both', payBy: 'gross' }, { entry: 10 }); ok(await pw('al', 'team', { id: i2, op: 'hcp', pid: p2.bo, hcp: 30 })); assert.strictEqual((await call('al', 'team', { id: i2, op: 'hcp', pid: p2.al, hcp: 0 })).s, 202); ok(await call('bo', 'team', { id: i2, op: 'hcpok', pid: p2.al })); ok(await call('al', 'start', { id: i2 }));
      await play(i2, 'al', 'T1', p2.al, (h) => PAR[h - 1]); await play(i2, 'bo', 'T2', p2.bo, (h) => PAR[h - 1] + 1); await cnf(i2, [['bo', 'T1'], ['al', 'T2']]); r = await call('al', 'final', { id: i2 }); ok(r);
      eq([r.j.game.board.rows.map((x) => [x.name, x.placeG, x.placeN]), r.j.game.payout.payBy, r.j.game.payout.paid.map((x) => [x.name, x.amt])], [[['Team 2', 2, 1], ['Team 1', 1, 2]], 'gross', [['Al', 20]]], 'net winner Team 2, gross winner Team 1: the set-up says the money follows GROSS (544803e silently paid the net board)');
      { const q = await call('al', 'create', { kind: 'day', title: 'Few teams', course: crs, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'gross', flights: 4 } }); ok(q); eq([q.j.game.day.flights.n, /at least 4 teams/.test(q.j.game.day.flights.note || '')], [0, true], 'fewer than 4 teams: everyone in one flight, and the set-up screen says so'); }
      t('FIX 13 flights: 2 to 4 handicap flights fixed at Start from the handicaps in use, each with its own gross and net places and its own payout (the pool is shared by paid players per flight); with both boards kept the set-up says which one the money follows (gross, net or half each) and that is what is paid');
    }
    { // ---- FIX 15: two offline corrections of the same hole ----
      G._reset(); r = await call('ed', 'create', { kind: 'day', solo: true, title: 'Solo', course: crs, day: {} }); ok(r); const so2 = r.j.game; ok(await call('ed', 'score', { id: so2.id, tid: 'T1', hole: 1, p: { [so2.me]: 5 }, eid: 'x1' }));
      r = await call('ed', 'score', { id: so2.id, tid: 'T1', hole: 1, p: { [so2.me]: 6 }, eid: 'x2', rev: 1 }); ok(r); r = await call('ed', 'score', { id: so2.id, tid: 'T1', hole: 1, p: { [so2.me]: 4 }, eid: 'x3', rev: 1 }); ok(r, 'the second correction, queued with the same old version, is NOT refused'); eq([r.j.game.day.scores.T1[1].p[so2.me], r.j.game.day.scores.T1[1].rev], [4, 3], 'the latest value wins');
      // ...but someone else's newer entry is still protected
      const { id, pid } = await mk1(['ed', 'flo'], 'Stale'); ok(await call('ed', 'start', { id })); ok(await call('flo', 'score', { id, tid: 'T2', hole: 1, p: { [pid.flo]: 4 } })); ok(await call('flo', 'score', { id, tid: 'T2', hole: 1, p: { [pid.flo]: 5 } })); r = await call('ed', 'score', { id, tid: 'T2', hole: 1, p: { [pid.flo]: 3 }, rev: 1 }); assert.strictEqual(r.s, 409, 'an old version against SOMEONE ELSE\'s newer entry is still refused');
      // the phone's queue: the same code that pics/golf.js runs (queueMerge): a second correction of a hole replaces the one still waiting
      const src = require('fs').readFileSync(__dirname + '/../pics/golf.js', 'utf8'), mm = /const queueMerge = ([\s\S]*?);\n/.exec(src); assert.ok(mm, 'pics/golf.js has queueMerge'); const queueMerge = eval('(' + mm[1] + ')');
      let q5 = []; q5 = queueMerge(q5, { eid: 'a', id: 'G1', tid: 'T1', hole: 1, rev: 1, p: { x: 6 } }, null); q5 = queueMerge(q5, { eid: 'b', id: 'G1', tid: 'T1', hole: 2, rev: undefined, p: { x: 4 } }, null); q5 = queueMerge(q5, { eid: 'c', id: 'G1', tid: 'T1', hole: 1, rev: 1, p: { x: 4 } }, null);
      eq(q5.map((x) => [x.eid, x.hole, x.p.x]), [['c', 1, 4], ['b', 2, 4]], 'one entry per hole in the queue, the latest value, in its old place'); q5 = queueMerge(q5, { eid: 'd', id: 'G1', tid: 'T1', hole: 1, rev: 1, p: { x: 3 } }, 'c'); eq(q5.map((x) => x.eid), ['c', 'b', 'd'], 'an entry that is being sent right now is not touched: the new one waits behind it (the server lets the same scorer\'s later value win)');
      t('FIX 15 offline queue: a second correction of the same hole replaces the first in the phone\'s queue, and the server accepts the same scorer\'s later correction whatever version it was typed on (no 409); someone else\'s newer entry is still protected');
    }
    { // ---- ONE handicap source: money games play off the CONFIRMED index; the stats module's own line is shown ----
      G._reset(); NOW = Date.parse('2026-11-18T18:00:00Z'); for (let k = 0; k < 3; k++) { NOW += 60e3; const { id, pid } = await mk1(['rex', 'sue'], 'Pair ' + k); ok(await call('rex', 'start', { id })); await play(id, 'rex', 'T1', pid.rex, (h) => PAR[h - 1] + 1); await play(id, 'sue', 'T2', pid.sue, (h) => PAR[h - 1] + 2); await cnf(id, [['sue', 'T1'], ['rex', 'T2']]); ok(await call('rex', 'final', { id })); }
      for (let k = 0; k < 2; k++) { NOW += 60e3; r = await call('rex', 'create', { kind: 'day', solo: true, title: 'Sandbag ' + k, course: crs, day: {} }); ok(r); for (let h = 1; h <= 18; h++) ok(await call('rex', 'score', { id: r.j.game.id, tid: 'T1', hole: h, p: { [r.j.game.me]: PAR[h - 1] + 3 } })); ok(await call('rex', 'final', { id: r.j.game.id })); }
      const hx = await G.handicapFor(ACC('rex')), hc2 = await G.handicapFor(ACC('rex'), { casual: true }); eq([hx.rounds, hx.confirmedRounds, hx.use === hx.confirmedIndex, hc2.use === hx.oddable.index, hx.text], [5, 3, true, true, hx.oddable.index.toFixed(1) + ' · 3 of 5 rounds confirmed']); assert.notStrictEqual(hx.confirmedIndex, hx.oddable.index, 'two typed solo rounds moved the full index, not the confirmed one');
      assert.ok((await G.statsFor(ACC('rex'), {})).filter((x) => x.kind === 'golf-round').every((x) => x.extra.confirmed === undefined && (x.extra.solo ? x.extra.card.others === 0 && x.extra.card.by.length === 0 : x.extra.card.others === 1 && x.extra.card.by.length === 1 && x.extra.card.byName === 'Sue')), 'H4: golf never says "confirmed"; it reports who else had a scored card and which account on another team signed the card');
      NOW += 60e3; let q = await call('zoe', 'create', { kind: 'day', title: 'Money net', course: crs, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net' }, pot: { entry: 5 } }); ok(q); r = await call('rex', 'join', { code: q.j.game.code, tid: 'T2', hcp: 40 }); ok(r); const rx = r.j.game.me;
      eq([r.j.game.day.hi[rx].src, r.j.game.day.hi[rx].used, r.j.game.day.hi[rx].text, r.j.hcpAsked], ['oddable', hx.confirmedIndex, 'Oddable ' + hx.text + ' · Plays off ' + hx.confirmedIndex.toFixed(1) + ' (confirmed rounds)', undefined], 'a money game plays off the CONFIRMED index and shows the stats line "x · 3 of 5 rounds confirmed"; the 40 he typed is ignored');
      q = await call('zoe', 'create', { kind: 'day', title: 'Casual net', course: crs, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net' } }); ok(q); r = await call('rex', 'join', { code: q.j.game.code, tid: 'T2' }); ok(r); const rxc = r.j.game.me; eq([r.j.game.day.hi[rxc].used, r.j.game.day.hi[rxc].text], [hx.oddable.index, 'Oddable ' + hx.text], 'a casual game plays off the full index');
      // putting money on the game later switches everyone to the confirmed index, and a number a player typed for himself goes back to "asked"
      r = await call('zoe', 'team', { id: q.j.game.id, op: 'hcp', pid: q.j.game.me, hcp: 9 }); ok(r, 'no money: her own number counts'); assert.strictEqual(r.j.game.day.hi[q.j.game.me].src, 'typed'); r = await call('zoe', 'setup', { id: q.j.game.id, day: { extras: { skins: { on: true, amt: 2 } } } }); ok(r);
      eq([r.j.game.day.hi[q.j.game.me].src, r.j.game.day.hi[q.j.game.me].ask, r.j.game.day.hcp[rxc]], ['none', 9, hx.confirmedIndex]);
      // flights use the confirmed index too
      q = await call('zoe', 'create', { kind: 'day', title: 'Flighted', course: crs, day: { fmt: 'stroke', teams: 4, teamSize: 1, net: 'net', flights: 2 } }); ok(q); r = await call('rex', 'join', { code: q.j.game.code, tid: 'T2' }); assert.strictEqual(r.j.game.day.hi[r.j.game.me].used, hx.confirmedIndex, 'a flighted game plays off the confirmed index');
      t('ONE handicap source (stats handicapFor): money games, flights and tournaments play off the confirmed index (`use`), casual games off the full index; "12.6 · 4 of 20 rounds confirmed" is shown; golf.js keeps no index, no override store and no director log');
      NOW = Date.parse('2026-11-18T18:00:00Z');
    }
    { // ---- every play is recorded for Enterprise billing ----
      G._reset(); const seen = []; const lim0 = G.limits.recordPlay; G.limits.recordPlay = async (...a) => { seen.push(a); return lim0(...a); };
      const { id, pid } = await mk1(['ann', 'bob'], 'Billing'); ok(await call('ann', 'team', { id, op: 'add' })); ok(await call('ann', 'team', { id, op: 'guest', name: 'Walk On', tid: 'T3' })); assert.strictEqual(seen.length, 0, 'nothing before the round starts'); ok(await call('ann', 'start', { id })); ok(await call('ann', 'start', { id }));
      eq(seen.map((a) => [a[0], a[1], a[2], /^[0-9a-f]{24}$|^g:[a-z0-9]{10}$/.test(a[3])]), [[ACC('ann'), 'golf-day', id, true], [ACC('ann'), 'golf-day', id, true], [ACC('ann'), 'golf-day', id, true]], 'limits.recordPlay(account, gameType, gameId, playerKey) once per player, guests too, when the round starts (a second Start adds nothing)'); assert.ok(pid.ann);
      r = await call('ann', 'create', { kind: 'day', solo: true, title: 'Solo bill', course: crs, day: {} }); ok(r); eq(seen[3].slice(1, 3), ['golf-solo', r.j.game.id]);
      r = await call('ann', 'create', { kind: 'pro', title: 'Six bill', pro: { tour: 'pga', game: 'six', eventId: 'E1', tb: 'best' } }); ok(r); ok(await call('ann', 'pick', { id: r.j.game.id, picks: r.j.game.tiers.map((x) => x[0]) })); eq(seen[4].slice(1, 3), ['golf-six', r.j.game.id]);
      r = await call('ann', 'create', { kind: 'pro', title: 'OAD bill', pro: { tour: 'pga', game: 'oad' } }); ok(r); ok(await call('ann', 'pick', { id: r.j.game.id, event: 'E1', golfer: 'p3' })); eq(seen[5].slice(1, 3), ['golf-oad', r.j.game.id + ':E1']);
      const row = db['lock:golf:plays'].data.m['2026-11'], acct = Object.keys(row), mineP = row[G._mk(ACC('ann'))]; eq([acct.every((k) => /^[0-9a-f]{24}$/.test(k)), [mineP[id].t, mineP[id].p.length], Object.values(mineP).slice(-3).map((x) => [x.t, x.p.length])], [true, ['golf-day', 3], [['golf-solo', 1], ['golf-six', 1], ['golf-oad', 1]]], 'stand-in store: per month, per account key (never the phone), per game, one line per player');
      G.limits.recordPlay = async () => { throw new Error('billing down'); }; const { id: i2 } = await mk1(['ann', 'bob'], 'Billing down'); ok(await call('ann', 'start', { id: i2 }), 'a billing failure never blocks a round'); G.limits.recordPlay = lim0;
      t('Enterprise billing: every play is recorded through limits.recordPlay(accountKey, gameType, gameId, playerKey) (golf day at Start, solo round, pick six entry, each one-and-done tournament); a failure there never blocks play');
    }
    { // ---- status is checked INSIDE the write: a Final that lands while a score / confirm / winner is on its way wins ----
      const { id, pid } = await mk1(['ann', 'bob'], 'Race'); ok(await call('ann', 'start', { id })); ok(await call('bob', 'score', { id, tid: 'T2', hole: 1, p: { [pid.bob]: 4 } }));
      const get0 = D.S.dbGet;
      // the route reads the game (live), then Final is written, then the route's own write runs: it must re-read and refuse
      const racing = async (who, op, body) => { let n = 0; D.S.dbGet = async (k) => { const v = await get0(k); if (k === 'lock:golf:' + id && ++n === 1) { db['lock:golf:' + id].data.day.status = 'final'; db['lock:golf:' + id].updated += 1; } return v; }; const q = await call(who, op, Object.assign({ id }, body)); D.S.dbGet = get0; db['lock:golf:' + id].data.day.status = 'live'; db['lock:golf:' + id].updated += 1; return q; };
      for (const [who, op, body] of [['bob', 'score', { tid: 'T2', hole: 2, p: { [pid.bob]: 4 } }], ['ann', 'confirm', { tid: 'T2', from: 1, to: 1, revs: { 1: 1 } }], ['ann', 'dispute', { tid: 'T2', hole: 1, note: 'x' }], ['ann', 'team', { op: 'withdraw', tid: 'T2', reason: 'gone home' }], ['ann', 'match', { op: 'add', a: 'T1', b: 'T2' }]]) { const q = await racing(who, op, body); assert.ok(q.s === 409 || q.s === 403, op + ' after a Final that landed in between -> ' + q.s + ' ' + JSON.stringify(q.j).slice(0, 120)); }
      const gz = (await call('ann', 'get', { id })).j.game; eq([Object.keys(gz.day.scores.T2), gz.day.scores.T2[1].st, Object.keys(gz.day.wd).length, gz.day.matches.length], [['1'], 'entered', 0, 0], 'nothing was written');
      t('every state-changing golf-day route checks the round status INSIDE its write: a score, confirm, dispute, withdrawal or new match that was read as "live" is refused when Final landed first');
    }
    { // ---- LOW wording ----
      const cl = require('fs').readFileSync(__dirname + '/../pics/golf.js', 'utf8');
      assert.ok(/alphabetical by last name until a ranking is available/.test(cl), 'the rules screen says pick-six tiers are alphabetical until a ranking is available'); assert.ok(/9-hole round: counts toward your handicap with an expected score for the other nine/.test(cl), 'My handicap wording on 9-hole rounds follows the stats module');
      assert.ok(/best 2 of 4 85%/.test(cl) && /singles match(es)? (play )?at 100%/.test(cl), 'allowance wording matches the numbers used'); assert.ok(/Enter a course yourself/.test(cl) && /Show more courses/.test(cl) && !/Type a course in<\/button>/.test(cl));
      t('LOW wording: pick-six tiers "alphabetical by last name until a ranking is available"; 9-hole rounds as the stats module says; allowances and singles 100% said the way they are played; "Enter a course yourself" is its own last option');
    }
    NOW = Date.parse('2026-11-18T18:00:00Z');
    // ---------------- privacy ----------------
    const all = raw.join('\n'); ['@phone.oddable', '"mk"', '"org":"', 'orgE', '"tok"'].forEach((s) => assert.ok(!all.includes(s), 'leaked ' + s));
    t('no account ids, member keys or guest token hashes in any response');
    console.log('\nALL ' + pass + ' CHECKS PASSED'); srv.close(); process.exit(0);
  } catch (e) { console.error('FAIL', e); srv.close(); process.exit(1); }
});
