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
    day: { fmt: 'scramble4', teams: 3, teamSize: 4, net: 'net', date: chiDay(sat), teeTime: sat + 14.5 * HOUR, extras: { skins: { on: true, net: false, amt: 10 }, ctp: [7, 12], ld: [9], ctpAmt: 20, ldAmt: 20 }, hu: { on: false } } })).game;
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
  // ---- extras so the commissioner-only and director-only screens have something to act on (each is optional: a refusal is noted, not fatal) ----
  const soft = async (name, fn) => { try { await fn(); } catch (e) { ids['note_' + name] = String(e.message).slice(0, 160); console.error('preview seed extra [' + name + ']: ' + String(e.message).slice(0, 300)); } };
  // a golf day in progress: scores to enter, holes to confirm, one hole disputed
  await soft('liveGolf', async () => { const T0 = REAL - 2 * HOUR; setNow(T0 - HOUR);
    let lg = (await ok('golf', 'commish', '/golf/create', { kind: 'day', title: 'Sunday Nine (in progress)', course: COURSE, pot: { entry: 0, take: { kind: 'none', v: 0 } }, myName: byRole('commish').name, day: { fmt: 'bestball', count: 1, pct: 100, teams: 2, teamSize: 2, net: 'net', date: chiDay(REAL), extras: { skins: { on: false }, ctp: [3], ld: [] }, hu: { on: false } } })).game; ids.golfLive = lg.id;
    const lp = { commish: lg.me }; for (const r of ['player', 'p4', 'p5']) lp[r] = (await ok('golf', r, '/golf/join', { code: lg.code, myName: byRole(r).name })).game.me;
    lg = (await ok('golf', 'commish', '/golf/get', { id: lg.id })).game; const [ta, tb] = lg.day.teams.map((t) => t.tid);
    for (const [r, t] of [['commish', ta], ['player', ta], ['p4', tb], ['p5', tb]]) await ok('golf', 'commish', '/golf/team', { id: lg.id, op: 'assign', pid: lp[r], tid: t });
    await ok('golf', 'commish', '/golf/team', { id: lg.id, op: 'scorer', tid: ta, pid: lp.player }); await ok('golf', 'commish', '/golf/team', { id: lg.id, op: 'scorer', tid: tb, pid: lp.p4 });
    if (C.golfOk) await C.golfOk(lg.id, 'commish', 'p4').catch(() => {});
    setNow(T0); await ok('golf', 'commish', '/golf/start', { id: lg.id });
    for (let h = 1; h <= 6; h++) { setNow(T0 + h * 14 * 60e3); reset(); await ok('golf', 'player', '/golf/score', { id: lg.id, tid: ta, hole: h, p: { [lp.commish]: COURSE.par[h - 1] + (h % 3 === 0 ? 1 : 0), [lp.player]: COURSE.par[h - 1] + (h % 2) } }); await ok('golf', 'p4', '/golf/score', { id: lg.id, tid: tb, hole: h, p: { [lp.p4]: COURSE.par[h - 1] + 1, [lp.p5]: COURSE.par[h - 1] - (h === 5 ? 1 : 0) } }); }
    await ok('golf', 'p4', '/golf/get', { id: lg.id });
    await ok('golf', 'p4', '/golf/confirm', { id: lg.id, tid: ta, from: 1, to: 3 }); await ok('golf', 'player', '/golf/dispute', { id: lg.id, tid: tb, hole: 5, note: 'We saw a par, not a birdie' }); setNow(REAL); reset(); });
  // an open group with a join request waiting for the commissioner
  await soft('openGroup', async () => { setNow(REAL - 3 * HOUR); const og = (await ok('groups', 'commish', '/groups/create', { name: 'RGV Open Picks', take: { kind: 'none', v: 0 }, join: { requests: true, open: true, max: 8, late: 'no' },
      contest: { cname: 'Thanksgiving week picks', sport: 'nfl', fmt: 'standings', start: next - HOUR, runs: 'w1', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 3, cap: 0, entry: 10, split: '100' } })).group; ids.openGroup = og.id;
    await ok('groups', 'director', '/groups/request', { id: og.id }); await ok('groups', 'p8', '/groups/request', { id: og.id }); setNow(REAL); reset(); });
  // a team Calcutta on the director's golf day, entered by hand, with buy back half
  await soft('teamCalcutta', async () => { setNow(REAL - 90 * 60e3); const tm = await ok('calcutta', 'director', '/calcutta/teams', { ev: 'golf-day', golf: { gameId: ids.tour } });
    const lots = (tm.teams || []).map((t) => ({ teams: [{ id: t.id, name: t.name }] })); if (lots.length < 2) throw new Error('golf day teams not offered: ' + JSON.stringify(tm).slice(0, 120));
    let tc = (await ok('calcutta', 'director', '/calcutta/create', { name: 'Member-Guest Team Calcutta', ev: 'golf-day', golf: { gameId: ids.tour }, lots, rows: [{ k: 'place', r: 1, n: 1, pct: 60 }, { k: 'place', r: 2, n: 1, pct: 30 }, { k: 'place', r: 3, n: 1, pct: 10 }].slice(0, Math.max(1, Math.min(3, lots.length))).map((r, i, a) => (a.length === 2 ? Object.assign({}, r, { pct: i ? 30 : 70 }) : r)), minBid: 10, inc: 5, timer: 20, buyBack: true, main: false, take: { kind: 'none', v: 0 }, order: 'listed', mode: 'manual' })).calc; ids.calcTeam = tc.id;
    const cp = {}; for (const r of ['commish', 'player', 'p4']) { await ok('calcutta', r, '/calcutta/join', { code: tc.code }); } tc = (await ok('calcutta', 'director', '/calcutta/get', { id: tc.id })).calc; tc.members.forEach((m) => { cp[m.name] = m.pid; });
    await ok('calcutta', 'director', '/calcutta/enter', { id: tc.id, lot: tc.lots[0].id, pid: cp[byRole('commish').name], amt: 120 }); await ok('calcutta', 'director', '/calcutta/enter', { id: tc.id, lot: tc.lots[1].id, pid: cp[byRole('p4').name], amt: 90 });
    const bb = await X.call('calcutta', 'director', '/calcutta/buyback', { id: tc.id, lot: tc.lots[0].id, who: 0 }); if (bb.s !== 200) ids.note_buyback = (bb.j && bb.j.error) || 'refused'; setNow(REAL); reset(); });
}
module.exports = { seed };
