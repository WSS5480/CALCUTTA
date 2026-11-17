// Golf x WHAT WAS BROUGHT FROM STATS (golf on main, Nov 17 2026). RE-BASELINED: on golf-v1 this file ran golf against the WHOLE stats module (stats-v1
// 54e0b93: handicaps, confirmed rounds, the approval contract). Main gets only the minimum golf needs from stats, so this file now checks exactly that:
//   odds-api/ratings.js        (stats 54e0b93, unchanged): the WHS maths golf-score.js uses; it THROWS on a missing handicap, so golf must never pass one
//   odds-api/signup-since.js   (stats 54e0b93 acct.js since/sinceSet + stats.js backfilled/sinceOf + sinceBackfilled): the server sign-up date
//   odds-api/backfill-acctsince.js (stats 54e0b93, CLI block adapted): the one-time fill-in of accounts older than the stamp
// and golf's use of them: the money switch, the ONE signer bar (SIGNER_MIN_DAYS = 1, owner GOLF-AGE), and the "Golf alone" handicap path (no stats.js).
// No network, no database (one in-memory store shared by golf and signup-since). Run: node odds-api/golf.stats.test.js
'use strict';
const assert = require('assert'), { Readable } = require('stream');
const G = require('./golf'), D = G._deps, SS = require('./signup-since'), RT = require('./ratings'), BF = require('./backfill-acctsince');
let db = {}, NOW = Date.parse('2026-11-18T18:00:00Z'), pass = 0;
const S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')) };
const ACC = (w) => w + '@phone.oddable', HEX = { ann: 'a'.repeat(64), bob: 'b'.repeat(64) }, phoneEmail = (id) => (id === HEX.ann ? ACC('ann') : id === HEX.bob ? ACC('bob') : id + '@phone.oddable');
// main's acct.js: NO `since` (golf must then read signup-since.js)
const acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable', phoneEmail });
D.S = S; D.acct = acct; D.now = () => NOW; D.ip = () => '1.1.1.' + Math.floor(Math.random() * 250); D.limitsMod = () => null; D.groups = () => null; D.stats = () => null; // main: no stats.js
D.feed = { events: async () => [], board: async () => { throw new Error('no feed'); } };
SS._deps.S = S; SS._deps.acct = acct; SS._deps.now = () => NOW;
const call = (who, op, b) => { const req = Readable.from([Buffer.from(JSON.stringify(Object.assign({ myName: who[0].toUpperCase() + who.slice(1) }, b || {})))]); req.url = '/golf/' + op; req.method = 'POST'; req.headers = { 'x-token': 't-' + who };
  return new Promise((ok) => { const res = { setHeader() {}, end(t) { ok({ s: res.statusCode, j: JSON.parse(t) }); } }; G.handle(req, res); }); };
const ok = (r, m) => { assert.ok(r.s === 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j.error || r.j.note || '').slice(0, 300)); return r; };
const t = (m) => { pass++; console.log('  ok', m); };
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10], COURSE = { name: 'Test CC', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 71.2, slope: 125 };
const quiet = async (fn) => { const e = console.error, said = []; console.error = (m) => said.push(String(m)); try { return [await fn(), said]; } finally { console.error = e; } };

(async () => {
  // 1. Before the one-time backfill: the switch refuses (loudly), nobody's date is known, nothing is written
  db = {}; SS._reset(); G._reset();
  let [s, said] = await quiet(() => G.moneySwitch({ GOLF_MONEY_ENABLED: '1' }));
  assert.strictEqual(s.on, false); assert.ok(/filled in/.test(s.why) && /backfill-acctsince/.test(s.why), s.why); assert.ok(said.some((m) => /golf money stays OFF/.test(m)), 'said in the log');
  const [u0] = await quiet(() => SS.sinceOf(ACC('cat'), NOW)); assert.deepStrictEqual(u0, { t: NOW, known: false }); assert.deepStrictEqual(Object.keys(db), [], 'boot guard: nothing stamped on first look');
  t('before the backfill: GOLF_MONEY_ENABLED=1 is REFUSED with a log line naming the fix; sinceOf = not known; no row written');
  // 2. The backfill (dry run writes nothing; --write stamps accounts from their first bet / first daily-log day, never before the launch, and writes the marker)
  db[HEX.ann] = { id: HEX.ann, data: { bets: [{ id: 'b' + Date.parse('2026-03-01T15:00:00Z') }], log: {} }, updated: 1 };
  db[HEX.bob] = { id: HEX.bob, data: { bets: [], log: { '2026-10-02': {} } }, updated: 1 };
  db['plog:2026-01-15-10'] = { id: 'plog:2026-01-15-10', data: {}, updated: 1 };
  const before = JSON.stringify(db), dry = await BF.run({ db: S, phoneEmail, sinceKey: SS.sinceKey, now: NOW }); assert.strictEqual(JSON.stringify(db), before, 'dry run: nothing written'); assert.strictEqual(dry.rows, 2);
  const rep = await BF.run({ db: S, phoneEmail, sinceKey: SS.sinceKey, now: NOW, write: true }); assert.ok(rep.written && rep.marker); assert.deepStrictEqual([rep.bet, rep.log], [1, 1]);
  assert.strictEqual(await SS.since(ACC('ann')), Date.parse('2026-03-01T15:00:00Z')); assert.strictEqual(await SS.since(ACC('bob')), Date.parse('2026-10-02T06:00:00Z')); assert.ok(db[SS.BFROW].data.at, 'marker row');
  const again = await BF.run({ db: S, phoneEmail, sinceKey: SS.sinceKey, now: NOW + 1000, write: true }); assert.strictEqual(again.added, 0, 'running it again changes nothing');
  t('backfill-acctsince.js: dry run writes nothing; --write stamps ann (first bet) and bob (first daily-log day) and writes the marker; a second run adds nothing');
  // 3. After the backfill: the switch turns on; an account with no stamp (a phone account first seen after the backfill) is stamped now, once; so is an email account
  //    without acct.createdAt (main has none; review fix 1); guests stay "not on file"
  SS._reset(); [s] = await quiet(() => G.moneySwitch({ GOLF_MONEY_ENABLED: '1' })); assert.deepStrictEqual([s.on, s.minDays], [true, 1]); assert.strictEqual(await SS.sinceBackfilled(), true);
  let si = await SS.sinceOf(ACC('cat'), NOW); assert.deepStrictEqual(si, { t: NOW, known: true }); si = await SS.sinceOf(ACC('cat'), NOW + 5 * 864e5); assert.deepStrictEqual(si, { t: NOW, known: true }, 'set once: the first look stays');
  const [em] = await quiet(() => SS.sinceOf('someone@example.com', NOW)); assert.deepStrictEqual(em, { t: NOW, known: true }, 'email account (no acct.createdAt on main): stamped now on first look (review fix 1)');
  assert.strictEqual(await SS.since('someone@example.com'), NOW, 'the stamp is written'); const em2 = await SS.sinceOf('someone@example.com', NOW + 25 * 3600e3); assert.deepStrictEqual(em2, { t: NOW, known: true }, 'set once');
  assert.ok(NOW + 23 * 3600e3 - em2.t < 864e5 && NOW + 25 * 3600e3 - em2.t >= 864e5, 'under a day old after 23 h (cannot sign), a day old after 25 h (can sign)'); assert.strictEqual((await SS.sinceOf('guest:abc', NOW)).known, false);
  t('after the backfill: the switch is ON (minDays 1); phone AND email accounts with no stamp are stamped at first look and never move (email: waits a day, then can sign); guests are "not on file"');
  // 4. The ONE signer bar with the brought module: 1 day by the server stamp (owner GOLF-AGE). dan was first seen 23 hours ago: refused; 25 hours later: signs
  db = {}; SS._reset(); G._reset(); await BF.run({ db: S, phoneEmail, sinceKey: SS.sinceKey, now: NOW - 30 * 864e5, launch: Date.parse('2026-01-15T00:00:00Z'), write: true }); // an empty database, backfilled a month ago (--launch given)
  await SS.sinceSet(ACC('ann'), NOW - 200 * 864e5); await SS.sinceSet(ACC('bob'), NOW - 90 * 864e5); await SS.sinceSet(ACC('dan'), NOW - 23 * 3600e3);
  let r = ok(await call('ann', 'create', { kind: 'day', title: 'Money day', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'gross' }, pot: { entry: 10 } })); const id = r.j.game.id, code = r.j.game.code, annP = r.j.game.me;
  ok(await call('ann', 'team', { id, op: 'assign', pid: annP, tid: 'T1' })); const bobP = ok(await call('bob', 'join', { code, tid: 'T2' })).j.game.me; const danP = ok(await call('dan', 'join', { code, tid: 'T3' })).j.game.me;
  for (const p of [annP, bobP, danP]) ok(await call('ann', 'paid', { id, pid: p, paid: true }));
  ok(await call('ann', 'start', { id }));
  for (let h = 1; h <= 3; h++) { ok(await call('ann', 'score', { id, tid: 'T1', hole: h, p: { [annP]: PAR[h - 1] }, eid: 'a' + h })); ok(await call('bob', 'score', { id, tid: 'T2', hole: h, p: { [bobP]: PAR[h - 1] + 1 }, eid: 'b' + h })); ok(await call('dan', 'score', { id, tid: 'T3', hole: h, p: { [danP]: PAR[h - 1] }, eid: 'd' + h })); }
  for (const [w, tid] of [['ann', 'T2'], ['bob', 'T3'], ['dan', 'T1']]) { const g = (await call(w, 'get', { id })).j.game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); const c = await call(w, 'confirm', { id, tid, from: 1, to: 3, revs }); assert.ok(c.s === 200 || c.s === 202, 'confirm ' + c.s + ' ' + JSON.stringify(c.j.error)); }
  r = await call('bob', 'score', { id, tid: 'T2', hole: 2, p: { [bobP]: PAR[1] }, eid: 'fix2' }); assert.strictEqual(r.s, 202, 'a lower score on a confirmed hole waits for another team: ' + r.s + ' ' + JSON.stringify(r.j.error)); const n = r.j.n;
  const pend = r.j.game.pending.find((q) => q.n === n); assert.ok(pend.who.includes('Ann'), JSON.stringify(pend.who)); assert.ok(!pend.who.includes('Dan'), 'Dan (23 hours) is not offered: ' + JSON.stringify(pend.who));
  let c2 = await call('dan', 'sign', { id, n }); assert.strictEqual(c2.s, 403); assert.ok(/less than 1 day old/.test(c2.j.error), c2.j.error);
  NOW += 2 * 3600e3; G._reset(); c2 = await call('dan', 'sign', { id, n }); ok(c2, 'Dan is 25 hours old now (server stamp), so he may sign for another team');
  t('the ONE bar (SIGNER_MIN_DAYS = ' + G.SIGNER_MIN_DAYS + ', owner GOLF-AGE) reads the brought sign-up date: 23 hours = "less than 1 day old" (403), 25 hours = signs');
  // 5. ratings.js from stats: a missing handicap is never 0 strokes (it throws); golf without stats.js (main) never calls it with null: casual net game, nobody has a number
  assert.throws(() => RT.strokesOnHole(null, 5)); assert.throws(() => RT.courseHandicap(null, 125, 71.2, 72)); assert.strictEqual(RT.courseHandicap(10, 125, 71.2, 72), 10);
  r = ok(await call('ann', 'create', { kind: 'day', title: 'Casual net', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', extras: { skins: { on: true, net: true, amt: 0 } } }, pot: { entry: 0 } })); const c3 = r.j.game.id;
  const p1 = ok(await call('bob', 'join', { code: r.j.game.code, tid: 'T1' })).j.game.me, p2 = ok(await call('dan', 'join', { code: r.j.game.code, tid: 'T2' })).j.game.me; ok(await call('ann', 'start', { id: c3 }));
  for (let h = 1; h <= 18; h++) { ok(await call('bob', 'score', { id: c3, tid: 'T1', hole: h, p: { [p1]: PAR[h - 1] + 1 } })); ok(await call('dan', 'score', { id: c3, tid: 'T2', hole: h, p: { [p2]: PAR[h - 1] } })); }
  r = ok(await call('ann', 'get', { id: c3 })); const rows = r.j.game.board.rows, b1 = rows.find((x) => x.tid === 'T1'), d2 = rows.find((x) => x.tid === 'T2');
  assert.deepStrictEqual([b1.gross, b1.net, d2.gross, d2.net], [90, 90, 72, 72]); assert.strictEqual(r.j.game.day.hi[p1].used, null); assert.strictEqual(r.j.game.day.hi[p1].ch, 0);
  ok(await call('ann', 'final', { id: c3 }));
  t('ratings.js (stats 54e0b93) throws on a missing handicap; golf on main (no stats.js) plays a casual net game with nobody holding a number: 0 strokes, said so, boards and skins work');
  console.log('\nALL ' + pass + ' GOLF x BROUGHT-FROM-STATS CHECKS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL ' + String(e && e.stack || e).slice(0, 1200)); process.exit(1); });
