// HAND-MADE test data in the shape of ESPN's PGA scoreboard as the manager read it in a browser on Nov 16 2026 (see the header of pics/pga.js).
// NOT captured responses: the build shell cannot reach ESPN. Names are invented. Used by pga.test.js (Node) and shots.js (Playwright).
'use strict';
const hole = (i) => ({ value: 4, displayValue: '4', period: i, scoreType: { displayValue: 'E' } });
const holes = (n) => Array.from({ length: n }, (_, i) => hole(i + 1));
// one round: [strokes, toPar string, holes played (default 18), tee time string]
const rd = (period, r) => { const o = { value: r[0], displayValue: r[1], period, linescores: holes(r[2] == null ? (r[1] === '-' ? 0 : 18) : r[2]) }; if (r[1] === '-') delete o.linescores; if (r[3]) o.statistics = { categories: [{ stats: [{ displayValue: '70' }, { displayValue: r[3] }] }] }; return o; };
const pl = (id, order, name, score, rounds, country) => ({ id: String(id), uid: 's:1100~a:' + id, type: 'athlete', order, athlete: { fullName: name, displayName: name, shortName: name.replace(/^(\w)\w* /, '$1. '), flag: { href: 'https://a.espncdn.com/i/teamlogos/countries/500/' + (country || 'usa').toLowerCase() + '.png', alt: country || 'USA', rel: ['country-flag'] } }, score, linescores: rounds.map((r, i) => rd(i + 1, r)), statistics: [] });
const CAL = [
  { id: '401811927', label: 'The Sentry', startDate: '2026-01-08T08:00Z', endDate: '2026-01-11T08:00Z', event: { $ref: 'http://sports.core.api.espn.com/v2/x/401811927' } },
  { id: '401811990', label: 'Fall Test Open', startDate: '2026-11-05T05:00Z', endDate: '2026-11-09T05:00Z', event: { $ref: 'x' } },
  { id: '401811999', label: 'Austin Championship pres. by Compliance Solutions', startDate: '2026-11-12T05:00Z', endDate: '2026-11-16T05:00Z', event: { $ref: 'x' } },
  { id: '401812000', label: 'Sea Island Test Classic', startDate: '2026-11-19T05:00Z', endDate: '2026-11-23T05:00Z', event: { $ref: 'x' } },
  { id: '401812001', label: 'Desert Test Invitational', startDate: '2026-12-03T05:00Z', endDate: '2026-12-07T05:00Z', event: { $ref: 'x' } }
];
const wrap = (ev, comps, extra) => ({ leagues: [{ id: '1106', name: 'PGA TOUR', calendar: CAL }], season: { type: 2, year: 2026 }, day: { date: '2026-11-16' }, provider: {},
  events: ev ? [Object.assign({ uid: 's:1100~e:' + ev.id, shortName: ev.name, season: { year: 2026 }, links: [], competitions: [Object.assign({ id: ev.id, date: ev.date, endDate: ev.endDate, timeValid: false, recent: true, competitors: comps, broadcasts: [] }, extra || {})] }, ev)] : [] });
const ST = { fin: { type: { id: '3', name: 'STATUS_FINAL', state: 'post', completed: true, description: 'Final' } }, live: { type: { id: '2', name: 'STATUS_IN_PROGRESS', state: 'in', completed: false, description: 'In Progress' } }, pre: { type: { id: '1', name: 'STATUS_SCHEDULED', state: 'pre', completed: false, description: 'Scheduled' } }, susp: { type: { id: '7', name: 'STATUS_SUSPENDED', state: 'in', completed: false, description: 'Suspended' } } };
const AUSTIN = { id: '401811999', name: 'Austin Championship pres. by Compliance Solutions', date: '2026-11-12T05:00Z', endDate: '2026-11-16T05:00Z' };
const SEA = { id: '401812000', name: 'Sea Island Test Classic', date: '2026-11-19T05:00Z', endDate: '2026-11-23T05:00Z' };
const F = (a, b, c, d) => [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [d[0], d[1]]];

// FINAL (the verified shape): 4 rounds for the weekend field, 2 rounds for those who went home, one "no card" player with 0 / "-".
function final() {
  return wrap(Object.assign({ status: ST.fin }, AUSTIN), [
    pl(1, 1, 'Wade Winner', '-20', [[68, '-4', 18, 'Thu Nov 12 13:46:00 PST 2026'], [68, '-4'], [67, '-5'], [65, '-7']]),
    pl(2, 2, 'Rory Runner', '-17', F([66, '-6'], [70, '-2'], [68, '-4'], [67, '-5']), 'NIR'),
    pl(3, 3, 'Tom Tied', '-15', F([69, '-3'], [68, '-4'], [68, '-4'], [68, '-4'])),
    pl(4, 4, 'Tim Tied', '-15', F([70, '-2'], [67, '-5'], [70, '-2'], [66, '-6']), 'ENG'),
    pl(5, 5, 'Ted Tied', '-15', F([71, '-1'], [68, '-4'], [66, '-6'], [68, '-4'])),
    pl(6, 6, 'Sam Sixth', '-12', F([70, '-2'], [70, '-2'], [68, '-4'], [68, '-4'])),
    pl(7, 7, 'Evan Even', 'E', F([72, 'E'], [71, '-1'], [73, '+1'], [72, 'E'])),
    pl(8, 8, 'Otto Over', '+3', F([73, '+1'], [70, '-2'], [74, '+2'], [74, '+2'])),
    pl(9, 9, 'Luke Line', '+1', F([72, 'E'], [71, '-1'], [72, 'E'], [74, '+2'])),
    pl(10, 10, "Sean O'Home", '+1', [[73, '+1'], [72, 'E']], 'IRL'),
    pl(11, 11, 'Mike Missed', '+6', [[75, '+3'], [75, '+3']]),
    pl(12, 12, 'Nat Nocard', 'E', [[0, '-'], [0, '-']])
  ]);
}
// A bigger final field for the screenshots (120 players, like the real response).
function finalBig() {
  const j = final(), c = j.events[0].competitions[0].competitors, keep = c.splice(9, 3);
  const FN = ['Alex', 'Ben', 'Chris', 'Dan', 'Eli', 'Finn', 'Gus', 'Hank', 'Ian', 'Jack', 'Kurt', 'Leo'], LN = ['Fairway', 'Bunker', 'Greenside', 'Dogleg', 'Longiron', 'Wedgeworth', 'Van der Hazard', 'Putterson', 'Birdwell'];
  for (let i = 0; i < 61; i++) { const r = [70 + (i % 3), 71 + (i % 2), 70 + (i % 4), 71 + ((i * 7) % 4)], par = r.reduce((s, x) => s + x - 72, 0) + 2 + Math.floor(i / 6); r[3] += 2 + Math.floor(i / 6); c.push(pl(100 + i, c.length + 1, FN[i % 12] + ' ' + LN[i % 9] + (i > 35 ? ' ' + (i - 35) : ''), par === 0 ? 'E' : par > 0 ? '+' + par : String(par), r.map((x) => [x, x === 72 ? 'E' : x > 72 ? '+' + (x - 72) : String(x - 72)]))); }
  c.sort((a, b) => (parseInt(a.score, 10) || 0) - (parseInt(b.score, 10) || 0));
  for (let i = 0; i < 47; i++) { const a = 73 + (i % 4), b = 73 + ((i * 3) % 5), t = a + b - 144; c.push(pl(300 + i, 0, FN[(i * 5) % 12] + ' ' + LN[(i * 2) % 9] + ' Jr ' + (i + 1), '+' + t, [[a, '+' + (a - 72)], [b, '+' + (b - 72)]])); }
  keep.forEach((p) => c.push(p)); c.forEach((p, i) => { p.order = i + 1; });
  return j;
}
// ROUND 2 IN PROGRESS (NOT SEEN LIVE: partial inner hole lists are an assumption).
function live(bump) {
  return wrap(Object.assign({ status: ST.live }, SEA), [
    pl(21, 1, 'Ann Alpha', bump ? '-9' : '-8', [[66, '-6'], [bump ? 44 : 41, bump ? '-3' : '-2', bump ? 12 : 11]]),
    pl(22, 2, 'Bea Bravo', '-8', [[68, '-4'], [68, '-4']]),
    pl(23, 3, 'Cal Charlie', '-5', [[67, '-5'], [0, '-', 0, 'Fri Nov 20 10:10:00 PST 2026']]),
    pl(24, 4, 'Dee Delta', bump ? '-6' : '-3', [[70, '-2'], [bump ? 20 : 23, bump ? '-4' : '-1', 6]], 'AUS'),
    pl(25, 5, 'Eve Echo', 'E', [[72, 'E']]),
    pl(26, 6, 'Flo Foxtrot', '+4', [[74, '+2'], [38, '+2', 9]])
  ], { status: { period: 2, type: ST.live.type } });
}
// BEFORE ROUND 1: the field with tee times, no scores.
function pre() {
  return wrap(Object.assign({ status: ST.pre }, SEA), [
    pl(21, 1, 'Ann Alpha', 'E', [[0, '-', 0, 'Thu Nov 19 04:00:00 PST 2026']]),
    pl(22, 2, 'Bea Bravo', 'E', [[0, '-', 0, 'Thu Nov 19 04:11:00 PST 2026']]),
    pl(23, 3, 'Cal Charlie', 'E', [])
  ]);
}
// ROUND 3 UNDER WAY: the cut has been made. Early starters are the worst of those who made it; the leaders have not teed off yet.
function round3() {
  return wrap(Object.assign({ status: ST.live }, SEA), [
    pl(31, 1, 'Lee Leader', '-10', [[66, '-6'], [68, '-4']]),
    pl(32, 2, 'Sy Second', '-8', [[68, '-4'], [68, '-4']]),
    pl(33, 3, 'Earl Early', '+1', [[72, 'E'], [72, 'E'], [21, '+1', 5]]),
    pl(34, 4, 'Bo Bubble', 'E', [[73, '+1'], [71, '-1'], [36, 'E', 9]]),
    pl(35, 5, 'Gil Gone', '+2', [[73, '+1'], [73, '+1']]),
    pl(36, 6, 'Hal Home', '+7', [[76, '+4'], [75, '+3']]),
    pl(37, 7, 'Wes Walked', '+5', [[77, '+5']])
  ]);
}
// A feed that DOES flag players (not seen; defensive path).
function flagged() {
  const j = final(), c = j.events[0].competitions[0].competitors;
  c[9].status = { type: { name: 'STATUS_CUT' }, position: { displayName: 'CUT' } }; c[10].status = { type: { name: 'STATUS_WITHDRAWN', description: 'Withdrawn' } }; c[11].status = { displayValue: 'DQ' };
  return j;
}
// PLAYOFF (NOT SEEN LIVE): two players tied after four rounds, extra holes as a round numbered 5.
function playoff() {
  const j = final(), c = j.events[0].competitions[0].competitors;
  c[1].score = '-20'; c[1].linescores[3] = rd(4, [64, '-8']); c[0].linescores.push(rd(5, [4, '-1', 1])); c[1].linescores.push(rd(5, [5, 'E', 1]));
  return j;
}
function suspended() { const j = live(); j.events[0].status = ST.susp; j.events[0].competitions[0].status = { period: 2, type: ST.susp.type }; return j; }
const empty = () => wrap(null, []);
module.exports = { final, finalBig, live, pre, round3, flagged, playoff, suspended, empty, CAL, AUSTIN, SEA, wrap, pl, ST };
