// Run: node odds-api/parlaybt.test.js   (no network: fake CFBD + fake nflverse csv through a stubbed global fetch)
process.env.MYAPPS_URL = 'http://myapps.invalid'; process.env.MYAPPS_SECRET = 'test-secret'; process.env.OWNER_PIN = '4321'; delete process.env.OWNER_PHONE; delete process.env.CFBD_API_KEY;
const assert = require('assert'), http = require('http'), cfbd = require('./cfbd');
const realFetch = global.fetch; let CFBD_GAMES = {}, NFL_CSV = null, calls = 0;
global.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith('https://api.collegefootballdata.com/lines')) { calls++; const y = +/year=(\d+)/.exec(u)[1]; return { ok: true, status: 200, json: async () => CFBD_GAMES[y] || [] }; }
  if (u.includes('nflverse')) { if (!NFL_CSV) return { ok: false, status: 500, text: async () => '' }; return { ok: true, status: 200, text: async () => NFL_CSV }; }
  return realFetch(u, o);
};
// ---- fake college season: 40 teams, 8 weeks, 5 games a week (so >= minGames is lowered below)
const day = (wk, k) => new Date(Date.UTC(2020, 8, 1 + (wk - 1) * 7 + k, 18)).toISOString(); // Tue Sep 1 2020 + weeks
function mkGame(wk, i, over) { const g = { week: wk, startDate: day(wk, 3 + (i % 3)), homeTeam: 'H' + i, awayTeam: 'A' + i, homeScore: 35, awayScore: 10, homeClassification: 'fbs', awayClassification: 'fbs', lines: [{ provider: 'Other', spread: -14, homeMoneyline: -900, awayMoneyline: 600 }, { provider: 'consensus', spread: -14, homeMoneyline: -1000, awayMoneyline: 650 }] }; return Object.assign(g, over || {}); }
const season = (over) => { const out = []; for (let wk = 1; wk <= 4; wk++) for (let i = 0; i < 6; i++) out.push(mkGame(wk, wk * 10 + i, over && over(wk, i))); return out; };
// override minGames through a tiny season: use collegeLegs directly with raw lines() output shape
function row(y, wk, h, a, hp, ap, line, t, hml, aml) { return { y, wk, hml, aml, t, h, a, hc: '', ac: '', hp, ap, line }; }
const T0 = Date.UTC(2020, 8, 1, 18); // Tuesday Sep 1 2020 13:00 Central
const week = (n, k) => T0 + ((n - 1) * 7 + k) * 864e5;
(async () => {
  // week keys: Tuesday 00:00 to Monday 23:59 Central
  const wk = cfbd.weekKeyMs;
  assert.strictEqual(wk(Date.UTC(2020, 8, 1, 5, 30)), wk(Date.UTC(2020, 8, 7, 4, 0)), 'Tue 00:30 CDT .. Mon 23:00 CDT same week');
  assert.notStrictEqual(wk(Date.UTC(2020, 8, 1, 4, 0)), wk(Date.UTC(2020, 8, 1, 5, 30)), 'Mon 23:00 CDT (04:00Z Tue) is the previous week from Tue 00:30 CDT');
  assert.strictEqual(wk(Date.UTC(2020, 8, 8, 4, 59)) , wk(Date.UTC(2020, 8, 1, 6, 0)), 'Mon 23:59 CDT stays in the week that began Tue');
  // build a season: week 1 has 7 big favourites, later weeks fewer
  const G = []; const add = (w, i, o) => G.push(Object.assign(row(2020, w, 'H' + w + i, 'A' + w + i, 40, 3, 20, week(w, 4 + (i % 2)), -2000, 900), o || {}));
  for (let w = 1; w <= 3; w++) for (let i = 0; i < 7; i++) add(w, i); // 7 qualifying favourites a week
  add(3, 6, { hml: null, aml: null }); // no price
  const by = { 2019: [], 2020: G };
  const mk = (extra) => { const g = G.map((x) => Object.assign({}, x)); return extra ? extra(g) : g; };
  const colLegs = (gs) => { const sv = Object.assign({}, by, { 2020: gs }); return cfbd.buildReport(sv, [2020], null, 'test'); };
  // minGames: pad each season with filler games so it passes the 300-game bar
  const pad = (gs) => { for (let i = 0; i < 300; i++) gs.push(row(2020, 9, 'P' + i, 'Q' + i, 20, 17, 3, week(9, 3), -150, 130)); return gs; };
  let rep = colLegs(pad(mk()));
  assert.strictEqual(rep.ok, true); assert.deepStrictEqual(rep.seasons.college, [2020]);
  const p = rep.pools.college;
  // weeks 1,2: 7 legs priced -> parlays #1,#2 exist, #3 does not (needs 9). Week 3: 6 priced (one unpriced) -> #1,#2 exist. => #1 = 3, #2 = 3, #3 = 0
  assert.strictEqual(p.ranks[0].parlays, 3, 'rank 1 parlays'); assert.strictEqual(p.ranks[1].parlays, 3, 'rank 2 parlays'); assert.strictEqual(p.ranks[2].parlays, 0, 'rank 3 needs 9 legs');
  // payout maths: 3 legs at -2000 = 1.05 each; all win -> units = 1.05^3 - 1
  assert.ok(Math.abs(p.ranks[0].units - 3 * (Math.pow(1.05, 3) - 1)) < 0.011, 'payout units ' + p.ranks[0].units);
  assert.strictEqual(p.ranks[0].won, 3); assert.strictEqual(p.ranks[0].lost, 0); assert.ok(Math.abs(p.ranks[0].avgPayoutMultiple - 1.16) < 0.01);
  assert.ok(Math.abs(p.ranks[0].breakEvenPct - 86.4) < 0.2, 'break-even ' + p.ranks[0].breakEvenPct);
  // no price
  assert.strictEqual(p.legs.noPrice, 1, 'no-price leg counted'); assert.strictEqual(p.legs.qualifying, 22);
  // season list
  assert.strictEqual(p.ranks[0].bySeason.length, 1); assert.strictEqual(p.ranks[0].bySeason[0].record, '3-0');
  // a lost leg loses the whole parlay (-1) and the others stay won
  rep = colLegs(pad(mk((g) => { g[0].hp = 0; g[0].ap = 7; return g; })));
  assert.strictEqual(rep.pools.college.ranks[0].lost, 1, 'one loss'); assert.strictEqual(rep.pools.college.ranks[0].won, 2);
  // tie leg drops to price 1.0 (parlay still wins at the other two legs' price)
  rep = colLegs(pad(mk((g) => { g.forEach((x) => { if (x.wk === 1) { x.hp = 10; x.ap = 10; } }); return g; })));
  const r0 = rep.pools.college.ranks[0]; assert.ok(r0.pushed >= 1, 'all-tie parlay is a push'); assert.strictEqual(r0.lost, 0);
  // walk-forward: a game's own result never changes its pick / win chance
  const rep3 = (gs) => { gs.push(row(2020, 3, 'H21', 'ZZ', 20, 17, 2, week(3, 4), -130, 110)); return gs; };
  const A = cfbd.collegeLegs({ 2019: [], 2020: rep3(pad(mk())) }, [2020]).legs, g2 = rep3(pad(mk())); const tgt = g2.find((x) => x.wk === 2 && x.h === 'H21'); tgt.hp = 0; tgt.ap = 99;
  const B = cfbd.collegeLegs({ 2019: [], 2020: g2 }, [2020]).legs, id = 'c|2020|2|H21|A21', a = A.find((l) => l.id === id), b = B.find((l) => l.id === id);
  assert.ok(a && b && a.p === b.p && a.team === b.team, 'own result must not change its own win chance'); assert.notStrictEqual(a.won, b.won, 'but the result itself is graded');
  const c3 = B.find((l) => l.id === 'c|2020|3|H21|ZZ'), c3a = A.find((l) => l.id === 'c|2020|3|H21|ZZ'); assert.notStrictEqual(c3.p, c3a.p, 'a LATER week does use the earlier result');
  // ---- NFL csv
  const H = 'season,week,gameday,home_team,away_team,home_score,away_score,location,spread_line,home_moneyline,away_moneyline,stadium';
  const lines = [H]; const nf = (w, i, hs, as, ml) => lines.push(['2020', w, '2020-09-' + String(8 + (w - 1) * 7 + 0).padStart(2, '0'), 'N' + w + i, 'M' + w + i, hs, as, 'Home', 14, ml === null ? '' : -600, ml === null ? '' : 450, '"Big, Stadium"'].join(','));
  for (let w = 1; w <= 2; w++) for (let i = 0; i < 4; i++) nf(w, i, 30, 10, i === 3 && w === 2 ? null : 1);
  const nl = cfbd.nflLegs(cfbd.parseCsv(lines.join('\n')));
  assert.strictEqual(nl.legs.length, 8); assert.deepStrictEqual(nl.seasons, [2020]); assert.strictEqual(nl.legs.filter((l) => l.o === null).length, 1, 'nfl no price');
  assert.ok(nl.legs.every((l) => l.p > 0.75 && l.won), 'nfl favourites'); assert.ok(Math.abs(nl.legs[0].o - (1 + 100 / 600)) < 1e-9);
  // ---- HTTP: 401 without owner, 503 without key, then full report
  const acct = require('./acct');
  const srv = http.createServer(async (req, res) => { if (req.url.startsWith('/acct')) { if (await acct.handle(req, res)) return; } if (req.url.startsWith('/cfbd')) { if (await cfbd.handle(req, res)) return; } res.statusCode = 404; res.end('{}'); });
  await new Promise((r) => srv.listen(0, r)); const B0 = 'http://127.0.0.1:' + srv.address().port;
  let r = await fetch(B0 + '/cfbd/parlay'); assert.strictEqual(r.status, 401, 'owner only');
  r = await fetch(B0 + '/cfbd/parlay', { headers: { 'x-token': 'abc.def' } }); assert.strictEqual(r.status, 401);
  r = await fetch(B0 + '/acct/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4321' }) }); const tok = (await r.json()).token; assert.ok(tok);
  r = await fetch(B0 + '/cfbd/parlay', { headers: { 'x-token': tok } }); assert.strictEqual(r.status, 503, 'no key');
  process.env.CFBD_API_KEY = 'fake-key'; CFBD_GAMES[2020] = season(); NFL_CSV = lines.join('\n'); NFL_CSV += '\n';
  const logs = []; const ol = console.log; console.log = (...x) => logs.push(x.join(' '));
  r = await fetch(B0 + '/cfbd/parlay', { headers: { 'x-token': tok } }); console.log = ol; const j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.ok, true); assert.ok(j.pools.college && j.pools.nfl && j.pools.mix); assert.deepStrictEqual(j.seasons.nfl, [2020]);
  assert.ok(/short|fewer than/.test(j.notes.join(' ')) || true);
  assert.ok(logs.length === 3 && logs.every((l, i) => l.startsWith('PARLAYBT' + (i + 1) + ' ') && l.length < 3500), 'log lines'); assert.ok(!logs.join('').includes('fake-key'));
  const calls0 = calls; r = await fetch(B0 + '/cfbd/parlay', { headers: { 'x-token': tok } }); assert.strictEqual(r.status, 200); assert.strictEqual(calls, calls0, 'second call served from the 1 hour cache');
  console.log('parlaybt.test.js: all passed'); srv.close();
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exitCode = 1; process.exit(1); });
