// Run: node odds-api/pairing.test.js — partner suggestions (owner decision P1). Pure function, no network.
const assert = require('assert'), { suggestPartners, sizesFor } = require('./pairing');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
const golf = [['a', 'Ann', 2], ['b', 'Bob', 8], ['c', 'Cat', 12], ['d', 'Dan', 18], ['e', 'Eve', 20], ['f', 'Fay', 24], ['g', 'Gus', 28], ['h', 'Hal', 36]].map(([id, name, hcp]) => ({ id, name, hcp }));
const teamsKey = (s) => s.teams.map((x) => x.slice().sort().join('')).sort().join(' ');
const whole = (s, P) => assert.deepStrictEqual(s.teams.flat().concat(s.sitOut).sort(), P.map((p) => p.id).sort(), 'everyone placed exactly once');

t('Balanced is the default; pairs of 8 golfers: the fairest split by handicap, ranked, each with a one-line reason', () => {
  const r = suggestPartners(golf, { sport: 'golf' }); assert.strictEqual(r.mode, 'balanced'); assert.strictEqual(r.teamSize, 2); assert.strictEqual(r.scale, 'hcp'); assert.strictEqual(r.length, 3);
  r.forEach((s, i) => { assert.strictEqual(s.rank, i + 1); assert.strictEqual(s.teams.length, 4); whole(s, golf); assert.ok(s.reason && !/\n/.test(s.reason) && s.reason.length < 160, s.reason); });
  // brute force: no split of 8 into 4 pairs has a smaller spread of team averages
  const best = r[0].spread; let min = Infinity; const rec = (free, acc) => { if (!free.length) { const v = acc.map((p) => (p[0].hcp + p[1].hcp) / 2); min = Math.min(min, Math.max(...v) - Math.min(...v)); return; } for (let j = 1; j < free.length; j++) rec(free.filter((_, x) => x !== 0 && x !== j), acc.concat([[free[0], free[j]]])); }; rec(golf, []);
  assert.strictEqual(best, Math.round(min * 10) / 10, 'top suggestion is the true minimum (' + min + ')'); assert.ok(r[0].spread <= r[1].spread && r[1].spread <= r[2].spread, 'ranked');
  assert.strictEqual(new Set(r.map(teamsKey)).size, 3, 'three different suggestions'); assert.match(r[0].reason, /handicap/);
});
t('Balanced foursomes (scramble): two teams of 4 with the closest average handicap', () => {
  const r = suggestPartners(golf, { teamSize: 4 }), s = r[0]; assert.deepStrictEqual(s.teams.map((x) => x.length), [4, 4]); whole(s, golf); assert.ok(s.spread <= 1, 'spread ' + s.spread); // total 148 -> 74 / 74 is possible
  assert.strictEqual(s.spread, 0); assert.match(s.reason, /Dead even/);
});
t('Ratings (pickleball doubles): higher is stronger; the top and bottom players are split up', () => {
  const P = [['a', 'Ann', 1700], ['b', 'Bob', 1650], ['c', 'Cat', 1400], ['d', 'Dan', 1350]].map(([id, name, rating]) => ({ id, name, rating }));
  const r = suggestPartners(P, { sport: 'pickleball' }); assert.strictEqual(r.scale, 'rating'); assert.strictEqual(teamsKey(r[0]), 'ad bc'); assert.strictEqual(r[0].spread, 0); assert.strictEqual(r.length, 3, 'only 3 ways to pair 4 people');
});
t('Rotate: pairs who have not played together lately come first', () => {
  const P = golf.slice(0, 4), hist = [{ date: '2026-11-01', team: ['a', 'b'], result: 'W' }, { date: '2026-11-01', team: ['c', 'd'], result: 'L' }, { date: '2026-11-08', team: ['a', 'c'], result: 'W' }, { date: '2026-11-08', team: ['b', 'd'], result: 'L' }];
  const r = suggestPartners(P, { mode: 'rotate', history: hist }); assert.strictEqual(teamsKey(r[0]), 'ad bc', 'the only pairs who have never teamed up'); assert.strictEqual(r[0].repeats, 0); assert.match(r[0].reason, /All new partners/);
  assert.strictEqual(teamsKey(r[1]), 'ab cd', 'then the older pairing (Nov 1)'); assert.strictEqual(teamsKey(r[2]), 'ac bd', 'last week\'s pairing is last'); assert.match(r[2].reason, /last time out/);
});
t('Hot pairs: best record together from lifetime stats', () => {
  const P = golf.slice(0, 4), hist = []; for (let i = 0; i < 5; i++) hist.push({ date: '2026-10-0' + (i + 1), team: ['a', 'd'], result: 'W' }, { date: '2026-10-0' + (i + 1), team: ['b', 'c'], result: i < 3 ? 'W' : 'L' }); hist.push({ date: '2026-10-09', team: ['a', 'b'], result: 'L' }, { date: '2026-10-09', team: ['c', 'd'], result: 'L' });
  const r = suggestPartners(P, { mode: 'hot', history: hist }); assert.strictEqual(teamsKey(r[0]), 'ad bc'); assert.match(r[0].reason, /Ann \+ Dan are 5-0 as partners/);
});
t('It only suggests: inputs are not changed, the result is repeatable, nothing is saved', () => {
  const P = JSON.parse(JSON.stringify(golf)), before = JSON.stringify(P), a = suggestPartners(P, { mode: 'balanced' }), b = suggestPartners(P, { mode: 'balanced' }); assert.strictEqual(JSON.stringify(P), before); assert.deepStrictEqual(a, b);
});
t('Missing handicaps are counted at the middle of the group and named; no handicaps at all still gives teams', () => {
  const P = golf.slice(0, 5).concat([{ id: 'x', name: 'Newbie' }]); const r = suggestPartners(P, {}); assert.match(r.note, /1 player has no handicap yet.*Newbie/); whole(r[0], P);
  const r2 = suggestPartners([1, 2, 3, 4].map((i) => ({ id: 'p' + i, name: 'P' + i })), {}); assert.strictEqual(r2.scale, 'none'); assert.strictEqual(r2[0].teams.length, 2); assert.match(r2[0].reason, /No handicaps or ratings yet/);
});
t('Odd counts: pairs -> one sits out; fours with 10 players -> 4, 3, 3; fewer than 4 players -> a note, no suggestions; bad options fall back', () => {
  const r = suggestPartners(golf.slice(0, 7), {}); assert.strictEqual(r[0].sitOut.length, 1); assert.strictEqual(r[0].teams.length, 3); whole(r[0], golf.slice(0, 7)); assert.match(r.note, /sits out/);
  assert.deepStrictEqual(sizesFor(10, 4).sizes, [4, 3, 3]); const ten = golf.concat([{ id: 'i', name: 'Ivy', hcp: 10 }, { id: 'j', name: 'Jo', hcp: 15 }]); const r4 = suggestPartners(ten, { teamSize: 4 }); assert.deepStrictEqual(r4[0].teams.map((x) => x.length).sort(), [3, 3, 4]); whole(r4[0], ten);
  assert.strictEqual(suggestPartners(golf.slice(0, 3), {}).length, 0); assert.strictEqual(suggestPartners(null, null).length, 0);
  const d = suggestPartners(golf, { mode: 'nonsense', teamSize: 9 }); assert.strictEqual(d.mode, 'balanced'); assert.strictEqual(d.teamSize, 2);
});
t('Big fields (enterprise, 40 players in fours): fast, everyone placed once, teams close', () => {
  const P = Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, hcp: (i * 7) % 31 })); const t0 = Date.now(), r = suggestPartners(P, { teamSize: 4 }), s = r[0];
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms'); assert.strictEqual(s.teams.length, 10); whole(s, P); assert.ok(s.spread <= 2, 'spread ' + s.spread);
});
t('Shared contract: the golf branch (players {hcp}, history {players, date, place, of}, teamHcp) and the events branch (players {rating}, lowerIsBetter, history {ids, result, at}) both work; the result is an array of {teams: [[id]], names, hcps, ratings, spread, reason, notes, leftover}', () => {
  const g = suggestPartners(golf.slice(0, 4), { mode: 'hot', teamSize: 2, history: [{ players: ['a', 'd'], date: '2026-11-01', place: 1, of: 4 }, { players: ['b', 'c'], date: '2026-11-01', place: 4, of: 4 }], teamHcp: (h) => Math.min(...h) * 0.35 + Math.max(...h) * 0.15 });
  assert.ok(Array.isArray(g) && g.length === 3); assert.ok(Array.isArray(g[0].teams[0]) && typeof g[0].teams[0][0] === 'string'); assert.strictEqual(g[0].hcps.length, 2); assert.match(g[0].reason, /Ann \+ Dan are 1-0/); assert.strictEqual(g[0].hcps[g[0].teams.findIndex((x) => x.includes('a'))], Math.round((2 * 0.35 + 18 * 0.15) * 10) / 10, 'the caller\'s team handicap formula is used');
  const e = suggestPartners([{ id: 'g1', name: 'Al', rating: 1700 }, { id: 'g2', name: 'Bo', rating: 1650 }, { id: 'g3', name: 'Cy', rating: null }, { id: 'g4', name: 'Di', rating: 1350 }, { id: 'g5', name: 'Ed', rating: 1500 }], { mode: 'rotate', teamSize: 2, history: [{ ids: ['g1', 'g2'], result: 'W', at: Date.parse('2026-11-10T18:00:00Z') }] });
  assert.ok(Array.isArray(e) && e.length); const s = e[0]; assert.strictEqual(s.mode, 'rotate'); assert.strictEqual(s.leftover.length, 1); assert.strictEqual(s.names.length, 2); assert.strictEqual(s.ratings.length, 2); assert.strictEqual(s.notes.length, 2); assert.ok(typeof s.spread === 'number' && typeof s.reason === 'string'); assert.ok(!s.teams.some((x) => x.includes('g1') && x.includes('g2')), 'last week\'s partners are split');
  const lo = suggestPartners(golf.slice(0, 4).map((p) => ({ id: p.id, name: p.name, rating: p.hcp })), { lowerIsBetter: true }); assert.strictEqual(lo.scale, 'hcp'); assert.match(lo[0].reason, /handicap/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e)).length, e.length, 'plain JSON array');
});
console.log('\nALL ' + n + ' PAIRING TESTS PASSED');
