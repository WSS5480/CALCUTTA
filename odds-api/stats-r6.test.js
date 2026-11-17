// Run: node odds-api/stats-r6.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the sixth independent review of stats-v1 (9aeeafa, /tmp/revstats6-report.md): who may co-sign (H1), acceptance and
// no appointee / mutual signing (H2), start time + snapshot at Start + season games (H3), co-sign codes from the co-signer's own phone (H4), the backfill
// launch floor / paging / row filter and the email-account start (M1), approve-all cache (M3), unknown sport (M4), event id format (M5), and the lows.
// Every group FAILS on 9aeeafa and passes after the fixes:   STATS_DIR=<a checkout of 9aeeafa>/odds-api node odds-api/stats-r6.test.js
const assert = require('assert'), http = require('http'), path = require('path'), crypto = require('crypto');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'x';
const B = (process.env.STATS_DIR ? path.resolve(process.env.STATS_DIR) : __dirname) + '/';
const S = require(B + 'stats'), D = S._deps;
if (typeof S._isolate === 'function') S._isolate();
let db = {};
const FDB = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const BASE = ['ann', 'bob', 'cat', 'dir', 'dan', 'eve', 'fay', 'gus', 'tia', 'tom', 'ted', 'tex', 'mo', 'zed'], CLUB = Array.from({ length: 40 }, (_, i) => 'm' + i), PEOPLE = BASE.concat(CLUB);
const SID = {}; PEOPLE.forEach((n) => { SID[n] = crypto.createHash('sha256').update('sid|' + n).digest('hex'); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', K = (n) => pe(SID[n]);
// The sign-up stamp works like acct.js: one row 'lock:acctsince' { t: { sha256('oddable-since|' + account).slice(0, 20): ms } }, set once.
const skey = (e) => crypto.createHash('sha256').update('oddable-since|' + String(e)).digest('hex').slice(0, 20);
const stampGet = (e) => { const r = db['lock:acctsince']; const v = r && r.data && r.data.t && r.data.t[skey(e)]; return Number(v) > 0 ? Number(v) : null; };
const stampSet = (e, at) => { db['lock:acctsince'] = db['lock:acctsince'] || { id: 'lock:acctsince', updated: 1, data: { t: {} } }; const t = db['lock:acctsince'].data.t; if (!(t[skey(e)] > 0)) t[skey(e)] = at; return t[skey(e)]; };
let NAMES = {}, GAMES = {}, ENT = {};
const who = (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; };
const ACCT = { who, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable', ownerOk: (req) => who(req) === 'owner', check: async (req) => !!who(req), since: async (e) => stampGet(e), sinceSet: async (e, at) => stampSet(e, at || NOW) };
D.S = FDB; D.acct = () => ACCT; D.groups = () => ({});
const Z = (s) => Date.parse(s), T0 = Z('2026-11-16T18:00:00Z'), DAY = 864e5; let NOW = T0; D.now = () => NOW; D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const day = (n) => S.chiDay(NOW - n * DAY);
const srv = http.createServer(async (req, res) => { if (await S.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, ipn = 0; const realFetch = global.fetch;
const call = async (w, p, b) => { const r = await realFetch('http://127.0.0.1:' + P + '/stats/' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '', 'x-ip': '9.9.' + (++ipn % 250) + '.' + (ipn >> 8) }, body: JSON.stringify(b || {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = {}; } return { s: r.status, j }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); return r.j; };
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [5, 11, 17, 1, 13, 7, 15, 3, 9, 6, 12, 18, 2, 14, 8, 16, 4, 10];
const holesFor = (total) => { const st = PARS.slice(); let d = total - 72, i = 0; while (d > 0) { st[i % 18]++; d--; i++; } return st; };
// A round scored hole by hole in an Oddable game; `by` = the reference of the account on another team that confirmed the card (the CONFIRMED-ROUND CONTRACT).
const cardRound = (id, date, score, by, o) => ({ src: 'golf', id, date, sport: 'golf', kind: 'golf-round', title: 'Golf day', result: null, score, toPar: score - 72, verified: true, extra: Object.assign({ course: 'Palm View', rating: 71.2, slope: 128, par: 72, holes: 18, of: 18, format: 'stroke', solo: false, at: Z(date + 'T20:00:00Z'), holeScores: holesFor(score), pars: PARS, hcpIdx: SI, card: by ? { others: 3, by, byName: 'Card Marker', at: Z(date + 'T21:00:00Z') } : undefined }, o || {}) });
// People. old(n): signed up 400 days ago. active(n): also has 3 FINISHED games of their own confirmed by another account (rated nowhere, so they add nothing to their own index).
const old = (...ns) => ns.forEach((n) => stampSet(K(n), T0 - 400 * DAY));
const active = (...ns) => ns.forEach((n) => { old(n); GAMES[K(n)] = (GAMES[K(n)] || []).concat([0, 1, 2].map((i) => cardRound('own' + n + i, S.chiDay(T0 - (200 + i) * DAY), 88, 'a:0000000000ff', { rating: null, slope: null }))); });
const newbie = (...ns) => ns.forEach((n) => stampSet(K(n), NOW));
const backfilled = () => { db['lock:acctsince:done'] = { id: 'lock:acctsince:done', updated: 1, data: { at: T0 - DAY, n: 0 } }; };
const ent = (n, courses) => { const k = crypto.createHash('sha256').update('oddable-acct|' + K(n)).digest('hex').slice(0, 24); db['lock:ent'] = db['lock:ent'] || { id: 'lock:ent', updated: 1, data: { acct: {} } }; db['lock:ent'].data.acct[k] = { on: true }; db['lock:entcourses'] = db['lock:entcourses'] || { id: 'lock:entcourses', updated: 1, data: { own: {} } }; db['lock:entcourses'].data.own[k] = courses || []; };
const fresh = (noBackfill) => { db = {}; NOW = T0; S._reset(); NAMES = {}; GAMES = {}; PEOPLE.forEach((n) => { NAMES[SID[n].slice(0, 8)] = n === 'mo' ? 'Coach Mo' : n[0].toUpperCase() + n.slice(1) + ' Real'; }); ['calcutta', 'events'].forEach((s) => S.register(s, async () => [])); S.register('golf', async (k) => GAMES[k] || []);
  Object.values(SID).forEach((sid) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); if (!noBackfill) backfilled(); };
const golfItem = (date, total, o) => Object.assign({ type: 'golf', date, course: 'Palm View', tees: 'Blue', holes: 18, par: 72, cr: 71.2, slope: 128, total }, o || {});
const pal = async (logger, friend) => { const g = ok(await call(logger, 'guest/create', { name: friend[0].toUpperCase() + friend.slice(1) }), 'add ' + friend).guest; ok(await call(friend, 'guest/claim', { code: g.code }), friend + ' claims'); return g.gid; };
const logRound = async (w, date, total, gids, o) => (NOW += 1000, 0) || ok(await call(w, 'self/save', { item: golfItem(date, total, Object.assign({ withGuests: gids }, o || {})) }), 'log round').record.id;
const confirm = async (logger, id, friend) => { const l = ok(await call(logger, 'confirm/link', { id }), 'link'); return call(friend, 'confirm/do', { code: l.code }); };
const setGames = (n, list) => { GAMES[K(n)] = (GAMES[K(n)] || []).filter((r) => /^own/.test(r.id)).concat(list); S._reset(); };
const mustHave = (fn) => { assert.strictEqual(typeof S[fn], 'function', 'stats.' + fn + ' is exported'); return S[fn]; };
const ref = (n) => S.acctRef(K(n));
let pass = 0; const fails = [], OUT = []; const say = (t) => OUT.push(t);
const check = async (name, fn, noBackfill) => { fresh(noBackfill); try { await fn(); pass++; console.log('  ok  ' + name); } catch (er) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String((er && er.stack) || er).split('\n').slice(0, 6).join('\n       ')); } };
const no = (r, st, re, m) => { assert.strictEqual(r.s, st, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); if (re) assert.ok(re.test(r.j.error), (m || '') + ': ' + r.j.error); };
const EV = (s) => 'golf:' + s + 'r6r6r6r6'; // engines pass prefixed random ids (M5)
const rounds = (n, sc, o) => Array.from({ length: n }, (_, i) => cardRound('r' + i, day(i + 1), sc, ref(['bob', 'cat', 'dir'][i % 3]), o));
const code = async (id, player, value, cosigner) => (await S.cosignToken(id, K(player), value, K(cosigner))).code;

srv.listen(0, async () => {
  P = srv.address().port;

  await check('H1. A guest, or an account with no sign-up stamp, can never co-sign the organizer\'s own number', async () => {
    active('bob', 'cat', 'dir'); old('mo'); setGames('mo', rounds(8, 140));
    await S.eventSetup(K('mo'), EV('c1'), { title: 'g', sport: 'golf', money: true, lockAt: NOW + DAY, players: [{ key: K('mo'), team: 'A' }, { key: 'guest:zzzzzz111111', team: 'B', name: 'Walk' }, { key: K('tia'), team: 'B' }] });
    await assert.rejects(S.eventOverride(K('mo'), EV('c1'), K('mo'), { hcp: 30, reason: 'x', cosign: 'guest:zzzzzz111111' }), /co-sign/, 'the review repro: a guest key as co-signer is refused');
    await assert.rejects(S.cosignToken(EV('c1'), K('mo'), 30, 'guest:zzzzzz111111'), /Sign in/, 'a guest cannot even ask for a code');
    await S.eventAccept(EV('c1'), K('tia')); // tia accepted her seat on the other team, but has no sign-up stamp on file
    await assert.rejects(S.cosignToken(EV('c1'), K('mo'), 30, K('tia')), /cannot co-sign/, 'no sign-up stamp: refused');
    active('tia'); S._reset(); assert.ok((await S.cosignToken(EV('c1'), K('mo'), 30, K('tia'))).code, 'once stamped (30+ days, 3 confirmed plays), an accepted player on the other team may');
  }, true);

  await check('H2. A co-organizer counts only after accepting; an appointee never signs the appointer\'s number (or the other way round); no mutual approval; the log says who added and who accepted', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'zed', 'gus', 'ann'); setGames('mo', rounds(8, 140)); setGames('ann', rounds(8, 85)); setGames('zed', rounds(8, 90)); setGames('gus', rounds(8, 92));
    await S.eventSetup(K('mo'), EV('a1'), { title: 'g', sport: 'golf', money: true, lockAt: NOW + DAY, coOrganizers: [K('zed'), K('gus')], players: [{ key: K('mo'), team: 'A' }, { key: K('zed'), team: 'A' }, { key: K('gus'), team: 'B' }, { key: K('ann'), team: 'B' }] });
    const sugMo = (await S.handicapFor(K('mo'))).suggested.value;
    await assert.rejects(S.eventApprove(EV('a1'), K('ann'), null, K('zed')), /Only this event/, '(a) not accepted yet: no role at all');
    j = await S.eventAccept(EV('a1'), K('zed')); assert.deepStrictEqual([j.coOrganizer, j.seat], [true, true]); await S.eventAccept(EV('a1'), K('gus'));
    await assert.rejects(S.eventApprove(EV('a1'), K('mo'), sugMo, K('zed')), /organizer who added them/, '(a) his appointee cannot approve the organizer\'s number');
    await assert.rejects(S.cosignToken(EV('a1'), K('mo'), sugMo, K('gus')), /organizer who added them/, '(b) an appointee on the other team cannot co-sign it either');
    await assert.rejects(S.eventApprove(EV('a1'), K('zed'), null, K('mo')), /You added this co-organizer/, 'nor can the organizer approve his appointee\'s');
    const a = await S.eventApprove(EV('a1'), K('ann'), null, K('zed')); assert.strictEqual(a.by, 'Zed Real (co-organizer added by Coach Mo)');
    // (c) mutual: gus approves zed's number; zed then cannot approve gus's
    await S.eventApprove(EV('a1'), K('zed'), null, K('gus')); await assert.rejects(S.eventApprove(EV('a1'), K('gus'), null, K('zed')), /mutual/, '(c) no mutual approval');
    no(await call('bob', 'event/log', { eventId: EV('a1') }), 404, null, 'bob is not in the event'); j = ok(await call('ann', 'event/log', { eventId: EV('a1') })).log;
    assert.ok(j.some((l) => /co-organizer added by Coach Mo/.test(l.reason)), 'every player reads who added the co-organizers');
    const lg = (await S.eventLog(K('mo'), EV('a1'))).log; assert.ok(lg.some((l) => /co-organizer added by Coach Mo/.test(l.reason) && l.player === 'Zed Real') && lg.some((l) => /accepted by Zed Real/.test(l.reason)) && lg.some((l) => l.kind === 'approve' && l.by === 'Zed Real (co-organizer added by Coach Mo)'), JSON.stringify(lg));
    h = await S.handicapFor(K('ann'), { eventId: EV('a1') }); assert.ok(/approved by Zed Real \(co-organizer added by Coach Mo\)/.test(h.shown), h.shown);
    // a seat moved to another team must be accepted again
    await S.eventSetup(K('mo'), EV('a1'), { players: [{ key: K('ann'), team: 'A' }] }); assert.strictEqual((await S.eventReview(EV('a1'), K('mo'))).players.find((p) => p.name === 'Ann Real').accepted, false);
  });

  await check('H3. Money events need a start: "no start time" until set; eventStart locks and snapshots; after it every approve / set / override is 409; approvals never carry to another id; SEASON lapse mid-week keeps a started game\'s number', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'ann', 'eve'); setGames('ann', rounds(8, 85)); setGames('eve', rounds(8, 95));
    await S.eventSetup(K('mo'), EV('m1'), { title: 'Skins', sport: 'golf', money: true, players: [K('ann'), K('eve')] }); await S.eventApproveAll(EV('m1'), K('mo'));
    let rv = await S.eventReview(EV('m1'), K('mo')); assert.deepStrictEqual([rv.ready, rv.why, rv.needsStart], [false, 'no start time', true], 'approved but no start: not ready');
    let n = await S.eventNumbers(EV('m1')); assert.deepStrictEqual([n.started, n.ready, n.why], [false, false, 'no start time']);
    const st = await S.eventStart(EV('m1'), K('mo')); assert.ok(st.ok && st.numbers.length === 2 && st.numbers.every((x) => x.use != null));
    NOW += 10 * DAY; S._reset();
    await assert.rejects(S.eventOverride(K('mo'), EV('m1'), K('ann'), { hcp: 2, reason: 'after the fact' }), (er) => er.status === 409, 'the review repro: an override 10 days later is 409');
    await assert.rejects(S.eventApprove(EV('m1'), K('ann'), null, K('mo')), (er) => er.status === 409); await assert.rejects(S.eventSetup(K('mo'), EV('m1'), { players: [K('cat')] }), (er) => er.status === 409, 'a started id cannot be reused');
    n = await S.eventNumbers(EV('m1')); assert.deepStrictEqual([n.started, n.numbers.map((x) => x.use)], [true, st.numbers.map((x) => x.use)], 'the snapshot taken at Start');
    await S.eventSetup(K('mo'), EV('m2'), { title: 'Next week', sport: 'golf', money: true, lockAt: NOW + DAY, players: [K('ann')] });
    assert.strictEqual((await S.handicapFor(K('ann'), { eventId: EV('m2') })).use, null, 'approvals belong to one id: a fresh id starts empty');
    await assert.rejects(S.eventStart(EV('m2'), K('mo')), /Not ready/, 'Start is refused until every number is approved');
    // season: the number in force for a game is the one approved when that game started
    NOW = T0; S._reset(); setGames('ann', rounds(8, 85)); await S.eventSetup(K('mo'), EV('s1'), { title: 'Tuesday league', sport: 'golf', kind: 'season', money: true, players: [K('ann')] }); await S.eventApprove(EV('s1'), K('ann'), null, K('mo'));
    assert.strictEqual((await S.eventReview(EV('s1'), K('mo'))).ready, true, 'a season needs no single start time');
    await assert.rejects(S.eventStart(EV('s1'), K('mo')), /gameId/); const w1 = await S.eventStart(EV('s1'), K('mo'), { gameId: 'wk1' }), v0 = w1.numbers[0].use;
    NOW += 2 * DAY; setGames('ann', rounds(8, 91)); // mid-week the number moves 1.0 or more: the approval lapses
    n = await S.eventNumbers(EV('s1'), { gameId: 'wk1' }); assert.deepStrictEqual([n.started, n.numbers[0].use], [true, v0], 'the game that already started keeps its number');
    n = await S.eventNumbers(EV('s1')); assert.deepStrictEqual([n.numbers[0].use, n.numbers[0].lapsed, n.ready], [null, true, false], 'the next game sees the lapse');
    await assert.rejects(S.eventStart(EV('s1'), K('mo'), { gameId: 'wk2' }), /Not ready/, 'next week cannot start until it is approved again');
    await S.eventApprove(EV('s1'), K('ann'), null, K('mo')); const w2 = await S.eventStart(EV('s1'), K('mo'), { gameId: 'wk2' }); assert.ok(w2.numbers[0].use - v0 >= 1, JSON.stringify([v0, w2.numbers[0].use]));
    await assert.rejects(S.eventStart(EV('s1'), K('mo'), { gameId: 'wk2' }), /already started/);
  });

  await check('H4. A co-sign is a 10-minute, single-use code from the co-signer\'s own session, bound to event + player + exact value; a bare account id is refused; /stats/event/cosign and /stats/event/accept work from a phone and leak nothing', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'ann', 'eve'); setGames('mo', rounds(8, 140));
    const id = EV('t1'); await S.eventSetup(K('mo'), id, { title: 'Nassau', sport: 'golf', money: true, lockAt: NOW + DAY, players: [{ key: K('mo'), team: 'A' }, { key: K('ann'), team: 'A' }, { key: K('bob'), team: 'B' }] });
    const sug = (await S.handicapFor(K('mo'))).suggested.value;
    await assert.rejects(S.eventApprove(id, K('mo'), sug, K('mo'), { cosign: K('bob') }), /co-sign code|not an account/, 'a bare account id is refused');
    no(await call('eve', 'event/cosign', { eventId: id }), 404, null, 'someone not in the event: 404'); no(await call('bob', 'event/cosign', { eventId: id }), 404, null, 'a seat not accepted yet: 404');
    ok(await call('bob', 'event/accept', { eventId: id }), 'bob accepts his seat on his own phone'); no(await call('eve', 'event/accept', { eventId: id }), 404, null);
    j = ok(await call('bob', 'event/cosign', { eventId: id })); assert.deepStrictEqual(j.players.map((p) => [p.name, p.suggested]), [['Coach Mo', sug]]);
    assert.ok(!/@phone|"u"|"pk"|guest:|a:[0-9a-f]{12}/.test(JSON.stringify(j)), 'no account ids or keys leave: ' + JSON.stringify(j));
    const pid = j.players[0].pid; no(await call('ann', 'event/cosign', { eventId: id, pid, value: sug }), 404, null, 'ann has not accepted: 404'); await call('ann', 'event/accept', { eventId: id }); no(await call('ann', 'event/cosign', { eventId: id, pid, value: sug }), 403, /cannot co-sign/, 'his teammate: refused');
    const c1 = ok(await call('bob', 'event/cosign', { eventId: id, pid, value: sug })).code; assert.ok(/^cs[a-z0-9]{10}$/.test(c1));
    await assert.rejects(S.eventOverride(K('mo'), id, K('mo'), { hcp: 30, reason: 'x', cosign: c1 }), /different player or number/, 'bound to the exact value');
    await assert.rejects(S.eventApprove(id, K('mo'), sug, K('mo'), { cosign: 'csaaaaaaaaaa' }), /not valid/, 'a guessed code');
    j = await S.eventApprove(id, K('mo'), sug, K('mo'), { cosign: c1 }); assert.deepStrictEqual([j.by, j.cosign], ['Coach Mo', 'Bob Real (joined Oct 2025)']);
    await assert.rejects(S.eventApprove(id, K('mo'), sug, K('mo'), { cosign: c1 }), /not valid|already used/, 'single use');
    const c2 = await code(id, 'mo', 30, 'bob'); NOW += 10 * 60e3 + 1; await assert.rejects(S.eventOverride(K('mo'), id, K('mo'), { hcp: 30, reason: 'x', cosign: c2 }), /not valid/, 'older than 10 minutes');
    const c3 = await code(id, 'mo', 30, 'bob'); assert.strictEqual((await S.eventOverride(K('mo'), id, K('mo'), { hcp: 30, reason: 'x', cosign: c3 })).changed, true, 'a set value with its own code');
    assert.ok(!JSON.stringify(db['lock:evr:' + id].data.tok || {}).includes(c3), 'codes are stored hashed');
  });

  await check('M1. Backfill: no start before the launch (bet ids / log days clamped), every account paged past 5,000, price-log rows skipped and used as the floor; an email account gets its My Apps start, never "joined today"', async () => {
    const BF = require(B + 'backfill-acctsince'), launch = Z('2025-09-01T06:00:00Z');
    db[SID.ann].data = { bets: [{ id: 'b1450000000000' }] }; db[SID.bob].data = { log: { '2016-01-01': {} } }; db['plog:2025-10-01-12'] = { id: 'plog:2025-10-01-12', updated: 1, data: { snaps: [] } };
    const many = Array.from({ length: 5200 }, (_, i) => crypto.createHash('sha256').update('many|' + i).digest('hex')); many.forEach((sid) => { db[sid] = { id: sid, updated: 1, data: { bets: [] } }; });
    const PAGED = Object.assign({}, FDB, { dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')).sort().slice(0, 5000), dbIdsPage: async (off, lim) => Object.keys(db).sort().slice(off, off + lim) });
    await assert.rejects(BF.run({ db: Object.assign({}, PAGED, { dbIdsPage: async (off, lim) => Object.keys(db).filter((k) => !k.startsWith('plog:')).sort().slice(off, off + lim) }), phoneEmail: pe, sinceKey: skey, now: T0, deploy: T0, write: true }), /launch date unknown/, 'no launch and no price log: --write refused');
    let rp = await BF.run({ db: PAGED, phoneEmail: pe, sinceKey: skey, now: T0, deploy: T0 }); assert.strictEqual(rp.launch, Z('2025-10-01T12:00:00Z'), 'the floor is the earliest server-stamped row (price log)');
    rp = await BF.run({ db: PAGED, phoneEmail: pe, sinceKey: skey, now: T0, deploy: T0, launch, write: true });
    assert.deepStrictEqual([stampGet(K('ann')), stampGet(K('bob'))], [launch, launch], 'a 2015 bet id and a 2016 log day are clamped to the launch');
    assert.ok(stampGet(pe(many[5199])) > 0 && stampGet(pe(many[0])) > 0, 'every account, past 5,000'); assert.ok(rp.skipped >= 1 && !stampGet(pe('plog:2025-10-01-12')), 'the price-log row is not an account');
    assert.strictEqual(db['lock:acctsince:done'].data.launch, launch, 'the floor is kept in the marker row');
    // email accounts made on My Apps before the deploy (no stamp): the My Apps creation time; with no createdAt on file: "not on file", never "joined today"
    S._reset(); let si = await S.sinceOf('pat@example.com', NOW); assert.strictEqual(si.known, false, 'no createdAt supplied: not on file (was: stamped today)');
    ACCT.createdAt = async (e) => (e === 'pat@example.com' ? Z('2026-03-01T00:00:00Z') : null); si = await S.sinceOf('pat@example.com', NOW); delete ACCT.createdAt;
    assert.deepStrictEqual([si.known, si.t], [true, Z('2026-03-01T00:00:00Z')]);
  }, true);

  await check('M3 + M4 + M5. Approve-all recomputes each player once (cache cleared once at the end); an unknown sport is refused; unprefixed event ids are refused and an id cannot be taken over', async () => {
    old('mo'); CLUB.forEach((n, i) => { old(n); GAMES[K(n)] = [3, 4, 5].map((d) => cardRound('c' + i + 'd' + d, day(d), 85 + (i % 9), ref(CLUB[(i + d) % 40]))); }); S._reset();
    let calls = 0; S.register('golf', async (k) => { calls++; return GAMES[k] || []; });
    await S.eventSetup(K('mo'), EV('big'), { title: 'Club day', sport: 'golf', players: CLUB.map((n) => K(n)) }); S._reset(); calls = 0;
    const t = await S.eventApproveAll(EV('big'), K('mo')); assert.strictEqual(t.approved.length, 40); assert.ok(calls <= 45, 'one provider read per player, not two (was 80 for 40 players): ' + calls);
    await assert.rejects(S.eventSetup(K('mo'), EV('sp'), { title: 'x', sport: '!!!' }), /Unknown sport/, 'M4'); assert.strictEqual(db['lock:evr:' + EV('sp')], undefined);
    await S.eventSetup(K('mo'), EV('cornhole'), { title: 'x', sport: 'Cornhole' }); assert.strictEqual((await S.eventReview(EV('cornhole'), K('mo'))).sport, 'other:cornhole', 'a named game is fine');
    await assert.rejects(S.eventSetup(K('mo'), 'golf-123', { title: 'x' }), /Bad event id/, 'M5: unprefixed'); await assert.rejects(S.eventSetup(K('mo'), 'golf:ab', { title: 'x' }), /Bad event id/, 'too short to be random');
    await assert.rejects(S.eventApprove('LEGACY1', K('ann'), null, K('mo')), /Bad event id/);
    await S.eventSetup(K('dan'), EV('taken'), { title: 'fake', players: [K('ann')] }); await assert.rejects(S.eventSetup(K('mo'), EV('taken'), { title: 'real' }), /Not your event/, 'another organizer cannot re-register an id');
  });

  await check('LOW. Remove a dropped player (logged) so ready can be true; approving a non-player is refused; vouches count only in that club\'s games, logged by club id; the club\'s Enterprise owner vouches over /stats/vouch', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'ann', 'eve'); setGames('ann', rounds(8, 85));
    await S.eventSetup(K('mo'), EV('d1'), { title: 'Game', sport: 'golf', players: [K('ann'), K('gus')] }); await S.eventApproveAll(EV('d1'), K('mo'));
    assert.strictEqual((await S.eventReview(EV('d1'), K('mo'))).ready, false, 'gus has no number');
    await assert.rejects(S.eventRemove(EV('d1'), K('ann'), K('gus'), 'x'), /Only this event/); await S.eventRemove(EV('d1'), K('mo'), K('gus'), 'Dropped out');
    assert.strictEqual((await S.eventReview(EV('d1'), K('mo'))).ready, true, 'removed: ready'); assert.ok((await S.eventLog(K('mo'), EV('d1'))).log.some((l) => l.kind === 'remove' && /removed by Coach Mo: Dropped out/.test(l.reason)));
    await assert.rejects(S.eventApprove(EV('d1'), K('eve'), null, K('mo')), /Not a player/, 'approving someone not registered is refused');
    assert.strictEqual((await call('eve', 'event/log', { eventId: EV('d1') })).s, 404, 'and they cannot read the log');
    // vouch scope: rounds at Palm View (courseId palm) count with the vouch; the same confirmers elsewhere do not
    ent('mo', [{ id: 'palm', name: 'Palm View CC' }]); ['tia', 'tom', 'ted'].forEach((n) => { newbie(n); GAMES[K(n)] = [0, 1, 2].map((i) => cardRound('own' + n + i, day(1), 88, 'a:0000000000ff', { rating: null, slope: null })); });
    setGames('eve', Array.from({ length: 6 }, (_, i) => cardRound('v' + i, day(6 - i), 90 + i, ref(['tia', 'tom', 'ted'][i % 3]), { at: NOW - (6 - i) * DAY, courseId: i < 3 ? 'palm' : 'cedar' })));
    for (const n of ['tia', 'tom', 'ted']) await S.consentOnJoin(K(n), 'palm', { kind: 'event', id: 'L1', title: 'League' }, true, 'x');
    const pl = ok(await call('mo', 'course/players', { courseId: 'palm' })).players; assert.strictEqual(pl.length, 3);
    no(await call('ann', 'vouch', { courseId: 'palm', pid: pl[0].pid }), 403, /director/, 'not the club owner');
    for (const p of pl) ok(await call('mo', 'vouch', { courseId: 'palm', pid: p.pid, on: true }), 'the owner vouches over the route');
    h = await S.handicapFor(K('eve')); assert.strictEqual(h.confirmedRounds, 3, 'only the 3 Palm View rounds count with the vouch'); assert.deepStrictEqual((await S.handicapFor(K('tia'))).vouched, ['Palm View CC'], 'shown elsewhere as information');
    db['lock:entcourses'].data.own[Object.keys(db['lock:entcourses'].data.own)[0]] = [{ id: 'palm', name: 'Palm View Golf Club' }]; S._reset(); await S.unvouch('palm', K('ted'), K('mo'));
    j = ok(await call('mo', 'vouch/log', { courseId: 'palm' })); assert.strictEqual(j.log.length, 4, 'the log is kept by club id through a rename: ' + JSON.stringify(j.log));
  });

  srv.close();
  console.log(fails.length ? '\n' + pass + ' passed, ' + fails.length + ' failed:\n  - ' + fails.join('\n  - ') : '\n' + pass + ' passed, 0 failed');
  process.exit(fails.length ? 1 : 0);
});
