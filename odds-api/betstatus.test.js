// Run: node odds-api/betstatus.test.js   (no network)
// Checks odds-api/betstatus.js against THE PHONE'S OWN CODE: legGrade / betGradeOne / betGradeLive / scPill are cut out of pics/index.html and run here,
// so if the phone's grading or wording changes and the server's does not, this file fails.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), B = require('./betstatus');
let n = 0; const ok = (c, m) => { n++; assert(c, m); }, eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };
const src = fs.readFileSync(path.join(__dirname, '..', 'pics', 'index.html'), 'utf8');
function cut(name) { const i = src.indexOf('function ' + name + '('); assert(i >= 0, 'phone function ' + name + ' not found'); let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } } throw new Error('no end for ' + name); }
const GAMES = {}; const ctx = { gameOf: (id) => GAMES[id], Number, isFinite, Math, String };
vm.createContext(ctx);
vm.runInContext(['legGrade', 'betGradeOne', 'betGradeLive', 'scPill'].map(cut).join('\n') + '\nconst scN = (n) => String(+Math.abs(n).toFixed(1));', ctx);
const phone = { leg: (l) => vm.runInContext('legGrade', ctx)(l), bet: (b) => vm.runInContext('betGradeLive', ctx)(b), pill: (l, x, leg) => vm.runInContext('scPill', ctx)(l, x, leg) };
const ev = (id, st, a, h, d, per, A, H) => ({ id, date: '2026-11-16T18:00Z', status: { period: per || 2, type: { state: st, shortDetail: d === undefined ? '1:56 - 2nd' : d } }, competitions: [{ competitors: [{ homeAway: 'home', score: String(h), team: { abbreviation: H || 'BAL' } }, { homeAway: 'away', score: String(a), team: { abbreviation: A || 'LAC' } }] }] });
const put = (e, lg) => { const g = B.parseEvent(e, lg || 'nfl'); GAMES[g.id] = g; return g; };
const gameOf = (id) => GAMES[id];
const strip = (t) => String(t).replace(/^[▲▼] /, '').toLowerCase();

// 1. parseEvent: shape, NFL abbreviations the phone's way, junk
let g = put(ev('1', 'in', 17, 7));
eq({ id: g.id, state: g.state, detail: g.detail, per: g.per, a: g.away, h: g.home }, { id: '1', state: 'in', detail: '1:56 - 2nd', per: 2, a: { raw: 'LAC', abbr: 'LAC', score: 17 }, h: { raw: 'BAL', abbr: 'BAL', score: 7 } });
eq(B.parseEvent(ev('2', 'in', 3, 0, '', 1, 'WSH', 'JAC'), 'nfl').away.abbr, 'WAS'); eq(B.parseEvent(ev('2', 'in', 3, 0, '', 1, 'WSH', 'JAC'), 'ncaaf').away.abbr, 'WSH');
for (const bad of [null, {}, { id: 1 }, { id: 1, competitions: [{}] }, { id: 1, status: { type: { state: 'weird' } }, competitions: [{ competitors: [{ homeAway: 'home', team: {} }, { homeAway: 'away', team: {} }] }] }]) eq(B.parseEvent(bad, 'nfl'), null);

// 2. PARITY with the phone, live and final: spread, moneyline, over, under, push, for both sides, many scores and lines
let par = 0;
for (const st of ['in', 'post']) for (const [a, h] of [[17, 7], [7, 17], [14, 14], [0, 0], [27, 20], [20, 27], [3, 10], [21, 24]]) {
  put(ev('1', st, a, h, st === 'post' ? 'Final' : '1:56 - 2nd'));
  const legs = [];
  for (const side of ['LAC', 'BAL']) { legs.push({ gid: '1', side, type: 'ml' }); for (const line of [4.5, -4.5, 3, -3, 7, -7, 10, -10, 0, 0.5, -2.5, '6.5', '-6.5']) legs.push({ gid: '1', side, type: 'sp', line }); }
  for (const side of ['O', 'U', 'Over', 'under', 'o']) for (const line of [34.5, 28, 41, 47, 55.5, 0.5, '44']) for (const type of ['ou', 'tot']) legs.push({ gid: '1', side, type, line });
  legs.forEach((l) => {
    const p = phone.leg(l), s = B.gradeLeg(l, gameOf('1')); eq([s.st, s.cur, s.m], [p.st, p.cur, p.m], 'leg ' + JSON.stringify(l) + ' ' + st + ' ' + a + '-' + h);
    eq(B.words(l, s, false), strip(phone.pill(l, p, false).t), 'words ' + JSON.stringify(l)); eq(B.words(l, s, true), strip(phone.pill(l, p, true).t), 'leg words'); par++;
    const pb = phone.bet(Object.assign({ id: 'x' }, l)), sb = B.gradeBet(Object.assign({ id: 'x' }, l), gameOf); eq([sb.st, sb.cur, sb.m], [pb.st, pb.cur, pb.m]);
  });
}
ok(par > 1000, 'parity cases: ' + par);
// not started = pending on both
put(ev('1', 'pre', 0, 0, '11/16 - 1:00 PM EST')); eq(B.gradeLeg({ gid: '1', side: 'LAC', type: 'sp', line: 4.5 }, gameOf('1')).st, phone.leg({ gid: '1', side: 'LAC', type: 'sp', line: 4.5 }).st); eq(B.gradeLeg({ gid: '1', side: 'LAC', type: 'ml' }, gameOf('1')).st, 'pending');

// 3. PARITY, parlays: every mix of leg states the phone knows (won, lost, push, live winning, live losing, not started)
put(ev('W', 'post', 30, 10, 'Final')); put(ev('L', 'post', 10, 30, 'Final')); put(ev('P', 'post', 20, 20, 'Final')); put(ev('LW', 'in', 14, 7)); put(ev('LL', 'in', 7, 14)); put(ev('N', 'pre', 0, 0));
const ids = ['W', 'L', 'P', 'LW', 'LL', 'N']; let pc = 0;
for (const x of ids) for (const y of ids) for (const z of ['', ...ids]) { const b = { id: 'p', kind: 'parlay', legs: [x, y, z].filter(Boolean).map((id) => ({ gid: id, side: 'LAC', type: 'ml' })) }; const p = phone.bet(b), s = B.gradeBet(b, gameOf); eq([s.st, s.cur], [p.st, p.cur], 'parlay ' + x + y + z); eq(s.legs.map((q) => q.st + (q.cur || '')), p.legs.map((q) => q.st + (q.cur || ''))); pc++; }
ok(pc === 252);
// a leg Kalshi settled keeps Kalshi's result (as on the phone); a leg with no game uses its stored result
for (const res of ['won', 'lost', 'void', 'push']) { const l = { gid: 'LL', side: 'LAC', type: 'ml', k: 'KX', res }; eq(B.gradeLeg(l, gameOf('LL')).st, phone.leg(l).st); const l2 = { res }; eq(B.gradeLeg(l2, null).st, phone.leg(l2).st); }
eq(B.gradeLeg({}, null).st, 'pending'); eq(phone.leg({}).st, 'pending');

// 4. WHERE THE SERVER IS STRICTER THAN THE PHONE (never a guess): each of these is 'unknown' and its line carries no status
put(ev('1', 'in', 17, 7));
const unsure = [{ gid: '1', side: 'XXX', type: 'sp', line: 3 }, { gid: '1', side: '', type: 'ml' }, { gid: '1', side: 'LAC', type: 'sp' }, { gid: '1', side: 'LAC', type: 'sp', line: '' }, { gid: '1', side: 'LAC', type: 'sp', line: 'abc' }, { gid: '1', side: 'LAC', type: 'sp', line: null },
  { gid: '1', side: 'LAC', type: 'weird', line: 3 }, { gid: '1', side: 'LAC' }, { gid: '1', side: 'O', type: 'ou' }, { gid: '1', side: 'X', type: 'ou', line: 44 }, { gid: '1', side: 'O', type: 'tot', line: 'x' }, { gid: 'nope', side: 'LAC', type: 'ml' }, { gid: '1', side: 'LAC', type: 'ml', k: 'K', res: 'odd' }];
unsure.forEach((l) => { eq(B.gradeLeg(l, gameOf(l.gid)).st, 'unknown', JSON.stringify(l)); const L = B.betLines([Object.assign({ id: 'u' }, l)], l.gid, gameOf); if (l.gid === '1') { eq(L.length, 1); ok(!/right now|won|lost|push|cover|winning|losing|needs|total by/i.test(L[0].replace(/^Over |^Under /, '')), 'no status on an unsure bet: ' + L[0]); } });
eq(B.gradeLeg(null, gameOf('1')).st, 'unknown'); eq(B.gradeBet(null, gameOf).st, 'unknown'); eq(B.gradeBet({ kind: 'prop', res: 'won' }, gameOf).st, 'unknown'); eq(B.gradeBet({ kind: 'future', gid: '1' }, gameOf).st, 'unknown');
eq(B.gradeBet({ gid: '1', side: 'LAC', type: 'ml', stake: 10, cash: 12 }, gameOf).st, 'sold'); eq(B.betLines([{ gid: '1', side: 'LAC', type: 'ml', stake: 10, cash: 12 }], '1', gameOf), []);
// NFL abbreviations: a bet saved as WAS (phone's way) or WSH (ESPN's) both match; the same letters for both teams never match
put(ev('5', 'in', 10, 3, '4:00 - 3rd', 3, 'WSH', 'LA')); eq(B.gradeLeg({ gid: '5', side: 'WAS', type: 'ml' }, gameOf('5')).cur, 'won'); eq(B.gradeLeg({ gid: '5', side: 'WSH', type: 'ml' }, gameOf('5')).cur, 'won'); eq(B.gradeLeg({ gid: '5', side: 'LAR', type: 'sp', line: 7.5 }, gameOf('5')).cur, 'won'); eq(B.gradeLeg({ gid: '5', side: 'la', type: 'ml' }, gameOf('5')).cur, 'lost');
// a parlay with a leg the server cannot read: no count, no "parlay" verdict; but one lost leg still decides it
put(ev('1', 'in', 17, 7));
let L = B.betLines([{ kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'ml' }, { gid: 'gone', side: 'KC', type: 'ml' }] }], '1', gameOf); eq(L, ['LAC ML (2-leg parlay): winning by 10 right now']);
L = B.betLines([{ kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'ml' }, { gid: 'gone', side: 'KC', type: 'ml' }, { gid: 'L', side: 'LAC', type: 'ml' }] }], '1', gameOf); eq(L, ['LAC ML (3-leg parlay): winning by 10 right now · parlay lost']);

// 5. the words, exactly
put(ev('1', 'in', 17, 7));
const line1 = (b) => B.betLines([b], '1', gameOf)[0];
eq(line1({ gid: '1', side: 'LAC', type: 'sp', line: 4.5 }), 'LAC +4.5: covering by 14.5 right now'); eq(line1({ gid: '1', side: 'BAL', type: 'sp', line: 4.5 }), 'BAL +4.5: not covering, 5.5 short right now');
eq(line1({ gid: '1', side: 'BAL', type: 'sp', line: 10 }), 'BAL +10: push right now'); eq(line1({ gid: '1', side: 'LAC', type: 'ml' }), 'LAC ML: winning by 10 right now'); eq(line1({ gid: '1', side: 'BAL', type: 'ml' }), 'BAL ML: losing by 10 right now');
eq(line1({ gid: '1', side: 'O', type: 'ou', line: 44.5 }), 'Over 44.5: needs 21 more right now'); eq(line1({ gid: '1', side: 'U', type: 'ou', line: 44.5 }), 'Under 44.5: under the total by 20.5 right now'); eq(line1({ gid: '1', side: 'O', type: 'tot', line: 20 }), 'Over 20: over the total by 4 right now'); eq(line1({ gid: '1', side: 'O', type: 'ou', line: 24 }), 'Over 24: right on the total right now');
put(ev('T', 'in', 7, 7)); eq(B.betLines([{ gid: 'T', side: 'LAC', type: 'ml' }], 'T', gameOf)[0], 'LAC ML: tied right now');
L = B.betLines([{ kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'sp', line: -3 }, { gid: 'W', side: 'LAC', type: 'ml' }, { gid: 'N', side: 'LAC', type: 'ml' }] }], '1', gameOf); eq(L, ['LAC -3 (3-leg parlay): covering by 7 right now · 2 of 3 legs hitting']);
eq(B.betLines([{ kind: 'prop', pp: { gid: '1', name: 'J. Herbert', line: 250.5 } }, { kind: 'prop', pp: { gid: '2' } }, { kind: 'prop' }], '1', gameOf), ['Player prop: J. Herbert']);
// order: singles, parlay legs, props; other games' bets left out
L = B.betLines([{ kind: 'prop', pp: { gid: '1', name: 'A' } }, { kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'ml' }, { gid: 'W', side: 'LAC', type: 'ml' }] }, { gid: 'W', side: 'LAC', type: 'ml' }, { gid: '1', side: 'LAC', type: 'ml' }], '1', gameOf); eq(L.map((x) => x.slice(0, 6)), ['LAC ML', 'LAC ML', 'Player']); ok(/parlay/.test(L[1]) && !/parlay/.test(L[0]));

// 6. compose: title, three lines then "+N more", correction, final ("right now" never on a final)
const five = [{ gid: '1', side: 'LAC', type: 'sp', line: 4.5 }, { gid: '1', side: 'O', type: 'ou', line: 44.5 }, { gid: '1', side: 'BAL', type: 'ml' }, { gid: '1', side: 'LAC', type: 'ml' }, { gid: '1', side: 'U', type: 'ou', line: 50 }];
let m = B.compose('score', gameOf('1'), five, gameOf); eq(m.title, 'LAC 17, BAL 7 · 2nd 1:56'); eq(m.body, 'LAC +4.5: covering by 14.5 right now; Over 44.5: needs 21 more right now; BAL ML: losing by 10 right now; +2 more'); eq(m.lines, 5);
eq(B.compose('score', gameOf('1'), five.slice(0, 3), gameOf).body.split('; ').length, 3); ok(!/more/.test(B.compose('score', gameOf('1'), five.slice(0, 3), gameOf).body.replace('needs 21 more', '')));
eq(B.compose('fix', gameOf('1'), five.slice(0, 1), gameOf).title, 'Score corrected: LAC 17, BAL 7 · 2nd 1:56');
eq(B.compose('score', gameOf('1'), [], gameOf).lines, 0);
put(ev('1', 'post', 27, 20, 'Final')); m = B.compose('final', gameOf('1'), [{ gid: '1', side: 'LAC', type: 'sp', line: 4.5 }, { gid: '1', side: 'BAL', type: 'ml' }, { gid: '1', side: 'BAL', type: 'sp', line: 7 }, { kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'ml' }, { gid: 'W', side: 'LAC', type: 'ml' }] }], gameOf);
eq(m.title, 'Final: LAC 27, BAL 20'); eq(m.body, 'LAC +4.5 won; BAL ML lost; BAL +7 push; +1 more'); ok(!/right now/.test(m.title + m.body));
eq(B.betLines([{ kind: 'parlay', legs: [{ gid: '1', side: 'LAC', type: 'ml' }, { gid: 'W', side: 'LAC', type: 'ml' }] }], '1', gameOf), ['LAC ML (2-leg parlay): leg won · parlay won']);
// My Apps' limits: title <= 80, body <= 240, no line breaks, whole bets only
{ put(ev('1', 'in', 17, 7)); const long = Array.from({ length: 6 }, (_, i) => ({ kind: 'parlay', legs: Array.from({ length: 9 }, (_, k) => ({ gid: k ? 'W' : '1', side: 'LAC', type: 'sp', line: -(i + 1.5) })) }));
  const mm = B.compose('score', gameOf('1'), long, gameOf); ok(mm.body.length <= 240 && mm.title.length <= 80 && !/[\n\r]/.test(mm.title + mm.body), 'limits: ' + mm.body.length); ok(/; \+\d more$/.test(mm.body), mm.body);
  const props = Array.from({ length: 5 }, (_, i) => ({ kind: 'prop', pp: { gid: '1', name: 'Player Number ' + i + ' ' + 'x'.repeat(40) } })); const m2 = B.compose('score', gameOf('1'), props, gameOf); ok(m2.body.length <= 240 && m2.lines === 5);
  const big = B.parseEvent(ev('B', 'in', 100, 100, 'x'.repeat(40), 1, 'ABCDEFGH', 'IJKLMNOP'), 'nba'); ok(B.compose('fix', big, [{ gid: 'B', side: 'ABCDEFGH', type: 'ml' }], () => big).title.length <= 80); }
put(ev('H', 'in', 14, 10, 'Halftime')); eq(B.compose('period', gameOf('H'), [{ gid: 'H', side: 'LAC', type: 'ml' }], gameOf).title, 'LAC 14, BAL 10 · Halftime');
ok(!/[<>]/.test(B.compose('score', B.parseEvent(ev('X', 'in', 1, 0, '<b>x</b>', 1, '<i>', 'BAL'), 'nhl'), [{ gid: 'X', side: '<i>', type: 'ml' }], (id) => null).title));

// 7. change(): the phone's spScan rules
const c = (a, h, st, d, per) => ({ a, h, st: st || 'in', d: d || '', per: per || 1 });
eq(B.change(null, c(7, 0)), { all: '', bb: '' }, 'first look is silent'); eq(B.change(c(0, 0), c(7, 0)), { all: 'score', bb: '' }); eq(B.change(c(7, 0), c(7, 0)), { all: '', bb: '' });
eq(B.change(c(7, 0), c(6, 0)).all, 'fix'); eq(B.change(c(7, 3), c(6, 10)).all, 'fix'); eq(B.change(c(7, 0), c(14, 3)).all, 'score');
eq(B.change(c(7, 0), c(7, 0, 'post')), { all: 'final', bb: 'final' }); eq(B.change(c(7, 0, 'post'), c(7, 0, 'post')), { all: '', bb: '' }); eq(B.change(c(7, 0, 'post'), c(9, 0, 'post')), { all: '', bb: '' }, 'a final game never alerts again');
eq(B.change(c(0, 0, 'pre'), c(0, 0, 'in')), { all: '', bb: '' }, 'kickoff is not a score'); eq(B.change(c(0, 0, 'pre'), c(3, 0, 'in')), { all: '', bb: '' }); eq(B.change(c(0, 0, 'pre'), c(3, 0, 'post')), { all: '', bb: '' });
eq(B.change(c(20, 18, 'in', '0:02 - 1st', 1), c(22, 18, 'in', 'End of 1st', 1)), { all: 'score', bb: 'period' }); eq(B.change(c(22, 18, 'in', 'End of 1st', 1), c(22, 18, 'in', 'End of 1st', 1)).bb, '');
eq(B.change(c(22, 18, 'in', 'End of 1st', 1), c(24, 18, 'in', '11:40 - 2nd', 2)).bb, '', 'the break was already reported'); eq(B.change(c(20, 18, 'in', '0:10 - 1st', 1), c(24, 18, 'in', '11:40 - 2nd', 2)).bb, 'period', 'a missed break is reported once');
eq(B.change(c(50, 48, 'in', '0:01 - 2nd', 2), c(50, 48, 'in', 'Halftime', 2)).bb, 'period'); eq(B.change(c(20, 18, 'in', '5:00 - 1st', 1), c(22, 18, 'in', '4:40 - 1st', 1)), { all: 'score', bb: '' }, 'a basket is no quarter alert');

// 8. helpers
ok(B.isOpen({ gid: '1' }) && !B.isOpen({ fin: 'won' }) && !B.isOpen({ res: 'lost' }) && !B.isOpen({ stake: 5, cash: 0 }) && !B.isOpen(null) && B.isOpen({ kind: 'parlay', legs: [] }));
eq(B.gids({ gid: 7 }), ['7']); eq(B.gids({ kind: 'parlay', legs: [{ gid: 1 }, null, { gid: '2' }, {}] }), ['1', '2']); eq(B.gids({ kind: 'prop', pp: { gid: 3 } }), ['3']); eq(B.gids({ kind: 'prop' }), []); eq(B.gids(null), []);
eq(B.label({ side: 'LAC', type: 'sp', line: -3 }), 'LAC -3'); eq(B.label({ side: 'LAC', type: 'sp', line: 0 }), 'LAC 0'); eq(B.label({ side: 'U', type: 'tot', line: '41.5' }), 'Under 41.5'); eq(B.label({ side: 'LAC', type: 'ml' }), 'LAC ML'); eq(B.label({}), ''); eq(B.clock('1:56 - 2nd'), '2nd 1:56'); eq(B.clock('Halftime'), 'Halftime');
console.log('betstatus.test.js: ' + n + ' checks passed (' + par + ' single-bet and ' + pc + ' parlay cases compared with the phone\'s own code)');
