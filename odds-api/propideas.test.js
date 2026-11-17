// Run: node odds-api/propideas.test.js   (no network: ESPN, Supabase, the clock and the pauses are replaced by in-memory fakes)
// Label arrays are the real ones from ESPN's summary endpoint (read Nov 16 2026). Ja'Marr Chase's and Quentin Johnston's lines are their real 2026 logs.
const assert = require('assert'), http = require('http'), P = require('./propideas'), C = P.core();
const LAB = { passing: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'QBR', 'RTG'], rushing: ['CAR', 'YDS', 'AVG', 'TD', 'LONG'], receiving: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'] };
const line = (cat, o, labels) => (labels || LAB[cat]).map((l) => (l in o ? String(o[l]) : l === 'C/ATT' ? '20/30' : l === 'SACKS' ? '2-11' : '1'));
// box({ TEAM: [[id, name, { passing: {YDS, TD}, rushing: {YDS}, receiving: {REC, YDS} }]] }) -> an ESPN summary payload
const box = (teams, labels) => ({ boxscore: { players: Object.keys(teams).map((t) => ({ team: { abbreviation: t }, statistics: ['passing', 'rushing', 'receiving', 'fumbles'].map((cat) => ({ name: cat, labels: cat === 'fumbles' ? ['FUM', 'LOST', 'REC'] : (labels && labels[cat]) || LAB[cat], athletes: teams[t].filter((a) => a[2][cat]).map((a) => ({ athlete: { id: a[0], displayName: a[1] }, stats: cat === 'fumbles' ? ['1', '1', '99'] : line(cat, a[2][cat], labels && labels[cat]) })) })) })) } });
const sbEv = (id, w, date, state, h, a) => ({ id, date, week: { number: w }, status: { type: { state } }, competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: h } }, { homeAway: 'away', team: { abbreviation: a } }] }] });
const T = (d) => Date.parse(d);

// 1. columns are found by label, not position; fumbles "REC" is not a reception; WSH becomes WAS
{
  const odd = { passing: ['TD', 'RTG', 'YDS', 'C/ATT'], rushing: ['LONG', 'TD', 'YDS', 'CAR'], receiving: ['TGTS', 'TD', 'YDS', 'REC'] };
  for (const labels of [null, odd]) {
    const rows = C.parseBox(box({ WSH: [['1', 'Q B', { passing: { YDS: 207, TD: 2 }, rushing: { YDS: 13 } }], ['2', 'W R', { receiving: { REC: 9, YDS: 74 }, fumbles: {} }], ['3', 'R B', { rushing: { YDS: 59 }, receiving: { REC: 0, YDS: 0 } }]] }, labels));
    assert.deepStrictEqual(rows.find((r) => r[0] === '1'), ['1', 'Q B', 'WAS', '', 207, 2, 13, null, null], 'QB line');
    assert.deepStrictEqual(rows.find((r) => r[0] === '2'), ['2', 'W R', 'WAS', '', null, null, null, 74, 9], 'WR line, fumbles ignored');
    assert.deepStrictEqual(rows.find((r) => r[0] === '3'), ['3', 'R B', 'WAS', '', null, null, 59, 0, 0], 'a 0-catch line is a line (0), not missing');
  }
  assert.deepStrictEqual(C.parseBox({}), [], 'empty summary');
  assert.deepStrictEqual(C.parseBox({ boxscore: { players: [{ team: { abbreviation: 'GB' }, statistics: [{ name: 'receiving', labels: ['REC', 'YDS'], athletes: [{ athlete: { id: '9', displayName: 'X' }, stats: ['--', '--'] }] }] }] } })[0].slice(7), [0, 0], 'dashes read as 0');
}

// Helpers for the rule tests: a season from per-player value lists. games = [[week, home, away]], lines = { playerId: { team, stat-values by week } }
const mk = (games, players) => C.build(games.map(([w, h, a], i) => ({ id: 'e' + w + h, w, t: T('2026-09-13T17:00Z') + w * 7 * 864e5 + i, h, a, p: players.filter((p) => (p.team === h || p.team === a) && p.by[w] !== undefined).map((p) => { const v = p.by[w], r = [p.id, p.name, p.team, '', null, null, null, null, null]; if (p.stat === 'passYds') { r[4] = v; r[5] = 1; } else if (p.stat === 'rushYds') r[6] = v; else if (p.stat === 'recYds') { r[7] = v; r[8] = 4; } else { r[8] = v; r[7] = 30; } return r; }) })));
const byWeek = (weeks, vals) => Object.fromEntries(weeks.map((w, i) => [w, vals[i]]));

// 2. the hot rule: last 3 against the season average BEFORE those 3 (real logs)
{
  const chase = { id: '4362628', name: "Ja'Marr Chase", team: 'CIN', stat: 'recYds', by: byWeek([1, 2, 3, 4, 5, 7, 8, 9, 10], [12, 75, 98, 27, 77, 62, 141, 155, 231]) };
  const games = [[1, 'CIN', 'TB'], [2, 'HOU', 'CIN'], [3, 'PIT', 'CIN'], [4, 'CIN', 'JAX'], [5, 'MIA', 'CIN'], [7, 'BAL', 'CIN'], [8, 'CIN', 'TEN'], [9, 'ATL', 'CIN'], [10, 'CIN', 'PIT']];
  const B = mk(games, [chase]), up = [{ id: '401873078', w: 11, t: T('2026-11-24T01:15Z'), h: 'WAS', a: 'CIN' }];
  const I = C.ideas(B, up); assert.strictEqual(I.length, 1); const o = I[0];
  assert.deepStrictEqual(o.last3, [141, 155, 231]); assert.strictEqual(o.lastAvg, 175.7); assert.strictEqual(o.before, 58.5, 'before = the 6 games before the last 3, NOT the season average (97.6)'); assert.strictEqual(o.beforeN, 6); assert.strictEqual(o.seasonAvg, 97.6); assert.strictEqual(o.pct, 200);
  assert.strictEqual(o.opp, 'WAS'); assert.strictEqual(o.home, false); assert.strictEqual(o.gid, '401873078'); assert.strictEqual(o.kickoff, up[0].t); assert.strictEqual(o.log.length, 9); assert.deepStrictEqual(o.log.filter((x) => x.last3).map((x) => x.w), [8, 9, 10]); assert.deepStrictEqual(o.log[0], { w: 1, opp: 'TB', home: true, v: 12, line: true, last3: false });
  // against the whole-season average he would be +80%, against the right base +200%: make sure a case that only passes on the right base passes
  const e = C.evalAt(B.players['4362628'].g, 'recYds', B.teamGames.CIN[8]); assert.ok(Math.abs(e.pct - 2.0028) < 0.001);
  // thresholds: +20% and 12 yards
  const flat = (vals) => { const b = mk(games, [{ id: 'x', name: 'X', team: 'CIN', stat: 'rushYds', by: byWeek([1, 2, 3, 4, 5, 7, 8, 9, 10], vals) }]); return C.evalAt(b.players.x.g, 'rushYds', b.teamGames.CIN[8]); };
  assert.strictEqual(flat([60, 60, 60, 60, 60, 60, 70, 70, 70]).hot, false, '+17% is not hot');
  assert.strictEqual(flat([60, 60, 60, 60, 60, 60, 72, 72, 72]).hot, true, '+20% and 12 yards is hot');
  assert.strictEqual(flat([50, 50, 50, 50, 50, 50, 61, 61, 61]).hot, false, '+22% but only 11 yards is not hot');
  assert.strictEqual(flat([10, 10, 10, 10, 10, 10, 60, 60, 60]), null, 'season average under the 35-yard floor: not a regular');
  assert.strictEqual(C.ideas(mk(games.slice(0, 3), [{ ...chase, by: byWeek([1, 2, 3], [10, 90, 200]) }]), [{ id: 'n', w: 4, t: 9e15, h: 'CIN', a: 'JAX' }]).length, 0, 'fewer than 4 games: no idea');
  // Quentin Johnston, real log: 7 games with two weeks missed earlier, played the team's latest game
  const qj = { id: '4429025', name: 'Quentin Johnston', team: 'LAC', stat: 'recYds', by: byWeek([1, 2, 3, 4, 6, 8, 9], [17, 7, 40, 44, 57, 37, 58]) };
  const lg = [[1, 'LAC', 'ARI'], [2, 'LAC', 'LV'], [3, 'BUF', 'LAC'], [4, 'SEA', 'LAC'], [5, 'LAC', 'DEN'], [6, 'KC', 'LAC'], [7, 'LAC', 'NYG'], [8, 'LAR', 'LAC'], [9, 'LAC', 'HOU']];
  const q = C.ideas(mk(lg, [qj]), [{ id: '401873065', w: 10, t: T('2026-11-17T01:15Z'), h: 'BAL', a: 'LAC' }])[0];
  assert.strictEqual(q.before, 27); assert.strictEqual(q.lastAvg, 50.7); assert.strictEqual(q.pct, 88); assert.strictEqual(q.games, 7);
  // 4. the same player, but he missed his team's most recent game: left out
  assert.strictEqual(C.ideas(mk(lg.concat([[10, 'LAC', 'TEN']]), [qj]), [{ id: 'n', w: 11, t: 9e15, h: 'BAL', a: 'LAC' }]).length, 0, 'missed the last game');
  // a team with no game left this week has no ideas
  assert.strictEqual(C.ideas(mk(lg, [qj]), [{ id: 'n', w: 10, t: 9e15, h: 'BAL', a: 'DEN' }]).length, 0);
}

// 3. caps: 8 in all, 3 per stat, 2 per team, 1 per player, highest percentage first
{
  const c = (id, team, stat, pct) => ({ id, team, stat, pct, gap: 20 });
  const L = [c('a', 'KC', 'rushYds', 0.9), c('b', 'KC', 'recYds', 0.8), c('c', 'KC', 'rec', 0.7), c('d', 'SF', 'rushYds', 0.6), c('e', 'GB', 'rushYds', 0.5), c('f', 'NE', 'rushYds', 0.45), c('b', 'KC', 'rec', 0.85), c('g', 'NE', 'recYds', 0.4), c('h', 'SF', 'recYds', 0.35), c('i', 'DAL', 'recYds', 0.3), c('j', 'DAL', 'rec', 0.29), c('k', 'DAL', 'rec', 0.28), c('l', 'MIA', 'passYds', 0.27), c('m', 'NYJ', 'passYds', 0.26), c('n', 'LV', 'passYds', 0.25), c('o', 'TB', 'passYds', 0.24)];
  const out = C.cap(L), ids = out.map((x) => x.id + ':' + x.stat);
  assert.deepStrictEqual(ids, ['a:rushYds', 'b:rec', 'd:rushYds', 'e:rushYds', 'g:recYds', 'h:recYds', 'i:recYds', 'j:rec'], 'order and caps');
  assert.ok(!ids.includes('c:rec'), 'third KC player dropped (2 per team)'); assert.ok(!ids.includes('f:rushYds'), 'fourth rushing idea dropped (3 per stat)'); assert.ok(!ids.includes('b:recYds'), 'one idea per player (his best)'); assert.strictEqual(out.length, 8);
}

// 6. carry-over (the honesty number), counted by hand
{
  // Team AAA plays weeks 1-7. Player h: 40,40,40,40 then hot going into week 8? Keep it small:
  // h (rushing): wk1-6 = 40,40,40,80,80,80 -> going into wk7 he is hot (80 vs 40, +100%), season avg to then 60. wk7 = 70 -> above. wk8 = 50: going in, last3 80,80,70 (76.7) vs 40,40,40,80 (50): hot (+53%), season avg 61.4 -> 50 is NOT above.
  // b (rushing): 50 every week -> a regular, never hot. Going into wk5, wk6, wk7, wk8 he is in base; his game is never ABOVE his average (50 is not > 50).
  // u (rushing): 5 a game -> under the floor, never counted.
  const games = [1, 2, 3, 4, 5, 6, 7, 8].map((w) => [w, 'AAA', 'BBB']);
  const B = mk(games, [{ id: 'h', name: 'H', team: 'AAA', stat: 'rushYds', by: byWeek([1, 2, 3, 4, 5, 6, 7, 8], [40, 40, 40, 80, 80, 80, 70, 50]) }, { id: 'b', name: 'B', team: 'AAA', stat: 'rushYds', by: byWeek([1, 2, 3, 4, 5, 6, 7, 8], [50, 50, 50, 50, 50, 50, 50, 50]) }, { id: 'u', name: 'U', team: 'AAA', stat: 'rushYds', by: byWeek([1, 2, 3, 4, 5, 6, 7, 8], [5, 5, 5, 5, 5, 5, 5, 5]) }]);
  const k = C.carry(B);
  // h going into wk5: prior 40,40,40,80 -> last3 40,40,80 (53.3) vs before 40: +33%, gap 13.3 -> hot; avg 50; wk5 = 80 above.
  // h going into wk6: prior 40,40,40,80,80 -> last3 66.7 vs 40: hot; avg 56; wk6 = 80 above.
  // h going into wk7: hot; avg 60; 70 above.   h going into wk8: hot; avg 61.4; 50 not above.
  assert.deepStrictEqual(k.hot, { n: 4, above: 3, pct: 75 }, 'hot group');
  assert.deepStrictEqual(k.base, { n: 8, above: 3, pct: 37.5 }, 'base = h (4) + b (4), b never above its own flat average');
  assert.deepStrictEqual(k.shown, { n: 4, above: 3, pct: 75 }); assert.strictEqual(k.small, true); assert.ok(/Small sample/.test(k.note), 'under 30 is said in the payload');
  assert.strictEqual(C.carry(C.build([])).hot.pct, null, 'no data: no percentage');
}

// ---- The service: building in the background, mid-week filtering, roll to next week, fetch-once, persistence ----
const TEAMS = ['KC', 'DEN', 'GB', 'MIN', 'DAL', 'PHI', 'SF', 'SEA'];
const PAIRS = [['KC', 'DEN'], ['GB', 'MIN'], ['DAL', 'PHI'], ['SF', 'SEA']];
const KICK = (w, i) => T('2026-09-13T17:00Z') + (w - 1) * 7 * 864e5 + i * 3 * 36e5;
let NOW, CURWK, calls, down, failEv, db;
const stateOf = (w, i) => (KICK(w, i) + 3.5 * 36e5 <= NOW ? 'post' : KICK(w, i) <= NOW ? 'in' : 'pre');
const sbOf = (w) => ({ week: { number: w }, season: { type: 2, year: 2026 }, events: PAIRS.map(([h, a], i) => sbEv('g' + w + i, w, new Date(KICK(w, i)).toISOString(), stateOf(w, i), w % 2 ? h : a, w % 2 ? a : h)) });
// every team has a runner: 50 a game in weeks 1-4, then 50 + 10 * team index from week 5 (so higher-index teams run hotter)
const sumOf = (id) => { const w = +id.slice(1, -1), i = +id.slice(-1), [h, a] = PAIRS[i]; const run = (t) => [['r' + t, 'Runner ' + t, { rushing: { YDS: w <= 4 ? 50 : 50 + 10 * TEAMS.indexOf(t) }, receiving: { REC: 1, YDS: 5 } }]]; return box({ [h]: run(h), [a]: run(a) }); };
P._deps.now = () => NOW; P._deps.sleep = async () => {}; P._deps.hasDb = () => !!db;
P._deps.S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; } };
P._deps.fetch = async (url) => {
  if (down) throw new Error('down'); const u = String(url), ev = (u.match(/summary\?event=(\w+)/) || [])[1], wk = (u.match(/[?&]week=(\d+)/) || [])[1];
  if (ev) { calls.sum[ev] = (calls.sum[ev] || 0) + 1; if (failEv === ev) return { ok: false, status: 500 }; return { ok: true, json: async () => sumOf(ev) }; }
  calls.sb++; return { ok: true, json: async () => sbOf(wk ? +wk : CURWK) };
};
const srv = http.createServer(async (req, res) => { if (!(await P.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
srv.listen(0, async () => {
  const port = srv.address().port, get = async () => { const r = await fetch('http://127.0.0.1:' + port + '/propideas'); return { s: r.status, cors: r.headers.get('access-control-allow-origin'), j: await r.json() }; };
  const start = () => { P._reset(); calls = { sb: 0, sum: {} }; down = false; failEv = null; }, nSum = () => Object.values(calls.sum).reduce((a, b) => a + b, 0);
  try {
    // Wednesday of week 7: weeks 1-6 final, nothing of week 7 started
    db = null; start(); CURWK = 7; NOW = KICK(7, 0) - 4 * 864e5;
    let r = await get(); assert.strictEqual(r.s, 200); assert.strictEqual(r.cors, '*'); assert.strictEqual(r.j.building, true, 'first answer does not wait for ESPN'); assert.deepStrictEqual(r.j.ideas, []); assert.strictEqual(r.j.carry, null); assert.strictEqual(r.j.unavailable, false);
    await P._wait(); r = await get();
    assert.strictEqual(r.j.building, false); assert.strictEqual(r.j.season, 2026); assert.strictEqual(r.j.week, 7); assert.deepStrictEqual(r.j.progress, { done: 24, total: 24 }); assert.strictEqual(r.j.persist, 'memory'); assert.ok(r.j.rule.length > 50); assert.ok(/No sportsbook line/.test(r.j.ideasOnly));
    assert.strictEqual(nSum(), 24, '24 finished games, 24 summary calls'); assert.ok(Object.values(calls.sum).every((n) => n === 1));
    // hot runners: before 50, last 3 = 50 + 10i (weeks 4-6 are 50, hot, hot -> avg 50 + 20i/3): +20% needs i >= 2 (63.3 = +27%, gap 13.3). 3 per stat cap -> the 3 hottest: SEA (7), SF (6), PHI (5)
    assert.deepStrictEqual(r.j.ideas.map((o) => o.team), ['SEA', 'SF', 'PHI'], 'ranked, 3 per stat'); assert.strictEqual(r.j.ideas[0].stat, 'rushYds'); assert.deepStrictEqual(r.j.ideas[0].last3, [50, 120, 120]); assert.strictEqual(r.j.ideas[0].before, 50); assert.strictEqual(r.j.ideas[0].pct, 93);
    assert.strictEqual(r.j.ideas[0].gid, 'g73'); assert.strictEqual(r.j.ideas[0].kickoff, KICK(7, 3)); assert.ok(r.j.carry && r.j.carry.base.n > 0 && typeof r.j.carry.note === 'string');
    // 7. a second phone, and a rebuild after the 15-minute TTL: no game is fetched twice
    const sb0 = calls.sb; r = await get(); await P._wait(); assert.strictEqual(calls.sb, sb0, 'inside the TTL: no ESPN call at all');
    NOW += 16 * 6e4; r = await get(); await P._wait(); assert.strictEqual(nSum(), 24, 'after the TTL the schedule is re-read, finished games are not'); assert.strictEqual(calls.sb, sb0 + 1, 'only the current week is re-read (finished weeks are kept)');
    // 5. mid-week: game 0 final and game 1 under way, games 2 and 3 still to come -> only teams of games 2 and 3
    NOW = KICK(7, 1) + 36e5; r = await get(); await P._wait(); r = await get();
    assert.strictEqual(nSum(), 25, 'the one newly finished game is read'); assert.strictEqual(r.j.week, 7); assert.strictEqual(r.j.gamesLeft, 2);
    assert.deepStrictEqual(r.j.ideas.map((o) => o.team), ['SEA', 'SF', 'PHI'], 'DAL/PHI and SF/SEA have not kicked off');
    // kickoff passes between two schedule reads: the game drops out at once, by the clock
    NOW = KICK(7, 2) + 6e4; r = await get(); assert.deepStrictEqual(r.j.ideas.map((o) => o.team), ['SEA', 'SF'], 'PHI has kicked off (answered from the old schedule read, by the clock)'); await P._wait();
    // every game of the week has started -> next week's games
    NOW = KICK(7, 3) + 20 * 6e4; r = await get(); await P._wait(); r = await get();
    assert.strictEqual(r.j.week, 8, 'rolled to the next week'); assert.strictEqual(r.j.currentWeek, 7); assert.ok(r.j.ideas.length > 0 && r.j.ideas.every((o) => o.week === 8));
    assert.deepStrictEqual(r.j.ideas.map((o) => o.team), ['MIN', 'GB'], 'teams whose game is under way are left out until it is final; MIN and GB use their week-7 game');
    assert.deepStrictEqual(r.j.ideas[0].last3, [80, 80, 80]);
  } catch (e) { console.error('FAILED:', e.stack); process.exitCode = 1; srv.close(); return; }
  try {
    // ESPN down on a cold start: a clean "unavailable" answer, then it recovers
    db = null; start(); CURWK = 7; NOW = KICK(7, 0) - 4 * 864e5; down = true;
    let r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.unavailable, true); assert.strictEqual(r.j.building, true); assert.deepStrictEqual(r.j.ideas, []);
    down = false; r = await get(); await P._wait(); assert.strictEqual(nSum(), 0, 'no retry storm: waits 2 minutes after a failure');
    NOW += 3 * 6e4; r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.j.unavailable, false); assert.strictEqual(r.j.ideas.length, 3);
    // ESPN goes down later: the list already built is still served
    down = true; NOW += 16 * 6e4; r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.j.ideas.length, 3, 'stale list kept'); assert.strictEqual(r.j.unavailable, false); down = false;
    // one game's summary keeps failing: built without it after two tries, and it says so
    start(); NOW = KICK(7, 0) - 4 * 864e5; failEv = 'g32';
    r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.j.building, true, 'first failure: still building');
    NOW += 3 * 6e4; r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.j.building, false); assert.strictEqual(r.j.missing, 1); assert.ok(/left out/.test(r.j.note)); assert.strictEqual(calls.sum.g32, 2);
    assert.ok(Object.keys(calls.sum).filter((k) => k !== 'g32').every((k) => calls.sum[k] === 1), 'the good games were still fetched once');
    // persistence: a restart reads the saved weeks and fetches no finished game again
    db = {}; start(); NOW = KICK(7, 0) - 4 * 864e5;
    r = await get(); await P._wait(); r = await get(); assert.strictEqual(r.j.persist, 'db'); assert.strictEqual(nSum(), 24); assert.deepStrictEqual(Object.keys(db).sort(), [1, 2, 3, 4, 5, 6, 7].map((w) => 'lock:pi26w' + w).filter((id) => id !== 'lock:pi26w7'), 'one row per finished week');
    assert.strictEqual(db['lock:pi26w3'].data.done, true); assert.strictEqual(Object.keys(db['lock:pi26w3'].data.ev).length, 4);
    const before = r.j.ideas; start(); r = await get(); await P._wait(); r = await get();
    assert.strictEqual(nSum(), 0, 'restart: no summary refetched'); assert.strictEqual(calls.sb, 1, 'restart: only the current scoreboard is read'); assert.deepStrictEqual(r.j.ideas, before, 'same list after a restart');
    // other methods and paths
    const pr = await fetch('http://127.0.0.1:' + port + '/propideas', { method: 'POST' }); assert.strictEqual(pr.status, 405);
    console.log('propideas.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.stack); process.exitCode = 1; }
  srv.close();
});
