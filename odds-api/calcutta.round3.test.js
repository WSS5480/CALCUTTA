// Run: node odds-api/calcutta.round3.test.js   (round 3: fixes from the "DO NOT SHIP" re-review of calcutta-v1 @c3d6bea + the Playbook items; every check failed on c3d6bea)   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes; the clock is fake)
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

const fails = [], res = [];
async function chk(name, fn) { try { await fn(); res.push('  ok ' + name); } catch (e) { fails.push(name); res.push('  FAIL ' + name + ' :: ' + (e && e.message || e).toString().split('\n').slice(0, process.env.V ? 30 : 1).join('\n')); } }
const pidOf = async (who, id) => (await call(who, 'get', { id })).j.calc.me;
const real = (ms) => new Promise((r) => setTimeout(r, ms)); // real time, for the background feed read to land
// ---- a feed each test sets: feed(url) -> ESPN events for that scoreboard page (teams still come from the fake above); hang = ESPN never answers ----
let feed = null, hang = false, feedCalls = 0; const f0 = D.fetch;
D.fetch = async (u) => { if (/\/teams\?/.test(u)) return f0(u); feedCalls++; if (hang) return new Promise(() => {}); if (feedFail) throw new Error('ESPN down'); return { ok: true, json: async () => ({ events: feed ? feed(u) || [] : [] }) }; };
const EVT = (id, st, week, t, a, b, state, head) => ({ id: String(id), date: new Date(t).toISOString(), season: { type: st }, week: { number: week }, status: { type: { state, completed: state === 'post', name: state === 'post' ? 'STATUS_FINAL' : state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_SCHEDULED' } }, competitions: [{ notes: head ? [{ headline: head }] : [], competitors: [{ team: { id: String(a) }, score: state === 'pre' ? '0' : '7', winner: state === 'post' }, { team: { id: String(b) }, score: state === 'pre' ? '0' : '3', winner: false }] }] });
const wk1 = (ev) => (u) => (/seasontype=3&week=1&/.test(u) ? [ev] : []);
const at = (iso) => { feed = null; hang = false; feedFail = false; C._reset(); NOW = Z(iso); };
const SMALL = (o) => base(Object.assign({ lots: lotsOf([1, 2, 7, 8]), rows: [{ k: 'champ', n: 1, pct: 100 }], take: { kind: 'none' } }, o || {}));
const LOCAL = (o) => Object.assign({ name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }, { teams: [{ name: 'Green' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }, o || {});
const frozen = (r, m) => { assert.strictEqual(r.s, 409, m + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 200)); assert.strictEqual(r.j.code, 'frozen', m + ' code ' + r.j.code); };
const row = (id) => db['lock:calc:' + id].data;
srv.listen(0, async () => {
  P = srv.address().port; let r;
  // ===== 1 HIGH: a bracket that is only SCHEDULED has not started =====
  await chk('1a NFL playoffs: a wild-card game scheduled six days out leaves the auction live (start 200, bids 200, board does not close it); it locks at the kickoff by the clock', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL()); ok(r); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code }));
    at('2027-01-11T02:00:00Z'); const KO = Z('2027-01-16T21:30:00Z'); feed = wk1(EVT(901, 3, 1, KO, 2, 7, 'pre'));
    ok(await call('ann', 'get', { id: c.id })); await real(40); // the commissioner opens the screen: the schedule is read in the background
    r = await call('ann', 'ctl', { id: c.id, op: 'start' }); ok(r, 'start with the bracket only scheduled'); r = await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 200 }); ok(r, 'bid');
    r = await call('cat', 'board', { id: c.id }); ok(r); assert.strictEqual(r.j.calc.a.status, 'live', 'the board must not close a scheduled-only event'); assert.strictEqual(r.j.calc.started, false); assert.ok(!row(c.id).startedAt, 'startedAt not set');
    assert.strictEqual(r.j.calc.kick, KO, 'members are told when ownership locks'); assert.strictEqual(r.j.board.lots.find((l) => l.id === 'L2').teams[0].r.reached, 1, 'the scheduled game still shows as the round reached');
    ok(await call('ann', 'ctl', { id: c.id, op: 'sold' })); ok(await call('ann', 'ctl', { id: c.id, op: 'next' })); r = await call('cat', 'bid', { id: c.id, lot: 'L2', amt: 200 }); ok(r, 'bid 200 on the next lot');
    NOW = KO + 1000; frozen(await call('bob', 'bid', { id: c.id, lot: 'L2', amt: 300 }), 'bid one second after the kickoff');
    r = await call('bob', 'get', { id: c.id }); assert.strictEqual(r.j.calc.a.status, 'closed'); assert.strictEqual(r.j.calc.started, true); assert.ok(row(c.id).startedAt); });
  await chk('1b March Madness (date window): a first-round game scheduled for this afternoon does not freeze the morning; tomorrow\'s tip-off is known the day before', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL({ ev: 'mm' })); ok(r); const c = r.j.calc; ok(await call('bob', 'join', { code: c.code })); const TIP = Z('2027-03-18T16:15:00Z');
    at('2027-03-17T20:00:00Z'); feed = (u) => (/dates=20270318/.test(u) ? [EVT(77, 3, 0, TIP, 2, 30, 'pre', "Men's Basketball Championship - South Region - 1st Round")] : []);
    r = await call('ann', 'get', { id: c.id }); await real(40); r = await call('ann', 'get', { id: c.id }); assert.strictEqual(r.j.calc.kick, TIP, 'the day before: kick ' + r.j.calc.kick);
    at('2027-03-18T13:00:00Z'); feed = (u) => (/dates=20270318/.test(u) ? [EVT(77, 3, 0, TIP, 2, 30, 'pre', "Men's Basketball Championship - South Region - 1st Round")] : []);
    ok(await call('ann', 'get', { id: c.id })); await real(40); ok(await call('ann', 'ctl', { id: c.id, op: 'start' }), 'start on the morning of game day'); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 200 }), 'bid on the morning of game day');
    r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.calc.a.status, 'live'); NOW = TIP; frozen(await call('ann', 'ctl', { id: c.id, op: 'sold' }), 'sold at the tip-off'); });
  await chk('1c a postponed game does not start the event; a game in progress does, even before its listed time', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL()); const c = r.j.calc; at('2027-01-11T02:00:00Z'); const KO = Z('2027-01-16T21:30:00Z'); const pp = EVT(901, 3, 1, Z('2027-01-10T21:30:00Z'), 2, 7, 'post'); pp.status.type = { state: 'post', completed: false, name: 'STATUS_POSTPONED' };
    feed = (u) => (/week=1&/.test(u) ? [pp, EVT(902, 3, 1, KO, 1, 8, 'pre')] : []); ok(await call('ann', 'get', { id: c.id })); await real(40); ok(await call('ann', 'ctl', { id: c.id, op: 'start' }), 'postponed game ignored');
    C._reset(); feed = wk1(EVT(902, 3, 1, KO, 1, 8, 'in')); r = await call('ann', 'board', { id: c.id }); assert.strictEqual(r.j.calc.started, true, 'in progress -> started'); });
  // ===== 2 MEDIUM: plugged sources (golf, local events) freeze too, and fail closed =====
  const SRC = { on: false, t0: null, R: {}, boom: false, asked: 0 };
  C.registerSource('golf', { local: true, teams: async () => [{ id: 'g1', name: 'Pair A' }, { id: 'g2', name: 'Pair B' }, { id: 'g3', name: 'Pair C' }], results: async () => { SRC.asked++; if (SRC.boom) throw new Error('golf db down'); return SRC.R; }, started: async () => SRC.on, startTime: async () => SRC.t0 });
  const golf = async () => { Object.assign(SRC, { on: false, t0: null, R: {}, boom: false }); at('2026-11-17T18:00:00Z'); r = await call('ann', 'create', { name: 'Golf src', ev: 'golf', lots: ['g1', 'g2', 'g3'].map((id) => ({ teams: [{ id, name: id }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); ok(r); const g = r.j.calc; ok(await call('bob', 'join', { code: g.code }));
    ok(await call('ann', 'por', { id: g.id, lot: 'L1', add: { pid: await pidOf('bob', g.id) } })); ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('ann', g.id), amt: 40 })); return g; };
  await chk('2a plugged source says started() -> buy-back and enter are 409 frozen (seconds later, no restart); sticky after the source changes its mind', async () => { const g = await golf();
    tick(5000); SRC.on = true; frozen(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'buy-back'); frozen(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }), 'enter'); frozen(await call('ann', 'unenter', { id: g.id, lot: 'L1' }), 'unenter');
    SRC.on = false; tick(60000); frozen(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'still frozen'); assert.ok(row(g.id).startedAt); });
  await chk('2b plugged source start time: the server clock locks it at the first tee time; any result locks it too', async () => { let g = await golf(); SRC.t0 = NOW + 3600e3;
    tick(5000); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }), 'before the tee time'); r = await call('ann', 'get', { id: g.id }); assert.strictEqual(r.j.calc.kick, SRC.t0);
    NOW = SRC.t0 + 1000; frozen(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'buy-back after the tee time'); frozen(await call('ann', 'enter', { id: g.id, lot: 'L3', name: 'Zed', amt: 5 }), 'enter after the tee time');
    g = await golf(); tick(5000); SRC.R = { g1: { wins: 0, winT: [], reached: 0, reachT: {}, champ: false, out: false, place: 1 } }; frozen(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'a result from the source'); frozen(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }), 'enter after a result'); });
  await chk('2c fail closed: a source that throws locks ownership (409) until it answers again', async () => { const g = await golf(); tick(5000); SRC.boom = true;
    r = await call('bob', 'buyback', { id: g.id, lot: 'L1' }); assert.strictEqual(r.s, 409, 'buy-back while the source is down -> ' + r.s); assert.strictEqual(r.j.code, 'feed'); r = await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }); assert.strictEqual(r.s, 409, 'enter while the source is down');
    assert.ok(!row(g.id).startedAt, 'not marked started for good'); SRC.boom = false; tick(5000); ok(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'the source is back and has not started'); });
  // ===== 3 MEDIUM: no ownership change after the kickoff, whatever the caches say =====
  await chk('3 sale at 17:58, kickoff 18:00: at 18:00:01 undo / bid / sold are all 409 (feed still cached as "scheduled")', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL()); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code }));
    at('2027-01-09T17:50:00Z'); feed = wk1(EVT(901, 3, 1, T0, 2, 7, 'pre')); ok(await call('ann', 'get', { id: c.id })); await real(40);
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); NOW = Z('2027-01-09T17:58:00Z'); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 50 })); ok(await call('ann', 'ctl', { id: c.id, op: 'sold' })); ok(await call('ann', 'ctl', { id: c.id, op: 'next' })); ok(await call('cat', 'bid', { id: c.id, lot: 'L2', amt: 20 }));
    NOW = Z('2027-01-09T17:59:50Z'); r = await call('ann', 'get', { id: c.id }); assert.strictEqual(r.j.calc.a.cur, 'L3', 'L2 sold by its timer at 17:58:20, L3 on the block'); ok(await call('bob', 'bid', { id: c.id, lot: 'L3', amt: 30 })); // this bid's bell (18:00:10) is after the kickoff
    const n0 = feedCalls; NOW = T0 + 1000; frozen(await call('ann', 'ctl', { id: c.id, op: 'undo' }), 'undo'); frozen(await call('cat', 'bid', { id: c.id, lot: 'L3', amt: 60 }), 'bid'); frozen(await call('ann', 'ctl', { id: c.id, op: 'sold' }), 'sold');
    NOW = T0 + 15000; r = await call('bob', 'get', { id: c.id }); assert.strictEqual(r.j.calc.a.status, 'closed'); frozen(await call('ann', 'ctl', { id: c.id, op: 'undo' }), 'undo later');
    assert.strictEqual(feedCalls, n0, 'decided by the clock and the cached kickoff, not by a new feed read'); const d = row(c.id); assert.deepStrictEqual(Object.keys(d.sold).sort(), ['L1', 'L2'], 'a timer that would ring after the kickoff sells nothing'); assert.ok(d.sold.L2.at < T0); assert.strictEqual(d.sold.L1.amt, 50); assert.ok(d.startedAt); assert.strictEqual(d.a.status, 'closed');
    C._reset(); hang = true; frozen(await call('ann', 'ctl', { id: c.id, op: 'undo' }), 'after a restart with the feed hanging'); });
  // ===== 4 MEDIUM: a slow feed never stalls the auction =====
  await chk('4a a hanging feed adds no latency to bids or controls (kickoff known from the row + the clock), and the lot cannot sell to the previous bidder while a bid waits', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL({ timer: 10 })); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code }));
    at('2027-01-12T18:00:00Z'); ok(await call('ann', 'get', { id: c.id })); await real(40); // event week, bracket not posted yet: the feed answers "nothing scheduled"
    ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 50 })); await real(40);
    C._reset(); hang = true; tick(8500); // a restart, and ESPN stops answering; bob's 10 s timer has 1.5 s left
    const t0 = Date.now(), p = call('cat', 'bid', { id: c.id, lot: 'L1', amt: 55 }); await real(250); tick(2000); await call('ann', 'get', { id: c.id }); // the clock runs past bob's bell while cat's bid is in
    r = await p; const ms = Date.now() - t0; ok(r, 'bid with the feed hanging'); assert.ok(ms < 1500, 'bid took ' + ms + ' ms');
    r = await call('ann', 'get', { id: c.id }); assert.strictEqual(r.j.calc.sold.length, 0, 'not sold to the previous bidder'); assert.strictEqual(r.j.calc.a.high.name, 'CatBets');
    for (const [who, op, b] of [['bob', 'bid', { lot: 'L1', amt: 60 }], ['ann', 'ctl', { op: 'sold' }], ['ann', 'ctl', { op: 'next' }], ['cat', 'bid', { lot: 'L2', amt: 5 }], ['ann', 'ctl', { op: 'undo' }]]) { const t1 = Date.now(); r = await call(who, op, Object.assign({ id: c.id }, b)); ok(r, op + ' ' + JSON.stringify(b)); assert.ok(Date.now() - t1 < 500, op + ' took ' + (Date.now() - t1) + ' ms'); } });
  await chk('4b feed failures are cached briefly: a burst of polls and bids while ESPN is down makes one read, not one per request', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL()); const c = r.j.calc; ok(await call('bob', 'join', { code: c.code })); at('2027-01-12T18:00:00Z'); ok(await call('ann', 'get', { id: c.id })); await real(40); ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); await real(40);
    tick(6 * 60e3); feedFail = true; const n0 = feedCalls; for (let i = 0; i < 6; i++) { ok(await call('bob', 'state', { id: c.id, rev: -1 })); ok(await call(i % 2 ? 'bob' : 'ann', 'bid', { id: c.id, lot: 'L1', amt: 5 + 5 * i }), 'bid ' + i); tick(1500); }
    await real(40); assert.ok(feedCalls - n0 <= 4, 'feed reads during the outage: ' + (feedCalls - n0)); });
  // ===== 5 MEDIUM: players of record stay locked through unenter =====
  await chk('5 enter L1, unenter L1, por add {me:true} is refused (sticky lock), so the commissioner cannot buy back his own way in; the lock is in the history', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', LOCAL()); ok(r); const g = r.j.calc; ok(await call('cat', 'join', { code: g.code })); const cat = await pidOf('cat', g.id);
    ok(await call('ann', 'por', { id: g.id, lot: 'L2', add: { name: 'Pat Lee' } }), 'before any sale: allowed'); ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: cat, amt: 50 })); ok(await call('ann', 'unenter', { id: g.id, lot: 'L1' }));
    r = await call('ann', 'por', { id: g.id, lot: 'L1', add: { me: true } }); assert.strictEqual(r.s, 409, 'por add after unenter -> ' + r.s); assert.strictEqual(r.j.code, 'porlocked'); await assert.rejects(C.setPlayersOfRecord(g.id, 'L1', [pe(SID.ann)]), /locked/);
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: cat, amt: 50 })); r = await call('ann', 'buyback', { id: g.id, lot: 'L1', self: true }); assert.notStrictEqual(r.s, 200, 'self buy-back');
    r = await call('ann', 'get', { id: g.id }); assert.strictEqual(r.j.calc.lots[0].porLocked, true); assert.strictEqual(r.j.calc.lots[2].porLocked, false);
    const a = row(g.id).audit.map((x) => x.what); assert.ok(a.some((x) => /Players of record for Red are locked/.test(x)), 'lock audited'); assert.ok(a.some((x) => /Players of record for Blue: Pat Lee \(was: none\)/.test(x)), 'change audited with before/after: ' + a.join(' | ')); });
  // ===== 6: the first hand-entered result starts the event for good: confirm first =====
  await chk('6 the first result needs a confirm; with lots still unsold it needs "close the auction with N lots unsold"; then the freeze is permanent and the client is told', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', LOCAL()); const g = r.j.calc; ok(await call('ann', 'enter', { id: g.id, lot: 'L1', name: 'Cy', amt: 40 }));
    r = await call('ann', 'get', { id: g.id }); assert.deepStrictEqual([r.j.calc.started, r.j.calc.unsold], [false, 2]);
    r = await call('ann', 'result', { id: g.id, team: 'x1', champ: true }); assert.strictEqual(r.s, 409, 'no confirm -> ' + r.s); assert.deepStrictEqual([r.j.code, r.j.unsold], ['confirmstart', 2]); assert.ok(/Entering a result starts the event\. Sales, buy-backs and players lock for good\./.test(r.j.error) && /close the auction with 2 lots unsold/.test(r.j.error), r.j.error);
    r = await call('ann', 'result', { id: g.id, team: 'x1', champ: true, confirm: true }); assert.strictEqual(r.s, 409, 'confirm without the unsold count'); r = await call('ann', 'result', { id: g.id, team: 'x1', champ: true, confirm: true, closeUnsold: 1 }); assert.strictEqual(r.s, 409, 'stale unsold count');
    assert.ok(!row(g.id).startedAt && !Object.keys(row(g.id).manual).length, 'nothing saved yet'); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Di', amt: 30 }), 'still open');
    r = await call('ann', 'result', { id: g.id, team: 'x1', champ: true, confirm: true, closeUnsold: 1 }); ok(r, 'confirmed'); assert.deepStrictEqual([r.j.calc.started, r.j.calc.a.status], [true, 'closed']); assert.ok(r.j.calc.notices.some((n) => /auction is closed \(1 lot unsold\)/.test(n.what)), JSON.stringify(r.j.calc.notices));
    frozen(await call('ann', 'enter', { id: g.id, lot: 'L3', name: 'Ed', amt: 30 }), 'enter after the first result'); ok(await call('ann', 'result', { id: g.id, team: 'x2', place: 2 }), 'later results need no confirm');
    assert.ok(row(g.id).audit.some((x) => /Confirmed: entering a result starts the event and closes the auction with 1 lot unsold/.test(x.what)));
    r = await call('ann', 'create', LOCAL()); const h = r.j.calc; for (let i = 1; i <= 3; i++) ok(await call('ann', 'enter', { id: h.id, lot: 'L' + i, name: 'P' + i, amt: 10 }));
    r = await call('ann', 'result', { id: h.id, team: 'x1', champ: true }); assert.deepStrictEqual([r.s, r.j.unsold], [409, 0]); ok(await call('ann', 'result', { id: h.id, team: 'x1', champ: true, confirm: true }), 'every lot entered: one confirm'); });
  // ===== 7 LOW: prune =====
  await chk('7 prune: never a Calcutta attached to a group, or one with team players; the commissioner looking at it is activity', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL({ name: 'Alone idle' })); const p1 = r.j.calc; r = await call('ann', 'create', SMALL({ name: 'Alone in group' })); const p2 = r.j.calc; C.hooks.groupRole = async (gid, mk) => (mk === C.mkOf(pe(SID.ann)) ? 'comm' : null); /* ROUND 4 B3: only that group's commissioner attaches */ await C.attachToGroup(p2.id, 'G1', 'C1');
    r = await call('ann', 'create', LOCAL({ name: 'Alone w players' })); const p4 = r.j.calc; await C.setPlayersOfRecord(p4.id, 'L1', [pe(SID.dan)]); r = await call('ann', 'create', SMALL({ name: 'Alone viewed daily' })); const p5 = r.j.calc;
    for (let d = 0; d < 95; d++) { NOW += 864e5; if (d % 10 === 0) C._reset(); await call('ann', 'get', { id: p5.id }); await real(2); }
    C._reset(); ok(await call('cat', 'create', SMALL({ name: 'Trigger' }))); r = await call('ann', 'mine'); const names = r.j.calcs.map((x) => x.name).filter((n) => /^Alone/.test(n)).sort();
    assert.deepStrictEqual(names, ['Alone in group', 'Alone viewed daily', 'Alone w players'], JSON.stringify(names)); ok(await call('eve', 'join', { code: p5.code }), 'the viewed one can still be joined by its code'); void p1; });
  // ===== 8 S-ALL: guests get their record when they claim an account; co-owner place by account key =====
  await chk('8a a guest player of record (g:<id>) has a record, and it moves to the account when the guest claims one', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', LOCAL()); const g = r.j.calc; ok(await call('bob', 'join', { code: g.code })); await C.setPlayersOfRecord(g.id, 'L1', [{ guest: 'abc', name: 'Gil Guest' }]);
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('bob', g.id), amt: 40 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Di', amt: 30 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L3', name: 'Ed', amt: 30 })); ok(await call('ann', 'buyback', { id: g.id, lot: 'L1', who: 0 })); ok(await call('ann', 'result', { id: g.id, team: 'x1', champ: true, confirm: true }));
    let x = (await C.statsFor('g:abc', {})).find((y) => y.id === g.id); assert.ok(x, 'guest record'); assert.deepStrictEqual([x.spent, x.won, x.pl, x.extra.role.sort()], [20, 50, 30, ['co-owner', 'player']]);
    assert.ok(!(await C.statsFor(pe(SID.dan), {})).some((y) => y.id === g.id), 'dan has nothing before the claim'); await assert.rejects(C.claimGuest('abc', pe(SID.dan)), /not valid/, 'ROUND 4 #7: a guest id alone claims nothing'); const out = await C.claimGuest(await C.reissueGuestToken(g.id, 'abc'), pe(SID.dan)); assert.strictEqual(out.calcs, 1);
    x = (await C.statsFor(pe(SID.dan), {})).find((y) => y.id === g.id); assert.ok(x, 'record after the claim'); assert.deepStrictEqual([x.spent, x.won, x.pl, x.extra.role.sort(), x.place], [20, 50, 30, ['co-owner', 'player'], { n: 2, of: 4 }]);
    assert.ok(!(await C.statsFor('g:abc', {})).some((y) => y.id === g.id), 'the guest id is retired'); assert.ok(row(g.id).audit.some((a) => /Guest Gil Guest claimed an Oddable account/.test(a.what)));
    ok(await call('dan', 'join', { code: g.code }).then((j) => (j.s === 409 ? { s: 200 } : j))); x = (await C.statsFor(pe(SID.dan), {})).find((y) => y.id === g.id); assert.deepStrictEqual([x.spent, x.won], [20, 50]); });
  await chk('8b a co-owner who is an account but not a member is his own owner (never merged with a typed name that reads the same); place by account key', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', LOCAL({ rows: [{ k: 'champ', n: 1, pct: 60 }, { k: 'place', r: 2, n: 1, pct: 40 }] })); const g = r.j.calc; ok(await call('bob', 'join', { code: g.code })); await C.setPlayersOfRecord(g.id, 'L1', [{ guest: 'dg', name: 'Player' }]); // ROUND 4: a co-owner who is an account but not a member now only comes from a guest who claimed (the commissioner cannot record a buy-back for an account that never joined)
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('bob', g.id), amt: 40 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Player', amt: 60 })); ok(await call('ann', 'enter', { id: g.id, lot: 'L3', name: 'Ed', amt: 100 }));
    ok(await call('ann', 'buyback', { id: g.id, lot: 'L1', who: 0 })); await C.claimGuest(await C.reissueGuestToken(g.id, 'dg'), pe(SID.dan)); ok(await call('ann', 'result', { id: g.id, team: 'x2', champ: true, confirm: true })); ok(await call('ann', 'result', { id: g.id, team: 'x1', place: 2 }));
    r = await call('ann', 'board', { id: g.id }); const ow = r.j.board.owners; assert.strictEqual(ow.length, 4, 'four owners: ' + JSON.stringify(ow.map((o) => [o.name, o.spent, o.won]))); assert.strictEqual(new Set(ow.map((o) => o.oid)).size, 4, 'each owner has its own id for the drill-down');
    const typed = ow.find((o) => o.spent === 60); assert.deepStrictEqual([typed.won, typed.place], [120, 1]); const dan = (await C.statsFor(pe(SID.dan), {})).find((y) => y.id === g.id);
    assert.deepStrictEqual([dan.spent, dan.won, dan.pl, dan.place], [20, 40, 20, { n: 3, of: 4 }], JSON.stringify([dan.spent, dan.won, dan.pl, dan.place])); assert.ok(!JSON.stringify(r.j).includes(C.mkOf(pe(SID.dan))), 'no account key leaves the server'); });
  // ===== Playbook play 10 (rules expert) =====
  await chk('P1 unsold lots that win: the commissioner picks the rule at set-up (roll pro rata = default, or carry to the next Calcutta); members see it before the auction; the money adds up to the cent', async () => { at('2026-11-17T18:00:00Z');
    const four = (o) => LOCAL(Object.assign({ lots: ['Red', 'Blue', 'Green', 'Gold'].map((n) => ({ teams: [{ name: n }] })), rows: [{ k: 'champ', n: 1, pct: 40 }, { k: 'place', r: 2, n: 1, pct: 30 }, { k: 'place', r: 3, n: 1, pct: 20 }, { k: 'place', r: 4, n: 1, pct: 10 }] }, o));
    r = await call('ann', 'create', four({ unsold: 'pot holder' })); assert.strictEqual(r.s, 400, 'only the two rules are offered'); r = await call('ann', 'events'); assert.deepStrictEqual(r.j.unsold.map((x) => x.key), ['roll', 'carry']);
    r = await call('ann', 'create', four()); ok(r); const g = r.j.calc; assert.strictEqual(g.rules.unsold, 'roll', 'default'); r = await call('bob', 'preview', { code: g.code }); assert.ok(/roll into the payouts of the sold lots, pro rata/.test(r.j.calc.unsoldText), 'shown before joining: ' + r.j.calc.unsoldText);
    for (const [l, n, a] of [['L1', 'Al', 50], ['L2', 'Bo', 30], ['L3', 'Cy', 20]]) ok(await call('ann', 'enter', { id: g.id, lot: l, name: n, amt: a })); ok(await call('ann', 'result', { id: g.id, team: 'x4', champ: true, confirm: true, closeUnsold: 1 }));
    r = await call('ann', 'board', { id: g.id }); let b = r.j.board; assert.deepStrictEqual([b.pool, b.paidOut, b.unclaimed, b.rolled, b.unsoldRule], [100, 0, 40, 0, 'roll'], 'waits until a sold lot earns');
    ok(await call('ann', 'result', { id: g.id, team: 'x1', place: 2 })); ok(await call('ann', 'result', { id: g.id, team: 'x2', place: 3 })); ok(await call('ann', 'result', { id: g.id, team: 'x3', place: 4 })); r = await call('ann', 'board', { id: g.id }); b = r.j.board;
    assert.deepStrictEqual(b.lots.map((l) => [l.name, l.earned, l.rolled]), [['Red', 50.01, 20.01], ['Blue', 33.33, 13.33], ['Green', 16.66, 6.66], ['Gold', 40, 0]]); assert.deepStrictEqual([b.paidOut, b.unclaimed, b.rolled, b.inPlay], [100, 0, 40, 0]);
    assert.strictEqual(Math.round(b.owners.reduce((a, o) => a + o.won * 100, 0)), 10000, 'owners are paid exactly the pool');
    r = await call('ann', 'create', four({ unsold: 'carry' })); const k = r.j.calc; r = await call('bob', 'preview', { code: k.code }); assert.ok(/carry to the next Calcutta/.test(r.j.calc.unsoldText));
    for (const [l, n, a] of [['L1', 'Al', 50], ['L2', 'Bo', 30], ['L3', 'Cy', 20]]) ok(await call('ann', 'enter', { id: k.id, lot: l, name: n, amt: a })); ok(await call('ann', 'result', { id: k.id, team: 'x4', champ: true, confirm: true, closeUnsold: 1 })); ok(await call('ann', 'result', { id: k.id, team: 'x1', place: 2 }));
    r = await call('ann', 'board', { id: k.id }); b = r.j.board; assert.deepStrictEqual([b.paidOut, b.carry, b.unclaimed, b.rolled, b.lots[0].earned, b.inPlay], [30, 40, 40, 0, 30, 30]); });
  await chk('P2 commissioner Pause / Undo / Sold now reach every member live (a notice on the next poll), not only the history', async () => { at('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', SMALL()); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code })); ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); ok(await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 50 })); ok(await call('cat', 'bid', { id: c.id, lot: 'L1', amt: 60 }));
    const seen = async (re, what) => { tick(1100); const rev = (await call('bob', 'get', { id: c.id })).j.calc.rev; r = await call('cat', 'state', { id: c.id, rev: rev - 1 }); assert.ok(r.j.calc && r.j.calc.notices.some((n) => re.test(n.what) && n.by === 'AnnBets'), what + ': ' + JSON.stringify(r.j.calc && r.j.calc.notices)); };
    ok(await call('ann', 'ctl', { id: c.id, op: 'pause' })); await seen(/paused the auction/, 'pause'); ok(await call('ann', 'ctl', { id: c.id, op: 'resume' })); await seen(/resumed/, 'resume');
    ok(await call('ann', 'ctl', { id: c.id, op: 'undo' })); await seen(/undid a \$60 bid by CatBets on /, 'undo bid'); ok(await call('ann', 'ctl', { id: c.id, op: 'sold' })); await seen(/used Sold now: .* to BobBets for \$50/, 'sold now');
    ok(await call('ann', 'ctl', { id: c.id, op: 'undo' })); await seen(/undid the sale of /, 'undo sale'); });
  await chk('P3 the bid timer defaults to 25 seconds (10 / 20 / 25 / 30 offered)', async () => { at('2026-11-17T18:00:00Z'); const b = SMALL(); delete b.timer;
    r = await call('ann', 'create', b); ok(r, 'no timer sent'); assert.strictEqual(r.j.calc.rules.timer, 25); r = await call('ann', 'events'); assert.deepStrictEqual([r.j.timers, r.j.timer0], [[10, 20, 25, 30], 25]);
    const c = (await call('ann', 'create', SMALL({ timer: 25 }))).j.calc; ok(await call('bob', 'join', { code: c.code })); ok(await call('ann', 'ctl', { id: c.id, op: 'start' })); r = await call('bob', 'bid', { id: c.id, lot: 'L1', amt: 5 }); assert.strictEqual(r.j.calc.a.endsAt - r.j.calc.now, 25000); });
  await chk('P4 the people cap is the shared limits.maxPeople (8 standard, Enterprise 500, owner-set extra seats); the engine has no ceiling of its own', async () => { at('2026-11-17T18:00:00Z');
    assert.strictEqual(C.limits, undefined, 'no stand-in limits in the engine'); const asked = []; const m0 = LIM.maxPeople; LIM.maxPeople = async (k, id) => { asked.push([k, id]); return m0(k, id); };
    try { r = await call('ann', 'create', SMALL()); const c = r.j.calc; assert.strictEqual(c.max, 8); assert.ok(asked.some((x) => x[0] === LIM.keyOf(pe(SID.ann)) && x[1] === c.id), 'asked the shared helper with the account key and the game id');
      for (const w of ['bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal']) ok(await call(w, 'join', { code: c.code })); r = await call('ivy', 'join', { code: c.code }); assert.strictEqual(r.s, 409, '9th person on a standard account'); assert.strictEqual(r.j.code, 'cap');
      await enterprise('ann', true); r = await call('ivy', 'join', { code: c.code }); ok(r, 'Enterprise account'); assert.strictEqual(r.j.calc.max, 500); r = await call('ann', 'events'); assert.strictEqual(r.j.max, 500); r = await call('bob', 'events'); assert.strictEqual(r.j.max, 8);
      await enterprise('ann', false); r = await call('jon', 'join', { code: c.code }); assert.strictEqual(r.s, 409, 'flag off again');
      if (SHARED) { await LIM.admin({ op: 'seats', id: c.id, n: 2 }); NOW += 31e3; r = await call('jon', 'join', { code: c.code }); ok(r, 'owner-set extra seats for this one game'); assert.strictEqual(r.j.calc.max, 10); await LIM.admin({ op: 'seats', id: c.id, n: 0 }); }
    } finally { LIM.maxPeople = m0; } });
  // ===== Golf coder (golf-v1): the source gets the Calcutta, `teams(calc)`; a `golf-day` event; started() contract =====
  const GD = { seen: [], on: false, boom: false, t0: null };
  const gdTeams = { GD1: [{ id: 't:GD1:T1', name: 'Lee / Cruz', players: ['Pat Lee', { key: C.mkOf(pe(SID.bob)) }] }, { id: 't:GD1:T2', name: 'Diaz / Kim', players: ['Rosa Diaz', 'g:walkin7'] }, { id: 't:GD1:T3', name: 'Ortiz / Vu' }] };
  const standIn = (tag) => ({ teams: async (calc) => { GD.seen.push([tag, 'teams', calc && calc.golf]); const r = (calc && calc.golf) || {}; return r.gameId ? gdTeams[r.gameId] || [] : [{ id: 'g:' + (r.eventId || 'thisweek') + '-1', name: 'Scottie S' }, { id: 'g:' + (r.eventId || 'thisweek') + '-2', name: 'Rory M' }]; },
    results: async (calc) => { GD.seen.push([tag, 'results', calc.golf, calc.id]); return {}; }, started: async (calc) => { if (GD.boom) return null; return GD.on; }, startTime: async () => GD.t0, organizer: async () => true /* ROUND 4 #5: the stand-in says the caller runs that golf day */ });
  await chk('G1 golf-day: the source is handed the Calcutta (teams(calc) with calc.golf = the golf day); its teams are the lots, its players the players of record', async () => { at('2026-11-17T18:00:00Z');
    C.registerSource('golf-day', Object.assign(standIn('day'), { local: true })); C.registerSource('golf', standIn('pro'));
    r = await call('ann', 'events'); const e = r.j.events.find((x) => x.key === 'golf-day'); assert.ok(e && e.on && e.local && e.needsRef === 'gameId', JSON.stringify(e));
    r = await call('ann', 'teams', { ev: 'golf-day' }); assert.strictEqual(r.s, 400, 'which golf day?'); r = await call('ann', 'teams', { ev: 'golf-day', golf: { gameId: 'GD1' } }); ok(r); assert.deepStrictEqual(r.j.teams.map((t) => [t.id, t.name, t.players]), [['t:GD1:T1', 'Lee / Cruz', 2], ['t:GD1:T2', 'Diaz / Kim', 2], ['t:GD1:T3', 'Ortiz / Vu', 0]]);
    assert.deepStrictEqual(GD.seen[GD.seen.length - 1], ['day', 'teams', { gameId: 'GD1' }]);
    const mk = (o) => Object.assign({ name: 'Member Day Calcutta', ev: 'golf-day', golf: { gameId: 'GD1' }, lots: gdTeams.GD1.map((t) => ({ teams: [{ id: t.id, name: t.name }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 100 }], minBid: 5, inc: 5, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }, o);
    r = await call('ann', 'create', mk({ golf: null })); assert.strictEqual(r.s, 400, 'no golf day named'); r = await call('ann', 'create', mk({ golf: { gameId: 'NOPE' } })); assert.strictEqual(r.s, 400, 'a golf day with no teams');
    r = await call('ann', 'create', mk({ lots: [{ teams: [{ id: 't:GD1:T1', name: 'x' }] }, { teams: [{ id: 't:OTHER:T9', name: 'y' }] }] })); assert.strictEqual(r.s, 400, 'a team of another golf day');
    r = await call('ann', 'create', mk()); ok(r); const g = r.j.calc; assert.deepStrictEqual(g.golf, { gameId: 'GD1' }); assert.deepStrictEqual(row(g.id).golf, { gameId: 'GD1' }); ok(await call('bob', 'join', { code: g.code }));
    assert.deepStrictEqual(g.lots.map((l) => [l.teams[0].id, l.name, l.por.map((p) => p.name)]), [['t:GD1:T1', 'Lee / Cruz', ['Pat Lee', 'Player']], ['t:GD1:T2', 'Diaz / Kim', ['Rosa Diaz', 'Player']], ['t:GD1:T3', 'Ortiz / Vu', []]], 'a plain name from the source is a name (not an account)');
    assert.deepStrictEqual(row(g.id).lots[0].por.map((p) => p.k), ['n:pat lee', C.mkOf(pe(SID.bob))]); assert.strictEqual(row(g.id).lots[1].por[1].k, 'g:walkin7');
    ok(await call('ann', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('ann', g.id), amt: 40 })); assert.ok(GD.seen.some((x) => x[1] === 'results' && x[3] === g.id && x[2] && x[2].gameId === 'GD1'), 'results(calc) gets the stored Calcutta with its golf day');
    tick(6000); GD.boom = true; r = await call('bob', 'buyback', { id: g.id, lot: 'L1' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'feed'], 'started() cannot tell -> locked, not for good'); assert.ok(!row(g.id).startedAt);
    GD.boom = false; tick(6000); ok(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'bob is a player of record of his own team: buy-back'); tick(6000); GD.on = true; frozen(await call('ann', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }), 'the golf day teed off');
    GD.on = false; r = await call('cat', 'create', { name: 'Open Calcutta', ev: 'golf', golf: { tour: 'pga', eventId: '401580' }, lots: ['g:401580-1', 'g:401580-2'].map((id) => ({ teams: [{ id, name: id }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 100 }], minBid: 5, inc: 5, take: { kind: 'none' }, order: 'listed', mode: 'live' }); ok(r, 'a chosen tour event');
    assert.deepStrictEqual(r.j.calc.golf, { tour: 'pga', eventId: '401580' }); assert.deepStrictEqual(r.j.calc.lots.map((l) => l.name), ['Scottie S', 'Rory M']); assert.strictEqual(r.j.calc.local, false);
    r = await call('cat', 'create', { name: 'Open Calcutta', ev: 'golf', buyBack: true, lots: ['g:thisweek-1', 'g:thisweek-2'].map((id) => ({ teams: [{ id, name: id }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 100 }], minBid: 5, inc: 5, take: { kind: 'none' }, order: 'listed', mode: 'live' }); assert.strictEqual(r.s, 400, 'pro golfers: no buy-back'); });
  // ===== Events coder (local-v1): one 'events' source serves every local event / pickleball event =====
  await chk('E1 local event: EVENTS entry with plug "events"; teams(calc) gets calc.evtId; account ids and guests are players of record; started()/startTime() that throw = locked, not for good', async () => { at('2026-11-17T18:00:00Z');
    const EVS = { PB1: { start: NOW + 3 * 864e5, on: false, gone: false, pairs: [{ id: 'e1', name: 'Bob / Cat', players: [pe(SID.bob), pe(SID.cat)] }, { id: 'e2', name: 'Dan / Walk-in', players: [pe(SID.dan), { guest: 'w9', name: 'Walk-in Joe' }] }, { id: 'e3', name: 'Eve / Fay', players: [pe(SID.eve), pe(SID.fay)] }] }, PB2: { start: NOW + 864e5, on: false, pairs: [{ id: 'e1', name: 'Other / Pair', players: [] }, { id: 'e2', name: 'Two / More', players: [] }] } }, seen = [];
    const need = (calc) => { const id = String((calc && calc.evtId) || ''); seen.push(id); const e = EVS[id]; if (!e || e.gone) throw new Error('local event not found'); return e; };
    C.registerSource('events', { local: true, teams: async (calc) => need(calc).pairs, results: async (calc) => { need(calc); return {}; }, started: async (calc) => need(calc).on, startTime: async (calc) => need(calc).start, organizer: async () => true });
    r = await call('ann', 'events'); const e = r.j.events.find((x) => x.key === 'local'); assert.ok(e && e.on && e.local && e.needsRef === 'evtId', JSON.stringify(e));
    r = await call('ann', 'teams', { ev: 'local' }); assert.strictEqual(r.s, 400); r = await call('ann', 'teams', { ev: 'local', evtId: 'PB2' }); assert.deepStrictEqual(r.j.teams.map((t) => t.name), ['Other / Pair', 'Two / More']); r = await call('ann', 'teams', { ev: 'local', evtId: 'NOPE' }); assert.strictEqual(r.s, 502, 'an event that cannot be read');
    const mk = (o) => Object.assign({ name: 'Pickleball Calcutta', ev: 'local', evtId: 'PB1', lots: EVS.PB1.pairs.map((t) => ({ teams: [{ id: t.id, name: t.name }] })), rows: [{ k: 'place', r: 1, n: 1, pct: 70 }, { k: 'win', n: 3, pct: 10 }], minBid: 5, inc: 5, buyBack: true, take: { kind: 'none' }, order: 'listed', mode: 'manual' }, o);
    r = await call('eve', 'create', mk({ evtId: undefined })); assert.strictEqual(r.s, 400, 'no event named'); r = await call('eve', 'create', mk()); ok(r); const g = r.j.calc; assert.strictEqual(g.evtId, 'PB1'); assert.strictEqual(row(g.id).evtId, 'PB1'); assert.ok(seen.includes('PB1') && !seen.includes(''), 'every hook got the event id: ' + [...new Set(seen)]);
    for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: g.code })); assert.deepStrictEqual(row(g.id).lots.map((l) => l.por.map((p) => p.k)), [[C.mkOf(pe(SID.bob)), C.mkOf(pe(SID.cat))], [C.mkOf(pe(SID.dan)), 'g:w9'], [C.mkOf(pe(SID.eve)), C.mkOf(pe(SID.fay))]], 'account ids -> member keys, guests -> guest ids');
    r = await call('eve', 'get', { id: g.id }); assert.strictEqual(r.j.calc.kick, EVS.PB1.start, 'lock time from startTime(calc)'); ok(await call('eve', 'enter', { id: g.id, lot: 'L1', pid: await pidOf('eve', g.id), amt: 60 })); ok(await call('bob', 'buyback', { id: g.id, lot: 'L1' }), 'bob buys back half of his own pair');
    tick(6000); EVS.PB1.gone = true; r = await call('eve', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }); assert.deepStrictEqual([r.s, r.j.code], [409, 'feed'], 'the event cannot be read: locked'); assert.ok(!row(g.id).startedAt, 'not for good');
    EVS.PB1.gone = false; tick(6000); ok(await call('eve', 'enter', { id: g.id, lot: 'L2', name: 'Zed', amt: 5 }), 'readable again: open'); tick(6000); EVS.PB1.on = true; frozen(await call('eve', 'enter', { id: g.id, lot: 'L3', name: 'Zed', amt: 5 }), 'the draw was made'); assert.ok(row(g.id).startedAt);
    r = await call('fay', 'create', mk({ evtId: 'PB2', lots: EVS.PB2.pairs.map((t) => ({ teams: [{ id: t.id, name: t.name }] })) })); ok(r, 'a second event from the same source'); NOW = EVS.PB2.start + 1000; frozen(await call('fay', 'enter', { id: r.j.calc.id, lot: 'L1', name: 'Zed', amt: 5 }), 'locked by the clock at its own start time'); });
  console.log(res.join('\n')); console.log(fails.length ? '\nFAILED ' + fails.length + ' of ' + res.length : '\nPASS ' + res.length + ' round 3 checks' + (SHARED ? '' : ' (limits stand-in: odds-api/limits.js not found)')); process.exit(fails.length ? 1 : 0);
});
