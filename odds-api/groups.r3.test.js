// Run: node odds-api/groups.r3.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
// ROUND 3 (Nov 16 2026): one check per item of the "do not ship" review and of the coordinator's list. Every check here FAILS on 486f127 (v254 before this
// round) and passes now. To see that: ODD_ROOT=/path/to/a/486f127/checkout node odds-api/groups.r3.test.js  (expect every line FAIL).
const PH = require('./groups.testenv'); // Phase 1: switches set to "Groups open"; phone-file checks run only where the Groups phone code exists (see that file)
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.ODD_ROOT ? path.resolve(process.env.ODD_ROOT) : path.join(__dirname, '..'), R = path.join(ROOT, 'odds-api') + '/';
const G = require(R + 'groups'), GR = require(R + 'grade'), S = require(R + 'sync'), PAIR = require(R + 'pairing'), LIM = require(R + 'limits'), D = G._deps;
const X = { db: {}, DOWN: false, LOSTACK: false, NOREAD: false };
D.S = {
  dbGet: async (id) => { await new Promise((r) => setImmediate(r)); if (X.NOREAD) throw new Error('db read 503'); return X.db[id] ? JSON.parse(JSON.stringify(X.db[id])) : null; },
  dbPut: async (row, ign) => { if (X.db[row.id] && ign) return; X.db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (X.DOWN) throw new Error('db write 503'); if (!X.db[id] || X.db[id].updated !== Number(was)) return false; X.db[id].data = JSON.parse(JSON.stringify(data)); X.db[id].updated = upd; if (X.LOSTACK) throw new Error('timeout after write'); return true; },
  dbIds: async () => Object.keys(X.db).filter((k) => !k.startsWith('lock:')),
};
const WHO = []; for (let i = 0; i < 130; i++) WHO.push('u' + String(i).padStart(3, '0')); ['ann', 'bob', 'cat', 'dan', 'eve'].forEach((w) => WHO.push(w));
const SID = {}, NAMES = {}; WHO.forEach((w, i) => { SID[w] = (i.toString(16).padStart(4, '0').repeat(2) + '0'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; }, phoneEmail: pe, isOwnerPhone: () => false, ownerOk: (req) => String(req.headers['x-token']) === 't-owner', namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1'); D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Z = (s) => Date.parse(s), H = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z');
const T = (abbr, name) => ({ abbr, name, short: name.split(' ').pop(), loc: name.split(' ').slice(0, -1).join(' ') });
const O = (details, ou, aml, hml, x) => Object.assign({ details, overUnder: ou, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: aml, spreadOdds: -110 }, homeTeamOdds: { moneyLine: hml, spreadOdds: -110 } }, x || {});
let GAMES = []; const PATH = { nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb', nba: 'basketball/nba' };
const BASE = () => [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 20, hs: 24 }, // nothing posted on ESPN
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: O('BUF -2.5', 47.5, 130, -150) },
  { id: '503', start: START + 7 * DAY, away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21, odds: O('CHI -3', 41, 140, -160) },
  { id: '505', start: START, away: T('WAS', 'Washington Commanders'), home: T('PHI', 'Philadelphia Eagles'), as: 10, hs: 31, odds: { details: 'PHI -7.5', overUnder: 44.5 } }, // a line, no prices
  { id: '506', start: START, away: T('ARI', 'Arizona Cardinals'), home: T('SF', 'San Francisco 49ers'), as: 13, hs: 30, odds: O('SF -9.5', 45, 380, -500), oddsFrom: START - DAY }, // posted a day before only
  { id: '507', start: START, away: T('DEN', 'Denver Broncos'), home: T('LV', 'Las Vegas Raiders'), as: 0, hs: 0, off: 'STATUS_CANCELED', completed: true, odds: O('LV -3', 40, 140, -160) },
  { id: '508', start: START, away: T('SEA', 'Seattle Seahawks'), home: T('LAR', 'Los Angeles Rams'), as: 21, hs: 20, off: 'STATUS_POSTPONED', odds: O('LAR -3', 40, 140, -160) },
  { id: '509', start: START + 2 * H, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 17, hs: 10, odds: O('NE -3', 40, 140, -160) },
  { id: '901', lg: 'nhl', start: START, away: T('TOR', 'Toronto Maple Leafs'), home: T('BOS', 'Boston Bruins'), as: 2, hs: 3, odds: O('BOS -1.5', 6, 140, -165, { awayTeamOdds: { moneyLine: 140, spreadOdds: -200 }, homeTeamOdds: { moneyLine: -165, spreadOdds: 170 } }) },
  { id: '701', lg: 'nba', start: START, away: T('LAL', 'Los Angeles Lakers'), home: T('BOS', 'Boston Celtics'), as: 105, hs: 110, odds: O('BOS -4', 214.5, 150, -170) },
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
D.fetch = async (u) => {
  const m = /sports\/([a-z-]+\/[a-z-]+)\/scoreboard\?dates=(\d{8})/.exec(u);
  const evs = !m ? [] : GAMES.filter((g) => PATH[g.lg || 'nfl'] === m[1] && ymd(g.start) === m[2]).map((g) => { const now = D.now(), st = g.off ? (now < g.start ? 'pre' : 'post') : now < g.start ? 'pre' : now < g.start + 3.5 * H ? 'in' : 'post';
    const tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc }), od = typeof g.odds === 'function' ? g.odds(now) : g.odds;
    return { id: g.id, date: new Date(g.start).toISOString(), status: { type: { state: st, completed: g.completed != null ? (st === 'post' && g.completed) : (!g.off && st === 'post'), name: g.off || (st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') } },
      competitions: [{ odds: od && !(g.oddsFrom && now < g.oddsFrom) ? [od] : undefined, competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
  return { ok: true, json: async () => ({ events: evs }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
const fresh = () => { X.db = {}; WHO.forEach((w) => { X.db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); GAMES = BASE(); X.DOWN = X.LOSTACK = X.NOREAD = false; G._reset(); if (LIM._reset) LIM._reset(); NOW = START - 3 * DAY; };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } }); let P;
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || ('9.9.' + (WHO.indexOf(who) >> 8) + '.' + (WHO.indexOf(who) & 255)) }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json() }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - H, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 4, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
// A group whose commissioner turned on "anyone with the link joins without approval" (so the helpers below can seat people); joinAll uses the commissioner's code.
const mk = async (who, c, join, extra) => { NOW = START - 3 * DAY; G._reset(); const r = await call(who, 'create', Object.assign({ name: 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, auto: true, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }, extra || {})); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); assert.ok(r.j.group && r.j.group.members, w + ' is a member'); } };
const view = async (w, g, at, cid) => { if (at != null) NOW = at; G._reset(); const st = await call(w, 'standings', { id: g.id, cid: cid || g.contests[0].cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(w, 'player', { id: g.id, cid: cid || g.contests[0].cid, pid: me.pid }); return { st: st.j, row: me, bets: p.j.bets, t: p.j.t, by: Object.fromEntries(p.j.bets.map((b) => [b.id, b])) }; };
const bet = (id, gid, side, type, odds, stake, o) => { const g = GAMES.find((x) => x.id === gid); return Object.assign({ id, gid, lg: g.lg || 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake }, o || {}); };
const leg = (gid, side, type, o, line) => { const g = GAMES.find((x) => x.id === gid); return { gid, side, type, o, line, lg: g.lg || 'nfl', home: g.home.abbr, away: g.away.abbr, day: GR.chiDay(g.start) }; };
const add = (w, b) => call(w, 'bet/add', { bet: b });
const push = (w, incoming, at) => { const cur = X.db[SID[w]]; cur.data = S.merge(cur.data, incoming, at, cur.updated); cur.updated = at; }; // what a phone's sync does
const client = () => PH.phone('pics/groups.js'); // only called inside PH.phoneCheck (Phase 1 has no phone code)
const personal = (r, re) => { assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.personal, true, 'answered as a personal bet: ' + JSON.stringify(r.j)); assert.strictEqual(r.j.gl, 0, 'not locked'); assert.ok(!/Saved to your group/.test(JSON.stringify(r.j)), 'never told "Saved to your group"'); if (re) assert.match(r.j.why, re); return r; }; // Phase 1 (B2): the answer when no contest can count a bet
const tests = []; const test = (name, fn) => tests.push([name, fn]);

// =============================== CRITICAL 1: one way in ===============================
test('C1 a bet that only arrives through the phone\'s sync NEVER counts, whatever it carries (src:kalshi, gid, gl, sa)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H;
  push('bob', { bets: [{ id: 'k1', src: 'kalshi', kt: 'KXNFLSPREAD-26NOV22KCBUF-KC1', ks: 'yes', text: 'Kansas City wins by more than 0.5 points', mult: 6, stake: 100, day: '2026-11-22', t: NOW, gl: NOW, sa: NOW },
    { id: 'k2', src: 'kalshi', gid: '502', lg: 'nfl', home: 'BUF', away: 'KC', side: 'KC', type: 'ml', mult: 2.5, stake: 100, day: '2026-11-22', gl: NOW }] }, NOW);
  let v = await view('bob', g, START - 5 * H); assert.deepStrictEqual(v.bets, [], 'not in the contest before kickoff');
  v = await view('bob', g, START + 2 * DAY); assert.deepStrictEqual(v.bets, [], 'nor after'); assert.strictEqual(v.t.win, 0);
  const src = fs.readFileSync(R + 'groups.js', 'utf8'); assert.ok(!/b\.src !== 'kalshi'\) continue/.test(src), 'the sync-tag path is gone from contestBets');
});
test('C1 a Kalshi bet is added like any other: it locks at that moment; marking it sold (or swapping it) on the phone later changes nothing', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H;
  const kb = { id: 'k-KXNFLGAME-26NOV22KCBUF-BUF-yes', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-BUF', ks: 'yes', kind: 'prop', text: 'Buffalo to win', mult: 1.6, stake: 100, day: '2026-11-22' };
  let r = await add('bob', kb); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.ok(r.j.gl === NOW && r.j.bet && r.j.bet.gl === NOW, 'stamped by the server');
  NOW = START - 10 * 60e3; push('bob', { bets: [Object.assign({}, kb, { cash: 100, soldN: 1, t: NOW })] }, NOW); // "sold" before kickoff, when Buffalo news broke
  push('bob', { bets: [Object.assign({}, kb, { kt: 'KXNFLGAME-26NOV22KCBUF-KC', text: 'Kansas City to win', t: NOW + 1 })] }, NOW + 1);
  const v = await view('bob', g, START + 2 * DAY), b = v.by[kb.id]; assert.ok(b && b.ok && b.locked, JSON.stringify(b)); assert.strictEqual(b.res, 'lost', 'Buffalo lost 24-27: still in the contest, still Buffalo'); assert.strictEqual(b.pl, -100);
});
test('C1 "Kalshi-tagged bets only" filters among SERVER-ADDED bets by a ticker checked in shape; the label stays "(not verified)"', async () => {
  const g = await mk('ann', { kalshi: true }); await joinAll(g, ['bob']); NOW = START - 6 * H;
  assert.strictEqual((await add('bob', { id: 'kk1', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-KC', ks: 'yes', kind: 'prop', text: 'Kansas City to win', mult: 2.2, stake: 50, day: '2026-11-22' })).s, 200);
  personal(await add('bob', bet('h1', '509', 'MIA', 'ml', 140, 50)), /Kalshi-tagged bets only/); // Phase 1 (B2): told when added, not locked
  let r = await add('bob', { id: 'kbad', src: 'kalshi', kt: 'not a ticker', mult: 2, stake: 5, day: '2026-11-22' }); assert.strictEqual(r.s, 400, 'bad ticker shape refused');
  r = await add('bob', { id: 'kbad2', src: 'polymarket', kt: 'KXNFLGAME-26NOV22KCBUF-KC', mult: 2, stake: 5, day: '2026-11-22' }); assert.strictEqual(r.s, 400);
  const v = await view('bob', g, START + 2 * DAY); assert.ok(v.by.kk1.ok && v.by.kk1.kalshi && v.by.kk1.res === 'won'); assert.strictEqual(v.by.kk1.pl, 60, 'typed 2.2x (+120) is worse than the +130 reference: 50 x 1.2');
  assert.ok(!v.by.h1, 'the untagged bet is not in the contest at all'); PH.phoneCheck(() => assert.ok(client().includes('Kalshi-tagged bets only (not verified)')));
});
// =============================== CRITICAL 2: the price is settled at kickoff ===============================
test('C2 no reference price = EVEN MONEY at most, never "+500 on anything" (moneyline with nothing posted: +100)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  assert.strictEqual((await add('bob', bet('n2', '501', 'NYG', 'ml', 500, 100))).s, 200);
  const v = await view('bob', g, START + 2 * DAY); assert.ok(v.by.n2.ok && v.by.n2.res === 'won'); assert.strictEqual(v.by.n2.pl, 100);
});
test('C2 the reference is re-read until kickoff: a bet added before ESPN posts odds is graded at the price posted later (SF -500, not the +500 typed)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 2.5 * DAY;
  assert.strictEqual((await add('bob', bet('n5', '506', 'SF', 'ml', 500, 100))).s, 200);
  NOW = START - 2 * H; G._reset(); await G.tick(Object.assign({ force: true })); // the server's own tick, two hours before kickoff
  const v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.n5.res, 'won'); assert.strictEqual(v.by.n5.pl, 20);
});
test('C2 worse of the price typed and the reference AT KICKOFF: the line moves against the bettor after the bet, the kickoff price is used; nothing after kickoff is read', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']);
  GAMES.find((x) => x.id === '502').odds = (now) => (now < START - 3 * H ? O('BUF -2.5', 47.5, 150, -170) : now < START + 3 * H ? O('BUF -2.5', 47.5, 110, -130) : O('BUF -2.5', 47.5, 900, -2000)); // +150 early, +110 at kickoff, +900 "live"
  NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('m1', '502', 'KC', 'ml', 140, 100))).s, 200); assert.strictEqual((await add('cat', bet('m2', '502', 'KC', 'ml', 105, 100))).s, 200);
  NOW = START + 2 * H; G._reset(); await G.tick({ force: true }); // an hour before kickoff: +110
  NOW = START + 4 * H; G._reset(); await G.tick({ force: true }); // in play: the +900 must never be taken
  let v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.m1.pl, 110, 'typed +140, +150 when added, +110 at kickoff -> +110');
  v = await view('cat', g, START + 2 * DAY); assert.strictEqual(v.by.m2.pl, 105, 'typed +105 is the worse one: kept');
});
test('C2 the line check runs with or without a reference PRICE: ESPN has PHI -7.5 and no prices, PHI -5.5 is refused; PHI ML is capped by the spread (well under even money)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  let r = await add('bob', bet('n4', '505', 'PHI', 'sp', 500, 100, { line: -5.5 })); assert.strictEqual(r.s, 409, JSON.stringify(r.j)); assert.match(r.j.error, /Line too far from the market: the main line is PHI -7.5/);
  r = await add('bob', bet('n4b', '505', 'PHI', 'sp', 500, 100, { line: -7.5 })); assert.strictEqual(r.s, 200); r = await add('bob', bet('n3', '505', 'PHI', 'ml', 500, 100)); assert.strictEqual(r.s, 200);
  const v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.n4b.pl, 100, 'main line, no price: even money, not +500'); assert.ok(v.by.n3.pl > 0 && v.by.n3.pl < 50, 'a 7.5-point favorite never pays even money: ' + v.by.n3.pl);
  assert.strictEqual(typeof GR.lineWhy, 'function'); assert.ok(GR.lineWhy({ kind: 'sp', side: 'home', line: -5.5, lg: 'nfl', rl: -7.5 }), 'no rp given, still refused');
});
test('C2 no line at all: a spread or total is refused when added ("No line posted yet for this game — try closer to kickoff"); a moneyline counts at even money at most', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  for (const b of [bet('s1', '501', 'DAL', 'sp', 500, 100, { line: 40.5 }), bet('s2', '501', 'Over', 'ou', -110, 100, { line: 20.5 })]) { const r = await add('bob', b); assert.strictEqual(r.s, 409, JSON.stringify(r.j)); assert.match(r.j.error, /^No line posted yet for this game — try closer to kickoff/); }
  const v = await view('bob', g, START + 2 * DAY); assert.deepStrictEqual(v.bets, []);
});
test('C2 "Longest odds that count" stays an upper cap ON TOP of the reference rule (typed +400, reference +380, contest cap +150 -> +150)', async () => {
  GAMES.find((x) => x.id === '506').oddsFrom = 0; const g = await mk('ann', { maxOdds: 150 }); await joinAll(g, ['bob']); NOW = START - 5 * H; GAMES.find((x) => x.id === '506').as = 31;
  assert.strictEqual((await add('bob', bet('c1', '506', 'ARI', 'ml', 400, 100))).s, 200); const v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.c1.pl, 150);
  const g2 = await mk('ann', { maxOdds: 5000 }); await joinAll(g2, ['cat']); NOW = START - 5 * H; assert.strictEqual((await add('cat', bet('c2', '501', 'NYG', 'ml', 5000, 100))).s, 200);
  assert.strictEqual((await view('cat', g2, START + 2 * DAY)).by.c2.pl, 100, 'a +5000 setting never lifts the even-money rule');
});
// =============================== CRITICAL 3: parlays ===============================
test('C3 parlays: the same leg twice and two legs from one game are refused; legs are capped (default 4, commissioner setting)', async () => {
  const g = await mk('ann', { legs: undefined }); assert.strictEqual(g.contests[0].rules.legs, 4, 'default 4'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  let r = await add('bob', { id: 'p1', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', mult: 1000, legs: [1, 2, 3, 4, 5].map(() => leg('502', 'KC', 'ml', 130)) }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /same leg/);
  r = await add('bob', { id: 'p3', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('502', 'KC', 'sp', -110, 2.5)] }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /same game/);
  r = await add('bob', { id: 'p5', kind: 'parlay', stake: 10, day: '2026-11-22', lg: 'nfl', legs: [leg('501', 'NYG', 'ml', -110), leg('502', 'KC', 'ml', 130), leg('506', 'SF', 'ml', -500), leg('509', 'MIA', 'ml', 140), leg('505', 'PHI', 'ml', -300)] }); personal(r, /More than 4 legs/); // Phase 1 (B2)
  const v = await view('bob', g, START + 2 * DAY); assert.ok(!v.by.p5, 'the 5-leg parlay is not in the contest');
});
test('C3 every leg passes the price rule on its own and the multiplier is the PRODUCT of the graded leg prices, never the typed one when that is higher', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H;
  // legs typed +500 each: NYG has no reference (even money, 2x), KC reference +130 (2.3x), MIA reference +140 (2.4x) -> 2 x 2.3 x 2.4 = 11.04x, not 216x and not the typed 1000x
  let r = await add('bob', { id: 'p2', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', mult: 1000, legs: [leg('501', 'NYG', 'ml', 500), leg('502', 'KC', 'ml', 500), leg('509', 'MIA', 'ml', 500)] }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  r = await add('cat', { id: 'p4', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', mult: 3, legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140)] }); assert.strictEqual(r.s, 200); // typed 3x is LOWER than 2.3 x 2.4 = 5.52x: the typed one is used
  r = await add('cat', { id: 'p6', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('501', 'NYG', 'ml', -110), leg('505', 'PHI', 'sp', 500, -5.5)] }); assert.strictEqual(r.s, 409, 'a leg with a far line sinks the parlay when it is added');
  let v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.p2.res, 'won'); assert.strictEqual(v.by.p2.pl, 1004, '100 x (2 x 2.3 x 2.4 - 1)');
  v = await view('cat', g, START + 2 * DAY); assert.strictEqual(v.by.p4.pl, 200);
});
// =============================== HIGH 4: tolerance per sport and market; alternate lines ===============================
test('H4 line tolerance per sport and market: NHL Over 4 (market 6) and TOR +3.5 (market +1.5) are refused; main line only in hockey / baseball', async () => {
  const g = await mk('ann', { sport: 'nhl' }); await joinAll(g, ['bob']); NOW = START - 5 * H;
  let r = await add('bob', bet('h1', '901', 'Over', 'ou', -100, 100, { line: 4 })); assert.strictEqual(r.s, 409, JSON.stringify(r.j)); assert.match(r.j.error, /Main line only in this sport: Over 6/);
  r = await add('bob', bet('h2', '901', 'TOR', 'sp', -190, 100, { line: 3.5 })); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Main line only in this sport: TOR \+1\.5/);
  r = await add('bob', bet('h3', '901', 'Over', 'ou', -110, 100, { line: 5.5 })); assert.strictEqual(r.s, 409, 'half a goal is not allowed either');
  r = await add('bob', bet('h4', '901', 'TOR', 'sp', -150, 100, { line: 1.5 })); assert.strictEqual(r.s, 200); // the puck line itself: typed -150, reference -200
  const v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.by.h4.res, 'won'); assert.strictEqual(v.by.h4.pl, 50, 'graded at -200');
  const tl = (lg, k) => GR.tolOf(lg, k).tol; assert.deepStrictEqual([tl('nfl', 'sp'), tl('nfl', 'ou'), tl('ncaaf', 'sp'), tl('ncaaf', 'ou'), tl('nba', 'sp'), tl('nba', 'ou'), tl('ncaab', 'sp'), tl('ncaab', 'ou'), tl('nhl', 'sp'), tl('nhl', 'ou'), tl('mlb', 'sp'), tl('mlb', 'ou'), tl('soccer', 'sp'), tl('soccer', 'ou')], [1.5, 2, 1.5, 2, 1.5, 3, 1.5, 3, 0, 0, 0, 0, 0, 0]);
});
test('H4 an off-main line inside the tolerance is graded at an alternate price WORSE for the bettor (formula in grade.js altPm); outside it is refused', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H;
  let r = await add('bob', bet('f1', '502', 'BUF', 'sp', -100, 100, { line: -0.5 })); assert.strictEqual(r.s, 409, '2 points better than -2.5: over the 1.5 allowed');
  r = await add('bob', bet('f2', '502', 'KC', 'sp', -100, 100, { line: 4 })); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); // 1.5 better than +2.5
  r = await add('bob', bet('f4', '502', 'Over', 'ou', -100, 100, { line: 45.5 })); assert.strictEqual(r.s, 200); // 2 better than 47.5 (51 points scored: wins)
  r = await add('cat', bet('f5', '502', 'Over', 'ou', -100, 100, { line: 45 })); assert.strictEqual(r.s, 409, '2.5 better than 47.5');
  r = await add('cat', bet('f6', '502', 'KC', 'sp', 250, 100, { line: -3.5 })); assert.strictEqual(r.s, 200); // 6 points WORSE than +2.5 for the bettor: a small credit only (KC won by 3: loses anyway)
  const v = await view('bob', g, START + 2 * DAY);
  const p2 = 110 / 210 + 0.10 * 1.5, p4 = 110 / 210 + 0.05 * 2; assert.strictEqual(v.by.f2.pl, Math.round(100 * (1 - p2) / p2 * 100) / 100, 'KC +4: chance 52.4% + 10 points per point x 1.5 = 67.4% -> about -207, not the -100 typed'); assert.strictEqual(v.by.f4.pl, Math.round(100 * (1 - p4) / p4 * 100) / 100);
  assert.ok(v.by.f2.pl < 90.91 && v.by.f4.pl < 90.91, 'always worse than the main line price');
  const worse = GR.altPm({ kind: 'sp', side: 'away', line: -3.5, lg: 'nfl', rl: 2.5, rp: -110 }), q = 110 / 210 - 0.02 * 6; assert.ok(Math.abs(worse - (1 - q) / q) < 1e-9 && worse < 2.5, 'a worse line earns 2 points of chance per point (10 points at most): +148, far under any real price for it');
  assert.strictEqual(GR.altPm({ kind: 'sp', side: 'home', line: -2.5, lg: 'nba', rl: -4, rp: null }) < 1, true, 'no reference price: never better than even money');
});
// =============================== HIGH 5: idempotent add ===============================
test('H5 idempotent add: same id + same bet = success with the stored bet (never a second bet); same id + a different bet = 409; a lost answer cannot strand the phone', async () => {
  const g = await mk('ann'); await joinAll(g, ['cat']); NOW = START - 6 * H; const b = bet('x2', '502', 'KC', 'ml', 130, 100);
  X.LOSTACK = true; let r = await add('cat', b); X.LOSTACK = false; assert.notStrictEqual(r.s, 200, 'the write landed but the answer was lost');
  let st = await call('cat', 'bet/status', { id: 'x2' }); assert.strictEqual(st.s, 200); assert.strictEqual(st.j.saved, true, 'the phone asks by id before saying anything'); assert.strictEqual(st.j.bet.id, 'x2'); assert.strictEqual(st.j.bet.gl, NOW);
  const t0 = NOW; NOW += 30e3; r = await add('cat', b); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.gl, t0, 'the stored bet, first stamp'); assert.strictEqual(r.j.again, true);
  r = await add('cat', b); assert.strictEqual(r.s, 200); r = await add('cat', bet('x2', '502', 'BUF', 'ml', -150, 100)); assert.strictEqual(r.s, 409, 'different content'); assert.match(r.j.error, /different bet is already locked/);
  st = await call('cat', 'bet/status', { id: 'never' }); assert.strictEqual(st.j.saved, false);
  assert.strictEqual(X.db[SID.cat].data.bets.filter((y) => y.id === 'x2').length, 1, 'one copy in My Bets'); assert.ok(X.db[SID.cat].data.bets[0].gl === t0);
  const v = await view('cat', g, START + 2 * DAY); assert.strictEqual(v.bets.length, 1); assert.strictEqual(v.t.stake, 100); assert.strictEqual(v.by.x2.pl, 130);
  X.DOWN = true; r = await add('cat', bet('x9', '509', 'MIA', 'ml', 140, 10)); X.DOWN = false; NOW = START - 6 * H; assert.notStrictEqual(r.s, 200); assert.strictEqual((await call('cat', 'bet/status', { id: 'x9' })).j.saved, false, 'a failed upload left nothing');
});
test('H5 / M13 phone: one bet id per bet reused on every retry, waits 60 s with "Saving…", asks bet/status by id after a timeout; a failed status check never falls back to personal', async () => {
  PH.phoneCheck(() => { const c = client(); assert.ok(/60000/.test(c) && c.includes('Saving…'), '60 s wait with a Saving state'); assert.ok(c.includes("post('bet/status', id ? { id: id } : {})") && c.includes('st = await blStatus(bet.id)'), 'asks bet/status by id');
  assert.ok(c.includes("Couldn't reach your group — try again"), 'M13 message'); assert.ok(!/catch \(e\) \{ return \{ go: 'personal'/.test(c)); });
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H; X.NOREAD = true; const r = await call('bob', 'bet/status', {}); X.NOREAD = false; assert.notStrictEqual(r.s, 200, 'the server says it failed (it must not answer "no group" when it could not look)');
});
// =============================== HIGH 6: join limits keyed on the account ===============================
test('H6 100 people on one clubhouse Wi-Fi all join (preview + join each, one IP); abuse limits stay per account and per code', async () => {
  const g = await mk('ann'); let r = await call('owner', 'ent/admin', { op: 'seats', id: g.id, n: 100 }); assert.strictEqual(r.s, 200); G._reset();
  const one = async (w) => { const p = await call(w, 'preview', { code: g.code }, '7.7.7.7'); if (p.s !== 200) return p; return call(w, 'join', { code: g.code }, '7.7.7.7'); };
  const rs = await Promise.all(WHO.slice(0, 100).map(one)); const bad = rs.filter((x) => x.s !== 200); assert.strictEqual(bad.length, 0, bad.length + ' refused: ' + JSON.stringify(bad[0] && bad[0].j));
  const gg = (await call('ann', 'get', { id: g.id })).j.group; assert.strictEqual(gg.members.length, 101); assert.strictEqual(new Set(gg.members.map((m) => m.pid)).size, 101);
  for (let i = 0; i < 100; i++) { const x = await call(null, 'invite', { type: 'g', code: g.code }, '7.7.7.7'); assert.strictEqual(x.s, 200, 'signed-out look ' + i + ' from the same Wi-Fi'); }
  let n = 0; for (let i = 0; i < 40; i++) { const x = await call('u120', 'preview', { code: g.code }, '5.5.5.' + i); if (x.s === 429) n++; } assert.ok(n >= 9, 'one account hammering from many addresses is stopped (' + n + ')');
  G._reset(); n = 0; for (let i = 0; i < 12; i++) { const x = await call('u121', 'join', { code: 'ZZZZ-ZZ' + String(i).padStart(2, '0') }, '7.7.7.7'); if (x.s === 429) n++; } assert.strictEqual(n, 2, '10 wrong codes block that ACCOUNT'); assert.strictEqual((await call('u122', 'preview', { code: g.code }, '7.7.7.7')).s, 200, 'but not the rest of the room');
});
// =============================== HIGH 7: partner suggestions are bounded ===============================
test('H7 suggestPartners: exact up to 12 players, fast beyond, 200 ms hard limit, 144 players at most; rate limit per group', async () => {
  const mkp = (n, f) => Array.from({ length: n }, (_, i) => Object.assign({ id: 'p' + i, name: 'P' + i }, f(i)));
  assert.deepStrictEqual([PAIR.MAXP, PAIR.EXACT, PAIR.LIMIT_MS], [144, 12, 200]);
  for (const [n, k, m] of [[12, 2, 'balanced'], [13, 2, 'rotate'], [48, 4, 'balanced'], [101, 2, 'balanced'], [144, 2, 'hot'], [144, 3, 'rotate']]) { const times = []; for (let rep = 0; rep < 3; rep++) { const t0 = Date.now(), l = PAIR.suggestPartners(mkp(n, (i) => ({ hcp: (i * 7 + rep) % 31 })), { teamSize: k, mode: m }); times.push(Date.now() - t0); assert.ok(l.length >= 1, n + ' players: an answer'); }
    assert.ok(Math.min(...times) <= 200, n + ' players: best of 3 took ' + Math.min(...times) + ' ms (the search itself stops at 100 ms)'); assert.ok(Math.max(...times) <= 600, n + ' players: slowest of 3 took ' + Math.max(...times) + ' ms on this (shared) machine'); }
  const big = PAIR.suggestPartners(mkp(145, (i) => ({ hcp: i % 30 })), {}); assert.strictEqual(big.length, 0); assert.match(big.note, /up to 144 players/);
  const ex = PAIR.suggestPartners(mkp(8, (i) => ({ hcp: i * 3 })), {}); assert.strictEqual(ex[0].spread, 0, '8 players: the exact best (0 apart)'); assert.strictEqual(ex.quick, false);
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat', 'dan']); let n429 = 0, msg = '';
  for (let i = 0; i < 66; i++) { const r = await call(['ann', 'bob', 'cat'][i % 3], 'partners', { id: g.id, sport: 'golf' }); if (r.s === 429) { n429++; msg = r.j.error; } } assert.strictEqual(n429, 6, '60 per 10 minutes per group, across its members'); assert.match(msg, /for this group/);
});
test('H7 Hot pairs with exactly four players uses each pair\'s OWN record together; 7 players in threes offers 3/2/2 or 4/3', async () => {
  const pl = [1800, 1500, 1400, 1100].map((r, i) => ({ id: 'p' + i, name: 'P' + i, rating: r }));
  const hist = [{ date: '2026-11-01', team: ['p0', 'p1'], result: 'W' }, { date: '2026-11-01', team: ['p2', 'p3'], result: 'L' }, { date: '2026-11-08', team: ['p0', 'p1'], result: 'W' }, { date: '2026-11-08', team: ['p2', 'p3'], result: 'L' }];
  const hot = PAIR.suggestPartners(pl, { mode: 'hot', history: hist, top: 3 }); assert.deepStrictEqual(hot[0].teams.map((t) => t.slice().sort()).sort(), [['p0', 'p1'], ['p2', 'p3']], 'the 2-0 pair stays together'); assert.match(hot[0].reason, /P0 \+ P1 are 2-0/);
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, hcp: i * 3 }));
  const a = PAIR.suggestPartners(seven, { teamSize: 3 }); assert.deepStrictEqual(a.choices.map((c) => c.key), ['3/2/2', '4/3']); assert.deepStrictEqual(a[0].teams.map((t) => t.length).sort(), [2, 2, 3]);
  const b = PAIR.suggestPartners(seven, { teamSize: 3, sizes: '4/3' }); assert.deepStrictEqual(b[0].teams.map((t) => t.length).sort(), [3, 4]); assert.strictEqual(b.sizes, '4/3');
  const g = await mk('ann'); const r = await call('ann', 'partners', { id: g.id, sport: 'golf', teamSize: 3, sizes: '4/3', guests: seven.map((p) => ({ name: p.name, val: p.hcp })).slice(0, 6) }); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.choices.map((c) => c.key), ['3/2/2', '4/3']); assert.strictEqual(r.j.sizes, '4/3'); PH.phoneCheck(() => assert.ok(client().includes('p-sizes'), 'the commissioner is offered the choice on the phone'));
});
// =============================== MEDIUM 8: stake caps, weekly limit ===============================
test('M8 stake cap per MARKET and per GAME per member: the same bet 20 times counts once; markets on one game share twice the cap; Standings default to 10 bets a week', async () => {
  const g = await mk('ann', { cap: 100 }); assert.strictEqual(g.contests[0].rules.maxBets, 10, 'weekly limit default in Standings'); await joinAll(g, ['bob']); NOW = START - 5 * H;
  for (let i = 0; i < 20; i++) { NOW += 1000; const r = await add('bob', bet('d' + String(i).padStart(2, '0'), '502', 'KC', 'ml', 130, 100)); if (i) personal(r, /Over the stake limit: \$100 counts on one market and \$200 on one game/); else assert.ok(r.s === 200 && r.j.gl > 0); } // Phase 1 (B2): copies 2 to 20 are told so and not locked
  let v = await view('bob', g, START + 2 * DAY); assert.strictEqual(v.t.n, 1); assert.strictEqual(v.t.stake, 100); assert.strictEqual(v.t.win, 130); assert.strictEqual(v.bets.length, 1, 'only the first copy is in the contest');
  const g2 = await mk('ann', { cap: 100, maxBets: 0 }); await joinAll(g2, ['cat']); NOW = START - 5 * H;
  for (const b of [bet('a1', '502', 'KC', 'ml', 130, 80), bet('a2', '502', 'KC', 'sp', -110, 100, { line: 2.5 }), bet('a3', '502', 'Over', 'ou', -110, 100, { line: 47.5 }), bet('a4', '502', 'KC', 'ml', 130, 50)]) { NOW += 1000; const r = await add('cat', b); if (b.id === 'a4') personal(r, /Over the stake limit/); else assert.ok(r.s === 200 && r.j.gl > 0, JSON.stringify(r.j)); }
  v = await view('cat', g2, START + 2 * DAY); assert.deepStrictEqual(['a1', 'a2', 'a3'].map((k) => [v.by[k].ok, v.by[k].cs || 0]), [[true, 80], [true, 100], [true, 20]], '80 + 100 + 20 = $200 on the game; the 4th is over (Phase 1: told when added)'); assert.ok(!v.by.a4); assert.strictEqual(v.by.a3.capped, true);
  const g3 = await mk('ann'); await joinAll(g3, ['dan']); NOW = START - 5 * H; const gm = ['501', '502', '505', '506', '509'];
  for (let i = 0; i < 12; i++) { NOW += 1000; const r = await add('dan', i < 5 ? bet('w' + String(i).padStart(2, '0'), gm[i], GAMES.find((x) => x.id === gm[i]).home.abbr, 'ml', -110, 10) : i < 10 ? bet('w' + String(i).padStart(2, '0'), gm[i - 5], 'Over', 'ou', -110, 10, { line: { 502: 47.5, 505: 44.5, 506: 45, 509: 40 }[gm[i - 5]] || 40 }) : bet('w' + i, i === 10 ? '507' : '508', i === 10 ? 'LV' : 'LAR', 'ml', -110, 10)); if (gm[i - 5] === '501') assert.strictEqual(r.s, 409); else assert.strictEqual(r.s, 200, i + JSON.stringify(r.j)); if (i === 11) personal(r, /Over the weekly limit: only the first 10 bets/); } // Phase 1 (B2): the 11th is told so when added
  v = await view('dan', g3, START + 2 * DAY); assert.strictEqual(v.bets.filter((x) => x.ok).length, 10); assert.strictEqual(v.bets.filter((x) => !x.ok).length, 0);
});
// =============================== MEDIUM 9: hedges across markets and inside parlays ===============================
test('M9 a member cannot hold opposing sides of one game in a contest: moneyline against spread, a parlay leg against a single, over against under', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H; const A = async (w, b) => { NOW += 1000; const r = await add(w, b); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); if (['s2', 'pp', 's4', 'q2'].includes(b.id)) personal(r, /Hedge, not counted/); else assert.ok(r.j.gl > 0, b.id + ' saved'); }; // Phase 1 (B2): a hedge is told so when added and is not locked
  await A('bob', bet('s1', '502', 'BUF', 'ml', -150, 100)); await A('bob', bet('s2', '502', 'KC', 'sp', -110, 100, { line: 2.5 })); // KC +2.5 against BUF moneyline
  await A('bob', { id: 'pp', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140)] }); // a KC leg against BUF moneyline
  await A('bob', bet('s3', '502', 'Over', 'ou', -110, 100, { line: 47.5 })); await A('bob', bet('s4', '502', 'Under', 'ou', -110, 100, { line: 47.5 }));
  await A('bob', bet('s5', '502', 'BUF', 'sp', -110, 50, { line: -2.5 })); // same side as the first bet: fine
  await A('cat', { id: 'q1', kind: 'parlay', stake: 50, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140)] }); await A('cat', bet('q2', '509', 'NE', 'sp', -110, 50, { line: -3 })); // NE -3 against the parlay's MIA leg
  let v = await view('bob', g, START + 2 * DAY); assert.deepStrictEqual(['s1', 's2', 'pp', 's3', 's4', 's5'].map((k) => !!(v.by[k] && v.by[k].ok)), [true, false, false, true, false, true]); ['s2', 'pp', 's4'].forEach((k) => assert.ok(!v.by[k], 'the hedge is not in the contest'));
  assert.strictEqual(v.t.win, -100 + 90.91 - 50, 'BUF ML lost, Over won, BUF -2.5 lost; the winning KC bets were hedges');
  v = await view('cat', g, START + 2 * DAY); assert.ok(v.by.q1.ok && !v.by.q2);
});
// =============================== MEDIUM 10: the commissioner approves invite codes too ===============================
test('M10 an invite code makes a join REQUEST (owner rule): approval applies, a denied player cannot come back by code, only the commissioner sees the code, requests off = the code does not work', async () => {
  NOW = START - 3 * DAY; G._reset(); let r = await call('ann', 'create', { name: 'Approve Me', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, max: 8, late: 'no' }, contest: CDEF }); const g = r.j.group; assert.ok(g.code && g.link && g.link !== g.code, 'commissioner: code and the members\' link');
  r = await call('u005', 'join', { code: g.code }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.pending, true); assert.ok(!r.j.group.members, 'not a member yet');
  let gg = (await call('ann', 'get', { id: g.id })).j.group; assert.strictEqual(gg.members.length, 1); assert.strictEqual(gg.reqs.length, 1);
  r = await call('ann', 'decide', { id: g.id, pid: gg.reqs[0].pid, ok: false }); assert.strictEqual(r.s, 200); r = await call('u005', 'join', { code: g.code }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /said no/); r = await call('u005', 'join', { code: g.link }); assert.strictEqual(r.s, 409);
  r = await call('u006', 'join', { code: g.code }); gg = (await call('ann', 'get', { id: g.id })).j.group; r = await call('ann', 'decide', { id: g.id, pid: gg.reqs[0].pid, ok: true }); assert.strictEqual(r.j.group.members.length, 2);
  const m = (await call('u006', 'get', { id: g.id })).j.group; assert.strictEqual(m.role, 'member'); assert.ok(!m.code && !JSON.stringify(m).includes(g.code), 'a member never sees the commissioner\'s code'); assert.strictEqual(m.link, g.link);
  r = await call('u007', 'join', { code: m.link }); assert.strictEqual(r.j.pending, true, 'the link a member shares leads to a request');
  r = await call('ann', 'requests', { id: g.id, on: false }); assert.strictEqual(r.s, 200); r = await call('u008', 'join', { code: g.code }); assert.strictEqual(r.s, 409, 'requests off: the code does not work'); assert.match(r.j.error, /not taking new people/);
  r = await call('ann', 'edit', { id: g.id, name: 'Approve Me', join: { requests: false, open: false, auto: true, max: 8, late: 'no' } }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.group.join.auto, true);
  r = await call('u008', 'join', { code: g.code }); assert.strictEqual(r.s, 200); assert.ok(r.j.group.members, '"anyone with the link joins without approval" (set before the start): the commissioner\'s code joins straight away');
  r = await call('u009', 'join', { code: g.link }); assert.strictEqual(r.s, 409, 'the members\' link still needs requests to be open');
  NOW = START; r = await call('ann', 'edit', { id: g.id, name: 'Approve Me', join: { requests: true, open: false, auto: false, max: 8, late: 'no' } }); assert.strictEqual(r.s, 409, 'locked at the start');
});
// =============================== MEDIUM 11 / 12: postponed, moved and cancelled games ===============================
test('M11 a postponed game that moves to a new date is followed by its ESPN event id: void at 48 hours by default, graded on the new date with "carry to the new date"', async () => {
  const g = await mk('ann'); const gc = await mk('ann', { carry: true }); assert.strictEqual(gc.contests[0].rules.carry, true); NOW = START - 3 * DAY; await joinAll(g, ['bob']); await joinAll(gc, ['bob']); NOW = START - 6 * H;
  assert.strictEqual((await add('bob', bet('mv1', '508', 'SEA', 'ml', 140, 100))).s, 200); await view('bob', g, START - 5 * H); await view('bob', gc, START - 5 * H);
  let v = await view('bob', gc, START + 30 * H); assert.strictEqual(v.by.mv1.res, '', 'postponed, waiting');
  const m = GAMES.find((x) => x.id === '508'); m.start = START + 4 * DAY; m.off = ''; // ESPN moves the same event 4 days out; it leaves the old day's scoreboard
  v = await view('bob', g, START + 3 * DAY); assert.strictEqual(v.by.mv1.res, 'push'); assert.match(v.by.mv1.vr, /not played within 48 hours/);
  v = await view('bob', gc, START + 3 * DAY); assert.strictEqual(v.by.mv1.res, '', 'carry: still open, not void');
  v = await view('bob', gc, START + 6 * DAY); assert.strictEqual(v.by.mv1.res, 'won', 'played on the new date: SEA 21-20'); assert.strictEqual(v.by.mv1.pl, 140);
  v = await view('bob', g, START + 6 * DAY); assert.strictEqual(v.by.mv1.res, 'push', 'the default contest stays void');
  let r = await call('ann', 'create', { name: 'Late carry', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: CDEF }); NOW = START - 3 * DAY; G._reset();
  r = await call('ann', 'create', { name: 'Late carry', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: CDEF }); const lc = r.j.group; await joinAll(lc, ['cat']);
  r = await call('ann', 'contest/edit', { id: lc.id, cid: lc.contests[0].cid, contest: Object.assign({}, CDEF, { carry: true }) }); assert.strictEqual(r.s, 409, 'carry is a bet rule: locked once people joined');
});
test('M12 postponed / cancelled is checked BEFORE final: a cancelled game marked "completed" at 0-0 is void, never graded (Under 40 does not win)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H;
  assert.strictEqual((await add('bob', bet('pp2', '507', 'Under', 'ou', -110, 100, { line: 40 }))).s, 200); assert.strictEqual((await add('bob', bet('pp1', '508', 'SEA', 'ml', 140, 100))).s, 200);
  assert.strictEqual((await add('cat', bet('pp3', '507', 'DEN', 'sp', -110, 100, { line: 3 }))).s, 200);
  let v = await view('bob', g, START + 5 * H); assert.strictEqual(v.by.pp2.res, 'push'); assert.strictEqual(v.by.pp2.pl, 0); assert.match(v.by.pp2.vr, /cancelled/); assert.strictEqual(v.by.pp1.res, '', 'postponed with a 21-20 score on the board: not graded');
  v = await view('bob', g, START + 49 * H); assert.strictEqual(v.by.pp1.res, 'push'); assert.strictEqual(v.t.win, 0);
  v = await view('cat', g, START + 49 * H); assert.strictEqual(v.by.pp3.res, 'push'); assert.strictEqual(GR.legResult({ kind: 'ou', ovr: false, line: 40, kick: START, g: { start: START, off: true, canc: true, done: true, home: { score: 0 }, away: { score: 0 } } }), 'push');
});
// =============================== LOW ===============================
test('L1 the leftover cent of the main-pot split goes to the LARGEST pot (not to a $0-entry contest that happens to be first)', async () => {
  const contests = [0, 10, 5].map((e, i) => ({ cid: 'c' + i, kind: 'picks', pot: 'main', name: 'c' + i, rules: { entry: e, split: '100', take: { kind: 'none', v: 0 } } }));
  const P = G.pots({ members: Array.from({ length: 8 }, (_, i) => ({ pid: 'p' + i, paid: i < 7 })), money: { take: { kind: 'none', v: 0 }, msplit: { kind: 'entry', pct: { c0: 0, c1: 66.67, c2: 33.33 } } }, contests }).main;
  assert.deepStrictEqual(P.shares.map((s) => s.amt), [0, 70.01, 34.99]); assert.strictEqual(Math.round(P.shares.reduce((a, s) => a + s.amt * 100, 0)), 10500);
});
test('L2 a bet added after kickoff gets an honest answer (refused, nothing added), not "Saved to your group. Locked."', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START + 3 * H + 60e3; const r = await add('bob', bet('late1', '502', 'KC', 'ml', 130, 100));
  assert.strictEqual(r.s, 409); assert.match(r.j.error, /already started.*Nothing was added/); assert.ok(!/Saved/.test(JSON.stringify(r.j))); assert.strictEqual((await call('bob', 'bet/status', { id: 'late1' })).j.saved, false);
});
test('L3 a parlay that lost its first leg is not shown or scored early: nothing about it reaches the standings before its last game kicks off', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H;
  assert.strictEqual((await add('bob', { id: 'v4', kind: 'parlay', stake: 31, day: '2026-11-22', lg: 'nfl', legs: [leg('509', 'NE', 'ml', -160), leg('503', 'GB', 'ml', 140)] })).s, 200); // NE loses on Nov 22; GB plays Nov 29
  NOW = START + 1 * DAY; G._reset(); let st = await call('cat', 'standings', { id: g.id, cid: g.contests[0].cid }), row = st.j.rows.find((x) => x.name === 'BOBname');
  assert.deepStrictEqual([row.t.l, row.t.win, row.t.open], [0, 0, 1], 'still an open bet to everyone'); let p = await call('cat', 'player', { id: g.id, cid: g.contests[0].cid, pid: row.pid }); assert.deepStrictEqual(p.j.bets, []); assert.strictEqual(p.j.hidden, 1);
  NOW = START + 7 * DAY + 60e3; G._reset(); st = await call('cat', 'standings', { id: g.id, cid: g.contests[0].cid }); row = st.j.rows.find((x) => x.name === 'BOBname'); assert.deepStrictEqual([row.t.l, row.t.win], [1, -31], 'counted once the last game kicked off');
});
test('R-STATS a contest record carries spent (entry) and won (prize) only; the bets\' stake / pl / units sit under inner; a finished contest that paid nothing sends won: 0', async () => {
  const g = await mk('ann', { runs: 'weekend', minPaid: 0 }); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H; await add('bob', bet('v1', '502', 'BUF', 'ml', -150, 100)); await add('cat', bet('v2', '502', 'KC', 'ml', 130, 100));
  NOW = START + DAY; G._reset(); let r = (await G.statsFor(pe(SID.bob), {})).find((x) => x.groupId === g.id); assert.ok(r, 'record');
  assert.deepStrictEqual([r.pl, r.stake, r.units], [undefined, undefined, undefined], 'no bet money at the top level'); assert.deepStrictEqual(r.inner, { pl: -100, units: -1, stake: 100 }); assert.strictEqual(r.spent, 25); assert.ok(!('won' in r), 'still running');
  NOW = START + 9 * DAY; G._reset(); r = (await G.statsFor(pe(SID.bob), {})).find((x) => x.groupId === g.id); assert.strictEqual(r.won, 0, 'finished, paid nothing: won 0'); assert.strictEqual(r.result, 'L'); assert.deepStrictEqual([r.spent, r.extra.money.net], [25, -25]);
});
test('L4 memberStats no longer returns memberKey', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H; await add('bob', bet('v1', '502', 'KC', 'ml', 130, 100)); const pid = (await call('ann', 'get', { id: g.id })).j.group.members.find((m) => m.name === 'BOBname').pid;
  NOW = START + DAY; G._reset(); const ms = await G.memberStats(pe(SID.cat), g.id, pid); assert.ok(ms && ms.records.length === 1); assert.ok(!('memberKey' in ms) && !/memberKey/.test(JSON.stringify(ms)));
});
test('L6 players with no settled bet (0-0) rank below everyone who has one; place and prize money agree', async () => {
  const g = await mk('ann', { split: '60/30/10' }); await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 6 * H;
  await add('bob', bet('r1', '502', 'BUF', 'ml', -150, 100)); await add('cat', bet('r2', '502', 'KC', 'ml', 130, 100)); // bob -100, cat +130, ann and dan 0-0
  let gg = (await call('ann', 'get', { id: g.id })).j.group; for (const m of gg.members) await call('ann', 'paid', { id: g.id, pid: m.pid, paid: true });
  const v = await view('ann', g, START + 2 * DAY), rows = v.st.rows; assert.deepStrictEqual(rows.slice(0, 2).map((x) => x.name), ['CATname', 'BOBname'], 'bob (-$100, 0-1) is ahead of the two who never bet');
  assert.deepStrictEqual(rows.map((x) => x.place), [1, 2, 3, 3]); assert.deepStrictEqual(rows.map((x) => x.owed > 0), [true, true, false, false], 'money follows the places'); assert.deepStrictEqual(rows.map((x) => !!x.none), [false, false, true, true]);
});
test('L8 late joining cannot be switched on once anyone has joined or asked', async () => {
  NOW = START - 3 * DAY; G._reset(); let r = await call('ann', 'create', { name: 'No late', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, max: 8, late: 'no' }, contest: CDEF }); const g = r.j.group;
  r = await call('ann', 'edit', { id: g.id, name: 'No late', join: { requests: true, open: false, max: 8, late: '2w' } }); assert.strictEqual(r.s, 200, 'before anyone joined: allowed'); r = await call('ann', 'edit', { id: g.id, name: 'No late', join: { requests: true, open: false, max: 8, late: 'no' } });
  await call('u001', 'request', { id: g.id }); await call('u001', 'cancel', { id: g.id });
  r = await call('ann', 'edit', { id: g.id, name: 'No late', join: { requests: true, open: false, max: 8, late: '2w' } }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /Late joining is locked/);
});
test('L5 / L7 phone: a tied place label is not cut off at 430 px; a 30-character group name is warned about', async () => {
  PH.phoneCheck(() => { const c = client(); assert.ok(/\.g-place\{[^}]*min-width:\s*(4[4-9]|[5-9]\d)px/.test(c) && /\.g-place\.tie/.test(c), 'room for "T12"'); assert.ok(c.includes('Names are cut at 30 characters'), 'warning text'); });
});
// =============================== coordinator's list (complete review) ===============================
test('R-JOIN every invite type routes: signed-out Calcutta / golf / event links are no longer "coming soon"; an engine can add its title (registerInvite, wire)', async () => {
  for (const [t, kind] of [['c', 'Calcutta'], ['golf', 'golf game'], ['e', 'local event']]) { const r = await call(null, 'invite', { type: t, code: 'ABCD2345' }); assert.strictEqual(r.s, 200, t + ' ' + JSON.stringify(r.j)); assert.deepStrictEqual(r.j, { type: t, kind, title: '' }); }
  let r = await call(null, 'invite', { type: 'zz', code: 'ABCD2345' }); assert.strictEqual(r.s, 404);
  const done = G.wire({ calcutta: { potSummary: async () => ({ bids: 300, take: 30, pool: 270, main: true }), attachToGroup: async () => ({}), inviteInfo: async (code) => (code === 'CALC2345' ? { kind: 'Calcutta', title: 'Masters Calcutta' } : null) }, golf: null, events: null, stats: null });
  assert.deepStrictEqual(done, ['pot:calc', 'invite:c']); r = await call(null, 'invite', { type: 'c', code: 'CALC2345' }); assert.deepStrictEqual(r.j, { type: 'c', kind: 'Calcutta', title: 'Masters Calcutta' }); r = await call(null, 'invite', { type: 'c', code: 'NOPE2345' }); assert.strictEqual(r.s, 404);
  PH.phoneCheck((ph) => { const j = ph('pics/join.js'); assert.ok(/openGame/.test(j) && !/This game is coming soon to Oddable/.test(j), 'join.js routes every type through the registered handler'); });
});
test('R-CALC a Main Calcutta attached by the commissioner shows in the group\'s main pot; only that group\'s commissioner can attach; members are let in (memberCheck)', async () => {
  G.registerGame('calc', { potSummary: async (ref) => (ref === 'CALC-1' ? { bids: 300, take: 30, pool: 270, main: true } : null), attachToGroup: async () => ({}) });
  const g = await mk('ann'); await assert.rejects(() => G.attachGame(g.id, pe(SID.bob), { type: 'calc', ref: 'CALC-1', name: 'Masters', pot: 'main' }), /Only the commissioner/);
  assert.strictEqual(await G.canAttach(g.id, pe(SID.bob)), false, 'another engine asks this before tying a game to a group id'); assert.strictEqual(await G.canAttach(g.id, pe(SID.ann)), true); assert.strictEqual(await G.canAttach('ZZZZZZZZZZ', pe(SID.ann)), false);
  const a = await G.attachGame(g.id, pe(SID.ann), { type: 'calc', ref: 'CALC-1', name: 'Masters', pot: 'main' }); assert.strictEqual(a.pot, 'main'); await joinAll(g, ['bob']);
  const gg = (await call('bob', 'get', { id: g.id })).j.group; assert.strictEqual(gg.pots.main.games[0].pot, 300); assert.strictEqual(gg.pots.main.total, 300); const ext = gg.contests.find((c) => c.kind !== 'picks'); assert.deepStrictEqual([ext.type, ext.ref], ['calc', 'CALC-1'], 'a member gets the game\'s reference to open it');
  const mc = await G.memberCheck(g.id, pe(SID.bob)); assert.deepStrictEqual([mc.member, mc.comm], [true, false]); assert.strictEqual(await G.memberCheck(g.id, pe(SID.eve)), null); PH.phoneCheck(() => assert.ok(/openGame\(/.test(client()), 'the hub opens an attached game for members'));
});
test('R-CALC2 against the REAL Calcutta engine (a copy of calcutta-v1 calcutta.js when it is on this machine, else a stand-in with its contract): wired by wireGroups, a Main Calcutta in the main pot with unclaimed / carried, a refused attach rolls back and returns the refusal', async () => {
  const src = process.env.ODD_CALCUTTA || '/home/claude/calcutta-calc/odds-api/calcutta.js'; let C, real = false;
  if (fs.existsSync(src)) { const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oddcalc-')); fs.copyFileSync(src, path.join(dir, 'calcutta.js')); ['sync', 'acct', 'ip', 'limits'].forEach((m) => fs.writeFileSync(path.join(dir, m + '.js'), 'module.exports = require(' + JSON.stringify(R + m) + ');'));
    C = require(path.join(dir, 'calcutta.js')); C._deps.S = D.S; C._deps.acct = D.acct; C._deps.now = () => D.now(); C._deps.fetch = D.fetch; if (C._reset) C._reset(); real = typeof C.wireGroups === 'function'; }
  if (!real) { const st = {}; C = { wireGroups: (GG) => { GG.registerGame('calc', { potSummary: C.potSummary, attachToGroup: C.attachToGroup }); return true; }, potSummary: async (id) => (st[id] ? { bids: 0, take: 0, pool: 0, main: true, paidOut: 0, inPlay: 0, unclaimed: 0, carried: 0 } : null),
    createCalc: async (e) => { const id = 'C' + Object.keys(st).length; st[id] = { comm: e }; return { id }; }, attachToGroup: async (id, gid) => { if (!st[id]) throw Object.assign(new Error('Calcutta not found'), { status: 404 }); if (!(await G.canAttach(gid, st[id].comm))) throw Object.assign(new Error('Only the commissioner of that group can put this Calcutta in it'), { status: 403 }); if (st[id].g && st[id].g !== gid) throw Object.assign(new Error('This Calcutta is already in another group'), { status: 409 }); st[id].g = gid; return {}; },
    joinFromGroup: async (id, e) => { if (!(await G.memberCheck(st[id].g, e))) throw Object.assign(new Error('Join the group first'), { status: 403 }); return { id }; } }; }
  assert.deepStrictEqual(G.wire({ calcutta: C, golf: null, events: null, stats: null }), ['pot:calc']);
  const ga = await mk('ann'), gb = await mk('bob'); await joinAll(ga, ['cat']); NOW = START - 3 * DAY + 60e3;
  const team = (n) => ({ id: String(n), name: 'Team ' + n }), body = { name: 'Masters Calcutta', ev: 'nfl_po', lots: [1, 2, 7, 8].map((x) => ({ teams: [team(x)] })), rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 20, buyBack: false, main: true, take: { kind: 'none' }, order: 'listed', mode: 'live' };
  const calc = await C.createCalc(pe(SID.ann), body);
  // bob (commissioner of ANOTHER group) tries to pull ann's Calcutta into his group: the engine refuses, the group keeps nothing
  await assert.rejects(() => G.attachGame(gb.id, pe(SID.bob), { type: 'calc', ref: calc.id, name: 'Stolen', pot: 'main' }), (e) => e.status === 403 || e.status === 409, 'the refusal comes back');
  let g2 = (await call('bob', 'get', { id: gb.id })).j.group; assert.strictEqual(g2.contests.length, 1, 'rolled back: no dangling contest'); assert.deepStrictEqual(Object.keys(g2.money.msplit.pct), [g2.contests[0].cid]);
  await assert.rejects(() => G.attachGame(ga.id, pe(SID.ann), { type: 'calc', ref: 'NOPE99', name: 'Ghost', pot: 'main' }), (e) => e.status === 404); assert.strictEqual((await call('ann', 'get', { id: ga.id })).j.group.contests.length, 1);
  // a brand-new group of ann's (nobody else in yet) takes it as MAIN
  NOW = START - 3 * DAY; const gm = (await call('ann', 'create', { name: 'Masters week', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: CDEF })).j.group;
  const a = await G.attachGame(gm.id, pe(SID.ann), { type: 'calc', ref: calc.id, name: 'Masters Calcutta', pot: 'main' }); assert.strictEqual(a.pot, 'main'); await joinAll(gm, ['cat']);
  const gg = (await call('cat', 'get', { id: gm.id })).j.group, mg = gg.pots.main.games; assert.strictEqual(mg.length, 1, 'the Main Calcutta is listed in the main pot'); assert.deepStrictEqual([mg[0].type, mg[0].where, mg[0].pot, mg[0].unclaimed, mg[0].carried], ['calc', 'main', 0, 0, 0]); assert.ok('paidOut' in mg[0] && 'inPlay' in mg[0]);
  if (C.joinFromGroup) { const j = await C.joinFromGroup(calc.id, pe(SID.cat), 'Cat'); assert.ok(j && j.id === calc.id, 'a group member gets in'); await assert.rejects(() => C.joinFromGroup(calc.id, pe(SID.eve), 'Eve'), (e) => e.status === 403, 'a non-member does not'); }
  G.registerGame('calc', { potSummary: async () => ({ bids: 1000, take: 100, pool: 900, paidOut: 500, inPlay: 250, unclaimed: 100, carried: 50, main: true }) }); G._reset(); // the money fields a running Calcutta reports
  const m2 = (await call('cat', 'get', { id: gm.id })).j.group.pots.main; assert.deepStrictEqual([m2.games[0].pool, m2.games[0].unclaimed, m2.games[0].carried, m2.totalPool], [900, 100, 50, 900]); PH.phoneCheck(() => assert.ok(client().includes('waiting to roll') && client().includes('carried to the next Calcutta')));
  console.log('        (R-CALC2 ran against ' + (real ? 'the real calcutta.js: ' + src : 'the stand-in: no calcutta.js on this machine') + ')');
});
test('R-VOID the commissioner\'s void exists and only works under the void rules: a duplicate added within 2 minutes (later copy, before kickoff) or a postponed game; reason required, logged, shown to all', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H; const cid = g.contests[0].cid;
  await add('bob', bet('d1', '502', 'KC', 'ml', 130, 50)); NOW += 40e3; await add('bob', bet('d2', '502', 'KC', 'ml', 130, 50)); NOW += 10 * 60e3; await add('bob', bet('d3', '502', 'KC', 'ml', 130, 50)); await add('bob', bet('pz', '508', 'SEA', 'ml', 140, 100)); await add('bob', bet('ok1', '509', 'MIA', 'ml', 140, 100));
  const pid = (await call('ann', 'get', { id: g.id })).j.group.members.find((m) => m.name === 'BOBname').pid; G._reset();
  let r = await call('ann', 'bet/voidable', { id: g.id }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.deepStrictEqual(r.j.list.map((x) => [x.bid, x.kind]).sort(), [['d2', 'duplicate'], ['pz', 'postponed']], 'only the later copy inside 2 minutes (not d1, not d3); the bet on the postponed game'); assert.ok(!r.j.list.some((x) => /KC|SEA|ML/.test(x.text)), 'the picks themselves stay hidden before kickoff');
  assert.strictEqual((await call('bob', 'bet/void', { id: g.id, pid, bid: 'd2', kind: 'duplicate', reason: 'Entered twice by mistake' })).s, 403, 'commissioner only'); assert.strictEqual((await call('ann', 'bet/void', { id: g.id, pid, bid: 'd2', kind: 'duplicate', reason: '' })).s, 400, 'a reason is required');
  for (const [bid, kind] of [['d1', 'duplicate'], ['d3', 'duplicate'], ['ok1', 'duplicate'], ['ok1', 'postponed'], ['ok1', 'other']]) assert.ok([400, 409].includes((await call('ann', 'bet/void', { id: g.id, pid, bid, kind, reason: 'Because I say so' })).s), bid + ' ' + kind + ' is outside the void rules');
  r = await call('ann', 'bet/void', { id: g.id, pid, bid: 'd2', kind: 'duplicate', reason: 'Bob tapped Add twice' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  const cg = (await call('cat', 'get', { id: g.id })).j.group; assert.deepStrictEqual(cg.voids.map((x) => [x.name, x.kind, x.reason]), [['BOBname', 'duplicate', 'Bob tapped Add twice']], 'every member sees who, why and when');
  NOW = START + 5 * H; G._reset(); r = await call('ann', 'bet/voidable', { id: g.id }); assert.ok(r.j.list.some((x) => x.bid === 'pz' && x.kind === 'postponed')); r = await call('ann', 'bet/void', { id: g.id, pid, bid: 'pz', kind: 'postponed', reason: 'Game postponed, snow' }); assert.strictEqual(r.s, 200);
  NOW = START + DAY; G._reset(); const p = await call('cat', 'player', { id: g.id, cid, pid }), by = Object.fromEntries(p.j.bets.map((b) => [b.id, b]));
  assert.deepStrictEqual([by.d2.res, by.d2.pl, by.d2.voided], ['push', 0, true]); assert.match(by.d2.vr, /Voided by the commissioner \(entered twice by mistake\): Bob tapped Add twice/); assert.match(by.pz.vr, /Voided by the commissioner \(game postponed or cancelled\): Game postponed, snow/); assert.strictEqual(by.d1.pl, 65);
  assert.match(G.LOCKED_MSG, /duplicate added by mistake within 2 minutes/); PH.phoneCheck(() => assert.ok(/bet\/void/.test(client()), 'the commissioner has the screen for it'));
});
test('R-HCP Suggest partners in a group uses the handicap / rating the stats module keeps (pairingProfile, else handicapFor / ratingFor)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat', 'dan']); const H2 = { ann: 4.2, bob: 12.4, cat: 18, dan: 27.5 }, who = (e) => Object.keys(H2).find((w) => pe(SID[w]) === e);
  D.stats = () => ({ handicapFor: async (e) => ({ oddable: { index: H2[who(e)] }, use: H2[who(e)] }), ratingFor: async (e) => ({ oddable: { rating: 1500 + 10 * H2[who(e)] } }) });
  let r = await call('ann', 'partners', { id: g.id, sport: 'golf' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.known, 4, 'all four have an Oddable index'); assert.ok(r.j.players.every((p) => p.has)); assert.doesNotMatch(r.j.suggestions[0].reason, /No handicaps or ratings/); assert.match(r.j.suggestions[0].reason, /handicap/);
  assert.deepStrictEqual(r.j.suggestions[0].teams.map((t) => t.strength).sort(), [15.2, 15.9], 'ann + dan (15.9) against bob + cat (15.2)');
  r = await call('ann', 'partners', { id: g.id, sport: 'pickleball' }); assert.strictEqual(r.j.known, 4); assert.match(r.j.suggestions[0].reason, /rating/);
  D.stats = () => ({ pairingProfile: async (e, sport) => ({ sport, show: false, use: sport === 'golf' ? H2[who(e)] + 1 : 1600 }) }); r = await call('ann', 'partners', { id: g.id, sport: 'golf' }); assert.strictEqual(r.j.known, 4, 'stats v1.1 pairingProfile: use'); assert.deepStrictEqual(r.j.suggestions[0].teams.map((t) => t.strength).sort(), [16.2, 16.9]); D.stats = () => null;
});
test('R-USE limits.recordPlay(accountKey, gameType, gameId, playerKey): ONE usage call for every game type; the owner sees games and players per month for billing', async () => {
  assert.strictEqual(typeof LIM.recordPlay, 'function'); const ak = LIM.keyOf(pe(SID.ann));
  assert.strictEqual(await LIM.recordPlay(ak, 'golf', 'golf:G1', 'p1'), false, 'standard account: nothing recorded');
  let r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true }); assert.strictEqual(r.s, 200); LIM._reset();
  for (const p of ['p1', 'p2', 'p3', 'p1', 'p2']) await LIM.recordPlay(ak, 'golf', 'golf:G1', p, 'Member-Guest'); await LIM.recordPlay(ak, 'calcutta', 'calc:C9', ['a', 'b', 'c', 'd'], 'Masters Calcutta'); await LIM.recordPlay(ak, 'event', 'e:E1', 'x1', 'Pickleball ladder');
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); await view('ann', g, START + DAY); await new Promise((x) => setTimeout(x, 30));
  r = await call('owner', 'ent/admin', { op: 'list' }); const u = r.j.enterprise.find((x) => x.key === ak).use[0], by = Object.fromEntries(u.list.map((x) => [x.type, x.players]));
  assert.deepStrictEqual(by, { golf: 3, calcutta: 4, event: 1, picks: 3 }); assert.strictEqual(u.games, 4); assert.strictEqual(u.playerGames, 11, '11 player-games this month');
  assert.ok(!JSON.stringify(r.j).includes('p1"') && !JSON.stringify(X.db['lock:entuse']).includes('"p1"'), 'player ids are hashed');
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', () => { P = srv.address().port; r(); }));
  const only = process.argv[2]; let fail = 0, n = 0; const err = console.error; console.error = () => {};
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue; n++; fresh(); try { await fn(); console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 16).join('\n        ')); } }
  console.error = err; srv.close();
  console.log(fail ? '\n' + fail + ' OF ' + n + ' ROUND-3 CHECKS FAILED' : '\nALL ' + n + ' ROUND-3 CHECKS PASSED'); process.exit(fail ? 1 : 0);
})();
