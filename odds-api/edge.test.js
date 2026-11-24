// Run: node odds-api/edge.test.js   (v301 ⚡ Sir Oddable's Edge: the three selection rules and their grading, from pics/edge.js; no network)
const assert = require('assert'), E = require('../pics/edge.js');
let n = 0; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
// `line` = points the AWAY team gets (positive = home favoured), as g.line in pics/index.html
// ---- A: short dogs +1.5 .. +2.5, moved up 6 ----
eq(E.shortDog(1.5), { dogHome: false, from: 1.5, to: 7.5 }, '+1.5 road dog in, to +7.5');
eq(E.shortDog(2.5), { dogHome: false, from: 2.5, to: 8.5 }, '+2.5 in, to +8.5');
eq(E.shortDog(-2.5), { dogHome: true, from: 2.5, to: 8.5 }, 'home dog +2.5 in');
eq(E.shortDog(-1.5).dogHome, true, 'home dog +1.5 in');
eq(E.shortDog(2), { dogHome: false, from: 2, to: 8 }, '+2 in');
eq(E.shortDog(3), null, '+3 out');
eq(E.shortDog(-3), null, 'home +3 out');
eq(E.shortDog(1), null, '+1 out');
eq(E.shortDog(0), null, 'pick-em out');
eq(E.shortDog(null), null, 'no line');
eq(E.shortDog(undefined), null, 'no line (undefined)');
eq(E.shortDog(NaN), null, 'NaN');
eq(E.shortDog('2'), null, 'a string is not a line');
// teaser grading: dog +2 moved to +8
eq(E.gradeTeaser(2, 20, 13), 'hit', 'road dog loses by 7 with +8: covers');
eq(E.gradeTeaser(2, 21, 13), 'push', 'loses by 8 with +8: push');
eq(E.gradeTeaser(2, 22, 13), 'miss', 'loses by 9: misses');
eq(E.gradeTeaser(2.5, 21, 13), 'hit', '+8.5, loses by 8: covers');
eq(E.gradeTeaser(-1.5, 10, 17), 'hit', 'home dog +7.5, loses by 7: covers');
eq(E.gradeTeaser(-1.5, 9, 17), 'miss', 'home dog loses by 8: misses');
eq(E.gradeTeaser(-1.5, 24, 17), 'hit', 'home dog wins');
// ---- B: division road dogs under 7 ----
eq(E.divDog(6.5, true), true, '+6.5 in');
eq(E.divDog(7, true), false, '+7 out');
eq(E.divDog(7.5, true), false, '+7.5 out');
eq(E.divDog(1, true), true, '+1 in');
eq(E.divDog(0, true), false, 'pick-em is not a dog');
eq(E.divDog(-3, true), false, 'road favourite out');
eq(E.divDog(3, false), false, 'not a division game');
eq(E.divDog(null, true), false, 'no line');
eq(E.gradeDog(6.5, 20, 14), 'hit', 'loses by 6 with +6.5: covers');
eq(E.gradeDog(6.5, 21, 14), 'miss', 'loses by 7: misses');
eq(E.gradeDog(3, 17, 14), 'push', 'loses by 3 with +3: push');
eq(E.gradeDog(3, 10, 14), 'hit', 'wins outright');
// ---- C: windy unders ----
const w = (mph, o) => Object.assign({ status: 'ok', roof: 'open', mph }, o || {});
eq(E.windy(w(10)), true, '10 mph in');
eq(E.windy(w(9)), false, '9 mph out');
eq(E.windy(w(9.9)), false, '9.9 mph out');
eq(E.windy(w(25)), true, '25 mph in');
eq(E.windy(w(20, { roof: 'dome' })), false, 'dome out');
eq(E.windy(w(20, { roof: 'retract' })), false, 'retractable roof (may be closed) out');
eq(E.windy(w(20, { roof: 'neutral' })), false, 'neutral site out');
eq(E.windy(w(20, { status: 'na' })), false, 'forecast not available = out (no guess)');
eq(E.windy(w(20, { status: 'later' })), false, 'forecast not out yet = out');
eq(E.windy({ status: 'ok', roof: 'open' }), false, 'no number');
eq(E.windy(null), false, 'nothing');
eq(E.gradeUnder(44.5, 20, 21), 'hit', '41 under 44.5');
eq(E.gradeUnder(44.5, 24, 21), 'miss', '45 over 44.5');
eq(E.gradeUnder(41, 20, 21), 'push', '41 on 41');
eq(E.tally(['hit', 'miss', 'hit', 'push']), { w: 2, l: 1, p: 1 }, 'tally');
// ---- honest labels: the card text never uses the banned words, and every card carries its source + both halves ----
Object.keys(E.CARDS).forEach((k) => { const c = E.CARDS[k], all = [c.t, c.rule, c.rec].concat(c.halves, c.more, c.limits).join(' ');
  eq(E.BANNED.test(all), false, k + ': no banned words'); eq(c.halves.length, 2, k + ': both halves'); eq(/2006-2018/.test(c.halves[0]) && /2019-2026/.test(c.halves[1]), true, k + ': half periods named'); });
eq(E.SRC, 'NFL regular season 2006 to Nov 19 2026, closing lines, nflverse data', 'source line exactly');
eq(E.BANNED.test('Lock'), true, 'the guard catches "Lock"'); eq(E.BANNED.test('guaranteed'), true, 'the guard catches "guaranteed"'); eq(E.BANNED.test("can't lose"), true, "the guard catches can't lose");
eq(/510 of 671 \(76\.0%\)/.test(E.CARDS.A.rec) && /156-100 \(60\.9%\)/.test(E.CARDS.A.rec) && /\+31\.9 units/.test(E.CARDS.A.rec) && /15 of 21/.test(E.CARDS.A.rec), true, 'A record');
eq(/420-326 \(56\.3%\)/.test(E.CARDS.B.rec) && /\+77\.5 units at -110/.test(E.CARDS.B.rec) && /15 of 21/.test(E.CARDS.B.rec), true, 'B record');
eq(/223-227/.test(E.CARDS.B.more.join(' ')), true, 'B: +7 or more went 223-227');
eq(/692-564 \(55\.1%\)/.test(E.CARDS.C.rec) && /\+91\.8 units/.test(E.CARDS.C.rec) && /14 of 21/.test(E.CARDS.C.rec), true, 'C record');
eq(/74\.6%/.test(E.CARDS.A.halves[0]) && /77\.4%/.test(E.CARDS.A.halves[1]) && /55\.1%/.test(E.CARDS.B.halves[0]) && /58\.5%/.test(E.CARDS.B.halves[1]) && /53\.7%/.test(E.CARDS.C.halves[0]) && /58\.0%/.test(E.CARDS.C.halves[1]), true, 'half-period numbers');
eq(/54\.6%/.test(E.CARDS.A.more.join(' ')) && /1\.65x/.test(E.CARDS.A.more.join(' ')), true, 'A: 54.6% at -120 and 1.65x');
eq(/MEASURED/.test(E.CARDS.C.more[0]) && /FORECAST/.test(E.CARDS.C.more[0]), true, 'C: measured vs forecast said');
// ---- v302 the ⚡ chip on a game card (pure html builder) ----
eq(E.chipHtml([], 12), '', 'no edge, no chip'); eq(E.chipHtml(null, 12), '', 'null keys, no chip'); eq(E.chipHtml(['Z'], 12), '', 'unknown key, no chip');
{ const h = E.chipHtml(['A'], 12); eq(/⚡ Short dog</.test(h) && /aria-label="Sir Oddable's Edge: Short dogs, moved up 6\./.test(h) && /title="/.test(h) && /OddEdge\.open\(12,'A'\)/.test(h) && /event\.stopPropagation\(\)/.test(h), true, 'A chip: text, aria-label, title, opens card A, stops the tap'); }
{ const h = E.chipHtml(['A', 'C'], 3); eq((h.match(/<button/g) || []).length, 2, 'two edges = two chips'); eq(/⚡ Short dog</.test(h) && /⚡ Windy under</.test(h) && /open\(3,'C'\)/.test(h), true, 'both named'); }
eq(/⚡ Division road dog</.test(E.chipHtml(['B'], 1)), true, 'B chip text');
['A', 'B', 'C'].forEach((k) => eq(E.BANNED.test(E.chipHtml([k], 1)), false, k + ' chip: no banned words'));
console.log('edge.test.js: ' + n + ' checks passed');
