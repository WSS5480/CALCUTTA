// Run: node odds-api/stats-r5.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the fifth independent review of stats-v1 (250a4b9, /tmp/revstats5-report.md) and the manager's decision of Nov 17 2026
// ("stop the arms race, simplify"): the Oddable number is always shown with its make-up; in ANY money game the number played off is approved or set by
// the organizer / director (checked in stats: who may, never his own number without a co-sign, logged, seen by every player); one tap "Use everyone's
// Oddable index"; club directors vouch for members; the review-4 guards are now INFORMATION for the make-up and the suggested number only.
// Every group FAILS on 250a4b9 and passes after the fixes:   STATS_DIR=<a checkout of 250a4b9>/odds-api node odds-api/stats-r5.test.js
// The scenarios the manager asked for are the groups named "SCENARIO ..."; their outcomes are printed at the end.
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
let h, j, r;

srv.listen(0, async () => {
  P = srv.address().port;

  await check('H1. BACKFILL: an idempotent dry-run-by-default script stamps every existing account from its first bet / first daily-log day (else deploy minus 30 days) and writes the marker; 2-year users then log Saturday on Tuesday, confirm, and nobody "joined today"', async () => {
    const BF = require(B + 'backfill-acctsince'), twoY = T0 - 730 * DAY, oneY = T0 - 365 * DAY;
    db[SID.ann].data = { bets: [{ id: 'b' + (twoY + 5000) }, { id: 'b' + (T0 - DAY) }], log: { [S.chiDay(oneY)]: { w: 1 } } }; // first bet two years ago
    db[SID.bob].data = { bets: [], log: { [S.chiDay(twoY)]: { w: 1 }, '2026-01-01': {} } }; // first daily-log day two years ago, no bets
    db[SID.cat].data = { bets: [{ id: 'b' + (twoY + 9000) }] }; db[SID.dir].data = { bets: [{ id: 'b' + (twoY + 1) }] };
    stampSet(K('zed'), T0 - 3 * DAY); // an account that already has a real sign-up stamp: never moved
    const deploy = T0, launch = T0 - 1000 * DAY, rep = await BF.run({ db: FDB, phoneEmail: pe, sinceKey: skey, now: T0, deploy, launch });
    assert.deepStrictEqual([rep.write, !!db['lock:acctsince:done'], stampGet(K('ann'))], [false, false, null], 'dry run by default: nothing written');
    const w = await BF.run({ db: FDB, phoneEmail: pe, sinceKey: skey, now: T0, deploy, launch, write: true });
    assert.deepStrictEqual([stampGet(K('ann')), S.chiDay(stampGet(K('bob'))), stampGet(K('cat')), stampGet(K('eve')), stampGet(K('zed')), stampGet('owner')], [twoY + 5000, S.chiDay(twoY), twoY + 9000, deploy - 30 * DAY, T0 - 3 * DAY, deploy - 30 * DAY], 'first bet / first log day / deploy minus 30 / an existing stamp kept / the owner account');
    assert.ok(w.marker && db['lock:acctsince:done'].data.at === T0 && w.bet >= 3 && w.log === 1 && w.kept === 1, JSON.stringify(w));
    const snap = JSON.stringify(db['lock:acctsince'].data); await BF.run({ db: FDB, phoneEmail: pe, sinceKey: skey, now: T0 + DAY, deploy: T0 + DAY, launch, write: true });
    assert.strictEqual(JSON.stringify(db['lock:acctsince'].data), snap, 'running it again changes nothing (idempotent)'); assert.strictEqual(db['lock:acctsince:done'].data.runs, 2);
    // a round played Saturday and logged Tuesday by a 2-year user is confirmable; his 2-year friend's confirmation counts; nobody shows "joined today"
    ['bob', 'cat', 'dir'].forEach((n) => { GAMES[K(n)] = [0, 1, 2].map((i) => cardRound('own' + n + i, S.chiDay(T0 - (300 + i) * DAY), 88, 'a:0000000000ff', { rating: null, slope: null })); }); S._reset();
    NOW = Z('2026-11-17T18:00:00Z'); const sat = '2026-11-14', tue = S.chiDay(NOW); assert.strictEqual(new Date(sat + 'T12:00:00Z').getUTCDay(), 6); assert.strictEqual(new Date(tue + 'T12:00:00Z').getUTCDay(), 2);
    const g = {}; for (const f of ['bob', 'cat', 'dir']) g[f] = await pal('ann', f);
    const ids = []; for (const [i, f] of ['bob', 'cat', 'dir'].entries()) { ids.push(await logRound('ann', ['2026-11-12', '2026-11-13', sat][i], 90 + i, [g[f]])); }
    j = ok(await call('ann', 'me')); const satRec = j.records.find((x) => x.id === ids[2]); assert.deepStrictEqual([!!satRec.extra.preAcct, satRec.extra.canLink, j.since], [false, true, S.chiDay(twoY + 5000)], 'Saturday logged on Tuesday: an ordinary, confirmable round; since = two years ago');
    for (const [i, f] of ['bob', 'cat', 'dir'].entries()) ok(await confirm('ann', ids[i], f), f + ' confirms');
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed], [3, true], 'the three 2-year friends count');
    assert.ok(!JSON.stringify(h.makeup).includes('joined today') && !JSON.stringify(h.makeup).includes('joined this week') && h.makeup.who.every((w) => w.joined && w.joined < '2025-01-01'), JSON.stringify(h.makeup.who));
    say('Backfill on a fake table of 2-year users: dry run writes nothing; --write stamps first bet / first log day / deploy-30 (owner too), keeps real stamps, second run changes nothing. Saturday\'s round logged Tuesday is confirmable, three 2-year friends count, nobody shows "joined today".');
  }, true);

  await check('H1. BOOT GUARD: until the backfill marker row exists nobody is stamped "on first look"; the join date reads as not on file; after it, an unstamped account is stamped once', async () => {
    db[SID.ann].updated = T0 - 40 * DAY; j = ok(await call('ann', 'me'));
    assert.deepStrictEqual([stampGet(K('ann')), j.since], [null, null], 'no marker: not stamped, and the screen shows no made-up date');
    active('cat', 'dir'); GAMES[K('ann')] = []; const g = await pal('bob', 'ann'); old('bob'); const id = await logRound('bob', day(0), 90, [g]); ok(await confirm('bob', id, 'ann'));
    h = await S.handicapFor(K('bob')); const a = h.makeup.who.find((w) => w.name === 'Ann Real'); assert.ok(a && a.flags.includes('join date not on file yet') && !a.flags.some((f) => /^joined/.test(f)), 'the organizer is not told a long-time member "joined today": ' + JSON.stringify(a));
    backfilled(); S._reset(); j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.since, stampGet(K('ann'))], [day(0), NOW], 'after the backfill: stamped now, once');
  }, true);

  await check('H2. With a sign-up stamp ONLY the stamp counts: a match logged 29 days before a new account signs up and confirmed by it does not age the account, and the make-up shows the true join date', async () => {
    old('ann'); NOW = T0; const g = ok(await call('ann', 'guest/create', { name: 'Tia' })).guest;
    const id = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: day(0), fmt: 'singles', opp: ['Tia'], oppGuest: [g.gid], games: [[11, 3]] } })).record.id;
    NOW += 29 * DAY; newbie('tia'); ok(await call('tia', 'guest/claim', { code: g.code })); ok(await confirm('ann', id, 'tia'), 'Tia confirms (inside the 30-day link window)');
    j = ok(await call('tia', 'me')); assert.ok(j.records.some((x) => x.extra && x.extra.from), 'Tia has the mirror of the match'); assert.strictEqual(j.since, day(0), 'Tia joined today, whatever the mirror says');
    for (const n of ['tom', 'ted']) newbie(n); const g2 = {}; for (const f of ['tia', 'tom', 'ted']) g2[f] = await pal('dan', f); old('dan');
    for (const f of ['tia', 'tom', 'ted']) { NOW += 1000; const i2 = await logRound('dan', day(0), 200, [g2[f]]); ok(await confirm('dan', i2, f)); }
    h = await S.handicapFor(K('dan')); const t = h.makeup.who.find((w) => w.name === 'Tia Real');
    assert.deepStrictEqual([t.joined, t.counts, t.flags.includes('joined today')], [day(0), false, true], JSON.stringify(t)); assert.strictEqual(h.suggested.confirmed, false); assert.strictEqual(h.use, null);
  });

  await check('H3. A confirmer\'s own play counts only as FINISHED games confirmed by ANOTHER account: one-hole guest-only golf days are not their own play', async () => {
    old('dan'); ['tia', 'tom', 'ted', 'tex'].forEach((n) => { stampSet(K(n), T0 - 40 * DAY); GAMES[K(n)] = [0, 1, 2].map((i) => cardRound('own' + n + i, day(20 + i), 72, null, { holes: 1, of: 18, holeScores: [4], rating: null, slope: null })); });
    setGames('dan', Array.from({ length: 8 }, (_, i) => cardRound('d' + i, day(8 - i), 200, ref(['tia', 'tom', 'ted', 'tex'][i % 4]), { at: T0 - (3 - Math.floor(i / 3)) * DAY + i })));
    h = await S.handicapFor(K('dan')); assert.deepStrictEqual([h.confirmedRounds, h.use], [0, null], 'review 5 repro: on 250a4b9 these count'); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed, h.use], [0, false, null], 'unfinished, unconfirmed "games of their own" do not make a confirmer');
    assert.ok(h.makeup.who.every((w) => w.flags.includes('fewer than 3 rounds or matches of their own scored in games')), JSON.stringify(h.makeup.who));
    assert.ok(S.ownPlay(cardRound('x', day(1), 80, ref('bob')), ref('tia')) && !S.ownPlay(cardRound('x', day(1), 80, ref('tia')), ref('tia')) && !S.ownPlay(cardRound('x', day(1), 80, null), ref('tia')), 'finished + confirmed by another account; never by itself');
  });

  await check('B + C + D. Nothing is played without the organizer: eventSetup registers organizer / co-organizers / players; "Use everyone\'s Oddable index" approves each suggested number in one tap; every approval is logged and every player sees "approved by"', async () => {
    const approve = mustHave('eventApprove'), approveAll = mustHave('eventApproveAll'), review = mustHave('eventReview');
    active('bob', 'cat', 'dir'); old('ann', 'mo', 'eve'); setGames('ann', Array.from({ length: 6 }, (_, i) => cardRound('a' + i, day(30 - i * 3), 86 + i, ref(['bob', 'cat', 'dir'][i % 3]))));
    for (let i = 0; i < 5; i++) await logRound('eve', day(10 + i), 95 + i, []); // Eve: solo rounds only (unconfirmed)
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.use, h.needsSet, h.suggested.confirmed, h.suggested.value], [null, true, true, h.confirmedIndex], 'no event: nothing is used, the confirmed index is SUGGESTED');
    ['oddable', 'confirmedIndex', 'rounds', 'confirmedRounds', 'makeup', 'flags', 'suggested', 'event', 'setBy', 'use'].forEach((k) => assert.ok(k in h, 'handicapFor has ' + k));
    await S.eventSetup(K('mo'), 'golf:SKINS1xx', { title: 'Saturday skins', sport: 'golf', kind: 'game', money: true, lockAt: NOW + DAY, players: [{ key: K('ann'), team: 'A' }, { key: K('eve'), team: 'B' }, { key: 'guest:zzzzzz111111', team: 'B', name: 'Walk-on' }] });
    h = await S.handicapFor(K('ann'), { eventId: 'golf:SKINS1xx' }); assert.deepStrictEqual([h.use, h.needsSet], [null, true], 'registered but not approved: the engine blocks Start');
    let rv = await review('golf:SKINS1xx', K('mo')); assert.deepStrictEqual([rv.ready, rv.unconfirmed], [false, ['Eve Real']], 'the approval screen shows who is unconfirmed before the tap: ' + JSON.stringify(rv.unconfirmed));
    assert.ok(rv.players.find((p) => p.name === 'Eve Real').flags.some((f) => /^unconfirmed: needs 3 confirmed rounds/.test(f)));
    await assert.rejects(approve('golf:SKINS1xx', K('ann'), null, K('bob')), /organizer/, 'a stranger cannot approve'); await assert.rejects(approveAll('golf:SKINS1xx', K('ann')), /organizer/, 'nor can a player');
    const all = await approveAll('golf:SKINS1xx', K('mo')); assert.deepStrictEqual([all.approved.map((x) => x.name).sort(), all.skipped.map((x) => x.name)], [['Ann Real', 'Eve Real'], ['Walk-on']], JSON.stringify(all));
    assert.ok(/no Oddable number yet/.test(all.skipped[0].why)); await S.eventOverride(K('mo'), 'golf:SKINS1xx', 'guest:zzzzzz111111', { hcp: 24, reason: 'Walk-on, no rounds' });
    h = await S.handicapFor(K('ann'), { eventId: 'golf:SKINS1xx' }); assert.deepStrictEqual([h.use, h.setBy, h.by, h.needsSet], [h.suggested.value, 'approved', 'Coach Mo', false]); assert.strictEqual(h.shown, h.suggested.value.toFixed(1) + ' approved by Coach Mo · Oddable ' + h.oddable.index.toFixed(1) + ' (real results)');
    const e = await S.handicapFor(K('eve'), { eventId: 'golf:SKINS1xx' }); assert.deepStrictEqual([e.use, e.suggested.confirmed, e.use === e.oddable.index], [e.oddable.index, false, true], 'Eve plays her full index, approved as UNCONFIRMED');
    rv = await review('golf:SKINS1xx', K('mo')); assert.strictEqual(rv.ready, true, 'every player has a number: Start is allowed');
    assert.strictEqual((await S.courseHandicapFor(K('ann'), { slope: 128, cr: 71.2, par: 72 }, { eventId: 'golf:SKINS1xx' })).courseHandicap != null, true);
    j = ok(await call('eve', 'event/log', { eventId: 'golf:SKINS1xx' })); assert.ok(j.approvals.length === 2 && j.log.some((l) => l.player === 'Ann Real' && l.by === 'Coach Mo' && l.kind === 'approve' && l.oddable != null) && j.log.some((l) => l.player === 'Walk-on' && l.kind === 'set'), 'every player reads every approval and set value: ' + JSON.stringify(j.log));
    assert.ok(j.log.some((l) => /UNCONFIRMED/.test(l.reason) && l.player === 'Eve Real'), 'and that Eve was approved unconfirmed'); assert.strictEqual((await call('gus', 'event/log', { eventId: 'golf:SKINS1xx' })).s, 404, 'someone not in the event: 404');
    assert.ok(!/"pk"|"u"|@phone|a:[0-9a-f]{12}/.test(JSON.stringify(j)) && !/@phone|"u":/.test(JSON.stringify(rv)), 'no keys or account ids leave');
    // a stale screen: the number moved after the organizer looked
    await S.eventSetup(K('mo'), 'golf:SKINS2xx', { title: 'Sunday', sport: 'golf', players: [K('ann')] }); await assert.rejects(approve('golf:SKINS2xx', K('ann'), 3.3, K('mo')), /changed/);
    // casual play: the full index, no approval needed
    assert.strictEqual((await S.handicapFor(K('ann'), { casual: true })).use, h.oddable.index);
    // a co-organizer may approve; an Enterprise director registered on the event may; after the start nothing changes
    old('gus'); await S.eventSetup(K('mo'), 'golf:SKINS3xx', { title: 'Mon', sport: 'golf', coOrganizers: [K('gus')], players: [K('ann')], lockAt: NOW + DAY }); await S.eventAccept('golf:SKINS3xx', K('gus')); assert.strictEqual((await approve('golf:SKINS3xx', K('ann'), null, K('gus'))).by, 'Gus Real (co-organizer added by Coach Mo)');
    NOW += DAY + 1; await assert.rejects(approve('golf:SKINS3xx', K('ann'), null, K('mo')), /locked/);
  });

  await check('D. An organizer can never approve or set his OWN number: it needs a different organizer / director, or a player on another team, and both names are recorded', async () => {
    const approve = mustHave('eventApprove'); old('mo', 'ann', 'cat'); active('bob'); // review 7: a seat co-signer is 30+ days old with 3 confirmed plays
    for (let i = 0; i < 4; i++) await logRound('mo', day(5 + i), 160, []); // Coach Mo logs 160s: a 54.0
    const mo = await S.handicapFor(K('mo')); assert.strictEqual(mo.suggested.value, 54); assert.strictEqual(mo.suggested.confirmed, false);
    await S.eventSetup(K('mo'), 'golf:NASSAUxx', { title: 'Nassau', sport: 'golf', money: true, lockAt: NOW + DAY, players: [{ key: K('mo'), team: 'A' }, { key: K('ann'), team: 'A' }, { key: K('bob'), team: 'B' }] });
    await assert.rejects(approve('golf:NASSAUxx', K('mo'), 54, K('mo')), /cannot approve or set your own number/); await assert.rejects(S.eventOverride(K('mo'), 'golf:NASSAUxx', K('mo'), { hcp: 54, reason: 'me' }), /own number/);
    await assert.rejects(S.eventApproveAll('golf:NASSAUxx', K('mo')).then((x) => { if (x.approved.some((a) => a.name === 'Coach Mo')) throw new Error('approved himself'); throw new Error('ok'); }), /^Error: ok$/);
    await S.eventAccept('golf:NASSAUxx', K('ann')); await S.eventAccept('golf:NASSAUxx', K('bob')); // review 6: seats count once accepted; a co-sign is a code from the co-signer's own phone
    await assert.rejects(S.cosignToken('golf:NASSAUxx', K('mo'), 54, K('ann')), /cannot co-sign/, 'his own teammate cannot co-sign'); await assert.rejects(S.cosignToken('golf:NASSAUxx', K('mo'), 54, K('cat')), /not a player|cannot co-sign/i, 'nor someone outside the event');
    await assert.rejects(approve('golf:NASSAUxx', K('mo'), 54, K('mo'), { cosign: K('bob') }), /co-sign/, 'a bare account id is refused');
    const ok2 = await approve('golf:NASSAUxx', K('mo'), 54, K('mo'), { cosign: (await S.cosignToken('golf:NASSAUxx', K('mo'), 54, K('bob'))).code }); assert.deepStrictEqual([ok2.by, ok2.cosign], ['Coach Mo', 'Bob Real (joined Oct 2025)'], 'a player on the other team co-signs (review 7: with his join month)');
    h = await S.handicapFor(K('mo'), { eventId: 'golf:NASSAUxx' }); assert.ok(/54\.0 approved by Coach Mo with Bob Real \(joined Oct 2025\) · Oddable 54\.0/.test(h.shown), h.shown);
    j = ok(await call('ann', 'event/log', { eventId: 'golf:NASSAUxx' })); assert.ok(j.log.some((l) => l.player === 'Coach Mo' && l.by === 'Coach Mo' && l.cosign === 'Bob Real (joined Oct 2025)'), 'both names in the log every player reads');
    say('Organizer approving his own 54.0: refused alone, refused with his own teammate or an outsider co-signing; allowed only with a player on the other team (or another organizer / director) co-signing; the log every player reads says "54.0 approved by Coach Mo with Bob Real (joined Oct 2025)".');
  });

  await check('C. SEASON: an approval stands until the suggested number moves by 1.0 or more; a one-off game approval stands for that game', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'ann'); const rounds = (n, s) => Array.from({ length: n }, (_, i) => cardRound('a' + i, day(60 - i), s + (i % 2), ref(['bob', 'cat', 'dir'][i % 3])));
    setGames('ann', rounds(8, 85)); await S.eventSetup(K('mo'), 'golf:LEAGUExx', { title: 'Tuesday league', sport: 'golf', kind: 'season', players: [K('ann')] }); await S.eventSetup(K('mo'), 'golf:ONExxxxx', { title: 'One-off', sport: 'golf', players: [K('ann')] });
    await S.eventApproveAll('golf:LEAGUExx', K('mo')); await S.eventApproveAll('golf:ONExxxxx', K('mo')); const v0 = (await S.handicapFor(K('ann'), { eventId: 'golf:LEAGUExx' })).use; assert.ok(v0 != null);
    setGames('ann', rounds(8, 85).concat([cardRound('a8', day(5), 87, ref('bob'))])); h = await S.handicapFor(K('ann'), { eventId: 'golf:LEAGUExx' }); assert.ok(Math.abs(h.suggested.value - v0) < 1 && h.use === v0, 'a small move: the approval stands (' + v0 + ' -> ' + h.suggested.value + ')');
    setGames('ann', rounds(8, 91)); h = await S.handicapFor(K('ann'), { eventId: 'golf:LEAGUExx' });
    assert.ok(h.suggested.value - v0 >= 1 && h.use === null && h.lapsed === true && /Approval lapsed/.test(h.reason), JSON.stringify([v0, h.suggested.value, h.use, h.reason]));
    assert.strictEqual((await S.handicapFor(K('ann'), { eventId: 'golf:ONExxxxx' })).use, v0, 'the one-off game keeps what was approved for it');
  });

  await check('E. VOUCH: a club director vouches for a member; the member shows "vouched by <club>", their confirmations count whatever the account age; logged; revocable; only that club\'s director', async () => {
    const vouch = mustHave('vouch'), unvouch = mustHave('unvouch'); ent('mo', [{ id: 'palm', name: 'Palm View CC' }]); old('mo', 'ann');
    ['bob', 'cat', 'dir'].forEach((n) => { newbie(n); GAMES[K(n)] = [0, 1, 2].map((i) => cardRound('own' + n + i, day(1), 88, 'a:0000000000ff', { rating: null, slope: null })); });
    setGames('ann', Array.from({ length: 6 }, (_, i) => cardRound('v' + i, day(6 - i), 90 + i, ref(['bob', 'cat', 'dir'][i % 3]), { at: NOW - (6 - i) * DAY, courseId: 'palm' }))); // review 6: rounds at the vouching club
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed], [0, false], 'new accounts: not counted');
    await assert.rejects(vouch('palm', K('bob'), K('ann')), /director/, 'not the director'); await assert.rejects(vouch('other', K('bob'), K('mo')), /director/, 'not his club');
    for (const n of ['bob', 'cat', 'dir']) await vouch('palm', K(n), K('mo'));
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed], [6, true], 'vouched: their confirmations count');
    assert.ok(h.makeup.who.every((w) => w.flags.includes('vouched by Palm View CC') && w.counts), JSON.stringify(h.makeup.who)); assert.deepStrictEqual((await S.handicapFor(K('bob'))).vouched, ['Palm View CC']);
    assert.ok((await S.vouchLog(K('mo'), 'palm')).log.length === 3); await unvouch('palm', K('dir'), K('mo'));
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed], [4, false], 'revoked: Dir no longer counts');
  });

  await check('F. Flags kept as information: "confirmers joined within a week of each other"; the 30-day age, 3 finished games of their own, per-confirmer limits and one link round per date still shape the suggested number only', async () => {
    old('dan'); ['tia', 'tom', 'ted', 'tex'].forEach((n, i) => { stampSet(K(n), T0 - (40 + i) * DAY); });
    const rr = []; ['tia', 'tom', 'ted', 'tex'].forEach((n, i) => { const others = ['tia', 'tom', 'ted', 'tex'].filter((x) => x !== n); GAMES[K(n)] = [0, 1, 2].map((k) => cardRound('own' + n + k, day(25 - k), 90, ref(others[k]), { rating: null, slope: null })); });
    setGames('dan', Array.from({ length: 8 }, (_, i) => cardRound('d' + i, day(8 - i), 200, ref(['tia', 'tom', 'ted', 'tex'][i % 4]))));
    h = await S.handicapFor(K('dan'));
    assert.deepStrictEqual([h.suggested.value, h.suggested.confirmed, h.use], [54, true, null], 'four aged throwaways playing each other: the rule is met, so 54.0 is SUGGESTED as confirmed, but nothing is used');
    assert.ok(h.makeup.flags.includes('4 confirmers joined within a week of each other') && /joined within a week/.test(h.makeup.warn), JSON.stringify(h.makeup.flags));
    assert.deepStrictEqual([S.CONF.byAgeDays, S.CONF.byActs, S.CONF.perBy, S.CONF.allPerBy, S.CONF.linkPerDate, S.CONF.joinWeek], [30, 3, 2, 8, 1, 7]);
  });

  // ---------------- the scenarios the manager asked for ----------------
  await check('SCENARIO club of 40, all new to Oddable in month one: the organizer approves the whole field in ONE tap after seeing who is unconfirmed; a director vouch makes the numbers read confirmed', async () => {
    ent('mo', [{ id: 'palm', name: 'Palm View CC' }]); old('mo'); CLUB.forEach((n) => stampSet(K(n), T0));
    const weeks = 4; CLUB.forEach((n, i) => { GAMES[K(n)] = Array.from({ length: weeks }, (_, w) => cardRound('c' + n + 'w' + w, S.chiDay(T0 + (w * 7 + 1) * DAY), 80 + ((i * 7 + w * 3) % 25), ref(CLUB[(i + 4 + w) % 40]), { at: T0 + (w * 7 + 1) * DAY + i * 1000, courseId: 'palm' })); });
    NOW = T0 + 28 * DAY; S._reset();
    await S.eventSetup(K('mo'), 'golf:CLUBDAY5', { title: 'Week 5 club day', sport: 'golf', kind: 'game', money: true, lockAt: NOW + DAY, players: CLUB.map((n, i) => ({ key: K(n), team: 'T' + Math.floor(i / 4) })) });
    let rv = await S.eventReview('golf:CLUBDAY5', K('mo')); const unc = rv.unconfirmed.length, fl = rv.players[0].flags;
    assert.deepStrictEqual([rv.players.length, rv.ready, unc], [40, false, 40], 'month one: all 40 numbers are UNCONFIRMED (every confirmer joined less than 30 days before confirming)');
    assert.ok(fl.some((f) => /^unconfirmed/.test(f)) && rv.players[0].makeup.flags.some((f) => /confirmers joined within a week of each other|joined less than 30 days ago/.test(f)), JSON.stringify(fl));
    const t = await S.eventApproveAll('golf:CLUBDAY5', K('mo')); rv = await S.eventReview('golf:CLUBDAY5', K('mo'));
    assert.deepStrictEqual([t.approved.length, t.skipped.length, rv.ready], [40, 0, true], 'one tap: 40 approved, the game can start');
    for (const n of CLUB) await S.vouch('palm', K(n), K('mo'));
    await S.eventSetup(K('mo'), 'golf:CLUBDAY6', { title: 'Week 6', sport: 'golf', players: CLUB.map((n) => K(n)) }); rv = await S.eventReview('golf:CLUBDAY6', K('mo'));
    const conf = rv.players.filter((p) => p.suggested.confirmed).length; assert.ok(conf === 40, 'vouched by the club: ' + conf + ' of 40 read CONFIRMED');
    say('Club of 40, all new in month one (4 weekly golf days, cards confirmed by another team): the approval screen lists all 40 as UNCONFIRMED (flags: "unconfirmed: ...", confirmers "joined less than 30 days ago", "N confirmers joined within a week of each other"); one tap "Use everyone\'s Oddable index" approves all 40 and the game can start. After the director vouches for the members, ' + conf + ' of 40 read CONFIRMED (vouched by Palm View CC).');
  });

  await check('SCENARIO honest rotating foursome, one friend, couple: what the organizer is offered', async () => {
    active('bob', 'cat', 'dir'); old('ann', 'mo', 'eve', 'fay');
    setGames('ann', Array.from({ length: 12 }, (_, i) => cardRound('w' + i, day(7 * (12 - i)), 84 + ((i * 5) % 9), ref(['bob', 'cat', 'dir'][i % 3])))); const four = await S.handicapFor(K('ann'));
    setGames('eve', Array.from({ length: 12 }, (_, i) => cardRound('f' + i, day(7 * (12 - i)), 95, ref('bob')))); const friend = await S.handicapFor(K('eve'));
    setGames('fay', Array.from({ length: 12 }, (_, i) => cardRound('c' + i, day(7 * (12 - i)), 100, ref(['bob', 'cat'][i % 2])))); const couple = await S.handicapFor(K('fay'));
    assert.deepStrictEqual([four.suggested.confirmed, four.makeup.flags.length, friend.suggested.confirmed, couple.suggested.confirmed], [true, 0, false, false]);
    assert.ok(friend.makeup.who[0].flags.some((f) => /^confirmed \d+ of/.test(f)) && /UNCONFIRMED: needs rounds confirmed by 3 different players/.test(couple.ask));
    await S.eventSetup(K('mo'), 'golf:G1xxxxxx', { title: 'Game', sport: 'golf', players: [K('ann'), K('eve'), K('fay')] }); const t = await S.eventApproveAll('golf:G1xxxxxx', K('mo')); assert.strictEqual(t.approved.length, 3);
    say('Honest rotating foursome (12 weekly game rounds, 3 markers): suggested ' + four.suggested.value + ' CONFIRMED, no flags; one tap. One friend (all cards by Bob): suggested ' + friend.suggested.value + ' UNCONFIRMED, Bob flagged "' + friend.makeup.who[0].flags.join(', ') + '". Couple (two markers): suggested ' + couple.suggested.value + ' UNCONFIRMED ("needs rounds confirmed by 3 different players"). The organizer approves all three in one tap, seeing which are unconfirmed.');
  });

  await check('SCENARIO three and four aged throwaways: what the organizer sees', async () => {
    old('dan', 'mo'); const thr = ['tia', 'tom', 'ted'], four = ['tia', 'tom', 'ted', 'tex']; four.forEach((n) => stampSet(K(n), T0 - 40 * DAY));
    const prep = (crew) => { crew.forEach((n) => { const o = crew.filter((x) => x !== n); GAMES[K(n)] = [0, 1, 2].map((k) => cardRound('own' + n + k, day(25 - k), 90, ref(o[k % o.length]), { rating: null, slope: null })); }); setGames('dan', Array.from({ length: 8 }, (_, i) => cardRound('d' + i, day(8 - i), 200, ref(crew[i % crew.length])))); };
    prep(thr); const h3 = await S.handicapFor(K('dan')); prep(four); const h4 = await S.handicapFor(K('dan'));
    await S.eventSetup(K('mo'), 'golf:BIGxxxxx', { title: 'Big money', sport: 'golf', money: true, players: [K('dan')] }); const rv = await S.eventReview('golf:BIGxxxxx', K('mo'));
    assert.deepStrictEqual([h3.use, h4.use, rv.ready], [null, null, false], 'nothing is played automatically');
    assert.ok(h3.makeup.flags.includes('3 confirmers joined within a week of each other') && h4.makeup.flags.includes('4 confirmers joined within a week of each other'));
    say('Three / four aged throwaways (40 days old, finished games confirming each other, 8 rounds of 200): suggested ' + h4.suggested.value + ' ' + (h4.suggested.confirmed ? 'CONFIRMED' : 'UNCONFIRMED') + ', use null until the organizer acts. His screen warns: "' + h4.makeup.warn + '" (three: "' + h3.makeup.flags.filter((f) => /within a week/.test(f)).join('') + '"). Each confirmer row shows the same join date and their 2 rounds.');
  });

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed' + (fails.length ? ':\n  - ' + fails.join('\n  - ') : ''));
  if (OUT.length) console.log('\nScenario outcomes:\n  - ' + OUT.join('\n  - '));
  srv.close(); process.exit(fails.length ? 1 : 0);
});
