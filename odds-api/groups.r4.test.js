// Run: node odds-api/groups.r4.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
// ROUND 4 (Nov 16 2026): one check or more per item of the round-3 review (/tmp/revgroups4-report.md) and of the manager's rule that replaced "even money
// with no reference". Every check here FAILS on 1e47e93 (v254 round 3) and passes now. To see that:
//   ODD_ROOT=/path/to/a/1e47e93/checkout node odds-api/groups.r4.test.js     (expect every line FAIL)
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const ROOT = process.env.ODD_ROOT ? path.resolve(process.env.ODD_ROOT) : path.join(__dirname, '..'), R = path.join(ROOT, 'odds-api') + '/';
const G = require(R + 'groups'), GR = require(R + 'grade'), PAIR = require(R + 'pairing'), LIM = require(R + 'limits'), D = G._deps;
const X = { db: {}, BOARD: 'ok', SUMMARY: 'ok', NOTICK: false };
D.S = {
  dbGet: async (id) => { await new Promise((r) => setImmediate(r)); return X.db[id] ? JSON.parse(JSON.stringify(X.db[id])) : null; },
  dbPut: async (row, ign) => { if (X.db[row.id] && ign) return; X.db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!X.db[id] || X.db[id].updated !== Number(was)) return false; X.db[id].data = JSON.parse(JSON.stringify(data)); X.db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(X.db).filter((k) => !k.startsWith('lock:')),
};
const WHO = []; for (let i = 0; i < 130; i++) WHO.push('u' + String(i).padStart(3, '0')); ['ann', 'bob', 'cat', 'dan', 'eve'].forEach((w) => WHO.push(w));
const SID = {}, NAMES = {}; WHO.forEach((w, i) => { SID[w] = (i.toString(16).padStart(4, '0').repeat(2) + '0'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', MKOF = (w) => crypto.createHash('sha256').update('oddable-group|' + pe(SID[w])).digest('hex').slice(0, 24);
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; }, phoneEmail: pe, isOwnerPhone: () => false, ownerOk: (req) => String(req.headers['x-token']) === 't-owner', namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1'); D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Z = (s) => Date.parse(s), H = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z');
const T = (abbr, name) => ({ abbr, name, short: name.split(' ').pop(), loc: name.split(' ').slice(0, -1).join(' ') });
const O = (details, ou, aml, hml, x) => Object.assign({ details, overUnder: ou, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: aml, spreadOdds: -110 }, homeTeamOdds: { moneyLine: hml, spreadOdds: -110 } }, x || {});
let GAMES = []; const PATH = { nfl: 'football/nfl', nhl: 'hockey/nhl', mlb: 'baseball/mlb', nba: 'basketball/nba', ncaaf: 'football/college-football', ncaab: 'basketball/mens-college-basketball' };
const BASE = () => [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 20, hs: 24 }, // nothing posted on ESPN
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: O('BUF -2.5', 47.5, 130, -150) },
  { id: '503', start: START + 7 * DAY, away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21, odds: O('CHI -3', 41, 140, -160) },
  { id: '505', start: START, away: T('WAS', 'Washington Commanders'), home: T('PHI', 'Philadelphia Eagles'), as: 10, hs: 31, odds: { details: 'PHI -7.5', overUnder: 44.5 } }, // a line, no prices
  { id: '506', start: START, away: T('ARI', 'Arizona Cardinals'), home: T('SF', 'San Francisco 49ers'), as: 13, hs: 30, odds: O('SF -9.5', 45, 380, -500) },
  { id: '507', start: START, away: T('DEN', 'Denver Broncos'), home: T('LV', 'Las Vegas Raiders'), as: 0, hs: 0, odds: O('LV -3', 40, 140, -160), sname: (now) => (now >= START - H ? 'STATUS_CANCELED' : 'STATUS_SCHEDULED'), state: (now) => (now < START ? 'pre' : 'post'), completed: false },
  { id: '508', start: START, away: T('SEA', 'Seattle Seahawks'), home: T('LAR', 'Los Angeles Rams'), as: 0, hs: 0, odds: O('LAR -3', 40, 140, -160), sname: (now) => (now >= START - H ? 'STATUS_POSTPONED' : 'STATUS_SCHEDULED'), state: (now) => (now < START ? 'pre' : 'post'), completed: false },
  { id: '509', start: START + 2 * H, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 17, hs: 10, odds: O('NE -3', 40, 140, -160) },
  { id: '901', lg: 'nhl', start: START, away: T('TOR', 'Toronto Maple Leafs'), home: T('BOS', 'Boston Bruins'), as: 2, hs: 3, odds: O('BOS -1.5', 6, 140, -165) },
  { id: '701', lg: 'nba', start: START + 4 * DAY, away: T('WSH', 'Washington Wizards'), home: T('BOS', 'Boston Celtics'), as: 95, hs: 125, odds: O('BOS -15.5', 224.5, 900, -1600) },
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, ''), startOf = (g, now) => (typeof g.startAt === 'function' ? g.startAt(now) : g.start);
const evOf = (g, now) => { const s0 = startOf(g, now), st = g.state ? g.state(now) : now < s0 ? 'pre' : now < s0 + 3.5 * H ? 'in' : 'post', nm = typeof g.sname === 'function' ? g.sname(now) : st === 'post' ? 'STATUS_FINAL' : st === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED';
  const tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc }), od = typeof g.odds === 'function' ? g.odds(now) : g.odds, sc = (v) => (st === 'pre' ? '0' : String(v));
  const status = { type: { state: st, completed: g.completed != null ? g.completed : st === 'post', name: nm } };
  return { id: g.id, date: new Date(s0).toISOString(), status, competitions: [{ date: new Date(s0).toISOString(), status, odds: od ? [od] : undefined, competitors: [{ homeAway: 'home', score: sc(g.hs), team: tm(g.home) }, { homeAway: 'away', score: sc(g.as), team: tm(g.away) }] }] }; };
D.fetch = async (u) => { // ESPN as the server sees it: the scoreboard by league and day, and the event lookup (summary?event=) with real HTTP statuses
  const now = D.now(), sm = /sports\/([a-z-]+\/[a-z-]+)\/summary\?event=(\w+)/.exec(u);
  if (sm) { if (X.SUMMARY === 'down') return { ok: false, status: 503, json: async () => ({}) }; const g = GAMES.find((x) => PATH[x.lg || 'nfl'] === sm[1] && x.id === sm[2]); if (!g) return { ok: false, status: 404, json: async () => ({}) }; const ev = evOf(g, now); return { ok: true, status: 200, json: async () => ({ header: { id: ev.id, competitions: ev.competitions } }) }; }
  if (X.BOARD === 'down') return { ok: false, status: 503, json: async () => ({}) };
  const m = /sports\/([a-z-]+\/[a-z-]+)\/scoreboard\?dates=(\d{8})/.exec(u);
  return { ok: true, status: 200, json: async () => ({ events: !m ? [] : GAMES.filter((g) => PATH[g.lg || 'nfl'] === m[1] && ymd(startOf(g, now)) === m[2]).map((g) => evOf(g, now)) }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
const fresh = () => { X.db = {}; WHO.forEach((w) => { X.db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); GAMES = BASE(); X.BOARD = X.SUMMARY = 'ok'; X.NOTICK = false; G._reset(); if (LIM._reset) LIM._reset(); NOW = START - 3 * DAY; };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } }); let P;
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || ('9.9.' + (WHO.indexOf(who) >> 8) + '.' + (WHO.indexOf(who) & 255)) }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json() }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - 2 * DAY, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 4, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
const mk = async (who, c, join, name) => { NOW = START - 3 * DAY; G._reset(); const r = await call(who, 'create', { name: name || 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, auto: true, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); } };
// The server as it runs live: a tick 5 minutes before every kickoff on the way to `to` (X.NOTICK = the server was down the whole time).
const kickTicks = async (to) => { if (X.NOTICK) return; const ts = [...new Set(GAMES.map((g) => startOf(g, NOW) - 5 * 6e4))].filter((t) => t > NOW && t <= to).sort((a, b) => a - b); for (const t of ts) { NOW = t; await G.tick({ force: true }); } };
const view = async (w, g, at, as) => { if (at != null) { await kickTicks(at); NOW = at; } G._reset(); const cid = g.contests[0].cid, st = await call(as || w, 'standings', { id: g.id, cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(as || w, 'player', { id: g.id, cid, pid: me.pid }); return { row: me, bets: p.j.bets, hidden: p.j.hidden, t: p.j.t, by: Object.fromEntries((p.j.bets || []).map((b) => [b.id, b])) }; };
const gm = (gid) => GAMES.find((x) => x.id === gid);
const bet = (id, gid, side, type, odds, stake, o) => { const g = gm(gid); return Object.assign({ id, gid, lg: g.lg || 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake }, o || {}); };
const leg = (gid, side, type, o, line) => { const g = gm(gid); return { gid, side, type, o, line, lg: g.lg || 'nfl', home: g.home.abbr, away: g.away.abbr, day: GR.chiDay(g.start) }; };
const add = (w, b) => call(w, 'bet/add', { bet: b });
const book = (w) => { const r = X.db['lock:gb:' + MKOF(w)]; return (r && r.data && r.data.b) || {}; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8'), client = () => read('pics/groups.js');
const NOREF = 'No posted price at kickoff — this bet did not count';
const tests = []; const test = (name, fn) => tests.push([name, fn]);

// =============================== 1. CRITICAL: the unmatched-game trick ===============================
test('1 CRITICAL a leg that does not match a known game is REFUSED when added ("Can\'t find this game"): no lg, wrong day, football-looking codes, any league; it is never graded at even money', async () => {
  const g = await mk('ann', { sport: 'all' }); await joinAll(g, ['bob', 'cat']); NOW = START - 2 * DAY + H; const wrong = GR.chiDay(START - DAY);
  const tries = [{ gid: '701', home: 'NE', away: 'KC', day: wrong }, { gid: '701', lg: 'nba', home: 'BOS', away: 'WSH', day: wrong }, { gid: '701', lg: 'nfl', home: 'BOS', away: 'WSH', day: GR.chiDay(gm('701').start) }, { gid: '701', home: 'ZZZ', away: 'YYY', day: GR.chiDay(gm('701').start) }, { gid: '999999', lg: 'nba', home: 'BOS', away: 'WSH', day: GR.chiDay(gm('701').start) }];
  for (const [i, t] of tries.entries()) { const r = await add('bob', Object.assign({ id: 'w' + i, side: 'BOS', type: 'ml', odds: 100, stake: 100 }, t)); assert.strictEqual(r.s, 409, i + ' ' + JSON.stringify(r.j)); assert.strictEqual(r.j.error, "Can't find this game — it can't count in your group. Nothing was added.", 'try ' + i); }
  assert.deepStrictEqual(Object.keys(book('bob')), [], 'nothing was written');
  assert.strictEqual((await add('cat', bet('h1', '701', 'BOS', 'ml', 100, 100))).s, 200, 'the honest bet on the same game is fine');
  const v = await view('bob', g, gm('701').start + 7 * H); assert.deepStrictEqual(v.bets, []); assert.strictEqual(v.t.win, 0);
  assert.strictEqual((await view('cat', g, gm('701').start + 7 * H)).by.h1.pl, 6.25, 'BOS -1600: +$6.25 on $100, never +$100');
});
test('1 CRITICAL when ESPN cannot be read the add is refused ("Couldn\'t check this game — try again"), never accepted blind; the same bet goes in once ESPN answers', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 2 * DAY + H; const b = bet('e1', '506', 'SF', 'ml', 100, 100);
  X.BOARD = 'down'; X.SUMMARY = 'down'; let r = await add('bob', b); assert.strictEqual(r.s, 409, JSON.stringify(r.j)); assert.strictEqual(r.j.error, "Couldn't check this game — try again. Nothing was added.");
  X.BOARD = 'ok'; G._reset(); r = await add('bob', Object.assign({}, b, { id: 'e2', day: GR.chiDay(START + 5 * DAY) })); assert.strictEqual(r.s, 409, 'event lookup down + a day the game is not on'); assert.match(r.j.error, /Couldn't check this game|Can't find this game/);
  assert.deepStrictEqual(Object.keys(book('bob')), []);
  X.SUMMARY = 'ok'; G._reset(); r = await add('bob', b); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.ok(book('bob').e1.r['g506|SF|ml||nfl'].gid === '506', 'matched to the real game');
  assert.strictEqual((await view('bob', g, START + 2 * DAY)).by.e1.pl, 20, 'SF -500: +$20, not +$100');
});
test('1 `follow` asks ESPN for the event in EVERY league the contest allows (not the first two), and a leg first matched after kickoff never counts', async () => {
  const r = await GR.resolveLeg({ gid: '901', side: 'BOS', type: 'ml' }, GR.LGS, { budget: 60 }, GR.chiDay(START - 4 * DAY)); assert.ok(!r.x && r.lg === 'nhl' && r.gid === '901', 'an NHL event found by its id: ' + JSON.stringify(r.x || r.lg));
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 2 * DAY + H;
  X.db['lock:gb:' + MKOF('bob')] = { id: 'lock:gb:' + MKOF('bob'), salt: 'x', pinhash: 'x', data: { b: { z1: { s: bet('z1', '502', 'KC', 'ml', 130, 100), at: NOW } } }, updated: NOW }; // in the book with NO game match from the add step
  const v = await view('bob', g, START + 2 * DAY); assert.ok(v.by.z1 && !v.by.z1.ok, JSON.stringify(v.by.z1)); assert.match(v.by.z1.why, /Not matched to a game when it was added/); assert.strictEqual(v.t.win, 0);
});
// =============================== 2. HIGH: no reference at kickoff = void ===============================
test('2 HIGH no posted price at kickoff: the bet is VOID and does not count, moneylines included (no +100); it is refused when nothing is posted at add time', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); const K = gm('502').start; gm('502').odds = (now) => (now < K - 2 * H ? O('BUF -2.5', 47.5, 130, -150) : undefined); // ESPN takes the odds down two hours before kickoff
  NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('n1', '502', 'KC', 'ml', 130, 100))).s, 200); assert.strictEqual((await add('cat', bet('n2', '502', 'KC', 'sp', -110, 100, { line: 2.5 }))).s, 200);
  let r = await add('bob', bet('n3', '501', 'NYG', 'ml', 100, 100)); assert.strictEqual(r.s, 409); assert.match(r.j.error, /^No posted price for this game yet — it can't count in your group/);
  r = await add('bob', bet('n4', '505', 'PHI', 'ml', 100, 100)); assert.strictEqual(r.s, 409, 'a spread line but no moneyline price is not a moneyline reference'); assert.match(r.j.error, /^No posted price/);
  for (const [w, id] of [['bob', 'n1'], ['cat', 'n2']]) { const v = await view(w, g, START + 2 * DAY), b = v.by[id]; assert.ok(b, 'listed'); assert.deepStrictEqual([b.res, b.pl || 0, b.ok, b.nr, b.voided], ['push', 0, false, true, true], JSON.stringify(b)); assert.strictEqual(b.vr, NOREF); assert.strictEqual(b.why, NOREF);
    assert.deepStrictEqual([v.t.win, v.t.n, v.t.stake, v.t.w, v.t.p], [0, 0, 0, 0, 0], 'stake back: nothing in the standings'); }
  assert.strictEqual(GR.NOREF, NOREF); assert.strictEqual(GR.legPrice({ kind: 'ml', side: 'home', kick: K, rd: -300 }, 5, 500).v, NOREF, 'the price-from-the-spread path is gone'); assert.ok(GR.refOk({ kind: 'ml', side: 'home', kick: K, rp: -150, ra: K - 10 * 6e4 }) && !GR.refOk({ kind: 'ml', side: 'home', kick: K, rp: -150, ra: K - 40 * 6e4 }) && !GR.refOk({ kind: 'sp', side: 'home', line: -3, kick: K, rp: -110, ra: K - 6e4 }));
});
test('2 HIGH a parlay with a leg that has no posted price at its kickoff is void as a whole (it used to pay the other legs)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); const K = gm('502').start; gm('502').odds = (now) => (now < K - 2 * H ? O('BUF -2.5', 47.5, 130, -150) : undefined);
  NOW = START - 6 * H; assert.strictEqual((await add('bob', { id: 'p1', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140), leg('506', 'SF', 'ml', -500)] })).s, 200);
  const v = await view('bob', g, START + 2 * DAY), b = v.by.p1; assert.deepStrictEqual([b.res, b.ok, b.nr], ['push', false, true], JSON.stringify(b)); assert.match(b.vr, /^No posted price at kickoff on one leg — this parlay did not count/); assert.strictEqual(v.t.win, 0);
});
// =============================== 3. HIGH: the commissioner's void ===============================
test('3 HIGH the commissioner cannot void during play: not in a weather delay, not because the start time moved; only a cancelled game or an explicitly postponed one that has not been played', async () => {
  const g = await mk('ann', { sport: 'all' }); await joinAll(g, ['bob']); NOW = START - 2 * DAY + H;
  for (const [w, b] of [['ann', bet('va', '509', 'NE', 'ml', -160, 100)], ['bob', bet('vb', '509', 'MIA', 'ml', 140, 100)], ['bob', bet('vp', '508', 'SEA', 'ml', 140, 50)], ['bob', bet('vc', '507', 'DEN', 'ml', 140, 50)], ['ann', bet('vm', '502', 'BUF', 'ml', -150, 100)]]) assert.strictEqual((await add(w, b)).s, 200, b.id);
  const g9 = gm('509'), K = g9.start; g9.state = (now) => (now < K ? 'pre' : now < K + 5 * H ? 'in' : 'post'); g9.sname = (now) => (now < K ? 'STATUS_SCHEDULED' : now >= K + 2 * H && now < K + 3 * H ? 'STATUS_DELAYED' : now < K + 5 * H ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL');
  const g2 = gm('502'), K2 = g2.start; let moved = false; g2.startAt = () => (moved ? K2 + 15 * H : K2);
  await kickTicks(START - 30 * 6e4); NOW = START - 30 * 6e4; G._reset(); let r = await call('ann', 'bet/voidable', { id: g.id });
  assert.deepStrictEqual(r.j.list.map((x) => [x.bid, x.kind]).sort(), [['vp', 'postponed']], 'before kickoff: only the explicitly postponed game (the cancelled one is already void by itself)');
  await kickTicks(K + 2.5 * H); NOW = K + 2.5 * H; G._reset(); r = await call('ann', 'bet/voidable', { id: g.id }); assert.ok(!r.j.list.some((x) => x.bid === 'va' || x.bid === 'vb'), 'third quarter, lightning delay: ' + JSON.stringify(r.j.list.map((x) => x.bid)));
  const pid = (w) => r.j && null; const mem = (await call('ann', 'get', { id: g.id })).j.group.members, P = (n) => mem.find((m) => m.name === n).pid;
  for (const [n, bid] of [['ANNname', 'va'], ['BOBname', 'vb']]) { const x = await call('ann', 'bet/void', { id: g.id, pid: P(n), bid, kind: 'postponed', reason: 'weather' }); assert.strictEqual(x.s, 409, bid); assert.match(x.j.error, /cannot be voided/); }
  moved = true; G._reset(); NOW = K2 + 15 * H + 3 * H; r = await call('ann', 'bet/voidable', { id: g.id }); assert.ok(!r.j.list.some((x) => x.bid === 'vm'), 'a game whose time moved 15 hours, now in its 4th quarter');
  assert.strictEqual((await call('ann', 'bet/void', { id: g.id, pid: P('ANNname'), bid: 'vm', kind: 'postponed', reason: 'time moved' })).s, 409);
  const vb = (await view('bob', g, K + 2 * DAY)).by.vb; assert.deepStrictEqual([vb.res, vb.pl, !!vb.voided], ['won', 140, false], 'the winning bet stands');
  assert.match(String(G.voidable) + (r.j.rules || ''), /Never while a game is being played/);
});
// =============================== 4. the kickoff time is followed until the real kickoff ===============================
test('4 a placeholder kickoff time: the bet follows ESPN\'s time until the game really starts; other members cannot see it before the REAL kickoff, and adds close then', async () => {
  const g = await mk('ann', { sport: 'all' }); await joinAll(g, ['bob', 'cat']); NOW = START - 2 * DAY + H;
  const g2 = gm('502'), real = g2.start, tbd = G.chiStart(GR.chiDay(real)) + 1000; let fixed = false; g2.startAt = () => (fixed ? real : tbd); g2.state = (now) => (now < real ? 'pre' : now < real + 3.5 * H ? 'in' : 'post');
  assert.strictEqual((await add('bob', bet('tb', '502', 'KC', 'ml', 130, 100))).s, 200, 'added while ESPN showed the placeholder');
  fixed = true; G._reset(); NOW = tbd - H; await G.tick({ force: true }); // ESPN posts the real time; the server's next tick sees it
  NOW = real - 2 * H; G._reset(); let v = await view('bob', g, null, 'ann'); assert.deepStrictEqual([v.bets.length, v.hidden], [0, 1], '2 hours before the real kickoff (13 hours after the placeholder) bob\'s pick is still hidden');
  assert.strictEqual((await add('cat', bet('tc', '502', 'BUF', 'ml', -150, 100))).s, 200, 'adds are still open');
  const kick = Object.values(X.db).filter((x) => x.id.startsWith('lock:gl:')).map((x) => Object.values(x.data.b).map((p) => Object.values(p).map((e) => Object.values(e.r)[0].kick))).flat(2); assert.ok(kick.length && kick.every((k) => k === real), 'the stored kickoff is the real one: ' + kick);
  NOW = real + 60e3; G._reset(); const late = await add('cat', bet('td', '502', 'BUF', 'sp', -110, 10, { line: -2.5 })); assert.strictEqual(late.s, 409); assert.match(late.j.error, /already started/);
  NOW = real - 6 * 6e4; G._reset(); v = await view('bob', g, real + 2 * DAY); assert.deepStrictEqual([v.by.tb.res, v.by.tb.pl], ['won', 130], 'priced at the reference of the REAL kickoff');
});
// =============================== 5. the reference does not depend on a tick; every running group is ticked ===============================
test('5 the kickoff reference is settled from the stored read time when the bet is graded: a price last read hours before kickoff (no tick ran) is NOT used; a read inside the last 30 minutes is, tick or no tick', async () => {
  const g = await mk('ann'), gc = await mk('ann'); NOW = START - 3 * DAY; await joinAll(g, ['bob']); await joinAll(gc, ['cat']); const K = gm('509').start; gm('509').odds = (now) => (now < K - 3 * H ? O('NE -3', 40, 380, -500) : O('NE -3', 40, 140, -160)); // MIA +380 early, +140 from 3 hours out
  X.NOTICK = true; // the server never ticks
  NOW = K - 6 * H; assert.strictEqual((await add('bob', bet('s1', '509', 'MIA', 'ml', 380, 100))).s, 200);
  NOW = K - 20 * 6e4; assert.strictEqual((await add('cat', bet('s2', '509', 'MIA', 'ml', 380, 100))).s, 200);
  let v = await view('bob', g, K + 2 * DAY); assert.deepStrictEqual([v.by.s1.res, v.by.s1.ok, v.by.s1.vr], ['push', false, NOREF], 'read 6 hours before kickoff and never again: no reference at kickoff, void (it used to pay +$380)');
  v = await view('cat', gc, K + 2 * DAY); assert.deepStrictEqual([v.by.s2.res, v.by.s2.pl], ['won', 140], 'added 20 minutes before kickoff: that read IS the kickoff reference, with no tick at all');
  const e = Object.values(Object.values(X.db).find((x) => x.id.startsWith('lock:gl:' + gc.id)).data.b).map((p) => Object.values(p)).flat().map((x) => Object.values(x.r)[0]); assert.ok(e.every((x) => x.ra > 0 && x.ra < K), 'the read time is stored with the price');
  fresh(); const g2 = await mk('ann'); await joinAll(g2, ['bob']); gm('509').odds = (now) => (now < K - 3 * H ? O('NE -3', 40, 380, -500) : O('NE -3', 40, 140, -160));
  NOW = K - 6 * H; assert.strictEqual((await add('bob', bet('s3', '509', 'MIA', 'ml', 380, 100))).s, 200); v = await view('bob', g2, K + 2 * DAY); assert.deepStrictEqual([v.by.s3.res, v.by.s3.pl], ['won', 140], 'with the server ticking: the price at kickoff');
});
test('5 the server tick reads EVERY running group (it stopped at 300)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('t1', '502', 'KC', 'ml', 130, 10))).s, 200);
  const row = X.db['lock:grp:' + g.id], idx = X.db['lock:gidx'], A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ids = [];
  for (let i = 0; i < 330; i++) { const id = 'ZZZZZZZ' + A[(i >> 10) & 31] + A[(i >> 5) & 31] + A[i & 31]; ids.push(id); const d = JSON.parse(JSON.stringify(row.data)); d.id = id; X.db['lock:grp:' + id] = { id: 'lock:grp:' + id, salt: 'x', pinhash: 'x', data: d, updated: 1 }; idx.data.g[id] = JSON.parse(JSON.stringify(idx.data.g[g.id])); }
  NOW = START - 2 * H; G._reset(); const tk = await G.tick({ force: true }); const cid = g.contests[0].cid, seen = ids.filter((id) => X.db['lock:gl:' + id + ':' + cid]).length;
  assert.strictEqual(seen, 330, 'ledgers written for ' + seen + ' of 330 extra groups; tick said ' + JSON.stringify(tk));
});
// =============================== 6. messages ===============================
test('6 "Saved to your group." is said only for a bet that counts as entered; a bet that cannot count is refused with the reason; a bet that counts in one contest and not another says where it does not', async () => {
  const g = await mk('ann', {}, {}, 'Sunday Crew'); const g2 = await mk('ann', { legs: 2, cname: 'Two leggers', types: { sp: false, ml: true, ou: true, prop: false, parlay: true } }, {}, 'Strict'); NOW = START - 3 * DAY; await joinAll(g, ['bob', 'cat']); await joinAll(g2, ['bob']); NOW = START - 6 * H;
  let r = await add('cat', bet('m0', '502', 'KC', 'ml', 130, 20)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.ok(!r.j.skips);
  const no = async (b, re) => { const x = await add('cat', b); assert.strictEqual(x.s, 409, b.id + ' ' + JSON.stringify(x.j)); assert.match(x.j.error, re); assert.match(x.j.error, /Nothing was added\.$/); assert.ok(!book('cat')[b.id], b.id + ' not stored'); };
  await no({ id: 'm1', kind: 'parlay', stake: 10, day: '2026-11-22', lg: 'nfl', legs: [leg('507', 'LV', 'ml', -160), leg('508', 'LAR', 'ml', -160), leg('506', 'SF', 'ml', -500), leg('509', 'MIA', 'ml', 140), leg('503', 'GB', 'ml', 140)] }, /can't count in Picks: More than 4 legs/);
  await no(bet('m2', '502', 'BUF', 'sp', -110, 20, { line: -2.5 }), /can't count in Picks: Hedge, not counted/);
  await no(bet('m3', '509', 'MIA', 'ou', -110, 20, { line: 40 }), /Total with no over\/under or no number/);
  await no(bet('m4', '509', 'Over', 'ou', -110, 20, { line: 0 }), /Total with no over\/under or no number|Bad line/);
  r = await add('bob', { id: 'm5', kind: 'parlay', stake: 10, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140), leg('506', 'SF', 'ml', -500)] });
  assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.deepStrictEqual(r.j.skips, [{ group: 'Strict', contest: 'Two leggers', why: 'More than 2 legs' }]); assert.deepStrictEqual(r.j.counts, ['Sunday Crew · Picks']);
  r = await add('bob', bet('m6', '502', 'KC', 'sp', -110, 20, { line: 2.5 })); assert.strictEqual(r.s, 200); assert.deepStrictEqual(r.j.skips.map((x) => x.why), ['This kind of bet does not count here']);
  assert.ok(/skipNote|does not count in/.test(client()), 'the phone shows where a saved bet does not count');
});
test('6 the on-screen rules match the real rules (no "+10 cents", no "even money", no "synced after"; a readable "Longest odds" line) and a bet shows what it was graded as', async () => {
  const cs = client(); for (const bad of ['10 cents', 'even money', 'first synced after', 'when Oddable has no market price']) assert.ok(!cs.includes(bad), 'gone: ' + bad);
  assert.ok(cs.includes('No posted price at kickoff: the bet is void and does not count') && cs.includes("'. A bet at longer odds is graded as +'") && cs.includes('Oddable knows the game, and a price was posted for it at kickoff'));
  const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H;
  let r = await add('bob', bet('g1', '502', 'KC', 'SP', -110, 100, { line: 60.5 })); assert.strictEqual(r.s, 400, 'only ml / sp / ou, written one way'); assert.match(r.j.error, /Unknown kind of bet/);
  r = await add('bob', bet('g2', '502', 'KC', 'ml', 400, 100, { line: 60.5 })); assert.strictEqual(r.s, 200); assert.strictEqual(book('bob').g2.s.line, 0, 'a moneyline carries no line');
  const b = (await view('bob', g, START + 2 * DAY)).by.g2; assert.strictEqual(b.what, 'KC ML (KC@BUF)'); assert.match(b.as, /^Moneyline at \+130/); assert.strictEqual(b.pl, 130); assert.ok(/Graded as: /.test(cs));
});
// =============================== 7. LOW items ===============================
test('7 L1 Suggest partners names no outside handicap or rating body: only "Calculated with the World Handicap System method."', async () => {
  const cs = client(); assert.ok(!/USGA|GHIN|DUPR/.test(cs), 'no USGA / GHIN / DUPR on the screen'); assert.ok(cs.includes('Calculated with the World Handicap System method.'));
});
test('7 L2 Groups screens follow the app theme: text on the brand buttons, gold text and win / loss text are theme variables (4.5:1 in navy, violet dark and violet light; measured by the Playwright walk)', async () => {
  const cs = client(); assert.match(cs, /body\.dark #ogrp[^{]*\{--gvt:var\(--onblue,#14102a\)/, 'dark text on the lilac buttons of violet dark'); assert.match(cs, /#oglock \.gpri\{[^}]*color:var\(--gvt\)/); assert.match(cs, /--gyt:var\(--gold,#7a5200\)/, 'dark gold text on the light theme');
  assert.ok(!/opacity:\.5[05]?\}/.test(cs.replace(/#ogrp \.gsw:disabled\{opacity:\.5\}/, '')) && !/gno\{opacity/.test(cs), 'text is never faded below 4.5:1 with opacity');
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }, cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  [['#14102a', '#a78bfa'], ['#ffffff', '#7c3aed'], ['#ffffff', '#003594'], ['#7a5200', '#ffffff'], ['#7a5200', '#f6f4fb'], ['#0e6f43', '#ffffff'], ['#b3261e', '#ffffff'], ['#0e6f43', '#f6f4fb'], ['#b3261e', '#f6f4fb']].forEach(([f, b]) => assert.ok(cr(f, b) >= 4.5, f + ' on ' + b + ' = ' + cr(f, b).toFixed(2)));
});
test('7 L3 the hub and Create show a game type only when a handler is registered, and then it is wired to the real create flow (groups.registerGame types calcutta, golf, events; OddJoin.registerGame on the phone); nothing says "Coming soon"', async () => {
  const cs = client(); assert.ok(!/Coming soon/i.test(cs.replace(/\/\/.*$/gm, '')), 'no "Coming soon" on any Groups screen'); assert.ok(/canStart/.test(cs) && /game\/add/.test(cs));
  const made = []; const stand = (t, withCreate) => G.registerGame(t, Object.assign({ potSummary: async () => ({ bids: 0, take: 0, pool: 0 }), attachToGroup: async () => ({}) }, withCreate ? { create: async (o) => { made.push([t, o.groupId, o.accountId, o.pot]); return { ref: t.toUpperCase() + '-1', name: 'New ' + t }; } } : {}));
  stand('calcutta', true); stand('golf', false); stand('events', true);
  const g = await mk('ann'); await joinAll(g, ['bob']); let r = await call('ann', 'get', { id: g.id });
  assert.deepStrictEqual(r.j.group.games, [{ type: 'calc', name: 'Calcutta', create: true }, { type: 'golf', name: 'golf contest', create: false }, { type: 'event', name: 'local event', create: true }]);
  assert.strictEqual((await call('bob', 'game/add', { id: g.id, type: 'calcutta' })).s, 403, 'commissioner only'); assert.strictEqual((await call('ann', 'game/add', { id: g.id, type: 'golf' })).s, 409, 'no create handler: started from its own screen'); assert.strictEqual((await call('ann', 'game/add', { id: g.id, type: 'chess' })).s, 404);
  r = await call('ann', 'game/add', { id: g.id, type: 'calcutta' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.deepStrictEqual([r.j.type, r.j.ref], ['calc', 'CALCUTTA-1']); assert.deepStrictEqual(made, [['calcutta', g.id, pe(SID.ann), 'side']]);
  const c = r.j.group.contests.find((x) => x.kind === 'ext'); assert.deepStrictEqual([c.type, c.ref, c.name], ['calc', 'CALCUTTA-1', 'New calcutta']);
  // the phone side of the contract (pics/join.js): openGame(type, ref, { groupId, create: true })
  const win = { location: { href: 'https://x/' }, history: { replaceState() {} }, document: { getElementById: () => null }, setTimeout: () => 0 }, st = {}; const box = { window: win, location: win.location, history: win.history, document: win.document, setTimeout: win.setTimeout, URL, navigator: {}, sessionStorage: { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; } }, localStorage: { getItem: () => null } };
  vm.runInNewContext(read('pics/join.js'), box); const J = win.OddJoin, got = [];
  J.register('c', (code) => got.push(['invite', code])); assert.strictEqual(J.canCreate('calc'), false, 'an invite handler is not a create flow'); assert.strictEqual(J.openGame('calc', '', { groupId: 'G1', create: true }), false); assert.deepStrictEqual(got, [], 'the invite handler is never called with an empty code');
  assert.strictEqual(J.registerGame('calcutta', { open: (ref, ctx) => got.push(['open', ref, ctx.groupId]), create: (ctx) => got.push(['create', ctx.groupId, ctx.create]) }), true); assert.strictEqual(J.canCreate('calc'), true); assert.strictEqual(J.canCreate('golf'), false);
  assert.strictEqual(J.openGame('calc', '', { groupId: 'G1', create: true }), true); assert.strictEqual(J.openGame('calc', 'REF9', { groupId: 'G1', cid: 'C1' }), true); assert.deepStrictEqual(got, [['create', 'G1', true], ['open', 'REF9', 'G1']]);
});
test('7 L4 Suggest partners stops inside 200 ms under load (every evaluation of a split 0.02 ms slower than the clock allows for): it used to run the whole scoring pass first', async () => {
  const real = Date.now; let t = 1e12; Date.now = () => t; const players = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, hcp: 2 + i * 1.7 })); let calls = 0, out;
  try { out = PAIR.suggestPartners(players, { mode: 'balanced', teamSize: 2, sport: 'golf', top: 3, teamHcp: (v) => { calls++; t += 0.02; return v.reduce((a, x) => a + x, 0) / v.length; } }); } finally { Date.now = real; }
  const took = t - 1e12; assert.ok(took <= 200, 'took ' + took.toFixed(1) + ' ms of load-clock time (' + calls + ' evaluations)'); assert.ok(out.length >= 1 && out[0].teams.length === 6, 'still answers with a full split'); assert.strictEqual(out.quick, true, 'and says it was a fast search');
  const t0 = Date.now(); const big = PAIR.suggestPartners(Array.from({ length: 144 }, (_, i) => ({ id: 'q' + i, name: 'Q' + i, rating: 1200 + (i * 37) % 600 })), { mode: 'balanced', teamSize: 2, sport: 'pickleball' }); assert.ok(big.length >= 1); assert.ok(Date.now() - t0 < 1500, 'sanity on the real clock');
});
test('7 L5 limits.recordPlay bills a player once per GAME, not once per month (a season-long contest was counted again every month)', async () => {
  const ak = LIM.keyOf(pe(SID.ann)); let r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true }); assert.strictEqual(r.s, 200); LIM._reset();
  NOW = Z('2026-11-20T12:00:00Z'); await LIM.recordPlay(ak, 'golf', 'golf:SEASON', ['p1', 'p2'], 'Season pool'); NOW = Z('2026-12-05T12:00:00Z'); await LIM.recordPlay(ak, 'golf', 'golf:SEASON', ['p1', 'p2', 'p3'], 'Season pool'); NOW = Z('2027-01-05T12:00:00Z'); await LIM.recordPlay(ak, 'golf', 'golf:SEASON', ['p1', 'p2', 'p3']);
  r = await call('owner', 'ent/admin', { op: 'list' }); const use = r.j.enterprise.find((x) => x.key === ak).use, by = Object.fromEntries(use.map((u) => [u.month, u.playerGames]));
  assert.deepStrictEqual(by, { '2026-11': 2, '2026-12': 1 }, 'p1 and p2 in November, p3 (who joined later) in December, nobody twice: ' + JSON.stringify(by)); assert.strictEqual(use.reduce((a, u) => a + u.playerGames, 0), 3, '3 players x $20, once');
});
test('7 L6 more than 100 people can be waiting to join: the limit is 1,000 and the commissioner pages through them', async () => {
  NOW = START - 3 * DAY; G._reset(); const g = (await call('ann', 'create', { name: 'Club night', take: { kind: 'none', v: 0 }, join: { requests: true, open: true, max: 8, late: 'no' }, contest: CDEF })).j.group;
  for (let i = 0; i < 130; i++) { const r = await call('u' + String(i).padStart(3, '0'), 'request', { id: g.id }); assert.strictEqual(r.s, 200, 'person ' + (i + 1) + ': ' + JSON.stringify(r.j)); }
  const full = (await call('ann', 'get', { id: g.id })).j.group; assert.strictEqual(full.reqCount, 130); assert.strictEqual(full.reqs.length, 50, 'the first page');
  let r = await call('ann', 'reqs', { id: g.id, from: 50 }); assert.deepStrictEqual([r.s, r.j.list.length, r.j.total, r.j.next], [200, 50, 130, 100]); r = await call('ann', 'reqs', { id: g.id, from: 100 }); assert.deepStrictEqual([r.j.list.length, r.j.next], [30, null]);
  assert.strictEqual((await call('u001', 'reqs', { id: g.id, from: 0 })).s, 404, 'a person who only asked sees no list'); assert.ok(/morereqs/.test(client()), 'the members screen has "Show more requests"');
});
test('7 L7 the service worker cache name changes with the build (the app label stays v254)', async () => {
  const sw = read('pics/sw.js'), m = /const C='([^']+)'/.exec(sw); assert.ok(m && /^pics-v254-[a-z0-9]+$/.test(m[1]), 'cache name: ' + (m && m[1])); assert.ok(read('pics/index.html').includes('<!-- Pics v254 -->'));
});
// =============================== 8. owner wording: "lock" is for the weekly model picks only ===============================
test('8 Groups screens say "final", not "lock": "Bets are final when you add them", "Rules are final once someone joins"', async () => {
  const cs = client().replace(/^\s*\/\/.*$/gm, ''), ix = read('pics/index.html');
  for (const good of ['Bets are final when you add them', 'Rules are final once someone joins', 'Final when added', 'Rules are final']) assert.ok(cs.includes(good), 'says: ' + good);
  const shown = (cs.match(/'(?:[^'\\]|\\.)*'/g) || []).filter((s) => /\s/.test(s) && !/^'[#.\w ,>:=()"-]*'$/.test(s) && !/[{};]/.test(s) && !/\.locked/.test(s)); // the words people read (not class names, not the stylesheet)
  const bad = shown.filter((s) => /\block(s|ed)?\b|🔒/i.test(s)); assert.deepStrictEqual(bad, [], 'still says lock: ' + bad.slice(0, 3).join(' | '));
  for (const s of ['lock it', 'locked when added', 'Group bets lock', 'My Bets, locked']) assert.ok(!ix.includes(s), 'index.html no longer says: ' + s);
  assert.ok(!/\block(s|ed)?\b/i.test(G.LOCKED_MSG), G.LOCKED_MSG); const g = await mk('ann'); await joinAll(g, ['bob']); NOW = START - 6 * H; const r = await add('bob', bet('f1', '502', 'KC', 'ml', 130, 10)); assert.strictEqual(r.j.text, 'Saved to your group.'); assert.strictEqual(r.j.note, 'Bets are final when you add them.');
  const e = await call('ann', 'contest/edit', { id: g.id, cid: g.contests[0].cid, contest: Object.assign({}, CDEF, { entry: 50 }) }); assert.strictEqual(e.s, 409); assert.match(e.j.error, /^Rules are final\./);
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', () => { P = srv.address().port; r(); }));
  const only = process.argv[2]; let fail = 0, n = 0; const err = console.error; console.error = () => {};
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue; n++; fresh(); try { await fn(); console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 14).join('\n        ')); } }
  console.error = err; srv.close();
  console.log(fail ? '\n' + fail + ' OF ' + n + ' ROUND-4 CHECKS FAILED' : '\nALL ' + n + ' ROUND-4 CHECKS PASSED'); process.exit(fail ? 1 : 0);
})();
