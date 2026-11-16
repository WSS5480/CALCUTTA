// Run: node odds-api/groups.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
// Covers stage 1, every fix from the review of 8cb7074 (each with a check that failed on the old code, see HANDOFF "Groups review fixes"),
// server grading in every league (G12) and contests / pots (G13).
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
const G = require('./groups'), GR = require('./grade'), D = G._deps;
// ---- fake database: async with random delays so parallel requests interleave; `updated` set by the writer like sync.js does ----
let db = {}, slow = 0, lost = 0, inflight = 0, maxIn = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
D.S = {
  dbGet: async (id) => { inflight++; maxIn = Math.max(maxIn, inflight); await wait(); await new Promise((r) => setImmediate(r)); inflight--; return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
// ---- fake sign-in ----
const SID = { ann: 'a1a1a1a1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bob: 'b2b2b2b2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', cat: 'c3c3c3c3cccccccccccccccccccccccccccccccccccccccccccccccccccccccc', dan: 'd4d4d4d4dddddddddddddddddddddddddddddddddddddddddddddddddddddddd', eve: 'e5e5e5e5eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' };
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
const NAMES = { a1a1a1a1: 'AnnTheCommish', b2b2b2b2: 'BobBets', c3c3c3c3: 'CatCovers', d4d4d4d4: 'DanDog', e5e5e5e5: 'EveEdge' };
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); if (!t.startsWith('t-')) return null; const w = t.slice(2); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : w.includes('@') ? w : /^p\d+$/.test(w) ? pe(w.padEnd(64, '0')) : null; },
  phoneEmail: pe, isOwnerPhone: () => false, ownerOk: (req) => String(req.headers['x-token']) === 't-owner', namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ---- fake ESPN: scoreboards by league and date (ESPN's shape), states from the clock ----
const Z = (s) => Date.parse(s), HOUR = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z'); // Sunday noon CT
const T = (abbr, name, short, loc) => ({ abbr, name, short, loc });
let GAMES = [
  { lg: 'nfl', id: '501', start: START, away: T('DAL', 'Dallas Cowboys', 'Cowboys', 'Dallas'), home: T('NYG', 'New York Giants', 'Giants', 'New York'), as: 20, hs: 24 },
  { lg: 'nfl', id: '502', start: START + 3 * HOUR + 25 * 6e4, away: T('KC', 'Kansas City Chiefs', 'Chiefs', 'Kansas City'), home: T('BUF', 'Buffalo Bills', 'Bills', 'Buffalo'), as: 24, hs: 27 },
  { lg: 'nfl', id: '503', start: Z('2026-11-29T18:00:00Z'), away: T('GB', 'Green Bay Packers', 'Packers', 'Green Bay'), home: T('CHI', 'Chicago Bears', 'Bears', 'Chicago'), as: 14, hs: 21 },
  { lg: 'nfl', id: '504', start: Z('2026-11-23T01:20:00Z'), away: T('SF', 'San Francisco 49ers', '49ers', 'San Francisco'), home: T('LAR', 'Los Angeles Rams', 'Rams', 'Los Angeles'), as: 24, hs: 20 },
  { lg: 'nfl', id: '505', start: START, away: T('WSH', 'Washington Commanders', 'Commanders', 'Washington'), home: T('PHI', 'Philadelphia Eagles', 'Eagles', 'Philadelphia'), as: 10, hs: 30 },
  { lg: 'ncaaf', id: '601', start: Z('2026-11-28T20:30:00Z'), away: T('ALA', 'Alabama Crimson Tide', 'Alabama', 'Alabama'), home: T('AUB', 'Auburn Tigers', 'Auburn', 'Auburn'), as: 31, hs: 28 },
  { lg: 'nba', id: '701', start: Z('2026-11-23T00:30:00Z'), away: T('LAL', 'Los Angeles Lakers', 'Lakers', 'Los Angeles'), home: T('BOS', 'Boston Celtics', 'Celtics', 'Boston'), as: 105, hs: 110 },
  { lg: 'mlb', id: '801', start: Z('2026-11-22T23:00:00Z'), away: T('NYY', 'New York Yankees', 'Yankees', 'New York'), home: T('BOS', 'Boston Red Sox', 'Red Sox', 'Boston'), as: 5, hs: 3 },
  { lg: 'nhl', id: '901', start: Z('2026-11-23T00:00:00Z'), away: T('TOR', 'Toronto Maple Leafs', 'Maple Leafs', 'Toronto'), home: T('MTL', 'Montreal Canadiens', 'Canadiens', 'Montreal'), as: 3, hs: 2 },
  { lg: 'ncaab', id: '951', start: Z('2026-11-23T01:00:00Z'), away: T('DUKE', 'Duke Blue Devils', 'Duke', 'Duke'), home: T('UNC', 'North Carolina Tar Heels', 'North Carolina', 'North Carolina'), as: 72, hs: 75 },
];
const PATH = { nfl: 'football/nfl', ncaaf: 'football/college-football', nba: 'basketball/nba', mlb: 'baseball/mlb', nhl: 'hockey/nhl', ncaab: 'basketball/mens-college-basketball' };
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
let urls = [];
D.fetch = async (u) => {
  urls.push(u); const m = /sports\/(.+)\/scoreboard\?dates=(\d{8})/.exec(u); const lg = m && Object.keys(PATH).find((k) => PATH[k] === m[1]);
  const evs = !m ? [] : GAMES.filter((g) => g.lg === lg && ymd(g.start) === m[2]).map((g) => { const now = D.now(), st = now < g.start ? 'pre' : now < g.start + 3.5 * HOUR ? 'in' : 'post';
    const tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc });
    return { id: g.id, date: new Date(g.start).toISOString(), status: { type: { state: st, completed: st === 'post', name: st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } }, competitions: [{ competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
  return { ok: true, json: async () => ({ events: evs }) };
};
let NOW = Z('2026-11-17T18:00:00Z'); D.now = () => NOW;
const row = (sid, bets, U) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets }, updated: U == null ? START - 2 * HOUR : U }; };
Object.values(SID).forEach((s) => row(s, []));
// ---- server ----
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(b || {}) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const CDEF = { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: START, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '60/30/10' };
const base = (o) => { o = o || {}; return { name: o.name || 'Sunday Crew', take: o.take || { kind: 'pct', v: 10 }, join: Object.assign({ requests: true, open: false, max: 8, late: 'no' }, o.join || {}), contest: Object.assign({}, CDEF, o.c || {}) }; };
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const bid = (n) => 'b' + n;
const C1 = (g) => g.contests[0].cid;

srv.listen(0, async () => {
  P = srv.address().port; let r, rows, bb;
  try {
    r = await call(null, 'mine'); assert.strictEqual(r.status || r.s, 401); t('signed-out request refused');
    // ================= validation =================
    const badOnes = [[{ name: 'x' }, 'name'], [{ c: { sport: 'cricket' } }, 'sport'], [{ c: { fmt: 'h2h' } }, 'coming soon'], [{ c: { start: NOW - 1 } }, 'future'], [{ c: { start: NOW + 500 * DAY } }, 'too far'],
      [{ take: { kind: 'pct', v: 51 } }, 'take 51%'], [{ take: { kind: 'pct', v: 2.5 } }, 'take 2.5%'], [{ take: { kind: 'flat', v: -5 } }, 'flat negative'], [{ take: { kind: 'flat', v: 200.01 } }, 'flat over the pot (25 x 8)'], [{ join: { max: 20 } }, 'G15: 20 people on a standard account'], [{ take: { kind: 'flat', v: 1.005 } }, 'flat sub-cent'],
      [{ c: { legs: 11 } }, 'legs 11'], [{ c: { cap: 30 } }, 'cap 30'], [{ c: { entry: -1 } }, 'entry negative'], [{ c: { entry: 2.5 } }, 'entry cents'], [{ join: { max: 9 } }, 'max 9 (not on the list)'], [{ c: { types: {} } }, 'no bet types'], [{ c: { runs: 'w21' } }, '21 weeks'], [{ c: { runs: 'custom', endDay: '2026-13-01' } }, 'bad date'], [{ c: { metric: 'vibes' } }, 'metric'], [{ c: { minBets: 11 } }, 'min bets'], [{ c: { minPaid: 7 } }, 'min paid 7'], [{ c: { split: '90/10' } }, 'split'], [{ join: { late: 'always' } }, 'late']];
    for (const [o, m] of badOnes) { G._reset(); r = await call('ann', 'create', base(o), '7.7.7.' + m.length); assert.strictEqual(r.s, 400, 'refused: ' + m + ' got ' + r.s + ' ' + JSON.stringify(r.j)); }
    t('every bad option is refused with 400 (' + badOnes.length + ' cases)');
    // fix 9: flat take compared in whole cents ($0.07 and $19.99 were refused by the old float check)
    G._reset(); for (const v of [0.07, 19.99, 0.29, 1.1, 200]) { r = await call('cat', 'create', base({ name: 'Cents ' + v, take: { kind: 'flat', v } }), '6.6.6.' + Math.round(v * 100)); ok(r, 'flat take ' + v); assert.strictEqual(r.j.group.money.take.v, v); }
    t('FIX 9: flat take like $0.07 / $19.99 / $0.29 / $1.10 accepted (compared in whole cents), $200 = the whole pot accepted');
    // G12: every sport the app tracks, default minimum to place
    G._reset(); for (const sp of ['all', 'nfl', 'ncaaf', 'nba', 'mlb', 'nhl', 'ncaab']) { r = await call('dan', 'create', base({ name: 'Sport ' + sp, c: { sport: sp, runs: 'season', minPaid: undefined } }), '5.4.3.' + sp.length); ok(r, sp); assert.strictEqual(r.j.group.contests[0].rules.minPaid, 10, 'season default 10'); G._reset(); }
    r = await call('dan', 'create', base({ name: 'Weekend', c: { runs: 'weekend', minPaid: undefined } })); ok(r); assert.strictEqual(r.j.group.contests[0].rules.minPaid, 3, 'weekend default 3'); G._reset();
    r = await call('dan', 'create', base({ name: 'OneWeek', c: { runs: 'w1', minPaid: undefined } })); ok(r); assert.strictEqual(r.j.group.contests[0].rules.minPaid, 3, 'one week default 3'); G._reset();
    t('G12: All sports / NFL / College football / NBA / MLB / NHL / College basketball accepted; FIX 7 default fewest bets to place 10 (season), 3 (weekend / one week)');
    // ================= create / privacy / joining =================
    r = await call('ann', 'create', base({ name: '<img src=x onerror=alert(1)>Crew"\'' })); ok(r, 'create');
    const g1 = r.j.group; assert.ok(!/[<>"']/.test(g1.name)); assert.strictEqual(g1.role, 'comm'); assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(g1.code)); assert.strictEqual(g1.members[0].name, 'AnnTheCommish');
    assert.strictEqual(g1.contests[0].endDay, '2026-12-19'); assert.strictEqual(g1.takeText, 'Commissioner keeps 10% of the pot'); assert.strictEqual(g1.contests[0].pot, 'main');
    t('create: group with one main-pot picks contest; name stripped of HTML; invite code; commissioner is first member by handle');
    r = await call('bob', 'get', { id: g1.id }); assert.strictEqual(r.s, 404); r = await call('bob', 'standings', { id: g1.id, cid: C1(g1) }); assert.strictEqual(r.s, 404);
    r = await call('bob', 'mine'); ok(r); assert.strictEqual(r.j.groups.length, 0); assert.strictEqual(r.j.open.length, 0);
    t('non-member cannot read a private group or its standings');
    r = await call('bob', 'preview', { code: g1.code.toLowerCase().replace('-', ' ') }); ok(r); assert.strictEqual(r.j.group.role, 'none'); assert.strictEqual(r.j.group.takeText, 'Commissioner keeps 10% of the pot'); assert.ok(!r.j.group.members && !r.j.group.code);
    r = await call('bob', 'join', { code: g1.code }); ok(r); assert.strictEqual(r.j.group.members.length, 2); assert.ok(!r.j.group.reqs);
    r = await call('bob', 'join', { code: g1.code }); ok(r); assert.strictEqual(r.j.group.members.length, 2);
    r = await call('bob', 'mine'); ok(r); assert.ok(r.j.groups.some((x) => x.id === g1.id), 'joined group listed in /mine (member index row)');
    t('code preview shows the take before joining; join by code (any case/spacing); idempotent; listed in /mine');
    for (let i = 0; i < 10; i++) { r = await call('cat', 'join', { code: 'ZZZZ-ZZZ' + i }, '5.5.5.5'); assert.strictEqual(r.s, 404); }
    r = await call('cat', 'join', { code: g1.code }, '5.5.5.5'); assert.strictEqual(r.s, 429); G._reset(); t('10 wrong codes -> 15 minute block');
    const bobPid = (await call('bob', 'get', { id: g1.id })).j.group.me;
    r = await call('bob', 'paid', { id: g1.id, pid: bobPid, paid: true }); assert.strictEqual(r.s, 403);
    r = await call('ann', 'paid', { id: g1.id, pid: bobPid, paid: true }); ok(r); assert.ok(r.j.group.members.find((m) => m.pid === bobPid).paid); t('only the commissioner marks entries paid');
    // ---- FIX 6: money / bet rules locked once someone joined ----
    r = await call('ann', 'contest/edit', { id: g1.id, cid: C1(g1), contest: Object.assign({}, CDEF, { entry: 500 }) }); assert.strictEqual(r.s, 409, 'entry change refused'); assert.match(r.j.error, /locked/);
    for (const ch of [{ cap: 100 }, { metric: 'ret' }, { split: '100' }, { types: { sp: true, ml: false, ou: true, prop: false, parlay: true } }, { minPaid: 3 }, { honor: true }, { kalshi: true }]) { r = await call('ann', 'contest/edit', { id: g1.id, cid: C1(g1), contest: Object.assign({}, CDEF, ch) }); assert.strictEqual(r.s, 409, 'locked: ' + JSON.stringify(ch)); }
    r = await call('ann', 'edit', { id: g1.id, name: 'Crew', join: { requests: true, open: false, max: 8, late: 'no' }, take: { kind: 'pct', v: 50 } }); assert.strictEqual(r.s, 409, 'take change refused');
    r = await call('ann', 'contest/edit', { id: g1.id, cid: C1(g1), contest: Object.assign({}, CDEF, { cname: 'Renamed', start: START + HOUR }) }); ok(r, 'name and dates still editable'); assert.strictEqual(r.j.group.contests[0].name, 'Renamed'); assert.strictEqual(r.j.group.engaged, true);
    r = await call('ann', 'contest/add', { id: g1.id, contest: Object.assign({}, CDEF, { pot: 'main', cname: 'Second' }) }); assert.strictEqual(r.s, 409, 'no new main-pot contest after people joined');
    r = await call('ann', 'contest/add', { id: g1.id, contest: Object.assign({}, CDEF, { pot: 'side', cname: 'Side NBA', sport: 'nba', take: { kind: 'none' } }) }); ok(r, 'side pot still allowed');
    t('FIX 6: after a member joined, entry/take/split/cap/ranking/bet rules are refused (409); name and dates still editable; new contests only as side pots');
    // ---- open group: request / approve / deny; requesting also locks money ----
    r = await call('ann', 'create', base({ name: 'Valley Sharps', join: { requests: true, open: true, max: 3 }, take: { kind: 'flat', v: 20 } })); ok(r); const g2 = r.j.group;
    r = await call('cat', 'mine'); ok(r); const og = r.j.open.find((x) => x.id === g2.id); assert.ok(og, 'listed in Open groups'); assert.strictEqual(og.takeText, 'Commissioner keeps $20 of the pot'); assert.ok(!og.members && !og.code);
    r = await call('cat', 'request', { id: g2.id }); ok(r); r = await call('dan', 'request', { id: g2.id }); ok(r);
    r = await call('ann', 'edit', { id: g2.id, name: 'Valley Sharps', join: { requests: true, open: true, max: 3, late: 'no' }, take: { kind: 'flat', v: 25 } }); assert.strictEqual(r.s, 409, 'a request alone locks the money');
    r = await call('cat', 'mine'); assert.ok(r.j.pending.some((x) => x.id === g2.id)); assert.ok(!r.j.open.some((x) => x.id === g2.id));
    r = await call('ann', 'get', { id: g2.id }); const [qc, qd] = r.j.group.reqs; assert.strictEqual(qc.name, 'CatCovers');
    r = await call('bob', 'decide', { id: g2.id, pid: qc.pid, ok: true }); assert.strictEqual(r.s, 403);
    r = await call('ann', 'decide', { id: g2.id, pid: qc.pid, ok: true }); ok(r); assert.strictEqual(r.j.group.members.length, 2);
    r = await call('cat', 'mine'); assert.ok(r.j.groups.some((x) => x.id === g2.id), 'approved member sees the group');
    r = await call('ann', 'decide', { id: g2.id, pid: qd.pid, ok: false }); ok(r); r = await call('dan', 'request', { id: g2.id }); assert.strictEqual(r.s, 409);
    t('request -> commissioner approves / denies; a request locks the money too; denied cannot re-ask');
    await call('bob', 'join', { code: g2.code }); r = await call('dan', 'join', { code: g2.code }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /full/); t('max members enforced');
    r = await call('ann', 'requests', { id: g2.id, on: false }); ok(r); assert.strictEqual(r.j.group.join.requests, false);
    r = await call('bob', 'leave', { id: g2.id }); ok(r); r = await call('ann', 'leave', { id: g2.id }); assert.strictEqual(r.s, 409); t('requests toggle; member can leave before start; commissioner cannot');
    r = await call('ann', 'create', base({ name: 'Late OK', join: { requests: false, open: false, max: 8, late: '2w' } })); ok(r); const g3 = r.j.group;
    // ---- FIX 5: 12 simultaneous joins on ONE group row, none lost ----
    G._reset(); r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe('p999'.padEnd(64, '0')), on: true }); ok(r, 'owner turns on enterprise');
    r = await call('p999', 'create', base({ name: 'Race', join: { max: 50 } })); ok(r); const g4 = r.j.group;
    slow = 15; lost = 0; const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => call('p' + (100 + i), 'join', { code: g4.code }, '3.3.' + i + '.1'))); slow = 0;
    rs.forEach((x) => ok(x, 'race join')); r = await call('p999', 'get', { id: g4.id }); assert.strictEqual(r.j.group.members.length, 13); assert.ok(lost > 0, 'the race really happened'); console.log('    (' + lost + ' conflicting writes were redone)');
    t('FIX 5: 12 simultaneous joins on one group row: none lost, none refused (randomized back-off, 16 tries)');
    G._reset(); let last; for (let i = 0; i < 6; i++) last = await call('eve', 'create', base({ name: 'Extra ' + i }), '4.4.4.4'); assert.strictEqual(last.s, 429); G._reset(); t('create rate limit (5 per hour per account)');
    // ================= rules lock at start (G2) =================
    NOW = START + 2 * HOUR;
    r = await call('ann', 'edit', { id: g2.id, name: 'X', join: { requests: true, open: true, max: 3, late: 'no' } }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /locked/);
    r = await call('ann', 'contest/edit', { id: g2.id, cid: C1(g2), contest: Object.assign({}, CDEF, { start: START + 7 * DAY }) }); assert.strictEqual(r.s, 409);
    r = await call('owner', 'edit', { id: g2.id }); assert.ok(r.s === 404 || r.s === 403);
    r = await call('ann', 'requests', { id: g2.id, on: true }); assert.strictEqual(r.s, 409); r = await call('cat', 'leave', { id: g2.id }); assert.strictEqual(r.s, 409); r = await call('ann', 'delete', { id: g2.id }); assert.strictEqual(r.s, 409);
    r = await call('ann', 'get', { id: g2.id }); assert.strictEqual(r.j.group.contests[0].locked, true);
    t('after start: edit / requests toggle / leave / delete refused for everyone, owner has no override');
    r = await call('dan', 'join', { code: g1.code }); assert.strictEqual(r.s, 409);
    NOW = START + 3 * DAY; r = await call('dan', 'join', { code: g3.code }); ok(r); NOW = START + 15 * DAY; r = await call('cat', 'join', { code: g3.code }); assert.strictEqual(r.s, 409);
    t('late joining: Not allowed / First 2 weeks');

    // ================= standings: SERVER grading, first-seen, freeze =================
    NOW = START - DAY; G._reset();
    r = await call('ann', 'create', base({ name: 'Scores', c: { cap: 100, minBets: 3, legs: 2 } })); ok(r); const S = r.j.group, SC = C1(S);
    for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: S.code }));
    const pre = START - 5 * HOUR;
    row(SID.bob, [
      { id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'sp', line: -3, stake: 200, odds: -110, fin: 'lost', finPL: -200 }, // phone says lost; server: NYG by 4 covers -3 -> +181.82, capped 100 -> +90.91
      { id: bid(pre + 1), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 50, odds: 150, fin: 'won', finPL: 75 }, // phone says won; KC lost -> -50
      { id: 'k-KXNFLGAME-26NOV22KCBUF-BUF-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-BUF', ks: 'yes', text: 'Buffalo · Kansas City at Buffalo winner', stake: 40, mult: 2, day: '2026-11-21' }, // Kalshi moneyline BUF -> +40
      { id: bid(pre + 2), kind: 'prop', text: 'Allen over 250 pass yds', stake: 30, odds: -110, res: 'won', day: '2026-11-22' }, // props off
      { id: bid(pre + 3), kind: 'parlay', legs: [{ gid: '501', side: 'NYG', type: 'ml' }, { gid: '502', side: 'BUF', type: 'ml' }, { gid: '504', side: 'SF', type: 'ml' }], stake: 10, mult: 6, day: '2026-11-22' }, // 3 legs > 2
      { id: bid(pre + 4), lg: 'nba', gid: '701', day: '2026-11-22', side: 'BOS', type: 'ml', stake: 20, odds: -110 }, // other sport
      { id: bid(Z('2026-11-15T12:00:00Z')), gid: '400', away: 'DAL', home: 'NYG', day: '2026-11-15', side: 'NYG', type: 'ml', stake: 100, odds: -110, fin: 'won', finPL: 90.91 }, // before the contest
    ]);
    row(SID.cat, [
      { id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'DAL', type: 'sp', line: 3, stake: 100, odds: -110 }, // DAL +3, lost by 4 -> -100
      { id: bid(pre + 9), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'BUF', type: 'ml', stake: 100, odds: -200 }, // +50
      { id: bid(pre + 10), gid: '503', away: 'GB', home: 'CHI', day: '2026-11-29', side: 'CHI', type: 'sp', line: 2.5, stake: 75, odds: -110 }, // next week: SECRET PICK
    ]);
    row(SID.dan, [
      { id: bid(pre), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'BUF', type: 'ml', stake: 10, odds: 300 }, // +30
      { id: bid(pre + 1), gid: '504', away: 'SF', home: 'LAR', day: '2026-11-22', side: 'Under', type: 'ou', line: 44.5, stake: 10, odds: -110 }, // total 44 -> +9.09
      { id: bid(pre + 2), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 10, odds: 120 }, // +12
    ]);
    NOW = START - HOUR; ok(await call('ann', 'standings', { id: S.id, cid: SC }), 'pre-kickoff read records first-seen');
    // FIX 2: a bet that first reaches the server after kickoff never counts (row written 2 h after kickoff)
    NOW = START + 2 * HOUR; db[SID.bob].data.bets.push({ id: bid(START - 10 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 100, odds: -110 }); db[SID.bob].updated = NOW;
    G._reset(); ok(await call('ann', 'standings', { id: S.id, cid: SC }));
    NOW = Z('2026-11-23T12:00:00Z'); G._reset();
    r = await call('bob', 'standings', { id: S.id, cid: SC, scope: 'season' }); ok(r); let rows = r.j.rows; const by = (n) => rows.find((x) => x.name === n);
    assert.strictEqual(by('BobBets').t.win, 80.91, 'bob: +90.91 (capped) - 50 + 40 = 80.91 (server-graded, the phone results ignored)'); assert.strictEqual(by('BobBets').t.w, 2); assert.strictEqual(by('BobBets').t.l, 1);
    assert.strictEqual(by('CatCovers').t.win, -50); assert.strictEqual(by('DanDog').t.win, 51.09); assert.strictEqual(by('AnnTheCommish').t.win, 0);
    assert.deepStrictEqual(rows.map((x) => x.name), ['BobBets', 'DanDog', 'AnnTheCommish', 'CatCovers']);
    assert.strictEqual(by('BobBets').t.stake, 190); assert.strictEqual(by('BobBets').t.ret, 42.6);
    assert.strictEqual(by('CatCovers').t.short, true); assert.strictEqual(by('DanDog').t.short, false);
    t('FIX 1: every counted bet graded by the server from ESPN finals (spread, moneyline, total, Kalshi moneyline); phone "won/lost" ignored; cap; filters; min-bets flag');
    assert.strictEqual(r.j.high[0].name, 'BobBets'); t('weekly high score skips members under the weekly minimum');
    r = await call('bob', 'player', { id: S.id, cid: SC, pid: by('CatCovers').pid }); ok(r); assert.strictEqual(r.j.hidden, 1); assert.ok(!r.j.bets.some((b) => /GB|CHI/.test(b.what)));
    assert.ok(!raw.some((x) => /GB@CHI|CHI \+2\.5/.test(x)), 'never in any response so far');
    r = await call('cat', 'player', { id: S.id, cid: SC, pid: by('CatCovers').pid }); ok(r); assert.ok(r.j.bets.some((b) => /GB@CHI/.test(b.what)));
    NOW = Z('2026-11-29T18:01:00Z'); G._reset(); r = await call('bob', 'player', { id: S.id, cid: SC, pid: by('CatCovers').pid }); ok(r); assert.strictEqual(r.j.hidden, 0); assert.ok(r.j.bets.some((b) => /GB@CHI/.test(b.what)));
    t('G6: another member\'s bet is never returned before its game kicks off; the bettor sees it');
    r = await call('bob', 'player', { id: S.id, cid: SC, pid: by('BobBets').pid }); ok(r); const why = r.j.bets.filter((b) => !b.ok).map((b) => b.why).sort();
    assert.deepStrictEqual(why, ['More than 2 legs', "Not in this contest's sport", 'Synced after the game started', 'This kind of bet does not count here']); assert.ok(r.j.bets.find((b) => b.capped && b.cs === 100 && b.pl === 90.91));
    r = await call('cat', 'player', { id: S.id, cid: SC, pid: by('BobBets').pid }); assert.ok(r.j.bets.every((b) => b.ok));
    t('FIX 2: a bet first synced after kickoff never counts ("Synced after the game started"); own drill-down explains every not-counted bet');
    db[SID.bob].data.bets = db[SID.bob].data.bets.filter((b) => b.gid !== '502'); db[SID.bob].updated = NOW; G._reset();
    r = await call('bob', 'standings', { id: S.id, cid: SC }); assert.strictEqual(r.j.rows.find((x) => x.name === 'BobBets').t.win, 80.91); t('G11: a counted bet deleted on the phone still counts (contest ledger)');
    // FIX 4: restart + ESPN no longer lists the games: nothing changes
    const keep = GAMES; GAMES = GAMES.filter((g) => !['501', '502', '504'].includes(g.id)); G._reset(); r = await call('bob', 'standings', { id: S.id, cid: SC }); GAMES = keep;
    assert.deepStrictEqual(r.j.rows.map((x) => [x.name, x.t.win, x.t.n]), rows.map((x) => [x.name, x.t.win, x.t.n]).map((x) => (x[0] === 'CatCovers' ? [x[0], x[1], x[2]] : x)));
    const L = db['lock:gl:' + S.id + ':' + SC].data.b; const anyE = Object.values(L).flatMap((p) => Object.values(p)); assert.ok(anyE.every((e) => Object.values(e.r || {}).every((x) => Number.isFinite(x.kick))), 'kickoffs stored in the ledger');
    t('FIX 4: after a restart with the games gone from ESPN, standings are identical (kickoffs and results stored in the ledger, never re-decided from the day)');

    // ---- FIX 2: edits after kickoff ignored; first-seen from the row's server-stamped write time; the server tick ----
    NOW = START - DAY; G._reset(); Object.values(SID).forEach((x) => row(x, [])); r = await call('ann', 'create', base({ name: 'Freeze' })); const F = r.j.group, FC = C1(F); await call('bob', 'join', { code: F.code }); await call('cat', 'join', { code: F.code });
    row(SID.bob, [{ id: bid(START - 9 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'DAL', type: 'ml', stake: 50, odds: -110 }], START - 3 * HOUR);
    NOW = START - HOUR; G._reset(); await call('ann', 'standings', { id: F.id, cid: FC });
    NOW = START + 3 * HOUR; Object.assign(db[SID.bob].data.bets[0], { side: 'NYG', stake: 500, odds: 300, fin: 'won', finPL: 1500 }); db[SID.bob].updated = NOW; // switched to the winner after kickoff
    // cat: bet written to her row BEFORE kickoff, but the server first reads it after kickoff: still counts (row stamped before kickoff = the bet existed then)
    row(SID.cat, [{ id: bid(START - 4 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 20, odds: -110 }], START - 30 * 6e4);
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('ann', 'standings', { id: F.id, cid: FC });
    assert.strictEqual(r.j.rows.find((x) => x.name === 'BobBets').t.win, -50, 'bob counted as DAL $50 (frozen at kickoff), not NYG $500 at +300');
    assert.strictEqual(r.j.rows.find((x) => x.name === 'CatCovers').t.win, 18.18, 'cat counts: her row was written before kickoff');
    t('FIX 2: side/line/odds/stake frozen at kickoff (edit after kickoff ignored); first-seen = the server-stamped write time of the member\'s synced row');
    // tick: sees a bet before kickoff even if nobody opens Groups, so a later write after kickoff does not hide it
    NOW = START - DAY; G._reset(); Object.values(SID).forEach((x) => row(x, [])); r = await call('ann', 'create', base({ name: 'Tick' })); const K = r.j.group, KC = C1(K); await call('dan', 'join', { code: K.code });
    row(SID.dan, [{ id: bid(START - 6 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 10, odds: -110 }], START - 50 * 6e4);
    NOW = START - 40 * 6e4; G._reset(); const tk = await G.tick(); assert.ok(tk.observed >= 1, 'tick observed contests: ' + JSON.stringify(tk));
    NOW = START + HOUR; db[SID.dan].data.bets.push({ id: bid(START + HOUR), kind: 'prop', text: 'later prop', stake: 5, day: '2026-11-22' }); db[SID.dan].updated = NOW;
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('ann', 'standings', { id: K.id, cid: KC }); assert.strictEqual(r.j.rows.find((x) => x.name === 'DanDog').t.win, 9.09, 'counted thanks to the tick');
    // control: same thing without the tick -> not counted (honest limit, documented)
    NOW = START - DAY; G._reset(); r = await call('ann', 'create', base({ name: 'NoTick' })); const K2 = r.j.group; await call('dan', 'join', { code: K2.code });
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('ann', 'standings', { id: K2.id, cid: C1(K2) }); assert.strictEqual(r.j.rows.find((x) => x.name === 'DanDog').t.win, 0, 'without the tick the server first saw it after kickoff');
    t('FIX 2: the server tick records first-seen before kickoff (control without the tick: the bet does not count = documented limit)');

    // ---- FIX 1: fake results; honor-system rule ----
    NOW = START - DAY; G._reset(); Object.values(SID).forEach((x) => row(x, [])); r = await call('ann', 'create', base({ name: 'Fakes', c: { types: { sp: true, ml: true, ou: true, prop: true, parlay: true } } })); const FK = r.j.group; await call('bob', 'join', { code: FK.code });
    r = await call('ann', 'create', base({ name: 'Honor', c: { honor: true, types: { sp: true, ml: true, ou: true, prop: true, parlay: true } } })); const HO = r.j.group; await call('bob', 'join', { code: HO.code });
    row(SID.bob, [
      { id: 'k-FAKE-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-KC', ks: 'yes', text: 'fake', stake: 1, mult: 10000, res: 'won', day: '2026-11-22' }, // KC lost: graded lost, the +$9,999 claim ignored
      { id: 'k-FAKE2-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-BUF', ks: 'yes', text: 'fake cash', stake: 1, mult: 1.5, res: 'won', cash: 10000, day: '2026-11-22' }, // cash-out: cannot be checked
      { id: bid(START - 7 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'DAL', type: 'ml', stake: 5, odds: -110, fin: 'won', finPL: 9999 }, // DAL lost
      { id: bid(START - 8 * HOUR), kind: 'prop', text: 'Allen 3+ TDs', pp: { gid: '502' }, stake: 10, odds: 200, res: 'won', day: '2026-11-22' }, // prop on KC@BUF: honor only
    ], START - 2 * HOUR);
    NOW = Z('2026-11-23T12:00:00Z'); G._reset();
    r = await call('bob', 'standings', { id: FK.id, cid: C1(FK) }); bb = r.j.rows.find((x) => x.name === 'BobBets'); assert.strictEqual(bb.t.win, -6, 'fake winners graded as losses (-1, -5), cash-out and prop not counted');
    r = await call('bob', 'player', { id: FK.id, cid: C1(FK), pid: bb.pid }); assert.ok(r.j.bets.some((b) => !b.ok && /can't check/.test(b.why) && /Cashed out/.test(b.why))); assert.ok(r.j.bets.some((b) => !b.ok && /can't check/.test(b.why) && /Player prop/.test(b.why)));
    r = await call('bob', 'standings', { id: HO.id, cid: C1(HO) }); bb = r.j.rows.find((x) => x.name === 'BobBets');
    assert.strictEqual(bb.t.win, 10013, 'honor ON: -1 (KC graded) + 9999 (cash-out, honor) - 5 (DAL graded) + 20 (prop, honor) = 10013');
    t('FIX 1: a fake Kalshi bet claiming +$9,999 is graded from the final score (lost); cash-outs/props do not count unless the commissioner turned on the honor rule (then they count on the phone\'s word)');
    // ---- per-league grading (G12), all sports contest ----
    NOW = START - DAY; G._reset(); const A = (await call('ann', 'create', base({ name: 'All sports', c: { sport: 'all', types: { sp: true, ml: true, ou: true, prop: false, parlay: true } } }))).j.group, AC = C1(A); await call('eve', 'join', { code: A.code });
    row(SID.eve, [
      { id: 'e1', gid: '505', away: 'WAS', home: 'PHI', day: '2026-11-22', side: 'WAS', type: 'sp', line: 7.5, stake: 10, odds: -110 }, // NFL, app abbr WAS vs ESPN WSH: lost by 20 -> -10
      { id: 'e2', gid: '601', away: 'ALA', home: 'AUB', day: '2026-11-28', side: 'ALA', type: 'ml', stake: 10, odds: -150 }, // college football (no lg: found by id) -> +6.67
      { id: 'e3', lg: 'nba', gid: '701', away: 'LAL', home: 'BOS', day: '2026-11-22', side: 'Over', type: 'ou', line: 214.5, stake: 10, odds: -110 }, // 215 > 214.5 -> +9.09
      { id: 'e4', lg: 'mlb', gid: '801', away: 'NYY', home: 'BOS', day: '2026-11-22', side: 'NYY', type: 'sp', line: -1.5, stake: 10, odds: 140 }, // run line, won by 2 -> +14
      { id: 'e5', lg: 'nhl', gid: '901', away: 'TOR', home: 'MTL', day: '2026-11-22', side: 'TOR', type: 'sp', line: -1.5, stake: 10, odds: 180 }, // puck line, won by 1 -> -10
      { id: 'e6', lg: 'ncaab', gid: '951', away: 'DUKE', home: 'UNC', day: '2026-11-22', side: 'DUKE', type: 'sp', line: 3, stake: 10, odds: -110 }, // lost by 3 +3 = push -> 0
      { id: 'e7', kind: 'parlay', legs: [{ gid: '501', side: 'NYG', type: 'ml' }, { gid: '502', side: 'BUF', type: 'sp', line: -3 }], stake: 10, mult: 3.64, day: '2026-11-22' }, // push leg drops out -> 10*(3.64^(1/2)-1) = 9.08
      { id: 'e8', kind: 'parlay', legs: [{ gid: '501', side: 'NYG', type: 'ml', o: -150 }, { lg: 'nba', gid: '701', side: 'BOS', type: 'ml', o: 120 }], stake: 10, mult: 3.67, day: '2026-11-22' }, // own leg prices: 10*(1.6667*2.2-1)=26.67
      { id: 'e9', kind: 'parlay', src: 'kalshi', kt: 'KXMVENFLMULTIGAME-26NOV22-XYZ', ks: 'yes', legs: [{ text: 'Dallas to win', day: '2026-11-22', k: 1 }, { text: 'Buffalo to win', day: '2026-11-22', k: 1 }], stake: 10, mult: 3.5, day: '2026-11-22' }, // Dallas lost -> -10
      { id: 'k-KXNFLSPREAD-26NOV22KCBUF-BUF3-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLSPREAD-26NOV22KCBUF-BUF3', ks: 'yes', text: 'Buffalo wins by over 2.5 points · Kansas City at Buffalo', stake: 10, mult: 2.2, day: '2026-11-22' }, // +12
      { id: 'k-bad', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV99XXYY-XX', ks: 'yes', text: 'malformed ticker date', stake: 10, mult: 2, res: 'won', day: '2026-11-22' }, // must not break the standings
      { id: 'k-KXNFLTOTAL-26NOV22KCBUF-51-no', kind: 'prop', src: 'kalshi', kt: 'KXNFLTOTAL-26NOV22KCBUF-51', ks: 'no', text: 'Over 50.5 points scored · Kansas City at Buffalo', stake: 10, mult: 2, day: '2026-11-22' }, // 51 > 50.5, NO loses -> -10
    ], START - 2 * HOUR);
    NOW = Z('2026-11-29T12:00:00Z'); G._reset(); r = await call('eve', 'player', { id: A.id, cid: AC, pid: (await call('eve', 'get', { id: A.id })).j.group.me });
    const E = Object.fromEntries(r.j.bets.map((b) => [b.id, b])); const exp = { e1: ['lost', -10], e2: ['won', 6.67], e3: ['won', 9.09], e4: ['won', 14], e5: ['lost', -10], e6: ['push', 0], e7: ['won', 9.08], e8: ['won', 26.67], e9: ['lost', -10], 'k-KXNFLSPREAD-26NOV22KCBUF-BUF3-yes': ['won', 12], 'k-KXNFLTOTAL-26NOV22KCBUF-51-no': ['lost', -10] };
    assert.ok(E['k-bad'] && !E['k-bad'].ok, 'malformed Kalshi ticker listed as not counted, standings still served');
    Object.keys(exp).forEach((k) => { assert.ok(E[k], 'bet ' + k + ' listed'); assert.deepStrictEqual([E[k].res, E[k].pl, E[k].gr], [exp[k][0], exp[k][1], 'srv'], k + ' ' + JSON.stringify(E[k])); });
    t('G12: server grades NFL spread (WSH/WAS), college football moneyline, NBA total, MLB run line, NHL puck line, college basketball spread push, parlay with a push leg, parlay at its own leg prices, Kalshi combo by team name, Kalshi spread and total');
    const NB = (await call('ann', 'create', base({ name: 'NBA only', c: { sport: 'nba', start: START - DAY + 2 * 6e4 } }))); // (start in the past is refused)
    assert.strictEqual(NB.s, 400);
    NOW = Z('2026-11-21T12:00:00Z'); G._reset(); const NBG = (await call('ann', 'create', base({ name: 'NBA only', c: { sport: 'nba', start: Z('2026-11-22T06:00:00Z') } }))).j.group; await call('eve', 'join', { code: NBG.code });
    NOW = Z('2026-11-29T12:00:00Z'); G._reset(); r = await call('eve', 'player', { id: NBG.id, cid: C1(NBG), pid: (await call('eve', 'get', { id: NBG.id })).j.group.me });
    assert.ok(r.j.bets.filter((b) => b.ok).every((b) => b.id === 'e3'), 'only the NBA bet counts'); assert.ok(r.j.bets.some((b) => b.id === 'e1' && /not found in NBA games/.test(b.why))); assert.ok(r.j.bets.some((b) => b.id === 'e4' && /sport/.test(b.why)));
    t('G12: an NBA contest counts only NBA games; others say "Not in this contest\'s sport"');
    // ---- FIX 3: Kalshi bet filed on its purchase day; unknown kickoff hidden until graded ----
    NOW = START - DAY; G._reset(); Object.values(SID).forEach((x) => row(x, [])); const V = (await call('ann', 'create', base({ name: 'Peek', c: { honor: true, types: { sp: true, ml: true, ou: true, prop: true, parlay: true } } }))).j.group; await call('bob', 'join', { code: V.code });
    row(SID.bob, [{ id: 'k-KXNFLGAME-26NOV29GBCHI-CHI-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV29GBCHI-CHI', ks: 'yes', text: 'Chicago · Green Bay at Chicago', stake: 20, mult: 2, day: '2026-11-22' },
      { id: bid(START - 3 * HOUR), kind: 'prop', lg: 'nfl', text: 'Secret prop pick', stake: 5, odds: 100, day: '2026-11-22' },
      { id: bid(START - 4 * HOUR), kind: 'parlay', legs: [{ gid: '501', side: 'DAL', type: 'ml' }, { gid: '504', side: 'SF', type: 'ml' }], stake: 10, mult: 3.6, day: '2026-11-22' }], START - 2 * HOUR);
    NOW = START + 4 * HOUR; G._reset(); const bp = (await call('ann', 'get', { id: V.id })).j.group.members.find((m) => m.name !== 'AnnTheCommish').pid;
    raw = []; r = await call('ann', 'player', { id: V.id, cid: C1(V), pid: bp }); assert.strictEqual(r.j.hidden, 3, 'all three hidden'); assert.ok(!/Chicago|Secret prop|parlay/.test(raw.join('')), 'never sent');
    t('FIX 3 + FIX 9: Kalshi bet filed on its purchase day is mapped to its game (Nov 29) and hidden; a bet with unknown kickoff is hidden; a parlay stays hidden until its LAST leg kicks off (leg 1 already lost)');
    NOW = Z('2026-11-23T01:21:00Z'); G._reset(); r = await call('ann', 'player', { id: V.id, cid: C1(V), pid: bp }); assert.ok(r.j.bets.some((b) => /parlay/.test(b.what)), 'parlay shown after its last leg kicked off'); assert.ok(!r.j.bets.some((b) => /Secret/.test(b.what)), 'prop with unknown kickoff still hidden (not settled)');
    db[SID.bob].data.bets[1].res = 'won'; NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('ann', 'player', { id: V.id, cid: C1(V), pid: bp }); assert.ok(r.j.bets.some((b) => /Secret/.test(b.what)), 'shown once settled and its day is over');
    assert.ok(!r.j.bets.some((b) => /Chicago/.test(b.what))); r = await call('bob', 'standings', { id: V.id, cid: C1(V) }); assert.ok(r.j.rows.find((x) => x.name === 'BobBets').t.open >= 1, 'open-bet counts stay visible (count only)');
    t('unknown-kickoff bets appear only once settled; other members\' open-bet COUNTS stay visible');
    // ================= FIX 7: fewest bets to place; ties; prize split =================
    NOW = START - DAY; G._reset(); Object.values(SID).forEach((x) => row(x, [])); const M7 = (await call('ann', 'create', base({ name: 'Return', c: { metric: 'ret', minPaid: 10 } }))).j.group; await call('bob', 'join', { code: M7.code });
    row(SID.ann, Array.from({ length: 12 }, (_, i) => ({ id: 'a' + i, gid: i < 9 ? '501' : '502', away: 'X', home: 'Y', day: '2026-11-22', side: i < 9 ? 'NYG' : 'KC', type: 'ml', stake: 100, odds: -110 })), START - 2 * HOUR);
    row(SID.bob, [{ id: 'b1', gid: '501', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 5, odds: 400 }], START - 2 * HOUR);
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('ann', 'standings', { id: M7.id, cid: C1(M7) }); rows = r.j.rows;
    assert.strictEqual(rows[0].name, 'AnnTheCommish'); assert.strictEqual(rows[1].name, 'BobBets'); assert.strictEqual(rows[1].under, true); assert.ok(rows[1].t.ret > rows[0].t.ret, 'Bob has the better return but only 1 bet'); assert.strictEqual(rows[1].owed, 0);
    t('FIX 7: under "fewest bets to place in a paid spot" (10) a 1-bet member ranks below everyone who meets it, flagged, owed nothing');
    const pr = G.prizes([{ pid: 'a', place: 1, t: { minOk: true, settled: 3 } }, { pid: 'b', place: 1, t: { minOk: true, settled: 3 } }, { pid: 'c', place: 3, t: { minOk: true, settled: 3 } }], [{ c: 6001 }, { c: 3000 }, { c: 1000 }]);
    assert.deepStrictEqual(pr, { a: 45.01, b: 45, c: 10 });
    const rk = G.rank([{ pid: 'zz', name: 'Aaron', t: { minOk: true, val: 10, ret: 5 } }, { pid: 'aa', name: 'Zed', t: { minOk: true, val: 10, ret: 5 } }, { pid: 'mm', name: 'Mid', t: { minOk: true, val: 10, ret: 9 } }]);
    assert.deepStrictEqual(rk.map((x) => [x.name, x.place, x.tied]), [['Mid', 1, false], ['Zed', 2, true], ['Aaron', 2, true]]);
    t('ties: same metric goes to Return %; still tied = same place and the places\' money split evenly in cents (extra cent to the higher place), never alphabetical');
    // ================= metrics, Kalshi-only, Best five =================
    const mk = async (metric, extra, cm) => { NOW = START - DAY; G._reset(); const x = (await call(cm || 'ann', 'create', base({ name: 'M ' + metric, c: Object.assign({ metric }, extra || {}) }))).j.group; for (const w of ['bob', 'cat', 'dan']) await call(w, 'join', { code: x.code }); NOW = Z('2026-11-23T12:00:00Z'); G._reset(); return (await call(cm || 'ann', 'standings', { id: x.id, cid: C1(x) })).j.rows; };
    const mlb = (n, gid, side, stake, odds, extra) => Object.assign({ id: 'm' + n, gid, day: '2026-11-22', side, type: 'ml', stake, odds }, extra || {});
    row(SID.ann, []); row(SID.bob, [mlb(1, '501', 'NYG', 100, -110), mlb(2, '502', 'KC', 100, -110)]); row(SID.cat, [mlb(1, '501', 'NYG', 10, 400)]); row(SID.dan, [mlb(1, '501', 'NYG', 200, -110), mlb(2, '502', 'KC', 100, -110), mlb(3, '504', 'LAR', 100, -110)]);
    rows = await mk('win'); assert.deepStrictEqual(rows.map((x) => x.name), ['CatCovers', 'AnnTheCommish', 'BobBets', 'DanDog']);
    rows = await mk('units'); assert.deepStrictEqual(rows.map((x) => x.name), ['CatCovers', 'AnnTheCommish', 'BobBets', 'DanDog']); assert.strictEqual(rows[0].t.val, 4);
    rows = await mk('ret'); assert.strictEqual(rows[0].name, 'CatCovers'); assert.deepStrictEqual(rows.slice(1, 3).map((x) => x.name).sort(), ['BobBets', 'DanDog']); assert.strictEqual(rows[1].place, rows[2].place, 'Bob and Dan tie at -4.5%: same place'); assert.strictEqual(rows[3].name, 'AnnTheCommish');
    rows = await mk('pct'); assert.deepStrictEqual(rows.map((x) => x.name.slice(0, 3)), ['Cat', 'Bob', 'Dan', 'Ann']);
    row(SID.ann, [mlb(1, '501', 'NYG', 100, -110), mlb(2, '502', 'KC', 50, -110)]); rows = await mk('pct'); assert.strictEqual(rows[1].name, 'AnnTheCommish'); assert.strictEqual(rows[2].name, 'BobBets');
    t('ranking by Winnings / Units / Return % / Win %, tiebreak Return %');
    row(SID.bob, [mlb(1, '501', 'NYG', 40, -110), { id: 'k-x', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-BUF', ks: 'yes', text: 'Buffalo', stake: 40, mult: 2, day: '2026-11-22' }]);
    rows = await mk('win', { kalshi: true }, 'p901'); assert.strictEqual(rows.find((x) => x.name === 'BobBets').t.win, 40); assert.strictEqual(rows.find((x) => x.name === 'DanDog').t.n, 0);
    t('"Kalshi-synced bets only" = only bets synced from the member\'s own Kalshi account (still graded by the server)');
    const seven = [[3, 'NYG'], [0, 'DAL'], [3, 'NYG'], [1.1, 'NYG'], [1.3, 'NYG'], [1.8, 'NYG'], [0, 'DAL']].map(([m, s], i) => mlb(10 + i, '501', s, i === 6 ? 2 : 10, -110, m ? { mult: m } : {})); seven[2].mult = 1.5;
    row(SID.bob, seven); rows = await mk('win', { fmt: 'best5' }, 'p902'); bb = rows.find((x) => x.name === 'BobBets'); assert.strictEqual(bb.t.win, 37, 'best five of 7: 20+8+5+3+1'); assert.strictEqual(bb.t.w + bb.t.l, 5);
    t('Best five: only the five best results of the week count');
    // ================= G13: contests and pots =================
    NOW = START - 3 * DAY; G._reset();
    r = await call('eve', 'create', base({ name: 'Pots', take: { kind: 'pct', v: 10 }, c: { entry: 25, split: '60/30/10' } })); const PG = r.j.group;
    r = await call('eve', 'contest/add', { id: PG.id, contest: Object.assign({}, CDEF, { cname: 'NBA picks', pot: 'main', sport: 'nba', entry: 10, split: '100' }), msplit: { kind: '60/40' } }); ok(r, 'second main contest');
    let pg = r.j.group; assert.strictEqual(pg.contests.length, 2); assert.deepStrictEqual(Object.values(pg.money.msplit.pct), [60, 40]);
    r = await call('eve', 'contest/add', { id: PG.id, contest: Object.assign({}, CDEF, { cname: 'Side NHL', pot: 'side', sport: 'nhl', start: START + 2 * DAY, entry: 20, split: '100', take: { kind: 'pct', v: 10 } }) }); ok(r, 'side pot'); pg = r.j.group; const side = pg.contests.find((c) => c.pot === 'side');
    r = await call('eve', 'contest/add', { id: PG.id, contest: { kind: 'calcutta' } }); assert.strictEqual(r.s, 400); assert.match(r.j.error, /coming soon/i);
    for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: pg.code }));
    r = await call('bob', 'sidepot', { id: PG.id, cid: side.cid, on: true }); ok(r); r = await call('cat', 'sidepot', { id: PG.id, cid: side.cid, on: true }); ok(r);
    r = await call('dan', 'sidepot', { id: PG.id, cid: 'nope', on: true }); assert.strictEqual(r.s, 404);
    pg = (await call('eve', 'get', { id: PG.id })).j.group; for (const m of pg.members) await call('eve', 'paid', { id: PG.id, pid: m.pid, paid: true });
    for (const m of pg.members.filter((m) => m.sides.length)) await call('eve', 'paid', { id: PG.id, pid: m.pid, cid: side.cid, paid: true });
    r = await call('dan', 'paid', { id: PG.id, pid: pg.members[3].pid, cid: side.cid, paid: true }); assert.strictEqual(r.s, 403);
    r = await call('eve', 'paid', { id: PG.id, pid: pg.members.find((m) => m.name === 'DanDog').pid, cid: side.cid, paid: true }); assert.strictEqual(r.s, 404, 'Dan is not in the side pot');
    pg = (await call('eve', 'get', { id: PG.id })).j.group; const Pm = pg.pots.main, Ps = pg.pots.sides[0];
    assert.deepStrictEqual([Pm.entry, Pm.paid, Pm.pot, Pm.take, Pm.pool], [35, 4, 140, 14, 126], 'main pot: 4 x (25 + 10) = 140, take 10% = 14, pool 126');
    assert.deepStrictEqual(Pm.shares.map((s) => [s.pct, s.amt]), [[60, 75.6], [40, 50.4]]); assert.deepStrictEqual(Pm.shares[0].places.map((p) => p.amt), [45.36, 22.68, 7.56]); assert.deepStrictEqual(Pm.shares[1].places.map((p) => p.amt), [50.4]);
    assert.deepStrictEqual([Ps.members, Ps.paid, Ps.pot, Ps.take, Ps.pool, Ps.places[0].amt], [3, 3, 60, 6, 54, 54], 'side pot: Eve + Bob + Cat x 20 = 60, own take 10%');
    t('G13: a group holds several contests: main pot = entries of main-pot contests, commissioner\'s take off the top, 60/40 split between them, each split by its own places; side pot with its own entry, take, opt-ins and paid marks; Calcutta "coming soon"');
    r = await call('bob', 'standings', { id: PG.id, cid: side.cid }); ok(r); assert.strictEqual(r.j.rows.length, 3, 'side pot standings: only opted-in members');
    r = await call('dan', 'player', { id: PG.id, cid: side.cid, pid: r.j.rows[0].pid }); ok(r, 'members can view side pot players');
    NOW = START + HOUR; r = await call('dan', 'sidepot', { id: PG.id, cid: side.cid, on: true }); assert.strictEqual(r.s, 200, 'NHL side pot starts at its own time');
    const mainC = pg.contests[0].cid; r = await call('eve', 'contest/edit', { id: PG.id, cid: mainC, contest: Object.assign({}, CDEF, { cname: 'X' }) }); assert.strictEqual(r.s, 409, 'main contest locked at its own start');
    t('side pot standings list only opted-in members; each contest locks at its own start');
    // ================= FIX 8: performance =================
    NOW = START - DAY; G._reset(); for (let i = 0; i < 4; i++) { const x = (await call('cat', 'create', base({ name: 'Perf' + i }))).j.group; await call('bob', 'join', { code: x.code }); await call('dan', 'join', { code: x.code }); }
    NOW = START + HOUR; G._reset(); maxIn = 0; ok(await call('cat', 'mine')); assert.ok(maxIn > 2, 'parallel reads during /mine: ' + maxIn);
    const syncSrc = fs.readFileSync(path.join(__dirname, 'sync.js'), 'utf8'); assert.ok(/oddable_sync\?select=id,updated,data&id=not\.like\.lock:\*&limit=2000/.test(syncSrc), 'player list query filters lock rows in the database'); assert.ok(/oddable_sync\?select=id&id=not\.like\.lock:\*&limit=5000/.test(syncSrc), 'dbIds filters lock rows');
    t('FIX 8: /groups/mine reads groups and members in parallel (max ' + maxIn + ' at once); sync.js player-list and dbIds queries filter lock: rows in the database');
    // ================= FIX 9: synced-bets link refreshed =================
    NOW = START - DAY; G._reset(); const LN = (await call('ann', 'create', base({ name: 'Link' }))).j.group; const nosid = 'f'.repeat(8) + '0'.repeat(56); delete db[nosid];
    D.acct = ((A) => () => Object.assign(A(), { who: (req) => (String(req.headers['x-token']) === 't-nos' ? pe(nosid) : A().who(req)) }))(D.acct);
    await call('nos', 'join', { code: LN.code }); r = await call('ann', 'get', { id: LN.id }); assert.ok(r.j.group.members.some((m) => m.noBets), 'joined before having a sync row');
    row(nosid, []); NOW += 2 * 6e4; await call('nos', 'mine'); r = await call('ann', 'get', { id: LN.id }); assert.ok(!r.j.group.members.some((m) => m.noBets), 'linked when they next opened Groups');
    t('FIX 9: a member who joined before syncing bets is linked to their synced bets the next time they open Groups');
    const html = fs.readFileSync(path.join(__dirname, '../pics/index.html'), 'utf8'); assert.ok(/if \(!\(window\.MIRROR \|\| \/\[\?&\]mirror=1\/\.test\(location\.search\)\)\) it\.push\(\['groups'/.test(html), 'Groups nav item only outside mirror mode');
    const cj = fs.readFileSync(path.join(__dirname, '../pics/groups.js'), 'utf8'); assert.ok(!/nobody can add a winner/i.test(cj) && !/Verified only/.test(cj) && /graded by Oddable from final scores/.test(cj) && /Kalshi-synced bets only/.test(cj) && /honor system/.test(cj) && /Tuesday to Monday/.test(cj));
    t('FIX 9 + FIX 1 wording: Groups hidden in mirror mode; "Verified only" -> "Kalshi-synced bets only"; "graded by Oddable from final scores"; honor rule; Tue-Mon weeks for every sport');
    // ================= G15: 8 people per group (standard), enterprise, extra seats, contact =================
    NOW = START - 2 * DAY; G._reset(); r = await call('p300', 'create', base({ name: 'Eight', join: { requests: true, max: 8 } })); ok(r); const E8 = r.j.group;
    for (let i = 1; i <= 6; i++) ok(await call('p30' + i, 'join', { code: E8.code }), 'member ' + (i + 1));
    r = await call('p310', 'request', { id: E8.id }); ok(r, 'a request while 7 of 8'); r = await call('p311', 'request', { id: E8.id }); ok(r);
    r = await call('p307', 'join', { code: E8.code }); ok(r, '8th person (commissioner counts) joins');
    r = await call('p308', 'join', { code: E8.code }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /full \(8 people\).*\$500\/month \+ \$20 per player per game/);
    r = await call('p312', 'request', { id: E8.id }); assert.strictEqual(r.s, 409, 'request refused when full');
    let q8 = (await call('p300', 'get', { id: E8.id })).j.group.reqs; r = await call('p300', 'decide', { id: E8.id, pid: q8[0].pid, ok: true }); assert.strictEqual(r.s, 409, 'approve refused when full'); assert.strictEqual((await call('p300', 'get', { id: E8.id })).j.group.members.length, 8);
    // approve race: 7 of 8, two approvals at once -> exactly one gets in
    r = await call('p300', 'create', base({ name: 'Race8', join: { requests: true, max: 8 } })); const R8 = r.j.group; for (let i = 1; i <= 6; i++) await call('p32' + i, 'join', { code: R8.code }); await call('p330', 'request', { id: R8.id }); await call('p331', 'request', { id: R8.id }); await call('p332', 'join', { code: 'x' });
    q8 = (await call('p300', 'get', { id: R8.id })).j.group.reqs; slow = 10; const ap = await Promise.all([call('p300', 'decide', { id: R8.id, pid: q8[0].pid, ok: true }), call('p300', 'decide', { id: R8.id, pid: q8[1].pid, ok: true }), call('p333', 'join', { code: R8.code })]); slow = 0;
    assert.strictEqual(ap.filter((x) => x.s === 200).length, 1, 'exactly one of the three got the 8th seat: ' + ap.map((x) => x.s)); assert.strictEqual((await call('p300', 'get', { id: R8.id })).j.group.members.length, 8);
    t('G15: 8 people per group on a standard account, commissioner included: 8th joins, 9th join / request / approval refused with the shared enterprise text; a join + approve race fills exactly one seat');
    r = await call('p300', 'ent/admin', { op: 'seats', id: E8.id, n: 4 }); assert.strictEqual(r.s, 403, 'only the owner sets extra seats');
    r = await call('p300', 'ent/admin', { op: 'enterprise', email: pe('p300'.padEnd(64, '0')), on: true }); assert.strictEqual(r.s, 403, 'only the owner sets enterprise');
    r = await call('owner', 'ent/admin', { op: 'seats', id: E8.id, n: 2 }); ok(r); G.limits._reset();
    r = await call('p308', 'join', { code: E8.code }); assert.strictEqual(r.s, 409, 'group setting is still 8');
    r = await call('p300', 'edit', { id: E8.id, name: 'Eight', join: { requests: true, open: false, max: 10, late: 'no' } }); assert.strictEqual(r.s, 409, 'money/size locked after people joined');
    assert.strictEqual(await G.limits.maxPeople(G.limits.keyOf(pe('p300'.padEnd(64, '0'))), E8.id), 10); assert.strictEqual(await G.limits.maxPeople(G.limits.keyOf(pe('p300'.padEnd(64, '0'))), 'other'), 8);
    r = await call('p400', 'create', base({ name: 'Ten', join: { max: 10 } })); assert.strictEqual(r.s, 400, 'standard account cannot pick 10');
    assert.strictEqual(await G.limits.maxPeople(G.limits.keyOf(pe('p999'.padEnd(64, '0'))), 'x'), 500, 'enterprise ceiling (ENTERPRISE_MAX_PEOPLE, default 500)');
    r = await call('p999', 'create', base({ name: 'Club', join: { max: 100 } })); ok(r, 'enterprise account: 100 people');
    r = await call('p400', 'limits'); ok(r); assert.deepStrictEqual([r.j.max, r.j.enterprise], [8, false]); assert.strictEqual(r.j.text, 'Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.');
    t('G15: owner-only enterprise flag (account) and extra seats (one group); maxPeople = 8 + extra seats, or the enterprise ceiling; standard accounts cannot pick more than 8');
    r = await call('p400', 'ent/contact', { name: 'Pat Pro', org: 'Valley Golf Club', reach: '956-555-0100', people: 60, what: 'Saturday scramble pool <b>' }); ok(r);
    r = await call('p400', 'ent/contact', { name: 'x', reach: '' }); assert.strictEqual(r.s, 400);
    await call('p400', 'ent/contact', { name: 'Pat Pro', reach: '956-555-0100' }); r = await call('p400', 'ent/contact', { name: 'Pat Pro', reach: '956-555-0100' }); assert.strictEqual(r.s, 429, 'rate-limited');
    r = await call('p400', 'ent/admin', {}); assert.strictEqual(r.s, 403); r = await call('owner', 'ent/admin', {}); ok(r); assert.ok(r.j.requests.some((q) => q.org === 'Valley Golf Club' && q.people === 60 && q.what === 'Saturday scramble pool b'), JSON.stringify(r.j.requests)); assert.ok(!/<b>/.test(JSON.stringify(r.j.requests)));
    t('G15: "Contact Oddable" form saved for the owner (HTML stripped), rate-limited, owner-only list');
    // enterprise usage counter: a started contest of an enterprise account records its players for the month
    NOW = START - DAY; G._reset(); const CL = (await call('p999', 'create', base({ name: 'Club Night', join: { max: 100 } }))).j.group; for (const w of ['bob', 'cat']) await call(w, 'join', { code: CL.code });
    NOW = START + HOUR; G._reset(); await call('p999', 'standings', { id: CL.id, cid: C1(CL) }); await new Promise((z) => setTimeout(z, 50)); r = await call('owner', 'ent/admin', {});
    const eu = r.j.enterprise.find((x) => x.key === G.limits.keyOf(pe('p999'.padEnd(64, '0')))); assert.ok(eu && eu.use[0].list.some((x) => x.players === 3 && /Club Night/.test(x.title)), JSON.stringify(eu));
    t('G15: enterprise usage counter: games run and distinct players per game per month, shown to the owner');
    // ================= G14 server: public invite preview =================
    NOW = START - DAY; G._reset(); const IV = (await call('dan', 'create', base({ name: 'Invite Me', take: { kind: 'flat', v: 20 } }))).j.group;
    raw = []; r = await call(null, 'invite', { type: 'g', code: IV.code.replace('-', '') }); ok(r, 'signed out'); assert.deepStrictEqual(r.j, { type: 'g', kind: 'group', title: 'Invite Me' });
    assert.ok(!/DanDog|\$|take|members|code/i.test(JSON.stringify(r.j)), 'no member names or money in the public preview');
    r = await call(null, 'invite', { type: 'g', code: 'ZZZZ-ZZZZ' }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.');
    r = await call(null, 'invite', { type: 'golf', code: 'ABCD' }); assert.strictEqual(r.s, 404); assert.match(r.j.error, /coming soon/);
    NOW = START + HOUR; r = await call(null, 'invite', { type: 'g', code: IV.code }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.', 'started (no late join): same message as a wrong code');
    r = await call('eve', 'preview', { code: IV.code }); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.error, 'This invite link is not valid or has expired.');
    G._reset(); let n429 = 0; for (let i = 0; i < 70; i++) { const x = await call(null, 'invite', { type: 'g', code: 'QQQQ-QQ' + String(i).padStart(2, '0') }, '8.8.8.8'); if (x.s === 429) n429++; } assert.ok(n429 > 50, 'public preview rate-limited per IP (' + n429 + ' of 70 refused)');
    G._reset(); t('G14: public invite preview returns only {type, kind, title}; wrong / started / unknown-type links get one clear message; rate-limited per IP');
    // ================= lifetime stats contract + external games =================
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); const SS = await G.statsFor(pe(SID.bob), {}); const sr = SS.find((x) => x.groupId === S.id);
    assert.ok(sr, 'record for the Scores contest'); const sb = (await call('bob', 'standings', { id: S.id, cid: SC })).j.rows.find((x) => x.name === 'BobBets');
    assert.deepStrictEqual([sr.src, sr.kind, sr.sport, sr.date, sr.result, sr.place.n, sr.place.of, sr.pl, sr.units, sr.stake, sr.verified, sr.extra.record, sr.extra.metric, sr.extra.live, sr.title], ['groups', 'contest', 'nfl', '2026-11-23', null, sb.place, 4, sb.t.win, sb.t.units, sb.t.stake, true, sb.t.w + '-' + sb.t.l + '-' + sb.t.p, 'win', true, 'Scores · Picks standings']);
    const sa = (await G.statsFor(pe(SID.eve), {})).find((x) => x.groupId === A.id); assert.strictEqual(sa.sport, 'other'); assert.ok(sa.extra.sports.includes('cfb') && sa.extra.sports.includes('nba'));
    assert.strictEqual((await G.statsFor(pe(SID.bob), { from: '2026-12-01' })).length, 0, 'from/to filter');
    NOW = Z('2026-12-25T12:00:00Z'); G._reset(); const fin = (await G.statsFor(pe(SID.bob), {})).find((x) => x.groupId === S.id); assert.strictEqual(fin.date, '2026-12-19'); assert.ok(!fin.extra.live, 'final place once the contest ended'); assert.strictEqual(fin.result, fin.place.n === 1 ? 'W' : 'L', 'finished contest: 1st = W, else L'); assert.strictEqual(sr.result, null, 'running contest: no result yet');
    { const sp = '/home/claude/calcutta-stats/odds-api/stats.js'; if (fs.existsSync(sp)) { let V = null; try { V = require(sp).validate; } catch (e) {} if (V) [sr, sa, fin].forEach((x) => { const v = V(x, 'groups'); assert.ok(v.ok, 'stats.js validate accepts the record: ' + v.why); }); } }
    t('stats contract: statsFor(userKey,{from,to}) -> one normalized record per contest (src, id, date, sport nfl/cfb/.../other+sports, kind, place {n,of}, pl, units, stake, verified, extra.record/metric/live)');
    NOW = START - 3 * DAY; G._reset(); const CT = (await call('cat', 'create', base({ name: 'Container' }))).j.group;
    const at = await G.attachGame(CT.id, pe(SID.cat), { type: 'golf', ref: 'golf:XYZ123', name: 'Saturday scramble', pot: 'main' }); assert.strictEqual(at.pot, 'main');
    await assert.rejects(G.attachGame(CT.id, pe(SID.bob), { type: 'golf', ref: 'golf:1' }), /commissioner/);
    r = await call('cat', 'get', { id: CT.id }); const ext = r.j.group.contests.find((c) => c.kind === 'ext'); assert.deepStrictEqual([ext.type, ext.ref, ext.name], ['golf', 'golf:XYZ123', 'Saturday scramble']);
    r = await call('cat', 'standings', { id: CT.id, cid: ext.cid }); assert.strictEqual(r.s, 400);
    t('groups hold games built by other engines (attachGame: golf day, local event, Calcutta) as contest cards');
    // ================= pot math (unchanged rules) =================
    const pg2 = (entry, paid, n, take, split) => ({ members: Array.from({ length: n }, (_, i) => ({ paid: i < paid })), money: { take, msplit: { kind: 'even', pct: { c: 100 } } }, contests: [{ cid: 'c', pot: 'main', kind: 'picks', name: 'x', rules: { entry, split } }] });
    let p = G.pots(pg2(1, 3, 4, { kind: 'pct', v: 15 }, '60/30/10')).main; assert.strictEqual(p.pot, 3); assert.strictEqual(p.take, 0.45); assert.strictEqual(p.pool, 2.55); assert.deepStrictEqual(p.shares[0].places.map((x) => x.amt), [1.54, 0.76, 0.25]);
    p = G.pots(pg2(25, 2, 12, { kind: 'flat', v: 60 }, '100')).main; assert.strictEqual(p.take, 50); assert.strictEqual(p.pool, 0);
    p = G.pots(pg2(20, 12, 12, { kind: 'flat', v: 0.07 }, '60/30/10')).main; assert.strictEqual(p.take, 0.07); assert.strictEqual(p.pool, 239.93);
    for (let e = 1; e < 40; e++) for (const v of [0, 7, 13, 33, 50]) { const q = G.pots(pg2(e, 7, 9, { kind: 'pct', v }, '60/30/10')).main; assert.strictEqual(Math.round(q.shares[0].places.reduce((a, x) => a + x.amt, 0) * 100), Math.round(q.pool * 100)); assert.strictEqual(Math.round((q.pool + q.take) * 100), Math.round(q.pot * 100)); }
    t('pot: take % and flat (clamped), cents rounding, split always sums exactly to the prize pool');
    // ================= privacy =================
    const all = raw.join('\n'); Object.values(SID).forEach((s) => { assert.ok(!all.includes(s) && !all.includes(s.slice(0, 16)), 'sync id leaked'); }); assert.ok(!/phone\.oddable|"mk"|"sid"|t-bob|pinhash|"comm":"[0-9a-f]{24}"/.test(all), 'identity leaked');
    t('no sync ids, phone hashes, member keys or tokens in any response');
    assert.ok(urls.every((u) => /^https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/(football\/nfl|football\/college-football|basketball\/nba|baseball\/mlb|hockey\/nhl|basketball\/mens-college-basketball)\/scoreboard\?dates=\d{8}&limit=400/.test(u)), 'only the app\'s ESPN scoreboard paths');
    t('only the ESPN scoreboard paths the app already uses are fetched (' + urls.length + ' calls)');
    console.log('\nALL ' + pass + ' GROUP TESTS PASSED');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close();
});
