// Run: node odds-api/events.rev3.test.js [name ...]   Fixes for the THIRD independent review (local-v1 @872e74a, "SHIP AFTER FIXES"), the manager's brief
// and the integration owner's port list. Every check FAILS on 872e74a (EVJS=<872e74a checkout>/odds-api/events.js node odds-api/events.rev3.test.js) and passes now.
// In-memory database, fake sign-in and clock, no network.
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path'), E = require(process.env.EVJS || './events'), D = E._deps;
const SRC = path.dirname(process.env.EVJS || path.join(__dirname, 'events.js')), CLIENT = fs.readFileSync(path.join(SRC, '../pics/events.js'), 'utf8');
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
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/events/' + op, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-token': who ? 't-' + who : '' }, ip ? { 'x-ip': ip } : {}), body: JSON.stringify(b || {}) }); return { s: r.status, j: JSON.parse(await r.text()) }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const no = (r, s, m) => { assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); return r.j; };
const base = (o) => Object.assign({ title: 'Rev3 test', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: START, to: 11, winBy: 2, bestOf: 1, seeding: 'manual', courts: 2, pools: 1, playoff: 0, entry: 0, split: 'none', take: { kind: 'none' }, myName: 'ann' }, o || {});
const reset = () => { db = {}; E._reset(); ENT.clear(); NOW = Z('2026-11-17T18:00:00Z'); };
const KIT = require('./events.testkit')({ E, D, ENT });
const T = {};
const only = process.argv.slice(2);
srv.listen(0, async () => {
  P = srv.address().port; let n = 0, fail = 0, skip = 0;
  for (const k of Object.keys(T)) { if (only.length && !only.includes(k)) continue; reset(); try { const r = await T[k](); if (r === 'skip') { skip++; console.log('  skipped', k); } else { n++; console.log('  ok', k); } } catch (e) { fail++; console.log('  FAIL', k, '-', process.env.TRACE ? e.stack : String(e.message).split('\n')[0].slice(0, 300)); } }
  console.log(fail ? '\nFAILED ' + fail + ' of ' + (n + fail) : '\nPASS ' + n + ' third-review checks' + (skip ? ' (' + skip + ' skipped)' : '')); srv.close(); process.exit(fail ? 1 : 0);
});
// ---------- helpers: every account is named like its token (ann = t-ann) ----------
const get = async (who, id) => ok(await call(who, 'get', { id })).event;
// an event with accounts: the first is the organizer and plays; started
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

const SERVER = fs.readFileSync(path.join(SRC, 'events.js'), 'utf8'), CATJS = fs.readFileSync(path.join(SRC, '../pics/catalog.js'), 'utf8'), CATJSON = fs.readFileSync(path.join(SRC, '../pics/games-catalog.json'), 'utf8');
const row = (id) => db['lock:evt:' + id].data;
const matchRecs = async (who) => (await E.statsFor('acct-' + who, {})).filter((x) => x.kind === 'match');
// an organizer who does not play, typed-in entries, started; the organizer's score is final
async function typed(names, o) { if (names.length > 7) ENT.add('org'); let ev = ok(await call('org', 'create', base(Object.assign({ playIn: false, myName: 'org', entrants: names.map((n) => ({ name: n })) }, o)))).event; NOW = START + 1000; return get('org', ev.id); }
async function commPlayAll(id, f) { let ev = await get('org', id); for (let g = 0; g < 80; g++) { const m = ev.matches.find((x) => x.state === 'ready' && (!f.only || f.only(x))); if (!m) break; NOW += 60e3; ev = ok(await call('org', 'score', { id, m: m.id, games: [f(m, ev)] })).event; } return ev; }

// ================= H1: an explicit, truthful confirmation record on every match =================
T.h1ConfirmationRecordIsExplicitAndTruthful = async () => {
  let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', playIn: true, myName: 'amy', entrants: [{ name: 'Ghost' }] }))).event; const id = ev.id; for (const p of ['ben', 'cal']) ok(await call(p, 'join', { code: ev.code, myName: p }));
  NOW = START + 1000; ev = await get('amy', id); const e = eidsOf(ev); await h2hMatch(id, 'amy', 'ben', [[11, 3]], e); await h2hMatch(id, 'cal', 'amy', [[11, 9]], e);
  NOW += 60e3; ev = ok(await call('amy', 'challenge', { id, a: e.amy, b: e.Ghost })).event; ok(await call('amy', 'score', { id, m: ev.matches[ev.matches.length - 1].id, games: [[11, 0]] }));
  const recs = await matchRecs('amy'), vsBen = recs.find((x) => x.opponent === 'ben'), vsGhost = recs.find((x) => x.opponent === 'Ghost'), benRec = (await matchRecs('ben'))[0];
  const c = vsBen.extra.confirmation; assert.ok(c, 'every match record carries extra.confirmation');
  assert.deepStrictEqual([c.confirmed, c.rated, c.by, c.bySide, c.byName, c.forfeit, c.enteredBySide, c.oppAccounts, c.oppGuests, c.eventAccounts], [true, true, 'opponent', 'opponent', 'ben', false, 'own', 1, 0, 3]);
  assert.ok(/^a:[0-9a-f]{12}$/.test(c.byKey), 'confirmedBy account key (stats form, hashed): ' + c.byKey); assert.strictEqual(c.byKey, c.played.opp[0].key, 'the confirmer is the account that played on the other side'); assert.strictEqual(c.enteredByKey, c.played.mine[0].key, 'entered by my own account'); assert.notStrictEqual(c.byKey, c.enteredByKey);
  assert.deepStrictEqual(c.played.mine.map((p) => p.guest), [false]); assert.strictEqual(vsBen.extra.confirmedBy.key, c.byKey); assert.strictEqual(vsBen.extra.confirmedBy.ref, c.byKey, 'confirmedBy.ref = stats.acctRef(confirmer)'); assert.deepStrictEqual([vsBen.extra.card.others, vsBen.extra.card.by], [1, c.byKey]); assert.deepStrictEqual([vsGhost.extra.card.others, vsGhost.extra.card.by], [0, null], 'the card is on every match: against a typed-in guest no other account had one and nobody confirmed'); if (KIT.real.stats && typeof KIT.real.stats.acctRef === 'function') { assert.strictEqual(c.byKey, KIT.real.stats.acctRef('acct-ben'), 'merged build: the key IS stats.acctRef(account)'); assert.strictEqual(KIT.real.stats.confInfo(vsBen).ok, true); assert.strictEqual(KIT.real.stats.confInfo(vsGhost).ok, false); assert.strictEqual(KIT.real.stats.confInfo(benRec).ok, true, 'the confirmer\'s own record counts too: the other side entered it'); } assert.strictEqual(vsBen.extra.confirmedBy.side, 'opponent'); assert.strictEqual(vsBen.extra.confirmed, true);
  const bc = benRec.extra.confirmation; assert.deepStrictEqual([bc.confirmed, bc.bySide, bc.enteredBySide], [true, 'own', 'opponent'], 'from ben\'s side: entered by the opponent, confirmed by ben himself'); assert.strictEqual(bc.byKey, bc.played.mine[0].key); assert.strictEqual(bc.agreedWith.key, bc.played.opp[0].key, 'agreedWith = the account on the other side that took part (amy, who entered it)'); assert.strictEqual(benRec.extra.card.by, bc.played.opp[0].key); assert.ok(!benRec.extra.confirmedBy.ref, 'no opposing confirmer ref on the confirmer\'s own record'); assert.strictEqual(c.agreedWith.key, c.byKey);
  // L8: one opposing account -> the key the stats module builds for a self-logged match against that account
  const sha = (x) => require('crypto').createHash('sha256').update(x).digest('hex'); assert.strictEqual(vsBen.extra.oppKey, 'a:' + sha('oddable-opp|' + sha('oddable-group|acct-ben').slice(0, 24)).slice(0, 12)); assert.strictEqual(vsBen.extra.oppKey, c.byKey);
  // a typed-in guest: not confirmed, and the record says exactly why
  const g = vsGhost.extra.confirmation; assert.deepStrictEqual([g.confirmed, g.rated, g.by, g.bySide, g.oppAccounts, g.oppGuests, g.forfeit], [false, false, 'commissioner', 'own', 0, 1, false]); assert.deepStrictEqual(g.played.opp, [{ key: null, guest: true }], 'typed-in guest flag'); assert.strictEqual(g.byKey, g.played.mine[0].key, 'made final by my own account'); assert.ok(/no Oddable account/.test(g.reason)); assert.strictEqual(vsGhost.extra.confirmed, false); assert.strictEqual(vsGhost.verified, false);
  assert.ok(!/acct-/.test(JSON.stringify(recs)), 'no account id in any record');
  // a forfeit by the clock
  reset(); ev = await mk(['amy', 'ben', 'cal'], { fmt: 'ladder', endDay: '2026-12-20', reach: 3, expDays: 7, expire: 'forfeit' }); const e2 = eidsOf(ev); ok(await call('cal', 'challenge', { id: ev.id, a: e2.cal, b: e2.ben })); NOW += 8 * DAY; await get('amy', ev.id);
  const f = (await matchRecs('cal'))[0].extra.confirmation; assert.deepStrictEqual([f.confirmed, f.rated, f.by, f.forfeit, f.byKey], [false, false, 'clock', true, null]);
};

// ================= H2: Enterprise billing, once per player per game, ever =================
T.h2BillingOncePerPlayerEverOnTheEventRow = async () => {
  const calls = [], keep = D.limits, base0 = D.limits(); D.limits = () => Object.assign({}, base0, { recordPlay: async (...a) => { calls.push({ a, month: new Date(NOW).toISOString().slice(0, 7) }); return base0.recordPlay(...a); } });
  try { ENT.add('club'); let ev = ok(await call('club', 'create', base({ fmt: 'se', playIn: false, myName: 'Dir', entrants: [{ name: 'G1' }, { name: 'G2' }, { name: 'G3' }] }))).event; const id = ev.id; NOW = START + 1000; ev = await get('club', id);
    for (let g = 0; g < 5; g++) { const m = ev.matches.find((x) => x.state === 'ready'); if (!m) break; NOW += 60e3; ev = ok(await call('club', 'score', { id, m: m.id, games: [[11, 4]] })).event; } assert.ok(ev.fin, 'the bracket is finished in November'); await E._billed();
    const L = D.limits(), use = () => db['lock:entuse'].data[L.keyOf('acct-club')]; assert.deepStrictEqual(Object.keys(use()), ['2026-11']); assert.strictEqual(use()['2026-11'][id].n, 3); assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(Object.values(row(id).billed), ['2026-11', '2026-11', '2026-11'], 'the billed seat ids are on the event row, with the month the game started'); assert.deepStrictEqual(Object.keys(row(id).billed).sort(), ev.entrants.map((x) => x.players[0].gid).sort());
    // the server restarts (memory is lost); the finished event is opened in December, then in January
    for (const when of ['2026-12-09T15:00:00Z', '2027-01-20T15:00:00Z']) { E._reset(); ENT.add('club'); NOW = Z(when); await get('club', id); await get('club', id); await E._billed(); }
    assert.strictEqual(calls.length, 3, 'recordPlay is never called again for a seat already on the row (it was called ' + calls.length + ' times)'); assert.deepStrictEqual(Object.keys(use()), ['2026-11'], 'nothing is filed under a later month: ' + Object.keys(use()));
    // a game that started in November but is first opened in December is still a November game
    reset(); ENT.add('club'); calls.length = 0; ev = ok(await call('club', 'create', base({ fmt: 'ladder', endDay: '2026-12-31', playIn: false, myName: 'Dir', entrants: [{ name: 'L1' }, { name: 'L2' }] }))).event; NOW = Z('2026-12-03T15:00:00Z'); await get('club', ev.id); await E._billed();
    assert.strictEqual(calls.length, 2); assert.ok(calls.every((c) => c.a[5] && c.a[5].at === START && c.a[5].month === '2026-11'), 'recordPlay is told when the game started'); assert.deepStrictEqual(Object.values(row(ev.id).billed), ['2026-11', '2026-11']);
    if (KIT.standLimits) assert.deepStrictEqual(Object.keys(use()), ['2026-11'], 'filed under the month the game started');
    // a failed recordPlay is retried, and still only once
    reset(); ENT.add('club'); calls.length = 0; let boom = 1; const b1 = D.limits(); D.limits = () => Object.assign({}, b1, { recordPlay: async (...a) => { if (boom-- > 0) throw new Error('db down'); calls.push({ a }); return true; } });
    const err0 = console.error; console.error = () => {}; try { ev = ok(await call('club', 'create', base({ playIn: false, myName: 'Dir', entrants: [{ name: 'R1' }, { name: 'R2' }] }))).event; NOW = START + 1000; await get('club', ev.id); await E._billed(); assert.strictEqual(Object.keys(row(ev.id).billed).length, 1, 'the failed seat is taken off the row'); await get('club', ev.id); await E._billed(); await get('club', ev.id); await E._billed(); } finally { console.error = err0; }
    assert.strictEqual(calls.length, 2); assert.strictEqual(Object.keys(row(ev.id).billed).length, 2);
  } finally { D.limits = keep; }
};

// ================= M1: money rules are final once anyone else has joined =================
T.m1MoneyRulesFinalOnceSomeoneJoined = async () => {
  const mk0 = { playIn: true, myName: 'ann', entry: 20, split: '60/30/10', take: { kind: 'none' } }; let ev = ok(await call('ann', 'create', base(mk0))).event; const id = ev.id, code = ev.code, edit = (o) => call('ann', 'edit', Object.assign(base(mk0), { id }, o));
  // alone, the organizer may still change anything; the history says what changed, with old and new values
  ok(await call('ann', 'paid', { id, pid: ev.me, paid: true })); ev = ok(await edit({ entry: 25 })).event; assert.strictEqual(ev.money.entry, 25); assert.ok(ev.audit.some((a) => /Entry: \$20 per player → \$25 per player/.test(a.s)), 'old and new value in the history: ' + ev.audit.map((a) => a.s).join(' | '));
  assert.strictEqual(ev.pot.paid, 0, 'a changed entry clears the paid marks'); assert.strictEqual(ev.moneyFinal, false);
  for (const p of ['bob', 'cat', 'dan']) ok(await call(p, 'join', { code, myName: p })); ev = await get('ann', id); assert.strictEqual(ev.moneyFinal, true); for (const m of ev.members) ok(await call('ann', 'paid', { id, pid: m.pid, paid: true }));
  // the reviewer's attack: one minute before the start, take 50% and winner takes all; or entry $500
  NOW = START - 60e3; const m0 = JSON.stringify((await get('bob', id)).money);
  for (const [o, word] of [[{ entry: 25, take: { kind: 'pct', v: 50 }, split: '100' }, /take/], [{ entry: 500 }, /Entry stays \$25 per player/], [{ entry: 25, split: '70/30' }, /Payout split stays 60 \/ 30 \/ 10/], [{ entry: 25, pot: 'side' }, /Pot/], [{ entry: 25, fmt: 'se' }, /Format stays Round robin/], [{ entry: 0 }, /Entry/]]) { const r = no(await edit(o), 409, 'money change ' + JSON.stringify(o)); assert.ok(/final/i.test(r.error) && word.test(r.error), r.error); }
  ev = await get('bob', id); assert.strictEqual(JSON.stringify(ev.money), m0, 'nothing changed'); assert.strictEqual(ev.pot.paid, 4, 'paid marks kept'); assert.strictEqual(ev.fmt, 'rr');
  // a non-money detail may change: every member gets a notice and the history says what changed
  ev = ok(await edit({ entry: 25, courts: 4, to: 15, title: 'Rev3 moved' })).event; assert.strictEqual(ev.rules.courts, 4); const hist = ev.audit.map((a) => a.s);
  assert.ok(hist.some((s) => /Courts: 2 → 4/.test(s)) && hist.some((s) => /Games to: 11 → 15/.test(s)) && hist.some((s) => /Name: Rev3 test → Rev3 moved/.test(s)), hist.join(' | ')); assert.ok(!hist.includes('Rules changed'), 'never a bare "Rules changed"');
  const seen = await get('dan', id); assert.ok(seen.notice && /Courts: 2 → 4/.test(seen.notice.text) && /Games to: 11 → 15/.test(seen.notice.text), 'a notice to every member: ' + JSON.stringify(seen.notice)); assert.ok(Array.isArray(seen.notices) && seen.notices.length === 1);
  const before = (await get('ann', id)).audit.length; ok(await edit({ entry: 25, courts: 4, to: 15, title: 'Rev3 moved' })); assert.strictEqual((await get('ann', id)).audit.length, before, 'saving the same rules again writes nothing');
  // once everyone else has left, the organizer is alone again
  for (const p of ['bob', 'cat', 'dan']) ok(await call(p, 'leave', { id })); ev = ok(await edit({ entry: 30, courts: 4, to: 15, title: 'Rev3 moved' })).event; assert.strictEqual(ev.money.entry, 30);
  assert.ok(/final/i.test(CLIENT) && /Money rules are final/.test(CLIENT), 'the screens say so');
};

// ================= M2: the last playoff spot across pools is never decided silently =================
const poolPlay = (level) => (m, ev) => { const p = ev.pools[m.pool], ia = p.indexOf(m.a), ib = p.indexOf(m.b), lo = level ? 5 : 5 - m.pool; return ia < ib ? [11, lo] : [lo, 11]; };
T.m2LastPlayoffSpotAcrossPoolsIsAnOpenTie = async () => {
  const names = ['A1', 'B1', 'C1', 'C2', 'B2', 'A2', 'A3', 'B3', 'C3'];
  let ev = await typed(names, { pools: 3, playoff: 4 }); const id = ev.id; assert.strictEqual(ev.pools.length, 3); assert.deepStrictEqual(ev.wild && [ev.wild.per, ev.wild.spots, ev.wild.pos], [1, 1, 2], 'the screen is told the rule: top 1 of each pool + the best 2nd place');
  ev = await commPlayAll(id, Object.assign(poolPlay(true), { only: (m) => m.st === 'pool' }));
  // every pool has identical results: three 2nd places level on wins, differential and points for ONE spot
  assert.strictEqual(ev.matches.filter((m) => m.st === 'po').length, 0, 'no playoff is drawn while the spot is level'); assert.strictEqual(ev.ties.length, 1, 'an open tie: ' + JSON.stringify(ev.ties)); const t = ev.ties[0]; assert.strictEqual(t.cross, true); assert.strictEqual(t.spots, 1);
  const seconds = ev.tables.map((tb) => tb[1].name).sort(); assert.deepStrictEqual(t.names.slice().sort(), seconds, 'the three second places'); assert.strictEqual(ev.places, null, 'no places yet'); no(await call('org', 'finish', { id }), 409, 'finish waits for the tie');
  no(await call('fan', 'tiebreak', { id, key: t.key }), 404, 'a stranger'); ev = ok(await call('org', 'tiebreak', { id, key: t.key }), 'coin flip is the default').event;
  const po = ev.matches.filter((m) => m.st === 'po' && m.r === 1), inPo = new Set([].concat(...po.map((m) => [m.an, m.bn]))); assert.strictEqual(inPo.size, 4); const winners = ev.tables.map((tb) => tb[0].name); winners.forEach((w) => assert.ok(inPo.has(w), w + ' (pool winner) is in'));
  const lucky = [...inPo].filter((n) => !winners.includes(n)); assert.strictEqual(lucky.length, 1); assert.ok(seconds.includes(lucky[0]));
  const hist = ev.audit.map((a) => a.s).join(' | '); assert.ok(/across pools/.test(hist) && /coin flip/i.test(hist) && hist.includes(lucky[0]), 'logged: ' + hist); assert.ok(ev.tbLog.some((x) => /across pools, coin flip/.test(x.text)), 'shown: ' + JSON.stringify(ev.tbLog)); assert.deepStrictEqual(ev.wild.decided, [{ name: lucky[0], how: 'coin flip' }]);
  // which one gets it is the flip, not the pool order: over many events every pool's 2nd place gets the spot sometimes
  const got = new Set(); for (let i = 0; i < 40 && got.size < 3; i++) { reset(); let e2 = await typed(names, { pools: 3, playoff: 4 }); e2 = await commPlayAll(e2.id, Object.assign(poolPlay(true), { only: (m) => m.st === 'pool' })); e2 = ok(await call('org', 'tiebreak', { id: e2.id, key: e2.ties[0].key, how: 'coin' })).event; const w2 = e2.tables.map((tb) => tb[0].name); got.add(e2.tables.findIndex((tb) => e2.wild.decided[0].name === tb[1].name)); }
  assert.strictEqual(got.size, 3, 'the flip can go to any pool: ' + [...got]);
  // the organizer may choose a playoff instead (stepladder), and then the playoff bracket is drawn from its result
  reset(); ev = await typed(names, { pools: 3, playoff: 4 }); ev = await commPlayAll(ev.id, Object.assign(poolPlay(true), { only: (m) => m.st === 'pool' })); ev = ok(await call('org', 'tiebreak', { id: ev.id, key: ev.ties[0].key, how: 'game' })).event; assert.strictEqual(ev.matches.filter((m) => m.st === 'po').length, 0);
  for (let i = 0; i < 2; i++) { const m = ev.matches.find((x) => x.st === 'tb' && x.state === 'ready'); NOW += 60e3; ev = ok(await call('org', 'score', { id: ev.id, m: m.id, games: [[11, 8]] })).event; } const tb = ev.matches.filter((m) => m.st === 'tb'); assert.strictEqual(tb.length, 2); const champ = tb[1].win === 'a' ? tb[1].an : tb[1].bn;
  assert.ok(ev.matches.filter((m) => m.st === 'po' && m.r === 1).some((m) => m.an === champ || m.bn === champ), 'the tiebreak playoff winner takes the spot'); assert.deepStrictEqual(ev.wild.decided, [{ name: champ, how: 'tiebreak playoff' }]);
  // records that differ decide it without the organizer, by the stated rule, and the history says so
  reset(); ev = await typed(names, { pools: 3, playoff: 4 }); ev = await commPlayAll(ev.id, Object.assign(poolPlay(false), { only: (m) => m.st === 'pool' })); assert.strictEqual(ev.ties.length, 0); assert.strictEqual(ev.matches.filter((m) => m.st === 'po' && m.r === 1).length, 2);
  const best = ev.tables.map((tb) => tb[1]).sort((a, b) => b.diff - a.diff)[0].name; assert.deepStrictEqual(ev.wild.decided, [{ name: best, how: 'record' }]); assert.ok(ev.audit.some((a) => /Last playoff spot across pools/.test(a.s) && a.s.includes(best) && /by record/.test(a.s)), 'logged');
  assert.ok(/never decided by pool order/.test(CLIENT) && /e\.wild/.test(CLIENT), 'the standings screen states the rule');
};

// ================= M3: pick'em, then claiming a typed-in seat =================
T.m3ClaimingASeatVoidsPicksOnItsMatches = async () => {
  let ev = ok(await call('org', 'create', base({ fmt: 'de', pickem: true, playIn: false, myName: 'org', entrants: ['G1', 'G2', 'G3', 'G4'].map((n) => ({ name: n })) }))).event; const id = ev.id, claim = ev.entrants.find((x) => x.name === 'G1').players[0].claim;
  ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' })); ok(await call('pal', 'join', { code: ev.code, as: 'spectator', myName: 'pal' })); NOW = START + 1000; ev = await get('org', id);
  const r1 = ev.matches.filter((m) => m.st === 'w' && m.r === 1), own = r1.find((m) => m.an === 'G1' || m.bn === 'G1'), other = r1.find((m) => m !== own), against = own.an === 'G1' ? 'b' : 'a';
  ok(await call('fan', 'pick', { id, m: own.id, side: against })); ok(await call('fan', 'pick', { id, m: other.id, side: 'a' })); ok(await call('pal', 'pick', { id, m: own.id, side: against }));
  ev = ok(await call('fan', 'claim', { claim, myName: 'fan' }), 'fan takes the seat of G1').event;
  assert.ok(!(own.id in ev.pickem.mine), 'the pick on his own match is gone'); assert.ok(other.id in ev.pickem.mine, 'his other pick stays'); assert.deepStrictEqual(ev.pickem.voided.map((v) => v.m), [own.id], 'shown to him as voided');
  assert.ok(ev.notice && /voided/.test(ev.notice.text) && /fan/.test(ev.notice.text), 'a notice: ' + JSON.stringify(ev.notice)); assert.ok((await get('pal', id)).notice, 'every member sees it'); assert.ok(ev.audit.some((a) => a.a === 'pickvoid'), 'in the history');
  no(await call('fan', 'pick', { id, m: own.id, side: against }), 403, 'and he cannot pick it again');
  // G1 loses: the voided pick scores nothing; pal's (a real spectator's) pick does
  NOW += 60e3; ok(await call('org', 'score', { id, m: own.id, games: [against === 'a' ? [11, 2] : [2, 11]] })); ev = await get('fan', id); const tb = ev.pickem.table;
  assert.deepStrictEqual([tb.find((x) => x.name === 'fan').right, tb.find((x) => x.name === 'fan').n], [0, 0], 'no credit for the pick against his own seat'); assert.strictEqual(tb.find((x) => x.name === 'pal').right, 1);
  // later matches of his entry cannot be picked either
  ev = await get('fan', id); const next = ev.matches.find((m) => m.state === 'ready' && (m.an === 'fan' || m.bn === 'fan' || m.an === 'G1' || m.bn === 'G1')); if (next) no(await call('fan', 'pick', { id, m: next.id, side: 'a' }), 403);
  assert.ok(/voided/.test(CLIENT), 'the pick\'em screen shows voided picks');
};

// ================= M4: the rating guard covers every format; 2 per pair per rolling 24 hours =================
T.m4EventsWithFewerThanThreeAccountsAreUnratedInEveryFormat = async () => {
  for (const o of [{ fmt: 'rr' }, { fmt: 'se' }, { fmt: 'de' }]) { reset(); let ev = await mk(['amy', 'ben'], o); for (let g = 0; g < 4; g++) { const m = ev.matches.find((x) => x.state === 'ready'); if (!m) break; ev = await playAcct(ev.id, m, [[11, 3]]); }
    const recs = await matchRecs('amy'); assert.ok(recs.length >= 1); assert.ok(recs.every((x) => x.extra.confirmed === false && /fewer than 3 accounts/.test(x.extra.unrated)), o.fmt + ': two accounts alone are not rated: ' + JSON.stringify(recs.map((x) => x.extra.unrated)));
    assert.strictEqual(recs[0].verified, true, 'the result itself stays a confirmed result'); assert.strictEqual(recs[0].extra.confirmation.confirmed, true); assert.strictEqual(recs[0].extra.confirmation.rated, false); assert.strictEqual(recs[0].extra.confirmation.eventAccounts, 2);
    const rt = await E.ratingFor('acct-amy', 'pickleball'); if (KIT.standRatings) assert.deepStrictEqual([rt.confirmedGames, rt.use], [0, 1500], o.fmt + ': the rating does not move'); }
  // repeat it in new events for three days: still nothing
  reset(); for (let d = 0; d < 3; d++) { NOW = Z('2026-11-17T18:00:00Z') + d * DAY; const st = NOW + 2 * HOUR; let ev = ok(await call('amy', 'create', base({ start: st, playIn: true, myName: 'amy' }))).event; ok(await call('ben', 'join', { code: ev.code, myName: 'ben' })); NOW = st + 1000; ev = await get('amy', ev.id); await playAcct(ev.id, ev.matches[0], [[11, 0]]); }
  E._reset(); if (KIT.standRatings) assert.strictEqual((await E.ratingFor('acct-amy', 'pickleball')).use, 1500, 'three days of two-account round robins: 1500');
  // a third account with confirmed play makes the event count (all of it), three accounts who only signed up do not
  reset(); let ev = await mk(['amy', 'ben', 'cal']); const ms = ev.matches.filter((m) => m.st === 'pool'), ab = ms.find((m) => [m.an, m.bn].sort().join() === 'amy,ben'); await playAcct(ev.id, ab, [[11, 5]]);
  assert.strictEqual((await matchRecs('amy'))[0].extra.confirmed, false, 'three signed up, only two have confirmed play: not rated yet'); const ac = ms.find((m) => [m.an, m.bn].sort().join() === 'amy,cal'); await playAcct(ev.id, ac, [[11, 5]]);
  assert.deepStrictEqual((await matchRecs('amy')).map((x) => x.extra.confirmed), [true, true], 'with a third account in confirmed play, the event is rated');
};
T.m4TwoPerPairPerRolling24Hours = async () => {
  // four matches in 20 minutes around midnight Central (two before, two after): only two are rated
  NOW = Z('2026-11-17T18:00:00Z'); const st = Z('2026-11-21T05:00:00Z'); let ev = ok(await call('amy', 'create', base({ fmt: 'h2h', endDay: '2026-11-30', start: st, playIn: true, myName: 'amy' }))).event; const id = ev.id; for (const p of ['ben', 'cal']) ok(await call(p, 'join', { code: ev.code, myName: p }));
  NOW = Z('2026-11-22T05:40:00Z'); ev = await get('amy', id); const e = eidsOf(ev); await h2hMatch(id, 'cal', 'amy', [[11, 9]], e); // 23:41 Central, Nov 21
  NOW = Z('2026-11-22T05:48:00Z'); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); NOW = Z('2026-11-22T06:05:00Z'); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); // 00:06 Central, Nov 22
  let vs = (await matchRecs('amy')).filter((x) => x.opponent === 'ben'); assert.deepStrictEqual([...new Set(vs.map((x) => x.date))], ['2026-11-21', '2026-11-22'], 'the four straddle midnight Central'); assert.deepStrictEqual(vs.map((x) => x.extra.confirmed), [true, true, false, false], 'two per pair in any 24 hours');
  assert.ok(/24 hours/.test(vs[3].extra.unrated)); assert.strictEqual(vs[3].extra.confirmation.rated, false); assert.strictEqual(vs[3].extra.confirmation.confirmed, true);
  // 23 hours 50 minutes after the first: still inside the window. 24 hours and a bit after the SECOND: rated again.
  NOW = Z('2026-11-23T05:40:00Z'); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e); NOW = Z('2026-11-23T06:00:00Z'); await h2hMatch(id, 'amy', 'ben', [[11, 0]], e);
  vs = (await matchRecs('amy')).filter((x) => x.opponent === 'ben'); assert.deepStrictEqual(vs.map((x) => x.extra.confirmed), [true, true, false, false, false, true]);
};

// ================= M5: contrast (the full check runs in the Playwright harness on every screen) =================
T.m5LightThemeTextColoursPassContrast = async () => {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }, cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const blk = /html:not\(\.cb\) body:not\(\.dark\) ' \+ R \+ '\{([^}]*)\}/.exec(CLIENT); assert.ok(blk, 'a light-theme block'); const v = {}; blk[1].split(';').forEach((kv) => { const i = kv.indexOf(':'); v[kv.slice(0, i)] = kv.slice(i + 1); }); const hex = (s) => { const m = /#[0-9a-f]{6}/i.exec(String(s)); return m ? m[0] : null; };
  for (const k of ['--gg', '--gr', '--gyt', '--gm']) { assert.ok(hex(v[k]), 'the light theme sets its own ' + k + ' for text'); for (const bg of ['#ffffff', '#ece6fb', '#f6f4fb', '#fdf2d6']) assert.ok(cr(hex(v[k]), bg) >= 4.5, k + ' ' + hex(v[k]) + ' on ' + bg + ' = ' + cr(hex(v[k]), bg).toFixed(2)); }
  assert.ok(cr('#ffffff', hex(v['--pbg'])) >= 4.5, 'white on the primary button'); assert.ok(/a\.epri\{color:var\(--pfg\)\}/.test(CLIENT), '"Text it" (a link styled as the primary button) takes the button text colour, not the page ink');
  assert.ok(/--gyt:var\(--gold,/.test(CLIENT) && /--pfg:var\(--onblue,/.test(CLIENT), 'gold text and text on the brand colour follow the merged build\'s theme variables (--gold, --onblue)');
};

// ================= M6: one rating per named sport =================
T.m6OtherSportsEachHaveTheirOwnRating = async () => {
  const oth = { sport: 'cornhole', to: 21, winBy: 1, seeding: 'oddable' }; let ev = await mk(['amy', 'ben', 'cal', 'dan'], Object.assign({ fmt: 'h2h', endDay: '2026-11-30' }, oth)); const e = eidsOf(ev); await h2hMatch(ev.id, 'amy', 'ben', [[21, 10]], e); await h2hMatch(ev.id, 'amy', 'cal', [[21, 12]], e); await h2hMatch(ev.id, 'amy', 'dan', [[21, 12]], e); // three different accounts confirm
  const rec = (await matchRecs('amy'))[0]; assert.deepStrictEqual([rec.sport, rec.extra.game, rec.extra.ratingKey], ['other', 'cornhole', 'other:cornhole'], 'the stats contract: sport other, the game by name, rating key other:<name>');
  E._reset(); NOW = Z('2026-11-24T18:00:00Z'); const seat = (x) => x.entrants[0].players[0].odd, mkE = async (sport) => ok(await call('amy', 'create', base({ title: sport + ' night', sport, to: sport === 'cornhole' ? 21 : 0, winBy: 1, seeding: 'oddable', playIn: true, myName: 'amy', start: Z('2026-12-05T15:00:00Z') }))).event;
  const corn = seat(await mkE('cornhole')); assert.ok(corn && corn.rating > 1500 && corn.confirmed === 3, 'the cornhole rating shows in a cornhole event: ' + JSON.stringify(corn));
  for (const sp of ['darts', 'bowling', 'pool', 'basketball', 'other']) { const o = seat(await mkE(sp)); assert.ok(!o || (o.rating == null && !o.matches), sp + ' must not show the cornhole rating: ' + JSON.stringify(o)); }
};

// ================= LOW =================
T.l1NoStalePaidAfterClaimUnmarkLeave = async () => {
  let ev = ok(await call('org', 'create', base({ playIn: false, myName: 'org', entry: 10, split: '100', entrants: [{ name: 'Al' }, { name: 'Bo' }] }))).event; const id = ev.id, al = ev.entrants.find((x) => x.name === 'Al').players[0];
  ok(await call('org', 'paid', { id, gid: al.gid, paid: true })); ok(await call('org', 'paid', { id, gid: ev.entrants[1].players[0].gid, paid: true })); assert.strictEqual((await get('org', id)).pot.paid, 2);
  ev = ok(await call('zed', 'claim', { claim: al.claim, myName: 'zed' })).event; assert.strictEqual(ev.pot.paid, 2, 'the paid mark moved to the account'); ev = ok(await call('org', 'paid', { id, pid: ev.me, paid: false })).event; assert.strictEqual(ev.pot.paid, 1, 'un-marked');
  ok(await call('zed', 'leave', { id })); ev = await get('org', id); assert.strictEqual(ev.pot.paid, 1, 'after he leaves, Al\'s seat is NOT paid again (pot paid ' + ev.pot.paid + ')'); assert.strictEqual(ev.entrants.find((x) => x.name === 'Al').players[0].paid, false);
  // and a claimer who stays marked paid leaves the seat paid (the organizer has the money)
  const al2 = ev.entrants.find((x) => x.name === 'Al').players[0]; ev = ok(await call('yul', 'claim', { claim: al2.claim, myName: 'yul' })).event; ok(await call('org', 'paid', { id, pid: ev.me, paid: true })); ok(await call('yul', 'leave', { id })); assert.strictEqual((await get('org', id)).pot.paid, 2);
};
T.l2NoBrandNamesOnScreens = async () => {
  for (const [n, src] of [['pics/events.js', CLIENT], ['odds-api/events.js', SERVER], ['pics/catalog.js', CATJS], ['pics/games-catalog.json', CATJSON]]) assert.ok(!/DUPR|GHIN|USGA/i.test(src), n + ' names no rating brand');
  assert.ok(/e\.g\. 3\.5 skill level/.test(CLIENT), 'the rating placeholders say "e.g. 3.5 skill level"'); const r = no(await call('ann', 'create', base({ playIn: true, myRating: 'abc' })), 400); assert.ok(/3\.5 skill level/.test(r.error), r.error);
};
T.l3InvitePreviewSizedForAClubOnOneWifi = async () => {
  const ev = ok(await call('ann', 'create', base({ playIn: true }))).event, code = ev.code, ip = '44.1.2.3'; let bad = 0;
  for (let round = 0; round < 2; round++) for (let i = 0; i < 500; i++) { const r = await call('', 'peek', { code, dev: 'phone-' + String(i).padStart(4, '0') + '-abcd' }, ip); if (r.s !== 200) bad++; }
  assert.strictEqual(bad, 0, bad + ' of 1,000 signed-out previews (500 phones on one Wi-Fi, twice each) were refused');
  // ten wrong codes from ONE phone block that phone, not the Wi-Fi
  for (let i = 0; i < 10; i++) no(await call('', 'peek', { code: 'ZZZZ-ZZ' + String(i).padStart(2, '2'), dev: 'typo-phone-0001' }, ip), 404); no(await call('', 'peek', { code, dev: 'typo-phone-0001' }, ip), 429, 'the phone that guessed is blocked');
  ok(await call('', 'peek', { code, dev: 'phone-0001-abcd' }, ip), 'everyone else on that Wi-Fi still gets in'); ok(await call('', 'peek', { code, dev: 'brand-new-phone-9' }, ip));
  // one phone hammering one code is limited on its own; guessing with a new device id each time still ends at the IP limit
  let lim = 0; for (let i = 0; i < 40; i++) if ((await call('', 'peek', { code, dev: 'hammer-phone-01' }, ip)).s === 429) lim++; assert.ok(lim >= 5, 'per phone + code: ' + lim); ok(await call('', 'peek', { code, dev: 'phone-0002-abcd' }, ip));
  let blocked = false; for (let i = 0; i < 260 && !blocked; i++) { const r = await call('', 'peek', { code: 'YYYY-' + (2000 + i), dev: 'rot-' + i + '-device' }, '45.9.9.9'); if (r.s === 429) blocked = true; } assert.ok(blocked, 'a guesser who rotates device ids is stopped at the IP');
  // phones on an older app version send no device id: still fine for a club on one Wi-Fi
  E._reset(); bad = 0; for (let i = 0; i < 1000; i++) if ((await call('', 'peek', { code }, ip)).s !== 200) bad++; assert.strictEqual(bad, 0, bad + ' of 1,000 previews without a device id refused');
  // signed in: 500 members of a club opening the join screen twice from one Wi-Fi
  E._reset(); bad = 0; for (let round = 0; round < 2; round++) for (let i = 0; i < 500; i++) { const r = await call('m' + i, 'preview', { code }, ip); if (r.s !== 200) bad++; } assert.strictEqual(bad, 0, bad + ' of 1,000 signed-in previews refused');
  assert.ok(/post\('peek', \{ code, dev: dev\(\) \}\)/.test(CLIENT), 'the app sends its device id with the signed-out preview');
};
T.l7l9SmallOnes = async () => {
  for (const t of [{ a: 1 }, ['x', 'y'], true, null]) no(await call('ann', 'create', base({ title: t })), 400, 'a title that is not text: ' + JSON.stringify(t));
  let ev = await mk(['ann', 'bob', 'cat']); NOW = Z('2026-11-17T18:00:00Z'); ev = ok(await call('ann', 'create', base({ playIn: true }))).event; ok(await call('bob', 'join', { code: ev.code, myName: 'bob' }));
  const [a, b] = await Promise.all([call('bob', 'leave', { id: ev.id }), call('bob', 'leave', { id: ev.id })]); assert.deepStrictEqual([a.s, b.s], [200, 200], 'leave sent twice at once: both answer 200 (' + a.s + ', ' + b.s + ')'); assert.strictEqual((await get('ann', ev.id)).members.length, 1);
};
T.lowScreensDrillDownWithABack = async () => {
  assert.ok(/a === 'ent'\) \{ drill\(\{ mf: 'ent'/.test(CLIENT) && /const drill = /.test(CLIENT), 'L4: a standings row opens the matches of that entry as its own screen (Back returns to Standings)');
  assert.ok(!/data-tab="' \+ \(e\.fin \? 'table' : 'matches'\)/.test(CLIENT) && /data-a="drill"/.test(CLIENT), 'L5: the Status tile opens its own screen with the filter cleared');
  assert.ok(/data-a="money" data-k="pot"/.test(CLIENT) && /data-a="money" data-k="pool"/.test(CLIENT) && /function moneyV/.test(CLIENT), 'L6: the pot and the prize pool are tappable');
  assert.ok(/does not count toward the Oddable rating: only an account on the other side/.test(CLIENT), 'the neutral commissioner is told his OK is not a rated confirmation');
  const calls = (CLIENT.match(/clipboard\.writeText\(/g) || []).length; assert.ok(calls >= 1 && /\.then\(\(\) => \{ b2\.textContent = 'Copied'; \}\)\.catch\(byHand\)/.test(CLIENT), 'clipboard: "Copied" only when it was, a .catch on the promise');
};

// ================= 10: "lock" is the weekly picks' word; events say final / closed =================
T.w10EventsSayFinalAndClosedNotLock = async () => {
  const lits = (src) => { const out = [], s = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''), re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g; let m; while ((m = re.exec(s))) if (/\b(un)?lock(s|ed|ing)?\b/i.test(m[0])) out.push(m[0].slice(0, 90)); return out; };
  assert.deepStrictEqual(lits(CLIENT), [], 'pics/events.js: no screen text says lock'); assert.deepStrictEqual(lits(CATJS), [], 'pics/catalog.js');
  assert.deepStrictEqual(lits(SERVER).filter((x) => !/^'lock:/.test(x)), [], 'odds-api/events.js: no message or history line says lock (row ids start with lock: by the storage rule)');
  const cat = JSON.parse(CATJSON), txt = []; Object.keys(cat.games || cat).forEach((k) => { const g = (cat.games || cat)[k]; if (g && typeof g === 'object' && ['rr', 'se', 'de', 'ladder', 'h2h', 'solo', 'winner'].includes(k)) txt.push(JSON.stringify(g)); }); assert.ok(!/\block/i.test(txt.join(' ')), 'the catalog entries for local events');
  assert.ok(/Picks are final when you enter them/.test(CLIENT) && /Picks close at /.test(CLIENT), '"Picks are final when you enter them", "Picks close at 6:00 PM"');
  let ev = ok(await call('pk', 'create', base({ fmt: 'se', pickem: true, playIn: false, myName: 'pk', entrants: ['A', 'B', 'C', 'D'].map((n) => ({ name: n })) }))).event; const id = ev.id; ok(await call('fan', 'join', { code: ev.code, as: 'spectator', myName: 'fan' })); NOW = START + 1000; ev = await get('pk', id);
  ok(await call('fan', 'pick', { id, m: ev.matches[0].id, side: 'a' })); let r = no(await call('fan', 'pick', { id, m: ev.matches[0].id, side: 'b' }), 409); assert.ok(/Picks are final when you enter them/.test(r.error), r.error);
  ev = ok(await call('pk', 'picklock', { id, round: ev.pickem.rounds[0].key, at: NOW + 3600e3 })).event; assert.ok(ev.audit.some((a) => /picks close at .* CT/.test(a.s)), 'history: picks close at <time>'); r = no(await call('pk', 'edit', Object.assign(base({ fmt: 'se', pickem: true }), { id })), 409); assert.ok(/Rules are final/.test(r.error), r.error);
  assert.ok(!/lock/i.test(JSON.stringify(ev.audit.map((a) => a.s))), 'no history line says lock');
};

// ================= 11: a money event is not seeded by the Oddable rating alone =================
T.s11MoneyEventOrganizerSeesConfirmedGamesAndSetsSeeds = async () => {
  // amy has confirmed, rated games; then a money event seeded by rating
  let ev = await mk(['amy', 'ben', 'cal', 'dan'], { fmt: 'h2h', endDay: '2026-11-30' }); let e = eidsOf(ev); for (const o of ['ben', 'cal', 'dan']) await h2hMatch(ev.id, 'amy', o, [[11, 3]], e); E._reset(); // three different accounts confirmed amy's wins
  NOW = Z('2026-11-24T18:00:00Z'); const st = Z('2026-12-05T15:00:00Z'); ev = ok(await call('org', 'create', base({ title: 'Money night', fmt: 'se', seeding: 'rating', entry: 20, split: '100', start: st, playIn: false, myName: 'org', entrants: [{ name: 'Newbie' }] }))).event; const id = ev.id;
  for (const p of ['dee', 'amy', 'ben']) ok(await call(p, 'join', { code: ev.code, myName: p })); ev = await get('org', id);
  assert.strictEqual(ev.moneyEvent, true); assert.ok(Array.isArray(ev.seedPlan) && ev.seedPlan.length === 4, 'the organizer is shown the seeds the draw would use'); const nm = (list) => list.map((x) => ev.entrants.find((y) => y.eid === x).name);
  assert.strictEqual(nm(ev.seedPlan)[0], 'amy', 'by rating: amy first'); const amy = ev.entrants.find((x) => x.name === 'amy').players[0].odd; assert.deepStrictEqual([amy.confirmed, amy.matches], [3, 3], 'each player\'s x of y games confirmed goes to the organizer');
  assert.strictEqual((await get('ben', id)).seedPlan, null, 'only the organizer'); no(await call('ben', 'seeds', { id, eid: ev.seedPlan[0], do: 'down' }), 403);
  // he moves Newbie (whom he knows) to the top seed
  const newbie = ev.entrants.find((x) => x.name === 'Newbie').eid; ev = ok(await call('org', 'seeds', { id, eid: newbie, to: 1 })).event; assert.strictEqual(nm(ev.seedPlan)[0], 'Newbie'); assert.strictEqual(ev.seedSet, true); assert.ok(ev.audit.some((a) => /Seed set by the organizer: Newbie from \d\w+ to 1st seed/.test(a.s)), 'logged for everyone');
  ev = ok(await call('org', 'seeds', { id, eid: ev.seedPlan[1], do: 'down' })).event; const plan = nm(ev.seedPlan); assert.strictEqual((await get('ben', id)).seedSet, true, 'members are told the seeds were set by hand');
  NOW = st + 1000; ev = await get('org', id); assert.deepStrictEqual(ev.entrants.slice().sort((a, b) => a.seed - b.seed).map((x) => x.name), plan, 'the draw uses the organizer\'s seeds'); assert.ok(ev.audit.some((a) => /seeded by the organizer/.test(a.s)), 'the draw line says so');
  no(await call('org', 'seeds', { id, eid: newbie, do: 'down' }), 409, 'final at the start');
  assert.ok(/do not seed by the Oddable rating alone/.test(CLIENT) && /data-a="seed"/.test(CLIENT), 'the organizer\'s Seeds card');
};

// stats v1.2: `use` is null until 3 different accounts confirmed a player's games; `seed` is always a number. In a money event that is "the organizer sets the seeds".
T.s11bNoUsableRatingMeansTheOrganizerSetsTheSeeds = async () => {
  const keep = D.rt, base0 = D.rt(); D.rt = () => Object.assign({}, base0, { ratingFor: async (k, sp, o) => (k === 'acct-amy' ? { sport: sp, oddable: { rating: 1560, matches: 6 }, confirmedRating: 1548, confirmedGames: 5, event: null, setBy: null, use: 1548, seed: 1548, needsSet: false } : k === 'acct-ben' ? { sport: sp, oddable: { rating: 1610, matches: 4 }, confirmedRating: null, confirmedGames: 2, event: null, setBy: null, use: null, seed: 1500, needsSet: true, why: 'needs games confirmed by 3 different players' } : { sport: sp, oddable: { rating: null, matches: 0 }, confirmedRating: null, confirmedGames: 0, event: null, setBy: null, use: null, seed: 1500, needsSet: true, why: 'no confirmed games yet' }) });
  try { let ev = ok(await call('org', 'create', base({ title: 'Money', fmt: 'se', seeding: 'rating', entry: 20, split: '100', playIn: false, myName: 'org' }))).event; const id = ev.id; for (const p of ['ben', 'amy', 'cal']) ok(await call(p, 'join', { code: ev.code, myName: p })); ev = await get('org', id);
    const seat = (n) => ev.entrants.find((x) => x.name === n).players[0]; assert.deepStrictEqual([seat('amy').use, seat('amy').seed, seat('amy').needsSet], [1548, 1548, false]); assert.deepStrictEqual([seat('ben').use, seat('ben').seed, seat('ben').needsSet, seat('ben').why], [null, 1500, true, 'needs games confirmed by 3 different players'], 'a null `use` is shown as "needs the organizer", seeded at `seed`');
    assert.deepStrictEqual(ev.seedNeed.slice().sort(), ['ben', 'cal'], 'the organizer is told who has no usable rating'); assert.strictEqual(ev.entrants.find((x) => x.name === 'ben').oddRating, 1500); assert.strictEqual(ev.seedPlan.map((x) => ev.entrants.find((y) => y.eid === x).name)[0], 'amy');
    assert.ok(/You set the seeds/.test(CLIENT) && /data-a="seedkeep"/.test(CLIENT) && /no rating to use yet/.test(CLIENT), 'the Seeds card asks the organizer');
    // "These are my seeds": the order shown becomes the organizer's own, logged
    ev = ok(await call('org', 'seeds', { id, keep: true })).event; assert.strictEqual(ev.seedSet, true); assert.ok(ev.audit.some((a) => /Seeds confirmed by the organizer as shown: 1\. amy/.test(a.s))); NOW = START + 1000; ev = await get('org', id); assert.ok(ev.audit.some((a) => /seeded by the organizer/.test(a.s)));
    // an organizer who never looked: the draw still happens at the start, and the history says plainly what was done
    reset(); ev = ok(await call('org', 'create', base({ title: 'Money 2', fmt: 'se', seeding: 'rating', entry: 20, split: '100', playIn: false, myName: 'org' }))).event; for (const p of ['ben', 'amy', 'cal']) ok(await call(p, 'join', { code: ev.code, myName: p })); NOW = START + 1000; ev = await get('org', ev.id);
    assert.ok(ev.audit.some((a) => /2 players have no usable rating yet and were seeded as new players \(1500\)\. The organizer did not set the seeds\./.test(a.s)), ev.audit.map((a) => a.s).join(' | '));
  } finally { D.rt = keep; }
};

// ================= integration: an event that belongs to a group =================
// The group's row in the shape the Groups engine stores it ('lock:grp:<id>': comm + members by member key).
const gmk = (n) => require('crypto').createHash('sha256').update('oddable-group|acct-' + n).digest('hex').slice(0, 24);
const fakeGroups = (gid, comm, members) => ({ memberCheck: async (g, e) => (g !== gid ? null : e === 'acct-' + comm ? { member: true, comm: true } : members.includes(String(e).replace('acct-', '')) ? { member: true, comm: false } : null), attached: [], attachGame: async function (g, e, x) { if (g !== gid || e !== 'acct-' + comm) throw Object.assign(new Error('Only the commissioner can add games'), { status: 403 }); this.attached.push(x); await E.attachToGroup(x.ref, g, 'C' + this.attached.length); return { cid: 'C' + this.attached.length }; } });
T.g1JoinFromTheGroupMembersOnlyCapEnforced = async () => {
  assert.strictEqual(typeof E.attachToGroup, 'function'); assert.strictEqual(typeof E.joinFromGroup, 'function'); assert.strictEqual(typeof E.inviteInfo, 'function'); const keep = D.groups, G = fakeGroups('GRPA', 'ann', ['bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon']); D.groups = () => G;
  try { let ev = ok(await call('ann', 'create', base({ playIn: true, myName: 'ann', groupId: 'GRPA' })), 'the group\'s commissioner creates an event for the group').event; const id = ev.id, code = ev.code; assert.deepStrictEqual(ev.group, { id: 'GRPA' }); assert.deepStrictEqual(G.attached.map((x) => [x.type, x.ref]), [['event', id]], 'Groups was asked to list it');
    // a member of the group looks first, then joins, with the event's id (no code)
    let r = ok(await call('bob', 'gjoin', { id, preview: true })); assert.strictEqual(r.event.role, 'none'); assert.ok(!('code' in r.event) && !('members' in r.event), 'the preview shows no code and no people');
    ev = ok(await call('bob', 'gjoin', { id, myName: 'bob' }), 'a group member joins from the group').event; assert.strictEqual(ev.role, 'player'); assert.strictEqual(ev.entrants.length, 2); ok(await call('bob', 'gjoin', { id }), 'again: already in'); ok(await call('cat', 'gjoin', { id, as: 'spectator', myName: 'cat' }));
    // not in the group: refused from the group route, and by code, and with a claim code
    r = await call('zed', 'gjoin', { id }); assert.deepStrictEqual([r.s, r.j.code], [403, 'group']); r = await call('zed', 'gjoin', { id, preview: true }); assert.strictEqual(r.s, 403); r = await call('zed', 'join', { code, myName: 'zed' }); assert.deepStrictEqual([r.s, r.j.code], [403, 'group'], 'the invite code does not get an outsider in');
    r = ok(await call('zed', 'preview', { code })); assert.strictEqual(r.event.groupOnly, true, 'his preview says it belongs to a group'); assert.strictEqual(ok(await call('dan', 'preview', { code })).event.groupOnly, false);
    no(await call('zed', 'get', { id }), 404); no(await call('zed', 'gjoin', { id: 'AAAAAAAAAA' }), 404);
    // the people cap holds from the group too: 8 with the organizer
    for (const p of ['dan', 'eve', 'fay', 'gus', 'hal']) ok(await call(p, 'gjoin', { id, myName: p }), p); r = await call('ivy', 'gjoin', { id, myName: 'ivy' }); assert.strictEqual(r.s, 403); assert.ok(/full: 8 people/.test(r.j.error), r.j.error); assert.strictEqual((await get('ann', id)).people, 8);
    // server-side helper for the Groups engine, same checks
    await assert.rejects(E.joinFromGroup(id, 'acct-zed', {}), /Join the group first/); await assert.rejects(E.joinFromGroup(id, 'acct-jon', { myName: 'jon' }), /full/);
    // entries are final at the start, also from the group
    NOW = START + 1000; r = await call('jon', 'gjoin', { id, myName: 'jon' }); assert.ok(r.s === 409 || r.s === 403);
    // only the group's commissioner can create for it or attach to it; one group per event
    NOW = Z('2026-11-17T18:00:00Z'); r = await call('bob', 'create', base({ playIn: true, myName: 'bob', groupId: 'GRPA' })); assert.deepStrictEqual([r.s, r.j.code], [403, 'groupcomm'], 'a member cannot add a game to the group'); assert.strictEqual(Object.keys(db).filter((k) => k.startsWith('lock:evt:')).length, 1, 'and nothing was created');
    const own = ok(await call('bob', 'create', base({ playIn: true, myName: 'bob' }))).event; await assert.rejects(E.attachToGroup(own.id, 'GRPA', 'C9'), /commissioner/, 'the event\'s organizer must be the group\'s commissioner'); await assert.rejects(E.attachToGroup(id, 'GRPB', 'C1'), /commissioner|another group/);
    assert.strictEqual((await get('bob', own.id)).group, null); ok(await call('zed', 'join', { code: own.code, myName: 'zed' }), 'an event with no group is joined by code as before');
    // what the group's pot card reads, and the invite router's lookup
    const pot = await E.potSummary(id); assert.deepStrictEqual([typeof pot.pot, pot.take, pot.pool, pot.main, pot.over], ['number', 0, 0, true, false]); assert.deepStrictEqual(await E.inviteInfo(code, NOW), { kind: 'event', title: 'Rev3 test' }); assert.strictEqual(await E.inviteInfo('ZZZZ-ZZZZ', NOW), null);
  } finally { D.groups = keep; }
  // the phone: the hub's OddJoin.openGame('events', ref, {groupId, create: true}) and openGame(type, <event id>, {groupId})
  assert.ok(/\['e', 'event', 'events'\]\.forEach\(\(k\) => window\.OddJoin\.register\(k, fromHub\)\)/.test(CLIENT), 'registered for e / event / events'); assert.ok(/if \(c\.create\) return window\.OddEvents\.create\(\{ group:/.test(CLIENT) && /post\('gjoin', \{ id: s\.gj, preview: true \}\)/.test(CLIENT) && /groupId: d\.group \? d\.group\.id : undefined/.test(CLIENT));
};
T.g2GroupRowFallbackFailsClosed = async () => {
  // No fake here. On this branch alone: the group's row is read directly. In the merged build: the REAL Groups engine (memberCheck, attachGame) reads the same row.
  const GRPX = 'GRPXAAAA22'; db['lock:grp:' + GRPX] = { id: 'lock:grp:' + GRPX, salt: 'x', pinhash: 'x', data: { id: GRPX, name: 'Club', comm: gmk('ann'), members: [{ mk: gmk('ann'), pid: 'P1', name: 'ann' }, { mk: gmk('bob'), pid: 'P2', name: 'bob' }], contests: [], money: { msplit: { kind: 'entry' } }, u: 1 }, updated: 1 };
  assert.deepStrictEqual([await E.groupRole(GRPX, 'acct-ann'), await E.groupRole(GRPX, 'acct-bob'), await E.groupRole(GRPX, 'acct-zed'), await E.groupRole('NOPENOPE22', 'acct-ann'), await E.groupRole(GRPX, '')], ['comm', 'member', null, null, null]);
  const keep = D.S.dbGet; D.S.dbGet = async () => { throw new Error('db down'); }; assert.strictEqual(await E.groupRole(GRPX, 'acct-ann'), null, 'unreadable = not a member'); D.S.dbGet = keep;
  let ev = ok(await call('ann', 'create', base({ playIn: true, myName: 'ann', groupId: GRPX }))).event; assert.deepStrictEqual(ev.group, { id: GRPX }); ok(await call('bob', 'gjoin', { id: ev.id, myName: 'bob' })); assert.strictEqual((await call('zed', 'gjoin', { id: ev.id })).s, 403);
  const G = D.groups(); if (G && typeof G.attachGame === 'function') { const cs = db['lock:grp:' + GRPX].data.contests; assert.deepStrictEqual(cs.map((c) => [c.kind, c.type, c.ref]), [['ext', 'event', ev.id]], 'merged build: the real Groups engine lists the event on the group'); assert.strictEqual(row(ev.id).group.cid, cs[0].cid, 'and the event knows its contest id'); }
};
