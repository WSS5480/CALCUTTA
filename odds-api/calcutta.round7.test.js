// Run: node odds-api/calcutta.round7.test.js   (round 7: the fixes for review 7 of calcutta-v1 @8b0c40e: H1 "Event finished", H2 objections per subject, H3 who confirms, M1 the exit for an objection, low status names, M2 the switches; every check fails on 8b0c40e: git show 8b0c40e:odds-api/calcutta.js > odds-api/.old.js && CALC=./.old.js node odds-api/calcutta.round7.test.js)
process.env.CALCUTTA_ENABLED = '1'; // ROUND 7 (M2): Calcutta is OFF unless CALCUTTA_ENABLED is exactly "1" (calcutta.round7.test.js checks the switches)
const assert = require('assert'), http = require('http'), C = require(process.env.CALC || './calcutta'), D = C._deps;
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
const PLAYS = []; LIM = Object.assign(Object.create(LIM), { recordPlay: async (accountKey, gameType, gameId, playerKey) => { PLAYS.push([accountKey, gameType, gameId, playerKey]); } }); // ROUND 4: Enterprise billing hook (stand-in with the shared signature until odds-api/limits.js has it)
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
const DAYMS = 864e5;
// ===================== ROUND 4 =====================
const C2 = (x) => Math.round(x * 100), mkA = (w) => C.mkOf(pe(SID[w]));
const grp = (id, comm, members) => { db['lock:grp:' + id] = { id: 'lock:grp:' + id, data: { id, comm: mkA(comm), members: [comm].concat(members || []).map((w) => ({ mk: mkA(w) })) }, updated: 1 }; }; // a stand-in group row (same member key as Groups)
const fresh = (iso) => { Object.keys(db).forEach((k) => { if (k.startsWith('lock:calc') || k.startsWith('lock:grp')) delete db[k]; }); at(iso); }; // every check starts with no Calcuttas (the 20-open-Calcuttas limit is per commissioner)
const CUSTOM4 = (o) => LOCAL(Object.assign({ lots: ['A', 'B', 'C', 'D'].map((n) => ({ teams: [{ name: n }] })), buyBack: false }, o || {}));
// ===================== ROUND 5 =====================
const KO = Z('2027-01-16T21:30:00Z'), OPEN = KO + 4 * H + 24 * H; // a correction for the 901 wild-card game opens at OPEN (kickoff + 4 h + 24 h)
const POROWS = [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13 }, { k: 'champ', n: 1, pct: 35 }];
const PO5 = (o) => SMALL(Object.assign({ mode: 'manual', rows: POROWS }, o || {}));
const corrs = (id) => Object.values(row(id).corr || {}), notes = async (who, id) => (await call(who, 'get', { id })).j.calc;
// an NFL playoff Calcutta (teams 1, 2, 7, 8) whose game `g` (default: wild card 901, team 1 v team 2) is 24 h past its scheduled end with no result
async function late(g, o) { fresh('2027-01-15T18:00:00Z'); const ev = g || EVT(901, 3, 1, KO, 1, 2, 'pre'), wk = ev.week.number; feed = (u) => (new RegExp('seasontype=3&week=' + wk + '&').test(u) ? [ev] : []);
  let r = await call('ann', 'create', PO5(o)); ok(r); const c = r.j.calc; for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c.code })); await real(40);
  ok(await call('ann', 'enter', { id: c.id, lot: 'L1', name: 'Annie', amt: 10 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L2', pid: await pidOf('bob', c.id), amt: 500 }));
  NOW = Date.parse(ev.date) + 4 * H + 24 * H + 60e3; ok(await call('ann', 'board', { id: c.id })); await real(60); return c; }
const wkFeed = (ev) => (u) => (new RegExp('seasontype=3&week=' + ev.week.number + '&').test(u) ? [ev] : []);
D.corrMs = 400; // the correction's own feed read: 6 s in production, short here so a hanging feed does not slow the suite
// ===================== ROUND 6 =====================
const SB = Z('2027-02-14T23:30:00Z');
const pinOf = async (who, id, re) => (await notes(who, id)).notices.find((x) => x.pin && re.test(x.what));
const pins = async (who, id) => (await notes(who, id)).notices.filter((x) => x.pin).length;
const byDay = (games) => (u) => games.filter((g) => u.includes('dates=' + g.date.slice(0, 10).replace(/-/g, '')));
const won = (b, name) => (b.owners.find((o) => o.name === name) || { won: 0 }).won;
// a late Super Bowl (team 1 v team 2): the COMMISSIONER (ann) owns team 1 for $10 with her account, bob owns team 2 for $500, cat owns team 7 for $480, dan is a member with no lot
async function lateSB() { fresh('2027-01-15T18:00:00Z'); feed = wkFeed(EVT(931, 3, 5, SB, 1, 2, 'pre')); let r = await call('ann', 'create', PO5()); ok(r); const c = r.j.calc; for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: c.code })); await real(40);
  ok(await call('ann', 'enter', { id: c.id, lot: 'L1', pid: await pidOf('ann', c.id), amt: 10 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L2', pid: await pidOf('bob', c.id), amt: 500 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L3', pid: await pidOf('cat', c.id), amt: 480 }));
  NOW = SB + 4 * H + 24 * H + 60e3; ok(await call('ann', 'board', { id: c.id })); await real(60); return c; }
// ===================== ROUND 7 =====================
// a late Super Bowl (team 1 v team 2). who1 = how the commissioner holds Team 1 ('acct' = with her account, or a typed name); bob owns Team 2 (the
// losing side) for $500, cat owns Team 7 for $480, dan owns Team 8 for $10 (when dan: true), eve is a member with no lot.
async function sb7(o) { o = o || {}; fresh('2027-01-15T18:00:00Z'); feed = wkFeed(EVT(931, 3, 5, SB, 1, 2, 'pre')); let r = await call('ann', 'create', PO5(o.calc)); ok(r); const c = r.j.calc; for (const w of ['bob', 'cat', 'dan', 'eve']) ok(await call(w, 'join', { code: c.code })); await real(40);
  ok(await call('ann', 'enter', Object.assign({ id: c.id, lot: 'L1', amt: 10 }, o.typed1 ? { name: o.typed1 } : { pid: await pidOf('ann', c.id) })));
  ok(await call('ann', 'enter', Object.assign({ id: c.id, lot: 'L2', amt: 500 }, o.typed2 ? { name: o.typed2 } : { pid: await pidOf('bob', c.id) })));
  ok(await call('ann', 'enter', { id: c.id, lot: 'L3', pid: await pidOf('cat', c.id), amt: 480 })); if (o.dan !== false) ok(await call('ann', 'enter', { id: c.id, lot: 'L4', pid: await pidOf('dan', c.id), amt: 10 }));
  NOW = SB + 4 * H + 24 * H + 60e3; ok(await call('ann', 'board', { id: c.id })); await real(60); return c; }
const sbPost = async (c, team) => ok(await call('ann', 'result', { id: c.id, team: String(team), reason: 'The Super Bowl final is late' }));
const W8 = (who, ms) => tick(ms); // readability
// a Custom table with NO place and NO Champion row (wins + round reached); ann owns L1 with her account, bob L2, cat L3, L4 typed "Dee" (or dan with `dan`)
async function cust(o) { o = o || {}; tick(3601e3); let r = await call('ann', 'create', CUSTOM4({ rows: o.rows || [{ k: 'win', n: 4, pct: 20 }, { k: 'round', r: 1, n: 2, pct: 10 }], unsold: o.unsold || 'roll' })); ok(r); const c = r.j.calc; for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: c.code }));
  ok(await call('ann', 'enter', { id: c.id, lot: 'L1', pid: await pidOf('ann', c.id), amt: 100 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L2', pid: await pidOf('bob', c.id), amt: 60 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L3', pid: await pidOf('cat', c.id), amt: 30 }));
  ok(await call('ann', 'enter', Object.assign({ id: c.id, lot: 'L4', amt: 10 }, o.dan ? { pid: await pidOf('dan', c.id) } : { name: 'Dee' }))); return c; }
const sumC = (a) => a.reduce((s, x) => s + Math.round(x * 100), 0);
srv.listen(0, async () => {
  P = srv.address().port; let r, b;
  // ================= H1: "Event finished" =================
  await chk('H1a "Event finished" is offered ONLY on Custom tables with no place and no Champion row; place / Champion tables end by their results (409 byresults)', async () => { fresh('2026-11-17T18:00:00Z');
    for (const rows of [[{ k: 'place', r: 1, n: 1, pct: 60 }, { k: 'place', r: 2, n: 1, pct: 30 }, { k: 'place', r: 3, n: 1, pct: 10 }], [{ k: 'champ', n: 1, pct: 70 }, { k: 'win', n: 3, pct: 10 }]]) { const c = await cust({ rows });
      ok(await call('ann', 'result', { id: c.id, team: 'x1', [rows[0].k === 'place' ? 'place' : 'wins']: 1, confirm: true })); r = await call('ann', 'get', { id: c.id }); assert.strictEqual(r.j.calc.canFinish, false, 'not offered');
      r = await call('ann', 'finish', { id: c.id }); assert.deepStrictEqual([r.s, r.j.code], [409, 'byresults'], JSON.stringify(rows)); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.over, r.j.calc.fin], [false, null]); }
    const c = await cust(); ok(await call('ann', 'result', { id: c.id, team: 'x1', wins: 1, confirm: true })); r = await call('ann', 'get', { id: c.id }); assert.strictEqual(r.j.calc.canFinish, true, 'wins / rounds only: offered'); });
  await chk('H1b the repro (commissioner wins, then "finishes"): it is only a PROPOSAL; members see what each owner would get; another member who owns a DIFFERENT sold lot confirms; the money nobody won is paid back pro rata to the PRICE paid (carry rule too), never left with the commissioner', async () => { fresh('2026-11-17T18:00:00Z');
    const c = await cust({ unsold: 'carry' }); ok(await call('ann', 'result', { id: c.id, team: 'x1', wins: 1, confirm: true })); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.pool, won(r.j.board, 'AnnBets'), r.j.board.inPlay], [200, 40, 160]);
    ok(await call('ann', 'finish', { id: c.id })); r = await call('bob', 'board', { id: c.id }); b = r.j.board; assert.deepStrictEqual([b.over, b.inPlay, b.fin.state, b.fin.canConfirm, b.fin.canObject, b.fin.leftTo], [false, 160, 'proposed', true, true, 'price'], 'proposed: nothing moves yet');
    assert.deepStrictEqual(b.fin.preview.map((o) => [o.name, o.extra]).sort(), [['AnnBets', 80], ['BobBets', 48], ['CatBets', 24], ['Dee', 8]], 'the preview: $160 back by price (100 / 60 / 30 / 10 of 200)'); assert.ok(await pinOf('cat', c.id, /PROPOSED to mark the event FINISHED.*paid back to the sold lots pro rata to the price paid/));
    for (const [w, code] of [['ann', 'confirm'], ['dan', 'confirm'], ['eve', null]]) { r = await call(w, 'corrok', { id: c.id, ref: 'fin' }); assert.strictEqual(r.s, code ? 403 : 404, w + ' ' + JSON.stringify(r.j)); } // the commissioner, a member with no lot, an outsider
    ok(await call('bob', 'corrok', { id: c.id, ref: 'fin' })); r = await call('cat', 'board', { id: c.id }); b = r.j.board; assert.deepStrictEqual([b.over, b.inPlay, b.carry, b.unclaimed, C2(b.paidOut), b.leftBy, b.endedEarly], [true, 0, 0, 0, 20000, 'price', true]);
    assert.deepStrictEqual(b.owners.map((o) => [o.name, o.won]).sort(), [['AnnBets', 120], ['BobBets', 48], ['CatBets', 24], ['Dee', 8]], 'the commissioner keeps his $40 win + his price share, nothing more'); assert.ok(await pinOf('dan', c.id, /BobBets confirmed: the event is FINISHED/));
    // reopen: the commissioner alone cannot; it is the same proposal + confirm (3 days later)
    tick(3 * DAYMS); ok(await call('ann', 'finish', { id: c.id, off: true })); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.over, r.j.board.fin.state], [true, 'reopen'], 'still finished while the reopen waits');
    ok(await call('cat', 'object', { id: c.id, ref: 'fin' })); r = await call('bob', 'corrok', { id: c.id, ref: 'fin' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed']); ok(await call('cat', 'object', { id: c.id, ref: 'fin', off: true }));
    ok(await call('bob', 'corrok', { id: c.id, ref: 'fin' })); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.over, r.j.board.inPlay, r.j.calc.fin], [false, 160, null], 'reopened only after a member confirmed'); });
  await chk('H1c carry after an early finish only when EVERY lot owner agreed to carry at set-up (before the first result); a typed-name lot can never agree', async () => { fresh('2026-11-17T18:00:00Z');
    let c = await cust({ unsold: 'carry', dan: true }); for (const w of ['bob', 'cat']) ok(await call(w, 'carryok', { id: c.id })); r = await call('eve', 'carryok', { id: c.id }); assert.strictEqual(r.s, 404); r = await call('ann', 'board', { id: c.id }); assert.deepStrictEqual(r.j.board.carryAgree.all, false, 'ann and dan have not agreed');
    ok(await call('ann', 'carryok', { id: c.id })); ok(await call('dan', 'carryok', { id: c.id })); r = await call('ann', 'board', { id: c.id }); assert.strictEqual(r.j.board.carryAgree.all, true);
    ok(await call('ann', 'result', { id: c.id, team: 'x1', wins: 1, confirm: true })); r = await call('dan', 'carryok', { id: c.id, off: true }); assert.deepStrictEqual([r.s, r.j.code], [409, 'frozen'], 'agreed at set-up, before the first result');
    ok(await call('ann', 'finish', { id: c.id })); ok(await call('bob', 'corrok', { id: c.id, ref: 'fin' })); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.over, r.j.board.carry, r.j.board.leftBy], [true, 160, 'carry'], 'everyone agreed: carried');
    c = await cust({ unsold: 'carry' }); for (const w of ['ann', 'bob', 'cat']) ok(await call(w, 'carryok', { id: c.id })); ok(await call('ann', 'result', { id: c.id, team: 'x1', wins: 1, confirm: true })); ok(await call('ann', 'finish', { id: c.id })); ok(await call('bob', 'corrok', { id: c.id, ref: 'fin' }));
    r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.board.over, r.j.board.carry, r.j.board.leftBy], [true, 0, 'price'], '"Dee" (a typed name) never agreed: paid back by price'); });
  await chk('H1d two members who own different lots object to "Event finished": it is withdrawn and cannot be proposed again (the event ends by its results); typed lots + no member with a live lot = nobody can confirm', async () => { fresh('2026-11-17T18:00:00Z');
    let c = await cust(); ok(await call('ann', 'result', { id: c.id, team: 'x1', wins: 1, confirm: true })); ok(await call('ann', 'finish', { id: c.id })); ok(await call('bob', 'object', { id: c.id, ref: 'fin' })); r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.fin.objections, 1);
    ok(await call('cat', 'object', { id: c.id, ref: 'fin' })); r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.j.calc.fin, r.j.board.fin.state, r.j.board.over], [null, 'withdrawn', false]); assert.ok(await pinOf('dan', c.id, /object to the proposal of the commissioner to mark the event finished: it is WITHDRAWN/));
    r = await call('ann', 'finish', { id: c.id }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed']);
    c = await cust(); for (const t of ['x2', 'x3']) ok(await call('ann', 'result', { id: c.id, team: t, out: true, confirm: true })); ok(await call('ann', 'finish', { id: c.id })); // only L1 (ann) and L4 ("Dee") still have a team in it
    for (const w of ['bob', 'cat']) { r = await call(w, 'corrok', { id: c.id, ref: 'fin' }); assert.deepStrictEqual([r.s, r.j.code], [403, 'nobody'], w + ': a typed lot could be the commissioner\'s and no member owns a live lot -> ' + JSON.stringify(r.j)); } });
  // ================= H2: objections survive remove + re-post =================
  await chk('H2 the repro: bob objects to the proposed final; the commissioner removes it, waits and posts it again: the objection STILL stands (confirm 409), every remove / re-post is a pinned notice', async () => { const c = await sb7(); await sbPost(c, 1);
    ok(await call('bob', 'object', { id: c.id, ref: 'e:931' })); r = await call('cat', 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed']);
    ok(await call('ann', 'result', { id: c.id, team: '1', clear: true })); assert.ok(await pinOf('cat', c.id, /Correction removed by the commissioner/)); tick(61e3); await sbPost(c, 1);
    r = await call('cat', 'board', { id: c.id }); const x = r.j.board.corrections[0]; assert.deepStrictEqual([x.pending, x.objections, x.canConfirm, x.posts, r.j.board.over], [true, 1, false, 2, false], JSON.stringify(x));
    r = await call('cat', 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed'], 'the accomplice cannot confirm at once'); assert.ok(await pinOf('dan', c.id, /POSTED AGAIN after it was removed \(2 times so far; the 1 objection to it still stand/));
    // a changed correction for the same game keeps them too
    tick(61e3); await sbPost(c, 2); r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.corrections[0].objections, 1, 'same game, other winner: the objection stays (bob withdraws it himself)'); });
  // ================= H3: who confirms =================
  await chk('H3a the repro: the commissioner holds Team 1 under the typed name "Ann (me)": a member with no lot cannot confirm, nor the owner of an unrelated lot; only the owner of the LOSING lot (bob, Team 2) can', async () => { const c = await sb7({ typed1: 'Ann (me)' }); await sbPost(c, 1);
    for (const w of ['eve', 'cat', 'dan']) { r = await call(w, 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [403, 'confirm'], w + ' -> ' + JSON.stringify(r.j)); }
    r = await call('cat', 'board', { id: c.id }); assert.ok(/typed name/.test(r.j.board.corrections[0].bar), r.j.board.corrections[0].bar); ok(await call('bob', 'corrok', { id: c.id, ref: 'e:931' })); r = await call('cat', 'board', { id: c.id }); assert.strictEqual(r.j.board.over, true); });
  await chk('H3b typed benefiting lot and the losing lot typed too: NOBODY can confirm (code nobody, the feed decides); an organizer (the group\'s commissioner) cannot confirm; a buy-back partner of the benefiting lot cannot confirm', async () => { let c = await sb7({ typed1: 'Ann (me)', typed2: 'Bo' }); await sbPost(c, 1);
    for (const w of ['cat', 'dan', 'eve']) { r = await call(w, 'corrok', { id: c.id, ref: 'e:931' }); assert.strictEqual(r.s, 403, w); if (w !== 'eve') assert.strictEqual(r.j.code, 'nobody', w + ' ' + JSON.stringify(r.j)); } r = await call('cat', 'board', { id: c.id }); assert.strictEqual(r.j.board.corrections[0].nobody, true);
    c = await sb7(); await sbPost(c, 2); db['lock:calc:' + c.id].data.group = { groupId: 'GRP7', contestId: 'K1' }; tick(2000); C.hooks.groupRole = async (g, mk) => (mk === mkA('cat') ? 'comm' : 'member');
    try { r = await call('cat', 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [403, 'confirm'], 'an organizer'); } finally { delete C.hooks.groupRole; }
    ok(await call('dan', 'corrok', { id: c.id, ref: 'e:931' }), 'dan owns a different lot and runs nothing');
    c = await sb7(); ok(await call('ann', 'buyback', { id: c.id, lot: 'L2', pid: await pidOf('cat', c.id) }).then((x) => (x.s === 409 ? { s: 200 } : x))); const s2 = row(c.id).sold.L2; if (!s2.bb) { s2.bb = { pid: await pidOf('cat', c.id), name: '', at: NOW }; db['lock:calc:' + c.id].data.sold.L2 = s2; tick(2000); }
    await sbPost(c, 2); r = await call('cat', 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [403, 'confirm'], 'cat co-owns Team 2 (buy-back): not her'); });
  await chk('H3c a commissioner claim of his own guest: the buyer of the guest\'s lot (a co-owner) and a member with no lot cannot confirm; a member who owns a different lot can', async () => { fresh('2026-11-17T18:00:00Z');
    r = await call('ann', 'create', LOCAL({ lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }], playersOfRecord: [{ guest: true, name: 'Gina' }] }, { teams: [{ name: 'Green' }] }] })); ok(r); const j = r.j, c = j.calc; for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: c.code }));
    ok(await call('ann', 'enter', { id: c.id, lot: 'L2', pid: await pidOf('bob', c.id), amt: 200 })); ok(await call('ann', 'buyback', { id: c.id, lot: 'L2', who: 0 })); ok(await call('ann', 'enter', { id: c.id, lot: 'L3', pid: await pidOf('cat', c.id), amt: 50 }));
    r = await call('ann', 'claim', { token: j.guestLinks[0].token }); assert.strictEqual(r.s, 202); const ref = (await notes('bob', c.id)).claims[0].ref;
    for (const w of ['bob', 'dan']) { r = await call(w, 'claimok', { id: c.id, ref }); assert.deepStrictEqual([r.s, r.j.code], [403, 'confirm'], w); } ok(await call('cat', 'claimok', { id: c.id, ref })); });
  // ================= M1: an objection needs an exit =================
  await chk('M1a one objector alone: the objection LAPSES 7 days after it was made (then a member can confirm); the same member cannot hold it again alone', async () => { const c = await sb7(); await sbPost(c, 2); // the honest final: Team 2 (bob)
    ok(await call('cat', 'object', { id: c.id, ref: 'e:931' })); tick(6 * DAYMS); r = await call('dan', 'corrok', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed'], 'day 6'); r = await call('bob', 'board', { id: c.id }); assert.ok(r.j.board.corrections[0].objLapse > NOW, 'the board says when it lapses');
    tick(DAYMS + 60e3); r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.corrections[0].objections, 0, 'lapsed');
    ok(await call('cat', 'object', { id: c.id, ref: 'e:931', off: true }).then((x) => x).catch(() => ({ s: 200 }))); r = await call('cat', 'object', { id: c.id, ref: 'e:931' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'lapsed'], 'not again alone');
    ok(await call('dan', 'corrok', { id: c.id, ref: 'e:931' })); r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.over, true); });
  await chk('M1b two members with different lots object: the correction is WITHDRAWN at once, cannot be posted again (same game or same effect), the game waits for the feed; 30 days after its scheduled end with no feed result the final counts as OFF: over, no champion, the money nobody won paid back by price', async () => { const c = await sb7(); await sbPost(c, 1);
    ok(await call('bob', 'object', { id: c.id, ref: 'e:931' })); r = await call('eve', 'object', { id: c.id, ref: 'e:931' }); ok(r); r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.corrections.length, 1, 'eve owns no lot: not a second objector');
    ok(await call('cat', 'object', { id: c.id, ref: 'e:931' })); r = await call('dan', 'board', { id: c.id }); b = r.j.board; assert.deepStrictEqual([b.corrections.length, b.held.length, b.held[0].final, b.over], [0, 1, true, false], 'withdrawn'); assert.ok(await pinOf('dan', c.id, /BobBets and EveBets and CatBets|BobBets and CatBets|object to the commissioner correction .*it is WITHDRAWN/));
    tick(61e3); r = await call('ann', 'result', { id: c.id, team: '1', reason: 'The Super Bowl final is late' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed'], 'not again'); r = await call('ann', 'result', { id: c.id, team: '2', reason: 'The Super Bowl final is late' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'disputed'], 'not with the other winner either: the feed decides');
    NOW = SB + 4 * H + 30 * DAYMS - 60e3; r = await call('bob', 'board', { id: c.id }); assert.strictEqual(r.j.board.over, false, 'day 30 minus a minute');
    NOW = SB + 4 * H + 30 * DAYMS + 60e3; r = await call('bob', 'board', { id: c.id }); b = r.j.board; assert.deepStrictEqual([b.over, b.inPlay, b.unclaimed, b.carry, b.leftBy, b.rows.find((x) => x.k === 'champ').paid], [true, 0, 0, 0, 'price', 0], 'off: over with no champion');
    assert.strictEqual(sumC(b.owners.map((o) => o.won)), C2(b.pool)); assert.deepStrictEqual(b.owners.map((o) => [o.name, o.won]).sort(), [['AnnBets', 137.4], ['BobBets', 500], ['CatBets', 355.2], ['DanBets', 7.4]], 'both reached the Super Bowl ($130 each); the $740 nobody won goes back by price (10 / 500 / 480 / 10 of 1,000)');
    const ps = await C.potSummary(c.id); assert.deepStrictEqual([ps.over, ps.inPlay], [true, 0]);
    // the feed reporting in time wins instead
    const d = await sb7(); await sbPost(d, 1); ok(await call('bob', 'object', { id: d.id, ref: 'e:931' })); ok(await call('cat', 'object', { id: d.id, ref: 'e:931' })); feed = wkFeed(EVT(931, 3, 5, SB, 2, 1, 'post')); tick(20e3); await C.watchTick(true); tick(61e3); await C.watchTick(true);
    r = await call('bob', 'board', { id: d.id }); assert.deepStrictEqual([r.j.board.over, r.j.board.held.length, r.j.board.lots[1].teams[0].r.champ], [true, 0, true]); });
  await chk('M1c toggling an objection cannot spam: one pinned notice per member per state per day', async () => { const c = await sb7(); await sbPost(c, 1); ok(await call('dan', 'seen', { id: c.id })); const upin = async () => (await notes('dan', c.id)).pinned, p0 = await upin();
    for (let i = 0; i < 15; i++) { ok(await call('cat', 'object', { id: c.id, ref: 'e:931' })); ok(await call('cat', 'object', { id: c.id, ref: 'e:931', off: true })); } assert.strictEqual(await upin() - p0, 2, 'one "objects" and one "withdrew" pinned today: ' + JSON.stringify((await notes('dan', c.id)).notices.filter((x) => x.pin).map((x) => x.what.slice(0, 50))));
    tick(DAYMS); ok(await call('cat', 'object', { id: c.id, ref: 'e:931' })); assert.strictEqual(await upin() - p0, 3, 'the next day: one more'); });
  // ================= low: scheduled means exactly scheduled =================
  await chk('L1 STATUS_UNSCHEDULED and STATUS_RESCHEDULED games are not correctable; a blank status name on a pre-game is', async () => { const c = await late(); const odd = (name) => { const e = EVT(901, 3, 1, KO, 1, 2, 'pre'); e.status.type.name = name; return e; };
    for (const name of ['STATUS_UNSCHEDULED', 'STATUS_RESCHEDULED']) { feed = wkFeed(odd(name)); tick(61e3); r = await call('ann', 'result', { id: c.id, team: '1', reason: 'Wild card final is late' }); assert.deepStrictEqual([r.s, r.j.code], [409, 'feedonly'], name); }
    feed = wkFeed(odd('')); tick(61e3); ok(await call('ann', 'result', { id: c.id, team: '1', reason: 'Wild card final is late' }), 'blank name'); });
  // ================= M2: the switches =================
  await chk('S1 CALCUTTA_ENABLED: anything but exactly "1" = OFF: /on false, routes 403 off, peek 404, no watcher reads, potSummary null and statsFor [] with no feed read, wireGroups registers nothing', async () => { const c = await sb7();
    for (const v of [undefined, '0', 'true', ' 1']) { if (v === undefined) delete process.env.CALCUTTA_ENABLED; else process.env.CALCUTTA_ENABLED = v; C._reset(); const f0 = feedCalls, g0 = idxGets;
      r = await fetch('http://127.0.0.1:' + P + '/calcutta/on', { headers: { 'x-token': 't-ann' } }); assert.deepStrictEqual(await r.json(), { on: false }, String(v));
      r = await call('ann', 'board', { id: c.id }); assert.deepStrictEqual([r.s, r.j.off], [403, true]); r = await call('ann', 'create', SMALL()); assert.strictEqual(r.s, 403); r = await call(null, 'peek', { code: c.code }); assert.strictEqual(r.s, 404);
      assert.strictEqual(await C.watchTick(true), 0); assert.strictEqual(await C.potSummary(c.id), null); assert.deepStrictEqual(await C.statsFor(pe(SID.ann)), []); let reg = 0; assert.strictEqual(C.wireGroups({ registerGame: () => reg++ }), false); assert.strictEqual(reg, 0);
      assert.deepStrictEqual([feedCalls - f0, idxGets - g0], [0, 0], 'nothing read'); }
    process.env.CALCUTTA_ENABLED = '1'; r = await fetch('http://127.0.0.1:' + P + '/calcutta/on', { headers: { 'x-token': 't-ann' } }); assert.deepStrictEqual(await r.json(), { on: true }); let reg = 0; assert.strictEqual(C.wireGroups({ registerGame: () => reg++ }), true); assert.strictEqual(reg, 1); });
  await chk('S2 CALCUTTA_OWNER_ONLY / CALCUTTA_TESTERS (account keys) and an account whose time has ended, like main\'s Groups switches', async () => { const c = await sb7(); process.env.CALCUTTA_OWNER_ONLY = '1';
    try { r = await call('bob', 'board', { id: c.id }); assert.deepStrictEqual([r.s, r.j.off], [403, true], 'owner only'); r = await fetch('http://127.0.0.1:' + P + '/calcutta/on'); assert.deepStrictEqual(await r.json(), { on: false }, 'signed out');
      process.env.CALCUTTA_TESTERS = 'zz, ' + LIM.keyOf(pe(SID.bob)).toUpperCase() + ' ,'; if (/^[0-9a-f]{24}$/.test(LIM.keyOf(pe(SID.bob)))) { ok(await call('bob', 'board', { id: c.id }), 'a tester'); r = await call('cat', 'board', { id: c.id }); assert.strictEqual(r.s, 403, 'not a tester'); }
    } finally { delete process.env.CALCUTTA_OWNER_ONLY; delete process.env.CALCUTTA_TESTERS; }
    const a0 = D.acct; D.acct = () => Object.assign(a0(), { expired: async (e) => e === pe(SID.cat) }); try { r = await call('cat', 'board', { id: c.id }); assert.deepStrictEqual([r.s, r.j.expired], [403, true]); r = await fetch('http://127.0.0.1:' + P + '/calcutta/on', { headers: { 'x-token': 't-cat' } }); assert.deepStrictEqual(await r.json(), { on: false }); ok(await call('bob', 'board', { id: c.id })); } finally { D.acct = a0; } });
  console.log(res.join('\n')); console.log(fails.length ? 'FAILED ' + fails.length + ' of ' + res.length : 'PASS ' + res.length + ' round 7 checks'); srv.close(); process.exit(fails.length ? 1 : 0);
});
