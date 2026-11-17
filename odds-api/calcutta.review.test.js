// Run: node odds-api/calcutta.review.test.js   (fixes from the independent review of calcutta-v1 @5deda26; same fakes as calcutta.test.js)   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes; the clock is fake)
process.env.CALCUTTA_ENABLED = '1'; // ROUND 7 (M2): Calcutta is OFF unless CALCUTTA_ENABLED is exactly "1" (calcutta.round7.test.js checks the switches)
const assert = require('assert'), http = require('http'), C = require('./calcutta'), D = C._deps;
// ---- fake database (random delay so parallel requests really interleave) ----
let db = {}, slow = 0, lost = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
D.S = {
  dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
// ---- fake sign-in: x-token "t-<who>" ----
const WHO = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon'];
const SID = {}; WHO.forEach((w, i) => { SID[w] = (String(i + 1).repeat(8) + w.repeat(30)).slice(0, 64); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
const NAMES = {}; WHO.forEach((w) => { NAMES[SID[w].slice(0, 8)] = w[0].toUpperCase() + w.slice(1) + 'Bets'; });
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); if (!t.startsWith('t-')) return null; const w = t.slice(2); return SID[w] ? pe(SID[w]) : null; }, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
Object.values(SID).forEach((s) => { db[s] = { id: s, data: { bets: [] }, updated: 1 }; });
delete NAMES[SID.jon.slice(0, 8)]; // jon has no Oddable name
let idxGets = 0, failIdx = 0; { const g0 = D.S.dbGet, p0 = D.S.dbPatchIf; D.S.dbGet = async (id) => { if (id === 'lock:calcs') idxGets++; return g0(id); }; D.S.dbPatchIf = async (id, ...a) => { if (id === 'lock:calcs' && failIdx > 0) { failIdx--; return false; } return p0(id, ...a); }; }
// ---- fake ESPN: 32 NFL teams; a full 2026 postseason (13 games) ----
const TEAMS = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), abbreviation: 'T' + (i + 1), displayName: 'Team ' + (i + 1) }));
TEAMS[0].displayName = 'Kansas <b>City</b>';
const Z = (s) => Date.parse(s), T0 = Z('2027-01-09T18:00:00Z'), H = 3600e3;
const G = (id, week, t, a, b, sa, sb) => ({ id: String(id), date: new Date(t).toISOString(), season: { type: 3 }, week: { number: week }, status: { type: { state: 'post', completed: true } }, competitions: [{ notes: [], competitors: [{ team: { id: String(a) }, score: String(sa), winner: sa > sb }, { team: { id: String(b) }, score: String(sb), winner: sb > sa }] }] });
const PO = { 1: [G(901, 1, T0, 2, 7, 24, 10), G(902, 1, T0 + H, 3, 6, 21, 17), G(903, 1, T0 + 2 * H, 4, 5, 30, 27), G(904, 1, T0 + 3 * H, 9, 14, 20, 3), G(905, 1, T0 + 4 * H, 10, 13, 16, 13), G(906, 1, T0 + 5 * H, 11, 12, 28, 14)],
  2: [G(911, 2, T0 + 7 * 24 * H, 1, 4, 31, 7), G(912, 2, T0 + 7 * 24 * H + H, 2, 3, 27, 20), G(913, 2, T0 + 7 * 24 * H + 2 * H, 8, 11, 34, 31), G(914, 2, T0 + 7 * 24 * H + 3 * H, 9, 10, 23, 22)],
  3: [G(921, 3, T0 + 14 * 24 * H, 1, 2, 17, 14), G(922, 3, T0 + 14 * 24 * H + 3 * H, 8, 9, 26, 24)], 5: [G(931, 5, T0 + 28 * 24 * H, 1, 8, 25, 22)] };
let urls = [], feedOn = false; // the score feed is empty until the event "starts" in a test
let feedFail = false; // simulates ESPN down
D.fetch = async (u) => { urls.push(u); if (feedFail && !/\/teams\?/.test(u)) throw new Error('ESPN down'); if (/\/teams\?/.test(u)) return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: t })) }] }] }) };
  const m = /seasontype=3&week=(\d+)/.exec(u); return { ok: true, json: async () => ({ events: feedOn && m && PO[m[1]] ? PO[m[1]] : [] }) }; };
let NOW = Z('2026-11-17T18:00:00Z'); D.now = () => NOW;
// ---- the shared people limits (Groups coder's odds-api/limits.js: the real file when it is in this branch or in the Groups worktree, else a stand-in with the same signature) ----
let LIM = null; for (const p of ['./limits', '/home/claude/calcutta-groups/odds-api/limits.js']) { if (!LIM) { try { LIM = require(p); } catch (e) {} } }
const SHARED = !!LIM; if (LIM) { LIM._deps.S = D.S; LIM._deps.now = () => NOW; } else { const ent = new Set(); LIM = { keyOf: (e) => 'a' + C.mkOf(e).slice(1), maxPeople: async (k) => (ent.has(k) ? 500 : 8), admin: async (b) => { if (b.on) ent.add(b.key); else ent.delete(b.key); }, _reset: () => {} }; }
D.limits = () => LIM;
const enterprise = async (who, on) => { await LIM.admin({ op: 'enterprise', key: LIM.keyOf(pe(SID[who])), on }); NOW += 31e3; }; // the owner's Enterprise flag on an ACCOUNT (the answer is cached 30 s)
// ---- server ----
const srv = http.createServer(async (req, res) => { if (!(await C.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
srv.keepAliveTimeout = 120e3; // ROUND 7: a kept-alive socket the server closes during a long CPU-bound check gave "fetch failed" under heavy parallel load
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/calcutta/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(b || {}) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const team = (n) => ({ id: String(n), name: 'Team ' + n });
const PLAYOFF = Array.from({ length: 14 }, (_, i) => i + 1);
const lotsOf = (ids, field) => ids.filter((x) => !(field || []).includes(x)).map((x) => ({ teams: [team(x)] })).concat(field && field.length ? [{ name: 'The field', teams: field.map(team) }] : []);
const NFLROWS = [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13, label: 'Conference champion' }, { k: 'champ', n: 1, pct: 35 }];
const base = (o) => Object.assign({ name: 'Playoff Calcutta', ev: 'nfl_po', lots: lotsOf(PLAYOFF, [13, 14]), rows: NFLROWS, minBid: 5, inc: 5, timer: 20, buyBack: false, main: true, take: { kind: 'pct', v: 10 }, order: 'listed', mode: 'live' }, o || {});
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const tick = (ms) => { NOW += ms; };


const fails = [], res = []; let P2;
async function chk(name, fn) { try { await fn(); res.push('  ok ' + name); } catch (e) { fails.push(name); res.push('  FAIL ' + name + ' :: ' + (e && e.message || e).toString().split('\n')[0]); } }
const pidOf = async (who, id) => (await call(who, 'get', { id })).j.calc.me;
const startEvent = () => { feedOn = true; feedFail = false; C._reset(); NOW = Z('2027-01-20T18:00:00Z'); }; // the playoffs are under way
const fresh = () => { feedOn = false; feedFail = false; C._reset(); NOW = Z('2026-11-17T18:00:00Z'); };
const MM = () => { let tt = 1e12, gid = 0; const games = []; const g = (head, a, b) => ({ id: String(++gid), t: (tt += 1000), done: true, state: 'post', st: 3, week: 0, head: "Men's Basketball Championship - " + head, teams: [{ id: a, score: 80, winner: true }, { id: b, score: 70, winner: false }] });
  for (let i = 0; i < 4; i++) games.push(g('First Four', String(61 + i), String(65 + i)));
  let alive = Array.from({ length: 64 }, (_, i) => String(i + 1)); ['1st Round', '2nd Round', 'Sweet 16', 'Elite 8', 'Final Four', 'National Championship'].forEach((h) => { const nx = []; for (let i = 0; i < alive.length; i += 2) { games.push(g(h, alive[i], alive[i + 1])); nx.push(alive[i]); } alive = nx; });
  return games; };
srv.listen(0, async () => {
  P = srv.address().port; let r;
  // 1 HIGH: who-owns-what freezes once the event starts or any result exists; never unlocks; no delete after a sale; changes after close are announced
  await chk('1a enter-results: a change after close (before the event) is allowed and announced to members', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); ok(r); const m = r.j.calc; ok(await call('bob', 'join', { code: m.code }));
    const B = await pidOf('bob', m.id), A = await pidOf('ann', m.id); ok(await call('ann', 'enter', { id: m.id, lot: 'L1', pid: B, amt: 100 })); ok(await call('ann', 'enter', { id: m.id, lot: 'L2', pid: A, amt: 50 })); r = await call('ann', 'enter', { id: m.id, lot: 'L3', pid: B, amt: 20 }); assert.strictEqual(r.j.calc.a.status, 'closed');
    ok(await call('ann', 'enter', { id: m.id, lot: 'L3', pid: A, amt: 25 })); r = await call('bob', 'get', { id: m.id }); assert.ok(Array.isArray(r.j.calc.notices) && r.j.calc.notices.some((n) => /after the auction closed/i.test(n.what) && /Team 8/.test(n.what)), 'notice for members: ' + JSON.stringify(r.j.calc.notices));
    startEvent(); for (const [op, b] of [['enter', { lot: 'L1', pid: A, amt: 5 }], ['unenter', { lot: 'L1' }]]) { r = await call('ann', op, Object.assign({ id: m.id }, b)); assert.strictEqual(r.s, 409, op + ' after the event started -> ' + r.s); assert.strictEqual(r.j.code, 'frozen'); }
    r = await call('ann', 'delete', { id: m.id }); assert.strictEqual(r.s, 409); });
  await chk('1b never unlocks: removing every entry keeps the rules locked; no edit, no delete', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); const m = r.j.calc;
    ok(await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Joe', amt: 10 })); r = await call('ann', 'unenter', { id: m.id, lot: 'L1' }); ok(r); assert.strictEqual(r.j.calc.locked, true, 'still locked');
    r = await call('ann', 'edit', Object.assign(base({ lots: lotsOf([1, 2]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'pct', v: 50 }, mode: 'manual' }), { id: m.id })); assert.strictEqual(r.s, 409, 'edit');
    r = await call('ann', 'delete', { id: m.id }); assert.strictEqual(r.s, 409, 'delete after a sale existed'); });
  await chk('1c live: undo of a sale refused once the event has started', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' } })); const c = r.j.calc; ok(await call('bob', 'join', { code: c.code }));
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 100 })); ok(await call('ann', 'ctl', { id: c.id, op: 'sold' }));
    startEvent(); r = await call('ann', 'ctl', { id: c.id, op: 'undo' }); assert.strictEqual(r.s, 409, 'undo sale after start -> ' + r.s + ' ' + r.j.error); });
  await chk('1d a hand-entered result freezes ownership (events without a feed) and buy-back', async () => { fresh();
    r = await call('ann', 'create', { name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }], playersOfRecord: [{ me: true }] }, { teams: [{ name: 'Blue' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); ok(r); const g = r.j.calc;
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', name: 'Cy', amt: 40 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Di', amt: 30 })); ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x1', champ: true }));
    r = await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Ed', amt: 30 }); assert.strictEqual(r.s, 409, 'enter'); r = await call('ann', 'buyback', { id: g.id, lot: 'L1', self: true }); assert.strictEqual(r.s, 409, 'buy-back after a result'); });
  // 6 MED: undo of a sale keeps the bids
  await chk('6 undo of a sale reopens the lot with its winning bid still standing', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' } })); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code }));
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); ok(await call('cat', 'bid', { id: c.id, lot: 'L1', amt: 50 })); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 100 })); ok(await call('ann', 'ctl', { id: c.id, op: 'sold' }));
    r = await call('ann', 'ctl', { id: c.id, op: 'undo' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L1'); assert.deepStrictEqual([r.j.calc.a.high && r.j.calc.a.high.amt, r.j.calc.a.bids.length], [100, 2]);
    assert.ok(r.j.calc.a.undo == null || r.j.calc.a.undo.k === 'bid'); });
  // 2 HIGH: March Madness First Four is not a tournament win
  await chk('2 March Madness: First Four games are not wins (63 wins), First Four losers are out', async () => { const R = C.teamResults(C.EVENTS.mm, MM(), new Set(Array.from({ length: 68 }, (_, i) => String(i + 1))));
    const wins = Object.values(R).reduce((a, x) => a + x.wins, 0); assert.strictEqual(wins, 63); assert.ok(!R['61'].winT.includes(1e12 + 1000), 'the First Four win is not paid'); assert.ok(R['65'].out, 'First Four loser out'); assert.ok(R['1'].champ); assert.strictEqual(R['1'].wins, 6); });
  // 3 MED-HIGH: a game counts when ANY lot team plays in it
  await chk('3 a lot team beating a team that is in no lot still counts; biggest margin only among lot teams', async () => {
    const g = (id, a, b, sa, sb, t0) => ({ id, t: t0, done: true, state: 'post', st: 2, week: 11, head: '', teams: [{ id: a, score: sa, winner: sa > sb }, { id: b, score: sb, winner: sb > sa }] });
    const R = C.teamResults(C.EVENTS.nfl_wk, [g('1', 'A', 'X', 20, 17, 1), g('2', 'Y', 'Z', 45, 3, 2)], new Set(['A'])); assert.strictEqual((R.A || {}).wins, 1); assert.ok(R.A.big, 'biggest win among lot teams'); assert.ok(!(R.Y && R.Y.big));
    const P0 = { id: '9', t: 5, done: true, state: 'post', st: 3, week: 1, head: '', teams: [{ id: '2', score: 24, winner: true }, { id: '30', score: 10, winner: false }] };
    const R2 = C.teamResults(C.EVENTS.nfl_po, [P0], new Set(['2'])); assert.strictEqual((R2['2'] || {}).wins, 1, 'playoff win vs a team in no lot'); });
  // 7 LOW-MED: a hand-entered champion replaces the feed champion
  await chk('7 (ROUND 4 B1) a hand-entered champion on a feed event is refused: the feed is the only source', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); const m = r.j.calc;
    for (let i = 1; i <= 3; i++) ok(await call('ann', 'enter', { id: m.id, lot: 'L' + i, name: 'P' + i, amt: 10 })); startEvent();
    // ROUND 4 B1 (replaces review fix 7 on feed events): the feed is the only source of results, a hand-entered champion is refused and the feed's stands
    r = await call('ann', 'result', { confirm: true, id: m.id, team: '8', champ: true }); assert.deepStrictEqual([r.s, r.j.code], [409, 'feedonly']); r = await call('ann', 'board', { id: m.id }); const b = r.j.board;
    assert.strictEqual(b.lots.find((l) => l.id === 'L1').teams[0].r.champ, true, 'the feed champion stands'); assert.strictEqual(b.rows[0].hits, 1); assert.strictEqual(b.lots.find((l) => l.id === 'L1').earned, 30);
    const g = (id, a, b2, sa, sb) => ({ id, t: 1, done: true, state: 'post', st: 2, week: 1, head: '', teams: [{ id: a, score: sa, winner: true }, { id: b2, score: sb, winner: false }] }); void g; });
  // 4 MED: public peek limit is per IP
  await chk('4 peek rate limit is per IP (31 visitors from 31 IPs all get the title)', async () => { fresh(); r = await call('ann', 'create', base()); const c = r.j.calc;
    for (let i = 0; i < 31; i++) { r = await call(null, 'peek', { code: c.code }, '10.1.0.' + i); assert.strictEqual(r.s, 200, 'peek ' + i + ' -> ' + r.s); } });
  // 5 MED: statsFor place = {n, of}
  await chk('5 statsFor place is {n, of} and passes the stats contract validator when present', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); const m = r.j.calc; ok(await call('bob', 'join', { code: m.code }));
    ok(await call('ann', 'enter', { id: m.id, lot: 'L1', pid: await pidOf('bob', m.id), amt: 30 })); ok(await call('ann', 'enter', { id: m.id, lot: 'L2', name: 'Joe', amt: 20 }));
    const rec = (await C.statsFor(pe(SID.bob), {})).find((x) => x.id === m.id); assert.ok(rec); assert.deepStrictEqual(Object.keys(rec.place || {}).sort(), ['n', 'of']); assert.strictEqual(rec.place.of, 2);
    let S = null; try { S = require('/home/claude/calcutta-stats/odds-api/stats.js'); } catch (e) {} if (S && S.validate) { const v = S.validate(rec, 'calcutta'); assert.ok(v.ok, 'validate: ' + JSON.stringify(v)); } });
  // 8 LOW: index cached, pruned, repaired
  await chk('8a the index row is read at most once a second (cached)', async () => { fresh(); await call('ann', 'mine'); const g0 = idxGets; await call('ann', 'mine'); await call('bob', 'mine'); assert.strictEqual(idxGets - g0, 0, 'index reads: ' + (idxGets - g0)); });
  await chk('8b abandoned set-up Calcuttas (90+ days, never started) are pruned from the index', async () => { fresh(); r = await call('ann', 'create', base({ name: 'Old one' })); const old = r.j.calc;
    NOW += 100 * 864e5; C._reset(); ok(await call('ann', 'create', base({ name: 'New one' }))); r = await call('ann', 'mine'); assert.ok(!r.j.calcs.some((x) => x.id === old.id), 'old setup pruned'); });
  await chk('8c a failed index update is retried and repaired', async () => { fresh(); r = await call('ann', 'create', base({ name: 'Repair' })); const c = r.j.calc;
    failIdx = 30; ok(await call('bob', 'join', { code: c.code })); failIdx = 0; C._reset(); await call('cat', 'mine'); r = await call('bob', 'mine'); assert.ok(r.j.calcs.some((x) => x.id === c.id), 'bob sees it after repair'); });
  // 9 LOW: event windows are the event's real dates, not the creation day
  await chk('9 March Madness / NBA windows are the tournament dates (also when created mid-event)', async () => { fresh();
    const lots = [{ teams: [team(1)] }, { teams: [team(2)] }], rows = [{ k: 'champ', n: 1, pct: 100 }];
    r = await call('ann', 'create', base({ ev: 'mm', lots, rows })); ok(r); let w = db['lock:calc:' + r.j.calc.id].data.win; assert.ok(w.from >= '2027-03-01' && w.from <= '2027-03-20' && w.to >= '2027-04-05' && w.to <= '2027-04-15', 'mm Nov: ' + JSON.stringify(w));
    NOW = Z('2027-03-28T18:00:00Z'); C._reset(); r = await call('ann', 'create', base({ ev: 'mm', lots, rows })); w = db['lock:calc:' + r.j.calc.id].data.win; assert.ok(w.from <= '2027-03-20', 'mid-tournament window starts before creation: ' + JSON.stringify(w));
    NOW = Z('2027-05-10T18:00:00Z'); C._reset(); r = await call('ann', 'create', base({ ev: 'nba_po', lots, rows })); w = db['lock:calc:' + r.j.calc.id].data.win; assert.ok(w.from <= '2027-04-20' && w.to >= '2027-06-15', 'nba: ' + JSON.stringify(w)); });
  // 10 LOW: a member without an Oddable name cannot borrow someone else's name
  await chk('10 no Oddable name -> "Player XXXX", never the typed name', async () => { fresh(); r = await call('ann', 'create', base()); const c = r.j.calc;
    r = await fetch('http://127.0.0.1:' + P + '/calcutta/join', { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': 't-jon' }, body: JSON.stringify({ code: c.code, myName: 'AnnBets' }) }).then((x) => x.json());
    const names = r.calc.members.map((m) => m.name); assert.strictEqual(names.filter((n) => n === 'AnnBets').length, 1, JSON.stringify(names)); assert.ok(names.some((n) => /^Player [A-Z0-9]{4}$/.test(n)), JSON.stringify(names)); });
  await chk('11 a place-paid event (golf day) is not over, and no lot is out, before its places are in', async () => { fresh();
    r = await call('ann', 'create', { name: 'Places', ev: 'custom', lots: [{ teams: [{ name: 'A' }] }, { teams: [{ name: 'B' }] }], rows: [{ k: 'place', r: 1, n: 1, pct: 70 }, { k: 'place', r: 2, n: 1, pct: 30 }], minBid: 5, inc: 5, timer: 10, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); ok(r); const g = r.j.calc;
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', name: 'Al', amt: 10 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Bo', amt: 10 }));
    r = await call('ann', 'board', { id: g.id }); assert.strictEqual(r.j.board.over, false); assert.ok(r.j.board.lots.every((l) => l.alive));
    ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x1', place: 1 })); ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x2', place: 2 })); r = await call('ann', 'board', { id: g.id }); assert.strictEqual(r.j.board.over, true); });
  // ===== round 2 (re-review @cc82efc) =====
  const manual3 = async () => { r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); ok(r); const m = r.j.calc; for (let i = 1; i <= 3; i++) ok(await call('ann', 'enter', { id: m.id, lot: 'L' + i, name: 'P' + i, amt: 10 })); return m; };
  await chk('D1a the freeze survives a restart and a feed outage (sticky startedAt on the row)', async () => { fresh(); const m = await manual3();
    startEvent(); ok(await call('ann', 'board', { id: m.id })); r = await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Zed', amt: 10 }); assert.strictEqual(r.s, 409, 'frozen after start');
    assert.ok(db['lock:calc:' + m.id].data.startedAt, 'startedAt stored on the row'); C._reset(); feedFail = true; r = await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Zed', amt: 10 }); assert.strictEqual(r.s, 409, 'after restart + ESPN down'); });
  await chk('D1b fail closed: feed unknown on/after the event start date -> frozen; before it -> open', async () => { fresh(); const m = await manual3();
    feedFail = true; C._reset(); ok(await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Zed', amt: 11 }), 'before the start date: still open');
    NOW = Z('2027-01-12T18:00:00Z'); C._reset(); r = await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Zed', amt: 12 }); assert.strictEqual(r.s, 409, 'feed down on/after the start date -> ' + r.s); });
  await chk('D2a undo of a sale the timer made but nobody polled yet is refused after the start', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' } })); const c = r.j.calc; ok(await call('bob', 'join', { code: c.code }));
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 100 })); tick(21000); startEvent();
    r = await call('ann', 'ctl', { id: c.id, op: 'undo' }); assert.strictEqual(r.s, 409, 'undo -> ' + r.s + ' ' + r.j.error); });
  await chk('D2b an auction left open into the games is closed at the start; no more bids / sold / next', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([1, 2, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' } })); const c = r.j.calc; ok(await call('bob', 'join', { code: c.code }));
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); startEvent();
    r = await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 100 }); assert.strictEqual(r.s, 409, 'bid after start'); for (const op of ['sold', 'next']) { r = await call('ann', 'ctl', { id: c.id, op }); assert.strictEqual(r.s, 409, op); }
    r = await call('bob', 'get', { id: c.id }); assert.strictEqual(r.j.calc.a.status, 'closed'); assert.ok(r.j.calc.notices.some((n) => /event (has )?started/i.test(n.what)), JSON.stringify(r.j.calc.notices)); assert.strictEqual(r.j.calc.started, true); });
  await chk('D3 clearing a hand-entered result does not unfreeze', async () => { fresh();
    r = await call('ann', 'create', { name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); const g = r.j.calc;
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', name: 'Cy', amt: 40 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Di', amt: 30 })); ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x1', champ: true })); ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x1', clear: true }));
    r = await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Ed', amt: 30 }); assert.strictEqual(r.s, 409); });
  await chk('D4 players of record lock once the lot is sold; changes before that are announced', async () => { fresh();
    r = await call('ann', 'create', { name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); const g = r.j.calc; ok(await call('cat', 'join', { code: g.code }));
    ok(await call('ann', 'por', { id: g.id, lot: 'L1', add: { name: 'Pat Lee' } })); r = await call('cat', 'get', { id: g.id }); assert.ok(r.j.calc.notices.some((n) => /Players of record for Red/.test(n.what)), 'announced');
    ok(await call('ann', 'enter', { id: g.id, lot: 'L2', pid: await pidOf('cat', g.id), amt: 50 }));
    r = await call('ann', 'por', { id: g.id, lot: 'L2', add: { me: true } }); assert.strictEqual(r.s, 409, 'commissioner cannot add himself after the sale');
    await assert.rejects(C.setPlayersOfRecord(g.id, 'L2', [pe(SID.ann)]), /sold/); });
  await chk('D5 set-ups with members, or recently active, are not pruned', async () => { fresh();
    r = await call('ann', 'create', base({ name: 'Has members' })); const a = r.j.calc; ok(await call('bob', 'join', { code: a.code }));
    r = await call('ann', 'create', base({ name: 'Edited lately' })); const b2 = r.j.calc; NOW += 60 * 864e5; C._reset(); ok(await call('ann', 'edit', Object.assign(base({ name: 'Edited lately' }), { id: b2.id })));
    NOW += 60 * 864e5; C._reset(); ok(await call('cat', 'create', base({ name: 'Trigger' }))); r = await call('ann', 'mine'); const ids = r.j.calcs.map((x) => x.id); assert.ok(ids.includes(a.id), 'with members kept'); assert.ok(ids.includes(b2.id), 'active 60 days ago kept'); });
  await chk('D6 NBA play-in: a 7v8 loser who wins the next play-in game is not out', async () => {
    const SG = (id, t0, a, b, head, series) => ({ id, t: t0, done: true, state: 'post', st: 3, week: 0, head, teams: [{ id: a, score: 100, winner: true }, { id: b, score: 90, winner: false }], series: series || null });
    const R = C.teamResults(C.EVENTS.nba_po, [SG('1', 1, 'A', 'B', 'East Play-In - 7 vs 8'), SG('2', 2, 'C', 'D', 'East Play-In - 9 vs 10'), SG('3', 3, 'B', 'C', 'East Play-In - 8th seed'), SG('4', 4, 'E', 'B', 'East 1st Round - Game 1', { done: false, wins: { E: 1, B: 0 } })], new Set(['A', 'B', 'C', 'D', 'E']));
    assert.deepStrictEqual([!!(R.B && R.B.out), !!(R.C && R.C.out), !!(R.D && R.D.out)], [false, true, true]); });
  await chk('S-ALL every Calcutta a player is in (buyer, co-owner, team player) gives a stats record with team(s), price paid, payout and net', async () => { fresh();
    r = await call('ann', 'create', { name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); const g = r.j.calc;
    for (const w of ['bob', 'cat', 'eve']) ok(await call(w, 'join', { code: g.code }));
    await C.setPlayersOfRecord(g.id, 'L1', [pe(SID.cat), { key: pe(SID.dan), accepted: true }]); // dan plays on Red and never joined the Calcutta; the group says he accepted (ROUND 4 #5: without that he is pending and has no record)
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('bob', g.id), amt: 40 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', pid: await pidOf('ann', g.id), amt: 30 }));
    ok(await call('cat', 'buyback', { id: g.id, lot: 'L1' })); ok(await call('ann', 'result', { confirm: true, id: g.id, team: 'x1', champ: true }));
    const recOf = async (w) => (await C.statsFor(pe(SID[w]), {})).find((x) => x.id === g.id);
    const bob = await recOf('bob'), cat = await recOf('cat'), dan = await recOf('dan'), ann = await recOf('ann'), eve = await recOf('eve');
    assert.ok(bob && cat && dan && ann, 'records: ' + [!!bob, !!cat, !!dan, !!ann]); assert.ok(!eve, 'a member who bought nothing and plays on no team has no record');
    assert.deepStrictEqual([bob.spent, bob.won, bob.pl, bob.extra.role], [20, 35, 15, ['buyer']]); assert.deepStrictEqual(bob.extra.teams.map((t) => [t.name, t.share, t.price, t.cost, t.earned, t.net]), [['Red', 'half', 40, 20, 35, 15]]);
    assert.deepStrictEqual([cat.spent, cat.won, cat.pl, cat.extra.role.sort()], [20, 35, 15, ['co-owner', 'player']]); assert.strictEqual(cat.extra.teams[0].role, 'co-owner + player'); assert.deepStrictEqual(cat.extra.teams[0].teams, ['Red']);
    assert.deepStrictEqual([dan.spent, dan.won, dan.pl, dan.extra.role, dan.place], [0, 0, 0, ['player'], undefined]); assert.deepStrictEqual([dan.extra.teams[0].name, dan.extra.teams[0].lotEarned, dan.extra.teams[0].holder], ['Red', 70, bob.extra.teams[0].holder]);
    assert.deepStrictEqual([ann.spent, ann.won, ann.pl, ann.extra.role, ann.extra.teams[0].name], [30, 0, -30, ['buyer'], 'Blue']); assert.strictEqual(ann.extra.over, true);
    assert.deepStrictEqual([bob.place.of, cat.place.of], [3, 3]);
    let S = null; try { S = require('/home/claude/calcutta-stats/odds-api/stats.js'); } catch (e) {} if (S && S.validate) for (const x of [bob, cat, dan, ann]) { const v = S.validate(x, 'calcutta'); assert.ok(v.ok, 'validate: ' + JSON.stringify(v)); assert.deepStrictEqual([v.rec.spent, v.rec.won, v.rec.pl], [x.spent, x.won, x.pl]); } });
  await chk('Low: NFL playoffs whose champion is in no lot is over after the final; board says started', async () => { fresh();
    r = await call('ann', 'create', base({ lots: lotsOf([2, 3]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' }, mode: 'manual' })); const m = r.j.calc; ok(await call('ann', 'enter', { id: m.id, lot: 'L1', name: 'Al', amt: 5 })); ok(await call('ann', 'enter', { id: m.id, lot: 'L2', name: 'Bo', amt: 5 }));
    startEvent(); r = await call('ann', 'board', { id: m.id }); assert.strictEqual(r.j.board.over, true); assert.strictEqual(r.j.calc.started, true); });
  console.log(res.join('\n')); console.log(fails.length ? '\nFAILED ' + fails.length + ' of ' + res.length : '\nPASS ' + res.length + ' review checks'); process.exit(fails.length ? 1 : 0);
});
