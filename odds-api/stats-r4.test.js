// Run: node odds-api/stats-r4.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the fourth independent review of stats-v1 (a07ab04, /tmp/revstats4-report.md) and the manager's rules of Nov 17 2026:
// confirmer age and activity, provisional numbers, one link-confirmed round per date, limits on the COUNTING set, 3 rounds logged a day, the make-up
// per confirmer, one identity per account for ratings, My courses, the confirm sheet line, accounts with no sign-up stamp, and the Low items.
// Every group FAILS on a07ab04 and passes after the fixes:   STATS_DIR=<a checkout of a07ab04>/odds-api node odds-api/stats-r4.test.js
// The reviewer's scenarios are the groups named "SCENARIO ...". Each group runs on its own; a failure is recorded and the rest still run.
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
const PEOPLE = ['ann', 'bob', 'cat', 'dir', 'dan', 'eve', 'fay', 'gus', 'tia', 'tom', 'ted'];
const SID = {}; PEOPLE.forEach((n, i) => { SID[n] = (String.fromCharCode(97 + i) + (i + 1)).slice(0, 2).repeat(4) + String.fromCharCode(97 + i).repeat(56); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', K = (n) => pe(SID[n]);
let NAMES = {}, STAMP = {}, GAMES = {};
const who = (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; };
// The sign-up stamp works like acct.js: since() reads it, sinceSet() sets it once.
const ACCT = { who, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable', ownerOk: (req) => who(req) === 'owner', check: async (req) => !!who(req), since: async (e) => STAMP[e] || null, sinceSet: async (e, at) => STAMP[e] || (STAMP[e] = at) };
D.S = FDB; D.acct = () => ACCT; D.groups = () => ({});
const Z = (s) => Date.parse(s), T0 = Z('2026-11-16T18:00:00Z'), DAY = 864e5; let NOW = T0; D.now = () => NOW; D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const day = (n) => S.chiDay(NOW - n * DAY);
const srv = http.createServer(async (req, res) => { if (await S.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, ipn = 0; const realFetch = global.fetch;
const call = async (w, p, b) => { const r = await realFetch('http://127.0.0.1:' + P + '/stats/' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '', 'x-ip': '9.9.' + (++ipn % 250) + '.' + (ipn >> 8) }, body: JSON.stringify(b || {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = {}; } return { s: r.status, j }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); return r.j; };
const no = (r, code, re, m) => { assert.strictEqual(r.s, code, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); if (re) assert.ok(re.test(r.j.error || ''), (m || '') + ': "' + r.j.error + '" should match ' + re); };
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [5, 11, 17, 1, 13, 7, 15, 3, 9, 6, 12, 18, 2, 14, 8, 16, 4, 10];
const holesFor = (total) => { const st = PARS.slice(); let d = total - 72, i = 0; while (d > 0) { st[i % 18]++; d--; i++; } return st; };
// A round scored hole by hole in an Oddable game; `by` = the reference of the account on another team that confirmed the card (the CONFIRMED-ROUND CONTRACT).
const cardRound = (id, date, score, by, o) => ({ src: 'golf', id, date, sport: 'golf', kind: 'golf-round', title: 'Golf day', result: null, score, toPar: score - 72, verified: true, extra: Object.assign({ course: 'Palm View', rating: 71.2, slope: 128, par: 72, holes: 18, of: 18, format: 'stroke', solo: false, at: Z(date + 'T20:00:00Z'), holeScores: holesFor(score), pars: PARS, hcpIdx: SI, card: by ? { others: 3, by, byName: 'Card Marker' } : undefined }, o || {}) });
// People. old(n): signed up 400 days ago. active(n): also has 3 rounds of their own scored in Oddable games. newbie(n): signed up right now.
const old = (...ns) => ns.forEach((n) => { STAMP[K(n)] = T0 - 400 * DAY; });
const active = (...ns) => ns.forEach((n) => { old(n); GAMES[K(n)] = (GAMES[K(n)] || []).concat([0, 1, 2].map((i) => cardRound('own' + n + i, S.chiDay(T0 - (200 + i) * DAY), 88, 'a:0000000000ff', { rating: null, slope: null }))); });
const newbie = (...ns) => ns.forEach((n) => { STAMP[K(n)] = NOW; });
const fresh = () => { db = {}; NOW = T0; S._reset(); NAMES = {}; STAMP = {}; GAMES = {}; PEOPLE.forEach((n) => { NAMES[SID[n].slice(0, 8)] = n[0].toUpperCase() + n.slice(1) + ' Real'; }); ['calcutta', 'events'].forEach((s) => S.register(s, async () => [])); S.register('golf', async (k) => GAMES[k] || []);
  Object.values(SID).forEach((sid) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1 }; }); };
const golfItem = (date, total, o) => Object.assign({ type: 'golf', date, course: 'Palm View', tees: 'Blue', holes: 18, par: 72, cr: 71.2, slope: 128, total }, o || {});
const pal = async (logger, friend) => { const g = ok(await call(logger, 'guest/create', { name: friend[0].toUpperCase() + friend.slice(1) }), 'add ' + friend).guest; ok(await call(friend, 'guest/claim', { code: g.code }), friend + ' claims'); return g.gid; };
const logRound = async (w, date, total, gids, o) => (NOW += 1000, 0) || ok(await call(w, 'self/save', { item: golfItem(date, total, Object.assign({ withGuests: gids }, o || {})) }), 'log round').record.id;
const confirm = async (logger, id, friend) => { const l = ok(await call(logger, 'confirm/link', { id }), 'link'); return call(friend, 'confirm/do', { code: l.code }); };
// One round on its own day (a new day for every round: one link-confirmed round counts per date, three logged per day), confirmed by `friend` through the link.
const linkDay = async (logger, total, gid, friend, o) => { NOW += DAY; const id = await logRound(logger, day(0), total, [gid], o); ok(await confirm(logger, id, friend), friend + ' confirms'); return id; };
const setGames = (n, list) => { GAMES[K(n)] = (GAMES[K(n)] || []).filter((r) => /^own/.test(r.id)).concat(list); S._reset(); };
const cv = (x) => (x.suggested && x.suggested.confirmed ? x.suggested.value : null); // review 5: the CONFIRMED suggested number (what `use` was before; nothing is used without the organizer now)
const mustHave = (fn) => { assert.strictEqual(typeof S[fn], 'function', 'stats.' + fn + ' is exported'); return S[fn]; };
let pass = 0; const fails = [], OUT = [];
const say = (t) => OUT.push(t);
const check = async (name, fn) => { fresh(); try { await fn(); pass++; console.log('  ok  ' + name); } catch (er) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String((er && er.message) || er).split('\n').slice(0, 8).join('\n       ')); } };

srv.listen(0, async () => {
  P = srv.address().port; let j, h, r;

  await check('H1 / SCENARIO three throwaways. Three accounts made today confirm three made-up rounds: recorded, never counted, no number, and the make-up shows who they are', async () => {
    newbie('ann', 'tia', 'tom', 'ted'); const g = {}; for (const f of ['tia', 'tom', 'ted']) g[f] = await pal('ann', f);
    for (const f of ['tia', 'tom', 'ted']) { const id = await logRound('ann', day(0), 200, [g[f]]); ok(await confirm('ann', id, f), f + ' confirms'); }
    h = await S.handicapFor(K('ann'));
    assert.deepStrictEqual([cv(h), (cv(h) == null), h.confirmedRounds, h.provisional], [null, true, 0, undefined], 'no number and nothing provisional: ' + JSON.stringify([cv(h), h.confirmedRounds, h.provisional]));
    assert.ok(/needs 3 confirmed rounds \(0 so far\)/.test(h.unconfirmedWhy), h.unconfirmedWhy); assert.ok(h.reason && h.unconfirmedWhy, '`reason` says why');
    assert.strictEqual((await S.courseHandicapFor(K('ann'), { slope: 128, cr: 71.2, par: 72 })).courseHandicap, null, 'no 60 strokes');
    j = ok(await call('ann', 'me')); const rs = j.records.filter((x) => x.kind === 'golf-round'); assert.strictEqual(rs.length, 3);
    assert.ok(rs.every((x) => x.extra.confirmed === false && /Recorded, not counted \(confirmer too new: .* joined Oddable less than 30 days before confirming\)/.test(x.extra.confirmWhy)), 'each round says the confirmation is recorded and why it does not count: ' + rs[0].extra.confirmWhy);
    assert.ok(rs.every((x) => x.extra.confirmedBy && x.extra.confirmedBy.name), 'the confirmation itself is kept on the record');
    const mk = h.makeup; assert.strictEqual(mk.who.length, 3); assert.deepStrictEqual(mk.who.map((w) => w.name).sort(), ['Ted Real', 'Tia Real', 'Tom Real']);
    assert.ok(mk.who.every((w) => w.counts === false && w.n === 0 && w.recorded === 1 && w.joined === day(0) && w.flags.includes('joined today') && /too new/.test(w.why)), JSON.stringify(mk.who));
    assert.ok(mk.flags.includes('all rounds on one date') && mk.flags.includes('all logged on one day') && /Check before approving/.test(mk.warn), JSON.stringify(mk.flags));
    assert.ok(!/a:[0-9a-f]{12}|@phone/.test(JSON.stringify(h)) && !/a:[0-9a-f]{12}|@phone/.test(JSON.stringify(j.golfHcp)), 'names, dates and counts only: no reference or account id leaves');
    NOW += 45 * DAY; S._reset(); h = await S.handicapFor(K('ann')); assert.deepStrictEqual([cv(h), h.confirmedRounds, h.provisional], [null, 0, undefined], 'waiting does not help: the confirmer was too new WHEN IT CONFIRMED');
    // the same three, 60 days old, but with no game of their own
    fresh(); old('ann'); ['tia', 'tom', 'ted'].forEach((n) => { STAMP[K(n)] = T0 - 60 * DAY; }); for (const f of ['tia', 'tom', 'ted']) g[f] = await pal('ann', f);
    for (const f of ['tia', 'tom', 'ted']) await linkDay('ann', 200, g[f], f);
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([cv(h), h.confirmedRounds, h.provisional], [null, 0, undefined], 'old enough but never played a scored game: not counted');
    j = ok(await call('ann', 'me')); assert.ok(j.records.some((x) => /fewer than 3 rounds or matches scored in Oddable games/.test(x.extra.confirmWhy || '')), 'and the round says so');
    // the pickleball rating: three throwaways, two wins each
    fresh(); newbie('ann', 'tia', 'tom', 'ted'); for (const f of ['tia', 'tom', 'ted']) g[f] = await pal('ann', f);
    for (const f of ['tia', 'tom', 'ted']) for (let i = 0; i < 2; i++) { NOW += 3600e3; const id = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: day(0), fmt: 'singles', opp: [f], oppGuest: [g[f]], games: [[11, 2]] } })).record.id; ok(await confirm('ann', id, f)); }
    r = await S.ratingFor(K('ann'), 'pickleball'); assert.deepStrictEqual([cv(r), r.seed, (cv(r) == null), r.provisional, r.confirmedGames], [null, 1500, true, undefined, 0], 'no seeding off made-up accounts: ' + JSON.stringify([cv(r), r.seed, r.confirmedGames]));
    say('Three throwaways: use null, nothing provisional, course handicap null. Each round shows "Recorded, not counted (confirmer too new ...)". Make-up lists the three with "joined today", "all rounds on one date", "all logged on one day". Still nothing after 45 days. Rating: use null, seed 1500.');
  });

  await check('H1. a confirmer counts only when its account was 30 days old when it confirmed AND it has 3 rounds or matches of its own scored in Oddable games', async () => {
    active('ann', 'bob', 'cat', 'dir'); const A = K('ann'), ref = (n) => S.acctRef(K(n));
    const eight = (who3) => Array.from({ length: 8 }, (_, i) => cardRound('g' + i, day(60 - i), 90, ref(who3[i % 3])));
    setGames('ann', eight(['bob', 'cat', 'dir'])); h = await S.handicapFor(A);
    assert.deepStrictEqual([h.confirmedRounds, (cv(h) == null), h.makeup.confirmers], [8, false, 3]); assert.ok(cv(h) != null && cv(h) === h.confirmedIndex, 'three established markers, 8 rounds: used');
    assert.ok(h.makeup.who.every((w) => w.counts && w.joined === S.chiDay(T0 - 400 * DAY) && !w.flags.length), 'each confirmer comes with the day they joined and no flag: ' + JSON.stringify(h.makeup.who));
    STAMP[K('dir')] = T0 - 70 * DAY; S._reset(); h = await S.handicapFor(A); // Dir joined 70 days ago: the cards he marked 60 to 53 days ago were marked in his first 30 days
    assert.deepStrictEqual([cv(h), h.makeup.confirmers], [null, 2], 'cards marked inside the marker\'s first 30 days never count'); assert.ok(h.confirmedRounds < 8);
    setGames('ann', Array.from({ length: 8 }, (_, i) => cardRound('g' + i, day(30 - i), 90, ref(['bob', 'cat', 'dir'][i % 3])))); h = await S.handicapFor(A);
    assert.deepStrictEqual([h.confirmedRounds, h.makeup.confirmers, (cv(h) == null)], [8, 3, false], 'the same marker, once his account is 30 days old, counts');
    GAMES[K('cat')] = []; S._reset(); h = await S.handicapFor(A); assert.deepStrictEqual([cv(h), h.makeup.confirmers], [null, 2], 'a marker with no scored game of her own does not count');
    j = ok(await call('ann', 'me')); assert.ok(j.records.some((x) => /confirmer too new: Cat Real has fewer than 3 rounds or matches scored in Oddable games/.test(x.extra.confirmWhy || '')));
    setGames('ann', Array.from({ length: 8 }, (_, i) => cardRound('g' + i, day(30 - i), 90, 'a:000000000000'))); h = await S.handicapFor(A);
    assert.deepStrictEqual([cv(h), h.confirmedRounds], [null, 0], 'a reference with no account behind it cannot be checked and never counts');
    assert.deepStrictEqual([S.CONF.byAgeDays, S.CONF.byActs, S.CONF.fullRounds], [30, 3, 8]);
  });

  await check('H1. (review 5: PROVISIONAL is gone) 3 or more counting rounds from 3 confirmers make the SUGGESTED number confirmed; nothing is played until the organizer approves it; engine-passed `approved` / `typed` are ignored', async () => {
    active('ann', 'bob', 'cat', 'dir'); const A = K('ann'), ref = (n) => S.acctRef(K(n)), rounds = (n) => Array.from({ length: n }, (_, i) => cardRound('g' + i, day(60 - i), 90 + (i % 3), ref(['bob', 'cat', 'dir'][i % 3])));
    for (const n of [3, 5, 8]) { setGames('ann', rounds(n)); h = await S.handicapFor(A);
      assert.deepStrictEqual([h.use, h.needsSet, h.confirmedRounds, h.suggested.confirmed, h.suggested.value, 'provisional' in h], [null, true, n, true, h.confirmedIndex, false], n + ' rounds: suggested (confirmed), not used');
      assert.ok(/organizer approves a number/.test(h.ask), h.ask); assert.strictEqual((await S.courseHandicapFor(A, { slope: 128, cr: 71.2, par: 72 })).courseHandicap, null, 'no strokes until it is approved');
      for (const o of [{ approved: true }, { typed: 20 }]) { const x = await S.handicapFor(A, o); assert.deepStrictEqual([x.use, x.setBy], [null, null], 'an engine flag never plays a number: ' + JSON.stringify(o)); } }
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.golfHcp.moneyIndex, j.golfHcp.suggested.confirmed], [h.confirmedIndex, true], 'My handicap gets the same');
    const pp = await S.pairingProfile(A, 'golf'); assert.strictEqual(pp.pairOn, h.suggested.value, 'pairing (no money) uses the suggested number');
  });

  await check('H1. at most ONE link-confirmed round counts per date played, and at most 3 rounds logged on one day count', async () => {
    active('ann', 'bob', 'cat', 'dir', 'dan'); const g = {}; for (const f of ['bob', 'cat', 'dir', 'dan']) g[f] = await pal('ann', f);
    NOW += DAY; for (const f of ['bob', 'cat', 'dir']) { const id = await logRound('ann', day(0), 95, [g[f]]); ok(await confirm('ann', id, f)); } // three rounds "played" on one date, three different confirmers
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, cv(h), h.provisional], [1, null, undefined], 'one of the three counts');
    j = ok(await call('ann', 'me')); assert.strictEqual(j.records.filter((x) => /only one link-confirmed round counts per day played/.test(x.extra.confirmWhy || '')).length, 2, 'the other two say why');
    // five rounds logged on ONE day for five different dates: the first three logged count
    fresh(); active('ann', 'bob', 'cat', 'dir', 'dan'); for (const f of ['bob', 'cat', 'dir', 'dan']) g[f] = await pal('ann', f);
    NOW += 6 * DAY; const fr = ['bob', 'cat', 'dir', 'dan', 'bob']; for (let i = 0; i < 5; i++) { const id = await logRound('ann', day(5 - i), 95, [g[fr[i]]]); ok(await confirm('ann', id, fr[i])); }
    h = await S.handicapFor(K('ann')); assert.strictEqual(h.confirmedRounds, 3, 'three of the five logged that day count');
    j = ok(await call('ann', 'me')); assert.strictEqual(j.records.filter((x) => /only the first 3 rounds logged on one day count/.test(x.extra.confirmWhy || '')).length, 2); assert.strictEqual(j.confirmRules.perDay, 3);
    assert.ok(h.makeup.flags.includes('all logged on one day'), 'and the make-up says they were all logged on one day: ' + JSON.stringify(h.makeup.flags));
  });

  await check('H3 / SCENARIO one friend. Filler entries never fill the 20-round window: an established player\'s number does not move, a new player gets none', async () => {
    active('ann', 'bob', 'cat', 'dir', 'dan'); const A = K('ann'), ref = (n) => S.acctRef(K(n));
    setGames('ann', Array.from({ length: 20 }, (_, i) => cardRound('h' + i, day(150 - i * 7), 84 + (i % 4), ref(['cat', 'dir', 'dan'][i % 3])))); // 20 honest game rounds, three markers
    const before = await S.handicapFor(A); assert.ok(cv(before) != null && before.confirmedRounds === 20, 'an established number: ' + cv(before));
    const gB = await pal('ann', 'bob'); for (let i = 0; i < 100; i++) await linkDay('ann', 130, gB, 'bob'); // the friend confirms a hundred 130s, one a day (review 4: 9.5 -> 11.2 on a07ab04)
    h = await S.handicapFor(A); const bob = h.makeup.who.find((w) => w.name === 'Bob Real');
    assert.deepStrictEqual([bob.n, bob.recorded, bob.of], [2, 20, 20], 'Bob: 2 of the 20 counting rounds, whatever he sends: ' + JSON.stringify(bob)); assert.ok(bob.flags.includes('confirmed 20 of 20'), 'and the make-up flags it: ' + JSON.stringify(bob.flags));
    assert.strictEqual(h.makeup.rounds.filter((x) => x.how === 'Scored in a game').length, 18, '18 honest game rounds are still in the last 20');
    assert.ok(cv(h) != null && Math.abs(cv(h) - cv(before)) <= 0.5, 'the money-game number moves by no more than his two counting rounds can move it: ' + cv(before) + ' -> ' + cv(h));
    j = ok(await call('ann', 'me')); assert.strictEqual(j.records.filter((x) => /Bob Real already confirmed 2 of your last 20 counting rounds by link/.test(x.extra.confirmWhy || '')).length, 98, 'the other 98 say why');
    // a new player and one friend
    fresh(); active('bob'); old('eve'); const gE = await pal('eve', 'bob'); for (let i = 0; i < 6; i++) await linkDay('eve', 130, gE, 'bob');
    const e = await S.handicapFor(K('eve')); assert.deepStrictEqual([cv(e), (cv(e) == null), e.confirmedRounds, e.provisional, e.makeup.confirmers], [null, true, 2, undefined, 1]);
    say('One friend, new player (6 rounds): 2 count, 1 confirmer, use null, nothing provisional. One friend, established player (20 honest game rounds, then a hundred 130s by link): ' + cv(before) + ' -> ' + cv(h) + ', the friend holds 2 of 20, make-up flags "confirmed 20 of 20".');
  });

  await check('H3. combined limit: one person accounts for at most 8 of any 20 COUNTING rounds, link and game together; typed totals 5; rejected entries take no place', async () => {
    active('ann', 'bob', 'cat', 'dir', 'dan'); const A = K('ann'), ref = (n) => S.acctRef(K(n));
    const honest = Array.from({ length: 12 }, (_, i) => cardRound('h' + i, day(200 - i * 7), 84, ref(['cat', 'dir', 'dan'][i % 3])));
    const bobs = Array.from({ length: 8 }, (_, i) => cardRound('b' + i, day(100 - i * 7), 120, ref('bob')));
    setGames('ann', honest.concat(bobs)); const gB = await pal('ann', 'bob'); for (let i = 0; i < 2; i++) await linkDay('ann', 120, gB, 'bob', { total: undefined, strokes: holesFor(120), pars: PARS });
    h = await S.handicapFor(A); const bob = h.makeup.who.find((w) => w.name === 'Bob Real');
    assert.deepStrictEqual([bob.n, h.confirmedRounds], [8, 20], 'Bob: 8 game + 2 link sent, 8 count (it was 10): ' + JSON.stringify(bob));
    assert.deepStrictEqual([S.CONF.allPerBy, S.CONF.perBy], [8, 2]); j = ok(await call('ann', 'me')); assert.strictEqual(j.confirmRules.allPerBy, 8);
    assert.strictEqual(j.records.filter((x) => /Bob Real already confirmed 8 of your last 20 counting rounds/.test(x.extra.confirmWhy || '')).length, 2, 'the two oldest of his ten say why');
    // 30 cards from ONE marker and nothing else: 8 count and the window does not fill with the other 22
    setGames('ann', Array.from({ length: 30 }, (_, i) => cardRound('m' + i, day(300 - i * 7), 90, ref('bob')))); h = await S.handicapFor(A);
    assert.deepStrictEqual([h.confirmedRounds, cv(h), h.unconfirmedWhy], [8, null, 'needs rounds confirmed by 3 different players']);
    setGames('ann', Array.from({ length: 30 }, (_, i) => cardRound('m' + i, day(300 - i * 7), 90, ref('bob'))).concat(honest.map((x, i) => Object.assign({}, x, { id: 'old' + i, date: day(400 + i) })))); h = await S.handicapFor(A);
    assert.strictEqual(h.makeup.rounds.filter((x) => x.byName !== 'Bob Real').length, 12, 'the 12 older honest rounds are still in the 20 behind his 8: his 22 filler cards pushed none of them out');
    const bobG = h.makeup.rounds.filter((x) => x.byName === 'Bob Real' && x.how === 'Scored in a game').map((x) => x.date), bobL = h.makeup.rounds.filter((x) => x.byName === 'Bob Real' && x.how !== 'Scored in a game').length;
    assert.deepStrictEqual([bobG.length + bobL, bobL, bobG[0], bobG[bobG.length - 1]], [8, 2, day(300 - 29 * 7), day(300 - 24 * 7)], 'and his 8 are his NEWEST 8: the 2 link rounds and the 6 newest cards (nothing freezes on old rounds)');
  });

  await check('H1. the make-up shows, per confirmer: name, when they joined, how many they confirmed, and the flags an organizer should see', async () => {
    active('ann', 'bob', 'cat', 'dir'); const A = K('ann'), ref = (n) => S.acctRef(K(n)); STAMP[K('dir')] = T0 - 33 * DAY;
    setGames('ann', Array.from({ length: 9 }, (_, i) => cardRound('g' + i, day(2), 90, ref(['bob', 'cat', 'dir'][i % 3]), { at: T0 - 2 * DAY + i * 1000 })));
    h = await S.handicapFor(A); const mk = h.makeup;
    assert.deepStrictEqual(mk.who.map((w) => [w.name, w.n, w.recorded, w.of, w.counts]).sort(), [['Bob Real', 3, 3, 9, true], ['Cat Real', 3, 3, 9, true], ['Dir Real', 3, 3, 9, true]]);
    assert.deepStrictEqual(mk.who.find((w) => w.name === 'Dir Real').joined, S.chiDay(T0 - 33 * DAY)); assert.ok(mk.flags.includes('all rounds on one date'), JSON.stringify(mk.flags));
    NOW = T0; newbie('dan'); const gD = await pal('ann', 'dan'); const id = await logRound('ann', day(0), 99, [gD]); ok(await confirm('ann', id, 'dan'));
    h = await S.handicapFor(A); const dan = h.makeup.who.find((w) => w.name === 'Dan Real');
    assert.deepStrictEqual([dan.n, dan.recorded, dan.counts, dan.joined], [0, 1, false, day(0)]); assert.ok(dan.flags.includes('joined today') && /joined Oddable less than 30 days before confirming/.test(dan.why), JSON.stringify(dan));
    assert.ok(/Dan Real: joined today/.test(h.makeup.warn), h.makeup.warn);
    NOW += 3 * DAY; S._reset(); h = await S.handicapFor(A); assert.ok(h.makeup.who.find((w) => w.name === 'Dan Real').flags.includes('joined this week'));
    // the director of a course the player shares with sees the same make-up
    assert.ok(!/a:[0-9a-f]{12}|@phone/.test(JSON.stringify(h.makeup)), 'no reference or account id in the make-up');
  });

  await check('RATINGS. the same guards (confirmer age and activity, provisional under 8), and one person is ONE confirmer whether they confirmed in an event or by link', async () => {
    active('ann', 'bob', 'cat', 'dir'); const A = K('ann'), linkRef = mustHave('linkRef');
    const m = (i, opp, o) => ({ src: 'events', id: 'ev:m' + i, date: day(40 - i), sport: 'pickleball', kind: 'match', title: 'Ladder vs ' + opp, result: 'W', opponent: opp, verified: false, extra: Object.assign({ fmt: 'singles', at: NOW - (40 - i) * DAY, opp: [{ id: 'p' + opp, name: opp, account: true }], confirmed: true, confirmedBy: { name: opp, at: NOW - (40 - i) * DAY }, oppKey: 'e:' + opp + '00000000000' }, o || {}) });
    const set = (list) => { S.register('events', async (k) => (k === A ? list : [])); S._reset(); };
    set([m(0, 'bob'), m(1, 'cat'), m(2, 'dir')]);
    r = await S.ratingFor(A, 'pickleball'); assert.deepStrictEqual([cv(r), r.confirmedGames, r.seed], [null, 0, 1500], 'an event key with no account behind it cannot be checked: nothing seeds');
    for (const n of ['bob', 'cat', 'dir']) assert.strictEqual(await linkRef('e:' + n + '00000000000', K(n)), true);
    assert.strictEqual(await linkRef(S.acctRef(K('bob')), K('cat')), false, 'an account reference cannot be pointed at another account');
    S._reset(); r = await S.ratingFor(A, 'pickleball'); assert.deepStrictEqual([r.use, r.needsSet, r.confirmedGames, r.makeup.confirmers, r.suggested.confirmed], [null, true, 3, 3, true], 'three games by three checked opponents: the confirmed rating is suggested (review 5), not used');
    assert.ok(r.suggested.value > 1500 && r.seed === r.confirmedRating, JSON.stringify([r.suggested, r.seed]));
    const ap = await S.ratingFor(A, 'pickleball', { approved: true }); assert.deepStrictEqual([ap.use, ap.setBy], [null, null], 'an engine flag is ignored: only eventApprove plays it');
    // M2: Bob played Ann in an event AND confirmed a logged match by link: one confirmer, not two
    set([m(0, 'bob'), m(1, 'bob'), m(2, 'cat')]); for (const n of ['bob', 'cat']) await linkRef('e:' + n + '00000000000', K(n));
    const gB = await pal('ann', 'bob'); NOW += DAY; const id = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: day(0), fmt: 'singles', opp: ['Bob'], oppGuest: [gB], games: [[11, 4]] } })).record.id; ok(await confirm('ann', id, 'bob'));
    r = await S.ratingFor(A, 'pickleball'); assert.strictEqual(r.makeup.confirmers, 2, 'Bob (event) + Bob (link) + Cat = 2 confirmers, not 3: ' + JSON.stringify(r.makeup.who)); assert.deepStrictEqual([cv(r), r.suggested.confirmed], [null, false]);
    assert.strictEqual(r.makeup.who.find((w) => w.name === 'Bob Real').n >= 2, true);
    // 8 games by three opponents: the rating seeds
    set(Array.from({ length: 9 }, (_, i) => m(i, ['bob', 'cat', 'dir'][i % 3], { at: NOW - (40 - i) * DAY, confirmedBy: { name: 'x', at: NOW - (40 - i) * DAY } }))); for (const n of ['bob', 'cat', 'dir']) await linkRef('e:' + n + '00000000000', K(n));
    r = await S.ratingFor(A, 'pickleball'); assert.ok(cv(r) != null && cv(r) === r.seed && r.makeup.n >= 8, 'eight or more counting games: ' + JSON.stringify([cv(r), r.makeup.n]));
    GAMES[K('cat')] = []; S._reset(); r = await S.ratingFor(A, 'pickleball'); assert.strictEqual(r.makeup.confirmers, 2, 'an opponent with no scored game of her own is not a confirmer');
  });

  await check('SCENARIO honest regular foursome, markers rotate: (review 5) suggested as confirmed from the 3rd round, all 30 count, no flags; the organizer approves it in one tap', async () => {
    active('ann', 'bob', 'cat', 'dir'); const A = K('ann'), ref = (n) => S.acctRef(K(n)), wk = (n) => Array.from({ length: n }, (_, i) => cardRound('w' + i, day(7 * (n - i)), 84 + ((i * 5) % 9), ref(['bob', 'cat', 'dir'][i % 3])));
    setGames('ann', wk(5)); h = await S.handicapFor(A); assert.deepStrictEqual([h.use, h.suggested.confirmed, h.confirmedRounds], [null, true, 5]); const p5 = cv(h);
    setGames('ann', wk(8)); h = await S.handicapFor(A); assert.ok(cv(h) != null && !(cv(h) == null) && h.confirmedRounds === 8); const u8 = cv(h);
    setGames('ann', wk(30)); h = await S.handicapFor(A); assert.deepStrictEqual([h.confirmedRounds, h.makeup.n, h.makeup.confirmers, h.makeup.flags.length, h.makeup.warn], [30, 20, 3, 0, '']); assert.strictEqual(cv(h), h.oddable.index, 'the money-game number is the full index');
    assert.ok(h.makeup.who.every((w) => w.n >= 6 && w.n <= 7 && w.counts && !w.flags.length), JSON.stringify(h.makeup.who));
    // the same marker every week / two markers
    setGames('ann', Array.from({ length: 30 }, (_, i) => cardRound('s' + i, day(7 * (30 - i)), 88, ref('bob')))); const one = await S.handicapFor(A);
    setGames('ann', Array.from({ length: 30 }, (_, i) => cardRound('s' + i, day(7 * (30 - i)), 88, ref(['bob', 'cat'][i % 2])))); const two = await S.handicapFor(A);
    assert.deepStrictEqual([cv(one), one.provisional, one.unconfirmedWhy, cv(two), two.provisional], [null, undefined, 'needs rounds confirmed by 3 different players', null, undefined]);
    // by link only, 30 weekly rounds, three friends in turn
    fresh(); active('ann', 'bob', 'cat', 'dir'); const g = {}; for (const f of ['bob', 'cat', 'dir']) g[f] = await pal('ann', f);
    for (let i = 0; i < 30; i++) { NOW += 6 * DAY; await linkDay('ann', 84 + ((i * 5) % 9), g[['bob', 'cat', 'dir'][i % 3]], ['bob', 'cat', 'dir'][i % 3]); }
    const lk = await S.handicapFor(K('ann')); assert.deepStrictEqual([lk.confirmedRounds, lk.makeup.confirmers, lk.suggested.confirmed, lk.use], [5, 3, true, null], 'by link only, typed totals: the 5 newest count (5 typed totals of any 20; 6 when scored hole by hole, 2 a friend): confirmed, suggested; review 4 M2 (provisional for ever) is gone');
    assert.strictEqual(lk.makeup.rounds[0].date, day(0), 'the newest round is in it (nothing freezes)');
    say('Honest foursome, hole by hole in games, markers rotate: 5 rounds = suggested ' + p5 + ' (confirmed; the organizer approves), 8 rounds = ' + u8 + ' suggested, 30 rounds = all 30 count, number ' + cv(h) + ' = full index, no flags. Same marker every week or two markers: use null ("needs rounds confirmed by 3 different players"). By link only, 30 weekly typed totals: the newest 5 count (5 typed totals of 20; hole by hole it is 6, 2 per friend), provisional ' + lk.provisional + ' for the organizer to approve every time.');
  });

  await check('SCENARIO a couple who only play together: never a number by link or in games; the organizer sets it and the screen says why', async () => {
    active('ann', 'bob'); const A = K('ann'), gB = await pal('ann', 'bob'); for (let i = 0; i < 10; i++) await linkDay('ann', 92, gB, 'bob');
    const lk = await S.handicapFor(A); assert.deepStrictEqual([cv(lk), (cv(lk) == null), lk.provisional, lk.confirmedRounds, lk.makeup.confirmers], [null, true, undefined, 2, 1]);
    setGames('ann', Array.from({ length: 30 }, (_, i) => cardRound('c' + i, day(7 * (40 - i)), 92, S.acctRef(K('bob'))))); h = await S.handicapFor(A);
    assert.deepStrictEqual([cv(h), (cv(h) == null), h.provisional, h.confirmedRounds, h.unconfirmedWhy], [null, true, undefined, 8, 'needs rounds confirmed by 3 different players']); assert.ok(/UNCONFIRMED: needs rounds confirmed by 3 different players/.test(h.ask), h.ask);
    assert.ok(h.oddable.index != null && (await S.handicapFor(A, { casual: true })).use === h.oddable.index, 'casual play still uses the full index');
    assert.ok(h.makeup.who[0].flags.some((f) => /^confirmed \d+ of \d+$/.test(f)), 'and the make-up flags the one confirmer: ' + JSON.stringify(h.makeup.who[0]));
    say('Couple: by link 2 of 10 count, in games 8 of 30 count, 1 confirmer either way: use null, nothing provisional, "needs rounds confirmed by 3 different players". Casual play uses the full index ' + h.oddable.index + '.');
  });

  await check('SCENARIO a new member with 20 solo rounds: full index for casual play, no money-game number, nothing provisional', async () => {
    newbie('eve'); for (let i = 0; i < 20; i++) { if (i % 3 === 0) NOW += DAY; await logRound('eve', day(0), 88 + (i % 5), []); }
    h = await S.handicapFor(K('eve')); assert.deepStrictEqual([cv(h), (cv(h) == null), h.provisional, h.confirmedRounds], [null, true, undefined, 0]); assert.ok(/needs 3 confirmed rounds \(0 so far\)/.test(h.unconfirmedWhy));
    const c = await S.handicapFor(K('eve'), { casual: true }); assert.ok(c.use != null && c.use === h.oddable.index && h.oddable.rounds === 20);
    say('New member, 20 solo rounds: use null, nothing provisional ("needs 3 confirmed rounds (0 so far)"); casual index ' + c.use + ' from all 20.');
  });

  await check('H2. My courses: recent courses and the home course are kept on the server; a round keeps its courseId and typed yards', async () => {
    old('ann'); const myCourses = mustHave('myCourses');
    j = ok(await call('ann', 'mycourses')); assert.deepStrictEqual([j.home, j.recent], [null, []]);
    j = ok(await call('ann', 'mycourses/use', { course: { id: 'og-123', name: 'Cedar Ridge', city: 'McAllen', state: 'TX', tee: { name: 'Blue', rating: 71.3, slope: 125, par: 72, yards: 6540 } } }));
    assert.deepStrictEqual(j.recent.map((c) => [c.id, c.name, c.city, c.state, c.tees, c.rating, c.slope, c.par, c.yards, c.holes, c.home]), [['og-123', 'Cedar Ridge', 'McAllen', 'TX', 'Blue', 71.3, 125, 72, 6540, 18, false]]);
    NOW += 1000; ok(await call('ann', 'mycourses/use', { course: { id: 'og-9', name: 'No Tee Muni' } })); // a course with no tee data
    j = ok(await call('ann', 'mycourses')); assert.deepStrictEqual(j.recent.map((c) => [c.id, c.rating, c.slope]), [['og-9', null, null], ['og-123', 71.3, 125]], 'newest first; no ratings on file stays null');
    j = ok(await call('ann', 'mycourses/home', { id: 'og-123' })); assert.deepStrictEqual([j.home.id, j.recent[0].id, j.recent[0].home], ['og-123', 'og-123', true], 'the home course comes first');
    no(await call('ann', 'mycourses/home', { id: 'never-used' }), 404, /Use that course once first/); no(await call('ann', 'mycourses/use', { course: { id: '<x>', name: 'Bad' } }), 400, /Pick a course/);
    for (let i = 0; i < 12; i++) { NOW += 1000; ok(await call('ann', 'mycourses/use', { course: { id: 'c' + i, name: 'Course ' + i } })); }
    j = ok(await call('ann', 'mycourses')); assert.deepStrictEqual([j.recent.length, j.recent[0].id, j.recent[1].id], [8, 'og-123', 'c11'], 'at most 8, the home course kept');
    assert.deepStrictEqual((await myCourses(K('ann'))).recent.length, 8, 'the golf engine reads the same store');
    assert.deepStrictEqual(ok(await call('bob', 'mycourses')).recent, [], 'another player sees none of it'); no(await call('', 'mycourses'), 401);
    j = ok(await call('ann', 'me')); assert.strictEqual(j.myCourses.recent.length, 8, '/stats/me carries it for the form');
    j = ok(await call('ann', 'mycourses/remove', { id: 'og-123' })); assert.deepStrictEqual([j.home, j.recent.some((c) => c.id === 'og-123')], [null, false]);
    const rec = ok(await call('ann', 'self/save', { item: { type: 'golf', date: day(0), course: 'No Tee Muni', courseId: 'og-9', holes: 18, total: 91, yards: 6100 } })).record;
    assert.deepStrictEqual([rec.extra.courseId, rec.extra.yards, rec.extra.cr, rec.extra.slope], ['og-9', 6100, null, null], 'no tee data: the round is logged with its course id and typed yards');
    j = ok(await call('ann', 'me')); assert.ok(/Does not count toward your handicap: no Course Rating and Slope/.test(j.records.find((x) => x.id === rec.id).extra.hcpNote), 'and it says it does not count toward the index');
    no(await call('ann', 'self/save', { item: { type: 'golf', date: day(0), course: 'No Tee Muni', holes: 18, total: 91, yards: 50 } }), 400, /Yards/);
  });

  await check('M3 + L2 + L1. the confirm sheet says who will see the confirmer\'s name; someone not on the entry learns nothing; no link 30 days after an entry was logged', async () => {
    active('ann', 'bob', 'cat'); const gB = await pal('ann', 'bob'); NOW += DAY; const id = await logRound('ann', day(0), 97, [gB]), l = ok(await call('ann', 'confirm/link', { id }));
    j = ok(await call('bob', 'confirm/get', { code: l.code })); assert.strictEqual(j.canConfirm, true); assert.ok(/Your name and the date you joined Oddable are shown/.test(j.shown) && /organizers of money games/.test(j.shown) && /course directors/.test(j.shown), String(j.shown));
    j = ok(await call('cat', 'confirm/get', { code: l.code })); assert.deepStrictEqual([j.canConfirm, j.entry, j.loggedBy], [false, null, ''], 'a signed-in stranger with the link sees no name, course, date or score'); assert.ok(!/Ann|Palm View|97/.test(JSON.stringify(j)), JSON.stringify(j));
    no(await call('cat', 'confirm/do', { code: l.code }), 403, /recorded on this entry/); assert.ok(!/Ann/.test((await call('cat', 'confirm/do', { code: l.code })).j.error));
    NOW += 31 * DAY; no(await call('ann', 'confirm/link', { id, fresh: true }), 400, /logged more than 30 days ago/, 'no new link months later');
    j = ok(await call('ann', 'me')); const rec = j.records.find((x) => x.id === id); assert.deepStrictEqual([rec.extra.canLink, /30 days ago/.test(rec.extra.linkWhy)], [false, true]); assert.strictEqual(j.confirmRules.linkOpenDays, 30);
  });

  await check('M4 (replaced in review 5, H1 / H2). An account with no sign-up stamp: before the backfill nothing is stamped on first look and its join date reads "not on file"; after the backfill it is stamped once', async () => {
    active('cat', 'dir'); db[SID.ann].updated = T0 - 40 * DAY;
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.since, j.logFrom, STAMP[K('ann')]], [null, null, undefined], 'no stamp and no backfill: not stamped, not guessed from the sync row');
    const id = await logRound('ann', day(5), 93, []); j = ok(await call('ann', 'me')); assert.strictEqual(!!j.records.find((x) => x.id === id).extra.preAcct, false, 'and nothing is marked as dated before joining');
    db['lock:acctsince:done'] = { id: 'lock:acctsince:done', updated: 1, data: { at: T0 - DAY, n: 0 } }; S._reset();
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.since, STAMP[K('ann')]], [day(0), NOW], 'after the backfill an account still without a stamp is new to Oddable: stamped now, once');
  });

  await check('L6 (measured, not a fix: it also passes on a07ab04). What a throwaway account costs: nothing. Any 10-digit number and a 6-digit PIN, no text-message check, 6 new accounts per address per 15 minutes', async () => {
    const SY = require(B + 'sync'), rows = {}, keep = global.fetch;
    global.fetch = async (u, o) => { const m = /id=eq\.([0-9a-f]+)/.exec(String(u)), meth = (o && o.method) || 'GET'; if (meth === 'POST') { const row = JSON.parse(o.body); (Array.isArray(row) ? row : [row]).forEach((x) => { if (!rows[x.id]) rows[x.id] = x; }); return { ok: true, status: 201, json: async () => [], text: async () => '' }; } return { ok: true, status: 200, json: async () => (m && rows[m[1]] ? [rows[m[1]]] : []), text: async () => '' }; };
    try { let made = 0, err = null; for (let i = 0; i < 8; i++) { try { const v = await SY.verifyLogin('956555' + String(1000 + i), '123456', '7.7.7.7', true); if (v.created) made++; } catch (er) { err = er; break; } }
      assert.strictEqual(made, 6, 'six accounts from one address, each a made-up number'); assert.ok(err && err.status === 429 && /Too many new accounts/.test(err.message), 'the 7th is refused for 15 minutes: ' + (err && err.message));
      const other = await SY.verifyLogin('9565559999', '123456', '8.8.8.8', true); assert.strictEqual(other.created, true, 'another address starts a new count');
    } finally { global.fetch = keep; }
    say('Throwaway sign-up cost: free. No text-message check; 6 new accounts per address per 15 minutes (in memory, per server). So the guards do not lean on sign-up cost: a new account confirms nothing for 30 days and until it has 3 scored games of its own.');
  });

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed' + (fails.length ? ':\n  - ' + fails.join('\n  - ') : ''));
  if (OUT.length) console.log('\nScenario outcomes:\n  - ' + OUT.join('\n  - '));
  srv.close(); process.exit(fails.length ? 1 : 0);
});
