// TEST PREVIEW ONLY: a finished golf day (best ball 2 of 4, net, skins, closest to the pin, longest drive, a heads-up team match) played last Saturday.
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10];
const COURSE = { name: 'Tierra Verde Golf Club (demo)', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 71.2, slope: 128 };
// strokes over par by hole for each demo player (made up, steady from boot to boot)
function card(seed, over) { let x = seed * 9301 + 49297; const r = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; const o = PAR.map(() => 0); let left = over; while (left > 0) { const h = Math.floor(r() * 18); if (o[h] < 2) { o[h]++; left--; } } const b = Math.floor(r() * 18); if (o[b] === 0 && over < 16) { o[b] = -1; let h = (b + 5) % 18; while (o[h] >= 2) h = (h + 1) % 18; o[h]++; } return PAR.map((p, i) => p + o[i]); }
async function seed(C) {
  const { X, setNow, last, HOUR, DAY, chiDay, reset, ids } = C, { ok, byRole } = X, sat = last - DAY; // the Saturday before last Sunday
  setNow(sat - 3 * DAY);
  let g = (await ok('golf', 'commish', '/golf/create', { kind: 'day', title: 'Saturday Best Ball', course: COURSE, pot: { entry: 20, take: { kind: 'none', v: 0 } },
    day: { fmt: 'bestball', count: 2, pct: 100, teams: 2, teamSize: 4, net: 'net', date: chiDay(sat), extras: { skins: { on: true, net: true, amt: 5 }, ctp: [3], ld: [4], ctpAmt: 10, ldAmt: 10 }, hu: { on: true, kind: 'team', type: 'nassau', amt: 20, pair: 'pick' }, myHcp: 9.8 }, name: byRole('commish').name, myName: byRole('commish').name })).game;
  ids.golfDay = g.id; ids.golfDayCode = g.code;
  const H = { player: 12.4, director: 6.1, p4: 15.2, p5: 8.8, p6: 21.5, p7: 18.0, p8: 10.3 }, over = { commish: 11, player: 14, director: 7, p4: 17, p5: 10, p6: 24, p7: 20, p8: 12 };
  for (const r of Object.keys(H)) await ok('golf', r, '/golf/join', { code: g.code, hcp: H[r], name: byRole(r).name, myName: byRole(r).name });
  g = (await ok('golf', 'commish', '/golf/get', { id: g.id })).game; const pid = {}; g.members.forEach((m) => { pid[m.name] = m.pid; }); const P = (r) => pid[byRole(r).name];
  const T = { T1: ['commish', 'player', 'p6', 'p8'], T2: ['director', 'p4', 'p5', 'p7'] }, tids = g.day.teams.map((t) => t.tid);
  const TT = { [tids[0]]: T.T1, [tids[1]]: T.T2 };
  for (const tid of tids) for (const r of TT[tid]) await ok('golf', 'commish', '/golf/team', { id: g.id, op: 'assign', pid: P(r), tid });
  await ok('golf', 'commish', '/golf/team', { id: g.id, op: 'scorer', tid: tids[0], pid: P('player') }); await ok('golf', 'commish', '/golf/team', { id: g.id, op: 'scorer', tid: tids[1], pid: P('p5') });
  await ok('golf', 'commish', '/golf/match', { id: g.id, op: 'add', a: tids[0], b: tids[1] });
  setNow(sat + 14 * HOUR); await ok('golf', 'commish', '/golf/start', { id: g.id });
  const cards = {}; Object.keys(over).forEach((r, i) => { cards[r] = card(i + 3, over[r]); });
  for (let h = 1; h <= 18; h++) { setNow(sat + 14 * HOUR + h * 13 * 60e3); reset();
    for (const tid of tids) { const p = {}; TT[tid].forEach((r) => { p[P(r)] = cards[r][h - 1]; }); await ok('golf', tid === tids[0] ? 'player' : 'p5', '/golf/score', { id: g.id, tid, hole: h, p }); } }
  await ok('golf', 'p5', '/golf/confirm', { id: g.id, tid: tids[0], from: 1, to: 18 }); await ok('golf', 'player', '/golf/confirm', { id: g.id, tid: tids[1], from: 1, to: 18 });
  await ok('golf', 'player', '/golf/extra', { id: g.id, kind: 'ctp', hole: 3, who: P('player'), note: '6 ft 3 in' }); await ok('golf', 'p5', '/golf/extraconfirm', { id: g.id, kind: 'ctp', hole: 3 });
  await ok('golf', 'p5', '/golf/extra', { id: g.id, kind: 'ld', hole: 4, who: P('p4'), note: '287 yards' }); await ok('golf', 'player', '/golf/extraconfirm', { id: g.id, kind: 'ld', hole: 4 });
  setNow(sat + 19 * HOUR); await ok('golf', 'commish', '/golf/final', { id: g.id });
  if (ids.group) await X.call('golf', 'commish', '/golf/attach', { id: g.id, groupId: ids.group });
  C.golf = { COURSE, PAR, SI, H };
}
module.exports = { seed, COURSE };
