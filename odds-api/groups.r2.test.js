// Run: node odds-api/groups.r2.test.js — round-2 review fixes (Nov 16 2026). No network, no database: in-memory fakes like groups.test.js.
// Every check here failed on groups-v1 @5fac7bc and passes after the fix named in its title (see HANDOFF "Groups round-2 review fixes").
// Each check runs on its own (a failure does not stop the others) so the before/after table is complete.
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');
const G = require('./groups'), GR = require('./grade'), S = require('./sync'), D = G._deps;
let db = {}, writes = {};
D.S = {
  dbGet: async (id) => { await new Promise((r) => setImmediate(r)); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); writes[row.id] = (writes[row.id] || 0) + 1; },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; writes[id] = (writes[id] || 0) + 1; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const WHO = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jo'], SID = {}, NAMES = {};
WHO.forEach((w, i) => { SID[w] = (String.fromCharCode(97 + i).repeat(8) + '0'.repeat(56)); NAMES[SID[w].slice(0, 8)] = w.toUpperCase() + 'name'; });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
D.acct = () => ({ who: (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; }, phoneEmail: pe, isOwnerPhone: () => false,
  ownerOk: (req) => String(req.headers['x-token']) === 't-owner', namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1'); D.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Z = (s) => Date.parse(s), H = 3600e3, DAY = 864e5, START = Z('2026-11-22T18:00:00Z');
const T = (abbr, name) => ({ abbr, name, short: name.split(' ').pop(), loc: name.split(' ').slice(0, -1).join(' ') });
const ODDS = { details: 'BUF -2.5', overUnder: 47.5, spread: -2.5, overOdds: -110, underOdds: -110, awayTeamOdds: { moneyLine: 130, spreadOdds: -110, favorite: false }, homeTeamOdds: { moneyLine: -150, spreadOdds: -110, favorite: true } };
const GAMES = [
  { id: '501', start: START, away: T('DAL', 'Dallas Cowboys'), home: T('NYG', 'New York Giants'), as: 20, hs: 24 }, // no odds on ESPN
  { id: '502', start: START + 3 * H, away: T('KC', 'Kansas City Chiefs'), home: T('BUF', 'Buffalo Bills'), as: 27, hs: 24, odds: ODDS },
  { id: '503', start: Z('2026-11-29T18:00:00Z'), away: T('GB', 'Green Bay Packers'), home: T('CHI', 'Chicago Bears'), as: 14, hs: 21 },
  { id: '504', start: START, away: T('MIA', 'Miami Dolphins'), home: T('NE', 'New England Patriots'), as: 0, hs: 0, off: 'STATUS_POSTPONED' },
];
const ymd = (ms) => GR.chiDay(ms).replace(/-/g, '');
D.fetch = async (u) => {
  const m = /sports\/football\/nfl\/scoreboard\?dates=(\d{8})/.exec(u);
  const evs = !m ? [] : GAMES.filter((g) => ymd(g.start) === m[1]).map((g) => { const now = D.now(), st = g.off ? (now < g.start ? 'pre' : 'post') : now < g.start ? 'pre' : now < g.start + 3.5 * H ? 'in' : 'post';
    const tm = (t) => ({ abbreviation: t.abbr, displayName: t.name, shortDisplayName: t.short, location: t.loc });
    return { id: g.id, date: new Date(g.start).toISOString(), status: { type: { state: st, completed: !g.off && st === 'post', name: g.off || (st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED') } },
      competitions: [{ odds: g.odds ? [g.odds] : undefined, competitors: [{ homeAway: 'home', score: st === 'pre' ? '0' : String(g.hs), team: tm(g.home) }, { homeAway: 'away', score: st === 'pre' ? '0' : String(g.as), team: tm(g.away) }] }] }; });
  return { ok: true, json: async () => ({ events: evs }) };
};
let NOW = START - 3 * DAY; D.now = () => NOW;
const GLB = (b, u) => (b && b.src !== 'kalshi' && b.gl === undefined ? Object.assign({ gl: b.sa > 0 ? b.sa : u }, b) : b); // G16: stamped like /groups/bet/add (gl: 0 = phone-only)
const row = (w, bets, U) => { const u = U == null ? START - 2 * H : U; db[SID[w]] = { id: SID[w], salt: 's', pinhash: 'h', data: { bets: bets.map((b) => GLB(b, u)) }, updated: u }; };
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P; const call = async (who, op, b) => { const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': '9.9.9.' + WHO.indexOf(who) }, body: JSON.stringify(b || {}) }); return { s: r.status, j: await r.json() }; };
const CDEF = { cname: 'Picks', sport: 'nfl', fmt: 'standings', start: START - H, runs: 'w4', kalshi: false, honor: false, types: { sp: true, ml: true, ou: true, prop: true, parlay: true }, legs: 3, metric: 'win', minBets: 0, minPaid: 0, cap: 0, entry: 25, split: '100' };
const mk = async (who, c, join) => { NOW = START - 3 * DAY; G._reset(); const r = await call(who, 'create', { name: 'G' + Math.random().toString(36).slice(2, 7), take: { kind: 'none', v: 0 }, join: Object.assign({ requests: true, open: false, max: 8, late: 'no' }, join || {}), contest: Object.assign({}, CDEF, c || {}) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j)); return r.j.group; };
const joinAll = async (g, ws) => { for (const w of ws) { const r = await call(w, 'join', { code: g.code }); assert.strictEqual(r.s, 200, w + ' join ' + JSON.stringify(r.j)); } };
const mine = async (w, g) => { NOW = START + 2 * DAY; G._reset(); const st = await call(w, 'standings', { id: g.id, cid: g.contests[0].cid }); assert.strictEqual(st.s, 200, JSON.stringify(st.j)); const me = st.j.rows.find((x) => x.name === w.toUpperCase() + 'name'); const p = await call(w, 'player', { id: g.id, cid: g.contests[0].cid, pid: me.pid }); return { row: me, bets: p.j.bets, t: p.j.t }; };
const bet = (id, gid, side, type, odds, stake, o) => { const g = GAMES.find((x) => x.id === gid); return Object.assign({ id, gid, lg: 'nfl', away: g.away.abbr, home: g.home.abbr, day: GR.chiDay(g.start), side, type, odds, stake, fin: 'won', finPL: 99999 }, o || {}); };
const TESTS = [];
const test = (name, fn) => TESTS.push([name, fn]);

test('R1 CRITICAL: moneyline at +99900 is graded at the ESPN reference (+130) + 10 cents tolerance = +140, not +99900', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); row('bob', [bet('b1', '502', 'KC', 'ml', 99900, 100)]);
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'b1'); assert.ok(b && b.ok, JSON.stringify(b)); assert.strictEqual(b.res, 'won'); assert.strictEqual(b.pl, 140);
});
test('R1 CRITICAL: no reference price -> clamped to the contest\'s "Longest odds that count" (default +500)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); row('bob', [bet('b2', '501', 'NYG', 'ml', 99900, 100)]);
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'b2'); assert.ok(b && b.ok, JSON.stringify(b)); assert.strictEqual(b.pl, 500);
  const g2 = await mk('ann', { maxOdds: 200 }); await joinAll(g2, ['bob']); const b3 = (await mine('bob', g2)).bets.find((x) => x.id === 'b2'); assert.strictEqual(b3.pl, 200, 'commissioner set +200');
  const bad = await call('ann', 'create', { name: 'Bad odds', take: { kind: 'none', v: 0 }, join: { requests: true, open: false, max: 8, late: 'no' }, contest: Object.assign({}, CDEF, { maxOdds: 99900 }) }); assert.strictEqual(bad.s, 400, 'max setting is +5000');
});
test('R1 CRITICAL: a $1,000,000 stake counts as the cap; "no cap" counts as $1,000', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); row('bob', [bet('b4', '502', 'KC', 'sp', -110, 1000000, { line: 2.5 })]); // KC +2.5 (the market line) wins by 3 -> covers
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'b4'); assert.ok(b && b.ok, JSON.stringify(b)); assert.strictEqual(b.cs, 1000); assert.ok(b.pl <= 1000 && b.pl > 0, 'pl ' + b.pl);
});
test('R1 CRITICAL (line): a spread more than 2 points better than the reference line never counts, honor rule or not', async () => {
  const g = await mk('ann', { honor: true }); await joinAll(g, ['bob']); row('bob', [bet('f1', '502', 'BUF', 'sp', -110, 100, { line: 9.5 })]);
  const { bets, t } = await mine('bob', g); const b = bets.find((x) => x.id === 'f1'); assert.ok(b && !b.ok && /far from the market/.test(b.why), JSON.stringify(b)); assert.strictEqual(t.win, 0);
});
test('R1 CRITICAL: both sides of one market from one member: only the first (by first-seen) counts, the other is "hedge, not counted"', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']);
  row('bob', [bet('h1', '502', 'KC', 'ml', 130, 100, { sa: START - 5 * H }), bet('h2', '502', 'BUF', 'ml', -150, 100, { sa: START - 4 * H })]);
  db[SID.bob].data.bets.forEach((b) => { delete b.sa; }); db[SID.bob].data = S.merge({}, { bets: [db[SID.bob].data.bets[0]] }, START - 5 * H); db[SID.bob].data = S.merge(db[SID.bob].data, { bets: [bet('h2', '502', 'BUF', 'ml', -150, 100)] }, START - 4 * H); db[SID.bob].data.bets.forEach((b) => { b.gl = b.sa; }); // each saved by /groups/bet/add at its arrival time
  const { bets } = await mine('bob', g); const a = bets.find((x) => x.id === 'h1'), b = bets.find((x) => x.id === 'h2');
  assert.ok(a.ok, 'first counts'); assert.ok(!b.ok && /hedge/i.test(b.why), JSON.stringify(b));
});
test('R1 CRITICAL: Kalshi bets are graded at the same reference check (mult 100 -> +140), rule renamed "Kalshi-tagged bets only (not verified)" with an info note', async () => {
  const g = await mk('ann', { kalshi: true }); await joinAll(g, ['bob']);
  row('bob', [{ id: 'k1', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-KC', kind: 'prop', text: 'Kansas City to win', stake: 100, mult: 100, day: '2026-11-22' }]);
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'k1'); assert.ok(b && b.ok, JSON.stringify(b)); assert.strictEqual(b.pl, 140);
  const cs = fs.readFileSync(path.join(__dirname, '..', 'pics', 'groups.js'), 'utf8'); assert.ok(cs.includes('Kalshi-tagged bets only (not verified)') && !cs.includes("'Kalshi-synced bets only'"), 'client wording');
});
test('R1 CRITICAL (parlays): a parlay\'s own multiplier never pays more than its legs\' ceilings multiplied (reference + 10 cents, else "Longest odds that count")', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']);
  row('bob', [{ id: 'pz', kind: 'parlay', stake: 10, mult: 1000, day: '2026-11-22', lg: 'nfl', legs: [{ gid: '501', side: 'NYG', type: 'ml', away: 'DAL', home: 'NYG' }, { gid: '502', side: 'KC', type: 'ml', away: 'KC', home: 'BUF' }] }]);
  const { bets } = await mine('bob', g); const b = bets.find((x) => x.id === 'pz'); assert.ok(b && b.ok && b.res === 'won', JSON.stringify(b)); assert.strictEqual(b.pl, 134, 'NYG no reference -> +500 (6x); KC reference +130 -> +140 (2.4x); 6 x 2.4 = 14.4x -> +$134 on $10, not +$9,990');
});
test('R2 HIGH: sync.js stamps each NEW bet id with the server arrival time (phone value ignored, first stamp kept forever)', async () => {
  const a = S.merge({}, { bets: [{ id: 'x1', stake: 5, sa: 1 }] }, 1000); assert.strictEqual(a.bets[0].sa, 1000, 'phone-sent sa ignored');
  const b = S.merge(a, { bets: [{ id: 'x1', stake: 6, t: 9, sa: 5 }, { id: 'x2', stake: 1 }] }, 2000); const by = Object.fromEntries(b.bets.map((x) => [x.id, x]));
  assert.strictEqual(by.x1.sa, 1000, 'first stamp kept after an edit'); assert.strictEqual(by.x1.stake, 6); assert.strictEqual(by.x2.sa, 2000, 'new id stamped now');
});
test('R2 HIGH: an honest bet stamped before kickoff counts even when the row was last written after kickoff', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); row('bob', [bet('s1', '502', 'KC', 'ml', 130, 50, { sa: START - 3 * H })], START + 4 * H);
  db[SID.bob].data.bets.push(bet('s2', '501', 'NYG', 'ml', -110, 10, { gl: START + 4 * H, sa: START + 4 * H })); // a later bet (after 501 kicked off) wrote the row
  const { bets } = await mine('bob', g); const a = bets.find((x) => x.id === 's1'), b = bets.find((x) => x.id === 's2');
  assert.ok(a.ok, 'stamped before kickoff: counts ' + JSON.stringify(a)); assert.ok(!b.ok && /after the game started/.test(b.why));
});
test('R3 MEDIUM: owner-granted extra seats take effect on a full, joined group; Group id shown on the members screen', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal']);
  let r = await call('ivy', 'join', { code: g.code }); assert.strictEqual(r.s, 409, 'full at 8');
  r = await call('owner', 'ent/admin', { op: 'seats', id: g.id, n: 2 }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  r = await call('ivy', 'join', { code: g.code }); assert.strictEqual(r.s, 200, '9th joins after extra seats ' + JSON.stringify(r.j));
  r = await call('jo', 'join', { code: g.code }); assert.strictEqual(r.s, 200, '10th joins');
  const cs = fs.readFileSync(path.join(__dirname, '..', 'pics', 'groups.js'), 'utf8'); assert.ok(/Group id/.test(cs), 'members screen shows the Group id');
});
test('R4 LOW: a postponed / cancelled game is void (push) once it is 48 hours past its start', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); row('bob', [bet('p1', '504', 'MIA', 'ml', 120, 100)]);
  NOW = START + 3 * DAY; G._reset(); const st = await call('bob', 'standings', { id: g.id, cid: g.contests[0].cid }); const me = st.j.rows.find((x) => x.name === 'BOBname');
  const p = await call('bob', 'player', { id: g.id, cid: g.contests[0].cid, pid: me.pid }); const b = p.j.bets.find((x) => x.id === 'p1'); assert.strictEqual(b.res, 'push', JSON.stringify(b));
});
test('R4 LOW: enterprise usage is written only when the counts change (not on every standings read)', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']); let r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true }); assert.strictEqual(r.s, 200);
  r = await call('owner', 'ent/admin', { op: 'enterprise', email: pe(SID.ann), on: true });
  NOW = START + 2 * DAY; for (let i = 0; i < 5; i++) { G._reset(); G.limits._reset(); await call('ann', 'standings', { id: g.id, cid: g.contests[0].cid }); await new Promise((x) => setTimeout(x, 20)); }
  assert.ok((writes['lock:entuse'] || 0) <= 2, 'entuse writes: ' + writes['lock:entuse']);
});
test('R4 LOW: honor system: a phone "won" does not count before the game kicks off', async () => {
  const g = await mk('ann', { honor: true }); await joinAll(g, ['bob']);
  row('bob', [{ id: 'hp', kind: 'prop', text: 'Love over 1.5 TD', stake: 50, odds: 150, day: '2026-11-29', pp: { gid: '503' }, fin: 'won', finPL: 75 }]);
  NOW = START + 2 * DAY; G._reset(); const st = await call('bob', 'standings', { id: g.id, cid: g.contests[0].cid }); const me = st.j.rows.find((x) => x.name === 'BOBname');
  assert.strictEqual(me.t.win, 0, 'not counted before kickoff (game Nov 29): ' + JSON.stringify(me.t));
});
test('R4 LOW (owner rule): contest dates lock once anyone else has joined', async () => {
  const g = await mk('ann'); await joinAll(g, ['bob']);
  const r = await call('ann', 'contest/edit', { id: g.id, cid: g.contests[0].cid, contest: Object.assign({}, CDEF, { start: START + 5 * H }) }); assert.strictEqual(r.s, 409, JSON.stringify(r.j));
  const r2 = await call('ann', 'contest/edit', { id: g.id, cid: g.contests[0].cid, contest: Object.assign({}, CDEF, { cname: 'New name' }) }); assert.strictEqual(r2.s, 200, 'name can still change ' + JSON.stringify(r2.j));
});
test('R4 LOW: default main-pot split weights contests by their entries ($0 entry gets 0)', async () => {
  const g = await mk('ann', { entry: 30 });
  let r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, CDEF, { cname: 'Free one', entry: 0, start: START + H }) }); assert.strictEqual(r.s, 200, JSON.stringify(r.j));
  let ms = r.j.group.money.msplit.pct, ids = r.j.group.contests.map((c) => c.cid); assert.deepStrictEqual([ms[ids[0]], ms[ids[1]]], [100, 0]);
  r = await call('ann', 'contest/add', { id: g.id, contest: Object.assign({}, CDEF, { cname: 'Ten', entry: 10, start: START + H }) }); ms = r.j.group.money.msplit.pct; const id3 = r.j.group.contests[2].cid; assert.deepStrictEqual([ms[ids[0]], ms[ids[1]], ms[id3]], [75, 0, 25]);
});
test('R4 LOW: HANDOFF states the real public invite rate (60 per 10 minutes per IP)', async () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'HANDOFF.md'), 'utf8'); assert.ok(h.includes('60 per 10 min per IP') && !h.includes('40 per 10 min per IP'));
});

srv.listen(0, async () => {
  P = srv.address().port; let fail = 0;
  for (const [name, fn] of TESTS) { db = {}; writes = {}; WHO.forEach((w) => row(w, [])); G._reset(); G.limits._reset(); try { await fn(); console.log('  PASS', name); } catch (e) { fail++; console.log('  FAIL', name, '\n       ', String(e.message).slice(0, 300)); } }
  console.log(fail ? '\n' + fail + ' OF ' + TESTS.length + ' ROUND-2 CHECKS FAILED' : '\nALL ' + TESTS.length + ' ROUND-2 CHECKS PASSED'); process.exitCode = fail ? 1 : 0; srv.close();
});
