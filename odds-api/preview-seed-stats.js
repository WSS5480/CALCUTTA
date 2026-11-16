// TEST PREVIEW ONLY: self-logged plays so every dashboard has history (golf rounds that build an Oddable Handicap Index, pickleball matches that build
// an Oddable rating, one other game), then an upcoming Enterprise tournament run by the director with handicaps prefilled from the real index.
const { COURSE } = require('./preview-seed-golf');
// 20 rounds per player: [course rating, slope, score]. RGV Ray's lowest eight differentials average 12.4 (11.4, 11.9, 12.4 x3, 12.9 x3).
const RAY = [[71.6, 113, 83], [73.1, 113, 85], [71.6, 113, 84], [71.6, 113, 84], [71.6, 113, 84], [71.1, 113, 84], [71.1, 113, 84], [71.1, 113, 84], [71.6, 113, 87], [71.6, 113, 88], [71.6, 113, 89], [71.1, 113, 88], [71.6, 113, 90], [71.6, 113, 91], [71.1, 113, 87], [71.6, 113, 92], [71.6, 113, 88], [71.6, 113, 93], [71.1, 113, 90], [71.6, 113, 94]];
const COURSES = ['Tierra Verde Golf Club (demo)', 'Palm Valley Links (demo)', 'Rio Lomas Golf Course (demo)'];
const shift = (rounds, d) => rounds.map(([cr, sl, sc]) => [cr, sl, sc + d]);
async function seed(C) {
  const { X, setNow, REAL, DAY, HOUR, chiDay, reset, ids, mods, next } = C, { ok, byRole, emailOf, S } = X, LIM = mods.limits;
  setNow(REAL - HOUR);
  const rounds = { player: RAY, commish: shift(RAY, -3).slice(0, 12), director: shift(RAY, -6).slice(0, 14), p4: shift(RAY, 3).slice(0, 8), p5: shift(RAY, -4).slice(0, 9), p6: shift(RAY, 9).slice(0, 5), p7: shift(RAY, 6).slice(0, 6), p8: shift(RAY, -2).slice(0, 7) };
  for (const r of Object.keys(rounds)) { const L = rounds[r]; for (let i = 0; i < L.length; i++) { const [cr, slope, total] = L[i];
    await ok('stats', r, '/stats/self/save', { myName: byRole(r).name, item: { type: 'golf', date: chiDay(REAL - (4 + i * 6) * DAY), course: COURSES[i % 3], tees: 'White', holes: 18, par: 72, cr, slope, total, format: 'individual' } }); } reset(); }
  // pickleball matches logged by hand (singles and doubles), so the rating and "played together" history exist
  const PB = [['player', 'singles', ['Lefty Lou'], null, [[11, 7]], 3], ['player', 'singles', ['Birdie Bea'], null, [[9, 11]], 9], ['player', 'doubles', ['Lefty Lou', 'Dinker Dee'], 'Coach Mo', [[11, 8], [11, 9]], 12], ['player', 'doubles', ['Birdie Bea', 'Ace Abe'], 'Coach Mo', [[11, 5]], 19],
    ['player', 'doubles', ['Coach Mo', 'Birdie Bea'], 'Dinker Dee', [[6, 11]], 26], ['player', 'singles', ['Ace Abe'], null, [[11, 3]], 33], ['commish', 'singles', ['Dinker Dee'], null, [[11, 9]], 5], ['commish', 'doubles', ['Lefty Lou', 'Ace Abe'], 'Birdie Bea', [[11, 13]], 15], ['p5', 'singles', ['Lefty Lou'], null, [[11, 6]], 8], ['p4', 'singles', ['Ace Abe'], null, [[11, 9]], 11], ['p6', 'singles', ['Ace Abe'], null, [[7, 11]], 13]];
  for (const [r, fmt, opp, partner, games, ago] of PB) await ok('stats', r, '/stats/self/save', { myName: byRole(r).name, item: Object.assign({ type: 'pickleball', date: chiDay(REAL - ago * DAY), fmt, opp, games }, partner ? { partner } : {}) }).catch((e) => { throw new Error('pickleball: ' + e.message); });
  await X.call('stats', 'player', '/stats/self/save', { myName: 'RGV Ray', item: { type: 'other', date: chiDay(REAL - 2 * DAY), game: 'Cornhole', title: 'Cornhole at the tailgate', result: 'W', score: '21-15', opp: 'Tex Tina' } });
  reset();
  const me = await ok('stats', 'player', '/stats/me', {}); ids.rayIndex = me.golfHcp && me.golfHcp.index; ids.statsSources = me.sources; ids.statsErrors = me.errors; ids.rayRecords = (me.records || []).length;
  // Enterprise: the owner-set flag on the director's account (limits.js), so the director's tournament is not capped at 8
  const dk = LIM.keyOf(emailOf(byRole('director')));
  await S.dbPut({ id: 'lock:ent', salt: 'x', pinhash: 'x', data: { acct: { [dk]: { on: true, name: 'Tierra Verde Golf Club (demo)', at: REAL - 10 * DAY } }, seats: {} }, updated: 1 }); reset();
  const sat = next - DAY; setNow(REAL - 2 * HOUR);
  let g = (await ok('golf', 'director', '/golf/create', { kind: 'day', title: 'Member-Guest Scramble', course: COURSE, pot: { entry: 40, take: { kind: 'none', v: 0 } }, myName: byRole('director').name,
    day: { fmt: 'scramble4', teams: 3, teamSize: 4, net: 'net', date: chiDay(sat), extras: { skins: { on: true, net: false, amt: 10 }, ctp: [7, 12], ld: [9], ctpAmt: 20, ldAmt: 20 }, hu: { on: false } } })).game;
  ids.tour = g.id; ids.tourCode = g.code; const pid = { director: g.me };
  for (const r of ['commish', 'player', 'p4', 'p5', 'p6', 'p7', 'p8']) { const j = await ok('golf', r, '/golf/join', { code: g.code, myName: byRole(r).name }); pid[r] = j.game.me; }
  for (const nm of ['Guest Gus', 'Walk-on Wendy']) { const j = await X.call('golf', 'director', '/golf/team', { id: g.id, op: 'guest', name: nm }); if (j.s !== 200) ids.tourGuestNote = (j.j && j.j.error) || 'guest add refused'; }
  g = (await ok('golf', 'director', '/golf/get', { id: g.id })).game; const tids = g.day.teams.map((t) => t.tid);
  const order = g.members.map((m) => m.pid); for (let i = 0; i < order.length; i++) await X.call('golf', 'director', '/golf/team', { id: g.id, op: 'assign', pid: order[i], tid: tids[i % tids.length] });
  ids.tourPids = pid; setNow(REAL); reset();
  // the director's override the owner asked to see (E-H, through the real golf + stats routes): RGV Ray plays this tournament off 10.0; his Oddable index stays what his real results say
  await ok('golf', 'director', '/golf/team', { id: g.id, op: 'hcp', pid: pid.player, hcp: 10.0, reason: 'Club committee number for the member-guest' });
  const guest = g.members.find((m) => m.guest); if (guest) { const r = await X.call('golf', 'director', '/golf/team', { id: g.id, op: 'hcp', pid: guest.pid, hcp: 18.0, reason: 'Guest with no Oddable rounds yet: home club card' }); if (r.s !== 200) ids.tourGuestHcpNote = r.j && r.j.error; }
  const chk = (await ok('golf', 'player', '/golf/get', { id: g.id })).game; ids.tourRay = JSON.stringify((chk.day.teams || []).map((t) => t.players).flat().find((p) => p.pid === pid.player) || null).slice(0, 300);
}
module.exports = { seed };
