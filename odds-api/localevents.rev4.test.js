// Run: node odds-api/events.rev4.test.js [name ...]   Fixes for the FOURTH independent review (local-v1 @76ee6fa: "ready on its own; not ready merged with
// stats until it follows the new stats contract"). Every check FAILS on 76ee6fa (EVJS=<76ee6fa checkout>/odds-api/events.js node odds-api/events.rev4.test.js)
// and passes now. Checks marked [merged] need the real stats module (stats-v1 9aeeafa) next to events.js and say "skipped" on this branch alone; they run
// with NO stats test switch (no D.confirmer / D.auto): the accounts are simply old accounts (signed up 2025-01-01, events.testkit.js).
// In-memory database, fake sign-in and clock, no network.
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), E = require(process.env.EVJS || './localevents'), D = E._deps;
const SRC = path.dirname(process.env.EVJS || path.join(__dirname, 'localevents.js')), CLIENT = fs.readFileSync(path.join(SRC, '../pics/localevents.js'), 'utf8');
let db = {};
D.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); return t.startsWith('t-') ? 'acct-' + t.slice(2) : null; } });
const ENT = new Set(); D.enterprise = async (k) => ENT.has(String(k).replace('acct-', ''));
let ipn = 0; D.ip = (req) => String(req.headers['x-ip'] || '8.' + (ipn % 250) + '.' + (Math.floor(ipn / 250) % 250) + '.' + (ipn++ % 251));
const Z = (s) => Date.parse(s), HOUR = 3600e3, DAY = 864e5; let NOW; D.now = () => NOW; const START = Z('2026-11-21T15:00:00Z');
const srv = http.createServer(async (req, res) => { if (!(await E.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P;
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/levents/' + op, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, ip ? { 'x-ip': ip } : {}), body: JSON.stringify(b || {}) }); const txt = await r.text(); return { s: r.status, j: JSON.parse(txt), txt }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const no = (r, s, m) => { assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const base = (o) => Object.assign({ title: 'Rev4 test', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: START, to: 11, winBy: 2, bestOf: 1, seeding: 'manual', courts: 2, pools: 1, playoff: 0, entry: 0, split: 'none', take: { kind: 'none' }, myName: 'ann' }, o || {});
const reset = () => { db = {}; E._reset(); ENT.clear(); NOW = Z('2026-11-17T18:00:00Z'); };
const KIT = require('./localevents.testkit')({ E, D, ENT });
const STATS = !KIT.standRatings && typeof D.rt().eventReview === 'function'; // the real stats module (v1.4 contract) is in the build
const T = {};
const only = process.argv.slice(2);
srv.listen(0, async () => {
  P = srv.address().port; let n = 0, fail = 0, skip = 0;
  for (const k of Object.keys(T)) { if (only.length && !only.includes(k)) continue; reset(); try { const r = await T[k](); if (r === 'skip') { skip++; console.log('  skipped', k, '(needs the stats module: merged build)'); } else { n++; console.log('  ok', k); } } catch (e) { fail++; console.log('  FAIL', k, '-', process.env.TRACE ? e.stack : String(e.message).split('\n')[0].slice(0, 400)); } }
  console.log(fail ? '\nFAILED ' + fail + ' of ' + (n + fail) : '\nPASS ' + n + ' fourth-review checks' + (skip ? ' (' + skip + ' skipped)' : '')); srv.close(); process.exit(fail ? 1 : 0);
});
const get = async (who, id) => ok(await call(who, 'get', { id })).event;
const eidsOf = (ev) => { const o = {}; ev.entrants.forEach((e) => (o[e.name] = e.eid)); return o; };
const seat = (ev, n) => { for (const e of ev.entrants) for (const p of e.players) if (p.name === n) return p; return null; };
const row = (id) => db['lock:evt:' + id] && db['lock:evt:' + id].data;
async function h2hMatch(id, x, y, games, eids) { NOW += 60e3; const ev = ok(await call(x, 'challenge', { id, a: eids[x], b: eids[y] })).event, m = ev.matches[ev.matches.length - 1]; ok(await call(y, 'accept', { id, m: m.id })); ok(await call(x, 'score', { id, m: m.id, games })); return ok(await call(y, 'confirm', { id, m: m.id })).event; }
// A finished round robin of accounts, every score entered by one side and confirmed by the other: afterwards each of them has finished games of their own
// confirmed by another account (what the stats module asks of a confirmer). rank = the finishing order (first beats everyone).
async function warm(names, rank, o) {
  const t0 = NOW; NOW = Z('2026-11-01T18:00:00Z'); let ev = ok(await call(names[0], 'create', base(Object.assign({ title: 'Warm-up ' + names.join(' '), playIn: true, myName: names[0], start: NOW + HOUR }, o)))).event; const id = ev.id;
  for (const p of names.slice(1)) ok(await call(p, 'join', { code: ev.code, myName: p })); NOW += 2 * HOUR; ev = await get(names[0], id);
  for (const m of ev.matches.filter((x) => x.st === 'pool')) { NOW += 60e3; const aw = (rank || names).indexOf(m.an) < (rank || names).indexOf(m.bn); ok(await call(m.an, 'score', { id, m: m.id, games: [aw ? [11, 4] : [4, 11]] })); ok(await call(m.bn, 'confirm', { id, m: m.id })); }
  ev = await get(names[0], id); if (ev.canFinish) ok(await call(names[0], 'finish', { id })); NOW = Math.max(t0, NOW + HOUR); E._reset(); return id;
}

// ================= M1: money rules final once anyone ELSE ever joined OR any seat was marked paid; stored, never cleared =================
T.m1TypedInPlayersMarkedPaidMakeMoneyFinal = async () => {
  const mk0 = { playIn: false, myName: 'org', entry: 20, split: '60/30/10', take: { kind: 'none' }, entrants: [{ name: 'Al' }, { name: 'Bo' }, { name: 'Cy' }] };
  let ev = ok(await call('org', 'create', base(mk0))).event; const id = ev.id, edit = (o) => call('org', 'edit', Object.assign(base(mk0), { id }, o));
  // still open: an allowed money change posts a notice with the old and new values
  ev = ok(await edit({ take: { kind: 'pct', v: 10 } })).event; assert.ok(ev.notice && /take: nothing → 10% of the pot/i.test(ev.notice.text), 'notice with old and new value: ' + JSON.stringify(ev.notice)); assert.strictEqual(ev.moneyFinal, false);
  ev = ok(await edit({ take: { kind: 'none' } })).event;
  for (const n of ['Al', 'Bo', 'Cy']) ev = ok(await call('org', 'paid', { id, gid: seat(ev, n).gid, paid: true })).event;
  assert.strictEqual(ev.moneyFinal, true, 'a paid mark makes the money rules final'); assert.ok(row(id).moneyAt > 0, 'the moment is stored on the event row');
  // the reviewer's repro: take 0 -> 50% and winner takes all, after three typed-in players paid
  let r = no(await edit({ take: { kind: 'pct', v: 50 }, split: '100' }), 409, 'take 50% + winner-takes-all after typed-in players paid'); assert.ok(/marked paid/.test(r.error), r.error);
  // un-marking every seat does not reopen them
  for (const n of ['Al', 'Bo', 'Cy']) ev = ok(await call('org', 'paid', { id, gid: seat(ev, n).gid, paid: false })).event;
  no(await edit({ take: { kind: 'pct', v: 50 }, split: '100' }), 409, 'un-marking paid does not reopen the money rules'); assert.strictEqual((await get('org', id)).money.split, '60/30/10');
};
T.m1EveryoneLeavingDoesNotReopenMoneyRules = async () => {
  const mk0 = { playIn: true, myName: 'ann', entry: 20, split: '60/30/10' }; let ev = ok(await call('ann', 'create', base(mk0))).event; const id = ev.id, edit = (o) => call('ann', 'edit', Object.assign(base(mk0), { id }, o));
  ok(await call('cat', 'join', { code: ev.code, myName: 'cat' })); ok(await call('cat', 'leave', { id }));
  ev = await get('ann', id); assert.strictEqual(ev.members.length, 1, 'the organizer is alone again'); assert.strictEqual(ev.moneyFinal, true, 'still final');
  no(await edit({ entry: 30 }), 409, 'everyone leaving does not reopen the money rules'); no(await edit({ split: '100' }), 409);
};

// ================= M2: the organizer and co-organizers never pick in their own pick'em; they can view it =================
T.m2OrganizerAndCoOrganizersCannotPick = async () => {
  let ev = ok(await call('org', 'create', base({ fmt: 'se', pickem: true, spectators: true, playIn: false, myName: 'org', entrants: [{ name: 'Al' }, { name: 'Bo' }, { name: 'Cy' }, { name: 'Di' }] }))).event; const id = ev.id;
  for (const p of ['fan', 'co']) ok(await call(p, 'join', { code: ev.code, as: 'spectator', myName: p }));
  ev = await get('org', id); const coPid = ev.members.find((m) => m.name === 'co').pid; ev = ok(await call('org', 'coorg', { id, pid: coPid, on: true })).event; assert.ok(ev.members.find((m) => m.name === 'co').co, 'co is a co-organizer');
  no(await call('fan', 'coorg', { id, pid: coPid, on: false }), 403, 'only the organizer names co-organizers');
  NOW = START - 600e3; ok(await call('org', 'draw', { id })); ev = await get('org', id); const m = ev.matches.find((x) => x.state === 'ready');
  for (const who of ['org', 'co']) { const r = no(await call(who, 'pick', { id, m: m.id, side: 'a' }), 403, who + ' picks'); assert.ok(/cannot make pick'em picks/.test(r.error), r.error); no(await call(who, 'pick', { id, tb: 40 }), 403, who + ' tiebreak guess'); }
  const seen = await get('co', id); assert.ok(seen.pickem && seen.pickem.org === true && seen.pickem.open.length === 0, 'they see the pick\'em, with nothing to pick'); assert.ok(Array.isArray(seen.pickem.table));
  ok(await call('fan', 'pick', { id, m: m.id, side: 'a' }), 'a spectator still picks');
  // a co-organizer may set and close the pick'em times (the organizer's job, shared)
  ev = ok(await call('co', 'picklock', { id, round: ev.pickem.rounds[0].key, lock: true })).event; assert.ok(ev.audit.some((a) => /\(co-organizer\)/.test(a.who) && /picks closed now/.test(a.s)));
  // co-organizers are named before the start (picks open only after the draw, so a co-organizer never has picks of his own)
  no(await call('org', 'coorg', { id, pid: ev.members.find((x) => x.name === 'fan').pid, on: true }), 409, 'not after the draw');
  assert.ok(/data-a="coorg"/.test(CLIENT) && /Organizers cannot pick/.test(CLIENT), 'the screens: co-organizer button, and the organizer\'s pick\'em says why there is nothing to pick');
};

// ================= M3: the last playoff spot across pools of UNEQUAL size goes by win percentage, then point difference and points per game =================
T.m3CrossPoolSpotByWinPercentage = async () => {
  // 13 typed-in entries, 3 pools (snake): A = n0 n5 n6 n11 n12 (4 games each), B = n1 n4 n7 n10 and C = n2 n3 n8 n9 (3 games each). Playoff 4 = the three
  // pool winners + the best 2nd place. A's 2nd (n5): 2-2, +14 points. B's 2nd (n4): 2-1, -2 points. Raw wins are level (2 v 2) and n5 has the better
  // difference, but n4 has the better WIN PERCENTAGE (67% v 50%): n4 takes the spot.
  const names = Array.from({ length: 13 }, (_, i) => 'n' + i); ENT.add('org'); let ev = ok(await call('org', 'create', base({ playIn: false, myName: 'org', pools: 3, playoff: 4, entrants: names.map((n) => ({ name: n })) }))).event; const id = ev.id;
  NOW = START + 1000; ev = await get('org', id); assert.deepStrictEqual(ev.pools.map((p) => p.map((e) => ev.entrants.find((x) => x.eid === e).name).sort()), [['n0', 'n11', 'n12', 'n5', 'n6'], ['n1', 'n10', 'n4', 'n7'], ['n2', 'n3', 'n8', 'n9']]);
  const W = { 'n0|*': [11, 5], 'n1|*': [11, 5], 'n2|*': [11, 5], 'n5|n6': [11, 0], 'n5|n11': [11, 0], 'n12|n5': [11, 9], 'n6|n12': [11, 7], 'n6|n11': [11, 7], 'n11|n12': [11, 7], 'n4|n7': [11, 9], 'n4|n10': [11, 9], 'n7|n10': [11, 7], 'n3|n8': [11, 0], 'n8|n9': [11, 9], 'n9|n3': [11, 9] };
  const res = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { const g = W[x + '|' + y] || W[x + '|*']; if (g) return x === a ? g : [g[1], g[0]]; } throw new Error('no result for ' + a + ' v ' + b); };
  for (let g = 0; g < 60; g++) { const m = ev.matches.find((x) => x.st === 'pool' && x.state === 'ready'); if (!m) break; NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: [res(m.an, m.bn)] })).event; }
  const po = ev.matches.filter((m) => m.st === 'po'), inPo = new Set(po.flatMap((m) => [m.an, m.bn]).filter(Boolean)); const hist = ev.audit.map((a) => a.s).join(' | ');
  assert.ok(inPo.has('n4') && !inPo.has('n5'), 'the best 2nd place by win percentage (n4, 2-1) takes the spot, not n5 (2-2, better difference): ' + [...inPo] + ' | ' + hist);
  assert.ok(/Last playoff spot across pools .*n4 \(by record: win percentage, point difference per game, points per game\)/.test(hist), hist);
  assert.ok(/win percentage, point difference per game and points per game/.test(CLIENT), 'the standings screen says how the spot is decided');
};

// ================= L1: create with a group: Groups is asked BEFORE saving; a refusal leaves nothing behind =================
T.l1CreateForAGroupLeavesNothingWhenGroupsRefuses = async () => {
  const keep = D.groups, live = () => Object.keys(db).filter((k) => /^lock:evt:/.test(k) && !db[k].data.deleted).length;
  try {
    // (a) Groups' own commissioner check says no (canAttach): nothing is saved at all
    D.groups = () => ({ memberCheck: async () => ({ member: true, comm: true }), canAttach: async () => false, attachGame: async () => { throw new Error('should not be asked'); } });
    let r = no(await call('ann', 'create', base({ groupId: 'GRP-' + 'x'.repeat(30) })), 403); assert.ok(/Nothing was created/.test(r.error), r.error); assert.strictEqual(Object.keys(db).filter((k) => /^lock:evt:/.test(k)).length, 0, 'no event row was written');
    // (b) Groups refuses at attach time (a full group): the event is taken back, no stand-alone event is left
    D.groups = () => ({ memberCheck: async () => ({ member: true, comm: true }), canAttach: async () => true, attachGame: async () => { throw Object.assign(new Error('A group can hold up to 8 contests'), { status: 400 }); } });
    r = no(await call('ann', 'create', base({ groupId: 'GRPA' })), 400); assert.ok(/up to 8 contests/.test(r.error) && /Nothing was created/.test(r.error), r.error);
    assert.strictEqual(live(), 0, 'no stand-alone event left behind'); assert.deepStrictEqual(ok(await call('ann', 'mine', {})).events, [], 'nothing in My events');
  } finally { D.groups = keep; }
  assert.ok(!/groupError/.test(CLIENT), 'the phone shows the refusal as an error and keeps the form');
};

// ================= L2: ADAPTER.attach checks the CALLER (that group's commissioner) and takes group ids up to 40 characters =================
T.l2AdapterAttachChecksTheCaller = async () => {
  const gid = 'G-' + 'a'.repeat(38), gmk = (e) => crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24), keep = D.groups; D.groups = () => null; // the plain group row (no Groups engine)
  try { db['lock:grp:' + gid] = { id: 'lock:grp:' + gid, data: { id: gid, comm: gmk('acct-ann'), members: [{ mk: gmk('acct-ann') }, { mk: gmk('acct-bob') }] }, updated: 1 };
    const ev = ok(await call('ann', 'create', base({ entry: 0 }))).event;
    await assert.rejects(E.ADAPTER.attach(ev.id, { gid, cid: 'C1', pot: 'side' }), /commissioner/, 'no caller: refused');
    await assert.rejects(E.ADAPTER.attach(ev.id, { gid, cid: 'C1', pot: 'side', by: 'acct-bob' }), /commissioner/, 'a member who is not the commissioner: refused');
    await E.ADAPTER.attach(ev.id, { gid, cid: 'C1', pot: 'side', by: 'acct-ann' }); assert.strictEqual(row(ev.id).group.gid, gid, 'the full 40-character group id is kept'); assert.strictEqual(row(ev.id).money.pot, 'side');
  } finally { D.groups = keep; }
};

// ================= H1: events files its confirmer with the stats module (acctRef) and links older keys (linkRef); record fields =================
T.h1ScoreAndConfirmFileTheConfirmerWithStats = async () => {
  // a rating module with the stats calls (spied), on this branch alone: score and confirm call acctRef(account); statsFor calls linkRef once per known 'a:' key
  const keep = D.rt, base0 = D.rt(), refs = [], links = []; D.rt = () => Object.assign({}, base0, { acctRef: (e) => { refs.push(e); return 'a:' + crypto.createHash('sha256').update('oddable-opp|' + crypto.createHash('sha256').update('oddable-group|' + e).digest('hex').slice(0, 24)).digest('hex').slice(0, 12); }, linkRef: async (k, e) => { links.push([k, e]); return true; } });
  try { let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', playIn: true, myName: 'amy' }))).event; const id = ev.id; ok(await call('ben', 'join', { code: ev.code, myName: 'ben' }));
    NOW = START + 1000; ev = await get('amy', id); await h2hMatch(id, 'amy', 'ben', [[11, 3]], eidsOf(ev));
    assert.ok(refs.includes('acct-amy') && refs.includes('acct-ben'), 'the scorer and the confirmer were filed with stats.acctRef: ' + refs);
    const rec = (await E.statsFor('acct-amy', {})).find((x) => x.kind === 'match'); assert.strictEqual(rec.extra.card.by, refs.length && D.rt().acctRef('acct-ben'), 'card.by = stats.acctRef(the confirmer)');
    assert.deepStrictEqual(links.map((x) => x[1]).sort(), ['acct-amy', 'acct-ben'], 'linkRef once for each account in the event (covers matches played before the fix)'); const n = links.length; await E.statsFor('acct-ben', {}); assert.strictEqual(links.length, n, 'once per key, not on every read');
  } finally { D.rt = keep; }
};
T.h1RecordFieldsCasualFinishWon = async () => {
  let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-22', playIn: true, myName: 'amy' }))).event; const id = ev.id; ok(await call('ben', 'join', { code: ev.code, myName: 'ben' }));
  NOW = START + 1000; ev = await get('amy', id); await h2hMatch(id, 'ben', 'amy', [[11, 3]], eidsOf(ev)); ok(await call('amy', 'finish', { id }));
  const recs = await E.statsFor('acct-amy', {}), m = recs.find((x) => x.kind === 'match'), e = recs.find((x) => x.kind === 'event');
  assert.strictEqual(m.extra.casual, true, 'a no-money event: casual on the match'); assert.strictEqual(e.extra.casual, true, 'and on the event record'); assert.strictEqual(e.won, 0, 'a finish that paid nothing says won 0'); assert.ok(e.extra.finishedAt > 0 && e.extra.finishedAt === row(id).fin, 'the finish time');
  assert.ok(typeof m.extra.card.by === 'string' && /^a:/.test(m.extra.card.by), 'card.by on the match');
  reset(); ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-22', playIn: true, myName: 'amy', entry: 10, split: '100' }))).event; ok(await call('ben', 'join', { code: ev.code, myName: 'ben' })); NOW = START + 1000; ev = await get('amy', ev.id); await h2hMatch(ev.id, 'ben', 'amy', [[11, 3]], eidsOf(ev)); ok(await call('amy', 'finish', { id: ev.id }));
  const r2 = await E.statsFor('acct-amy', {}); assert.ok(r2.every((x) => !('casual' in x.extra)), 'a money event is not casual'); assert.strictEqual(r2.find((x) => x.kind === 'event').won, 0, 'lost a money event: won 0');
};
// [merged] the real stats module counts an events match confirmed by an old, active account: before the fix it counted none
T.h1MergedStatsCountsEventMatches = async () => {
  if (!STATS) return 'skip'; const S = D.rt();
  await warm(['ben', 'cal', 'dan', 'eve']); // three confirmers with finished games of their own, confirmed by other accounts
  let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', playIn: true, myName: 'amy' }))).event; const id = ev.id; for (const p of ['ben', 'cal', 'dan']) ok(await call(p, 'join', { code: ev.code, myName: p }));
  NOW = START + 1000; ev = await get('amy', id); const e = eidsOf(ev); for (const o of ['ben', 'cal', 'dan']) await h2hMatch(id, 'amy', o, [[11, 4]], e); E._reset(); if (S._reset) S._reset();
  const r = await S.ratingFor('acct-amy', 'pickleball', { casual: true }); assert.strictEqual(r.confirmedGames, 3, 'three games, each confirmed by a different old account: ' + JSON.stringify(r.makeup && r.makeup.text)); assert.strictEqual(r.suggested.confirmed, true, 'CONFIRMED');
  // matches played before the fix (no acctRef filing): the confirmer directory is empty, statsFor links the keys again
  delete db['lock:cref']; if (S._reset) S._reset(); E._reset(); const r2 = await S.ratingFor('acct-amy', 'pickleball', { casual: true }); assert.strictEqual(r2.confirmedGames, 3, 'linkRef files the older keys');
};

// ================= H2: the approval model (stats contract v1.4) =================
// [merged] money event: registered, the organizer's approval screen, approve-all, his own number needs a co-sign, set values, seeds from `use`, not forced
T.h2MoneyEventOrganizerApprovesEveryNumber = async () => {
  if (!STATS) return 'skip'; const S = D.rt();
  await warm(['amy', 'ben', 'cal', 'dan'], ['amy', 'ben', 'cal', 'dan']); // amy 3-0, everyone has 3 finished games confirmed by other accounts
  const st = Z('2026-12-05T15:00:00Z'); NOW = Z('2026-11-24T18:00:00Z');
  let ev = ok(await call('org', 'create', base({ title: 'Money night', fmt: 'se', seeding: 'rating', entry: 20, split: '100', start: st, playIn: true, spectators: true, myName: 'org', entrants: [{ name: 'Newbie' }] }))).event; const id = ev.id;
  for (const p of ['amy', 'ben', 'dan']) ok(await call(p, 'join', { code: ev.code, myName: p })); ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' }));
  ev = await get('org', id); assert.deepStrictEqual([ev.approve.open, ev.approve.total, ev.approve.approved], [true, 5, 0], 'the organizer\'s to-do: 5 players, none approved'); assert.ok(seat(ev, 'amy').needsSet && seat(ev, 'amy').use == null, 'nothing is used before the organizer approves');
  assert.ok(seat(ev, 'amy').odd.rating > 1500, 'the real Oddable rating shows'); assert.strictEqual((await S.eventLog('acct-org', 'evt:' + id)).lockAt, st, 'registered with stats.eventSetup, locking at the start');
  no(await call('ben', 'review', { id }), 403, 'a player does not see the approval screen');
  let rv = ok(await call('org', 'review', { id })).review; const R = (n) => rv.players.find((x) => x.name === n); assert.strictEqual(rv.players.length, 5);
  assert.strictEqual(R('amy').suggested.confirmed, true, 'amy: CONFIRMED (3 games, 3 different old, active confirmers)'); assert.ok(R('amy').makeup && Array.isArray(R('amy').flags), 'the make-up and flags for OddStats.makeupHtml'); assert.strictEqual(R('Newbie').suggested.confirmed, false, 'a typed-in player: UNCONFIRMED'); assert.ok(R('org').you);
  let r = no(await call('org', 'approve', { id, gid: seat(ev, 'org').gid }), 403, 'approving his own number alone'); assert.strictEqual(r.code, 'cosign'); assert.ok(/own number/.test(r.error));
  // the co-sign FIRST (stats v1.5: once he approves a player's number, that player can no longer co-sign his): he asks, a player on another team who
  // accepted his seat (joining with the link was his own tap) signs on his own phone; events mints the co-sign code for amy's own account and uses it once
  ev = ok(await call('org', 'cosign', { id, ask: true })).event; assert.ok(ev.cosign && ev.cosign.mine); const seen = await get('amy', id); assert.ok(seen.cosign && seen.cosign.canSign, 'amy (another team) can co-sign'); assert.ok(seen.notice && /co-sign/.test(seen.notice.text));
  assert.strictEqual((await get('fan', id)).cosign.canSign, false, 'a spectator cannot');
  ev = ok(await call('amy', 'cosign', { id })).event; assert.ok(!ev.cosign, 'done'); ev = await get('org', id); assert.ok(seat(ev, 'org').use != null && !seat(ev, 'org').needsSet, 'his number is approved with the co-sign'); assert.ok(ev.audit.some((a) => /co-signed by amy/.test(a.s)));
  assert.ok((await S.eventLog('acct-org', 'evt:' + id)).log.some((l) => l.cosign && l.player), 'stats logged the co-signer');
  // one tap: "Use everyone's Oddable rating" for the others
  ev = ok(await call('org', 'approve', { id, all: true })).event; assert.strictEqual(ev.approve.approved, 4, 'amy co-signed his number, so he cannot approve hers (stats v1.5: no mutual approval)'); assert.ok(seat(ev, 'amy').needsSet);
  // a co-organizer approves amy: named by the organizer, he accepts on his own phone first
  ok(await call('cal', 'join', { code: ev.code, as: 'spectator', myName: 'cal' })); ev = await get('org', id); ok(await call('org', 'coorg', { id, pid: ev.members.find((m) => m.name === 'cal').pid, on: true }));
  let cv = await get('cal', id); assert.ok(cv.acceptMe && cv.acceptMe.co, 'the co-organizer is asked to accept the role'); no(await call('cal', 'approve', { id, gid: seat(cv, 'amy').gid, value: R('amy').suggested.value }), 403, 'not before he accepts');
  cv = ok(await call('cal', 'seatok', { id })).event; assert.ok(!cv.acceptMe); ev = ok(await call('cal', 'approve', { id, gid: seat(cv, 'amy').gid, value: R('amy').suggested.value })).event; assert.strictEqual(ev.approve.approved, 5, 'everyone approved');
  assert.strictEqual(seat(ev, 'amy').use, R('amy').suggested.value); assert.ok(/approved by/.test(seat(ev, 'amy').ap.shown) && /Oddable .* \(real results\)/.test(seat(ev, 'amy').ap.shown), 'every player sees who approved it, next to the real rating: ' + seat(ev, 'amy').ap.shown);
  assert.ok(ev.audit.some((a) => /Used everyone's Oddable rating/.test(a.s) && /Newbie 1500 \(UNCONFIRMED\)/.test(a.s)), 'logged, unconfirmed marked: ' + ev.audit.map((a) => a.s).join(' | ')); assert.ok(ev.tlog.length >= 4);
  // a player can confirm his seat again after the organizer moved him (none moved here): the route answers for a member
  ok(await call('ben', 'seatok', { id }));
  // a set value with a reason: the real rating stays beside it
  ev = ok(await call('org', 'rset', { id, gid: seat(ev, 'Newbie').gid, rating: 1750, reason: 'Club champion, new to the app' })).event; assert.strictEqual(seat(ev, 'Newbie').use, 1750); assert.ok(/set by/.test(seat(ev, 'Newbie').ap.shown) && /Oddable none yet/.test(seat(ev, 'Newbie').ap.shown), seat(ev, 'Newbie').ap.shown);
  no(await call('org', 'rset', { id, gid: seat(ev, 'amy').gid, rating: 1600, reason: '' }), 400, 'a reason is required');
  // seeds come from `use`: Newbie 1750 first, then amy
  NOW = st + 1000; ev = await get('org', id); const order = ev.entrants.slice().sort((a, b) => a.seed - b.seed).map((x) => x.name); assert.deepStrictEqual(order.slice(0, 2), ['Newbie', 'amy'], 'seeded from the approved / set numbers: ' + order);
  no(await call('org', 'approve', { id, all: true }), 409, 'final at the start');
};
T.h2NotForcedCasualAndStandIn = async () => {
  if (STATS) { // [merged] an organizer who never approves: the draw still happens, at each player's stats `seed`, and the history says so
    let ev = ok(await call('org', 'create', base({ title: 'Never approved', fmt: 'se', seeding: 'rating', entry: 10, split: '100', playIn: false, myName: 'org', entrants: [{ name: 'Al' }, { name: 'Bo' }] }))).event; const id = ev.id;
    NOW = START + 1000; ev = await get('org', id); assert.ok(ev.drawn, 'not forced: the draw is made at the start'); assert.ok(ev.audit.some((a) => /not approved by the organizer before the start, so they were seeded at the Oddable seed number/.test(a.s)), ev.audit.map((a) => a.s).join(' | '));
    // casual: no approval, the full rating
    reset(); ev = ok(await call('org', 'create', base({ title: 'Free', fmt: 'se', seeding: 'rating', playIn: false, myName: 'org', entrants: [{ name: 'Al' }, { name: 'Bo' }] }))).event; assert.strictEqual(ev.approve, null); assert.strictEqual(ev.casual, true); assert.strictEqual(seat(ev, 'Al').use, 1500, 'casual: the full rating (1500 with no games)');
    no(await call('org', 'review', { id: ev.id }), 409, 'nothing to approve in a casual event');
    return;
  }
  // [this branch alone] no stats module: events keeps its own built-in Elo exactly as before (no approval step)
  let ev = ok(await call('org', 'create', base({ title: 'Money, stand-in', fmt: 'se', seeding: 'rating', entry: 10, split: '100', playIn: false, myName: 'org', entrants: [{ name: 'Al' }, { name: 'Bo' }] }))).event;
  assert.strictEqual(ev.approve, null, 'no approval step without the stats module'); assert.strictEqual(seat(ev, 'Al').use, 1500, 'the stand-in: a guest with no games starts at 1500, used as before'); assert.strictEqual(seat(ev, 'Al').needsSet, false); no(await call('org', 'review', { id: ev.id }), 409);
  assert.ok(/data-a="apall"/.test(CLIENT) && /Use everyone's Oddable rating/.test(CLIENT) && /data-a="cosign"/.test(CLIENT) && /makeupHtml/.test(CLIENT), 'the approval screen, the one-tap button, the co-sign flow and the make-up are on the phone');
};
