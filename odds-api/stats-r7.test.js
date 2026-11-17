// Run: node odds-api/stats-r7.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the seventh independent review of stats-v1 (1426e22, /tmp/revstats7-report.md): a SEAT co-signer passes the
// round-confirmer test (M1) and shows his join month; the co-sign route needs a value or clear:true (L1); a dead event says so (L2); approve-all after
// the start is 409 (L3); the backfill refuses a future launch (L4); the mutual-approval record survives the log trim (L5).
// Every group FAILS on 1426e22 and passes after the fixes:   STATS_DIR=<a checkout of 1426e22>/odds-api node odds-api/stats-r7.test.js
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
const EV = (s) => 'golf:' + s + 'r7r7r7r7'; // engines pass prefixed random ids (M5)
const rounds = (n, sc, o) => Array.from({ length: n }, (_, i) => cardRound('r' + i, day(i + 1), sc, ref(['bob', 'cat', 'dir'][i % 3]), o));
const code = async (id, player, value, cosigner) => (await S.cosignToken(id, K(player), value, K(cosigner))).code;

srv.listen(0, async () => {
  P = srv.address().port;

  await check('M1. A seat co-signer must be 30+ days old with 3 finished plays confirmed by another account, or vouched by this event\'s club; a first-look stamp is "now" and fails; the join month shows in `shown` and the log', async () => {
    active('bob', 'cat', 'dir'); old('mo'); setGames('mo', rounds(8, 140));
    const id = EV('m1'); await S.eventSetup(K('mo'), id, { title: 'Nassau', sport: 'golf', money: true, lockAt: NOW + 60 * DAY, players: [{ key: K('mo'), team: 'A' }, { key: K('tia'), team: 'B' }, { key: K('dan'), team: 'B' }] });
    await S.eventAccept(id, K('tia')); await S.eventAccept(id, K('dan'));
    await assert.rejects(S.cosignToken(id, K('mo'), 54, K('tia')), /co-signer too new/, 'the review repro: no stamp, stamped "now" on first look, co-signs the same day');
    assert.ok(stampGet(K('tia')) === NOW, 'she was stamped now (first look after the backfill)');
    stampSet(K('dan'), T0 - 400 * DAY); await assert.rejects(S.cosignToken(id, K('mo'), 54, K('dan')), /co-signer too new/, 'old but no confirmed plays of his own');
    NOW += 31 * DAY; S._reset(); await assert.rejects(S.cosignToken(id, K('mo'), 54, K('tia')), /co-signer too new/, '31 days old, still no plays');
    NOW = T0; S._reset(); active('dan'); S._reset();
    const c = await S.cosignToken(id, K('mo'), 30, K('dan')); assert.strictEqual(c.by, 'Dan Real (joined Oct 2025)');
    await S.eventOverride(K('mo'), id, K('mo'), { hcp: 30, reason: 'x', cosign: c.code });
    h = await S.handicapFor(K('mo'), { eventId: id }); assert.ok(/^30\.0 set by Coach Mo with Dan Real \(joined Oct 2025\) · Oddable/.test(h.shown), h.shown);
    assert.ok((await S.eventLog(K('mo'), id)).log.some((l) => l.cosign === 'Dan Real (joined Oct 2025)'), 'and in the log line');
    // a vouch by THIS event's club lets a brand-new member co-sign; the same vouch does not help in an event of no club
    ent('mo', [{ id: 'palm', name: 'Palm View CC' }]); newbie('gus'); await S.vouch('palm', K('gus'), K('mo'));
    const c2 = EV('club'), c3 = EV('noclub'); for (const [eid, club] of [[c2, 'palm'], [c3, undefined]]) { await S.eventSetup(K('mo'), eid, { title: 'Club day', sport: 'golf', money: true, lockAt: NOW + DAY, clubId: club, players: [{ key: K('mo'), team: 'A' }, { key: K('gus'), team: 'B' }] }); await S.eventAccept(eid, K('gus')); }
    assert.ok((await S.cosignToken(c2, K('mo'), 54, K('gus'))).code, 'vouched by the event\'s club'); await assert.rejects(S.cosignToken(c3, K('mo'), 54, K('gus')), /co-signer too new/);
  });

  await check('L1. /stats/event/cosign needs `value` or an explicit clear:true; a value-less code cannot clear a set number by accident', async () => {
    active('bob', 'cat', 'dir'); old('mo'); const id = EV('l1');
    await S.eventSetup(K('mo'), id, { title: 'g', sport: 'golf', money: true, lockAt: NOW + DAY, players: [{ key: K('mo'), team: 'A' }, { key: K('bob'), team: 'B' }] }); await S.eventAccept(id, K('bob'));
    const pid = ok(await call('bob', 'event/cosign', { eventId: id })).players[0].pid;
    no(await call('bob', 'event/cosign', { eventId: id, pid }), 400, /value/, 'no value: refused'); no(await call('bob', 'event/cosign', { eventId: id, pid, value: 20, clear: true }), 400, /not both/);
    await S.eventOverride(K('mo'), id, K('mo'), { hcp: 20, reason: 'x', cosign: ok(await call('bob', 'event/cosign', { eventId: id, pid, value: 20 })).code });
    const cl = ok(await call('bob', 'event/cosign', { eventId: id, pid, clear: true })); assert.strictEqual(cl.value, null);
    assert.strictEqual((await S.eventOverride(K('mo'), id, K('mo'), { hcp: null, reason: 'use Oddable', cosign: cl.code })).changed, true, 'an explicit clear works');
  });

  await check('L2 + L3. A start that passed with a number missing says "make a new game"; approve-all after the start is 409', async () => {
    active('bob', 'cat', 'dir'); old('mo', 'ann'); setGames('ann', rounds(8, 85)); const id = EV('dead');
    await S.eventSetup(K('mo'), id, { title: 'g', sport: 'golf', money: true, lockAt: NOW + 3600e3, players: [K('ann'), K('gus')] }); await S.eventApproveAll(id, K('mo'));
    NOW += 7200e3; S._reset(); const rv = await S.eventReview(id, K('mo'));
    assert.deepStrictEqual([rv.ready, rv.why], [false, 'start time passed with numbers missing — make a new game']); assert.strictEqual((await S.eventNumbers(id)).why, rv.why);
    await assert.rejects(S.eventApproveAll(id, K('mo')), (er) => er.status === 409, 'L3: 409, not ok with everyone skipped');
  });

  await check('L4 + L5. The backfill refuses a future launch date; who signed whose number is kept apart from the 2,000-line log, so the mutual block survives a trim', async () => {
    const BF = require(B + 'backfill-acctsince');
    await assert.rejects(BF.run({ db: FDB, phoneEmail: pe, sinceKey: skey, now: T0, deploy: T0, launch: T0 + 365 * DAY }), /future/, 'a typo year is refused (dry run too)');
    active('bob', 'cat', 'dir'); old('mo', 'zed', 'gus'); setGames('zed', rounds(8, 90)); setGames('gus', rounds(8, 92)); const id = EV('l5');
    await S.eventSetup(K('mo'), id, { title: 'Big field', sport: 'golf', coOrganizers: [K('zed'), K('gus')], players: [K('zed'), K('gus')] }); await S.eventAccept(id, K('zed')); await S.eventAccept(id, K('gus'));
    await S.eventApprove(id, K('zed'), null, K('gus'));
    db['lock:evr:' + id].data.log = db['lock:evr:' + id].data.log.filter((l) => l.kind !== 'approve'); // 400 players later the line has rolled off the log
    await assert.rejects(S.eventApprove(id, K('gus'), null, K('zed')), /mutual/);
  });

  srv.close();
  console.log(fails.length ? '\n' + pass + ' passed, ' + fails.length + ' failed:\n  - ' + fails.join('\n  - ') : '\n' + pass + ' passed, 0 failed');
  process.exit(fails.length ? 1 : 0);
});
