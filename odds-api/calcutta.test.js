// Run: node odds-api/calcutta.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes; the clock is fake)
const assert = require('assert'), http = require('http'), C = require('./calcutta'), D = C._deps;
// ---- fake database (random delay so parallel requests really interleave) ----
let db = {}, slow = 0, lost = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
D.S = {
  dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
// ---- fake sign-in: x-token "t-<who>" ----
const WHO = ['ann', 'bob', 'cat', 'dan', 'eve', 'fay', 'gus', 'hal', 'ivy', 'jon'];
const SID = {}; WHO.forEach((w, i) => { SID[w] = (String(i + 1).repeat(8) + w.repeat(30)).slice(0, 64); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
const NAMES = {}; WHO.forEach((w) => { NAMES[SID[w].slice(0, 8)] = w[0].toUpperCase() + w.slice(1) + 'Bets'; });
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); if (!t.startsWith('t-')) return null; const w = t.slice(2); return SID[w] ? pe(SID[w]) : null; }, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
Object.values(SID).forEach((s) => { db[s] = { id: s, data: { bets: [] }, updated: 1 }; });
// ---- fake ESPN: 32 NFL teams; a full 2026 postseason (13 games) ----
const TEAMS = Array.from({ length: 32 }, (_, i) => ({ id: String(i + 1), abbreviation: 'T' + (i + 1), displayName: 'Team ' + (i + 1) }));
TEAMS[0].displayName = 'Kansas <b>City</b>';
const Z = (s) => Date.parse(s), T0 = Z('2027-01-09T18:00:00Z'), H = 3600e3;
const G = (id, week, t, a, b, sa, sb) => ({ id: String(id), date: new Date(t).toISOString(), season: { type: 3 }, week: { number: week }, status: { type: { state: 'post', completed: true } }, competitions: [{ notes: [], competitors: [{ team: { id: String(a) }, score: String(sa), winner: sa > sb }, { team: { id: String(b) }, score: String(sb), winner: sb > sa }] }] });
const PO = { 1: [G(901, 1, T0, 2, 7, 24, 10), G(902, 1, T0 + H, 3, 6, 21, 17), G(903, 1, T0 + 2 * H, 4, 5, 30, 27), G(904, 1, T0 + 3 * H, 9, 14, 20, 3), G(905, 1, T0 + 4 * H, 10, 13, 16, 13), G(906, 1, T0 + 5 * H, 11, 12, 28, 14)],
  2: [G(911, 2, T0 + 7 * 24 * H, 1, 4, 31, 7), G(912, 2, T0 + 7 * 24 * H + H, 2, 3, 27, 20), G(913, 2, T0 + 7 * 24 * H + 2 * H, 8, 11, 34, 31), G(914, 2, T0 + 7 * 24 * H + 3 * H, 9, 10, 23, 22)],
  3: [G(921, 3, T0 + 14 * 24 * H, 1, 2, 17, 14), G(922, 3, T0 + 14 * 24 * H + 3 * H, 8, 9, 26, 24)], 5: [G(931, 5, T0 + 28 * 24 * H, 1, 8, 25, 22)] };
let urls = [], feedOn = false; // the score feed stays empty until the event "starts" (feedOn = true; C._reset())
D.fetch = async (u) => { urls.push(u); if (/\/teams\?/.test(u)) return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: TEAMS.map((t) => ({ team: t })) }] }] }) };
  const m = /seasontype=3&week=(\d+)/.exec(u); return { ok: true, json: async () => ({ events: feedOn && m && PO[m[1]] ? PO[m[1]] : [] }) }; };
let NOW = Z('2026-11-17T18:00:00Z'); D.now = () => NOW;
// ---- server ----
const srv = http.createServer(async (req, res) => { if (!(await C.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/calcutta/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(b || {}) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const team = (n) => ({ id: String(n), name: 'Team ' + n });
const PLAYOFF = Array.from({ length: 14 }, (_, i) => i + 1);
const lotsOf = (ids, field) => ids.filter((x) => !(field || []).includes(x)).map((x) => ({ teams: [team(x)] })).concat(field && field.length ? [{ name: 'The field', teams: field.map(team) }] : []);
const NFLROWS = [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13, label: 'Conference champion' }, { k: 'champ', n: 1, pct: 35 }];
const base = (o) => Object.assign({ name: 'Playoff Calcutta', ev: 'nfl_po', lots: lotsOf(PLAYOFF, [13, 14]), rows: NFLROWS, minBid: 5, inc: 5, timer: 20, buyBack: false, main: true, take: { kind: 'pct', v: 10 }, order: 'listed', mode: 'live' }, o || {});
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const tick = (ms) => { NOW += ms; };

srv.listen(0, async () => {
  P = srv.address().port; let r;
  try {
    r = await call(null, 'mine'); assert.strictEqual(r.s, 401); r = await call(null, 'bid', { id: 'AAAAAAAAAA', lot: 'L1', amt: 5 }); assert.strictEqual(r.s, 401); t('signed-out requests refused (401)');
    r = await call('ann', 'events'); ok(r); assert.ok(r.j.events.find((e) => e.key === 'nfl_po' && e.on)); assert.ok(r.j.events.find((e) => e.key === 'golf' && !e.on), 'golf off until its source plugs in'); assert.strictEqual(r.j.max, 8); assert.ok(/\$500\/month \+ \$20 per player per game/.test(r.j.capText)); t('events list (golf "coming soon" until registered), max 8 people');
    r = await call('ann', 'teams', { ev: 'nfl_po' }); ok(r); assert.strictEqual(r.j.teams.length, 32); assert.ok(!/[<>]/.test(JSON.stringify(r.j.teams)), 'team names cleaned'); t('teams from the ESPN teams path, names cleaned');
    // --- validation ---
    const badOnes = [[{ name: 'x' }, 'name'], [{ ev: 'cricket' }, 'event'], [{ ev: 'golf' }, 'golf not plugged'], [{ lots: [{ teams: [team(1)] }] }, '1 lot'], [{ lots: [{ teams: [team(1)] }, { teams: [team(1)] }] }, 'team twice'], [{ lots: [{ teams: [team(1)] }, { teams: [team(99)] }] }, 'unknown team'],
      [{ rows: [{ k: 'win', n: 13, pct: 3 }, { k: 'champ', n: 1, pct: 35 }] }, 'total 74%'], [{ rows: [{ k: 'win', n: 13, pct: 3 }, { k: 'round', r: 4, n: 2, pct: 13 }, { k: 'champ', n: 1, pct: 35.001 }] }, '3 decimals'], [{ rows: [{ k: 'big', n: 1, pct: 100 }] }, 'kind not in event'], [{ rows: [{ k: 'champ', n: 2, pct: 50 }] }, 'champ twice'], [{ rows: [{ k: 'round', r: 9, n: 1, pct: 100 }] }, 'round 9'], [{ rows: [{ k: 'win', n: 13.5, pct: 3 }] }, 'n fraction'], [{ rows: [] }, 'no rows'],
      [{ minBid: 3 }, 'min bid 3'], [{ inc: 7 }, 'inc 7'], [{ timer: 15 }, 'timer 15'], [{ take: { kind: 'pct', v: 51 } }, 'take 51'], [{ take: { kind: 'pct', v: 2.5 } }, 'take 2.5'], [{ take: { kind: 'flat', v: -1 } }, 'flat -1'], [{ take: { kind: 'flat', v: 1.005 } }, 'flat sub-cent'], [{ take: { kind: 'half' } }, 'take kind'], [{ mode: 'auto' }, 'mode'], [{ order: 'alpha' }, 'order'], [{ buyBack: true }, 'buy-back on pro teams'], [{ lots: [{ teams: [team(1)], playersOfRecord: [{ name: 'Pat' }] }, { teams: [team(2)] }] }, 'players of record on a pro team']];
    for (const [o, m] of badOnes) { C._reset(); r = await call('ann', 'create', base(o), '7.7.7.' + m.length); assert.strictEqual(r.s, 400, 'refused: ' + m + ' got ' + r.s + ' ' + JSON.stringify(r.j)); }
    C._reset(); r = await call('ann', 'create', base({ rows: [{ k: 'win', n: 13, pct: 3 }, { k: 'champ', n: 1, pct: 35 }] })); assert.strictEqual(r.j.total, 74, 'total reported'); assert.ok(/exactly 100%/.test(r.j.error));
    t('every bad option refused with 400 (' + badOnes.length + ' cases); payout total must be exactly 100%');
    // --- create ---
    C._reset(); r = await call('ann', 'create', base({ name: '<img src=x onerror=alert(1)>Playoff "Calc"' })); ok(r, 'create'); const c1 = r.j.calc;
    assert.ok(!/[<>"']/.test(c1.name)); assert.strictEqual(c1.role, 'comm'); assert.ok(/^[A-Z2-9]{12}$/.test(c1.code)); assert.strictEqual(c1.lots.length, 13); assert.strictEqual(c1.lots[12].name, 'The field'); assert.ok(c1.lots[12].field);
    assert.strictEqual(c1.lots[0].teams[0].name, 'Kansas bCity/b', 'name from the ESPN list, cleaned'); assert.strictEqual(c1.members[0].name, 'AnnBets'); assert.strictEqual(c1.a.status, 'setup'); assert.strictEqual(c1.rules.rows[0].label, 'Each win');
    t('create: HTML stripped, 12-char invite code (60 bits), field bundle, commissioner by handle');
    // --- public peek + join preview + join ---
    r = await call(null, 'peek', { code: 'c.' + c1.code.toLowerCase() }); ok(r); assert.deepStrictEqual(Object.keys(r.j).sort(), ['kind', 'title']); assert.strictEqual(r.j.kind, 'calcutta');
    r = await call('bob', 'get', { id: c1.id }); assert.strictEqual(r.s, 404, 'stranger cannot read');
    r = await call('bob', 'preview', { code: c1.code }); ok(r); assert.strictEqual(r.j.calc.role, 'none'); assert.ok(!r.j.calc.code && !r.j.calc.members, 'no code/members before joining'); assert.strictEqual(r.j.calc.takeText, 'Commissioner keeps 10% of the pot'); assert.strictEqual(r.j.calc.rules.rows.length, 3); assert.strictEqual(r.j.calc.rules.main, true);
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 5 }); assert.strictEqual(r.s, 403, 'not a member yet');
    for (const w of ['bob', 'cat', 'dan']) { r = await call(w, 'join', { code: c1.code }); ok(r, 'join ' + w); }
    r = await call('bob', 'join', { code: c1.code }); ok(r); assert.strictEqual(r.j.calc.members.length, 4, 'join twice changes nothing');
    t('public peek = title + kind only; preview shows locked rules, payout table, take, main/side; join by code, idempotent; members only bid');
    for (let i = 0; i < 10; i++) { r = await call('eve', 'join', { code: 'ZZZZZZZZZZZ' + (i % 9 + 1) }, '5.5.5.5'); assert.strictEqual(r.s, 404); }
    r = await call('eve', 'join', { code: c1.code }, '5.5.5.5'); assert.strictEqual(r.s, 429); r = await call(null, 'peek', { code: c1.code }, '5.5.5.5'); assert.strictEqual(r.s, 429);
    C._reset(); t('10 wrong codes -> 15 minute block (account and IP; public peek too)');
    // --- people cap: 8 (commissioner included), enterprise uncapped ---
    for (const w of ['eve', 'fay', 'gus', 'hal']) { r = await call(w, 'join', { code: c1.code }); ok(r); }
    r = await call('ivy', 'join', { code: c1.code }); assert.strictEqual(r.s, 409); assert.ok(/up to 8 people/.test(r.j.error) && r.j.error.includes('Need more than 8? Oddable for courses, clubs and leagues: $500/month + $20 per player per game. Contact us.'), r.j.error); assert.strictEqual(r.j.code, 'cap');
    C.limits.enterprise.add(C.mkOf(pe(SID.ann))); r = await call('ivy', 'join', { code: c1.code }); ok(r, 'enterprise commissioner is uncapped'); C.limits.enterprise.clear();
    r = await call('ivy', 'bid', { id: c1.id, lot: 'L1', amt: 5 }); assert.strictEqual(r.s, 403, '9th person cannot bid once the cap is back to 8');
    t('people cap: 9th person refused with the shared pricing text; enterprise flag lifts it; cap also enforced on bids');
    // --- auction ---
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 5 }); assert.strictEqual(r.s, 409, 'not started');
    r = await call('bob', 'ctl', { id: c1.id, op: 'start' }); assert.strictEqual(r.s, 403, 'only the commissioner starts');
    r = await call('ann', 'ctl', { id: c1.id, op: 'start' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L1'); assert.strictEqual(r.j.calc.a.endsAt, null, 'timer waits for the first bid');
    r = await call('ann', 'edit', Object.assign(base(), { id: c1.id })); assert.strictEqual(r.s, 409, 'started: edit refused');
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 4 }); assert.strictEqual(r.s, 409); assert.strictEqual(r.j.code, 'min');
    r = await call('bob', 'bid', { id: c1.id, lot: 'L2', amt: 10 }); assert.strictEqual(r.j.code, 'stale', 'lot not on the block');
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 10.5 }); assert.strictEqual(r.s, 400);
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 10 }); ok(r); assert.strictEqual(r.j.calc.a.endsAt, NOW + 20000); assert.strictEqual(r.j.calc.locked, true);
    r = await call('bob', 'bid', { id: c1.id, lot: 'L1', amt: 20 }); assert.strictEqual(r.j.code, 'high', 'already the high bidder');
    r = await call('cat', 'bid', { id: c1.id, lot: 'L1', amt: 14 }); assert.strictEqual(r.j.code, 'outbid'); assert.strictEqual(r.j.min, 15);
    tick(12000); r = await call('cat', 'bid', { id: c1.id, lot: 'L1', amt: 15 }); ok(r); assert.strictEqual(r.j.calc.a.endsAt, NOW + 20000, 'timer reset on every bid');
    r = await call('ann', 'edit', Object.assign(base(), { id: c1.id })); assert.strictEqual(r.s, 409, 'rules locked at the first bid');
    r = await call('bob', 'ctl', { id: c1.id, op: 'sold' }); assert.strictEqual(r.s, 403);
    t('bids: min, step, whole dollars, lot on the block, timer starts at first bid and resets on each bid; rules lock at the first bid (server)');
    // --- race: two simultaneous identical bids -> exactly one wins, the other gets "outbid" (20 rounds, interleaving database) ---
    slow = 25; let wins = 0, outs = 0; const pool = ['bob', 'cat', 'dan', 'eve'];
    for (let i = 0; i < 20; i++) {
      tick(6000); const st = (await call('ann', 'get', { id: c1.id })).j.calc, hp = st.a.high && st.a.high.pid, nameOf = (w) => (st.members.find((m) => m.name === NAMES[SID[w].slice(0, 8)]) || {}).pid;
      const two = pool.filter((w) => nameOf(w) !== hp).slice(i % 2, i % 2 + 2), amt = st.a.minNext;
      const rs = await Promise.all(two.map((w) => call(w, 'bid', { id: c1.id, lot: 'L1', amt }, '3.3.3.' + w.length + i)));
      const okN = rs.filter((x) => x.s === 200).length, outN = rs.filter((x) => x.s === 409 && x.j.code === 'outbid').length; assert.strictEqual(okN, 1, 'round ' + i + ': ' + JSON.stringify(rs.map((x) => x.j.error || 'ok'))); assert.strictEqual(outN, 1); wins += okN; outs += outN;
      const after = (await call('ann', 'get', { id: c1.id })).j.calc; assert.strictEqual(after.a.high.amt, amt);
    }
    tick(6000); const st0 = (await call('ann', 'get', { id: c1.id })).j.calc, lo = st0.a.minNext, two = ['bob', 'cat', 'dan', 'eve'].filter((w) => st0.a.high.name !== NAMES[SID[w].slice(0, 8)]).slice(0, 2);
    const rs2 = await Promise.all([call(two[0], 'bid', { id: c1.id, lot: 'L1', amt: lo }), call(two[1], 'bid', { id: c1.id, lot: 'L1', amt: lo + 50 })]);
    assert.ok(rs2[1].s === 200, 'the higher bid always lands'); assert.strictEqual((await call('ann', 'get', { id: c1.id })).j.calc.a.high.amt, lo + 50);
    slow = 0; t('bid race x20: exactly one of two identical simultaneous bids wins, the other gets a clear "outbid" (' + wins + ' won / ' + outs + ' outbid, ' + lost + ' conflicting writes redone); a higher racing bid always lands');
    // --- pause / resume / undo ---
    r = await call('ann', 'ctl', { id: c1.id, op: 'pause' }); ok(r); assert.ok(r.j.calc.a.paused && r.j.calc.a.endsAt === null && r.j.calc.a.left === 20000);
    tick(120000); r = await call('bob', 'get', { id: c1.id }); assert.ok(!r.j.calc.sold.length, 'paused: time does not run out');
    r = await call('dan', 'bid', { id: c1.id, lot: 'L1', amt: 9999 }); assert.strictEqual(r.s, 409, 'no bids while paused');
    r = await call('ann', 'ctl', { id: c1.id, op: 'resume' }); ok(r); assert.strictEqual(r.j.calc.a.endsAt, NOW + 20000);
    const hiBefore = r.j.calc.a.high.amt; r = await call('ann', 'ctl', { id: c1.id, op: 'undo' }); ok(r); assert.ok(r.j.calc.a.high.amt < hiBefore, 'undo last bid');
    t('pause freezes the clock and bids; resume restores the time left; undo last bid');
    // --- timer expiry: sold to the high bidder; late bid refused; next lot opens by itself ---
    const hb = r.j.calc.a.high; tick(20001); r = await call('cat', 'bid', { id: c1.id, lot: 'L1', amt: hb.amt + 100 }); assert.strictEqual(r.s, 409); assert.strictEqual(r.j.code, 'sold');
    r = await call('bob', 'get', { id: c1.id }); assert.strictEqual(r.j.calc.sold[0].lot, 'L1'); assert.strictEqual(r.j.calc.sold[0].amt, hb.amt); assert.strictEqual(r.j.calc.sold[0].holder.name, hb.name); assert.strictEqual(r.j.calc.a.cur, null);
    tick(8000); r = await call('bob', 'state', { id: c1.id, rev: 0 }); assert.strictEqual(r.j.calc.a.cur, 'L2', 'next lot opens 8 s after a sale');
    r = await call('bob', 'state', { id: c1.id, rev: r.j.calc.rev }); assert.ok(r.j.same, 'poll with the same rev answers small');
    t('timer expiry sells to the high bidder at the server clock; a bid after the bell gets "Sold"; next lot opens by itself; light polling');
    // --- undo a sale, sold now, next lot, reorder, end ---
    r = await call('ann', 'ctl', { id: c1.id, op: 'undo' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L1', 'undo with no bid on the new lot reopens the last sale'); assert.ok(!r.j.calc.sold.length); const back = r.j.calc.a.high.amt; assert.strictEqual(back, hb.amt, 'undoing a sale keeps its bids: the winning bid stands');
    r = await call('ann', 'ctl', { id: c1.id, op: 'sold' }); ok(r); assert.strictEqual(r.j.calc.sold[0].amt, back); r = await call('ann', 'ctl', { id: c1.id, op: 'next' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L2');
    tick(1000); r = await call('bob', 'bid', { id: c1.id, lot: 'L2', amt: 50 }); ok(r); r = await call('ann', 'ctl', { id: c1.id, op: 'next' }); assert.strictEqual(r.s, 409, 'next refused while a bid stands');
    r = await call('ann', 'ctl', { id: c1.id, op: 'sold' }); ok(r); assert.strictEqual(r.j.calc.sold[0].lot, 'L2');
    r = await call('ann', 'ctl', { id: c1.id, op: 'undo' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L2', 'undo right after a sale reopens the lot'); assert.ok(!r.j.calc.sold.find((s) => s.lot === 'L2'));
    assert.strictEqual(r.j.calc.a.high.amt, 50, 'the undone sale keeps its bid'); r = await call('ann', 'ctl', { id: c1.id, op: 'undo' }); ok(r); assert.strictEqual(r.j.calc.a.high, null, 'then Undo last bid removes it'); r = await call('ann', 'ctl', { id: c1.id, op: 'undo' }); assert.strictEqual(r.s, 409, 'nothing left to undo');
    r = await call('ann', 'ctl', { id: c1.id, op: 'next' }); ok(r); assert.strictEqual(r.j.calc.a.cur, 'L3', 'next skips an unbid lot (it comes back later)');
    const order = r.j.calc.a.order.slice().reverse(); r = await call('ann', 'ctl', { id: c1.id, op: 'reorder', order }); ok(r); assert.deepStrictEqual(r.j.calc.a.order, order);
    r = await call('ann', 'ctl', { id: c1.id, op: 'reorder', order: order.slice(1) }); assert.strictEqual(r.s, 400);
    r = await call('ann', 'ctl', { id: c1.id, op: 'end' }); ok(r); assert.strictEqual(r.j.calc.a.status, 'closed');
    r = await call('bob', 'bid', { id: c1.id, lot: 'L3', amt: 500 }); assert.strictEqual(r.s, 409);
    t('undo a sale (reopens), Sold now, Next lot (refused with a bid, skips unbid lots), reorder (every lot once), End auction');
    // --- enter-results mode + payouts vs hand calculation (NFL playoffs 3% x13 + 13% x2 + 35% = 100%) ---
    r = await call('ann', 'create', base({ name: 'Bar Calcutta', mode: 'manual', take: { kind: 'pct', v: 7 } })); ok(r); const c2 = r.j.calc;
    for (const w of ['bob', 'cat']) ok(await call(w, 'join', { code: c2.code }));
    const pid = async (w) => (await call(w, 'get', { id: c2.id })).j.calc.me;
    const A = await pid('ann'), B = await pid('bob'), Cc = await pid('cat');
    r = await call('bob', 'enter', { id: c2.id, lot: 'L1', pid: A, amt: 201 }); assert.strictEqual(r.s, 403, 'only the commissioner enters results');
    r = await call('ann', 'bid', { id: c2.id, lot: 'L1', amt: 201 }); assert.strictEqual(r.s, 409, 'no live bids in enter-results mode');
    ok(await call('ann', 'enter', { id: c2.id, lot: 'L1', pid: B, amt: 150 }));
    ok(await call('ann', 'enter', { id: c2.id, lot: 'L1', pid: A, amt: 201 }), 'change an entry');
    for (let i = 2; i <= 12; i++) ok(await call('ann', 'enter', { id: c2.id, lot: 'L' + i, pid: i % 2 ? B : Cc, amt: 62 }));
    r = await call('ann', 'enter', { id: c2.id, lot: 'L13', name: '<b>Joe</b> at the bar', amt: 120 }); ok(r); assert.strictEqual(r.j.calc.a.status, 'closed', 'all lots in: closed');
    r = await call('ann', 'edit', Object.assign(base({ mode: 'manual' }), { id: c2.id })); assert.strictEqual(r.s, 409, 'locked once results are in');
    r = await call('ann', 'buyback', { id: c2.id, lot: 'L1', who: 0 }); assert.strictEqual(r.s, 409, 'pro teams: no buy-back'); assert.ok(/not available for pro/.test(r.j.error));
    r = await call('ann', 'por', { id: c2.id, lot: 'L1', players: [{ pid: B }] }); assert.strictEqual(r.s, 409, 'pro teams: no players of record');
    ok(await call('ann', 'unenter', { id: c2.id, lot: 'L13' })); ok(await call('ann', 'enter', { id: c2.id, lot: 'L13', name: '<b>Joe</b> at the bar', amt: 120 }));
    feedOn = true; C._reset(); // the playoffs are played
    r = await call('ann', 'board', { id: c2.id }); ok(r); const bd = r.j.board;
    assert.strictEqual(bd.pot, 1003); assert.strictEqual(bd.take, 70.21); assert.strictEqual(bd.pool, 932.79);
    assert.deepStrictEqual(bd.rows.map((x) => [x.each, x.hits, x.paid]), [[27.99, 13, 363.77], [121.27, 2, 242.54], [326.48, 1, 326.48]]);
    const earned = {}; bd.lots.forEach((l) => { earned[l.id] = l.earned; });
    const want = { L1: 531.69, L2: 55.97, L3: 27.99, L4: 27.99, L5: 0, L6: 0, L7: 0, L8: 177.23, L9: 55.96, L10: 27.98, L11: 27.98, L12: 0, L13: 0 };
    assert.deepStrictEqual(earned, want, 'lot earnings = hand calculation');
    assert.strictEqual(bd.paidOut, 932.79); assert.strictEqual(Math.round(Object.values(earned).reduce((a, x) => a + x, 0) * 100), 93279, 'payouts sum exactly to the pool');
    const own = {}; bd.owners.forEach((o) => { own[o.name] = o; });
    assert.strictEqual(own.AnnBets.spent, 201); assert.strictEqual(own.AnnBets.won, 531.69); assert.strictEqual(own.BobBets.won, Math.round((27.99 + 0 + 0 + 55.96 + 27.98) * 100) / 100);
    assert.strictEqual(own.BobBets.spent, 62 * 5); assert.strictEqual(own['bJoe/b at the bar'].spent, 120); assert.strictEqual(own['bJoe/b at the bar'].alive, 0);
    assert.ok(bd.over, 'event over: champion known'); assert.strictEqual(bd.inPlay, 0);
    const lot1 = own.AnnBets.lots.find((l) => l.id === 'L1'); assert.deepStrictEqual([lot1.cost, lot1.earned, lot1.share], [201, 531.69, 'all']);
    assert.ok(bd.lots.every((l) => Array.isArray(l.por) && !l.por.length) && r.j.calc.local === false, 'pro lots: no players of record, buy-back hidden');
    t('enter-results mode (members + a non-member name, change an entry, commissioner only); NFL playoffs payouts = hand calculation to the cent: pot $1,003, 7% take $70.21, pool $932.79, win $27.99/$27.98, conf. champ $121.27, champion $326.48');
    r = await call('ann', 'board', { id: c2.id }); assert.ok(r.j.audit.some((a) => /Changed Team 2|Changed Kansas/.test(a.what) || /was BobBets \$150/.test(a.what)), 'audit shows the change');
    r = await call('ann', 'unenter', { id: c2.id, lot: 'L13' }); assert.strictEqual(r.s, 409, 'event started: ownership final'); r = await call('ann', 'board', { id: c2.id }); assert.strictEqual(r.j.board.pot, 1003); assert.ok(r.j.audit.some((a) => /Removed the result for The field/.test(a.what)));
    t('enter-results audit trail (entered / changed / removed); no changes once the event has started');
    // --- take: flat and capped; take as % already above ---
    feedOn = false; C._reset(); const pre = { take: { kind: 'flat', v: 50 } }; r = await call('ann', 'create', base(Object.assign({ name: 'Flat take', mode: 'manual' }, pre))); const c3 = r.j.calc;
    for (let i = 1; i <= 13; i++) ok(await call('ann', 'enter', { id: c3.id, lot: 'L' + i, name: 'Buyer ' + (i % 5), amt: i === 1 ? 201 : i === 13 ? 120 : 62 }));
    feedOn = true; C._reset(); r = await call('ann', 'board', { id: c3.id }); assert.deepStrictEqual([r.j.board.pot, r.j.board.take, r.j.board.pool, r.j.board.paidOut], [1003, 50, 953, 953]);
    feedOn = false; C._reset(); r = await call('ann', 'create', base({ name: 'Big flat', mode: 'manual', take: { kind: 'flat', v: 5000 } })); const c4 = r.j.calc; ok(await call('ann', 'enter', { id: c4.id, lot: 'L1', name: 'Al', amt: 40 }));
    feedOn = true; C._reset(); r = await call('ann', 'board', { id: c4.id }); assert.deepStrictEqual([r.j.board.pot, r.j.board.take, r.j.board.pool], [40, 40, 0], 'flat take never more than the pot');
    t('commissioner take: flat $50 (pool $953, paid out exactly) and flat over the pot capped at the pot');
    // --- rounding: slots always sum exactly to the pool; extra cents to the bigger payouts ---
    let cases = 0; for (let poolC = 0; poolC < 40000; poolC += 137) for (const rows of [[{ n: 13, bp: 300 }, { n: 2, bp: 1300 }, { n: 1, bp: 3500 }], [{ n: 63, bp: 100 }, { n: 4, bp: 400 }, { n: 1, bp: 2100 }], [{ n: 272, bp: 25 }, { n: 1, bp: 3200 }], [{ n: 3, bp: 3333 }, { n: 1, bp: 1 }]]) {
      const a = C.slotAmounts(rows, poolC), flat = a.flat(); assert.strictEqual(flat.reduce((s, x) => s + x, 0), poolC); a.forEach((x) => assert.ok(Math.max(...x) - Math.min(...x) <= 1)); cases++;
      const big = rows.map((r, i) => i).sort((i, j) => rows[j].bp - rows[i].bp)[0]; assert.ok(a[big][0] >= Math.floor(poolC * rows[big].bp / 10000)); }
    const a1 = C.slotAmounts([{ n: 13, bp: 300 }, { n: 2, bp: 1300 }, { n: 1, bp: 3500 }], 93279); assert.deepStrictEqual([a1[2][0], a1[1], a1[0].slice(0, 4)], [32648, [12127, 12127], [2799, 2799, 2799, 2798]]);
    t('rounding: ' + cases + ' pools x tables sum exactly to the pool; extra cents go to the bigger payouts first');
    // --- manual result entry (custom event, no feed) with audit trail ---
    r = await call('ann', 'create', { name: 'Office pool', ev: 'custom', lots: [{ teams: [{ name: 'Red' }] }, { teams: [{ name: 'Blue' }] }, { teams: [{ name: 'Green' }, { name: 'Gold' }] }], rows: [{ k: 'win', n: 3, pct: 20 }, { k: 'champ', n: 1, pct: 40 }], minBid: 5, inc: 5, timer: 10, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); ok(r); const c5 = r.j.calc;
    assert.deepStrictEqual(c5.lots.map((l) => l.teams.map((x) => x.id)), [['x1'], ['x2'], ['x3', 'x4']]);
    ok(await call('ann', 'enter', { id: c5.id, lot: 'L1', name: 'Al', amt: 50 })); ok(await call('ann', 'enter', { id: c5.id, lot: 'L2', name: 'Bo', amt: 30 })); ok(await call('ann', 'enter', { id: c5.id, lot: 'L3', name: 'Cy', amt: 20 }));
    r = await call('bob', 'result', { id: c5.id, team: 'x1', wins: 2 }); assert.strictEqual(r.s, 404, 'not a member: cannot even see it');
    ok(await call('ann', 'result', { id: c5.id, team: 'x1', wins: 2, champ: true })); ok(await call('ann', 'result', { id: c5.id, team: 'x4', wins: 1 })); ok(await call('ann', 'result', { id: c5.id, team: 'x2', out: true }));
    r = await call('ann', 'board', { id: c5.id }); const L = {}; r.j.board.lots.forEach((l) => { L[l.id] = l.earned; }); assert.deepStrictEqual(L, { L1: 80, L2: 0, L3: 20 }); assert.strictEqual(r.j.board.paidOut, 100);
    assert.ok(r.j.audit.filter((a) => /^Result for/.test(a.what)).length === 3);
    ok(await call('ann', 'result', { id: c5.id, team: 'x1', clear: true })); r = await call('ann', 'board', { id: c5.id }); assert.strictEqual(r.j.board.lots[0].earned, 0); assert.ok(r.j.audit.some((a) => /Cleared/.test(a.what)));
    t('manual results (custom event): wins / champion / out by the commissioner, payouts follow, every change in the audit trail, clear goes back');
    // --- manual override on top of the ESPN feed ---
    ok(await call('ann', 'result', { id: c2.id, team: '5', wins: 1 })); r = await call('ann', 'board', { id: c2.id }); assert.ok(r.j.board.rows[0].over, 'a 14th win is flagged (13 slots)'); assert.strictEqual(r.j.board.lots.find((l) => l.id === 'L5').earned, 0);
    ok(await call('ann', 'result', { id: c2.id, team: '5', clear: true }));
    t('manual override on an ESPN event; more wins than slots are flagged, never over-paid');
    // --- series sports: a series counts once ---
    const SG = (id, t0, a, b, wa, wb, done, head) => ({ id, t: t0, done: true, st: 3, week: 0, head, teams: [{ id: a, score: 100, winner: true }, { id: b, score: 90, winner: false }], series: { done, wins: { [a]: wa, [b]: wb } } });
    const RS = C.teamResults(C.EVENTS.nba_po, [SG('1', 1, 'A', 'B', 3, 2, false, 'East 1st Round - Game 5'), SG('2', 2, 'A', 'B', 4, 2, true, 'East 1st Round - Game 6'), SG('3', 3, 'A', 'C', 4, 0, true, 'East Semifinals - Game 4'), SG('3b', 3, 'A', 'C', 4, 0, true, 'East Semifinals - Game 4'), SG('4', 4, 'A', 'D', 4, 3, true, 'NBA Finals - Game 7')], new Set(['A', 'B', 'C', 'D']));
    assert.deepStrictEqual([RS.A.wins, RS.A.champ, RS.A.reached, RS.B.out, RS.C.out, RS.D.out, RS.D.reached], [3, true, 4, true, true, true, 4]);
    t('series leagues (NBA/NHL/MLB): a win = a series won, counted once; finals winner = champion');
    // --- ESPN parse: NFL feed round mapping incl. byes ---
    const RN = (await call('ann', 'board', { id: c2.id })).j.board.lots; const t1 = RN[0].teams[0].r; assert.deepStrictEqual([t1.wins, t1.reached, t1.champ], [3, 4, true], 'No. 1 seed: bye, 3 wins, champion');
    t('ESPN NFL postseason weeks 1/2/3/5 -> rounds; a bye team reaches round 2 without a win');
    // --- buy back half (OWNER DECISION Nov 16 2026): only the lot's own player(s) of record, half for half price ---
    C._reset(); r = await call('ann', 'create', { name: 'Golf day', ev: 'custom', lots: [{ teams: [{ name: 'Red' }], playersOfRecord: [{ me: true }] }, { teams: [{ name: 'Blue' }], playersOfRecord: [{ guest: 'g7', name: 'Bo Guest' }] }, { teams: [{ name: 'Green' }, { name: 'Gold' }] }],
      rows: [{ k: 'win', n: 3, pct: 20 }, { k: 'champ', n: 1, pct: 40 }], minBid: 5, inc: 5, timer: 10, buyBack: true, take: { kind: 'pct', v: 7 }, order: 'listed', mode: 'manual' }); ok(r, 'custom with buy-back'); const c7 = r.j.calc;
    assert.strictEqual(c7.local, true); assert.deepStrictEqual(c7.lots.map((l) => l.por.map((p) => [p.name, p.me])), [[['AnnBets', true]], [['Bo Guest', false]], []]); assert.ok(!/"k":|g7/.test(JSON.stringify(c7.lots)) && !JSON.stringify(c7).includes('g7'), 'player-of-record keys never sent');
    for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: c7.code }));
    const P7 = {}; for (const w of ['ann', 'bob', 'cat', 'dan']) P7[w] = (await call(w, 'get', { id: c7.id })).j.calc.me;
    r = await call('bob', 'por', { id: c7.id, lot: 'L2', players: [{ pid: P7.bob }] }); assert.strictEqual(r.s, 403, 'only the commissioner sets players of record');
    ok(await call('ann', 'por', { id: c7.id, lot: 'L2', add: { pid: P7.bob } })); ok(await call('ann', 'por', { id: c7.id, lot: 'L2', remove: 0 }), 'remove the guest, keep bob'); r = await call('bob', 'get', { id: c7.id }); assert.deepStrictEqual(r.j.calc.lots[1].por, [{ pid: P7.bob, name: 'BobBets', me: true }]);
    ok(await call('ann', 'enter', { id: c7.id, lot: 'L1', pid: P7.cat, amt: 201 })); ok(await call('ann', 'enter', { id: c7.id, lot: 'L2', pid: P7.ann, amt: 63 })); ok(await call('ann', 'enter', { id: c7.id, lot: 'L3', name: 'Cy', amt: 20 }));
    r = await call('dan', 'buyback', { id: c7.id, lot: 'L2' }); assert.strictEqual(r.s, 403, 'a non-player is refused'); assert.ok(/own player/.test(r.j.error));
    r = await call('cat', 'buyback', { id: c7.id, lot: 'L2' }); assert.strictEqual(r.s, 403, 'not even another lot\'s buyer');
    r = await call('ann', 'buyback', { id: c7.id, lot: 'L3', who: 0 }); assert.strictEqual(r.s, 409, 'a lot with no players of record cannot be bought back');
    ok(await call('bob', 'buyback', { id: c7.id, lot: 'L2' }), 'the lot\'s own player buys back half');
    r = await call('bob', 'buyback', { id: c7.id, lot: 'L2' }); assert.strictEqual(r.s, 409, 'only once');
    r = await call('dan', 'buyback', { id: c7.id, lot: 'L2', clear: true }); assert.strictEqual(r.s, 403); ok(await call('bob', 'buyback', { id: c7.id, lot: 'L2', clear: true }), 'the buyer can undo their own buy-back'); ok(await call('bob', 'buyback', { id: c7.id, lot: 'L2' }));
    ok(await call('ann', 'buyback', { id: c7.id, lot: 'L1', who: 0 }), 'commissioner records it for the player of record (here: herself)');
    tick(1000); ok(await call('ann', 'result', { id: c7.id, team: 'x2', wins: 1 })); tick(1000); ok(await call('ann', 'result', { id: c7.id, team: 'x1', wins: 2, champ: true }));
    r = await call('ann', 'board', { id: c7.id }); const b7 = r.j.board, o7 = {}; b7.owners.forEach((o) => { o7[o.name] = [o.spent, o.won]; });
    assert.deepStrictEqual([b7.pot, b7.take, b7.pool, b7.paidOut], [284, 19.88, 264.12, 264.12]);
    assert.deepStrictEqual(b7.lots.map((l) => l.earned), [211.29, 52.83, 0], 'Blue first win $52.83 (extra cent), Red 2 wins + champion $211.29');
    assert.deepStrictEqual(o7, { CatBets: [100.5, 105.65], AnnBets: [132, 132.06], BobBets: [31.5, 26.41], Cy: [20, 0] }, 'half cost and half winnings; odd cent to the winning bidder');
    assert.deepStrictEqual(b7.lots[1].bb, { pid: P7.bob, name: 'BobBets' });
    r = await call('bob', 'buyback', { id: c7.id, lot: 'L2', clear: true }); assert.strictEqual(r.s, 409, 'results are in: the buy-back is final'); assert.strictEqual(r.j.code, 'frozen');
    assert.ok(r = (await call('ann', 'board', { id: c7.id })).j.audit.some((a) => /BobBets bought back half of Blue for \$31.5/.test(a.what)) && r);
    C._reset(); r = await call('ann', 'create', { name: 'No BB', ev: 'custom', lots: [{ teams: [{ name: 'A' }], playersOfRecord: [{ me: true }] }, { teams: [{ name: 'B' }] }], rows: [{ k: 'champ', n: 1, pct: 100 }], minBid: 5, inc: 5, timer: 10, buyBack: false, take: { kind: 'none' }, order: 'listed', mode: 'manual' }); const c8 = r.j.calc;
    ok(await call('ann', 'enter', { id: c8.id, lot: 'L2', name: 'Zed', amt: 10 })); r = await call('ann', 'buyback', { id: c8.id, lot: 'L2', self: true }); assert.strictEqual(r.s, 409, 'switched off per Calcutta');
    t('buy back half (owner rule): only the lot\'s players of record (non-player refused, player allowed, commissioner records on their behalf), pro lots have none (hidden, refused), switchable per Calcutta; $201 -> $100.50 each, $211.29 -> $105.65 winner / $105.64 buyer; keys never sent');
    // --- adapter + stats contract ---
    await assert.rejects(C.setPlayersOfRecord(c2.id, 'L1', [pe(SID.bob)]), /only for local/); const sp = await C.setPlayersOfRecord(c7.id, 'L3', [pe(SID.dan), 'g:guest1', { name: 'Walk In' }]); assert.strictEqual(sp.count, 3);
    const g = await C.attachToGroup(c2.id, 'GRP1', 'K1'); assert.deepStrictEqual(g.group, { groupId: 'GRP1', contestId: 'K1' });
    const ps = await C.potSummary(c2.id); assert.deepStrictEqual([ps.bids, ps.take, ps.pool, ps.main], [1003, 70.21, 932.79, true]); assert.ok(Array.isArray(ps.payouts) && ps.payouts.every((p) => 'won' in p && 'spent' in p && !('key' in p)));
    r = await call('dan', 'join', { code: c2.code }); assert.strictEqual(r.s, 409, 'attached to a group: join through the group');
    const st = await C.statsFor(pe(SID.ann), { from: '2026-01-01', to: '2026-12-31' }); const rec = st.find((x) => x.id === c2.id);
    assert.ok(rec, 'record for the Calcutta ann holds lots in'); assert.deepStrictEqual(Object.keys(rec).sort(), ['contestId', 'date', 'extra', 'groupId', 'id', 'kind', 'pl', 'place', 'result', 'spent', 'sport', 'src', 'title', 'verified', 'won'].sort());
    assert.deepStrictEqual([rec.src, rec.kind, rec.sport, rec.result, rec.verified, rec.spent, rec.won, rec.groupId], ['calcutta', 'calcutta', 'nfl', null, true, 201, rec.won, 'GRP1']); assert.strictEqual(rec.pl, Math.round((rec.won - rec.spent) * 100) / 100); assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rec.date));
    assert.ok(!st.find((x) => x.id === c5.id), 'no record where the user held no lots'); assert.strictEqual((await C.statsFor(pe(SID.ann), { from: '2027-01-01' })).length, 0, 'date filter');
    assert.strictEqual(rec.extra.lots[0].name, 'Kansas bCity/b');
    t('adapter: attachToGroup, potSummary {bids, take, pool, payouts[]}; statsFor contract record shape, date filter, only Calcuttas with lots');
    // --- delete before lock, not after ---
    r = await call('ann', 'create', base({ name: 'Delete me' })); const c6 = r.j.calc; ok(await call('ann', 'delete', { id: c6.id })); r = await call('ann', 'mine'); assert.ok(!r.j.calcs.some((x) => x.id === c6.id));
    r = await call('ann', 'delete', { id: c2.id }); assert.strictEqual(r.s, 409); t('delete only before the first bid / result');
    // --- privacy + outbound ---
    const all = raw.join('\n'); Object.values(SID).forEach((s) => { assert.ok(!all.includes(s) && !all.includes(s.slice(0, 18)), 'sync id leaked'); assert.ok(!all.includes(C.mkOf(pe(s))), 'member key leaked'); }); assert.ok(!/phone\.oddable|"mk"|"comm":"|t-ann/.test(all));
    assert.ok(urls.length && urls.every((u) => u.startsWith('https://site.api.espn.com/apis/site/v2/sports/')), 'only ESPN fetched');
    t('no sync ids, member keys, phone accounts or tokens in any response; only ESPN fetched (' + urls.length + ' calls)');
    console.log('\nPASS ' + pass + ' checks'); process.exit(0);
  } catch (e) { console.error('FAIL', e); process.exit(1); }
});
