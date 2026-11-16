// TEST PREVIEW ONLY: a demo group with a main-pot picks contest (graded bets from last Sunday, frozen bets for next Sunday) and an opt-in side pot.
const bet = (t, n, gid, away, home, day, side, type, line, stake, odds) => Object.assign({ id: 'b' + (t + n), t: t + n, gid, lg: 'nfl', away, home, day, side, type, stake, odds }, line == null ? {} : { line });
async function seed(C) {
  const { X, setNow, last, next, HOUR, DAY, chiDay, reset, row, ids } = C, { ok } = X;
  const d1 = chiDay(last), d2 = chiDay(next), made = last - 6 * DAY;
  setNow(made);
  let g = (await ok('groups', 'commish', '/groups/create', { name: 'Valley Sharps', take: { kind: 'pct', v: 10 }, join: { requests: true, open: false, max: 8, late: 'no' },
    contest: { cname: 'NFL picks, rest of season', sport: 'nfl', fmt: 'standings', start: last - 2 * DAY, runs: 'season', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 3, cap: 0, entry: 25, split: '60/30/10' } })).group;
  ids.group = g.id; ids.groupCode = g.code; const main = g.contests[0].cid;
  const members = ['player', 'p4', 'p5', 'p6', 'p7'];
  for (const r of members) await ok('groups', r, '/groups/join', { code: g.code });
  g = (await ok('groups', 'commish', '/groups/contest/add', { id: g.id, contest: { pot: 'side', cname: 'Sunday night side pot', sport: 'nfl', fmt: 'standings', start: next - HOUR, runs: 'weekend', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 1, metric: 'win', minBets: 0, minPaid: 1, cap: 0, entry: 10, split: '100', take: { kind: 'none', v: 0 } } })).group;
  const side = g.contests.find((c) => c.cid !== main); ids.sideCid = side && side.cid; ids.mainCid = main;
  if (side) for (const r of ['commish', 'player', 'p4', 'p6']) await ok('groups', r, '/groups/sidepot', { id: g.id, cid: side.cid, on: true });
  const pidOf = {}; g.members.forEach((m) => { pidOf[m.name] = m.pid; });
  for (const r of ['player', 'p4', 'p5', 'p6']) { const u = X.byRole(r); if (pidOf[u.name]) await ok('groups', 'commish', '/groups/paid', { id: g.id, pid: pidOf[u.name], paid: true }); }
  // last Sunday's bets, placed the day before; everyone's phone synced before kickoff
  const t0 = last - 20 * HOUR, B = (n, gid, side, type, line, stake, odds) => { const G = C.GAMES.find((x) => x.id === gid); return bet(t0, n, gid, G.away.abbr, G.home.abbr, chiDay(G.start), side, type, line, stake, odds); };
  const P = {
    commish: [B(1, 'pv101', 'NYG', 'sp', -3, 50, -110), B(2, 'pv103', 'BUF', 'ml', null, 40, -135), B(3, 'pv105', 'Under', 'ou', 41.5, 25, -108)],
    player: [B(1, 'pv101', 'DAL', 'sp', 3, 50, -110), B(2, 'pv102', 'HOU', 'ml', null, 60, -150), B(3, 'pv104', 'SF', 'sp', -2.5, 40, -105), B(4, 'pv105', 'CHI', 'ml', null, 30, 120)],
    p4: [B(1, 'pv102', 'TEN', 'sp', 3.5, 30, -110), B(2, 'pv103', 'KC', 'ml', null, 50, 115), B(3, 'pv104', 'Over', 'ou', 45.5, 20, -110)],
    p5: [B(1, 'pv101', 'NYG', 'ml', null, 80, -160), B(2, 'pv103', 'BUF', 'sp', -2.5, 55, -110), B(3, 'pv105', 'CHI', 'sp', -3, 45, -112), B(4, 'pv104', 'SF', 'ml', null, 35, -140)],
    p6: [B(1, 'pv102', 'HOU', 'sp', -3.5, 44, -110), B(2, 'pv105', 'GB', 'ml', null, 25, 135)],
    p7: [B(1, 'pv103', 'Over', 'ou', 49.5, 33, -110), B(2, 'pv104', 'LAR', 'ml', null, 20, 118), B(3, 'pv101', 'NYG', 'sp', -3, 22, -110)],
  };
  // G16: every group bet goes to the server the moment it is added (/groups/bet/add) and is locked there
  setNow(last - 3 * HOUR); reset();
  for (const r of Object.keys(P)) for (const b of P[r]) { const x = Object.assign({}, b); delete x.t; await ok('groups', r, '/groups/bet/add', { bet: x }); }
  reset(); await ok('groups', 'commish', '/groups/standings', { id: g.id, cid: main }); await C.mods.groups.tick().catch(() => {});
  // after the games: the server grades them from the final scores
  setNow(last + 14 * HOUR); reset(); await ok('groups', 'commish', '/groups/standings', { id: g.id, cid: main });
  // the phones' own copy of those bets is settled too (My Bets and the personal dashboard show the same results the server graded)
  const fin = (b) => { const G = C.GAMES.find((x) => x.id === b.gid), home = b.side === G.home.abbr, my = home ? G.hs : G.as, their = home ? G.as : G.hs; let r;
    if (b.type === 'ou') { const tot = G.hs + G.as; r = tot === b.line ? 'push' : (/^O/i.test(b.side) ? tot > b.line : tot < b.line) ? 'won' : 'lost'; } else { const m = my - their + (b.type === 'sp' ? b.line : 0); r = m === 0 ? 'push' : m > 0 ? 'won' : 'lost'; }
    b.fin = r; b.finPL = r === 'won' ? Math.round(b.stake * (b.odds > 0 ? b.odds / 100 : 100 / -b.odds) * 100) / 100 : r === 'lost' ? -b.stake : 0; };
  for (const r of Object.keys(P)) await row(r, (d) => { (d.bets || []).forEach((b) => { if (P[r].some((x) => x.id === b.id)) fin(b); }); });
  // next Sunday's bets: already on the server, hidden from the others until kickoff
  const t1 = C.REAL - 5 * HOUR, N = (n, gid, side, type, line, stake, odds) => { const G = C.GAMES.find((x) => x.id === gid); return bet(t1, n, gid, G.away.abbr, G.home.abbr, chiDay(G.start), side, type, line, stake, odds); };
  const Q = { commish: [N(1, 'pv201', 'PHI', 'sp', -2.5, 50, -110), N(2, 'pv203', 'KC', 'ml', null, 40, -125)], player: [N(1, 'pv201', 'DAL', 'ml', null, 30, 125), N(2, 'pv202', 'Under', 'ou', 39.5, 25, -110), N(3, 'pv203', 'HOU', 'sp', 3, 20, -110)], p4: [N(1, 'pv202', 'BAL', 'sp', -1.5, 35, -108)], p5: [N(1, 'pv203', 'KC', 'sp', -3, 60, -110), N(2, 'pv201', 'PHI', 'ml', null, 45, -140)], p6: [N(1, 'pv203', 'HOU', 'ml', null, 15, 140)] };
  setNow(C.REAL - 4 * HOUR); reset();
  for (const r of Object.keys(Q)) for (const b of Q[r]) { const x = Object.assign({}, b); delete x.t; await ok('groups', r, '/groups/bet/add', { bet: x }); }
  reset(); await ok('groups', 'commish', '/groups/standings', { id: g.id, cid: main }); if (side) await ok('groups', 'commish', '/groups/standings', { id: g.id, cid: side.cid }).catch(() => {});
  setNow(C.REAL); reset();
  const st = await ok('groups', 'player', '/groups/standings', { id: g.id, cid: main, scope: 'season' });
  if (!st.rows || !st.rows.some((r) => r.t && (r.t.w || r.t.l))) throw new Error('demo bets were not graded: ' + JSON.stringify(st.rows && st.rows[0]).slice(0, 200));
  // an Enterprise request so the owner list has something (director asks for more than 8)
  await ok('groups', 'director', '/groups/ent/contact', { name: 'Pro Shop Pat', org: 'Tierra Verde Golf Club (demo)', reach: 'pat@example.com', people: 72, what: 'Member-guest in March, 18 teams.' });
}
module.exports = { seed };
