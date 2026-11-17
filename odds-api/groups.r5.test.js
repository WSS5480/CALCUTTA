// Run: node odds-api/groups.r5.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
// ROUND 5 (Nov 17 2026): one check or more per item of the round-4 review (/tmp/revgroups5-report.md: H1-H3, M1-M5, the Low list) and for the two things
// built this round (Head-to-head, the weekly high-score prize). Every check FAILS on 322d2a0 (v254 round 4) and passes now. To see that:
//   ODD_ROOT=/path/to/a/322d2a0/checkout node odds-api/groups.r5.test.js     (expect every line FAIL)
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
const read = (f) => (/^pics\//.test(f) ? PH.phone(f) : fs.readFileSync(path.join(ROOT, f), 'utf8')), client = () => read('pics/groups.js'); // main-line port: phone files come from PH (only inside PH.phoneCheck)
const NOREF = 'No posted price at kickoff — this bet did not count';
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const MIN = 6e4, K509 = START + 2 * H, CHECK = "Couldn't check this game — try again. Nothing was added.";
const tickAt = async (t) => { NOW = t; await G.tick({ force: true }); };
const refOfBook = (w, id) => Object.values(book(w)[id].r)[0];
const rowsOf = async (w, g) => (await call(w, 'standings', { id: g.id, cid: g.contests[0].cid })).j;
const prop = (id, gid, text, odds, stake) => { const g = gm(gid); return { id, kind: 'prop', text, pp: { gid }, lg: g.lg || 'nfl', odds, stake, day: GR.chiDay(g.start) }; };
// The phone file (pics/groups.js) run for real in a small fake page: fetch answers come from `routes(op, body)`.
function phone(routes, store) {
  const els = [], ls = Object.assign({ 'odd-tok': 'tok-123456789012' }, store || {}), ss = {};
  const mkEl = () => ({ children: [], attrs: {}, _l: {}, style: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this._l[t] = f; }, appendChild(c) { this.children.push(c); }, remove() { const i = els.indexOf(this); if (i >= 0) els.splice(i, 1); }, querySelector: () => null, querySelectorAll: () => [] });
  const document = { createElement: mkEl, getElementById: (id) => els.find((e) => e.id === id) || null, head: { appendChild() {} }, body: { appendChild(e) { els.push(e); } } };
  const stor = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = String(v); }, removeItem: (k) => { delete o[k]; } });
  const win = { addEventListener() {}, dispatchEvent() {} }, calls = [];
  const box = { window: win, document, localStorage: stor(ls), sessionStorage: stor(ss), setTimeout: (f, ms) => (ms === 7000 ? 0 : setTimeout(f, Math.ceil(ms / 1000))) /* the page's waits run 1000x faster; the 7-second toast stays up */, clearTimeout() {}, console, navigator: {}, confirm: () => true,
    fetch: async (url, opt) => { const op = String(url).split('/groups/')[1], b = JSON.parse(opt.body); calls.push([op, b]); const a = await routes(op, b); if (a === 'down') throw new TypeError('Failed to fetch'); return { ok: a.s === 200, status: a.s, json: async () => a.j }; } };
  vm.runInNewContext(read('pics/groups.js'), box);
  const tap = async (k) => { for (let i = 0; i < 200 && !document.getElementById('oglock'); i++) await new Promise((r) => setImmediate(r)); const o = document.getElementById('oglock'); if (!o) return null; const html = o.innerHTML; o._l.click({ target: { closest: () => ({ getAttribute: () => k }) } }); return html; };
  return { G: win.OddGroups, calls, tap, toast: () => (document.getElementById('ogtoast') || {}).textContent || '', dialog: () => document.getElementById('oglock') };
}

// =============================== HIGH 1: late news, old price ===============================
test('H1 in the last 30 minutes an add reads the game FRESH: news at T-5 (MIA +140 -> -220), a bet at T-3 typed +140 is stored and paid at -220, not at the +140 the server read at T-9', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob', 'cat']);
  gm('509').odds = (now) => (now < K509 - 5 * MIN ? O('NE -3', 40, 140, -160) : O('MIA -4.5', 40, -220, 180));
  await tickAt(K509 - 9 * MIN); NOW = K509 - 3 * MIN;
  const a = await add('bob', bet('s1', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(a.s, 200, JSON.stringify(a.j));
  assert.strictEqual(refOfBook('bob', 's1').rp, -220, 'the price stored with the bet is the one ESPN showed when it was added'); assert.strictEqual(refOfBook('bob', 's1').ra, NOW, 'read at the moment of the add');
  assert.strictEqual((await add('cat', bet('s2', '509', 'MIA', 'ml', -220, 100))).s, 200);
  NOW = K509 + 5 * H; const vb = await view('bob', g), vc = await view('cat', g);
  assert.deepStrictEqual([vb.by.s1.res, vb.by.s1.pl], ['won', 45.45], 'bob is paid at -220 like the honest player'); assert.match(vb.by.s1.as, /Moneyline at -220/); assert.strictEqual(vc.by.s2.pl, 45.45);
});
test('H1 every add inside the last 30 minutes makes its own scoreboard read (two adds 10 seconds apart = two reads); an add 40 minutes out with a copy under a minute old makes none', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob', 'cat']); const f0 = D.fetch; let n = 0; D.fetch = (u) => { if (/scoreboard/.test(u)) n++; return f0(u); };
  try { await tickAt(K509 - 41 * MIN); NOW = K509 - 41 * MIN + 30e3; n = 0; assert.strictEqual((await add('bob', bet('f0', '509', 'MIA', 'ml', 140, 10))).s, 200); assert.strictEqual(n, 0, 'outside the last 30 minutes a good copy under a minute old is used');
    NOW = K509 - 20 * MIN; n = 0; assert.strictEqual((await add('bob', bet('f1', '509', 'MIA', 'ml', 140, 10))).s, 200); const n1 = n; assert.ok(n1 >= 1, 'first add read ESPN: ' + n1);
    NOW += 10e3; assert.strictEqual((await add('cat', bet('f2', '509', 'MIA', 'ml', 140, 10))).s, 200); assert.ok(n > n1, 'the second add read ESPN again, ' + n + ' > ' + n1); } finally { D.fetch = f0; }
});
test('H1 if the fresh read fails the add is REFUSED with 503 "Couldn\'t check this game — try again" and nothing is written; the same bet goes in once ESPN answers', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob']); await tickAt(K509 - 35 * MIN); X.BOARD = 'down'; NOW = K509 - 20 * MIN;
  const a = await add('bob', bet('d1', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(a.s, 503, JSON.stringify(a.j)); assert.strictEqual(a.j.error, CHECK); assert.deepStrictEqual(Object.keys(book('bob')), []);
  X.BOARD = 'ok'; NOW += 30e3; assert.strictEqual((await add('bob', bet('d1', '509', 'MIA', 'ml', 140, 100))).s, 200);
});
test('H1 adds close 2 minutes before the listed kickoff: 1:59 before = "Bets on this game are closed", 2:01 before = saved', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob']); NOW = K509 - 2 * MIN + 1000;
  const a = await add('bob', bet('c1', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(a.s, 409, JSON.stringify(a.j)); assert.strictEqual(a.j.error, 'Bets on this game are closed: group bets stop 2 minutes before kickoff. Nothing was added.');
  NOW = K509 - 2 * MIN - 1000; assert.strictEqual((await add('bob', bet('c2', '509', 'MIA', 'ml', 140, 100))).s, 200); assert.ok(!/\block(s|ed)?\b/i.test(a.j.error));
});
test('M1 ESPN down from 50 minutes before kickoff: a bet 40 minutes out is refused (503), never "Saved to your group." for a bet that is sure to void', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob']); await tickAt(K509 - 55 * MIN); X.BOARD = 'down'; X.SUMMARY = 'down'; await tickAt(K509 - 45 * MIN); NOW = K509 - 40 * MIN;
  const a = await add('bob', bet('m1', '509', 'MIA', 'ml', 140, 100)); assert.strictEqual(a.s, 503, JSON.stringify(a.j)); assert.strictEqual(a.j.error, CHECK); assert.deepStrictEqual(Object.keys(book('bob')), []);
});
test('M2 a game that starts BEFORE its listed time (first pitch 8 minutes early): an add 5 minutes before the listed time sees ESPN\'s "in progress" and is refused', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob']); gm('509').state = (now) => (now < K509 - 8 * MIN ? 'pre' : now < K509 + 3 * H ? 'in' : 'post');
  await tickAt(K509 - 9 * MIN); NOW = K509 - 5 * MIN; const a = await add('bob', bet('e1', '509', 'MIA', 'ml', 140, 100));
  assert.strictEqual(a.s, 409, JSON.stringify(a.j)); assert.match(a.j.error, /already started/); assert.deepStrictEqual(Object.keys(book('bob')), []);
});
// =============================== HIGH 2: honor-system props ===============================
test('H2 a prop must NAME ITS GAME and be added before that kickoff: no game = refused, after the final = refused, however the honor switch is set', async () => {
  const g = await mk('ann', { honor: true, cap: 100, entry: 0 }) /* main-line port: honor props only in a free contest */; await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H;
  let r = await add('bob', { id: 'x1', kind: 'prop', text: 'Mahomes over 250 pass yds', odds: 5000, stake: 100, day: '2026-11-22', lg: 'nfl' });
  assert.strictEqual(r.s, 409, JSON.stringify(r.j)); assert.strictEqual(r.j.error, 'A prop must name its game: pick the game first, then add the prop before it starts. Nothing was added.');
  NOW = gm('502').start + 5 * H; r = await add('bob', { id: 'x2', kind: 'prop', text: 'Chiefs to win', odds: 900, stake: 100, day: '2026-11-22', lg: 'nfl' }); assert.strictEqual(r.s, 409, 'after the final, no game named');
  r = await add('bob', prop('x3', '502', 'Mahomes over 250 pass yds', 5000, 100)); assert.strictEqual(r.s, 409, 'after the final, game named'); assert.match(r.j.error, /already started/);
  assert.deepStrictEqual(Object.keys(book('bob')), []); assert.strictEqual((await add('bob', Object.assign(prop('x4', '503', 'No price', 0, 10), { odds: undefined }))).s, 400, 'a prop needs a price: it is what it pays');
});
test('H2 never self-marked: the phone\'s own "won $1,000,000" counts for nothing; the commissioner enters the result after the game and ONE other member confirms; paid from the typed price capped at +500, stake capped', async () => {
  const g = await mk('ann', { honor: true, cap: 100, entry: 0 }) /* main-line port: honor props only in a free contest */; await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 6 * H; const K = gm('502').start, id = g.id;
  assert.strictEqual((await add('bob', prop('p1', '502', 'Mahomes over 250 pass yds', 5000, 300))).s, 200);
  const mine = X.db[SID.bob].data.bets.find((b) => b.id === 'p1'); assert.ok(mine, 'mirrored to My Bets'); Object.assign(mine, { res: 'won', fin: 'won', finPL: 1000000 }); X.db[SID.bob].updated++;
  NOW = K + H; let v = await view('bob', g); assert.strictEqual(v.t.win, 0); const pid = v.row.pid;
  let r = await call('ann', 'prop/result', { id, pid, bid: 'p1', res: 'won' }); assert.strictEqual(r.s, 409, 'not before the game is over: ' + JSON.stringify(r.j)); assert.match(r.j.error, /once its game is over/);
  NOW = K + 5 * H; v = await view('bob', g); assert.deepStrictEqual([v.by.p1.res, v.t.win, v.by.p1.gr], ['', 0, 'honor'], 'the phone marked it won for $1,000,000: nothing counts');
  assert.strictEqual((await call('bob', 'prop/result', { id, pid, bid: 'p1', res: 'won' })).s, 403, 'the bettor cannot enter it'); assert.strictEqual((await call('cat', 'prop/result', { id, pid, bid: 'p1', res: 'won' })).s, 403, 'a member cannot enter it');
  r = await call('ann', 'prop/result', { id, pid, bid: 'p1', res: 'won' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.fin, false);
  v = await view('bob', g); assert.strictEqual(v.t.win, 0, 'entered but not confirmed: not counted'); assert.deepStrictEqual(v.by.p1.hr, { res: 'won', n: 0, need: 1, fin: false });
  assert.strictEqual((await call('bob', 'prop/confirm', { id, pid, bid: 'p1', res: 'won' })).s, 403, 'the bettor cannot confirm'); assert.strictEqual((await call('ann', 'prop/confirm', { id, pid, bid: 'p1', res: 'won' })).s, 403, 'the commissioner cannot confirm her own entry');
  assert.strictEqual((await call('cat', 'prop/confirm', { id, pid, bid: 'p1', res: 'lost' })).s, 409, 'confirm what was entered');
  r = await call('cat', 'prop/confirm', { id, pid, bid: 'p1', res: 'won' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.fin, true);
  v = await view('bob', g); assert.deepStrictEqual([v.by.p1.res, v.by.p1.pl, v.by.p1.cs], ['won', 100, 100], '$300 at +5000: the stake counts as $100 (cap) and the price as EVEN MONEY (main-line port: honor props are capped at +100): +$100, never the phone\'s $1,000,000');
  assert.strictEqual((await call('ann', 'prop/result', { id, pid, bid: 'p1', res: 'lost' })).s, 409, 'final once confirmed');
});
test('H2 the commissioner\'s OWN prop needs TWO other members; honor contests are labelled "Honor system: results entered by the commissioner"', async () => {
  const g = await mk('ann', { honor: true, cap: 100, entry: 0 }) /* main-line port: honor props only in a free contest */; await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 6 * H; const K = gm('502').start, id = g.id;
  assert.strictEqual((await add('ann', prop('a1', '502', 'Allen 2+ TDs', 150, 100))).s, 200); NOW = K + 5 * H; let v = await view('ann', g); const pid = v.row.pid;
  let r = await call('ann', 'prop/result', { id, pid, bid: 'a1', res: 'won' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.need, 2);
  r = await call('bob', 'prop/confirm', { id, pid, bid: 'a1', res: 'won' }); assert.strictEqual(r.j.fin, false, 'one is not enough'); v = await view('ann', g); assert.strictEqual(v.t.win, 0);
  assert.strictEqual((await call('bob', 'prop/confirm', { id, pid, bid: 'a1', res: 'won' })).j.fin, false, 'the same member twice is still one');
  r = await call('cat', 'prop/confirm', { id, pid, bid: 'a1', res: 'won' }); assert.strictEqual(r.j.fin, true); v = await view('ann', g); assert.strictEqual(v.by.a1.pl, 100, 'typed +150, paid at EVEN MONEY at most (main-line port)');
  const st = await rowsOf('bob', g); assert.strictEqual(st.contest.honorText, 'Honor system: props are priced at even money at most and settled by the commissioner and one other member. Use only with people you trust.'); /* main-line port: the review's suggested label */ assert.strictEqual(G.HONOR_TEXT, st.contest.honorText);
  PH.phoneCheck(() => { const c = client(); assert.ok(c.includes("'Honor system: results entered by the commissioner'"), 'the phone carries the same label'); assert.ok(!/counted on the member\\?'s word/.test(c), 'the old "on the member\'s word" text is gone'); });
});
// =============================== HIGH 3: no "Just for me" ===============================
test('H3 the confirm step of a player in a group contest offers "Add to my group" and "Cancel" only; a 200 {personal:true} answer (main line, Phase 1) keeps the bet as a personal bet and shows the server\'s text', async () => {
  if (!PH.ROOT) { PH.phoneCheck(() => {}); return; } // main-line port: a check of the feature branch's phone file (skipped and counted here)
  assert.ok(!/Just for me/i.test(client()) && !client().includes('data-k="personal"'), 'the choice is gone from pics/groups.js');
  const TEXT = 'No contest in your groups can count this bet (another sport). It was NOT added to a group and is not locked: it stays a personal bet.';
  const P = phone(async (op) => (op === 'bet/status' ? { s: 200, j: { betLock: 1, canBet: true } } : op === 'bet/add' ? { s: 200, j: { ok: true, personal: true, saved: false, counted: 0, code: 'personal', gl: 0, text: TEXT } } : { s: 404, j: {} }));
  const b = { id: 'b1', gid: '509', side: 'MIA', type: 'ml', odds: 140, stake: 10, day: '2026-11-22' }, pr = P.G.gate(b), html = await P.tap('group');
  assert.ok(html && /data-k="group"/.test(html) && />Cancel</.test(html), 'dialog shown'); assert.strictEqual((html.match(/<button/g) || []).length, 2, 'two buttons: add to my group, cancel');
  assert.strictEqual(await pr, true, 'the bet is kept'); assert.ok(!(b.gl > 0), 'not a group bet'); assert.strictEqual(P.toast(), TEXT, 'the server\'s text is shown');
});
test('H3 an existing (Kalshi) bet answered {personal:true} stays as it was and the reason is returned; a 503 from the add step shows the server\'s own "try again" message; a cancelled dialog keeps nothing', async () => {
  if (!PH.ROOT) { PH.phoneCheck(() => {}); return; } // main-line port: a check of the feature branch's phone file (skipped and counted here)
  const TEXT = 'No contest in your groups can count this bet (another sport). It was NOT added to a group and is not locked: it stays a personal bet.';
  let P = phone(async (op) => (op === 'bet/status' ? { s: 200, j: { betLock: 1, canBet: true } } : { s: 200, j: { ok: true, personal: true, gl: 0, text: TEXT } }));
  const k = { id: 'k1', src: 'kalshi', kt: 'KXNFLGAME-26NOV22MIANE-MIA', mult: 2, stake: 10, day: '2026-11-22' }; let pr = P.G.addExisting(k); await P.tap('group'); assert.strictEqual(await pr, TEXT); assert.ok(!(k.gl > 0));
  P = phone(async (op) => (op === 'bet/status' ? { s: 200, j: { betLock: 1, canBet: true } } : { s: 503, j: { error: CHECK } }));
  const b = { id: 'b2', gid: '509', side: 'MIA', type: 'ml', odds: 140, stake: 10, day: '2026-11-22' }; pr = P.G.gate(b); await P.tap('group'); assert.strictEqual(await pr, CHECK); assert.strictEqual(P.calls.filter((c) => c[0] === 'bet/add').length, 1);
  P = phone(async (op) => (op === 'bet/status' ? { s: 200, j: { betLock: 1, canBet: true } } : { s: 500, j: {} })); pr = P.G.gate({ id: 'b3', stake: 5 }); await P.tap(''); assert.strictEqual(await pr, false, 'cancel = not kept, nothing sent'); assert.strictEqual(P.calls.filter((c) => c[0] === 'bet/add').length, 0);
});
test('H3 / main-line review B1: the Groups server cannot be reached and this phone never knew the player was in a group = the bet is kept as an ordinary personal bet (no dialog, no refusal); it is refused only when the phone last knew of a group', async () => {
  if (!PH.ROOT) { PH.phoneCheck(() => {}); return; } // main-line port: a check of the feature branch's phone file (skipped and counted here)
  let P = phone(async () => 'down'); assert.strictEqual(await P.G.gate({ id: 'b1', stake: 5 }), true, 'never knew: kept'); assert.strictEqual(P.dialog(), null);
  P = phone(async () => 'down', { 'odd-gbl': JSON.stringify({ n: 1, at: 1, tok: '123456789012' }) }); assert.strictEqual(await P.G.gate({ id: 'b1', stake: 5 }), P.G.NOREACH, 'last knew a group: not quietly kept');
});
// =============================== MEDIUM 3, 4, 5 ===============================
test('M3 "Longest odds that count" caps the WHOLE parlay: three legs worth 6.624x under +500 pay 6x in total (+$500 on $100), and the rules sheet says so with an example', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat']); NOW = START - 5 * H;
  assert.strictEqual((await add('bob', { id: 'p2', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('506', 'SF', 'ml', 500), leg('502', 'KC', 'ml', 500), leg('509', 'MIA', 'ml', 500)] })).s, 200);
  assert.strictEqual((await add('cat', { id: 'p4', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('502', 'KC', 'ml', 130), leg('509', 'MIA', 'ml', 140)] })).s, 200);
  const v = await view('bob', g, START + 2 * DAY); assert.deepStrictEqual([v.by.p2.res, v.by.p2.pl], ['won', 500], '1.2 x 2.3 x 2.4 = 6.624x is cut to 6x'); assert.match(v.by.p2.as, /x6\b/);
  assert.strictEqual((await view('cat', g, START + 2 * DAY)).by.p4.pl, 452, '2.3 x 2.4 = 5.52x is under the cap and untouched');
  PH.phoneCheck(() => { const c = client(); assert.ok(/A whole parlay pays at most \+/.test(c) && /a \$10 parlay returns at most/.test(c), 'stated on the rules sheet with an example'); assert.ok(/\['Longest odds that count'[^\n]*PARCAP\(/.test(c)); });
});
test('M4 a void for a postponed game is PER GAME: voiding it once takes it out for every member (Ann and Bob hold the same parlay: both keep the other leg; Cat\'s single is void), never one member at a time', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob', 'cat']); NOW = START - 6 * H;
  const par = (id) => ({ id, kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('508', 'LAR', 'ml', -160), leg('509', 'MIA', 'ml', 140)] });
  assert.strictEqual((await add('ann', par('pa'))).s, 200); NOW += 10 * MIN; assert.strictEqual((await add('bob', par('pb'))).s, 200); assert.strictEqual((await add('cat', bet('c1', '508', 'LAR', 'ml', -160, 50))).s, 200);
  await tickAt(START - 30 * MIN); let r = await call('ann', 'bet/voidable', { id: g.id }); const pp = r.j.list.filter((x) => x.kind === 'postponed');
  assert.strictEqual(pp.length, 1, 'one entry for the game, not one per member: ' + JSON.stringify(r.j.list)); assert.deepStrictEqual([pp[0].game, pp[0].name, pp[0].n, pp[0].members], ['nfl|508', 'SEA @ LAR', 3, 3]);
  const bobPid = (await view('bob', g)).row.pid; r = await call('ann', 'bet/void', { id: g.id, pid: bobPid, bid: 'pb', kind: 'postponed', reason: 'Game postponed, snow' }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); assert.strictEqual(r.j.n, 3, 'all three bets on that game');
  assert.match(r.j.group.voids[0].name, /Every bet on SEA @ LAR/);
  await kickTicks(K509 + 5 * H); NOW = K509 + 5 * H; const va = await view('ann', g), vb = await view('bob', g), vc = await view('cat', g);
  assert.deepStrictEqual([va.by.pa.res, va.by.pa.pl], ['won', 140], 'Ann: the postponed leg dropped out, MIA +140 won'); assert.deepStrictEqual([vb.by.pb.res, vb.by.pb.pl], [va.by.pa.res, va.by.pa.pl], 'Bob gets exactly what Ann gets');
  assert.match(vb.by.pb.vr, /A leg is void .*that leg drops out/); assert.deepStrictEqual([vc.by.c1.res, vc.by.c1.pl, vc.by.c1.voided], ['push', 0, true]); assert.match(vc.by.c1.vr, /voided this game for everyone/);
});
test('M5 a parlay with a losing leg is a LOSS, even if a later leg has no posted price at its kickoff (it does not come back as void a week later)', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob']); const K2 = gm('503').start; gm('503').odds = (now) => (now < K2 - 50 * MIN ? O('CHI -3', 41, 140, -160) : undefined);
  NOW = START - 2 * H; assert.strictEqual((await add('bob', { id: 'p1', kind: 'parlay', stake: 100, day: '2026-11-22', lg: 'nfl', legs: [leg('509', 'NE', 'ml', -160), leg('503', 'CHI', 'ml', -160)] })).s, 200); // NE loses 10-17
  await kickTicks(K509 + 5 * H); NOW = K509 + 5 * H; await G.tick({ force: true }); const led = Object.values(X.db).find((r) => r.id.startsWith('lock:gl:')), e = Object.values(led.data.b)[0].p1;
  assert.deepStrictEqual([e.g && e.g.res, e.g && e.g.pl], ['lost', -100], 'settled as a loss the Sunday its leg lost');
  const v = await view('bob', g, K2 + 5 * H); assert.deepStrictEqual([v.by.p1.res, v.by.p1.pl, v.row.t.l], ['lost', -100, 1]); assert.ok(!v.by.p1.nr && !v.by.p1.vr);
});
// =============================== LOW ===============================
test('L1 others see a bet only once ESPN itself shows the game started: the listed kickoff passes, ESPN then moves it 90 minutes later, and the bet was never shown in between', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob', 'cat']); const gmm = gm('509');
  gmm.startAt = (now) => (now < K509 + 6 * MIN ? K509 : K509 + 90 * MIN); gmm.state = (now) => (now < K509 + 90 * MIN ? 'pre' : now < K509 + 5 * H ? 'in' : 'post');
  NOW = K509 - 3 * H; assert.strictEqual((await add('bob', bet('f1', '509', 'MIA', 'ml', 140, 100))).s, 200); await tickAt(K509 - 5 * MIN);
  NOW = K509 + 2 * MIN; let s = await view('bob', g, null, 'cat'); assert.deepStrictEqual([s.bets.length, s.hidden], [0, 1], 'listed time passed, ESPN still says not started: hidden');
  NOW = K509 + 95 * MIN; s = await view('bob', g, null, 'cat'); assert.deepStrictEqual([s.bets.length, s.hidden], [1, 0], 'shown once ESPN shows it in progress');
});
test('L2 odds: the current / close price is used, else the classic field; an OPEN price is never used. L3: "WSH -3", "JAC -2.5", "LA -1" in the old text are read as Washington, Jacksonville and the Rams', async () => {
  const ml = (o) => (GR.parseOdds({ odds: [o] }, 'NE', 'MIA', 'nfl') || {}).ml;
  assert.deepStrictEqual(ml({ moneyline: { home: { open: { odds: '-150' } }, away: { open: { odds: '+130' } } }, homeTeamOdds: { moneyLine: -260 }, awayTeamOdds: { moneyLine: 215 } }), { home: -260, away: 215 }, 'open -150 ignored, classic -260 used');
  assert.strictEqual(ml({ moneyline: { home: { open: { odds: '-150' } }, away: { open: { odds: '+130' } } } }), undefined, 'only an opening price: no price');
  assert.deepStrictEqual(ml({ moneyline: { home: { open: { odds: '-150' }, close: { odds: '-200' }, current: { odds: '-240' } }, away: { close: { odds: '+170' } } } }), { home: -240, away: 170 });
  const sp = (d, h, a) => GR.parseOdds({ odds: [{ details: d }] }, h, a, 'nfl').sp.home;
  assert.strictEqual(sp('WSH -3', 'PHI', 'WAS'), 3); assert.strictEqual(sp('WSH -3', 'WAS', 'PHI'), -3); assert.strictEqual(sp('JAC -2.5', 'JAX', 'TEN'), -2.5); assert.strictEqual(sp('LA -1', 'SF', 'LAR'), 1);
});
test('L4 / L5 wording: no "Any bet in My Bets", "1 settled bet" not "1 settled bets", the version line says final, and no "Double Lock" is left in the app files', async () => {
  if (!PH.ROOT) { PH.phoneCheck(() => {}); return; } // main-line port: a check of the feature branch's phone file (skipped and counted here)
  const c = client(), ix = read('pics/index.html'); assert.ok(!/any bet in My Bets/i.test(c)); assert.ok(!c.includes("' settled bets'"), 'plural built with nbets()'); assert.ok(c.includes("const nbets = (n) => n + ' settled bet' + (n === 1 ? '' : 's')"));
  assert.ok(!ix.includes('group bets lock when added') && ix.includes('group bets are final when added'));
  for (const f of ['pics/index.html', 'pics/sports.html', 'pics/classic.html', 'pics/groups.js', 'pics/trophy.js', 'odds-api/alert.js']) assert.ok(!/double.lock|🔒🔒/i.test(read(f)), f + ' still says Double Lock');
});
test('L7 a void of any kind uses no weekly slot: with 5 bets a week, the game of bet 1 is voided by the commissioner and a new fifth bet is accepted', async () => {
  const g = await mk('ann', { cap: 100, maxBets: 5 }); await joinAll(g, ['bob']); NOW = START - 6 * H;
  const five = [bet('b1', '508', 'LAR', 'ml', -160, 10), bet('b2', '502', 'KC', 'ml', 130, 10), bet('b3', '506', 'SF', 'ml', -500, 10), bet('b4', '502', 'Over', 'ou', -110, 10, { line: 47.5 }), bet('b5', '506', 'SF', 'sp', -110, 10, { line: -9.5 })];
  for (const b of five) { NOW += MIN; const r = await add('bob', b); assert.strictEqual(r.s, 200, b.id + ' ' + JSON.stringify(r.j)); }
  NOW += MIN; let r = await add('bob', bet('b6', '509', 'MIA', 'ml', 140, 10)); assert.ok(r.s === 200 && r.j.personal === true && /weekly limit/.test(r.j.why), 'the sixth is over the weekly limit (main-line port: answered as a personal bet) ' + JSON.stringify(r.j));
  await tickAt(START - 30 * MIN); const pid = (await view('bob', g)).row.pid; assert.strictEqual((await call('ann', 'bet/void', { id: g.id, pid, bid: 'b1', kind: 'postponed', reason: 'Postponed' })).s, 200);
  NOW = START - 20 * MIN; r = await add('bob', bet('b6', '509', 'MIA', 'ml', 140, 10)); assert.strictEqual(r.s, 200, 'the void gave the slot back: ' + JSON.stringify(r.j));
});
// =============================== FORMATS: Head-to-head, weekly prize ===============================
test('HEAD-TO-HEAD schedule (main-line port, review round 6 M3): the commissioner can no longer re-roll the draw once anyone else has joined; Oddable draws a round-robin at the start (everyone plays everyone once before a repeat; an odd count gives one bye a week), the same on every read, final; Bankroll and Survivor are not offered', async () => {
  const g = await mk('ann', { fmt: 'h2h' }); const cid = g.contests[0].cid; NOW = START - 3 * DAY + H;
  let r = await call('ann', 'contest/schedule', { id: g.id, cid }); assert.strictEqual(r.s, 409, 'alone: nobody to play'); assert.match(r.j.error, /at least 2 players/);
  await joinAll(g, ['bob', 'cat', 'dan']); NOW = START - 3 * DAY + 2 * H;
  let st = await rowsOf('ann', g); assert.deepStrictEqual([st.contest.h2h.made, st.contest.h2h.players, (st.matchups || []).length], [false, 4, 0]);
  assert.strictEqual((await call('bob', 'contest/schedule', { id: g.id, cid })).s, 403, 'commissioner only'); r = await call('ann', 'contest/schedule', { id: g.id, cid }); assert.strictEqual(r.s, 409, 'someone has joined: no draw by hand'); assert.match(r.j.error, /drawn by Oddable when the contest starts/);
  await call('eve', 'join', { code: g.code }); NOW = START + H; // the contest has started: the server draws
  const seen = new Set(), wk1 = []; for (let w = 1; w <= 4; w++) { const j = (await call('bob', 'standings', { id: g.id, cid, scope: 'week', week: w })).j; assert.strictEqual(j.matchups.filter((m) => !m.bye).length, 2, 'week ' + w); assert.strictEqual(j.matchups.filter((m) => m.bye).length, 1, 'one bye, week ' + w); if (w === 1) wk1.push(JSON.stringify(j.matchups.map((m) => [m.a.pid, m.b && m.b.pid]))); j.matchups.filter((m) => !m.bye).forEach((m) => seen.add([m.a.pid, m.b.pid].sort().join('v'))); assert.strictEqual(new Set(j.matchups.flatMap((m) => [m.a.pid, m.b ? m.b.pid : null]).filter(Boolean)).size, 5, 'everyone is in week ' + w); }
  assert.strictEqual(seen.size, 8, 'five players: eight different pairings over the first four weeks (no repeat before everyone has met)');
  st = await rowsOf('ann', g); assert.deepStrictEqual([st.contest.h2h.made, st.contest.h2h.final, st.contest.h2h.auto], [true, true, true]);
  G._reset(); const again = (await call('cat', 'standings', { id: g.id, cid, scope: 'week', week: 1 })).j; assert.strictEqual(JSON.stringify(again.matchups.map((m) => [m.a.pid, m.b && m.b.pid])), wk1[0], 'the same draw on every read');
  r = await call('ann', 'contest/schedule', { id: g.id, cid }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /final/);
  const R = G.rrSchedule(['a', 'b', 'c'], 3); assert.deepStrictEqual(R.map((w) => w.filter((m) => m[1]).length), [1, 1, 1]); assert.strictEqual(new Set(R.flatMap((w) => w.filter((m) => m[1]).map((m) => m.slice().sort().join('')))).size, 3);
  NOW = START - 3 * DAY; for (const f of ['bankroll', 'survivor']) assert.strictEqual((await call('ann', 'create', { name: 'No ' + f, take: { kind: 'none', v: 0 }, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, contest: Object.assign({}, CDEF, { fmt: f }) })).s, 400);
  PH.phoneCheck(() => assert.ok(/\['h2h', 'Head-to-head'/.test(client()) && !/bankroll|survivor/i.test(client()), 'the phone offers Head-to-head and neither of the unbuilt formats'));
});
test('HEAD-TO-HEAD week: the higher graded net wins the week; no counted bet = forfeit; decided when the week is over; standings by wins, then losses, then net; with no schedule made the server makes one at the start', async () => {
  const g = await mk('ann', { fmt: 'h2h', cap: 100 }); await joinAll(g, ['bob', 'cat', 'dan']); const cid = g.contests[0].cid; NOW = START - 6 * H;
  let st = (await call('ann', 'standings', { id: g.id, cid, scope: 'week', week: 1 })).j; assert.strictEqual(st.contest.h2h.auto, true, 'made by the server at the start'); assert.strictEqual(st.matchups.length, 2);
  const who = (pid) => WHO.find((w) => st.rows.find((x) => x.pid === pid).name === w.toUpperCase() + 'name'), [m1, m2] = st.matchups, A = who(m1.a.pid), B = who(m1.b.pid), C = who(m2.a.pid), Dn = who(m2.b.pid);
  assert.strictEqual((await add(A, bet('w1', '509', 'MIA', 'ml', 140, 100))).s, 200); assert.strictEqual((await add(B, bet('l1', '509', 'NE', 'ml', -160, 100))).s, 200); assert.strictEqual((await add(Dn, bet('l2', '506', 'ARI', 'ml', 380, 100))).s, 200); // C adds nothing
  await kickTicks(START + 8 * H); NOW = START + 8 * H; G._reset(); st = (await call('ann', 'standings', { id: g.id, cid, scope: 'week', week: 1 })).j;
  assert.deepStrictEqual(st.matchups.map((m) => [m.done, m.a.net, m.b.net]), [[false, 140, -100], [false, 0, -100]], 'Sunday night: nets are in, the week is not over');
  NOW = Z('2026-11-24T07:00:00Z'); G._reset(); st = (await call('ann', 'standings', { id: g.id, cid, scope: 'week', week: 1 })).j; const [x1, x2] = st.matchups;
  assert.deepStrictEqual([x1.done, x1.win], [true, m1.a.pid], 'higher net wins'); assert.deepStrictEqual([x2.done, x2.win, x2.a.forfeit], [true, m2.b.pid, true], 'no counted bet = forfeit, even to a losing week');
  st = await rowsOf('ann', g); const rec = (w) => { const x = st.rows.find((y) => y.name === w.toUpperCase() + 'name'); return [x.place, x.t.hw, x.t.hl, x.t.win]; };
  assert.deepStrictEqual([rec(A), rec(Dn), rec(C), rec(B)], [[1, 1, 0, 140], [2, 1, 0, -100], [3, 0, 1, 0], [4, 0, 1, -100]], 'wins, then losses, then net');
  const T = G.h2hWeeks({ rules: { minBets: 0 }, startDay: '2026-11-20', endDay: '2026-11-23' }, { weeks: [[['a', 'b']]] }, { a: [{ ok: true, d: '2026-11-22', res: 'won', pl: 50 }], b: [{ ok: true, d: '2026-11-22', res: 'won', pl: 50 }] }, Z('2026-11-25T00:00:00Z'));
  assert.deepStrictEqual([T.weeks[0][0].win, T.rec.a, T.rec.b], ['tie', { w: 0, l: 0, t: 1 }, { w: 0, l: 0, t: 1 }], 'equal nets = a tie');
});
test('WEEKLY HIGH-SCORE PRIZE is paid from the split set before the start: 20% of a $100 pool over the 5 weeks of the contest = $4 a week, places from the other $80; an empty week carries; what is left after the last week goes to first place; all of it adds up to the pool', async () => {
  const g = await mk('ann', { weekly: 20, cap: 100 }); await joinAll(g, ['bob', 'cat', 'dan']); const cid = g.contests[0].cid, grp = (await call('ann', 'get', { id: g.id })).j.group;
  for (const m of grp.members) assert.strictEqual((await call('ann', 'paid', { id: g.id, pid: m.pid, paid: true })).s, 200);
  let r = await call('ann', 'contest/edit', { id: g.id, cid, contest: Object.assign({}, CDEF, { weekly: 50 }) }); assert.strictEqual(r.s, 409, 'the weekly share is a money rule: final once someone joined');
  NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('w1', '509', 'MIA', 'ml', 140, 100))).s, 200); assert.strictEqual((await add('cat', bet('l1', '509', 'NE', 'ml', -160, 100))).s, 200);
  assert.strictEqual((await add('cat', bet('w2', '503', 'CHI', 'ml', -160, 100))).s, 200);
  let st = await rowsOf('ann', g); assert.deepStrictEqual(st.prizes, [{ place: 1, pct: 100, amt: 80 }]); assert.deepStrictEqual(st.weekly, [4, 4, 4, 4, 4]); assert.deepStrictEqual([st.pots.main.shares[0].weekly.amt, st.pots.main.shares[0].weekly.pct, st.pots.main.pool], [20, 20, 100]);
  await kickTicks(Z('2026-11-24T07:00:00Z')); NOW = Z('2026-11-24T07:00:00Z'); G._reset(); st = await rowsOf('ann', g); const row = (w) => st.rows.find((y) => y.name === w.toUpperCase() + 'name');
  assert.deepStrictEqual([st.high[0].week, st.high[0].name, st.high[0].done, st.high[0].prize], [1, 'BOBname', true, 4]); assert.deepStrictEqual([row('bob').owedWk, row('bob').owedPlace, row('bob').owed], [4, 80, 84]);
  await kickTicks(Z('2026-12-20T07:00:00Z')); NOW = Z('2026-12-20T07:00:00Z'); G._reset(); st = await rowsOf('ann', g); assert.strictEqual(st.contest.ended, true);
  assert.deepStrictEqual([row('bob').owedWk, row('bob').owed, row('cat').owedWk, row('cat').owed], [16, 96, 4, 4], 'week 1 bob $4, week 2 cat $4, weeks 3 to 5 empty: $12 carried to first place (bob)');
  assert.strictEqual(Math.round(st.rows.reduce((a, x) => a + x.owed, 0) * 100), 10000, 'every cent of the pool is owed to someone, once');
});
test('PRIZES follow the whole contest on every view: the "this week" standings no longer hand the places\' money to the week\'s ranking', async () => {
  const g = await mk('ann', { cap: 100 }); await joinAll(g, ['bob', 'cat']); const cid = g.contests[0].cid, grp = (await call('ann', 'get', { id: g.id })).j.group;
  for (const m of grp.members) await call('ann', 'paid', { id: g.id, pid: m.pid, paid: true });
  NOW = START - 6 * H; assert.strictEqual((await add('bob', bet('w1', '509', 'MIA', 'ml', 140, 100))).s, 200); assert.strictEqual((await add('cat', bet('l1', '509', 'NE', 'ml', -160, 100))).s, 200); assert.strictEqual((await add('cat', bet('w2', '503', 'CHI', 'ml', -160, 100))).s, 200);
  await kickTicks(Z('2026-12-01T07:00:00Z')); NOW = Z('2026-12-01T07:00:00Z'); G._reset();
  const owedIn = async (o) => { const j = (await call('ann', 'standings', Object.assign({ id: g.id, cid }, o))).j; return Object.fromEntries(j.rows.filter((x) => x.owed).map((x) => [x.name, x.owed])); };
  assert.deepStrictEqual(await owedIn({}), { BOBname: 75 }, 'season view: bob (+$140) leads cat (-$37.50)');
  assert.deepStrictEqual(await owedIn({ scope: 'week', week: 2 }), { BOBname: 75 }, 'week 2 view (cat won that week): the money is still bob\'s');
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', () => { P = srv.address().port; r(); }));
  const only = process.argv[2]; let fail = 0, n = 0; const err = console.error; console.error = () => {};
  for (const [name, fn] of tests) { if (only && !name.includes(only)) continue; n++; fresh(); try { await fn(); console.log('  PASS ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + String((e && e.message) || e).split('\n').slice(0, 14).join('\n        ')); } }
  console.error = err; srv.close();
  console.log(fail ? '\n' + fail + ' OF ' + n + ' ROUND-5 CHECKS FAILED' : '\nALL ' + n + ' ROUND-5 CHECKS PASSED'); process.exit(fail ? 1 : 0);
})();
