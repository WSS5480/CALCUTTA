// Run: node odds-api/events.rev2.test.js [name ...]   Fixes for the second independent review (local-v1 @ab77696, "SHIP AFTER FIXES") + the manager's
// decisions on the open rules. Every check FAILS on ab77696 (EVJS=<ab77696 checkout>/odds-api/events.js node odds-api/events.rev2.test.js) and passes now.
// In-memory database, fake sign-in and clock, no network.
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), E = require(process.env.EVJS || './localevents'), D = E._deps;
const SRC = path.dirname(process.env.EVJS || path.join(__dirname, 'localevents.js')), CLIENT = fs.readFileSync(path.join(SRC, '../pics/localevents.js'), 'utf8');
let db = {};
D.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); return t.startsWith('t-') ? 'acct-' + t.slice(2) : null; } });
const ENT = new Set(); D.enterprise = async (k) => ENT.has(String(k).replace('acct-', ''));
let ipn = 0; D.ip = (req) => String(req.headers['x-ip'] || '7.' + (ipn % 250) + '.' + (Math.floor(ipn / 250) % 250) + '.' + (ipn++ % 251));
const Z = (s) => Date.parse(s), HOUR = 3600e3, DAY = 864e5; let NOW; D.now = () => NOW; const START = Z('2026-11-21T15:00:00Z');
const srv = http.createServer(async (req, res) => { if (!(await E.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P;
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/levents/' + op, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, ip ? { 'x-ip': ip } : {}), body: JSON.stringify(b || {}) }); return { s: r.status, j: JSON.parse(await r.text()) }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const no = (r, s, m) => { assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const base = (o) => Object.assign({ title: 'Rev2 test', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: START, to: 11, winBy: 2, bestOf: 1, seeding: 'manual', courts: 2, pools: 1, playoff: 0, entry: 0, split: 'none', take: { kind: 'none' }, myName: 'ann' }, o || {});
const reset = () => { db = {}; E._reset(); ENT.clear(); NOW = Z('2026-11-17T18:00:00Z'); };
const KIT = require('./localevents.testkit')({ E, D, ENT });
// any rating module through the one contract (events' stand-in here, the stats module in the merged build)
const seedR = (r) => (r.use == null ? 1500 : Math.round(r.use)), confR = (r) => (r.confirmedRating == null ? null : Math.round(r.confirmedRating));
const needs3 = async () => { try { const r = await D.rt().ratingFor('acct-nobody-here', 'pickleball'); return !!(r && r.makeup && Number(r.makeup.need) >= 3); } catch (e) { return false; } };
const T = {};
const only = process.argv.slice(2);
srv.listen(0, async () => {
  P = srv.address().port; let n = 0, fail = 0, skip = 0;
  for (const k of Object.keys(T)) { if (only.length && !only.includes(k)) continue; reset(); try { const r = await T[k](); if (r === 'skip') { skip++; console.log('  skipped', k); } else { n++; console.log('  ok', k); } } catch (e) { fail++; console.log('  FAIL', k, '-', process.env.TRACE ? e.stack : String(e.message).split('\n')[0].slice(0, 300)); } }
  console.log(fail ? '\nFAILED ' + fail + ' of ' + (n + fail) : '\nPASS ' + n + ' second-review checks' + (skip ? ' (' + skip + ' skipped)' : '')); srv.close(); process.exit(fail ? 1 : 0);
});
// ---------- helpers: every account is named like its token (ann = t-ann) ----------
const get = async (who, id) => ok(await call(who, 'get', { id })).event;
// an event with accounts: the first is the organizer and plays; started
// Old, active accounts (fourth review): a finished round robin among them, each score confirmed by the other side, so each has finished games of their own
// confirmed by another account (what the stats module asks of a confirmer). Played before the test's own events.
async function warm(names) { const t0 = NOW; NOW = Date.parse('2026-11-01T18:00:00Z'); let ev = ok(await call(names[0], 'create', base({ title: 'Warm-up', playIn: true, myName: names[0], start: NOW + 3600e3 }))).event; const id = ev.id;
  for (const p of names.slice(1)) ok(await call(p, 'join', { code: ev.code, myName: p })); NOW += 7200e3; ev = await get(names[0], id);
  for (const m of ev.matches.filter((x) => x.st === 'pool')) { NOW += 60e3; ok(await call(m.an, 'score', { id, m: m.id, games: [[11, 4]] })); ok(await call(m.bn, 'confirm', { id, m: m.id })); }
  ev = await get(names[0], id); if (ev.canFinish) ok(await call(names[0], 'finish', { id })); NOW = Math.max(t0, NOW + 3600e3); E._reset(); }
async function mk(names, o) {
  let ev = ok(await call(names[0], 'create', base(Object.assign({ playIn: true, myName: names[0] }, o)))).event; const id = ev.id, code = ev.code;
  for (const p of names.slice(1)) ok(await call(p, 'join', { code, myName: p }), 'join ' + p);
  NOW = START + 1000; return get(names[0], id);
}
// the first-listed side enters, the other side confirms (two accounts: the only kind of result that is rated)
async function playAcct(id, m, games) { NOW += 60e3; ok(await call(m.an, 'score', { id, m: m.id, games }), 'score by ' + m.an); return ok(await call(m.bn, 'confirm', { id, m: m.id }), 'confirm by ' + m.bn).event; }
async function playPool(id, who, f) { let ev = await get(who, id); for (const m of ev.matches.filter((x) => x.st === 'pool')) ev = await playAcct(id, m, [f(m.an, m.bn)]); return get(who, id); }
// ann beats everyone; bob > cat > dan > bob, all 11-9: three level on everything
const CYC = { 'bob|cat': 1, 'cat|dan': 1, 'dan|bob': 1 }, cyc = (a, b) => (a === 'ann' ? [11, 5] : b === 'ann' ? [5, 11] : CYC[a + '|' + b] ? [11, 9] : [9, 11]);
async function h2hMatch(id, x, y, games, eids) { NOW += 60e3; const ev = ok(await call(x, 'challenge', { id, a: eids[x], b: eids[y] })).event, m = ev.matches[ev.matches.length - 1]; ok(await call(y, 'accept', { id, m: m.id })); ok(await call(x, 'score', { id, m: m.id, games })); return ok(await call(y, 'confirm', { id, m: m.id })).event; }
const eidsOf = (ev) => { const o = {}; ev.entrants.forEach((e) => (o[e.name] = e.eid)); return o; };

// ================= 1 (HIGH) a tiebreak-playoff score corrected after the playoff bracket exists =================
T.r1TiebreakCorrectionRedrawsPlayoff = async () => {
  let ev = await mk(['ann', 'bob', 'cat', 'dan'], { playoff: 2 }); const id = ev.id; ev = await playPool(id, 'ann', cyc);
  assert.strictEqual(ev.ties.length, 1, 'three level for the second playoff spot'); ev = ok(await call('ann', 'tiebreak', { id, key: ev.ties[0].key, how: 'game' })).event;
  for (let i = 0; i < 2; i++) { const m = ev.matches.filter((x) => x.st === 'tb').find((x) => x.state === 'ready'); NOW += 60e3; ev = ok(await call('ann', 'score', { id, m: m.id, games: [[11, 7]] })).event; }
  const tb = ev.matches.filter((x) => x.st === 'tb'), last = tb[tb.length - 1], po = () => ev.matches.filter((x) => x.st === 'po');
  assert.strictEqual(po().length, 1); assert.deepStrictEqual([po()[0].an, po()[0].bn].sort(), ['ann', last.an].sort(), 'playoff: the pool winner v the tiebreak winner');
  // no playoff match played yet: the correction redraws the playoff from the corrected order
  ev = ok(await call('ann', 'score', { id, m: last.id, games: [[7, 11]] }), 'the commissioner corrects the last tiebreak match').event;
  assert.strictEqual(po().length, 1); assert.deepStrictEqual([po()[0].an, po()[0].bn].sort(), ['ann', last.bn].sort(), 'the playoff now has the corrected tiebreak winner (' + last.bn + ')');
  assert.ok(ev.audit.some((a) => /Tiebreak result corrected: playoff redrawn/.test(a.s)), 'logged');
  // once a playoff match has been played: refused, the refusal is logged, and the commissioner's reset route is the way
  const pm = po()[0]; ev = await playAcct(id, pm, [[11, 4]]);
  const r = await call('ann', 'score', { id, m: last.id, games: [[11, 7]] }); no(r, 409, 'correcting after the playoff started'); assert.ok(/reset/i.test(r.j.error), 'the message names the reset: ' + r.j.error);
  ev = await get('ann', id); assert.ok(ev.audit.some((a) => a.a === 'refused' && /playoff has started/.test(a.s)), 'the refusal and its reason are in the history');
  assert.deepStrictEqual([po()[0].an, po()[0].bn].sort(), ['ann', last.bn].sort(), 'nothing changed');
  no(await call('bob', 'poreset', { id, reason: 'wrong score' }), 403, 'only the commissioner resets'); no(await call('ann', 'poreset', { id, reason: '' }), 400, 'a reason is required');
  ev = ok(await call('ann', 'poreset', { id, reason: 'Tiebreak score typed the wrong way round' })).event; assert.strictEqual(po().length, 0, 'playoff wiped'); assert.ok(ev.poHold && !ev.fin);
  const seen = await get('dan', id); assert.ok(seen.notice && /reset the playoff: Tiebreak score typed/.test(seen.notice.text), 'every member gets the notice with the reason');
  ev = ok(await call('ann', 'score', { id, m: last.id, games: [[11, 7]] }), 'now the correction is taken').event; assert.strictEqual(po().length, 0, 'still held until the commissioner redraws');
  ev = ok(await call('ann', 'poredraw', { id })).event; assert.deepStrictEqual([po()[0].an, po()[0].bn].sort(), ['ann', last.an].sort(), 'redrawn from the corrected standings'); assert.strictEqual(po()[0].state, 'ready');
};

// ================= 2 (HIGH) rating farming =================
T.r2OnlyOpponentConfirmedMatchesAreRated = async () => {
  // (a) the organizer against a typed-in guest: the organizer's own entry is final, so it is never rated
  let ev = ok(await call('zed', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', playIn: true, myName: 'zed', entrants: [{ name: 'Ghost' }] }))).event; let id = ev.id; NOW = START + 1000; ev = await get('zed', id); let e = eidsOf(ev);
  for (let i = 0; i < 5; i++) { NOW += 60e3; ev = ok(await call('zed', 'challenge', { id, a: e.zed, b: e.Ghost })).event; const m = ev.matches[ev.matches.length - 1]; ev = ok(await call('zed', 'score', { id, m: m.id, games: [[11, 0]] })).event; assert.strictEqual(ev.matches.find((x) => x.id === m.id).state, 'confirmed'); }
  let rt = await E.ratingFor('acct-zed', 'pickleball'); for (const k of ['oddable', 'confirmedGames', 'event', 'setBy', 'use']) assert.ok(k in rt, 'ratingFor has ' + k);
  assert.deepStrictEqual([confR(rt), rt.confirmedGames, seedR(rt)], [null, 0, 1500], 'five wins over a typed-in guest move nothing'); if (KIT.standRatings) assert.deepStrictEqual([rt.oddable.rating, rt.oddable.matches, rt.use], [null, 5, 1500]);
  let recs = (await E.statsFor('acct-zed', {})).filter((x) => x.kind === 'match'); assert.strictEqual(recs.length, 5, 'they still appear as records'); assert.ok(recs.every((x) => x.verified === false && x.extra.confirmed === false && /no Oddable account/.test(x.extra.unrated)), 'marked unverified, with the reason');
  // (b) two accounts alone in a heads-up event: confirmed by the opponent, still not rated (fewer than 3 accounts)
  reset(); ev = await mk(['amy', 'ben'], { fmt: 'h2h', endDay: '2026-11-30' }); id = ev.id; e = eidsOf(ev); await h2hMatch(id, 'amy', 'ben', [[11, 3]], e);
  rt = await E.ratingFor('acct-amy', 'pickleball'); assert.strictEqual(rt.confirmedGames, 0, 'two accounts trading results are not rated'); recs = (await E.statsFor('acct-amy', {})).filter((x) => x.kind === 'match');
  if (KIT.standRatings) { assert.ok(/fewer than 3 accounts/.test(recs[0].extra.unrated)); assert.strictEqual(recs[0].extra.confirmed, false); }
  else { assert.strictEqual(recs[0].extra.confirmed, true, 'with the stats module events sends the fact (the opponent confirmed); stats does the counting (contract v1.4)'); assert.ok(rt.flags.some((f) => /unconfirmed/.test(f)), 'stats: not confirmed (one confirmer, new to Oddable games)'); }
  // (c) three accounts: rated, with what the stats module needs; at most 2 a day against the same opponent
  reset(); ev = await mk(['amy', 'ben', 'cal'], { fmt: 'h2h', endDay: '2026-11-30' }); id = ev.id; e = eidsOf(ev);
  for (let i = 0; i < 5; i++) await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); await h2hMatch(id, 'cal', 'amy', [[11, 9]], e); E._reset();
  recs = (await E.statsFor('acct-amy', {})).filter((x) => x.kind === 'match'); const vsBen = recs.filter((x) => x.opponent === 'ben');
  if (KIT.standRatings) { assert.deepStrictEqual(vsBen.map((x) => x.extra.confirmed), [true, true, false, false, false], 'the 3rd, 4th and 5th match against the same opponent that day are not rated'); assert.ok(/More than 2 matches/.test(vsBen[4].extra.unrated)); }
  else assert.deepStrictEqual(vsBen.map((x) => x.extra.confirmed), [true, true, true, true, true], 'with the stats module: the facts only; stats applies its own per-confirmer limits and the organizer approves');
  const one = vsBen[0]; assert.strictEqual(one.verified, true); assert.deepStrictEqual(one.extra.confirmedBy.name, 'ben', 'confirmedBy names the account on the other side'); assert.ok(Array.isArray(one.extra.oppRating) && one.extra.oppRating.length === 1 && /^a:[0-9a-f]{12}$/.test(one.extra.oppKey));
  rt = await E.ratingFor('acct-amy', 'pickleball', KIT.standRatings ? undefined : { casual: true }); if (KIT.standRatings) assert.deepStrictEqual([rt.confirmedGames, rt.oddable.matches], [3, 6], 'x of y: 3 of 6 confirmed'); else assert.strictEqual(rt.oddable.matches, 6, 'every game is in the full rating'); if (!KIT.standRatings) assert.ok(rt.use > 1500, 'casual: the full rating'); else if (await needs3()) assert.strictEqual(rt.use, null, 'two different confirmers: the module asks the organizer for a number'); else assert.ok(rt.use > 1500 && rt.use < 1535, 'two rated wins and one rated loss, not five wins: ' + rt.use);
  // "x of y games confirmed" travels with the rating to every screen
  NOW = Z('2026-11-17T18:00:00Z'); const e2 = ok(await call('amy', 'create', base({ title: 'Next', playIn: true, myName: 'amy', seeding: 'rating', start: Z('2026-12-05T15:00:00Z') }))).event;
  assert.deepStrictEqual(e2.entrants[0].players[0].odd, KIT.standRatings ? { rating: confR(rt), matches: 6, confirmed: 3 } : { rating: rt.oddable.rating, matches: 6, confirmed: rt.confirmedGames }, 'the seat shows what the rating module says (a free event: the full rating)'); assert.ok(/of ' \+ .*games? confirmed|games confirmed/.test(CLIENT), 'the screens print "x of y games confirmed"');
  // (d) a forfeit by the clock is not rated
  reset(); ev = await mk(['amy', 'ben', 'cal'], { fmt: 'ladder', endDay: '2026-12-20', reach: 3, expDays: 7, expire: 'forfeit' }); id = ev.id; e = eidsOf(ev);
  ok(await call('cal', 'challenge', { id, a: e.cal, b: e.ben })); NOW += 8 * DAY; ev = await get('amy', id); assert.ok(ev.matches[0].forfeit);
  recs = (await E.statsFor('acct-cal', {})).filter((x) => x.kind === 'match'); assert.deepStrictEqual([recs[0].result, recs[0].verified, recs[0].extra.confirmed], ['W', false, false]); assert.ok(/Forfeit/.test(recs[0].extra.unrated)); assert.strictEqual((await E.ratingFor('acct-cal', 'pickleball')).confirmedGames, 0);
};
T.r2TeamsRatedAgainstTheOpposingAverage = async () => {
  let ev = ok(await call('c1', 'create', base({ fmt: 'h2h', unit: 'teams', endDay: '2026-11-30', playIn: true, myName: 'c1', entryName: 'Reds' }))).event; const id = ev.id, code = ev.code;
  for (const p of ['c2', 'c3']) ok(await call(p, 'join', { code, myName: p, eid: ev.entrants[0].eid }));
  ev = ok(await call('d1', 'join', { code, myName: 'd1', entryName: 'Blues' })).event; const blue = ev.entrants.find((x) => x.name === 'Blues').eid; for (const p of ['d2', 'd3']) ok(await call(p, 'join', { code, myName: p, eid: blue }));
  NOW = START + 1000; ev = await get('c1', id); const e = eidsOf(ev); NOW += 60e3; ev = ok(await call('c1', 'challenge', { id, a: e.Reds, b: e.Blues })).event; const m = ev.matches[0]; ok(await call('d2', 'accept', { id, m: m.id })); ok(await call('c1', 'score', { id, m: m.id, games: [[11, 6]] })); ok(await call('d3', 'confirm', { id, m: m.id }));
  const r = (await E.statsFor('acct-c2', {})).find((x) => x.kind === 'match'); assert.strictEqual(r.extra.fmt, 'teams'); assert.deepStrictEqual(r.extra.oppRating, [1500], 'ONE number: the opposing team average (three new players = 1500)'); assert.strictEqual(r.extra.oppRatings.length, 3, 'three real opponents (the empty 4th spot is nobody)'); assert.strictEqual(r.extra.side.length, 3); assert.strictEqual(r.extra.confirmed, true);
};

// ================= 3 (G16) a locked pick survives leaving and rejoining =================
T.r3PickSurvivesLeaveAndRejoin = async () => {
  let ev = ok(await call('ann', 'create', base({ playIn: true, pickem: true, spectators: true }))).event; const id = ev.id, code = ev.code; for (const p of ['bob', 'cat', 'dan']) ok(await call(p, 'join', { code, myName: p })); ok(await call('sam', 'join', { code, myName: 'sam', as: 'spectator' }));
  NOW = START + 1000; ev = await get('sam', id); const m = ev.matches[0]; ev = ok(await call('sam', 'pick', { id, m: m.id, side: 'a' })).event; const stamp = ev.pickem.mine[m.id].t; ok(await call('sam', 'pick', { id, tb: 22 }));
  ok(await call('sam', 'leave', { id })); NOW += 60e3; ev = ok(await call('sam', 'join', { code, myName: 'sam', as: 'spectator' })).event;
  assert.deepStrictEqual(ev.pickem.mine[m.id], { s: 'a', t: stamp }, 'the pick is back, with its first server stamp'); assert.strictEqual(ev.pickem.tb, 22);
  no(await call('sam', 'pick', { id, m: m.id, side: 'b' }), 409, 'still locked: the other side is refused after leave + rejoin'); no(await call('sam', 'pick', { id, tb: 23 }), 409, 'so is the tiebreak guess');
};

// ================= 4 typed-in players can be marked paid; the pot counts every paid entrant =================
T.r4TypedInPlayersPaid = async () => {
  let ev = ok(await call('gus', 'create', base({ playIn: false, myName: 'gus', entry: 10, split: '100', entrants: [{ name: 'G1' }, { name: 'G2' }, { name: 'G3' }] }))).event; const id = ev.id;
  assert.strictEqual(ev.pot.players, 3, 'three players owe an entry; the organizer is not playing'); assert.strictEqual(ev.members[0].plays, false);
  no(await call('gus', 'paid', { id, pid: ev.members[0].pid, paid: true }), 409, 'a non-playing organizer owes no entry');
  const g1 = ev.entrants[0].players[0], g2 = ev.entrants[1].players[0]; ev = ok(await call('gus', 'paid', { id, gid: g1.gid, paid: true })).event; ev = ok(await call('gus', 'paid', { id, gid: g2.gid, paid: true })).event;
  assert.deepStrictEqual([ev.pot.paid, ev.pot.total, ev.pot.pool], [2, 20, 20], 'the pot counts the typed-in players marked paid'); assert.deepStrictEqual(ev.entrants.map((x) => x.players[0].paid), [true, true, false]); assert.ok(ev.audit.some((a) => /G1 \(typed-in player\) marked paid/.test(a.s)));
  no(await call('gus', 'paid', { id, gid: 'gNOPE1234', paid: true }), 404); ok(await call('kim', 'join', { code: ev.code, myName: 'kim', as: 'spectator' })); no(await call('kim', 'paid', { id, gid: g1.gid, paid: false }), 403, 'only the organizer');
  ev = ok(await call('gus', 'paid', { id, gid: g2.gid, paid: false })).event; assert.strictEqual(ev.pot.paid, 1);
  // a paid typed-in player who claims the seat stays paid
  ev = ok(await call('liz', 'claim', { claim: g1.claim, myName: 'liz' })).event; assert.strictEqual(ev.pot.paid, 1); assert.strictEqual(ev.members.find((x) => x.name === 'liz').paid, true);
  assert.ok(/data-gid="' \+ att\(p\.gid\)[^;]*Mark paid|a === 'paid' \|\| a === 'unpaid'[^\n]*gid/.test(CLIENT), 'the People card has Mark paid for typed-in players');
};

// ================= 5 public invite preview: no shared bucket; a 200-invite league blast works =================
T.r5InviteBlast = async () => {
  ENT.add('club'); const ev = ok(await call('club', 'create', base({ playIn: false, myName: 'club' }))).event, code = ev.code; let bad = 0;
  for (let i = 0; i < 200; i++) { const r = await call('', 'peek', { code }, '50.' + (i % 200) + '.0.9'); if (r.s !== 200) bad++; } assert.strictEqual(bad, 0, bad + ' of 200 signed-out previews from 200 phones were refused');
  bad = 0; for (let i = 0; i < 200; i++) { const r = await call('inv' + i, 'preview', { code }, '60.' + (i % 200) + '.0.9'); if (r.s !== 200) bad++; } assert.strictEqual(bad, 0, bad + ' of 200 signed-in invite previews were refused');
  bad = 0; for (let i = 0; i < 150; i++) { const r = await call('inv' + i, 'join', { code, myName: 'P' + i, as: 'spectator' }, '9.9.9.9'); if (r.s !== 200) bad++; } assert.strictEqual(bad, 0, bad + ' of 150 joins from ONE club Wi-Fi address were refused');
  // still limited per address, and guessing codes is still blocked
  let lim = 0; for (let i = 0; i < 60; i++) { const r = await call('', 'peek', { code, dev: 'one-phone-0001' }, '70.0.0.1'); if (r.s === 429) lim++; } assert.ok(lim >= 15, /* third review: counted per phone and code (30 / 10 min); the IP limit is sized for a club on one Wi-Fi */ 'one address hammering the preview is slowed down (' + lim + ')'); ok(await call('', 'peek', { code }, '70.0.0.2'), 'and nobody else is');
  let blocked = 0; for (let i = 0; i < 14; i++) { const r = await call('', 'peek', { code: 'ZZZZ-ZZ' + String(10 + i), dev: 'one-phone-0002' }, '80.0.0.1'); if (r.s === 429) blocked++; } assert.ok(blocked >= 3, 'wrong codes: blocked after 10');
};

// ================= 6 a failed early draw must not lock the director's ratings =================
T.r6FailedDrawLocksNothing = async () => {
  ENT.add('club'); let ev = ok(await call('club', 'create', base({ playIn: false, myName: 'Dir', seeding: 'rating', entrants: [{ name: 'Solo1' }] }))).event; const id = ev.id, rid = KIT.standRatings ? id : 'evt:' + id; // stats v1.5: prefixed ids
  no(await call('club', 'draw', { id }), 409, 'one entry: no draw'); ok(await call('bob', 'join', { code: ev.code, myName: 'bob' })); no(await call('bob', 'draw', { id }), 403);
  ev = await get('club', id); ev = ok(await call('club', 'trate', { id, gid: ev.entrants[0].players[0].gid, rating: 1700, reason: 'Seed him second' }), 'the director can still set a rating: the event has not started').event;
  assert.strictEqual(ev.entrants[0].players[0].trn.v, 1700); assert.ok(db['lock:evr:' + rid].data.lockAt >= START, 'the rating module still locks at the start');
  NOW += HOUR; ev = ok(await call('club', 'draw', { id })).event; assert.ok(ev.drawn); if (KIT.standRatings) assert.ok(db['lock:evr:' + rid].data.lockAt <= NOW, 'a draw that happened locks the ratings'); /* stats.js eventSetup cannot move its start earlier (HANDOFF, merge notes); the route below refuses either way */ no(await call('club', 'trate', { id, gid: ev.entrants[0].players[0].gid, rating: 1800, reason: 'too late' }), 409);
};

// ================= 7 statsFor order: date, then entry time, then id =================
T.r7StatsOrder = async () => {
  let ev = await mk(['amy', 'ben', 'cal', 'dee'], { fmt: 'h2h', endDay: '2026-11-30' }); const id = ev.id, e = eidsOf(ev);
  for (let i = 0; i < 9; i++) await h2hMatch(id, 'amy', ['ben', 'cal', 'dee'][i % 3], [[11, i]], e);
  const recs = (await E.statsFor('acct-amy', {})).filter((x) => x.kind === 'match'); assert.strictEqual(recs.length, 9); assert.strictEqual(new Set(recs.map((x) => x.date)).size, 1, 'all the same day');
  assert.deepStrictEqual(recs.map((x) => x.extra.at), recs.map((x) => x.extra.at).slice().sort((a, b) => a - b), 'in the order they were played, not by id'); assert.deepStrictEqual(recs.map((x) => x.extra.games[0][1]), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
};

// ================= 8 standings: no "H2H undefined"; only the tiebreak steps really used =================
T.r8StandingsShowStepsUsed = async () => {
  const g = (a, b, x, y) => ({ id: a + b, st: 'pool', pool: 0, state: 'confirmed', a, b, games: [[x, y]], win: x > y ? 'a' : 'b' }), tbl = (ids, ms) => E.poolTable({ entrants: ids.map((eid) => ({ eid, name: eid })), matches: ms, pools: [ids], drawn: 1, fmt: 'rr', rules: {}, money: { entry: 0, split: 'none' } }, ids, 0);
  // E and F level on wins: F beat E. G and H are alone on their wins: no tiebreak step touched them.
  let t = tbl(['E', 'F', 'G', 'H'], [g('F', 'E', 11, 9), g('E', 'G', 11, 0), g('E', 'H', 11, 0), g('F', 'G', 11, 9), g('H', 'F', 11, 9), g('G', 'H', 11, 9), g('E', 'F', 0, 0)].slice(0, 6));
  const row = (n) => t.find((r) => r.eid === n); assert.deepStrictEqual(t.slice(0, 2).map((r) => r.eid), ['F', 'E']); assert.deepStrictEqual(row('F').steps, ['head-to-head']); assert.deepStrictEqual(row('E').steps, ['head-to-head']);
  // a circle split by point differential, then the two left start over at head-to-head
  t = tbl(['A', 'B', 'C', 'D'], [g('A', 'B', 11, 2), g('B', 'C', 11, 9), g('C', 'A', 11, 9), g('A', 'D', 11, 0), g('B', 'D', 11, 9), g('C', 'D', 11, 0)]);
  assert.deepStrictEqual(t.map((r) => r.eid), ['A', 'B', 'C', 'D']); assert.deepStrictEqual(row('A').steps, ['point differential']); assert.deepStrictEqual(row('B').steps, ['point differential', 'head-to-head']); assert.strictEqual(row('D').steps, undefined, 'no step shown for an entry that was never tied');
  assert.ok(!/H2H ' \+ r\.h2h/.test(CLIENT) && /r\.steps/.test(CLIENT), 'the standings screen prints the steps used, never "H2H undefined"');
};

// ================= 9 prize split to the cent; an unpaid player's record shows no entry spent =================
T.r9PrizesSumToTheCent = async () => {
  const ps = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']; let ev = ok(await call('p1', 'create', base({ fmt: 'se', unit: 'doubles', entry: 5, split: '60/30/10', take: { kind: 'pct', v: 15 }, playIn: true, myName: 'p1', entryName: 'T1' }))).event; const id = ev.id, code = ev.code;
  ok(await call('p2', 'join', { code, myName: 'p2', eid: ev.entrants[0].eid }));
  for (let t = 2; t <= 4; t++) { ev = ok(await call(ps[2 * t - 2], 'join', { code, myName: ps[2 * t - 2], entryName: 'T' + t })).event; ok(await call(ps[2 * t - 1], 'join', { code, myName: ps[2 * t - 1], eid: ev.entrants.find((x) => x.name === 'T' + t).eid })); }
  ev = await get('p1', id); for (const m of ev.members.filter((x) => x.name !== 'p8')) ok(await call('p1', 'paid', { id, pid: m.pid, paid: true }));
  NOW = START + 1000; for (let g = 0; g < 6; g++) { ev = await get('p1', id); const m = ev.matches.find((x) => x.state === 'ready'); if (!m) break; const who = (eid) => ev.entrants.find((x) => x.eid === eid).players[0].name; NOW += 60e3; ok(await call(who(m.a), 'score', { id, m: m.id, games: [[11, 4]] })); ok(await call(who(m.b), 'confirm', { id, m: m.id })); }
  ev = await get('p1', id); assert.ok(ev.fin); assert.strictEqual(ev.pot.pool, 29.75, '7 paid x $5 less 15%'); assert.strictEqual(Math.round(ev.pot.places.reduce((t, x) => t + x.amt * 100, 0)), 2975, 'the three prizes add up to the pool (leftover cent to 1st)'); assert.strictEqual(ev.pot.places[0].amt, 17.86);
  let sum = 0; const rec = {}; for (const p of ps) { rec[p] = (await E.statsFor('acct-' + p, {})).find((x) => x.kind === 'event'); sum += Math.round(rec[p].won * 100); }
  assert.strictEqual(sum, 2975, 'what the eight players are owed adds up to the prize pool to the cent (was ' + sum + ')');
  assert.ok(!('stake' in rec.p8) && rec.p8.extra.entry === 0 && rec.p8.extra.owed === 5 && rec.p8.extra.paid === false, 'p8 was never marked paid: no entry spent, $5 shown as owed'); assert.strictEqual(rec.p8.pl, rec.p8.won, 'net = prize, nothing spent');
  assert.deepStrictEqual([rec.p1.stake, rec.p1.extra.entry, rec.p1.extra.paid], [5, 5, true]); assert.strictEqual(Math.round((rec.p1.won - 5) * 100), Math.round(rec.p1.pl * 100));
  const loser = ps.find((p) => rec[p].place.n > 2 && p !== 'p8' && rec[p].won < 1); if (loser) assert.ok('won' in rec[loser]);
  // a finished play that paid nothing says won: 0 (stats contract v1.1)
  reset(); ev = await mk(['amy', 'ben'], { fmt: 'se' }); await playAcct(ev.id, ev.matches.find((x) => x.state === 'ready'), [[11, 2]]); const r2 = (await E.statsFor('acct-ben', {})).find((x) => x.kind === 'event'); assert.strictEqual(r2.won, 0); assert.ok(!('stake' in r2));
};

// ================= 10 smaller items =================
T.r10aGrandFinalPaysMost = async () => {
  const M = E.buildElim(16, 'x', true).M, evt = { rules: { weight: 'round' }, matches: M }, pts = (f) => Math.max(...M.filter(f).map((m) => E.pickPoints(evt, m)));
  const gf = E.pickPoints(evt, M.find((m) => m.st === 'gf' && !m.reset)), w = pts((m) => m.st === 'w'), l = pts((m) => m.st === 'l');
  assert.ok(gf > w && gf > l, 'grand final ' + gf + ' v winners final ' + w + ' v losers final ' + l); assert.strictEqual(E.pickPoints(evt, M.find((m) => m.reset)), gf); assert.strictEqual(E.pickPoints({ rules: { weight: 'flat' }, matches: M }, M[0]), 1);
};
T.r10bLockMessageSaysWhichLock = async () => {
  let ev = ok(await call('pk', 'create', base({ fmt: 'se', pickem: true, playIn: false, myName: 'pk', entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; const id = ev.id; ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' }));
  NOW = START + 1000; ev = await get('pk', id); const rk = ev.pickem.rounds[0].key; ok(await call('pk', 'picklock', { id, round: rk, at: NOW + 600e3 })); NOW += 601e3;
  let r = no(await call('fan', 'pick', { id, m: ev.matches[0].id, side: 'a' }), 409); assert.ok(/closing time/.test(r.error) && !/lock/i.test(r.error), 'closing time: ' + r.error);
  reset(); ev = ok(await call('pk', 'create', base({ fmt: 'se', pickem: true, playIn: false, myName: 'pk', entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' })); NOW = START + 1000; ev = await get('pk', ev.id);
  ok(await call('pk', 'picklock', { id: ev.id, round: ev.pickem.rounds[0].key, lock: true })); r = no(await call('fan', 'pick', { id: ev.id, m: ev.matches[0].id, side: 'a' }), 409); assert.ok(/closed by the commissioner/.test(r.error) && !/lock/i.test(r.error), 'commissioner closed it: ' + r.error);
  reset(); ev = ok(await call('pk', 'create', base({ fmt: 'se', pickem: true, playIn: false, myName: 'pk', entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' })); NOW = START + 1000; ev = await get('pk', ev.id);
  ok(await call('pk', 'live', { id: ev.id, m: ev.matches[0].id })); r = no(await call('fan', 'pick', { id: ev.id, m: ev.matches[1].id, side: 'a' }), 409); assert.ok(/first match started/.test(r.error), 'play lock: ' + r.error);
};
T.r10cSideOutIsTheDefault = async () => {
  const b = base({ playIn: true }); delete b.scoring; assert.strictEqual(ok(await call('ann', 'create', b)).event.rules.scoring, 'sideout', 'no choice sent = side-out');
  assert.strictEqual(ok(await call('ann', 'create', base({ title: 'Rally', playIn: true, scoring: 'rally' }))).event.rules.scoring, 'rally', 'rally is the option');
  assert.ok(/scoring: 'sideout'/.test(CLIENT) && /\[\['sideout', 'Side-out scoring[^\]]*'\], \['rally'/.test(CLIENT), 'the create form defaults to side-out and lists rally second');
};
T.r10dSuggestPartnersShowsBothRatings = async () => {
  ENT.add('club'); let ev = ok(await call('club', 'create', base({ unit: 'doubles', playIn: false, myName: 'Dir', seeding: 'rating', entrants: [{ name: 'Al / Bo' }, { name: 'Cy / Di' }] }))).event; const id = ev.id, al = ev.entrants[0].players[0];
  ok(await call('club', 'trate', { id, gid: al.gid, rating: 1800, reason: 'Club champion' })); const r = ok(await call('club', 'partners', { id }));
  const a = r.ratings.find((x) => x.id === al.gid), b = r.ratings.find((x) => x.name === 'Bo'); assert.deepStrictEqual([a.use, a.tournament, a.oddable, a.confirmed, a.matches], [1800, 1800, null, 0, 0], 'the tournament rating is used and the real one is beside it'); assert.deepStrictEqual([b.use, b.tournament], [null, null]);
  assert.ok(/Tournament rating used/.test(CLIENT), 'the screen says when a tournament rating is used');
};
T.r10eHelpTextPerSport = async () => {
  assert.ok(/const infoFor = /.test(CLIENT), 'help text is built per sport'); const m = /const infoFor = [\s\S]*?\n  \};/.exec(CLIENT); assert.ok(m);
  const INFO = new Function('SPORTN', m[0].replace('const infoFor =', 'return') )({ pickleball: 'Pickleball', tennis: 'Tennis', cornhole: 'Cornhole' });
  assert.ok(/pickleball rulebook/.test(INFO('rr', 'pickleball')) && !/pickleball rulebook/.test(INFO('rr', 'tennis')), 'only pickleball cites the pickleball rulebook'); assert.ok(/Oddable rating/.test(INFO('se', 'pickleball')) && /typed rating/.test(INFO('se', 'cornhole')), 'seeding help matches the sport');
  assert.ok(/one game to 15/.test(INFO('de', 'pickleball', { reset: 'game15' })) && /full match/.test(INFO('de', 'pickleball', { reset: 'match' })) && /full match/.test(INFO('de', 'tennis')), 'the reset rule in force is named');
};
T.r10fPairWithEmptySpotCannotStart = async () => {
  let ev = ok(await call('ann', 'create', base({ unit: 'doubles', playIn: true, myName: 'ann', entryName: 'Team Ann', entrants: [{ name: 'Bea / Cy' }, { name: 'Di / Ed' }] }))).event; const id = ev.id, mine = ev.myEntries[0];
  assert.ok(ev.hold && ev.hold.names.length === 1, 'the entry with an empty partner spot is flagged'); const r = no(await call('ann', 'draw', { id }), 409, 'an early draw'); assert.ok(/empty partner spot/.test(r.error));
  NOW = START + 1000; ev = await get('ann', id); assert.ok(!ev.drawn && ev.hold.late, 'the start time alone does not start it'); assert.strictEqual(ev.matches.length, 0);
  no(await call('ann', 'entrant', { id, do: 'add', name: 'Late / Pair' }), 409, 'rules stay locked'); no(await call('ann', 'entrant', { id, do: 'remove', eid: ev.entrants[1].eid }), 409, 'a complete pair cannot be removed after the start');
  ev = ok(await call('ann', 'entrant', { id, do: 'partner', eid: mine, name: 'Flo' }), 'the commissioner names the partner').event; assert.ok(ev.drawn && !ev.hold, 'now it starts'); assert.strictEqual(ev.matches.length, 3); assert.ok(ev.entrants.find((x) => x.eid === mine).players.some((p) => p.name === 'Flo' && p.guest && !p.blank));
};
T.r10hClaimCodeCannotAddASecondEntry = async () => {
  let ev = ok(await call('ann', 'create', base({ playIn: true, entrants: [{ name: 'G1' }, { name: 'G2' }] }))).event; const id = ev.id; ok(await call('p1', 'join', { code: ev.code, myName: 'p1' }));
  const r = no(await call('p1', 'claim', { claim: ev.entrants.find((x) => x.name === 'G1').players[0].claim }), 409, 'a player with an entry claims a second seat'); assert.ok(/One account, one entry/.test(r.error));
  no(await call('ann', 'claim', { claim: ev.entrants.find((x) => x.name === 'G2').players[0].claim }), 409, 'the playing organizer too'); ev = await get('p1', id); assert.strictEqual(ev.myEntries.length, 1);
  ok(await call('s1', 'join', { code: ev.code, myName: 's1', as: 'spectator' })); ev = ok(await call('s1', 'claim', { claim: (await get('ann', id)).entrants.find((x) => x.name === 'G1').players[0].claim }), 'a spectator may claim').event; assert.strictEqual(ev.myEntries.length, 1);
};

// ================= 11 manager decisions on the open rules =================
T.r11aPlayersCannotPickTheirOwnMatches = async () => {
  let ev = await mk(['ann', 'bob', 'cat', 'dan'], { pickem: true }); const id = ev.id; ev = await get('bob', id); const own = ev.matches.find((m) => m.mine), other = ev.matches.find((m) => !m.mine && m.r === own.r);
  const r = no(await call('bob', 'pick', { id, m: own.id, side: own.mine === 'a' ? 'b' : 'a' }), 403, 'a player picks against himself'); assert.ok(/playing in this match/.test(r.error)); no(await call('bob', 'pick', { id, m: own.id, side: own.mine }), 403, 'or for himself');
  assert.ok(!ev.pickem.open.includes(own.id) && ev.pickem.own.includes(own.id) && ev.pickem.open.includes(other.id), 'own matches are not offered'); ok(await call('bob', 'pick', { id, m: other.id, side: 'a' }), 'other matches are fine');
};
T.r11bTiesThatTouchNothingShareThePlace = async () => {
  // free event: bob, cat, dan level behind ann. No prize, no playoff: nothing waits, they share 2nd
  let ev = await mk(['ann', 'bob', 'cat', 'dan'], {}); let id = ev.id; ev = await playPool(id, 'ann', cyc);
  assert.strictEqual(ev.ties.length, 0, 'no organizer decision needed'); assert.ok(ev.canFinish && !ev.fin); assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 2, 2, 2], 'shared 2nd place'); assert.ok(ev.tables[0].slice(1).every((r) => r.shared && r.rank === 2));
  // the same results with prizes for 1st-3rd: the tie touches prize money, so it waits; coin flip is the default
  reset(); ev = await mk(['ann', 'bob', 'cat', 'dan'], { entry: 10, split: '60/30/10' }); id = ev.id; ev = await playPool(id, 'ann', cyc); assert.strictEqual(ev.ties.length, 1); assert.ok(!ev.canFinish && !ev.placeRows); no(await call('ann', 'finish', { id }), 409, 'cannot finish over an open prize tie');
  ev = ok(await call('ann', 'tiebreak', { id, key: ev.ties[0].key }), 'no choice sent = the default').event; assert.strictEqual(ev.tbLog[0].how, 'coin'); assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 2, 3, 4]);
  // prizes for 1st only and a tie for 2nd-4th: touches nothing
  reset(); ev = await mk(['ann', 'bob', 'cat', 'dan'], { entry: 10, split: '100' }); ev = await playPool(ev.id, 'ann', cyc); assert.strictEqual(ev.ties.length, 0); assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 2, 2, 2]);
  // the playoff choice for 3+ entries is labelled a house rule and the drawn order is logged
  reset(); ev = await mk(['ann', 'bob', 'cat', 'dan'], { playoff: 2 }); id = ev.id; ev = await playPool(id, 'ann', cyc); ev = ok(await call('ann', 'tiebreak', { id, key: ev.ties[0].key, how: 'game' })).event;
  const line = ev.audit.find((a) => a.a === 'tiebreak' && /House rule \(not in the rulebook\): playoff, order drawn at random: /.test(a.s)); assert.ok(line, 'house rule + order in the history'); const order = line.s.split('at random: ')[1].split(' (')[0].split(', then '); assert.deepStrictEqual(order.slice().sort(), ['bob', 'cat', 'dan']);
  const first = ev.matches.find((m) => m.st === 'tb'); assert.deepStrictEqual([first.an, first.bn], [order[1], order[2]], 'the last two drawn play first');
  assert.ok(/House rule: playoff, order drawn at random/.test(CLIENT) && /Coin flip \(default\)/.test(CLIENT));
};
T.r11cRoundRobinFinishButton = async () => {
  let ev = await mk(['ann', 'bob', 'cat'], {}); const id = ev.id; ev = await playPool(id, 'ann', (a, b) => (a < b ? [11, 5] : [5, 11]));
  assert.ok(!ev.fin && ev.canFinish && ev.final === false, 'the last confirmed score does not end it'); assert.strictEqual(ev.placeRows[0].name, 'ann');
  const last = ev.matches.find((m) => !m.mine); ev = ok(await call('ann', 'score', { id, m: last.id, games: last.win === 'a' ? [[3, 11]] : [[11, 3]] }), 'the organizer can still correct the last score').event; assert.ok(!ev.fin);
  no(await call('bob', 'finish', { id }), 403); ev = ok(await call('ann', 'finish', { id })).event; assert.ok(ev.fin && ev.final); no(await call('ann', 'score', { id, m: last.id, games: [[11, 3]] }), 409, 'final after Finish');
  assert.ok(/data-a="finish"[^\n]*Finish the round robin/.test(CLIENT), 'Finish button on the round robin screen');
  // not tapped: it finishes by itself 12 hours after the last result (nothing hangs open)
  reset(); ev = await mk(['ann', 'bob', 'cat'], {}); ev = await playPool(ev.id, 'ann', (a, b) => (a < b ? [11, 5] : [5, 11])); NOW += 11 * HOUR; assert.ok(!(await get('bob', ev.id)).fin); NOW += 2 * HOUR; const r = ok(await call('bob', 'get', { id: ev.id, since: ev.u })); assert.ok(r.event && r.event.fin, 'auto-finish after 12 hours, seen by the 10-second refresh');
};
T.r11dDoubleEliminationReset = async () => {
  const play = async (reset0) => { let ev = ok(await call('ann', 'create', base({ title: 'DE ' + reset0, fmt: 'de', playIn: false, reset: reset0, entrants: ['D1', 'D2'].map((n) => ({ name: n })) }))).event; const id = ev.id; ev = ok(await call('ann', 'draw', { id })).event;
    for (let g = 0; g < 4; g++) { const m = ev.matches.find((x) => x.state === 'ready' && !x.reset); if (!m) break; NOW += 60e3; ev = ok(await call('ann', 'score', { id, m: m.id, games: m.st === 'gf' ? [[5, 11]] : [[11, 5]] })).event; } return ev; };
  let ev = await play(undefined); assert.strictEqual(ev.rules.reset, 'game15', 'default: one tiebreak game to 15'); let gf2 = ev.matches.find((m) => m.reset); assert.strictEqual(gf2.state, 'ready'); assert.deepStrictEqual(gf2.rule, { to: 15, winBy: 2, bestOf: 1 });
  let r = no(await call('ann', 'score', { id: ev.id, m: gf2.id, games: [[11, 5]] }), 400, 'a game to 11 is not the reset game'); assert.ok(/needs 15/.test(r.error)); ev = ok(await call('ann', 'score', { id: ev.id, m: gf2.id, games: [[15, 13]] })).event; assert.ok(ev.fin);
  reset(); ev = await play('match'); assert.strictEqual(ev.rules.reset, 'match'); gf2 = ev.matches.find((m) => m.reset); assert.strictEqual(gf2.rule, null); ev = ok(await call('ann', 'score', { id: ev.id, m: gf2.id, games: [[11, 5]] }), 'full match option: the normal rules').event; assert.ok(ev.fin);
  reset(); ev = ok(await call('ann', 'create', base({ title: 'Tennis DE', sport: 'tennis', to: 6, fmt: 'de', playIn: false, entrants: [{ name: 'A' }, { name: 'B' }] }))).event; assert.strictEqual(ev.rules.reset, 'match', 'other sports: a full match');
};
T.r11eCrossPoolPlacesAreShared = async () => {
  let ev = ok(await call('org', 'create', base({ playIn: false, myName: 'org', pools: 2, entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; const id = ev.id; NOW = START + 1000; ev = await get('org', id);
  for (const m of ev.matches.filter((x) => x.st === 'pool')) { NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: [[11, m.pool === 0 ? 2 : 9]] })).event; }
  assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 1, 3, 3], 'two pools, no playoff: the pool winners share 1st, the runners-up share 3rd (records are never compared across pools)');
  assert.ok(/share the place/.test(CLIENT), 'the rule is stated on the standings screen');
  // with a playoff: the entries that miss it are placed by pool position, shared
  reset(); ev = ok(await call('org', 'create', base({ playIn: false, myName: 'org', pools: 2, playoff: 2, entrants: ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => ({ name: n })) }))).event; NOW = START + 1000; ev = await get('org', ev.id); const rank = 'ABCDEF';
  for (let g = 0; g < 12; g++) { const m = ev.matches.find((x) => x.state === 'ready'); if (!m) break; NOW += 60e3; ev = ok(await call('org', 'score', { id: ev.id, m: m.id, games: rank.indexOf(m.an) < rank.indexOf(m.bn) ? [[11, 3]] : [[3, 11]] })).event; }
  assert.deepStrictEqual(ev.placeRows.map((r) => r.place), [1, 2, 3, 3, 5, 5]);
};

// ================= 12 Enterprise billing: every player through limits.recordPlay(accountKey, gameType, gameId, playerKey) =================
T.r12EnterpriseBillingRecordsEveryPlayer = async () => {
  assert.strictEqual(typeof E._billed, 'function', 'events records plays'); const seen = [], keep = D.limits, real = E.LIMSTAND;
  D.limits = () => Object.assign({}, real, { recordPlay: async (...a) => { seen.push(a); return real.recordPlay(...a); } });
  try { ENT.add('club'); let ev = ok(await call('club', 'create', base({ playIn: false, myName: 'Dir', entrants: [{ name: 'G1' }, { name: 'G2' }] }))).event; const id = ev.id; for (const p of ['bob', 'cat']) ok(await call(p, 'join', { code: ev.code, myName: p })); ok(await call('fan', 'join', { code: ev.code, myName: 'fan', as: 'spectator' }));
    await E._billed(); assert.strictEqual(seen.length, 0, 'nothing is recorded before the game starts'); NOW = START + 1000; ev = await get('club', id); await E._billed();
    assert.strictEqual(seen.length, 4, 'one call per player: 2 accounts + 2 typed-in players (not the director, not the spectator)'); assert.ok(seen.every((a) => a.length >= 4 && a[0] === 'acct-club' && a[1] === 'event' && a[2] === id && typeof a[3] === 'string'), 'recordPlay(accountKey, gameType, gameId, playerKey)'); assert.strictEqual(new Set(seen.map((a) => a[3])).size, 4);
    await get('bob', id); await get('club', id); await E._billed(); assert.strictEqual(seen.length, 4, 'each player once');
    const use = db['lock:entuse'].data['acct-club']['2026-11'][id]; assert.strictEqual(use.n, 4, 'the month row counts 4 players for this game'); assert.strictEqual(use.type, 'event');
    // a standard account: called through the same helper, which records nothing
    NOW = Z('2026-11-17T18:00:00Z'); const e2 = await mk(['amy', 'ben'], { title: 'Standard' }); await get('amy', e2.id); await E._billed(); assert.ok(!db['lock:entuse'].data['acct-amy'], 'standard accounts are not billed');
  } finally { D.limits = keep; }
};

// ================= 13 Calcutta source: organizer only, players as account ids / g:<guest id>, started() rethrows =================
T.r13CalcuttaSourceContract = async () => {
  let ev = ok(await call('org', 'create', base({ fmt: 'se', unit: 'doubles', playIn: false, myName: 'org', entrants: [{ name: 'Gil / Hy' }] }))).event; const id = ev.id;
  ev = ok(await call('bob', 'join', { code: ev.code, myName: 'bob', entryName: 'Bob / Cy' })).event; ok(await call('cy', 'join', { code: ev.code, myName: 'cy', eid: ev.entrants.find((x) => x.name === 'Bob / Cy').eid }));
  const S = E.ADAPTER.calcuttaSource(), calc = { ev: 'local', evtId: id };
  await assert.rejects(S.teams(calc, { viewer: 'acct-bob' }), /organizer/, 'a player (or anyone who knows the id) cannot list the teams'); await assert.rejects(S.teams(calc, { viewer: 'acct-zed' }), /organizer/); await assert.rejects(S.teams(calc), /organizer/, 'no viewer = refused');
  const teams = await S.teams(calc, { viewer: 'acct-org' }), bc = teams.find((t) => t.name === 'Bob / Cy'), gh = teams.find((t) => t.name === 'Gil / Hy');
  assert.deepStrictEqual(bc.players, [{ key: 'acct-bob', name: 'bob', accepted: true }, { key: 'acct-cy', name: 'cy', accepted: true }], 'accounts that joined on their own: accepted');
  assert.deepStrictEqual([await S.organizer(calc, { viewer: 'acct-org' }), await S.organizer(calc, { viewer: 'acct-bob' }), await S.organizer(calc, {}), await S.organizer(calc)], [true, false, false, false], 'organizer(calc, {viewer})'); assert.ok((await S.endTime(calc)) > ev.start, 'the scheduled end is exposed'); assert.ok(gh.players.length === 2 && gh.players.every((p) => typeof p === 'string' && /^g:g[A-Z2-9]{8}$/.test(p)), "typed-in players as 'g:<guest id>': " + JSON.stringify(gh.players));
  assert.strictEqual(await S.started(calc), false);
  // any read problem is rethrown: a stored start that is not a number can never answer "not started"
  for (const bad of ['abc', null, undefined, '1795000000000', NaN]) { const keep = db['lock:evt:' + id].data.start; db['lock:evt:' + id].data.start = bad; await assert.rejects(S.started(calc), /start/, 'started() with start=' + bad); await assert.rejects(S.startTime(calc), /start/); db['lock:evt:' + id].data.start = keep; }
  const keepGet = D.S.dbGet; D.S.dbGet = async () => { throw new Error('db down'); }; await assert.rejects(S.started(calc), /db down/); D.S.dbGet = keepGet; assert.strictEqual(await S.started(calc), false, 'and it answers again when the read works');
};

// ================= merged build only: the REAL stats module must leave unconfirmed events matches out of the rating =================
// Skipped on this branch (no odds-api/stats.js here). In the merged build it fails until stats.js `isConfirmed` honours `extra.confirmed === false` on
// events match records (stats-v1 e214bcf counts every events match as confirmed). See HANDOFF "Local events v1.3", merge notes.
T.r2MergedStatsHonoursConfirmed = async () => {
  let S = null; try { S = require(path.join(SRC, 'stats.js')); } catch (e) { return 'skip'; } if (D.rt() !== S) return 'skip';
  // the test kit already points the real stats / limits modules at this test's database, clock and sign-in (nothing is pinned)
  await warm(['ben', 'cal', 'dan', 'eve']); // ben and cal are old accounts with finished games of their own, confirmed by other accounts
  let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', playIn: true, myName: 'amy', entrants: [{ name: 'Ghost' }] }))).event; const id = ev.id; for (const p of ['ben', 'cal']) ok(await call(p, 'join', { code: ev.code, myName: p }));
  NOW = START + 1000; ev = await get('amy', id); const e = eidsOf(ev); await h2hMatch(id, 'amy', 'ben', [[11, 3]], e); await h2hMatch(id, 'cal', 'amy', [[11, 9]], e); S._reset(); const one = await S.ratingFor('acct-amy', 'pickleball', { casual: true }); assert.strictEqual(one.confirmedGames, 2, 'two games confirmed by two different accounts on the other side');
  for (let i = 0; i < 5; i++) { NOW += 60e3; ev = ok(await call('amy', 'challenge', { id, a: e.amy, b: e.Ghost })).event; ok(await call('amy', 'score', { id, m: ev.matches[ev.matches.length - 1].id, games: [[11, 0]] })); }
  S._reset(); const after = await S.ratingFor('acct-amy', 'pickleball', { casual: true }); assert.deepStrictEqual([after.confirmedGames, after.confirmedRating], [2, one.confirmedRating], 'five wins over a typed-in guest must not move the seeding rating in the real stats module');
};
