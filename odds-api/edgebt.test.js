// Run: node odds-api/edgebt.test.js   (no network: fake CFBD through a stubbed global fetch)
process.env.MYAPPS_URL = 'http://myapps.invalid'; process.env.MYAPPS_SECRET = 'test-secret'; process.env.OWNER_PIN = '4321'; delete process.env.OWNER_PHONE; delete process.env.CFBD_API_KEY; delete process.env.EDGEBT_RUN; delete process.env.PARLAYBT_RUN;
const assert = require('assert'), http = require('http'), cfbd = require('./cfbd');
const realFetch = global.fetch; let RAW = {}, calls = 0;
global.fetch = async (u, o) => { u = String(u); if (u.startsWith('https://api.collegefootballdata.com/lines')) { calls++; const y = +/year=(\d+)/.exec(u)[1]; return { ok: true, status: 200, json: async () => RAW[y] || [] }; } return realFetch(u, o); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.011, (m || '') + ' got ' + a + ' want ' + b);
const P = 100 / 110;
let ID = 0;
// processed row (the shape lines() returns); line > 0 = home favored
function row(y, wk, o) { return Object.assign({ y, wk, hml: null, aml: null, tot: null, neutral: null, t: Date.UTC(y, 8, 3 + (wk - 1) * 7, 18), h: 'H' + (++ID), a: 'A' + ID, hc: '', ac: '', hp: 20, ap: 10, line: 0 }, o || {}); }
const rep = (g19, g20) => cfbd.edgeReport({ 2018: [], 2019: g19, 2020: g20 }, [2019, 2020], { minGames: 0 });
const find = (r, id) => { for (const f of Object.values(r.families)) for (const x of f) if (x.id === id) return x; throw new Error('no angle ' + id); };
(async () => {
  // ---- lines(): total / neutral / conferences kept (raw CFBD shape)
  process.env.CFBD_API_KEY = 'fake-key';
  const rawG = (o) => Object.assign({ week: 5, startDate: '2020-10-03T18:00:00.000Z', homeTeam: 'X', awayTeam: 'Y', homeConference: 'SEC', awayConference: 'SEC', homeClassification: 'fbs', awayClassification: 'fbs', homeScore: 30, awayScore: 20, lines: [{ provider: 'Other', spread: -3, overUnder: 51, homeMoneyline: -150, awayMoneyline: 130 }, { provider: 'consensus', spread: -7, overUnder: 55.5, homeMoneyline: -300, awayMoneyline: 250 }] }, o || {});
  RAW[1999] = [rawG({ neutralSite: true }), rawG({ lines: [{ provider: 'consensus', spread: -7, homeMoneyline: -300, awayMoneyline: 250 }, { provider: 'Z', spread: -6, overUnder: 48 }] })];
  const L = await cfbd.lines(1999);
  assert.strictEqual(L[0].tot, 55.5); assert.strictEqual(L[0].neutral, true); assert.strictEqual(L[0].line, 7); assert.strictEqual(L[0].hc, 'SEC'); assert.strictEqual(L[0].ac, 'SEC');
  assert.strictEqual(L[1].tot, 48, 'total falls back to another provider'); assert.strictEqual(L[1].neutral, null, 'no flag in the row -> null');
  delete process.env.CFBD_API_KEY;

  // ---- walk-forward: a game's own result never changes its own model margin; a later week does
  const base = () => { const g = []; for (let wk = 1; wk <= 6; wk++) for (let i = 0; i < 4; i++) g.push(row(2020, wk, { h: 'T' + i, a: 'T' + (i + 4), hp: 30 + wk, ap: 10, line: 7 })); return g; };
  const A = cfbd.seasonGames({ 2019: [], 2020: base() }, [2020], 0).games, g2 = base(), tg = g2.find((x) => x.wk === 5 && x.h === 'T1'); tg.hp = 0; tg.ap = 99;
  const B = cfbd.seasonGames({ 2019: [], 2020: g2 }, [2020], 0).games, pick = (arr, wk) => arr.find((x) => x.wk === wk && x.h === 'T1');
  assert.strictEqual(pick(A, 5).mh, pick(B, 5).mh, 'own result must not change own model margin'); assert.notStrictEqual(pick(A, 6).mh, pick(B, 6).mh, 'a later week does use it');
  assert.strictEqual(pick(A, 1).mh, 3.5, 'week 1 without earlier games: only the home edge');

  // ---- two-period split + ATS angle (home dogs, -110, push = 0)
  const hd = (y, hp, ap) => row(y, 2, { line: -3, hp, ap });
  let r = rep([hd(2019, 20, 19), hd(2019, 10, 20), hd(2019, 17, 20)], [hd(2020, 21, 20), hd(2020, 20, 10), hd(2020, 10, 20), hd(2020, 10, 14)]);
  let a = find(r, 'home dogs');
  assert.deepStrictEqual([a.p1.won, a.p1.lost, a.p1.pushed], [1, 1, 1], 'period 1'); assert.deepStrictEqual([a.p2.won, a.p2.lost, a.p2.pushed], [2, 2, 0], 'period 2 (win by 1, win by 10 = cover, loss by 10, loss by 4 = +3 not enough)');
  assert.deepStrictEqual([a.all.won, a.all.lost, a.all.pushed], [3, 3, 1]); near(a.p1.units, P - 1); near(a.p2.units, 2 * P - 2); near(a.all.units, 3 * P - 3);
  assert.strictEqual(a.p1.winPct, 50); assert.strictEqual(a.p2.winPct, 50); near(a.all.roiPct, (3 * P - 3) / 7 * 100, 'roi'); assert.ok(typeof a.all.z === 'number'); assert.strictEqual(a.winningSeasons, '0 of 2');
  assert.strictEqual(r.periods[0], '2013-2019'); assert.strictEqual(r.periods[1], '2020-current');
  // the same games as road favorites: opposite side
  a = find(r, 'road favorites'); assert.deepStrictEqual([a.all.won, a.all.lost, a.all.pushed], [3, 3, 1]);
  // neutral site known true leaves the home/road angles
  r = rep([], [row(2020, 2, { line: -3, neutral: true, hp: 30, ap: 10 })]); assert.strictEqual(find(r, 'home dogs').all.won + find(r, 'home dogs').all.lost, 0);
  // conference road dogs: both teams in the same conference; independents never count
  r = rep([], [row(2020, 2, { line: 6, hc: 'SEC', ac: 'SEC', hp: 20, ap: 17 }), row(2020, 2, { line: 6, hc: 'SEC', ac: 'ACC', hp: 20, ap: 17 }), row(2020, 2, { line: 6, hc: 'FBS Independents', ac: 'FBS Independents', hp: 20, ap: 17 }), row(2020, 9, { line: 8, hc: 'Big 12', ac: 'Big 12', hp: 40, ap: 10 })]);
  assert.strictEqual(find(r, 'conference road dogs').all.won, 1); assert.strictEqual(find(r, 'conference road dogs').all.lost, 1); assert.strictEqual(find(r, 'non-conference road dogs').all.won + find(r, 'non-conference road dogs').all.lost, 2);
  assert.strictEqual(find(r, 'conference road dogs before wk 8').all.won, 1); assert.strictEqual(find(r, 'conference road dogs wk 8+').all.lost, 1); assert.strictEqual(find(r, 'conference road dogs 7+').all.lost, 1);
  // ---- gap angle starts in week 4 only
  r = rep([], [row(2020, 3, { line: -30, hp: 50, ap: 0 }), row(2020, 4, { line: -30, hp: 50, ap: 0 })]); // model says ~ +3.5 home, line says home +30 dog: home covers with the bet on the model side? model > line -> home
  assert.strictEqual(find(r, 'model-vs-spread gap >= 10').all.won, 1, 'week 3 excluded, week 4 included');
  // ---- totals: >= 60 under, push = 0, missing total skipped
  r = rep([], [row(2020, 2, { tot: 61, hp: 20, ap: 10 }), row(2020, 2, { tot: 60, hp: 30, ap: 30 }), row(2020, 2, { tot: 65, hp: 40, ap: 30 }), row(2020, 2, { tot: null, hp: 3, ap: 0 }), row(2020, 2, { tot: 44, hp: 30, ap: 20 })]);
  a = find(r, 'total >= 60 under'); assert.deepStrictEqual([a.all.won, a.all.lost, a.all.pushed], [1, 1, 1]); near(a.all.units, P - 1);
  a = find(r, 'total >= 65 under'); assert.deepStrictEqual([a.all.won, a.all.lost], [0, 1]);
  a = find(r, 'total <= 45 over'); assert.deepStrictEqual([a.all.won, a.all.lost], [1, 0], 'null total skipped, 44 over wins');
  // ---- moneyline buckets: real closing price, both sides, missing skipped
  r = rep([], [row(2020, 2, { hml: -200, aml: 170, hp: 20, ap: 10 }), row(2020, 2, { hml: null, aml: null, hp: 20, ap: 10 }), row(2020, 2, { hml: -200, aml: 170, hp: 20, ap: 20 })]);
  a = find(r, 'ML price 1.3-1.5'); assert.deepStrictEqual([a.all.won, a.all.lost], [0, 0]);
  a = find(r, 'ML price 1.5-1.8'); assert.deepStrictEqual([a.all.won, a.all.lost], [1, 0]); near(a.all.units, 0.5, 'home -200 pays 0.5');
  a = find(r, 'ML price 2.2-3'); assert.deepStrictEqual([a.all.won, a.all.lost], [0, 1]); near(a.all.units, -1);
  // home dog / dog +1..+3 ML pay the real price; a tie is a push
  r = rep([], [row(2020, 2, { line: -2, hml: 120, aml: -140, hp: 24, ap: 20 })]); a = find(r, 'home dog ML'); near(a.all.units, 1.2); a = find(r, 'dog +1..+3 ML'); assert.strictEqual(a.all.won, 1);
  // ---- teaser legs + pairing + payout (week of Tue Sep 1 2020: Thu Sep 3 / Sat Sep 5; next week Thu Sep 10 / Sat Sep 12)
  const dog = (t, d, o) => row(2020, 1, Object.assign({ t, line: -2, hp: 20 + d, ap: 20 }, o || {})); // home dog, dog margin d; teased margin d + 2 + 6
  const T = (day) => Date.UTC(2020, 8, day, 18);
  const gs = [dog(T(10), -8), dog(T(12), 0), dog(T(5), 3), dog(T(3), 0), dog(T(4), -5), dog(T(5) + 3600e3, -9)]; // input order scrambled; kickoff order wk1: d0, d-5, d3 (Sat), d-9 (Sat+1h); wk2: d-8, d0
  gs[0].wk = 2; gs[1].wk = 2;
  r = rep([], gs);
  // ticket 1 (d0, d-5): both cover -> win; ticket 2 (d3, d-9): d-9 misses (-1) -> lose; week 2 (d-8 push, d0 cover) -> void
  let s = r.teaserSim; assert.deepStrictEqual(s.map((x) => x.price), [-110, -120, -130]);
  assert.deepStrictEqual([s[0].tickets, s[0].won, s[0].lost, s[0].pushed], [3, 1, 1, 1]);
  near(s[0].units, (1 + 100 / 110 - 1) - 1); near(s[1].units, (100 / 120) - 1); near(s[2].units, (100 / 130) - 1);
  near(s[0].neededPct, 52.4); near(s[1].neededPct, 54.5); near(s[2].neededPct, 56.5); assert.strictEqual(s[0].winPct, 50); assert.strictEqual(s[0].winningSeasons, '0 of 1'); near(s[1].unitsSince2020, s[1].units);
  const tl = (id) => r.teaserLegs.find((x) => x.id === id);
  let t6 = tl('dog +1.5..+2.5 teased +6'); assert.deepStrictEqual([t6.p2.covered, t6.p2.missed, t6.p2.pushed], [4, 1, 1]); assert.strictEqual(t6.p2.coverPct, 80);
  let t7 = tl('dog +1.5..+2.5 teased +7'); assert.deepStrictEqual([t7.p2.covered, t7.p2.missed, t7.p2.pushed], [5, 0, 1], '+7: d-8 now covers, d-9 pushes'.replace('5, 0, 1', '5, 0, 1'));
  assert.strictEqual(t6.p1.covered + t6.p1.missed, 0, 'no 2013-2019 legs'); assert.strictEqual(tl('home dog +1.5..+2.5 teased +6').p2.covered, 4);
  assert.strictEqual(tl('favorite -7.5..-8.5 teased 6').p2.covered + tl('favorite -7.5..-8.5 teased 6').p2.missed, 0);
  r = rep([], [row(2020, 2, { line: 8, hp: 30, ap: 25 }), row(2020, 2, { line: 8, hp: 20, ap: 20 }), row(2020, 2, { line: 8, hp: 10, ap: 20 })]); // fav -8 teased 6: +5 covers, -8+6 = -2 on a tie... margin 0-8+6=-2 miss, -10-8... 
  t6 = tl('favorite -7.5..-8.5 teased 6'); assert.deepStrictEqual([t6.p2.covered, t6.p2.missed], [1, 2]); assert.strictEqual(tl('every favorite teased 6 (baseline)').p2.covered, 1);
  // odd leftover leg is not bet
  r = rep([], [dog(T(3), 0), dog(T(4), 0), dog(T(5), 0)]); assert.strictEqual(r.teaserSim[0].tickets, 1);

  // ---- HTTP: 401 without owner, 503 without key, full report, log lines, cache
  const acct = require('./acct');
  const srv = http.createServer(async (q, s2) => { if (q.url.startsWith('/acct')) { if (await acct.handle(q, s2)) return; } if (q.url.startsWith('/cfbd')) { if (await cfbd.handle(q, s2)) return; } s2.statusCode = 404; s2.end('{}'); });
  await new Promise((rs) => srv.listen(0, rs)); const B0 = 'http://127.0.0.1:' + srv.address().port;
  let res = await fetch(B0 + '/cfbd/edge'); assert.strictEqual(res.status, 401, 'owner only');
  res = await fetch(B0 + '/cfbd/edge', { headers: { 'x-token': 'abc.def' } }); assert.strictEqual(res.status, 401);
  res = await fetch(B0 + '/acct/owner', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '4321' }) }); const tok = (await res.json()).token; assert.ok(tok);
  res = await fetch(B0 + '/cfbd/edge', { headers: { 'x-token': tok } }); assert.strictEqual(res.status, 503, 'no key');
  process.env.CFBD_API_KEY = 'fake-key';
  const confs = ['SEC', 'ACC', 'Big Ten'];
  for (const y of [2018, 2019, 2020]) { RAW[y] = []; for (let i = 0; i < 340; i++) { const wk = 1 + (i % 12), sp = -((i % 29) - 14) + 0.5 * (i % 2), hs = (i * 7) % 45, as = (i * 11) % 38; RAW[y].push(rawG({ week: wk, startDate: new Date(Date.UTC(y, 8, 1 + (wk - 1) * 7 + (i % 5), 18)).toISOString(), homeTeam: 'T' + (i % 40), awayTeam: 'T' + ((i * 3 + 1) % 40 === i % 40 ? 41 : (i * 3 + 1) % 40), homeConference: confs[i % 3], awayConference: confs[(i % 4) % 3], homeScore: hs, awayScore: as, lines: [{ provider: 'consensus', spread: sp, overUnder: 35 + (i % 40), homeMoneyline: sp < 0 ? -150 - 10 * (i % 20) : 130 + 10 * (i % 30), awayMoneyline: sp < 0 ? 130 + 10 * (i % 30) : -150 - 10 * (i % 20) }] })); } }
  const logs = []; const ol = console.log; console.log = (...x) => logs.push(x.join(' '));
  res = await fetch(B0 + '/cfbd/edge', { headers: { 'x-token': tok } }); console.log = ol; const j = await res.json();
  assert.strictEqual(res.status, 200); assert.strictEqual(j.ok, true); assert.deepStrictEqual(j.seasons, [2018, 2019, 2020]); assert.ok(j.games > 600);
  assert.deepStrictEqual(Object.keys(j.families), ['gap', 'ats', 'tot', 'mlb', 'mld']); assert.strictEqual(j.families.gap.length, 8); assert.strictEqual(j.families.mlb.length, 8); assert.strictEqual(j.teaserLegs.length, 5); assert.strictEqual(j.teaserSim.length, 3);
  const eb = logs.filter((l) => l.startsWith('EDGEBT'));
  assert.ok(eb.length >= 6 && eb.every((l, i) => l.startsWith('EDGEBT' + (i + 1) + ' ') && l.length < 3500), 'log lines numbered and short'); eb.forEach((l) => { const o = JSON.parse(l.slice(l.indexOf(' ') + 1)); assert.ok(o.meta || (o.cols && Array.isArray(o.rows))); if (o.rows) o.rows.forEach((x) => assert.ok(Array.isArray(x)))});
  assert.ok(logs.join('').includes('"fam":"gap"') && logs.join('').includes('"fam":"teaserSim"')); assert.ok(!logs.join('\n').includes('fake-key'));
  const c0 = calls; res = await fetch(B0 + '/cfbd/edge', { headers: { 'x-token': tok } }); assert.strictEqual(res.status, 200); assert.strictEqual(calls, c0, 'second call from the 1 hour cache');
  // ---- boot hook
  const st = global.setTimeout; let delay = null, fn = null; global.setTimeout = (f, d) => { delay = d; fn = f; return 0; };
  cfbd.bootEdge(); assert.strictEqual(fn, null, 'no EDGEBT_RUN = nothing scheduled'); process.env.PARLAYBT_RUN = '0'; cfbd.bootParlay(); assert.strictEqual(fn, null, 'PARLAYBT_RUN unchanged');
  process.env.EDGEBT_RUN = '1'; cfbd.bootEdge(); assert.strictEqual(delay, 25000); global.setTimeout = st;
  const l2 = []; console.log = (...x) => l2.push(x.join(' ')); fn(); for (let i = 0; i < 100 && !l2.some((l) => l.startsWith('EDGEBT done')); i++) await new Promise((rs) => setTimeout(rs, 20)); console.log = ol;
  assert.ok(l2.some((l) => l === 'EDGEBT done'), 'EDGEBT done logged');
  console.log('edgebt.test.js: all passed'); srv.close();
})().catch((e) => { console.error('FAILED:', e.stack || e.message); process.exitCode = 1; process.exit(1); });
