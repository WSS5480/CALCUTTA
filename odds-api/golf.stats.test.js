// Golf x the REAL stats module (stats-v1 "Player stats (v1.2)": the manager's CONFIRMED rule). No network, no database.
// Run: node odds-api/golf.stats.test.js
// Where the real files come from: this folder when stats.js is in it (the merged build); else STATS=<a stats checkout>/odds-api, else
// /home/claude/calcutta-stats (its committed HEAD, exported with `git archive`). Outside the merged build a COPY is made under /tmp/golf-stats-merged:
// the stats branch's odds-api with this branch's golf files laid over it, so golf.js finds ./stats and golf-score.js uses the real ./ratings.js
// (whose strokesOnHole / courseHandicap THROW on a missing handicap). Skipped (exit 0) when no stats module can be found. Writes only under /tmp.
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), cp = require('child_process'), { Readable } = require('stream');
let ROOT = __dirname + '/';
if (!fs.existsSync(ROOT + 'stats.js')) {
  const src = process.env.STATS || '/home/claude/calcutta-stats/odds-api', M = '/tmp/golf-stats-merged/odds-api/';
  if (!fs.existsSync(src + '/stats.js')) { console.log('golf.stats.test: no stats module found (set STATS=<stats checkout>/odds-api). SKIPPED.'); process.exit(0); }
  fs.rmSync('/tmp/golf-stats-merged', { recursive: true, force: true }); fs.mkdirSync(M, { recursive: true });
  let from = 'working files of ' + src;
  try { if (process.env.STATS) throw new Error('use the folder as it is'); const tar = cp.execFileSync('git', ['-C', path.dirname(src), 'archive', 'HEAD', 'odds-api'], { maxBuffer: 1 << 28 }); cp.execFileSync('tar', ['-x', '-C', '/tmp/golf-stats-merged'], { input: tar }); from = 'stats ' + String(cp.execFileSync('git', ['-C', path.dirname(src), 'rev-parse', '--short', 'HEAD'])).trim(); }
  catch (e) { fs.cpSync(src, M, { recursive: true }); }
  ['golf.js', 'golf-score.js', 'golf-feed.js', 'golf-courses.js', 'pairing.js'].forEach((f) => fs.copyFileSync(ROOT + f, M + f)); fs.cpSync(ROOT + 'fixtures', M + 'fixtures', { recursive: true });
  ROOT = M; console.log('golf.stats.test: ' + from + ' + this golf, in ' + M);
}
const G = require(ROOT + 'golf'), ST = require(ROOT + 'stats'), RT = require(ROOT + 'ratings'), D = G._deps;
let db = {}, pass = 0, NOW = Date.parse('2026-11-01T18:00:00Z');
const S = { dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null), dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); }, dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; }, adminUsers: async () => [], dbIds: async () => [] };
const ACC = (w) => w + '@phone.oddable', acct = () => ({ who: (req) => { const x = String(req.headers['x-token'] || ''); return x.startsWith('t-') ? ACC(x.slice(2)) : null; }, isOwnerPhone: () => false, ownerName: () => 'Sir Oddable', ownerOk: () => false, since: async () => Date.parse('2026-01-01T00:00:00Z'), phoneEmail: (x) => x });
D.S = S; D.acct = acct; D.now = () => NOW; D.ip = () => '1.1.1.1'; D.limitsMod = () => null; D.groups = () => null; D.feed = { events: async () => [], board: async () => { throw new Error('no feed'); } };
ST._deps.S = S; ST._deps.acct = acct; ST._deps.now = () => NOW; ST._deps.groups = () => null; ST.register('golf', G.statsFor);
assert.ok(D.stats() === ST, 'golf found the real stats module by itself');
const call = (who, op, b) => { const req = Readable.from([Buffer.from(JSON.stringify(Object.assign({ myName: who[0].toUpperCase() + who.slice(1) }, b || {})))]); req.url = '/golf/' + op; req.method = 'POST'; req.headers = { 'x-token': 't-' + who };
  return new Promise((ok) => { const res = { setHeader() {}, end(t) { ok({ s: res.statusCode, j: JSON.parse(t) }); } }; G.handle(req, res); }); };
const ok = (r, m) => { assert.ok(r.s === 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j.error || r.j.note || '').slice(0, 300)); return r; };
const t = (m) => { pass++; console.log('  ok', m); };
const PAR = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [7, 3, 15, 1, 11, 5, 17, 13, 9, 8, 4, 16, 2, 12, 6, 18, 14, 10], COURSE = { name: 'Test CC', tees: 'White', holes: 18, par: PAR, hcp: SI, rating: 71.2, slope: 125 };
const later = () => { NOW += 26 * 3600e3; ST._reset(); }; // the next day, and past the stats module's 60-second cache
const conf = async (who, id, tid) => { const g = (await call(who, 'get', { id })).j.game, revs = {}; Object.keys(g.day.scores[tid] || {}).forEach((h) => (revs[h] = g.day.scores[tid][h].rev)); return call(who, 'confirm', { id, tid, from: 1, to: 18, revs }); };
// a casual two-player round: `a` organizes on Team 1, `b` plays Team 2 (or a typed-in guest when b is null); over = strokes over par per hole
async function round(a, b, over, sign) { later(); let r = ok(await call(a, 'create', { kind: 'day', title: a + ' day', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'gross' }, pot: { entry: 0 } })); const id = r.j.game.id, me = r.j.game.me;
  ok(await call(a, 'team', { id, op: 'assign', pid: me, tid: 'T1' })); let other = null; if (b) { r = ok(await call(b, 'join', { code: r.j.game.code, tid: 'T2' })); other = r.j.game.me; } else ok(await call(a, 'team', { id, op: 'guest', name: 'Ghost', tid: 'T2' }));
  ok(await call(a, 'start', { id })); for (let h = 1; h <= 18; h++) ok(await call(a, 'score', { id, tid: 'T1', hole: h, p: { [me]: PAR[h - 1] + over } }));
  if (b) { for (let h = 1; h <= 18; h++) ok(await call(b, 'score', { id, tid: 'T2', hole: h, p: { [other]: PAR[h - 1] + 1 } })); if (sign) { ok(await conf(b, id, 'T1')); ok(await conf(a, id, 'T2')); } }
  ok(await call(a, 'final', { id })); return id; }

(async () => {
  // 1. H4 with the real module: rounds "with" a typed-in guest give no money-game number
  for (let k = 0; k < 3; k++) await round('dan', null, 2); later();
  let h = await ST.handicapFor(ACC('dan')); assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.use, h.needsSet], [3, 0, null, true]); assert.ok(h.oddable.index != null, 'the rounds still count for his own full index');
  t('real stats: three rounds against a typed-in guest -> 3 rounds, 0 confirmed, use null, needsSet (the reviewer\'s H4 repro: it gave 54.0 "3 of 3 confirmed")');
  // 2. three rounds with the SAME other account, every card signed by the other team: confirmed rounds, but one confirmer is not enough
  for (let k = 0; k < 3; k++) await round('rex', 'sue', 1, true); later();
  if (process.env.DBG) { const rr = (await ST.statsFor(ACC('rex'), {})).filter((x) => x.kind === 'golf-round'); console.log(JSON.stringify(rr.map((x) => [x.date, x.score, x.extra.card, x.extra.confirmed, x.extra.confirmWhy, x.extra.hcpNote]))); }
  h = await ST.handicapFor(ACC('rex')); // (how many rounds ONE confirmer may account for is the stats module's own limit: 2 at 99f409a, 8 for rounds scored in games after its follow-up)
  assert.ok(h.confirmedRounds >= 2, 'golf\'s extra.card is read as confirmed by the real module: ' + JSON.stringify(h.makeup && h.makeup.text)); assert.strictEqual(h.use, null); assert.ok(/3 different|3 confirmed rounds/.test(h.why || ''), h.why);
  assert.deepStrictEqual(h.makeup.who.map((w) => w.name), ['Sue']); const c1 = h.confirmedRounds;
  t('real stats: a card signed hole by hole by an account on another team is CONFIRMED (extra.card others / by / byName); one confirmer three times -> still no number ("' + h.why + '")');
  // 3. two more opponents sign two more rounds: three different confirmers -> the money-game number exists
  await round('rex', 'tom', 1, true); await round('rex', 'uma', 1, true); later();
  h = await ST.handicapFor(ACC('rex')); assert.strictEqual(h.confirmedRounds, c1 + 2); assert.ok(typeof h.use === 'number' && h.use === h.confirmedIndex, 'use = the confirmed index: ' + h.use); assert.strictEqual(h.makeup.confirmers, 3);
  // a round nobody signed, and a round where the other account never put a score down, do not count as confirmed
  await round('rex', 'vic', 9, false); later(); const use = h.use; h = await ST.handicapFor(ACC('rex')); assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.use], [6, c1 + 2, use], 'an unsigned card is not confirmed and moves nothing');
  t('real stats: rounds signed by three different accounts on other teams -> use = ' + use + ' (' + (c1 + 2) + ' of 6 rounds confirmed); the unsigned sandbag round moved nothing');
  // 4. a net money game: the number comes from stats, the organizer sees its make-up, a player with needsSet and nothing set blocks the start
  later(); let r = ok(await call('zoe', 'create', { kind: 'day', title: 'Money net', course: COURSE, day: { fmt: 'stroke', teams: 3, teamSize: 1, net: 'net' }, pot: { entry: 5 } })); const id = r.j.game.id, code = r.j.game.code;
  r = ok(await call('rex', 'join', { code, tid: 'T1', hcp: 40 })); const rex = r.j.game.me; assert.deepStrictEqual([r.j.game.day.hi[rex].src, r.j.game.day.hi[rex].used], ['oddable', use], 'plays off the confirmed index; the 40 he typed is ignored');
  r = ok(await call('dan', 'join', { code, tid: 'T2', hcp: 30 })); const dan = r.j.game.me; assert.deepStrictEqual([r.j.game.day.hi[dan].src, r.j.game.day.hi[dan].used, r.j.game.day.hi[dan].ask], ['none', null, 30], 'needsSet: his own number is only asked for');
  assert.deepStrictEqual(Object.keys(r.j.game.day.makeup), [dan], 'a player sees the make-up of his own number only');
  r = ok(await call('zoe', 'get', { id })); const mu = r.j.game.day.makeup; assert.ok(mu[rex] && mu[rex].made && mu[rex].made.confirmers === 3 && mu[rex].made.who.length === 3 && /confirm/i.test(mu[rex].made.text), JSON.stringify(mu[rex])); assert.ok(mu[dan] && /3 confirmed rounds/.test(mu[dan].why), JSON.stringify(mu[dan]));
  r = ok(await call('zoe', 'makeup', { id, pid: rex })); assert.ok(r.j.makeup.rounds.length >= 4 && r.j.makeup.rounds.some((x) => x.byName === 'Tom') && r.j.makeup.rounds.every((x) => x.typed === false), JSON.stringify(r.j.makeup.rounds[0])); assert.strictEqual((await call('dan', 'makeup', { id, pid: rex })).s, 403, 'not another player\'s');
  r = ok(await call('zoe', 'makeup', { id, pid: dan })); assert.ok(/organizer or tournament director sets a handicap/.test(r.j.ask), r.j.ask);
  assert.ok(!JSON.stringify((await call('zoe', 'get', { id })).j.game).includes('@phone'), 'no account id in the game sent to the organizer');
  r = await call('zoe', 'start', { id }); assert.strictEqual(r.s, 409, 'MERGED-BUILD CHECK the stats coder asked for: money game, a player with needsSet and no number entered -> the game refuses to start'); assert.deepStrictEqual(r.j.needHcp, [dan]);
  r = await call('zoe', 'team', { id, op: 'hcp', pid: dan, hcp: 24 }); assert.strictEqual(r.s, 202, 'round 4: 24 is not the number Dan asked for (30), so Dan signs it, even though the organizer does not play'); r = ok(await call('dan', 'sign', { id, n: r.j.n })); assert.strictEqual(r.j.game.day.hi[dan].used, 24); ok(await call('zoe', 'start', { id }));
  t('money game on the real module: number = stats `use`; the organizer sees every number\'s make-up (rounds, who confirmed, typed or scored); needsSet with no number refuses the start');
  // 5. a missing handicap never reaches the ratings maths (the real strokesOnHole / courseHandicap throw on null)
  assert.throws(() => RT.strokesOnHole(null, 5), 'the real ratings.js throws on a missing handicap'); assert.throws(() => RT.courseHandicap(null, 125, 71.2, 72));
  later(); r = ok(await call('zoe', 'create', { kind: 'day', title: 'Casual net', course: COURSE, day: { fmt: 'stroke', teams: 2, teamSize: 1, net: 'net', extras: { skins: { on: true, net: true, amt: 0 } } }, pot: { entry: 0 } })); const c2 = r.j.game.id;
  r = ok(await call('dan', 'join', { code: r.j.game.code, tid: 'T1' })); const d2 = r.j.game.me; r = ok(await call('wes', 'join', { code: r.j.game.code, tid: 'T2' })); const w2 = r.j.game.me; assert.strictEqual(r.j.game.day.hi[w2].used, null);
  ok(await call('zoe', 'start', { id: c2 })); for (let hh = 1; hh <= 18; hh++) { ok(await call('dan', 'score', { id: c2, tid: 'T1', hole: hh, p: { [d2]: PAR[hh - 1] + 1 } })); ok(await call('wes', 'score', { id: c2, tid: 'T2', hole: hh, p: { [w2]: PAR[hh - 1] } })); }
  r = ok(await call('zoe', 'get', { id: c2 })); { const w = r.j.game.board.rows.find((x) => x.tid === 'T2'), dd = r.j.game.board.rows.find((x) => x.tid === 'T1'); assert.deepStrictEqual([w.gross, w.net, dd.gross], [72, 72, 90]); assert.ok(dd.net < 90, 'Dan plays off his full index in a casual game'); } assert.strictEqual(r.j.game.day.hi[w2].ch, 0, '0 strokes, said so, never a null passed on');
  ok(await call('zoe', 'final', { id: c2 })); later(); const recs = await ST.statsFor(ACC('wes'), {}); assert.ok(recs.length >= 1, 'the round reaches his dashboard through the real stats module');
  t('a player with no number in a casual net game: 0 strokes handled in golf (chOf), boards, skins and records work, and the real ratings maths is never called with null');
  console.log('\nALL ' + pass + ' GOLF x REAL STATS CHECKS PASSED'); process.exit(0);
})().catch((e) => { console.error('FAIL ' + String(e && e.stack || e).slice(0, 1200)); process.exit(1); });
