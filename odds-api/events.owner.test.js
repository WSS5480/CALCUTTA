// Run: node odds-api/events.owner.test.js [name ...]   Owner rules of Nov 16 2026: S-ALL (every play in the dashboard with its money), H1 (the Oddable
// rating from app play is THE pickleball rating), E-H (Enterprise director sets / changes ratings for one tournament), P1 (Suggest partners).
// In-memory database, fake sign-in and clock, no network.
const assert = require('assert'), http = require('http'), E = require('./events'), D = E._deps, PAIR = require('./pairing');
let db = {};
D.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); return t.startsWith('t-') ? 'acct-' + t.slice(2) : null; } });
// Merged build (preview): limits.js and stats.js are in the tree, but this suite checks events.js itself on its in-memory database, so it pins the
// engine's own same-shape fallbacks. The real limits / stats wiring is exercised by the preview's seeded data and Playwright walk.
D.limits = () => E.LIMSTAND; D.rt = () => E.STAND;
const ENT = new Set(); D.enterprise = async (k) => ENT.has(String(k).replace('acct-', ''));
let ipn = 0; D.ip = () => '7.8.' + (ipn % 250) + '.' + (ipn++ % 251);
const Z = (s) => Date.parse(s), DAY = 864e5, HOUR = 3600e3; let NOW; D.now = () => NOW;
const srv = http.createServer(async (req, res) => { if (!(await E.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P;
const call = async (who, op, b) => { const r = await fetch('http://127.0.0.1:' + P + '/events/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, body: JSON.stringify(b || {}) }); const txt = await r.text(); return { s: r.status, j: JSON.parse(txt), txt }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const no = (r, s, m) => { assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const base = (o) => Object.assign({ title: 'Owner test', sport: 'pickleball', fmt: 'rr', unit: 'singles', to: 11, winBy: 2, bestOf: 1, seeding: 'rating', courts: 2, pools: 1, playoff: 0, entry: 0, split: 'none', take: { kind: 'none' }, myName: 'Ann', playIn: true }, o || {}, { start: (o && o.start) || NOW + 2 * HOUR });
const reset = () => { db = {}; E._reset(); ENT.clear(); NOW = Z('2026-11-17T18:00:00Z'); };
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
// a singles event with accounts: `comm` organizes and plays, the others join; then every match is played. rank = names best first (the better always wins)
async function playEvent(comm, others, rank, extra) {
  let ev = ok(await call(comm, 'create', base(Object.assign({ myName: cap1(comm) }, extra)))).event; const id = ev.id;
  for (const o of others) ok(await call(o, 'join', { code: ev.code, as: 'player', myName: cap1(o) }));
  NOW += 3 * HOUR; ev = ok(await call(comm, 'get', { id })).event;
  for (let guard = 0; guard < 60; guard++) {
    const m = ev.matches.find((x) => x.state === 'ready' && x.a !== 'BYE' && x.b !== 'BYE' && x.an && x.bn); if (!m) break;
    const aWins = rank.indexOf(m.an) < rank.indexOf(m.bn), games = aWins ? [[11, 5]] : [[5, 11]], mine = m.an === cap1(comm) || m.bn === cap1(comm);
    NOW += 60e3; ev = ok(await call(comm, 'score', { id, m: m.id, games })).event;
    if (mine) { const opp = (m.an === cap1(comm) ? m.bn : m.an).toLowerCase(); ev = ok(await call(opp, 'confirm', { id, m: m.id })).event; }
  }
  return ev;
}
const T = {};
const only = process.argv.slice(2);
srv.listen(0, async () => {
  P = srv.address().port; let n = 0, fail = 0;
  for (const k of Object.keys(T)) { if (only.length && !only.includes(k)) continue; reset(); try { await T[k](); n++; console.log('  ok', k); } catch (e) { fail++; console.log('  FAIL', k, '-', e.stack.split('\n').slice(0, 12).join(' | ')); } }
  console.log(fail ? '\nFAILED ' + fail + ' of ' + (n + fail) : '\nPASS ' + n + ' owner-rule checks'); srv.close(); process.exit(fail ? 1 : 0);
});

// ---------- S-ALL: every match and every tournament is a per-player stats record with result, place, entry, payout, net ----------
T.sAllTournamentMoney = async () => {
  let ev = ok(await call('ann', 'create', base({ entry: 20, split: '60/30/10', take: { kind: 'pct', v: 10 } }))).event; const id = ev.id;
  for (const o of ['bob', 'cy', 'di']) ok(await call(o, 'join', { code: ev.code, as: 'player', myName: cap1(o) }));
  ev = ok(await call('ann', 'get', { id })).event; for (const m of ev.members) ok(await call('ann', 'paid', { id, pid: m.pid, paid: true }));
  // before it starts and while it runs: the play is already in each dashboard as an open record with its entry
  let live = await E.statsFor('acct-bob', {}); assert.strictEqual(live.length, 1); assert.strictEqual(live[0].kind, 'event'); assert.strictEqual(live[0].result, null); assert.strictEqual(live[0].extra.live, true);
  assert.strictEqual(live[0].extra.entry, 20); assert.strictEqual(live[0].extra.payout, null); assert.strictEqual(live[0].extra.net, null); assert.strictEqual(live[0].stake, 20); assert.ok(!('pl' in live[0]) && !('place' in live[0]), 'no place or net until it is final');
  NOW += 3 * HOUR; ev = ok(await call('ann', 'get', { id })).event; const rank = ['Ann', 'Bob', 'Cy', 'Di'];
  for (let g = 0; g < 20; g++) { const m = ev.matches.find((x) => x.state === 'ready' && x.an && x.bn); if (!m) break; const games = rank.indexOf(m.an) < rank.indexOf(m.bn) ? [[11, 5]] : [[5, 11]]; NOW += 60e3; ev = ok(await call('ann', 'score', { id, m: m.id, games })).event; if (m.an === 'Ann' || m.bn === 'Ann') ev = ok(await call((m.an === 'Ann' ? m.bn : m.an).toLowerCase(), 'confirm', { id, m: m.id })).event; }
  assert.ok(ev.fin, 'finished'); // pot 80, take 8, pool 72 -> 43.20 / 21.60 / 7.20
  const want = { ann: [1, 43.2, 23.2, 3, 0], bob: [2, 21.6, 1.6, 2, 1], cy: [3, 7.2, -12.8, 1, 2], di: [4, 0, -20, 0, 3] }; let paidOut = 0;
  for (const who of Object.keys(want)) {
    const recs = await E.statsFor('acct-' + who, {}), evR = recs.filter((r) => r.kind === 'event'), ms = recs.filter((r) => r.kind === 'match'), [place, payout, net, w, l] = want[who];
    assert.strictEqual(evR.length, 1, who + ' one tournament record'); const r = evR[0];
    assert.deepStrictEqual(r.place, { n: place, of: 4 }); assert.strictEqual(r.extra.entry, 20); assert.strictEqual(r.extra.payout, payout, who + ' payout'); assert.strictEqual(r.extra.net, net, who + ' net');
    assert.strictEqual(r.stake, 20); assert.strictEqual(r.won, payout); assert.strictEqual(r.pl, net); assert.ok(!r.extra.live && r.extra.ended, 'final'); assert.ok(/never collects or pays/.test(r.extra.moneyNote)); paidOut += payout;
    assert.strictEqual(ms.length, 3, who + ' one record per match'); assert.strictEqual(ms.filter((x) => x.result === 'W').length, w); assert.strictEqual(ms.filter((x) => x.result === 'L').length, l);
    ms.forEach((x) => { for (const k of ['place', 'entry', 'payout', 'net']) assert.ok(k in x.extra, 'match record has ' + k); assert.strictEqual(x.extra.entry, 0); assert.strictEqual(x.extra.net, 0); assert.strictEqual(x.extra.moneyOn, id + ':event'); assert.ok(x.opponent && x.extra.scoreText); });
    recs.forEach((x) => { assert.strictEqual(x.src, 'events'); assert.ok(/^\d{4}-\d\d-\d\d$/.test(x.date)); assert.strictEqual(typeof x.verified, 'boolean'); assert.ok(!JSON.stringify(x).includes('acct-'), 'no account ids'); Object.values(x).forEach((v) => assert.notStrictEqual(v, undefined)); });
  }
  assert.strictEqual(Math.round(paidOut * 100), 7200, 'payouts add up to the prize pool');
  // the stats branch's real validate(), when that file is around (STATS_JS=<path>)
  if (process.env.STATS_JS) { const V = require(process.env.STATS_JS).validate; for (const who of ['ann', 'di']) for (const r of await E.statsFor('acct-' + who, {})) { const v = V(r, 'events'); assert.ok(v.ok, 'stats validate: ' + v.why + ' ' + JSON.stringify(r)); } }
};
T.sAllTiesDoublesSpectators = async () => {
  // single elimination, 4 doubles pairs, entry 10, 50/30/20: the two semi-final losers tie for 3rd and share the 3rd prize; partners split a pair's prize
  ENT.add('ann'); // 8 players + organizer needs more than 8 seats
  let ev = ok(await call('ann', 'create', base({ fmt: 'se', unit: 'doubles', playIn: false, entry: 10, split: '50/30/20', seeding: 'manual', self: true }))).event; const id = ev.id;
  const pairs = [['bob', 'cy'], ['di', 'ed'], ['fay', 'gus'], ['hal', 'ivy']];
  for (const [a, b] of pairs) { ev = ok(await call(a, 'join', { code: ev.code, as: 'player', myName: cap1(a), entryName: cap1(a) + ' / ' + cap1(b) })).event; const e = ev.entrants.find((x) => x.name === cap1(a) + ' / ' + cap1(b)); ok(await call(b, 'join', { code: ev.code, as: 'player', myName: cap1(b), eid: e.eid })); }
  ok(await call('zed', 'join', { code: ev.code, as: 'spectator', myName: 'Zed' }));
  ev = ok(await call('ann', 'get', { id })).event; for (const m of ev.members.filter((x) => x.role === 'player')) ok(await call('ann', 'paid', { id, pid: m.pid, paid: true }));
  NOW += 3 * HOUR; ev = ok(await call('ann', 'get', { id })).event;
  for (let g = 0; g < 10; g++) { const m = ev.matches.find((x) => x.state === 'ready' && x.an && x.bn); if (!m) break; NOW += 60e3; ev = ok(await call('ann', 'score', { id, m: m.id, games: [[11, 4]] })).event; }
  assert.ok(ev.fin); const pl = ev.placeRows; assert.deepStrictEqual(pl.map((r) => r.place), [1, 2, 3, 3]); // pot 80: 40 / 24 / 16
  const acct = (entryName, i) => entryName.split(' / ')[i].toLowerCase(), amt = { 1: 20, 2: 12, 3: 4 }; let sum = 0;
  for (const row of pl) for (const i of [0, 1]) { const r = (await E.statsFor('acct-' + acct(row.name, i), {})).find((x) => x.kind === 'event'); assert.strictEqual(r.extra.payout, amt[row.place], row.name + ' share'); assert.strictEqual(r.extra.net, amt[row.place] - 10); assert.strictEqual(r.place.n, row.place); sum += r.extra.payout; }
  assert.strictEqual(sum, 80, 'ties and partner shares add up to the pool');
  const m1 = (await E.statsFor('acct-bob', {})).find((x) => x.kind === 'match'); assert.strictEqual(m1.extra.partner, 'Cy', 'the partner is on the record');
  assert.deepStrictEqual(await E.statsFor('acct-zed', {}), [], 'a spectator with no picks has no play'); assert.deepStrictEqual(await E.statsFor('acct-ann', {}), [], 'an organizer who does not play has no play');
};
T.sAllSoloAndPickem = async () => {
  let ev = ok(await call('kim', 'create', base({ fmt: 'solo', sport: 'golf', title: 'Putting practice', to: 0, winBy: 1, low: true, unitLabel: 'putts', endDay: '2026-11-19', myName: 'Kim', start: NOW - 60e3 }))).event; const id = ev.id;
  ev = ok(await call('kim', 'get', { id })).event; ok(await call('kim', 'solo', { id, eid: ev.myEntries[0], score: 31 }));
  let r = (await E.statsFor('acct-kim', {})).filter((x) => x.kind === 'event'); assert.strictEqual(r.length, 1); assert.strictEqual(r[0].extra.live, true, 'a one-player game is in the dashboard while it runs');
  ok(await call('kim', 'finish', { id })); r = (await E.statsFor('acct-kim', {})).filter((x) => x.kind === 'event'); assert.deepStrictEqual(r[0].place, { n: 1, of: 1 }); assert.strictEqual(r[0].score, 31); assert.strictEqual(r[0].sport, 'golf'); assert.strictEqual(r[0].extra.entry, 0); assert.strictEqual(r[0].extra.net, 0); assert.ok(!('pl' in r[0]), 'no money fields when the game is free');
};

// ---------- H1: the Oddable rating from app play is THE pickleball rating ----------
T.h1RatingFromAppPlay = async () => {
  const r0 = await E.ratingFor('acct-ann', 'pickleball'); assert.deepStrictEqual([r0.oddable.rating, r0.oddable.matches, r0.event, r0.setBy, r0.use, r0.start], [null, 0, null, null, 1500, true], 'no games yet: the stats contract shape, use = the 1500 start');
  const ev1 = await playEvent('ann', ['bob', 'cy', 'di'], ['Di', 'Cy', 'Bob', 'Ann']); assert.ok(ev1.fin); NOW += DAY; E._reset();
  const R = {}; for (const w of ['ann', 'bob', 'cy', 'di']) { const x = await D.rt().ratingFor('acct-' + w, 'pickleball'); assert.strictEqual(x.use, x.oddable.rating); R[w] = Object.assign({ label: x.label }, x.oddable); }
  assert.ok(R.di.rating > R.cy.rating && R.cy.rating > R.bob.rating && R.bob.rating > R.ann.rating, 'more wins in the app = higher rating ' + JSON.stringify(R)); assert.strictEqual(R.di.matches, 3); assert.ok(R.di.rating > 1500 && R.ann.rating < 1500); assert.ok(typeof R.di.label === 'string' && /Oddable/.test(R.di.label));
  assert.strictEqual((await E.ratingFor('acct-di', 'tennis')).oddable.rating, null, 'ratings are per sport');
  // next event: pickleball "by rating" seeds by the Oddable rating, not by the typed number (Ann types 5.0, Di types nothing)
  let ev = ok(await call('ann', 'create', base({ fmt: 'se', myRating: 5.0, entrants: [{ name: 'Guest Gil', rating: 4.9 }, { name: 'Guest Hy' }] }))).event; const id = ev.id;
  for (const o of ['bob', 'cy', 'di']) ok(await call(o, 'join', { code: ev.code, as: 'player', myName: cap1(o) }));
  ev = ok(await call('bob', 'get', { id })).event; assert.strictEqual(ev.odd, true);
  const seat = (n) => ev.entrants.find((e) => e.name === n).players[0]; assert.deepStrictEqual(seat('Di').odd, { rating: R.di.rating, matches: 3 }); assert.strictEqual(seat('Di').use, R.di.rating); assert.strictEqual(seat('Guest Gil').odd, null, 'a guest has no games yet'); assert.strictEqual(seat('Guest Gil').use, 1500);
  assert.strictEqual(ev.entrants.find((e) => e.name === 'Di').oddRating, R.di.rating);
  NOW += 3 * HOUR; ev = ok(await call('ann', 'get', { id })).event; const order = ev.entrants.slice().sort((a, b) => a.seed - b.seed).map((e) => e.name);
  assert.deepStrictEqual(order, ['Di', 'Cy', 'Guest Gil', 'Guest Hy', 'Bob', 'Ann'], 'seeded from the rating module\'s `use`: Oddable rating, new players at the 1500 start (typed number breaks their tie); Ann\'s typed 5.0 does not count');
  assert.ok(ev.audit.some((a) => /seeded by Oddable rating/.test(a.s)));
  // a stats module with its own ratingFor wins (same contract; a bare number is accepted too)
  const keep = D.rt, calls = []; D.rt = () => Object.assign({}, E.STAND, { ratingFor: async (k, sp, o) => { calls.push([k, sp, o && o.eventId]); return k === 'acct-ann' ? { oddable: { rating: 1300, matches: 4 }, event: 1900, setBy: 'tournament', use: 1900, reason: 'x', at: 5 } : { oddable: { rating: 1400, matches: 9 }, event: null, setBy: null, use: 1400 }; } }); E._reset();
  ev = ok(await call('ann', 'create', base({ fmt: 'se', title: 'Third', start: NOW + 2 * HOUR }))).event; ok(await call('di', 'join', { code: ev.code, as: 'player', myName: 'Di' })); NOW += 3 * HOUR; ev = ok(await call('ann', 'get', { id: ev.id })).event; D.rt = keep; assert.ok(calls.some((c) => c[0] === 'acct-di' && c[1] === 'pickleball' && c[2] === ev.id), 'asked with (userKey, sport, {eventId})'); assert.deepStrictEqual(ev.entrants.find((e) => e.name === 'Ann').players[0].trn, { v: 1900, at: 5, reason: 'x' });
  assert.deepStrictEqual(ev.entrants.slice().sort((a, b) => a.seed - b.seed).map((e) => e.name), ['Ann', 'Di']);
  // another sport is untouched unless the commissioner picks the Oddable rating
  ev = ok(await call('ann', 'create', base({ sport: 'cornhole', to: 21, winBy: 1, title: 'Bags', start: NOW + 2 * HOUR }))).event; assert.strictEqual(ev.odd, false); assert.ok(!('odd' in ev.entrants[0].players[0]));
};

// ---------- E-H: an Enterprise director adds / changes ratings for one tournament; the real Oddable rating is always shown; lifetime untouched ----------
T.ehDirectorRatings = async () => {
  await playEvent('club', ['bob', 'cy'], ['Bob', 'Cy', 'Club']); NOW += DAY; E._reset(); const life = (await E.ratingFor('acct-bob', 'pickleball')).oddable; assert.ok(life.rating > 1500);
  // not Enterprise: refused
  let ev = ok(await call('ann', 'create', base({ fmt: 'se', playIn: false, entrants: [{ name: 'Gil' }, { name: 'Hy' }] }))).event; const g0 = ev.entrants[0].players[0].gid;
  assert.ok(/Enterprise/.test(no(await call('ann', 'trate', { id: ev.id, gid: g0, rating: 1600, reason: 'club ladder' }), 403).error)); assert.strictEqual(ev.ent, false);
  // Enterprise tournament
  ENT.add('club'); ev = ok(await call('club', 'create', base({ fmt: 'se', playIn: false, myName: 'Dana', title: 'Club Open', entrants: [{ name: 'Gil' }, { name: 'Hy' }] }))).event; const id = ev.id; assert.strictEqual(ev.ent, true);
  for (const o of ['bob', 'cy']) ok(await call(o, 'join', { code: ev.code, as: 'player', myName: cap1(o) }));
  ev = ok(await call('club', 'get', { id })).event; const seat = (e, n) => e.entrants.find((x) => x.name === n).players[0];
  const gil = seat(ev, 'Gil').gid, bob = seat(ev, 'Bob').gid; assert.strictEqual(seat(ev, 'Gil').odd, null); assert.strictEqual(seat(ev, 'Bob').odd.rating, life.rating);
  no(await call('bob', 'trate', { id, gid: gil, rating: 1700, reason: 'self help' }), 403, 'only the director');
  no(await call('club', 'trate', { id, gid: gil, rating: 1700 }), 400, 'a reason is required'); no(await call('club', 'trate', { id, gid: gil, rating: 4.5, reason: 'DUPR' }), 400, 'Oddable scale only'); no(await call('club', 'trate', { id, gid: 'gNOPE', rating: 1700, reason: 'x y' }), 404);
  // add a rating for a player who is not on Oddable
  NOW += 1000; const t1 = NOW; ev = ok(await call('club', 'trate', { id, gid: gil, rating: 1700, reason: 'Club ladder #2' })).event;
  assert.deepStrictEqual(seat(ev, 'Gil').trn, { v: 1700, at: t1, reason: 'Club ladder #2' }); assert.strictEqual(seat(ev, 'Gil').use, 1700); assert.strictEqual(seat(ev, 'Gil').odd, null, 'still "no games yet" next to it'); assert.strictEqual(ev.entrants.find((x) => x.name === 'Gil').oddRating, 1700);
  // change a rating that came from the Oddable index: the real-results rating stays visible
  NOW += 1000; ev = ok(await call('club', 'trate', { id, gid: bob, rating: 1450, reason: 'Back from injury' })).event;
  assert.strictEqual(seat(ev, 'Bob').trn.v, 1450); assert.strictEqual(seat(ev, 'Bob').odd.rating, life.rating, 'real results never hidden'); assert.strictEqual(seat(ok(await call('cy', 'get', { id })).event, 'Bob').odd.rating, life.rating, 'players see both too');
  NOW += 1000; ev = ok(await call('club', 'trate', { id, gid: bob, rating: 1480, reason: 'Second look' })).event;
  assert.strictEqual(ev.tlog.length, 3); const L = ev.tlog[0]; assert.deepStrictEqual({ by: L.by, player: L.player, old: L.old, oddable: L.oddable, new: L.new, reason: L.reason, at: L.at }, { by: 'Dana', player: 'Bob', old: 1450, oddable: life.rating, new: 1480, reason: 'Second look', at: NOW });
  const lg = await D.rt().eventLog('acct-club', id); assert.strictEqual(lg.log.length, 3); assert.strictEqual(lg.lockAt, ev.start, 'registered with the rating module (eventSetup), locking at the start'); await assert.rejects(() => D.rt().eventLog('acct-bob', id)); await assert.rejects(() => D.rt().eventOverride('acct-bob', id, 'acct-cy', { rating: 2000, reason: 'nope' }));
  const viaMod = await E.ratingFor('acct-bob', 'pickleball', { eventId: id }); assert.deepStrictEqual([viaMod.oddable.rating, viaMod.event, viaMod.setBy, viaMod.use], [life.rating, 1480, 'tournament', 1480]);
  assert.strictEqual(ev.tlog[2].old, null); assert.strictEqual(ev.tlog[2].oddable, null); assert.strictEqual(ev.tlog[1].old, life.rating, 'old = the Oddable rating when no tournament rating was set'); assert.ok(ev.audit.some((a) => /Bob: tournament rating set to 1480 · Second look/.test(a.s)), 'in the event history');
  assert.ok(!(await call('cy', 'get', { id })).txt.includes('acct-'), 'no account ids');
  // lifetime untouched, other events untouched
  E._reset(); const after = await E.ratingFor('acct-bob', 'pickleball'); assert.deepStrictEqual([after.oddable.rating, after.event, after.use], [life.rating, null, life.rating], 'lifetime Oddable rating not changed by the director');
  const other = ok(await call('bob', 'create', base({ fmt: 'se', myName: 'Bob', title: 'Elsewhere' }))).event; assert.strictEqual(other.entrants[0].players[0].odd.rating, life.rating); assert.strictEqual(other.entrants[0].players[0].trn, null);
  // seeding uses the tournament ratings: Gil 1700, Cy (real), Bob 1480, Hy none
  const cyR = (await E.ratingFor('acct-cy', 'pickleball')).oddable.rating; assert.ok(cyR > 1480 && cyR < 1700, 'cy ' + cyR);
  // clearing goes back to the Oddable rating (logged)
  NOW += 1000; ev = ok(await call('club', 'trate', { id, gid: bob, rating: '', reason: 'Use his real rating' })).event; assert.strictEqual(seat(ev, 'Bob').trn, null); assert.strictEqual(seat(ev, 'Bob').use, life.rating); assert.strictEqual(ev.entrants.find((x) => x.name === 'Bob').oddRating, life.rating); assert.strictEqual(ev.tlog[0].new, null);
  ev = ok(await call('club', 'trate', { id, gid: bob, rating: 1480, reason: 'Final call' })).event;
  // locked at the start
  NOW = ev.start + 1000; ev = ok(await call('club', 'get', { id })).event; assert.deepStrictEqual(ev.entrants.slice().sort((a, b) => a.seed - b.seed).map((e) => e.name), ['Gil', 'Cy', 'Hy', 'Bob'], 'Gil 1700 (tournament), Cy (real), Hy 1500 (new), Bob 1480 (tournament)');
  assert.ok(/locked/i.test(no(await call('club', 'trate', { id, gid: gil, rating: 1200, reason: 'too late' }), 409).error)); assert.strictEqual(seat(ev, 'Gil').trn.v, 1700, 'still shown as set by the tournament after the start');
  // an early draw locks them too
  ev = ok(await call('club', 'create', base({ fmt: 'se', playIn: false, myName: 'Dana', title: 'Club Open 2', start: NOW + 5 * HOUR, entrants: [{ name: 'Gil' }, { name: 'Hy' }] }))).event; ok(await call('club', 'draw', { id: ev.id })); no(await call('club', 'trate', { id: ev.id, gid: ev.entrants[0].players[0].gid, rating: 1600, reason: 'after the draw' }), 409); assert.strictEqual((await D.rt().eventLog('acct-club', ev.id)).locked, true, 'an early draw locks the rating module too');
};

// ---------- P1: Suggest partners (Balanced default, Rotate, Hot pairs), one-line reason each; it only suggests ----------
// PREVIEW MERGE: ONE pairing.js (the Groups file). The reason-line checks below follow ITS wording; teams, strengths, order and behaviour checks are unchanged.
T.p1Contract = async () => {
  const S = PAIR.suggestPartners, P8 = [1900, 1750, 1650, 1600, 1500, 1450, 1300, 1150].map((r, i) => ({ id: 'p' + i, name: 'P' + i, rating: r }));
  const all = (s) => [].concat(...s.teams).sort().join(); const brute = (() => { let best = Infinity; const go = (left, teams) => { if (!left.length) { const a = teams.map((t) => (t[0].rating + t[1].rating) / 2); best = Math.min(best, Math.max(...a) - Math.min(...a)); return; } const [h, ...rest] = left; rest.forEach((x, i) => go(rest.filter((_, j) => j !== i), teams.concat([[h, x]]))); }; go(P8, []); return best; })();
  const bal = S(P8, { teamSize: 2 }); assert.strictEqual(bal[0].mode, 'balanced', 'Balanced is the default'); assert.ok(bal.length >= 2 && bal.length <= 3, 'ranked alternatives');
  assert.strictEqual(bal[0].spread, Math.round(brute), 'the top suggestion is the fairest possible split'); assert.ok(bal[0].spread <= bal[bal.length - 1].spread, 'best first');
  bal.forEach((s) => { assert.strictEqual(all(s), P8.map((p) => p.id).sort().join(), 'everyone exactly once'); assert.ok(s.teams.every((t) => t.length === 2)); assert.ok(typeof s.reason === 'string' && s.reason.length > 10 && !s.reason.includes('\n'), 'a one-line reason'); assert.strictEqual(s.notes.length, 4); });
  assert.ok(/Fairest split|Dead even/.test(bal[0].reason)); assert.strictEqual(new Set(bal.map((s) => JSON.stringify(s.teams.map((t) => t.slice().sort()).sort()))).size, bal.length, 'different splits');
  assert.deepStrictEqual(S(P8, { teamSize: 2 }), bal, 'same input, same answer');
  // Rotate: nobody repeats a recent partner
  const H = [['p0', 'p7'], ['p1', 'p6'], ['p2', 'p5'], ['p3', 'p4']].map((ids) => ({ ids, result: 'W', at: 1e12 })); const rot = S(P8, { mode: 'rotate', teamSize: 2, history: H });
  rot[0].teams.forEach((t) => assert.ok(!H.some((h) => h.ids.slice().sort().join() === t.slice().sort().join()), 'repeat pair ' + t)); assert.ok(/All new partners/.test(rot[0].reason));
  const P4 = P8.slice(0, 4), rot4 = S(P4, { mode: 'rotate', teamSize: 2, history: [{ ids: ['p0', 'p1'], result: 'W', at: 2e12 }, { ids: ['p0', 'p1'], result: 'L', at: 2e12 }, { ids: ['p0', 'p2'], result: 'W', at: 1e12 }, { ids: ['p0', 'p3'], result: 'W', at: 1e12 }, { ids: ['p0', 'p3'], result: 'W', at: 1e12 }, { ids: ['p0', 'p3'], result: 'W', at: 1e12 }] });
  assert.ok(rot4[0].teams.some((t) => t.includes('p0') && t.includes('p2')), 'the least-played partner'); assert.ok(/One repeat/.test(rot4[0].reason));
  // Hot pairs: best record together
  const hot = S(P8, { mode: 'hot', teamSize: 2, history: [].concat(Array(5).fill({ ids: ['p0', 'p1'], result: 'W' }), [{ ids: ['p0', 'p1'], result: 'L' }], Array(3).fill({ ids: ['p4', 'p6'], result: 'W' }), Array(4).fill({ ids: ['p2', 'p3'], result: 'L' })) });
  assert.ok(hot[0].teams.some((t) => t.includes('p0') && t.includes('p1')) && hot[0].teams.some((t) => t.includes('p4') && t.includes('p6')) && !hot[0].teams.some((t) => t.includes('p2') && t.includes('p3')), JSON.stringify(hot[0].teams)); assert.ok(/P0 \+ P1 are 5-1 as partners|P4 \+ P6 are 3-0 as partners/.test(hot[0].reason));
  assert.ok(/No results together yet/.test(S(P8, { mode: 'hot', teamSize: 2 })[0].reason));
  // odd counts, unknown ratings, teams of 4, junk
  const odd = S(P8.slice(0, 5).concat([{ id: 'n', name: 'New', rating: null }, { id: 'm', name: 'Mo' }]), { teamSize: 2 }); assert.strictEqual(odd[0].teams.length, 3); assert.strictEqual(odd[0].leftover.length, 1); assert.ok(/2 players have no rating yet/.test(odd.note));
  const four = S(P8, { teamSize: 4 }); assert.strictEqual(four[0].teams.length, 2); assert.ok(four[0].teams.every((t) => t.length === 4)); assert.ok(four[0].spread <= 25);
  assert.deepStrictEqual(S([], {}), []); assert.deepStrictEqual(S([{ id: 'a', name: 'A', rating: 1 }], { teamSize: 2 }), []); assert.strictEqual(S(P8, { mode: 'nonsense' })[0].mode, 'balanced');
};
T.p1EventStep = async () => {
  // history: Bob and Cy won twice together, Di and Ed lost twice together (a doubles heads-up event)
  let h = ok(await call('ann', 'create', base({ fmt: 'h2h', unit: 'doubles', playIn: false, endDay: '2026-11-19', title: 'Thursday doubles', self: true }))).event;
  for (const [a, b] of [['bob', 'cy'], ['di', 'ed']]) { h = ok(await call(a, 'join', { code: h.code, as: 'player', myName: cap1(a), entryName: cap1(a) + ' / ' + cap1(b) })).event; ok(await call(b, 'join', { code: h.code, as: 'player', myName: cap1(b), eid: h.entrants.find((x) => x.name.startsWith(cap1(a))).eid })); }
  NOW += 3 * HOUR; h = ok(await call('ann', 'get', { id: h.id })).event; const A = h.entrants.find((e) => e.name === 'Bob / Cy').eid, B = h.entrants.find((e) => e.name === 'Di / Ed').eid;
  for (let i = 0; i < 2; i++) { h = ok(await call('ann', 'challenge', { id: h.id, a: A, b: B })).event; const m = h.matches.find((x) => x.state === 'ready'); NOW += 60e3; h = ok(await call('ann', 'score', { id: h.id, m: m.id, games: [[11, 3]] })).event; }
  ok(await call('ann', 'finish', { id: h.id })); NOW += DAY; E._reset();
  // new doubles round robin: singles are NOT offered the step; doubles are
  const sing = ok(await call('ann', 'create', base({ title: 'Singles' }))).event; assert.strictEqual(sing.teams, false); no(await call('ann', 'partners', { id: sing.id }), 409);
  let ev = ok(await call('ann', 'create', base({ unit: 'doubles', playIn: false, title: 'Saturday doubles', self: true }))).event; const id = ev.id; assert.strictEqual(ev.teams, true);
  for (const [a, b] of [['bob', 'di'], ['cy', 'ed']]) { ev = ok(await call(a, 'join', { code: ev.code, as: 'player', myName: cap1(a), entryName: cap1(a) + ' / ' + cap1(b) })).event; ok(await call(b, 'join', { code: ev.code, as: 'player', myName: cap1(b), eid: ev.entrants.find((x) => x.name.startsWith(cap1(a))).eid })); }
  ev = ok(await call('ann', 'get', { id })).event; const before = JSON.stringify(ev.entrants.map((e) => e.players.map((p) => p.name)));
  const names = (s) => s.names.map((t) => t.slice().sort().join('+')).sort().join(' | ');
  const bal = ok(await call('ann', 'partners', { id })); assert.strictEqual(bal.mode, 'balanced', 'Balanced by default'); assert.strictEqual(bal.players, 4); assert.strictEqual(bal.history, 4);
  assert.ok(!/Bob\+Cy|Di\+Ed/.test(names(bal.suggestions[0])), 'winners (higher Oddable rating) split up: ' + names(bal.suggestions[0]) + ' ' + JSON.stringify(bal.suggestions[0].ratings)); assert.strictEqual(bal.suggestions[0].spread, 0);
  const rot = ok(await call('bob', 'partners', { id, mode: 'rotate' })); assert.ok(!/Bob\+Cy|Di\+Ed/.test(names(rot.suggestions[0])), 'a player may look too; no repeat of last time'); assert.ok(rot.suggestions[0].reason.length > 10);
  const hotRaw = await call('ann', 'partners', { id, mode: 'hot' }), hot = ok(hotRaw); assert.strictEqual(names(hot.suggestions[0]), 'Bob+Cy | Di+Ed'); assert.ok(/Bob \+ Cy are 2-0 as partners|Cy \+ Bob are 2-0 as partners/.test(hot.suggestions[0].reason), hot.suggestions[0].reason);
  assert.ok(!hotRaw.txt.includes('acct-') && !/"mk"/.test(hotRaw.txt));
  // it only suggests: nothing changed until the commissioner chooses
  ev = ok(await call('ann', 'get', { id })).event; assert.strictEqual(JSON.stringify(ev.entrants.map((e) => e.players.map((p) => p.name))), before, 'looking changes nothing');
  no(await call('bob', 'teams', { id, teams: hot.suggestions[0].teams }), 403, 'only the commissioner applies'); no(await call('ann', 'teams', { id, teams: [hot.suggestions[0].teams[0]] }), 400, 'everyone must be placed'); no(await call('ann', 'teams', { id, teams: [hot.suggestions[0].teams[0], hot.suggestions[0].teams[0]] }), 400);
  ev = ok(await call('ann', 'teams', { id, teams: hot.suggestions[0].teams, mode: 'hot' })).event; const en = (e) => e.name.split(' / ').sort().join(' / '); assert.deepStrictEqual(ev.entrants.map(en).sort(), ['Bob / Cy', 'Di / Ed']); assert.strictEqual(ev.entrants.length, 2); assert.strictEqual(ev.people, 5);
  assert.ok(ev.audit.some((a) => /Teams set: .*Suggest partners/.test(a.s))); const mine = ok(await call('cy', 'get', { id })).event; assert.strictEqual(mine.myEntries.length, 1); assert.strictEqual(en(mine.entrants.find((e) => e.eid === mine.myEntries[0])), 'Bob / Cy', 'accounts keep their seats');
  // locked at the start
  NOW = ev.start + 1000; no(await call('ann', 'teams', { id, teams: bal.suggestions[0].teams }), 409); assert.strictEqual(ok(await call('ann', 'partners', { id })).locked, true);
  ev = ok(await call('ann', 'get', { id })).event; assert.strictEqual(ev.matches.length, 1); assert.deepStrictEqual([ev.matches[0].an, ev.matches[0].bn].map((n) => n.split(' / ').sort().join(' / ')).sort(), ['Bob / Cy', 'Di / Ed']);
};

// ================= Playbook fixes (manager decisions, Nov 16 2026) =================
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// every match record carries oppRating / partnerRating; beating a higher-rated opponent gains more
T.pbEloUsesOpponentRatings = async () => {
  await playEvent('ann', ['bob', 'cy', 'di'], ['Di', 'Cy', 'Bob', 'Ann']); NOW += DAY; E._reset();
  const di = (await E.ratingFor('acct-di', 'pickleball')).oddable.rating, ann = (await E.ratingFor('acct-ann', 'pickleball')).oddable.rating; assert.ok(di > 1540 && ann < 1460, di + ' ' + ann);
  const first = (await E.statsFor('acct-di', {})).filter((r) => r.kind === 'match'); first.forEach((r) => { assert.ok(Array.isArray(r.extra.oppRating) && r.extra.oppRating.length === 1, 'oppRating on every match record'); assert.strictEqual(r.extra.fmt, 'singles'); assert.ok(!('partnerRating' in r.extra)); });
  assert.strictEqual(first.sort((a, b) => a.extra.at - b.extra.at)[0].extra.oppRating[0], null, 'a first-ever opponent has no rating yet (counted at 1500)'); assert.ok(first.some((r) => Number.isFinite(r.extra.oppRating[0])), 'later opponents carry their rating at that moment');
  // two new players (1500 each): Eve beats the top player, Fay beats the bottom player
  let ev = ok(await call('org', 'create', base({ fmt: 'h2h', playIn: false, myName: 'Org', title: 'Challenge night', endDay: dayOf(NOW + 3 * DAY), self: true }))).event; const id = ev.id;
  for (const o of ['eve', 'fay', 'di', 'ann']) ok(await call(o, 'join', { code: ev.code, as: 'player', myName: cap1(o) }));
  NOW += 3 * HOUR; ev = ok(await call('org', 'get', { id })).event; const eid = (n) => ev.entrants.find((e) => e.name === n).eid;
  for (const [a, b] of [['Eve', 'Di'], ['Fay', 'Ann']]) { ev = ok(await call('org', 'challenge', { id, a: eid(a), b: eid(b) })).event; const m = ev.matches.find((x) => x.state === 'ready'); NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: [[11, 9]] })).event; }
  E._reset(); const eve = (await E.ratingFor('acct-eve', 'pickleball')).oddable, fay = (await E.ratingFor('acct-fay', 'pickleball')).oddable;
  assert.ok(eve.rating > fay.rating, 'beating a higher-rated opponent gains more: Eve ' + eve.rating + ' v Fay ' + fay.rating); assert.ok(eve.rating - 1500 > 16 && fay.rating - 1500 < 16, 'more than half of K for the upset, less for the favourite');
  const rE = (await E.statsFor('acct-eve', {})).find((r) => r.kind === 'match'), rF = (await E.statsFor('acct-fay', {})).find((r) => r.kind === 'match');
  assert.deepStrictEqual(rE.extra.oppRating, [di]); assert.deepStrictEqual(rF.extra.oppRating, [ann]); assert.strictEqual(rE.extra.myRating, undefined, 'Eve had no rating before');
  const di2 = (await E.ratingFor('acct-di', 'pickleball')).oddable.rating, ann2 = (await E.ratingFor('acct-ann', 'pickleball')).oddable.rating; assert.ok(di - di2 > ann - ann2, 'and losing to a lower-rated player costs more');
  assert.strictEqual((await E.statsFor('acct-di', {})).find((r) => r.kind === 'match' && /Challenge night/.test(r.title)).extra.myRating, di);
  // doubles: both opponents and the partner
  let d = ok(await call('org', 'create', base({ fmt: 'h2h', unit: 'doubles', playIn: false, myName: 'Org', title: 'Doubles night', endDay: dayOf(NOW + 3 * DAY), self: true, start: NOW + 2 * HOUR }))).event;
  for (const [a, b] of [['di', 'eve'], ['ann', 'fay']]) { d = ok(await call(a, 'join', { code: d.code, as: 'player', myName: cap1(a), entryName: cap1(a) + ' / ' + cap1(b) })).event; ok(await call(b, 'join', { code: d.code, as: 'player', myName: cap1(b), eid: d.entrants.find((x) => x.name.startsWith(cap1(a))).eid })); }
  NOW += 3 * HOUR; d = ok(await call('org', 'get', { id: d.id })).event; d = ok(await call('org', 'challenge', { id: d.id, a: d.entrants[0].eid, b: d.entrants[1].eid })).event; ok(await call('org', 'score', { id: d.id, m: d.matches.find((x) => x.state === 'ready').id, games: [[11, 2]] }));
  const rD = (await E.statsFor('acct-di', {})).find((r) => r.kind === 'match' && r.extra.fmt === 'doubles'); assert.strictEqual(rD.extra.fmt, 'doubles'); assert.deepStrictEqual(rD.extra.oppRating.slice().sort(), [ann2, fay.rating].sort()); assert.strictEqual(rD.extra.partnerRating, eve.rating); assert.strictEqual(rD.extra.partner, 'Eve');
  assert.ok(!JSON.stringify(await E.statsFor('acct-di', {})).includes('acct-'));
  if (process.env.STATS_JS) for (const r of await E.statsFor('acct-di', {})) assert.ok(require(process.env.STATS_JS).validate(r, 'events').ok);
};
// round robin tiebreak: the pickleball rulebook order; never the seed; then the organizer's playoff or coin flip, logged
T.pbTiebreakRulebookOrder = async () => {
  const g = (a, b, x, y) => ({ id: a + b, st: 'pool', pool: 0, state: 'confirmed', a, b, games: [[x, y]], win: x > y ? 'a' : 'b' }), ents = (ids) => ids.map((eid) => ({ eid, name: eid }));
  const tbl = (ids, ms, seeds) => E.poolTable({ seeds: seeds || ids, entrants: ents(ids), matches: ms, pools: [ids], drawn: 1, fmt: 'rr' }, ids, 0);
  // step 4, head-to-head point differential: A, B, C 2-1 in a circle, all +6 overall; among the three C is +4, A and B -2 -> C, then A (beat B), then B.
  let M = [g('A', 'B', 11, 5), g('B', 'C', 11, 7), g('C', 'A', 11, 3), g('A', 'D', 11, 3), g('B', 'D', 11, 3), g('C', 'D', 11, 9)], t = tbl(['A', 'B', 'C', 'D'], M);
  assert.deepStrictEqual(t.slice(0, 3).map((r) => r.diff), [6, 6, 6]); assert.deepStrictEqual(t.map((r) => r.eid), ['C', 'A', 'B', 'D'], 'head-to-head differential (points scored would say C, B, A)');
  // step 5, differential against the next-highest entry: T beats everyone; A, B, C circle by the same score; all level overall; v T: A -2, B -4, C -6
  M = [g('A', 'B', 11, 5), g('B', 'C', 11, 5), g('C', 'A', 11, 5), g('T', 'A', 11, 9), g('T', 'B', 11, 7), g('T', 'C', 11, 5), g('A', 'D', 11, 9), g('B', 'D', 11, 7), g('C', 'D', 11, 5), g('T', 'D', 11, 0)];
  t = tbl(['C', 'B', 'A', 'T', 'D'], M); assert.deepStrictEqual(t.map((r) => r.eid), ['T', 'A', 'B', 'C', 'D'], 'closest to the top entry first, then head-to-head again (B beat C)'); assert.ok(t.every((r) => !r.tie));
  // nothing separates them: never the seed. Flagged as tied in both seed orders, same neutral order
  M = [g('A', 'B', 11, 5), g('B', 'C', 11, 5), g('C', 'A', 11, 5), g('A', 'D', 11, 5), g('B', 'D', 11, 5), g('C', 'D', 11, 5)];
  for (const seeds of [['A', 'B', 'C', 'D'], ['C', 'B', 'A', 'D']]) { t = tbl(['A', 'B', 'C', 'D'], M, seeds); assert.deepStrictEqual(t.map((r) => r.tie || null), ['A+B+C', 'A+B+C', 'A+B+C', null], 'tied rows are flagged, the seed decides nothing'); assert.deepStrictEqual(t.map((r) => r.eid), ['A', 'B', 'C', 'D']); }
  assert.strictEqual(E.openTies({ seeds: [], entrants: ents(['A', 'B', 'C', 'D']), matches: M, pools: [['A', 'B', 'C', 'D']], drawn: 1, fmt: 'rr' }).length, 1);
};
T.pbTiebreakOrganizerChoice = async () => {
  const mk = async (title) => { let ev = ok(await call('org', 'create', base({ playIn: false, myName: 'Org', title, seeding: 'manual', entry: 10, split: '60/30/10', entrants: [{ name: 'Gil' }, { name: 'Hy' }, { name: 'Ida' }] }))).event; const id = ev.id; ok(await call('zed', 'join', { code: ev.code, as: 'spectator', myName: 'Zed' }));
    NOW = ev.start + 1000; ev = ok(await call('org', 'get', { id })).event; const beat = { Gil: 'Hy', Hy: 'Ida', Ida: 'Gil' };
    for (let i = 0; i < 3; i++) { const m = ev.matches.find((x) => x.state === 'ready' && x.an && x.bn); NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: beat[m.an] === m.bn ? [[11, 5]] : [[5, 11]] })).event; } return ev; };
  // coin flip
  let ev = await mk('Circle one'); const id = ev.id; assert.ok(!ev.fin && !ev.placeRows, 'the event waits: no places from the seed'); assert.strictEqual(ev.ties.length, 1); assert.deepStrictEqual(ev.ties[0].names.slice().sort(), ['Gil', 'Hy', 'Ida']); assert.ok(ev.tables[0].every((r) => r.tie));
  no(await call('zed', 'tiebreak', { id, key: ev.ties[0].key, how: 'coin' }), 403, 'only the organizer'); no(await call('org', 'tiebreak', { id, key: ev.ties[0].key, how: 'dice' }), 400); no(await call('org', 'tiebreak', { id, key: 'X+Y', how: 'coin' }), 409);
  ev = ok(await call('org', 'tiebreak', { id, key: ev.ties[0].key, how: 'coin' })).event; assert.ok(ev.fin, 'finished once the tie is decided'); assert.strictEqual(ev.ties.length, 0); assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 2, 3]);
  const logLine = ev.audit.find((a) => /chose a coin flip\. Oddable flipped: /.test(a.s)); assert.ok(logLine && /Org \(commissioner\)/.test(logLine.who), 'logged with who chose'); assert.strictEqual(logLine.s.split('flipped: ')[1], ev.placeRows.map((r) => r.name).join(', then ')); assert.strictEqual(ev.tbLog[0].how, 'coin'); assert.ok(ev.tables[0].every((r) => r.tb === 'coin flip'));
  no(await call('org', 'tiebreak', { id, key: 'x', how: 'coin' }), 409, 'final after that');
  const orders = new Set(); for (let i = 0; i < 12; i++) { reset(); const e = await mk('Flip ' + i); orders.add(ok(await call('org', 'tiebreak', { id: e.id, key: e.ties[0].key, how: 'coin' })).event.placeRows[0].name); } assert.ok(orders.size > 1, 'a real flip, not the entry order: ' + [...orders]);
  // tiebreak playoff: stepladder of 2 matches for 3 tied entries
  reset(); ev = await mk('Circle two'); const id2 = ev.id; ev = ok(await call('org', 'tiebreak', { id: id2, key: ev.ties[0].key, how: 'game' })).event; assert.ok(!ev.fin); assert.strictEqual(ev.ties[0].matches, 2);
  let tm = ev.matches.filter((m) => m.st === 'tb'); assert.strictEqual(tm.length, 1); assert.strictEqual(tm[0].state, 'ready'); assert.strictEqual(ev.ties[0].game, tm[0].id); no(await call('org', 'tiebreak', { id: id2, key: ev.ties[0].key, how: 'coin' }), 409, 'no switching once the playoff is set');
  const sitting = ['Gil', 'Hy', 'Ida'].find((n) => n !== tm[0].an && n !== tm[0].bn), loser1 = tm[0].bn; NOW += 60e3; ev = ok(await call('org', 'score', { id: id2, m: tm[0].id, games: [[11, 8]] })).event;
  tm = ev.matches.filter((m) => m.st === 'tb'); assert.strictEqual(tm.length, 2, 'the winner plays the third entry'); assert.deepStrictEqual([tm[1].an, tm[1].bn].sort(), [sitting, tm[0].an].sort()); assert.ok(!ev.fin);
  const w2 = tm[1].an, l2 = tm[1].bn; NOW += 60e3; ev = ok(await call('org', 'score', { id: id2, m: tm[1].id, games: [[11, 8]] })).event; assert.ok(ev.fin); assert.deepStrictEqual(ev.placeRows.map((r) => r.name), [w2, l2, loser1]); assert.ok(ev.audit.some((a) => /chose a tiebreak playoff \(2 matches, order drawn at random\)/.test(a.s)));
  assert.ok(ev.tables[0].every((r) => r.w === 1 && r.l === 1), 'tiebreak matches do not change the pool records');
};
// bracket pick'em: lock time per round (auto-lock), lock button, picks locked on entry
T.pbPickemLocks = async () => {
  let ev = ok(await call('org', 'create', base({ fmt: 'se', playIn: false, myName: 'Org', pickem: true, seeding: 'manual', entrants: [{ name: 'A1' }, { name: 'B2' }, { name: 'C3' }, { name: 'D4' }] }))).event; const id = ev.id;
  for (const f of ['fan', 'pat']) ok(await call(f, 'join', { code: ev.code, as: 'spectator', myName: cap1(f) }));
  NOW = ev.start + 1000; ev = ok(await call('fan', 'get', { id })).event; const [s1, s2] = ev.matches.filter((m) => m.st === 'w' && m.r === 1), rk = ev.pickem.rounds.find((r) => /Round 1/.test(r.label)); assert.ok(rk && !rk.locked && rk.lockAt === null && rk.matches === 2);
  // locked on entry: server-stamped, cannot be changed or re-stamped; the same pick again is a harmless resend
  const t0 = NOW; ev = ok(await call('fan', 'pick', { id, m: s1.id, side: 'a' })).event; assert.deepStrictEqual(ev.pickem.mine[s1.id], { s: 'a', t: t0 }, 'stamped by the server clock');
  NOW += 5000; assert.ok(/locked/i.test(no(await call('fan', 'pick', { id, m: s1.id, side: 'b' }), 409, 'changing a pick').error)); ev = ok(await call('fan', 'pick', { id, m: s1.id, side: 'a', t: 1 })).event; assert.strictEqual(ev.pickem.mine[s1.id].t, t0, 'the first stamp stays');
  ok(await call('fan', 'pick', { id, tb: 30 })); no(await call('fan', 'pick', { id, tb: 31 }), 409, 'the tiebreak guess is locked on entry too'); ok(await call('fan', 'pick', { id, tb: 30 }));
  // lock time: only the commissioner, only in the future; auto-locks at that moment
  no(await call('fan', 'picklock', { id, round: rk.key, at: NOW + HOUR }), 403); no(await call('org', 'picklock', { id, round: rk.key, at: NOW - 1 }), 400); no(await call('org', 'picklock', { id, round: 'x|w|9', lock: true }), 404);
  const at = NOW + HOUR; ev = ok(await call('org', 'picklock', { id, round: rk.key, at })).event; assert.strictEqual(ev.pickem.rounds.find((r) => r.key === rk.key).lockAt, at); assert.ok(ev.audit.some((a) => /Round 1: picks lock at/.test(a.s)));
  NOW = at - 1000; ok(await call('pat', 'pick', { id, m: s1.id, side: 'b' }), 'one second before the lock');
  NOW = at; assert.ok(/locked/i.test(no(await call('pat', 'pick', { id, m: s2.id, side: 'a' }), 409, 'at the lock time, with no match started').error));
  ev = ok(await call('pat', 'get', { id })).event; const r1 = ev.pickem.rounds.find((r) => r.key === rk.key); assert.ok(r1.locked && r1.how === 'time'); assert.ok(!ev.pickem.open.includes(s2.id)); assert.deepStrictEqual(ev.pickem.counts[s1.id], { a: 1, b: 1 }, 'counts show once locked');
  no(await call('org', 'picklock', { id, round: rk.key, at: NOW + HOUR }), 409, 'a lock is never undone'); no(await call('org', 'picklock', { id, round: rk.key, lock: true }), 409);
  const poll = ok(await call('pat', 'get', { id, since: ev.u })); assert.ok(!poll.same, 'the 10-second refresh notices the lock time passing');
  // the lock button on the next round (the final), before anyone starts it
  for (const m of [s1, s2]) { NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: [[11, 4]] })).event; }
  const fin = ev.matches.find((m) => m.st === 'w' && m.r === 2), rf = ev.pickem.rounds.find((r) => /Round 2/.test(r.label)); ok(await call('fan', 'pick', { id, m: fin.id, side: 'a' }));
  ev = ok(await call('org', 'picklock', { id, round: rf.key, lock: true })).event; assert.ok(ev.pickem.rounds.find((r) => r.key === rf.key).how === 'button'); assert.ok(ev.audit.some((a) => /Round 2: picks locked now/.test(a.s) && /Org/.test(a.who)));
  no(await call('pat', 'pick', { id, m: fin.id, side: 'a' }), 409, 'locked by the button'); no(await call('pat', 'pick', { id, tb: 20 }), 409, 'the final is locked, so is the tiebreak');
};
// pairs / local teams as a Calcutta lot source with the started() hook; fail closed
T.pbCalcuttaSource = async () => {
  const SRC = {}, calcutta = { registerSource: (key, src) => { if (!src || typeof src.teams !== 'function') throw new Error('teams() is required'); if (typeof src.started !== 'function' && typeof src.startTime !== 'function') throw new Error('no started hook'); SRC[key] = src; } };
  let ev = ok(await call('org', 'create', base({ fmt: 'se', unit: 'doubles', playIn: false, myName: 'Org', seeding: 'manual', self: true, entrants: [{ name: 'Gil / Hy' }] }))).event; const id = ev.id;
  ev = ok(await call('bob', 'join', { code: ev.code, as: 'player', myName: 'Bob', entryName: 'Bob / Cy' })).event; ok(await call('cy', 'join', { code: ev.code, as: 'player', myName: 'Cy', eid: ev.entrants.find((x) => x.name === 'Bob / Cy').eid }));
  const key = E.ADAPTER.registerCalcutta(calcutta, id); assert.strictEqual(key, 'evt:' + id); const S = SRC[key]; assert.strictEqual(S.local, true, 'local lots: players of record, buy back half'); for (const f of ['teams', 'results', 'started', 'startTime']) assert.strictEqual(typeof S[f], 'function');
  const teams = await S.teams(); assert.deepStrictEqual(teams.map((t) => t.name).sort(), ['Bob / Cy', 'Gil / Hy']); const bc = teams.find((t) => t.name === 'Bob / Cy'), gh = teams.find((t) => t.name === 'Gil / Hy');
  assert.deepStrictEqual(bc.players, ['acct-bob', 'acct-cy'], 'players of record = the accounts in the pair (server side only)'); assert.ok(gh.players.every((p) => p.guest && p.name));
  assert.strictEqual(await S.started({ id: 'c1' }), false); assert.strictEqual(await S.startTime({}), ev.start); assert.deepStrictEqual(await S.results({}), {}, 'nothing has happened');
  NOW = ev.start - 1; assert.strictEqual(await S.started({}), false); NOW = ev.start; assert.strictEqual(await S.started({}), true, 'true the moment the start time is reached');
  NOW = ev.start + 1000; ev = ok(await call('org', 'get', { id })).event; ev = ok(await call('org', 'score', { id, m: ev.matches.find((m) => m.state === 'ready').id, games: [[11, 6]] })).event; assert.ok(ev.fin);
  const R = await S.results({}), champ = ev.placeRows[0].eid, other = ev.placeRows[1].eid; assert.deepStrictEqual({ wins: R[champ].wins, champ: R[champ].champ, out: R[champ].out, place: R[champ].place }, { wins: 1, champ: true, out: false, place: 1 }); assert.deepStrictEqual({ wins: R[other].wins, champ: R[other].champ, out: R[other].out, place: R[other].place }, { wins: 0, champ: false, out: true, place: 2 }); assert.strictEqual(R[champ].winT.length, 1);
  // an early draw counts as started before the start time
  let e2 = ok(await call('org', 'create', base({ fmt: 'se', playIn: false, myName: 'Org', title: 'Early', start: NOW + 5 * HOUR, entrants: [{ name: 'P' }, { name: 'Q' }] }))).event; const S2 = E.ADAPTER.calcuttaSource(e2.id); assert.strictEqual(await S2.started({}), false); ok(await call('org', 'draw', { id: e2.id })); assert.strictEqual(await S2.started({}), true); assert.ok((await S2.startTime({})) < e2.start, 'the start time moves up to the draw');
  // FAIL CLOSED: unknown / deleted event or a database error throws from every hook (the Calcutta engine keeps ownership locked on a throw); never "not started" on a guess
  const e3 = ok(await call('org', 'create', base({ fmt: 'se', playIn: false, myName: 'Org', title: 'Gone', start: NOW + 5 * HOUR, entrants: [{ name: 'P' }, { name: 'Q' }] }))).event, S3 = E.ADAPTER.calcuttaSource(e3.id); ok(await call('org', 'delete', { id: e3.id }));
  for (const src of [S3, E.ADAPTER.calcuttaSource('NOSUCHEVT1'), E.ADAPTER.calcuttaSource('')]) for (const f of ['teams', 'results', 'started', 'startTime']) await assert.rejects(() => src[f]({}), /not found/, f + ' must throw');
  const keep = D.S.dbGet; D.S.dbGet = async () => { throw new Error('db down'); }; await assert.rejects(() => S.started({})); await assert.rejects(() => S.startTime({})); D.S.dbGet = keep;
  assert.throws(() => E.ADAPTER.registerCalcutta({}, id), /registerSource/); assert.throws(() => E.ADAPTER.registerCalcutta(null, id));
  // one shared source keyed by the Calcutta's own reference
  const G = E.ADAPTER.calcuttaSource(); assert.strictEqual((await G.teams({ ref: id })).length, 2); assert.strictEqual(await G.started({ ref: id }), true);
};
// the people cap is the shared limits.maxPeople(limits.keyOf(account), gameId), not a ceiling of events' own
T.pbSharedLimits = async () => {
  const seen = [], keep = D.limits, fake = { keyOf: (e) => 'K(' + e + ')', ENTERPRISE_TEXT: 'SHARED TEXT', isEnterprise: async (k) => k === 'K(acct-club)', maxPeople: async (k, gid) => { seen.push([k, gid]); return k === 'K(acct-club)' ? 12 : gid === 'XTRA' ? 10 : 8; } };
  D.limits = () => fake;
  try {
    let ev = ok(await call('ann', 'create', base({ playIn: true, entrants: Array.from({ length: 7 }, (_, i) => ({ name: 'G' + i })) }))).event; assert.strictEqual(ev.cap, 8); assert.strictEqual(ev.ent, false); assert.deepStrictEqual(seen[0], ['K(acct-ann)', ''], 'asked with (keyOf(account), game id)');
    const r = no(await call('bob', 'join', { code: ev.code, as: 'spectator', myName: 'Bob' }), 403, 'the 9th person'); assert.ok(r.error.includes('8 people max') && r.error.includes('SHARED TEXT'), 'the shared wording'); assert.ok(seen.some((x) => x[0] === 'K(acct-ann)' && x[1] === ev.id), 'asked per game id (owner-granted extra seats)');
    no(await call('ann', 'create', base({ title: 'Nine', playIn: true, entrants: Array.from({ length: 8 }, (_, i) => ({ name: 'G' + i })) })), 403);
    // whatever maxPeople says is the cap: 12 for this Enterprise account, not events' own number
    ev = ok(await call('club', 'create', base({ title: 'Club', myName: 'Dana', playIn: false, entrants: Array.from({ length: 11 }, (_, i) => ({ name: 'G' + i })) }))).event; assert.strictEqual(ev.cap, 12); assert.strictEqual(ev.ent, true); no(await call('bob', 'join', { code: ev.code, as: 'spectator', myName: 'Bob' }), 403, 'the 13th person');
    no(await call('club', 'create', base({ title: 'Club 13', myName: 'Dana', playIn: false, entrants: Array.from({ length: 13 }, (_, i) => ({ name: 'G' + i })) })), 403);
    // extra seats are not Enterprise: no director ratings
    assert.ok(/Enterprise/.test(no(await call('ann', 'trate', { id: ok(await call('ann', 'create', base({ title: 'Std', playIn: false, entrants: [{ name: 'P' }, { name: 'Q' }] }))).event.id, gid: 'gX', rating: 1600, reason: 'no way' }), 403).error));
    // fail closed when the shared check cannot answer
    fake.maxPeople = async () => { throw new Error('limits down'); }; no(await call('ann', 'create', base({ title: 'Down' })), 500); fake.maxPeople = async () => NaN; no(await call('ann', 'create', base({ title: 'Down2' })), 503);
  } finally { D.limits = keep; }
  assert.strictEqual(D.limits(), E.LIMSTAND, 'this branch alone: the fallback with the same names'); for (const f of ['keyOf', 'maxPeople', 'isEnterprise']) assert.strictEqual(typeof E.LIMSTAND[f], 'function');
};
