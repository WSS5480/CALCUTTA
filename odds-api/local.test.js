// Run: node odds-api/local.test.js   (no network, no database: Supabase and sign-in are in-memory fakes; the clock is faked)
const assert = require('assert'), http = require('http'), E = require('./local'), D = E._deps;
let db = {}, slow = 0, lost = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
// main build: limits.js is in the tree but reads the real database module, so these engine suites pin the engine's own stand-ins (same names and
// signatures; the preview's merged build did the same). local.group.test.js runs the group gate with the REAL limits.js over the fake database.
D.limits = () => E.LIMSTAND; D.rt = () => E.STAND;
D.S = {
  dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
const ENT = new Set(['club']);
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); return t.startsWith('t-') ? 'acct-' + t.slice(2) : null; } });
D.enterprise = async (k) => ENT.has(String(k).replace('acct-', ''));
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const Z = (s) => Date.parse(s), HOUR = 3600e3, DAY = 864e5;
let NOW = Z('2026-11-17T18:00:00Z'); D.now = () => NOW;
const START = Z('2026-11-21T15:00:00Z');
const srv = http.createServer(async (req, res) => { if (!(await E._core(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/local/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(b || {}) }); const txt = await r.text(); raw.push({ who, txt }); return { s: r.status, j: JSON.parse(txt) }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); return r.j; };
const no = (r, s, m) => assert.strictEqual(r.s, s, (m || '') + ' expected ' + s + ' got ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const base = (o) => Object.assign({ title: 'Saturday Smash', sport: 'pickleball', fmt: 'rr', unit: 'singles', start: START, to: 11, winBy: 2, bestOf: 1, scoring: 'rally', seeding: 'rating', courts: 2, pools: 1, playoff: 0, entry: 20, split: '60/30/10', take: { kind: 'pct', v: 10 }, myName: 'Ann' }, o || {});
const M = (ev, f) => ev.matches.find(f);
const nm = (ev, eid) => ev.entrants.find((e) => e.eid === eid).name;
const win = (g) => (g === 'a' ? [[11, 6]] : [[6, 11]]);

// ---------- pure engine checks ----------
function pure() {
  const R = { to: 11, winBy: 2, bestOf: 1 };
  assert.ok(E.checkGames(R, [[11, 9]])); assert.ok(E.checkGames(R, [[12, 10]])); assert.ok(E.checkGames(R, [[9, 11]]).win === 'b');
  for (const g of [[[11, 10]], [[13, 10]], [[10, 8]], [[11, 11]], [[11, 9], [11, 3]], [], [[11.5, 3]], [[-1, 11]]]) assert.throws(() => E.checkGames(R, g), JSON.stringify(g));
  const R3 = { to: 11, winBy: 2, bestOf: 3 };
  assert.strictEqual(E.checkGames(R3, [[11, 7], [9, 11], [11, 5]]).win, 'a'); assert.strictEqual(E.checkGames(R3, [[3, 11], [5, 11]]).win, 'b');
  assert.throws(() => E.checkGames(R3, [[11, 7]]), 'bo3 needs 2'); assert.throws(() => E.checkGames(R3, [[11, 7], [11, 5], [11, 3]]), 'decided before game 3');
  assert.ok(E.checkGames({ to: 21, winBy: 2, bestOf: 1 }, [[23, 21]])); assert.throws(() => E.checkGames({ to: 15, winBy: 2, bestOf: 1 }, [[15, 14]]));
  assert.ok(E.checkGames({ to: 0, winBy: 1, bestOf: 1 }, [[187, 203]])); // bowling: higher total wins
  t('game scores: to 11/15/21 win by 2 (past the target exactly 2 ahead), best of 1/3/5, decided matches, highest-score sports');
  for (let n = 2; n <= 12; n++) {
    const ids = Array.from({ length: n }, (_, i) => 'e' + i), rounds = E.roundRobin(ids), seen = new Set(), byes = {};
    assert.strictEqual(rounds.length, n % 2 ? n : n - 1, 'rounds for ' + n);
    rounds.forEach((rd) => { const inR = new Set(); rd.forEach(([a, b]) => { if (a === null || b === null) { const x = a === null ? b : a; byes[x] = (byes[x] || 0) + 1; assert.ok(!inR.has(x)); inR.add(x); return; } assert.ok(!inR.has(a) && !inR.has(b), 'twice in a round'); inR.add(a); inR.add(b); const k = [a, b].sort().join('|'); assert.ok(!seen.has(k), 'pair twice ' + k); seen.add(k); }); assert.strictEqual(inR.size, n, 'everyone plays or sits each round'); });
    assert.strictEqual(seen.size, n * (n - 1) / 2, 'every pair once (' + n + ')');
    if (n % 2) ids.forEach((x) => assert.strictEqual(byes[x], 1, 'each sits out exactly once')); else assert.strictEqual(Object.keys(byes).length, 0);
  }
  t('round robin 2-12 entries: every pair exactly once, nobody twice in a round, odd counts: each entry has exactly one bye');
  assert.deepStrictEqual(E.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  // pool tiebreaks: A,B,C all 2-1 (A beat B, B beat C, C beat A -> h2h 1 each -> point differential); D 0-3
  const ev = { seeds: ['A', 'B', 'C', 'D'], matches: [] }; let k = 0;
  const add = (a, b, x, y) => ev.matches.push({ id: 'm' + k++, st: 'pool', pool: 0, a, b, state: 'confirmed', games: [[x, y]], win: x > y ? 'a' : 'b' });
  add('A', 'B', 11, 9); add('B', 'C', 11, 2); add('C', 'A', 11, 8); add('A', 'D', 11, 0); add('B', 'D', 11, 9); add('C', 'D', 11, 10);
  let tb = E.poolTable(ev, ['A', 'B', 'C', 'D'], 0); assert.deepStrictEqual(tb.map((r) => r.eid), ['A', 'B', 'C', 'D'], 'diff: A +12, B +9, C -7 ' + JSON.stringify(tb));
  // head-to-head beats point differential: E and F tied 2 wins, F beat E but E has the better differential
  const e2 = { seeds: ['E', 'F', 'G', 'H'], matches: [] }; k = 0; const ad2 = (a, b, x, y) => e2.matches.push({ id: 'n' + k++, st: 'pool', pool: 0, a, b, state: 'confirmed', games: [[x, y]], win: x > y ? 'a' : 'b' });
  ad2('F', 'E', 11, 9); ad2('E', 'G', 11, 0); ad2('E', 'H', 11, 0); ad2('F', 'G', 11, 9); ad2('H', 'F', 11, 9); ad2('G', 'H', 11, 9);
  tb = E.poolTable(e2, ['E', 'F', 'G', 'H'], 0); assert.deepStrictEqual(tb.slice(0, 2).map((r) => r.eid), ['F', 'E'], 'h2h first ' + JSON.stringify(tb));
  t('pool tiebreak order: wins, then head-to-head among the tied, then point differential (3-way circle tie falls to differential)');
}

srv.listen(0, async () => {
  P = srv.address().port; let r, j;
  try {
    pure();
    no(await call(null, 'mine'), 401); t('signed-out request refused');
    // ---------- validation ----------
    const bads = [{ title: 'x' }, { sport: 'chess' }, { fmt: 'swiss' }, { to: 12 }, { winBy: 1 }, { bestOf: 2 }, { start: NOW - 1 }, { seeding: 'vibes' }, { courts: 0 }, { pools: 9 }, { playoff: 3 }, { take: { kind: 'pct', v: 51 } }, { take: { kind: 'flat', v: -1 } }, { entry: 2.5 }, { fmt: 'ladder' }, { fmt: 'ladder', endDay: '2026-11-01' }, { split: '90/10' }];
    for (const o of bads) { E._reset(); no(await call('ann', 'create', base(o), '7.7.' + JSON.stringify(o).length + '.1'), 400, JSON.stringify(o)); }
    E._reset(); t('every bad option refused (' + bads.length + ' cases)');
    // ---------- round robin + playoff, courts, byes, scorer flow ----------
    j = ok(await call('ann', 'create', base({ playoff: 2, entrants: [{ name: 'Bea', rating: 4.1 }, { name: 'Cy<script>', rating: 3.2 }, { name: 'Di', rating: 3.9 }, { name: 'Ed', rating: '' }], playIn: true, myRating: 4.5 })));
    let ev = j.event; const rr = ev.id, code = ev.code;
    assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code)); assert.ok(!JSON.stringify(ev).includes('<script'), 'names cleaned'); assert.strictEqual(ev.entrants.length, 5); assert.strictEqual(ev.people, 5, 'ann + 4 guests');
    assert.ok(ev.entrants.find((e) => e.name === 'Bea').players[0].claim, 'commissioner sees guest claim codes');
    const pk = ok(await call(null, 'peek', { code })); assert.deepStrictEqual(Object.keys(pk).sort(), ['kind', 'title']); t('public peek by invite code returns only title + kind');
    // bob joins and claims the guest seat "Bea" (as a player) before the start
    const bea = ev.entrants.find((e) => e.name === 'Bea').eid, cy = ev.entrants.find((e) => /^Cy/.test(e.name)).eid, di = ev.entrants.find((e) => e.name === 'Di').eid, ed = ev.entrants.find((e) => e.name === 'Ed').eid, ann = ev.myEntries[0];
    j = ok(await call('bob', 'preview', { code: code.toLowerCase() })); assert.strictEqual(j.event.role, 'none'); assert.ok(j.event.takeText.includes('10%')); assert.ok(!j.event.members && !j.event.code, 'preview has no member list or code');
    no(await call('bob', 'join', { code, as: 'player', eid: bea, myName: 'Bob' }), 403, 'a named guest seat needs its claim code (review fix 2)');
    const cl0 = ok(await call('ann', 'get', { id: rr })).event, clOf = (eid) => cl0.entrants.find((e) => e.eid === eid).players[0].claim;
    ev = ok(await call('bob', 'claim', { claim: clOf(bea), myName: 'Bob' })).event; assert.strictEqual(ev.people, 5, 'claiming a guest seat does not add a person');
    ev = ok(await call('cat', 'claim', { claim: clOf(cy), myName: 'Cat' })).event;
    no(await call('bob', 'entrant', { id: rr, do: 'add', name: 'Zed' }), 403, 'only the commissioner edits entries');
    no(await call('bob', 'draw', { id: rr }), 403); no(await call('zed', 'get', { id: rr }), 404, 'non-member cannot read');
    t('create with typed guests + organizer playing; join by code claims a seat; roles enforced; private to members');
    // lock at start
    NOW = START + 1000; ev = ok(await call('ann', 'get', { id: rr })).event; assert.ok(ev.drawn, 'auto draw at the start');
    no(await call('ann', 'edit', Object.assign(base(), { id: rr })), 409, 'edit after start');
    no(await call('ann', 'entrant', { id: rr, do: 'add', name: 'Late' }), 409, 'entries locked');
    no(await call('dan', 'join', { code, as: 'player', myName: 'Dan' }), 409, 'no new players after start');
    ok(await call('dan', 'join', { code, as: 'spectator', myName: 'Dan' }));
    t('rules and entries lock at the start (server), auto draw at the start, spectators can still join');
    // schedule: 5 entries -> 5 rounds, 2 matches + 1 bye each, courts 1-2
    const pool = ev.matches.filter((m) => m.st === 'pool'); assert.strictEqual(pool.length, 10); assert.strictEqual(Object.keys(ev.byes).length, 5); Object.values(ev.byes).forEach((b) => assert.strictEqual(b.length, 1));
    pool.forEach((m) => assert.ok(m.court === 1 || m.court === 2)); assert.strictEqual(ev.entrants.find((e) => e.eid === ann).seed, 1, 'Ann 4.5 is the top seed');
    t('round robin 5: 10 matches over 5 rounds, one bye per round, courts 1-2, rating seeding');
    // scorer / confirm / dispute
    const mAB = M(ev, (m) => [m.a, m.b].sort().join() === [ann, bea].sort().join()), annIsA = mAB.a === ann;
    const scoreAnnWins = annIsA ? [[11, 4]] : [[4, 11]];
    no(await call('cat', 'score', { id: rr, m: mAB.id, games: scoreAnnWins, v: mAB.v }), 403, 'not in the match');
    no(await call('dan', 'score', { id: rr, m: mAB.id, games: scoreAnnWins, v: mAB.v }), 403, 'spectator');
    const scorer = annIsA ? 'ann' : 'bob', other = annIsA ? 'bob' : 'ann';
    no(await call(other, 'score', { id: rr, m: mAB.id, games: scoreAnnWins, v: mAB.v }), 403, 'designated scorer is side a');
    ev = ok(await call(scorer, 'score', { id: rr, m: mAB.id, games: scoreAnnWins, v: mAB.v, op: 'q1' })).event; let mm = M(ev, (m) => m.id === mAB.id); assert.strictEqual(mm.state, 'pending');
    ev = ok(await call(scorer, 'score', { id: rr, m: mAB.id, games: scoreAnnWins, v: mAB.v, op: 'q1' })).event; assert.strictEqual(M(ev, (m) => m.id === mAB.id).state, 'pending', 'offline resend with the same op id is a no-op');
    no(await call(scorer, 'confirm', { id: rr, m: mAB.id }), 403, 'cannot confirm own score');
    ev = ok(await call(other, 'dispute', { id: rr, m: mAB.id, note: 'It was 11-9' })).event; mm = M(ev, (m) => m.id === mAB.id); assert.strictEqual(mm.state, 'disputed'); assert.ok(mm.needsComm);
    j = ok(await call('ann', 'get', { id: rr })); assert.strictEqual(j.event.flags, 1, 'flagged to the commissioner');
    no(await call(other === 'ann' ? 'bob' : 'bob', 'score', { id: rr, m: mAB.id, games: scoreAnnWins }), 403, 'a player cannot settle a dispute');
    ev = ok(await call('ann', 'score', { id: rr, m: mAB.id, games: annIsA ? [[11, 9]] : [[9, 11]] })).event; mm = M(ev, (m) => m.id === mAB.id); assert.strictEqual(mm.state, 'confirmed'); assert.ok(ev.audit.some((a) => a.a === 'dispute') && ev.audit.some((a) => a.a === 'score'));
    t('designated scorer enters, opponent confirms or disputes, dispute flagged and settled by the commissioner, audit trail, op-id resend safe');
    // a match against a guest with no account: needs the commissioner to confirm
    const mBD = M(ev, (m) => [m.a, m.b].includes(bea) && [m.a, m.b].includes(di)); const beaA = mBD.a === bea;
    ev = ok(await call('bob', 'score', { id: rr, m: mBD.id, games: beaA ? [[11, 3]] : [[3, 11]], v: mBD.v })).event; mm = M(ev, (m) => m.id === mBD.id); assert.strictEqual(mm.state, 'pending'); assert.ok(mm.needsComm);
    ev = ok(await call('ann', 'confirm', { id: rr, m: mBD.id })).event; assert.strictEqual(M(ev, (m) => m.id === mBD.id).state, 'confirmed');
    t('score against an unclaimed guest waits for the commissioner');
    // concurrency: two phones submit the same match at once -> exactly one wins; parallel scores on different matches all land
    const mBC = M(ev, (m) => [m.a, m.b].includes(bea) && [m.a, m.b].includes(cy)); slow = 25; lost = 0;
    const side = (m, who) => (who === 'bob' ? (m.a === bea ? 'a' : 'b') : m.a === cy ? 'a' : 'b');
    const sA = mBC.a === bea ? 'bob' : 'cat'; const rs = await Promise.all([sA, 'ann'].map((w) => call(w, 'score', { id: rr, m: mBC.id, games: [[11, 5]], v: mBC.v }))); // the designated scorer and the commissioner at the same moment
    slow = 0;
    assert.strictEqual(rs.filter((x) => x.s === 200).length, 1, 'exactly one submission saved: ' + rs.map((x) => x.s));
    assert.ok(rs.some((x) => x.s === 403 || x.s === 409));
    ev = ok(await call('ann', 'get', { id: rr })).event;
    const left = ev.matches.filter((m) => m.state === 'ready'); slow = 20;
    const rs2 = await Promise.all(left.map((m) => call('ann', 'score', { id: rr, m: m.id, games: [[11, 7]], v: m.v })));
    slow = 0; rs2.forEach((x) => ok(x, 'parallel commissioner scores'));
    ev = ok(await call('ann', 'get', { id: rr })).event; assert.ok(lost > 0, 'writes really collided (' + lost + ' redone)');
    const pend = ev.matches.filter((m) => m.st === 'pool' && m.state !== 'confirmed'); for (const m of pend) { const r = await call('ann', 'score', { id: rr, m: m.id, games: [[11, 8]] }); if (r.s === 403) { const c1 = await call('bob', 'confirm', { id: rr, m: m.id }); if (c1.s !== 200) ok(await call('cat', 'confirm', { id: rr, m: m.id }), 'her own pending match: the opponent confirms (review fix 1)'); } else ok(r); }
    ev = ok(await call('ann', 'get', { id: rr })).event; assert.strictEqual(ev.matches.filter((m) => m.st === 'pool' && m.state === 'confirmed').length, 10, 'no score lost');
    t('concurrency: one of two simultaneous entries on a match wins, ' + left.length + ' parallel entries on different matches all saved (' + lost + ' conflicting writes redone)');
    // playoff top 2 created after pool play
    const po = ev.matches.filter((m) => m.st === 'po'); assert.strictEqual(po.length, 1); const tbl = ev.tables[0]; assert.deepStrictEqual([po[0].a, po[0].b].sort(), [tbl[0].eid, tbl[1].eid].sort());
    ev = ok(await call('ann', 'score', { id: rr, m: po[0].id, games: [[11, 2]] })).event; assert.ok(!ev.fin && ev.canFinish, 'a round robin waits for Finish'); ev = ok(await call('ann', 'finish', { id: rr })).event; assert.ok(ev.fin && ev.placeRows[0].place === 1 && ev.placeRows.length === 5);
    t('round robin playoff: top 2 by tiebreak order meet in a final; places 1-5 after it');

    // ---------- single elimination with byes ----------
    NOW = Z('2026-11-17T18:00:00Z');
    ev = ok(await call('ann', 'create', base({ title: 'Bracket', fmt: 'se', entrants: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'].map((n, i) => ({ name: n, rating: 6 - i })), playIn: false }))).event; const se = ev.id;
    ev = ok(await call('ann', 'draw', { id: se })).event;
    let r1 = ev.matches.filter((m) => m.st === 'w' && m.r === 1); assert.strictEqual(r1.length, 4); assert.strictEqual(r1.filter((m) => m.state === 'bye').length, 2);
    let r2 = ev.matches.filter((m) => m.st === 'w' && m.r === 2); assert.ok(r2.some((m) => nm(ev, m.a) === 'S1'), 'top seed advanced on a bye');
    no(await call('ann', 'edit', Object.assign(base({ title: 'X', fmt: 'se' }), { id: se })), 409, 'rules lock at the draw');
    for (let g = 0; g < 10; g++) { const rd = ev.matches.find((m) => m.state === 'ready'); if (!rd) break; ev = ok(await call('ann', 'score', { id: se, m: rd.id, games: win(nm(ev, rd.a) < nm(ev, rd.b) ? 'a' : 'b') })).event; }
    assert.ok(ev.fin); assert.strictEqual(ev.placeRows[0].name, 'S1'); assert.strictEqual(ev.placeRows.find((x) => x.name === 'S2').place, 2); assert.strictEqual(ev.placeRows.filter((x) => x.place === 3).length, 2, 'semifinal losers share 3rd');
    t('single elimination 6: byes to seeds 1-2, winners advance, champion / runner-up / shared 3rd');

    // ---------- double elimination with bracket reset ----------
    ev = ok(await call('ann', 'create', base({ title: 'Double', fmt: 'de', entrants: ['D1', 'D2', 'D3', 'D4'].map((n, i) => ({ name: n, rating: 4 - i })), playIn: false }))).event; const de = ev.id;
    ev = ok(await call('ann', 'draw', { id: de })).event;
    const play = async (pickW) => { const rd = ev.matches.find((m) => m.state === 'ready'); ev = ok(await call('ann', 'score', { id: de, m: rd.id, games: win(pickW(rd)) })).event; return rd; };
    // D1 wins the winners bracket, D2 comes through the losers bracket and beats D1 in the first final -> reset
    const fav = (rd) => (nm(ev, rd.a) < nm(ev, rd.b) ? 'a' : 'b');
    let guard = 0; while (!ev.matches.find((m) => m.st === 'gf' && !m.reset && m.state === 'ready') && guard++ < 20) await play(fav);
    const gf = ev.matches.find((m) => m.st === 'gf' && !m.reset); assert.strictEqual(nm(ev, gf.a), 'D1'); assert.strictEqual(nm(ev, gf.b), 'D2');
    ev = ok(await call('ann', 'score', { id: de, m: gf.id, games: win('b') })).event; let gf2 = ev.matches.find((m) => m.reset); assert.strictEqual(gf2.state, 'ready', 'bracket reset match is live'); assert.ok(!ev.fin);
    ev = ok(await call('ann', 'score', { id: de, m: gf2.id, games: [[12, 15]] })).event; assert.ok(ev.fin); // the reset is one game to 15 (pickleball default; see local.rev2.test.js)
    assert.strictEqual(ev.placeRows[0].name, 'D2'); assert.strictEqual(ev.placeRows[1].name, 'D1'); assert.strictEqual(ev.placeRows.find((x) => x.name === 'D3').place, 3);
    t('double elimination 4: losers-bracket champion wins the first final -> bracket reset, wins the reset -> champion; places');
    // no reset when the winners-bracket champion wins the first final; property test 2..16 entries (enterprise account lifts the 8-person cap)
    for (let n = 2; n <= 16; n++) {
      NOW = Z('2026-11-17T18:00:00Z'); E._reset();
      ev = ok(await call('club', 'create', base({ title: 'DE' + n, fmt: 'de', seeding: 'manual', entrants: Array.from({ length: n }, (_, i) => ({ name: 'P' + String(i).padStart(2, '0') })) }), '3.3.3.' + n)).event; const id = ev.id;
      ev = ok(await call('club', 'draw', { id })).event; const losses = {}; let steps = 0;
      while (!ev.fin && steps++ < 80) { const rd = ev.matches.find((m) => m.state === 'ready'); assert.ok(rd, 'stuck at n=' + n); const w = (n * 7 + steps * 3) % 5 < 3 ? 'a' : 'b'; ev = ok(await call('club', 'score', { id, m: rd.id, games: rd.rule ? (w === 'a' ? [[15, 9]] : [[9, 15]]) : win(w) })).event; const lo = w === 'a' ? rd.b : rd.a; losses[lo] = (losses[lo] || 0) + 1; }
      assert.ok(ev.fin, 'finished n=' + n); const champ = ev.placeRows[0].eid; assert.ok((losses[champ] || 0) <= 1, 'champion lost at most once');
      ev.entrants.forEach((e) => { if (e.eid !== champ) assert.strictEqual(losses[e.eid], 2, 'everyone else out after exactly 2 losses (n=' + n + ')'); });
      assert.strictEqual(ev.placeRows.length, n);
    }
    t('double elimination 2-16 entries (with byes): always finishes, every non-champion has exactly 2 losses, champion at most 1');

    // ---------- ladder ----------
    NOW = Z('2026-11-17T18:00:00Z'); E._reset();
    ev = ok(await call('ann', 'create', base({ title: 'Ladder', fmt: 'ladder', seeding: 'manual', reach: 2, expDays: 3, endDay: '2026-12-31', entrants: [{ name: 'L1' }, { name: 'L2' }, { name: 'L3' }, { name: 'L4' }, { name: 'L5' }], playIn: false }))).event; const ld = ev.id, lcode = ev.code;
    const lid = (n) => ev.entrants.find((e) => e.name === n).eid;
    NOW = START + 1000; ev = ok(await call('ann', 'get', { id: ld })).event; assert.deepStrictEqual(ev.ladder.map((x) => x.name), ['L1', 'L2', 'L3', 'L4', 'L5']);
    no(await call('ann', 'challenge', { id: ld, a: lid('L5'), b: lid('L2') }), 409, '3 spots above with reach 2');
    ev = ok(await call('ann', 'challenge', { id: ld, a: lid('L5'), b: lid('L3') })).event;
    no(await call('ann', 'challenge', { id: ld, a: lid('L4'), b: lid('L3') }), 409, 'L3 already has an open challenge');
    let ch = ev.matches.find((m) => m.st === 'lad'); ev = ok(await call('ann', 'score', { id: ld, m: ch.id, games: win('a') })).event;
    assert.deepStrictEqual(ev.ladder.map((x) => x.name), ['L1', 'L2', 'L5', 'L4', 'L3'], 'swap: winner takes the higher spot');
    ev = ok(await call('ann', 'challenge', { id: ld, a: lid('L4'), b: lid('L2') })).event; ch = ev.matches.find((m) => m.st === 'lad' && m.state === 'ready');
    NOW += 3 * DAY + 1000; ev = ok(await call('ann', 'get', { id: ld })).event; const fch = ev.matches.find((m) => m.id === ch.id); assert.strictEqual(fch.state, 'confirmed'); assert.ok(fch.forfeit);
    assert.deepStrictEqual(ev.ladder.map((x) => x.name), ['L1', 'L4', 'L5', 'L2', 'L3'], 'expired challenge: challenger wins by forfeit');
    // shift + void variants
    NOW = Z('2026-11-17T18:00:00Z');
    ev = ok(await call('ann', 'create', base({ title: 'Ladder2', fmt: 'ladder', seeding: 'manual', reach: 3, expDays: 2, expire: 'void', move: 'shift', endDay: '2026-12-31', entrants: [{ name: 'K1' }, { name: 'K2' }, { name: 'K3' }, { name: 'K4' }], playIn: false }))).event; const l2 = ev.id;
    NOW = START + 1000; ev = ok(await call('ann', 'get', { id: l2 })).event; const kid = (n) => ev.entrants.find((e) => e.name === n).eid;
    ev = ok(await call('ann', 'challenge', { id: l2, a: kid('K4'), b: kid('K1') })).event; ch = ev.matches.find((m) => m.st === 'lad'); ev = ok(await call('ann', 'score', { id: l2, m: ch.id, games: win('a') })).event;
    assert.deepStrictEqual(ev.ladder.map((x) => x.name), ['K4', 'K1', 'K2', 'K3'], 'shift: challenger takes the spot, the rest move down one');
    ev = ok(await call('ann', 'challenge', { id: l2, a: kid('K3'), b: kid('K2') })).event; ch = ev.matches.find((m) => m.st === 'lad' && m.state === 'ready');
    NOW += 2 * DAY + 1000; ev = ok(await call('ann', 'get', { id: l2 })).event; assert.strictEqual(ev.matches.find((m) => m.id === ch.id).state, 'void'); assert.deepStrictEqual(ev.ladder.map((x) => x.name), ['K4', 'K1', 'K2', 'K3']);
    t('ladder: reach limit, one open challenge each, swap and shift moves, expiry = forfeit (challenger wins) or void');

    // ---------- heads-up best of 3 ----------
    NOW = Z('2026-11-17T18:00:00Z'); E._reset();
    ev = ok(await call('ann', 'create', base({ title: 'Heads up', fmt: 'h2h', bestOf: 3, endDay: '2026-12-31', playIn: true }))).event; const hu = ev.id, hcode = ev.code;
    ev = ok(await call('eve', 'join', { code: hcode, as: 'player', myName: 'Eve' })).event; const eveE = ev.myEntries[0], annE = ev.entrants.find((e) => e.eid !== eveE).eid;
    no(await call('ann', 'challenge', { id: hu, a: annE, b: eveE }), 409, 'not started');
    NOW = START + 1000; no(await call('eve', 'challenge', { id: hu, a: annE, b: eveE }), 403, 'challenge from your own entry');
    ev = ok(await call('eve', 'challenge', { id: hu, a: eveE, b: annE })).event; let hm = ev.matches.find((m) => m.st === 'h2h'); assert.strictEqual(hm.state, 'offered');
    no(await call('eve', 'accept', { id: hu, m: hm.id }), 403, 'challenger cannot accept for the other side');
    ok(await call('cat', 'join', { code: hcode, as: 'spectator', myName: 'Cat' }));
    ev = ok(await call('cat', 'get', { id: hu })).event; no(await call('cat', 'accept', { id: hu, m: hm.id }), 403);
    ev = ok(await call('ann', 'accept', { id: hu, m: hm.id })).event;
    no(await call('eve', 'score', { id: hu, m: hm.id, games: [[11, 5]] }), 400, 'best of 3 needs 2 games');
    ev = ok(await call('eve', 'score', { id: hu, m: hm.id, games: [[11, 5], [8, 11], [11, 9]] })).event; ev = ok(await call('ann', 'confirm', { id: hu, m: hm.id })).event;
    const rec = ev.records.find((x) => x.eid === eveE); assert.strictEqual(rec.w, 1); assert.strictEqual(rec.pf - rec.pa, 30 - 25);
    t('heads-up: offered -> accepted by the challenged side, best of 3 enforced, confirmed, record + point differential');

    // ---------- bracket pick'em ----------
    NOW = Z('2026-11-17T18:00:00Z'); E._reset();
    ev = ok(await call('ann', 'create', base({ title: 'Pickem', fmt: 'se', pickem: true, seeding: 'manual', entrants: [{ name: 'Q1' }, { name: 'Q2' }, { name: 'Q3' }, { name: 'Q4' }], playIn: false }))).event; const pe = ev.id, pcode = ev.code;
    for (const w of ['fan1', 'fan2', 'fan3']) ok(await call(w, 'join', { code: pcode, as: 'spectator', myName: w }));
    ev = ok(await call('ann', 'draw', { id: pe })).event; const [s1, s2] = ev.matches.filter((m) => m.r === 1); const fin = ev.matches.find((m) => m.r === 2);
    no(await call('fan1', 'pick', { id: pe, m: fin.id, side: 'a' }), 409, 'final not set yet');
    ok(await call('fan1', 'pick', { id: pe, m: s1.id, side: 'a', tb: 30 })); ok(await call('fan1', 'pick', { id: pe, m: s2.id, side: 'a' }));
    ok(await call('fan2', 'pick', { id: pe, m: s1.id, side: 'b', tb: 22 })); ok(await call('fan2', 'pick', { id: pe, m: s2.id, side: 'a' }));
    ok(await call('fan3', 'pick', { id: pe, m: s1.id, side: 'a', tb: 18 }));
    j = ok(await call('fan2', 'get', { id: pe })); assert.ok(!j.event.pickem.counts[s1.id], 'others’ picks not visible before the match locks'); assert.strictEqual(j.event.pickem.mine[s1.id].s, 'b');
    ok(await call('ann', 'live', { id: pe, m: s1.id }));
    no(await call('fan3', 'pick', { id: pe, m: s1.id, side: 'b' }), 409, 'pick locked once the match started');
    no(await call('fan3', 'pick', { id: pe, m: s2.id, side: 'b' }), 409, 'the whole round locks when its first match starts (review fix 6)');
    j = ok(await call('fan2', 'get', { id: pe })); assert.deepStrictEqual(j.event.pickem.counts[s1.id], { a: 2, b: 1 }, 'counts only, after lock');
    ev = ok(await call('ann', 'score', { id: pe, m: s1.id, games: win('a') })).event; ev = ok(await call('ann', 'score', { id: pe, m: s2.id, games: win('a') })).event;
    ok(await call('fan1', 'pick', { id: pe, m: fin.id, side: 'a' })); ok(await call('fan2', 'pick', { id: pe, m: fin.id, side: 'a' })); ok(await call('fan3', 'pick', { id: pe, m: fin.id, side: 'b' }));
    ev = ok(await call('ann', 'score', { id: pe, m: fin.id, games: [[11, 9]] })).event; // final total 20
    const tbl2 = ev.pickem.table; assert.deepStrictEqual(tbl2.map((x) => [x.name, x.pts]), [['fan1', 3], ['fan2', 2], ['fan3', 1]]);
    assert.strictEqual(ev.pickem.finalTotal, 20); no(await call('fan1', 'pick', { id: pe, tb: 21 }), 409, 'tiebreak locked once the final started');
    t("bracket pick'em: picks only for set matches, lock per round when its first match starts (server), others' picks hidden then counts only, most correct wins");
    // tiebreak: equal points -> closest final total
    NOW = Z('2026-11-17T18:00:00Z');
    ev = ok(await call('ann', 'create', base({ title: 'Pickem2', fmt: 'se', pickem: true, seeding: 'manual', entrants: [{ name: 'R1' }, { name: 'R2' }], playIn: false }))).event; const p2 = ev.id, p2c = ev.code;
    for (const w of ['fan1', 'fan2']) ok(await call(w, 'join', { code: p2c, as: 'spectator', myName: w }));
    ev = ok(await call('ann', 'draw', { id: p2 })).event; const f2 = ev.matches[0];
    ok(await call('fan1', 'pick', { id: p2, m: f2.id, side: 'a', tb: 30 })); ok(await call('fan2', 'pick', { id: p2, m: f2.id, side: 'a', tb: 19 }));
    ev = ok(await call('ann', 'score', { id: p2, m: f2.id, games: [[11, 7]] })).event; assert.deepStrictEqual(ev.pickem.table.map((x) => x.name), ['fan2', 'fan1'], 'closest final total breaks the tie');
    t("bracket pick'em tiebreak: closest guess of the final's total points");

    // ---------- 8-person cap (standard) and enterprise ----------
    NOW = Z('2026-11-17T18:00:00Z'); E._reset();
    const big = await call('ann', 'create', base({ title: 'Big', entrants: Array.from({ length: 8 }, (_, i) => ({ name: 'G' + i })), playIn: false })); no(big, 403, 'organizer + 8 guests = 9 people');
    assert.ok(/\$500\/month \+ \$20 per player per game/.test(big.j.error), 'full message carries the shared pricing text');
    ev = ok(await call('ann', 'create', base({ title: 'Doubles', unit: 'doubles', entrants: [{ name: 'Al / Bo' }, { name: 'Cal & Dee' }, { name: 'Eli + Flo' }], playIn: false }))).event; assert.strictEqual(ev.people, 7); assert.deepStrictEqual(ev.entrants[0].players.map((p) => p.name), ['Al', 'Bo']);
    const dcode = ev.code, did = ev.id;
    ok(await call('gus', 'join', { code: dcode, as: 'spectator', myName: 'Gus' })); no(await call('hal', 'join', { code: dcode, as: 'spectator', myName: 'Hal' }), 403, '9th person refused');
    no(await call('ann', 'entrant', { id: did, do: 'add', name: 'Ian / Jo' }), 403, 'adding a pair over the cap');
    ev = ok(await call('club', 'create', base({ title: 'Club night', entrants: Array.from({ length: 20 }, (_, i) => ({ name: 'C' + i })) }), '4.4.4.4')).event; assert.strictEqual(ev.cap, 500);
    t('8 people per game for standard accounts (organizer, guests, spectators counted; doubles = 2 per pair); enterprise lifts it');

    // ---------- guest claim + solo + stats contract ----------
    const dv = ok(await call('ann', 'get', { id: did })).event; const claim = dv.entrants[0].players[1].claim; // "Bo"
    j = ok(await call('bob', 'get', { id: rr })); assert.ok(!/"claim":"[A-Z0-9]{4}-/.test(JSON.stringify(j)), 'claim codes only for the commissioner');
    no(await call('kim', 'claim', { claim: dcode + '.ZZZZZZZZZZ' }), 404);
    ev = ok(await call('kim', 'claim', { claim, myName: 'Kim' })).event; assert.ok(ev.entrants[0].players.find((p) => p.me)); no(await call('lee', 'claim', { claim }), 404, 'used once');
    // doubles match Al/Bo vs Cal/Dee, kim holds Bo's seat
    NOW = START + 1000; ev = ok(await call('ann', 'get', { id: did })).event; const e0 = ev.entrants[0].eid, e1 = ev.entrants[1].eid, dm = ev.matches.find((m) => [m.a, m.b].includes(e0) && [m.a, m.b].includes(e1));
    ev = ok(await call('ann', 'score', { id: did, m: dm.id, games: dm.a === e0 ? [[11, 13]] : [[13, 11]] })).event;
    let st = await E.statsFor('acct-kim', {}); const sm = st.find((x) => x.kind === 'match');
    assert.strictEqual(sm.result, 'L'); assert.deepStrictEqual(sm.extra.games, [[11, 13]]); assert.strictEqual(sm.extra.partner, 'Al'); assert.strictEqual(sm.extra.pointDiff, -2); assert.ok(sm.extra.guestId); assert.strictEqual(sm.opponent, ev.entrants[1].name); assert.strictEqual(sm.verified, false, 'commissioner-entered vs guests');
    assert.deepStrictEqual(sm.extra.opp.map((p) => p.name), ['Cal', 'Dee']); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(sm.date) && sm.src === 'events' && sm.sport === 'pickleball');
    // solo practice (one player)
    NOW = Z('2026-11-18T18:00:00Z');
    ev = ok(await call('kim', 'create', base({ title: 'Serve drill', fmt: 'solo', start: NOW, endDay: '2026-11-18', unitLabel: 'serves in', playIn: true, myName: 'Kim' }))).event; const so = ev.id; assert.ok(ev.drawn, 'solo starts now');
    ev = ok(await call('kim', 'solo', { id: so, eid: ev.myEntries[0], score: 17 })).event; ev = ok(await call('kim', 'finish', { id: so })).event; assert.ok(ev.fin);
    st = await E.statsFor('acct-kim', { from: '2026-11-18', to: '2026-11-18' }); const se1 = st.find((x) => x.kind === 'event'); assert.deepStrictEqual(se1.place, { n: 1, of: 1 }); assert.strictEqual(se1.score, 17); assert.strictEqual(se1.extra.scoreText, '17 serves in');
    st = await E.statsFor('acct-fan2', {}); assert.ok(st.some((x) => x.kind === 'contest' && x.place.n === 1), "pick'em contest record");
    st = await E.statsFor('acct-ann', {}); assert.ok(st.some((x) => x.kind === 'event' && x.title === 'Saturday Smash' && x.place && x.place.of === 5) && st.filter((x) => x.kind === 'match').length >= 4);
    // stats contract shape (stats.js validate: src / sport / kind lists); bar games map to sport 'other' with extra.game
    let SV = null; try { SV = require(process.env.STATS_JS || './stats').validate; } catch (x) {} // the stats branch's real validator when present (after merge, or STATS_JS=<path>)
    const SS = ['nfl', 'cfb', 'nba', 'wnba', 'ncaab', 'mlb', 'nhl', 'soccer', 'golf', 'pickleball', 'tennis', 'racing', 'horse', 'fight', 'other'], KK = ['bet', 'contest', 'calcutta', 'golf-round', 'golf-pool', 'match', 'event'];
    NOW = Z('2026-11-18T19:00:00Z'); ev = ok(await call('kim', 'create', base({ title: 'Cornhole toss', sport: 'cornhole', fmt: 'solo', to: 0, winBy: 1, start: NOW, endDay: '2026-11-18', unitLabel: 'bags in', playIn: true, myName: 'Kim' }))).event;
    ok(await call('kim', 'solo', { id: ev.id, eid: ev.myEntries[0], score: 9 })); ok(await call('kim', 'finish', { id: ev.id }));
    st = await E.statsFor('acct-kim', {}); const chz = st.find((x) => x.title.startsWith('Cornhole toss')); assert.strictEqual(chz.sport, 'other'); assert.strictEqual(chz.extra.game, 'cornhole');
    for (const who of ['acct-kim', 'acct-ann', 'acct-fan2', 'acct-bob']) for (const r of await E.statsFor(who, {})) { assert.ok(SS.includes(r.sport) && KK.includes(r.kind) && r.src === 'events' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && typeof r.verified === 'boolean' && (r.score == null || Number.isFinite(r.score)) && String(r.id).length <= 80, 'contract: ' + JSON.stringify(r)); assert.ok(!('groupId' in r) || r.groupId); if (SV) { const v = SV(r, 'events'); assert.ok(v.ok, 'stats.js validate: ' + v.why + ' ' + JSON.stringify(r)); } }
    t('guest claim token (once, wrong codes 404), statsFor: per-match records (doubles partner, games, point diff, guestId, both sides’ players), solo event place, pick’em contest, date filter');

    // ---------- privacy + adapter ----------
    const all = raw.map((x) => x.txt).join('\n'); assert.ok(!/acct-/.test(all), 'no account ids in any response'); assert.ok(!/"mk"|"ak"|"ce"|"ct"|"comm":"[0-9a-f]{24}"/.test(all), 'no member keys / claim secrets fields');
    const lots = await E.ADAPTER.lots(se); assert.strictEqual(lots.length, 6); const lr = await E.ADAPTER.lotResults(se); assert.strictEqual(Object.values(lr).filter((x) => x.place === 1).length, 1);
    const ps = await E.ADAPTER.potSummary(rr); assert.strictEqual(ps.entry, 20); const sm2 = await E.ADAPTER.summary(se); assert.strictEqual(sm2.status, 'final'); assert.strictEqual(sm2.leader, 'S1');
    await E.ADAPTER.attachToGroup(se, { gid: 'G1', cid: 'C1', pot: 'side' }); assert.strictEqual((await E.ADAPTER.potSummary(se)).pot, 'side'); await E.ADAPTER.attachToGroup(did, { gid: 'G2', cid: 'C2' }); assert.ok((await E.statsFor('acct-kim', {})).some((x) => x.kind === 'match' && x.groupId === 'G2' && x.contestId === 'C2'), 'attached event records carry groupId/contestId');
    t('no account ids, member keys or claim secrets leak; adapter lots / lotResults / summary / potSummary / attach work');
    // rate limit on public peek + wrong codes
    E._reset(); for (let i = 0; i < 10; i++) no(await call(null, 'peek', { code: 'ZZZZ-ZZZ' + i }, '6.6.6.6'), 404); no(await call(null, 'peek', { code }, '6.6.6.6'), 429, 'blocked after 10 wrong codes');
    t('wrong invite codes blocked after 10 per IP (peek) ');
    // sport catalog (main, pb-group: the list a group member sees): every sport present; 'Available now' only for pickleball formats the server accepts, or a
    // tile the group page already has (Golf day, the picks contest); every other game says Coming soon and starts nothing; the cap line is the group's
    const CAT = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '../pics/games-catalog.json'), 'utf8'));
    // v283 (integration): a tile is a key of the v274 Games catalog registry in pics/groups.js (addGame), opened through OddGroups.openGame(key)
    const GKEYS = [...require('fs').readFileSync(require('path').join(__dirname, '../pics/groups.js'), 'utf8').matchAll(/addGame\(\{ key: '([a-z0-9]+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(GKEYS, ['picks', 'golf', 'pickleball', 'calcutta'], 'the Games catalog registers picks, golf, pickleball and (calc-live) the Calcutta');
    for (const k of ['football', 'basketball', 'baseball', 'hockey', 'soccer', 'golf', 'pickleball', 'tennis', 'racing', 'horse', 'fighting']) assert.ok(CAT.sports.find((x) => x.key === k), 'catalog sport ' + k);
    assert.strictEqual(CAT.capLine, E.GROUP.CAP); assert.ok(!('entLine' in CAT) && !/\$\d/.test(JSON.stringify(CAT)), 'no price on the phone in a group (v272)'); assert.strictEqual(CAT.sports[0].key, 'pickleball', 'pickleball first');
    for (const sp of CAT.sports) for (const g of sp.games) { assert.ok(CAT.games[g.key] && CAT.games[g.key].line, 'one-line ' + g.key); assert.ok(['now', 'soon', 'planned'].includes(g.status) && ['live', 'scorer', 'tbc'].includes(g.results), sp.key + '/' + g.key);
      if (g.status === 'now') { const st = g.start || {}; assert.ok(st.kind === 'tile' ? ((st.tile === 'golf' && g.key === 'golf-day') || (st.tile === 'picks' && g.key === 'group-picks') || (st.tile === 'calcutta' && g.key === 'calcutta' && ['football', 'basketball', 'golf'].includes(sp.key))) && GKEYS.includes(st.tile) : st.kind === 'event' && sp.key === 'pickleball' && st.sport === 'pickleball' && E.FMTN[st.fmt], 'available now must open a working flow: ' + sp.key + '/' + g.key); assert.ok(!st.pick); }
      else { assert.strictEqual(CAT.status[g.status], 'Coming soon', sp.key + '/' + g.key); assert.ok(!g.start, 'not available = no start: ' + sp.key + '/' + g.key); } }
    assert.deepStrictEqual(CAT.sports.find((x) => x.key === 'pickleball').games.filter((g) => g.status === 'now').map((g) => g.start.fmt), ['rr', 'se', 'ladder', 'h2h', 'se', 'solo'], 'every pickleball format a group can start');
    t("sport catalog: every sport present, only pickleball (and the group's own tiles) available, the rest Coming soon, statuses/results valid, cap line exact");
    console.log('\nPASS ' + pass + ' checks'); srv.close(); process.exit(0);
  } catch (e) { console.error('FAIL', e); srv.close(); process.exit(1); }
});
