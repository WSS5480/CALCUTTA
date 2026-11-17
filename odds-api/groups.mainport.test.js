// Run: node odds-api/groups.mainport.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
// MAIN-LINE PORT (Nov 17 2026): the decisions made when the round-4/5 Groups rules were ported onto main (HANDOFF "Groups rules on main (from the
// feature session)"): honor-system props only in free contests (even money, game + add time on the card, a LOSS after 72 hours unless voided by the
// commissioner + one member) and the head-to-head fixes (no re-rolled draw, a week settles 72 hours after its last game, a late joiner ranks last).
const PH = require('./groups.testenv'); // main-line port: Groups switches set to "open"; phone-file checks run only against the feature branch's phone file (ODD_PREVIEW_ROOT)
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
  if (sm) { X.sumCalls = (X.sumCalls || 0) + 1; if (X.SUMMARY === 'down') return { ok: false, status: 503, json: async () => ({}) }; const g = GAMES.find((x) => PATH[x.lg || 'nfl'] === sm[1] && x.id === sm[2]); if (!g) return { ok: false, status: 404, json: async () => ({}) }; const ev = evOf(g, now); return { ok: true, status: 200, json: async () => Object.assign({ header: { id: ev.id, competitions: ev.competitions } }, X.PC && X.PC[g.id] ? { pickcenter: [X.PC[g.id]] } : {}) }; } // fix 2: ESPN's pregame lines on the event (pickcenter)
  if (X.BOARD === 'down') return { ok: false, status: 503, json: async () => ({}) };
  const m = /sports\/([a-z-]+\/[a-z-]+)\/scoreboard\?dates=(\d{8})/.exec(u);
  return { ok: true, status: 200, json: async () => ({ events: !m ? [] : GAMES.filter((g) => PATH[g.lg || 'nfl'] === m[1] && ymd(startOf(g, now)) === m[2]).map((g) => evOf(g, now)) }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
const fresh = () => { X.db = {}; WHO.forEach((w) => { X.db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); GAMES = BASE(); X.BOARD = X.SUMMARY = 'ok'; X.NOTICK = false; X.PC = {}; X.sumCalls = 0; G._reset(); if (LIM._reset) LIM._reset(); NOW = START - 3 * DAY; };
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
const read = (f) => (/^pics\//.test(f) ? PH.phone(f) : fs.readFileSync(path.join(ROOT, f), 'utf8')), client = () => read('pics/groups.js'); // main-line port: phone files come from PH (only inside PH.phoneCheck)
const NOREF = 'No posted price at kickoff — this bet did not count';
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const MIN = 6e4, K509 = START + 2 * H, CHECK = "Couldn't check this game — try again. Nothing was added.";
const tickAt = async (t) => { NOW = t; await G.tick({ force: true }); };
const refOfBook = (w, id) => Object.values(book(w)[id].r)[0];
const rowsOf = async (w, g) => (await call(w, 'standings', { id: g.id, cid: g.contests[0].cid })).j;
const prop = (id, gid, text, odds, stake) => { const g = gm(gid); return { id, kind: 'prop', text, pp: { gid }, lg: g.lg || 'nfl', odds, stake, day: GR.chiDay(g.start) }; };
const HTEXT = 'Honor system: props are priced at even money at most and settled by the commissioner and one other member. Use only with people you trust.';

// =============================== HONOR SYSTEM: free contests only ===============================
test('HONOR 1 honor-system props are not available in a contest with an entry fee or any money shown: refused at create, refused when a main-pot entry is added beside it, and a prop in such a contest is answered as a personal bet', async () => {
  NOW = START - 3 * DAY; G._reset();
  let r = await call('ann', 'create', { name: 'Paid honor', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: Object.assign({}, CDEF, { honor: true, entry: 25 }) });
  assert.strictEqual(r.s, 400, JSON.stringify(r.j)); assert.match(r.j.error, /honor system is only for contests with no entry fee or prize money/);
  const g = await mk('ann', { honor: true, entry: 0 }); NOW = START - 3 * DAY;
  r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, CDEF, { cname: 'Money', entry: 10, honor: false }) }); assert.strictEqual(r.s, 400, 'a main-pot entry would put money beside the honor contest: ' + JSON.stringify(r.j)); assert.match(r.j.error, /no entry fee or prize money/);
  r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, CDEF, { cname: 'Side', entry: 10, honor: true, pot: 'side' }) }); assert.strictEqual(r.s, 400, 'a side pot with an entry cannot be honor either');
  r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, CDEF, { cname: 'Side money', entry: 10, honor: false, pot: 'side' }) }); assert.strictEqual(r.s, 200, 'a side pot WITH money but no honor is fine: ' + JSON.stringify(r.j));
  const st = await rowsOf('ann', g); assert.strictEqual(st.contest.honorText, HTEXT);
  // the rule is read at use, too: a contest stored with honor + money (made before this rule) does not take props and is not labelled honor
  const row = X.db['lock:grp:' + g.id]; row.data.contests[0].rules.entry = 5; await joinAll(g, ['bob']); NOW = START - 6 * H;
  r = await add('bob', prop('p1', '502', 'Mahomes 2+ TDs', 100, 10)); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.personal, true, JSON.stringify(r.j)); assert.match(r.j.why, /Honor-system props do not count in a contest with an entry fee or prize money/);
  assert.deepStrictEqual(Object.keys(book('bob')), []); const st2 = await rowsOf('ann', g); assert.strictEqual(st2.contest.honorText, ''); assert.match(st2.contest.honorOff, /entry fee or prize money/);
});
test('HONOR 2 the prop card shows the game it is tied to and when it was added; the price is capped at even money', async () => {
  const g = await mk('ann', { honor: true, entry: 0 }); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H; const added = NOW;
  assert.strictEqual((await add('bob', prop('p1', '502', 'Mahomes 2+ TDs', 500, 20))).s, 200); NOW = gm('502').start + 5 * H; await view('bob', g, NOW);
  const l = (await call('cat', 'prop/list', { id: g.id })).j.list; assert.strictEqual(l.length, 1); const p = l[0];
  assert.deepStrictEqual([p.game, p.gameId, p.kick, p.added, p.pays], ['KC @ BUF', 'nfl|502', gm('502').start, added, 20], 'typed +500 on $20 pays $20 (even money)');
  assert.strictEqual(p.due, gm('502').start + 4 * H + 72 * H);
});
test('HONOR 3 a prop with no confirmed result 72 hours after its game settles as a LOSS; an entered but unconfirmed "won" does not save it; after that nobody can change it', async () => {
  const g = await mk('ann', { honor: true, entry: 0 }); await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 6 * H; const K = gm('502').start;
  assert.strictEqual((await add('bob', prop('p1', '502', 'Allen 3+ TDs', 100, 30))).s, 200); assert.strictEqual((await add('cat', prop('p2', '502', 'Kelce 100+ yds', 100, 40))).s, 200);
  let v = await view('bob', g, K + 5 * H); const pid = v.row.pid; assert.strictEqual(v.by.p1.res, ''); assert.strictEqual(v.t.win, 0);
  assert.strictEqual((await call('ann', 'prop/result', { id: g.id, pid, bid: 'p1', res: 'won' })).s, 200); // entered, never confirmed
  v = await view('bob', g, K + 4 * H + 72 * H - 60e3); assert.strictEqual(v.by.p1.res, '', 'one minute before the deadline: still open');
  v = await view('bob', g, K + 4 * H + 72 * H + 60e3); assert.deepStrictEqual([v.by.p1.res, v.by.p1.pl, v.t.win], ['lost', -30, -30], 'unconfirmed = a LOSS after 72 hours');
  const vc = await view('cat', g); assert.deepStrictEqual([vc.by.p2.res, vc.by.p2.pl], ['lost', -40], 'nothing entered at all = a LOSS too');
  let r = await call('dan', 'prop/confirm', { id: g.id, pid, bid: 'p1', res: 'won' }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /settled as a loss/);
  r = await call('ann', 'prop/result', { id: g.id, pid: vc.row.pid, bid: 'p2', res: 'void' }); assert.strictEqual(r.s, 409);
  const l = (await call('ann', 'prop/list', { id: g.id })).j.list; assert.ok(l.every((x) => x.auto && x.fin && x.res === 'lost' && !x.canEnter && !x.canConfirm), JSON.stringify(l));
});
test('HONOR 4 the commissioner + one other member can mark a prop VOID before the deadline: stake back, no weekly slot; the bettor cannot be the second', async () => {
  const g = await mk('ann', { honor: true, entry: 0, maxBets: 5 }); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H; const K = gm('502').start;
  assert.strictEqual((await add('bob', prop('p1', '502', 'Allen 3+ TDs', 100, 30))).s, 200); NOW += 60e3; assert.strictEqual((await add('bob', bet('b1', '509', 'MIA', 'ml', 140, 10))).s, 200);
  let v = await view('bob', g, K + 5 * H); const pid = v.row.pid;
  let r = await call('ann', 'prop/result', { id: g.id, pid, bid: 'p1', res: 'void' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  assert.strictEqual((await call('bob', 'prop/confirm', { id: g.id, pid, bid: 'p1', res: 'void' })).s, 403, 'the bettor cannot confirm');
  r = await call('cat', 'prop/confirm', { id: g.id, pid, bid: 'p1', res: 'void' }); assert.strictEqual(r.j.fin, true);
  v = await view('bob', g, K + 100 * H); assert.deepStrictEqual([v.by.p1.res, v.by.p1.pl, !!v.by.p1.voided], ['push', 0, true], 'void: stake back, and the deadline does not turn it into a loss');
  assert.strictEqual(v.t.win, 14, 'only the MIA bet counts (+140 on $10)');
});

// =============================== HEAD-TO-HEAD ===============================
test('H2H 1 one open bet no longer holds a week forever: the matchup is decided 72 hours after the week\'s last game, the open bet counting as no result', async () => {
  const c = { rules: { minBets: 0 }, startDay: '2026-11-17', endDay: '2026-11-30', start: Z('2026-11-17T06:00:00Z') };
  const kick = Z('2026-11-23T01:00:00Z'), mb = { a: [{ ok: true, d: '2026-11-22', res: 'won', pl: 50, kick, last: kick }], b: [{ ok: true, d: '2026-11-22', res: '', pl: 0, kick, last: kick }, { ok: true, d: '2026-11-22', res: 'lost', pl: -10, kick, last: kick }] };
  let T = G.h2hWeeks(c, { weeks: [[['a', 'b']], [['a', 'b']]] }, mb, Z('2026-11-25T12:00:00Z')); assert.strictEqual(T.weeks[0][0].done, false, 'the week is over but b has an open bet: wait');
  T = G.h2hWeeks(c, { weeks: [[['a', 'b']], [['a', 'b']]] }, mb, Z('2026-11-28T12:00:00Z')); assert.deepStrictEqual([T.weeks[0][0].done, T.weeks[0][0].win, T.weeks[0][0].B.net], [true, 'a', -10], '72 hours after the week (its last game) the open bet is no result: a +50 beats b -10');
});
test('H2H 2 a late joiner gets no matchups, is ranked below every member who played, and is paid no place or weekly prize this season', async () => {
  const g = await mk('ann', { fmt: 'h2h', cap: 100, entry: 10, split: '50/30/20' }, { late: '2w' }); await joinAll(g, ['bob', 'cat', 'dan']); const cid = g.contests[0].cid;
  for (const w of ['ann', 'bob', 'cat', 'dan']) await call('ann', 'paid', { id: g.id, pid: (await rowsOf('ann', g)).rows.find((x) => x.name === w.toUpperCase() + 'name').pid, paid: true });
  NOW = START - 6 * H; let st = (await call('ann', 'standings', { id: g.id, cid, scope: 'week', week: 1 })).j; assert.strictEqual(st.matchups.length, 2);
  const who = (pid) => WHO.find((w) => st.rows.find((x) => x.pid === pid).name === w.toUpperCase() + 'name'), [m1, m2] = st.matchups, A = who(m1.a.pid), B = who(m1.b.pid), C = who(m2.a.pid), Dn = who(m2.b.pid);
  for (const [w, b] of [[A, bet('w1', '509', 'NE', 'ml', -160, 10)], [B, bet('l1', '509', 'MIA', 'ml', 140, 10)], [C, bet('l2', '506', 'ARI', 'ml', 380, 10)], [Dn, bet('w2', '506', 'SF', 'ml', -500, 10)]]) assert.strictEqual((await add(w, b)).s, 200);
  const r0 = await call('eve', 'join', { code: g.code }); assert.strictEqual(r0.s, 200, 'late joining is open for two weeks: ' + JSON.stringify(r0.j));
  await call('ann', 'paid', { id: g.id, pid: (await rowsOf('ann', g)).rows.find((x) => x.name === 'EVEname').pid, paid: true });
  NOW = START - 5 * H; assert.strictEqual((await add('eve', bet('e1', '502', 'KC', 'ml', 130, 100))).s, 200, 'his bet counts for his own total');
  await kickTicks(Z('2026-11-24T07:00:00Z')); NOW = Z('2026-11-24T07:00:00Z'); G._reset(); st = (await call('ann', 'standings', { id: g.id, cid })).j;
  const eve = st.rows.find((x) => x.name === 'EVEname'); assert.strictEqual(eve.t.win, 130, 'EVE is up $130, more than anyone'); assert.strictEqual(eve.late, true);
  assert.ok(st.rows.filter((x) => x !== eve).every((x) => x.place < eve.place), 'ranked below every member who played: ' + JSON.stringify(st.rows.map((x) => [x.name, x.place])));
  assert.strictEqual(eve.owed, 0, 'no place money and no weekly prize for EVE');
  const owedSum = Math.round(st.rows.reduce((a, x) => a + x.owed, 0) * 100); assert.ok(owedSum <= 5000, 'never more than the pool: ' + owedSum);
});
test('H2H 3 the weekly prize of a week with an open bet is paid 72 hours after its last game (not held forever); money adds up to the cent', async () => {
  const g = await mk('ann', { cap: 100, entry: 20, split: '100', weekly: 20, runs: 'w4', carry: true }) /* carry: a postponed game stays open until it is played */; await joinAll(g, ['bob', 'cat', 'dan', 'eve']); const cid = g.contests[0].cid;
  for (const w of ['ann', 'bob', 'cat', 'dan', 'eve']) await call('ann', 'paid', { id: g.id, pid: (await rowsOf('ann', g)).rows.find((x) => x.name === w.toUpperCase() + 'name').pid, paid: true });
  NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('b1', '509', 'MIA', 'ml', 140, 50))).s, 200); assert.strictEqual((await add('cat', bet('c1', '508', 'LAR', 'ml', -160, 50))).s, 200); // 508 is postponed: open
  const at = async (t) => { await kickTicks(t); NOW = t; G._reset(); return (await call('ann', 'standings', { id: g.id, cid })).j; };
  let st = await at(Z('2026-11-25T12:00:00Z')); const w1 = (s) => s.high.find((h) => h.week === 1);
  assert.ok(st.rows.find((x) => x.name === 'CATname').t.open > 0, 'CAT\'s bet is still open'); assert.ok(!w1(st) || !w1(st).done, 'week 1 waits while the bet is open: ' + JSON.stringify(st.high));
  st = await at(Z('2026-11-29T12:00:00Z')); assert.ok(w1(st) && w1(st).done, 'paid 72 hours after the week, open bet or not: ' + JSON.stringify(st.high));
  const bob = st.rows.find((x) => x.name === 'BOBname'); assert.ok(bob.owedWk > 0, 'BOB had the week\'s high score');
  const pool = 100, owed = Math.round(st.rows.reduce((a, x) => a + x.owed, 0) * 100); assert.ok(owed <= pool * 100 && st.rows.every((x) => Math.round(x.owed * 100) === x.owed * 100), 'to the cent, never more than the pool');
});
// =============================== REVIEW OF 342da87: fix 1 (personal, not refused) and fix 2 (server asleep through the kickoff window) ===============================
test('FIX 1 no posted price yet, inside the last 2 minutes, or after ESPN shows the game started: main\'s personal answer with a plain sentence (kept on the phone, never in the group); ESPN unreadable stays 503', async () => {
  const g = await mk('ann', { entry: 0 }); await joinAll(g, ['bob']); NOW = START - 6 * H;
  let r = await add('bob', bet('n1', '501', 'NYG', 'ml', -110, 10)); assert.strictEqual(r.s, 200); assert.deepStrictEqual([r.j.personal, r.j.gl, r.j.text], [true, 0, "No price is posted for this game yet, so it can't count in your group. Saved as a personal bet."]);
  r = await add('bob', { id: 'np', kind: 'parlay', stake: 10, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('501', 'NYG', 'ml', -110)] }); assert.strictEqual(r.j.personal, true, 'a parlay with a no-price leg too: ' + JSON.stringify(r.j));
  NOW = gm('509').start - 60e3; r = await add('bob', bet('c1', '509', 'MIA', 'ml', 140, 10)); assert.deepStrictEqual([r.s, r.j.personal, r.j.text], [200, true, 'Group bets close 2 minutes before kickoff. Saved as a personal bet.']);
  NOW = gm('509').start + 10 * 60e3; r = await add('bob', bet('s1', '509', 'MIA', 'ml', 140, 10)); assert.deepStrictEqual([r.s, r.j.personal, r.j.text], [200, true, "This game has already started, so it can't count in your group. Saved as a personal bet."]);
  assert.deepStrictEqual(Object.keys(book('bob')), [], 'nothing went into the group book'); assert.ok(!X.db[SID.bob].data.bets.length, 'and nothing was written to My Bets by the server');
  NOW = START - 50 * 60e3; G._reset(); X.BOARD = 'down'; X.SUMMARY = 'down'; r = await add('bob', bet('d1', '502', 'KC', 'ml', 130, 10)); assert.strictEqual(r.s, 503, JSON.stringify(r.j)); assert.match(r.j.error, /Couldn't check this game — try again\. Nothing was added\./);
});
test('FIX 2 the server slept through the 30 minutes before kickoff: at grading the kickoff reference comes from ESPN\'s pregame lines on the event (one call per game, kept); none posted there either = void; ESPN not answering = graded on a later pass, never voided for it', async () => {
  const g = await mk('ann', { entry: 0 }); await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 6 * H; const K = gm('502').start;
  assert.strictEqual((await add('bob', bet('b1', '502', 'KC', 'ml', 200, 100))).s, 200); assert.strictEqual((await add('cat', bet('c1', '502', 'KC', 'ml', 130, 100))).s, 200); assert.strictEqual((await add('dan', bet('d1', '509', 'MIA', 'ml', 140, 100))).s, 200);
  X.NOTICK = true; X.PC = { '502': O('BUF -3', 47.5, 120, -140) }; // no tick ran near kickoff (server asleep); ESPN kept KC +120 as the pregame line of 502; nothing for 509
  X.SUMMARY = 'down'; let v = await view('bob', g, K + 5 * H); assert.deepStrictEqual([v.by.b1.res, v.by.b1.ok], ['', true], 'ESPN summary down: not graded yet, not void'); X.SUMMARY = 'ok';
  X.sumCalls = 0; v = await view('bob', g, K + 5 * H + 60e3); assert.deepStrictEqual([v.by.b1.res, v.by.b1.pl], ['won', 120], 'typed +200, ESPN pregame +120: graded at +120');
  const st = Object.values(X.db['lock:gl:' + g.id + ':' + g.contests[0].cid].data.b).map((P) => P.b1).find(Boolean); assert.strictEqual(Object.values(st.r)[0].rs, 'espn-pregame', 'stored with the leg');
  const vc = await view('cat', g, K + 5 * H + 2 * 60e3); assert.deepStrictEqual([vc.by.c1.res, vc.by.c1.pl], ['won', 120], 'typed +130 -> the lower +120');
  const vd = await view('dan', g, K + 5 * H + 3 * 60e3); assert.ok(vd.by.d1.voided && vd.by.d1.res === 'push', 'no pregame line anywhere for 509: void, stake back');
  assert.ok(X.sumCalls <= 6, 'summary read once per game, then kept: ' + X.sumCalls);
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', () => { P = srv.address().port; r(); }));
  const only = process.argv[2]; let fail = 0, n = 0; const err = console.error; console.error = process.env.DBG ? err : () => {};
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue; n++; fresh(); try { await fn(); console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 14).join('\n        ')); } }
  console.error = err; srv.close();
  console.log(fail ? '\n' + fail + ' OF ' + n + ' MAIN-LINE PORT CHECKS FAILED' : '\nALL ' + n + ' MAIN-LINE PORT CHECKS PASSED'); process.exit(fail ? 1 : 0);
})();
