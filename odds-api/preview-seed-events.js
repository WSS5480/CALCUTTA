// TEST PREVIEW ONLY: a pickleball round robin (singles, six players, top two to a final) played last Friday: every pool match confirmed, the final waiting for its score.
async function seed(C) {
  const { X, setNow, last, HOUR, DAY, reset, ids, REAL } = C, { ok, call, byRole } = X, fri = last - 2 * DAY + 6 * HOUR; // Friday evening before last Sunday
  setNow(fri - 3 * DAY);
  const nm = (r) => byRole(r).name, crew = ['player', 'p4', 'p5', 'p6', 'p7'];
  let ev = (await ok('events', 'commish', '/events/create', { title: 'Friday Night Pickleball', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: fri, to: 11, winBy: 2, bestOf: 1, scoring: 'rally', seeding: 'random', courts: 2, pools: 1, playoff: 2, entry: 10, split: '100', take: { kind: 'none', v: 0 }, myName: nm('commish'), playIn: true })).event;
  ids.event = ev.id; ids.eventCode = ev.code;
  for (const r of crew) await ok('events', r, '/events/join', { code: ev.code, as: 'player', myName: nm(r) });
  await ok('events', 'director', '/events/join', { code: ev.code, as: 'spectator', myName: nm('director') });
  setNow(fri + 60e3); reset(); ev = (await ok('events', 'commish', '/events/get', { id: ev.id })).event;
  if (!ev.drawn) ev = (await ok('events', 'commish', '/events/draw', { id: ev.id })).event;
  const roleOf = {}; ['commish'].concat(crew).forEach((r) => { const e = ev.entrants.find((x) => x.name === nm(r)); if (e) roleOf[e.eid] = r; });
  const skill = { commish: 4, player: 6, p4: 3, p5: 5, p6: 1, p7: 2 }; let n = 0;
  const pool = ev.matches.filter((m) => m.st === 'pool' && m.a && m.b);
  for (const m of pool) { setNow(fri + (++n) * 14 * 60e3); const ra = roleOf[m.a], rb = roleOf[m.b], aw = skill[ra] > skill[rb], lose = 3 + ((n * 5) % 7), games = [aw ? [11, lose] : [lose, 11]];
    const cur = (await ok('events', 'commish', '/events/get', { id: ev.id })).event.matches.find((x) => x.id === m.id);
    await ok('events', ra, '/events/score', { id: ev.id, m: m.id, games, v: cur.v, op: 'seed' + n }); await ok('events', rb, '/events/confirm', { id: ev.id, m: m.id }); }
  setNow(REAL); reset(); ev = (await ok('events', 'player', '/events/get', { id: ev.id })).event;
  ids.eventState = ev.matches.filter((m) => m.state === 'confirmed').length + ' confirmed, ' + ev.matches.filter((m) => m.state === 'ready').length + ' ready';
}
module.exports = { seed };
