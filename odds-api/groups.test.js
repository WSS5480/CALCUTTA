// Run: node odds-api/groups.test.js   (no network, no database: Supabase, ESPN and sign-in are in-memory fakes)
const assert = require('assert'), http = require('http'), G = require('./groups'), D = G._deps;
// ---- fake database (async with a random delay so parallel requests really interleave) ----
let db = {}, slow = 0, lost = 0;
const wait = () => new Promise((r) => setTimeout(r, slow ? Math.random() * slow : 0));
D.S = {
  dbGet: async (id) => { await wait(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await wait(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await wait(); if (!db[id] || db[id].updated !== Number(was)) { lost++; return false; } db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
// ---- fake sign-in: x-token "t-<who>"; phone accounts map to a sync row id ----
const SID = { ann: 'a1a1a1a1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', bob: 'b2b2b2b2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', cat: 'c3c3c3c3cccccccccccccccccccccccccccccccccccccccccccccccccccccccc', dan: 'd4d4d4d4dddddddddddddddddddddddddddddddddddddddddddddddddddddddd' };
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
const NAMES = { a1a1a1a1: 'AnnTheCommish', b2b2b2b2: 'BobBets', c3c3c3c3: 'CatCovers', d4d4d4d4: 'DanDog' };
D.acct = () => ({ who: (req) => { const t = String(req.headers['x-token'] || ''); if (!t.startsWith('t-')) return null; const w = t.slice(2); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : w.includes('@') ? w : /^p\d+$/.test(w) ? pe(w.padEnd(64, '0')) : null; },
  phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable' });
D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
// ---- fake ESPN schedule ----
const Z = (s) => Date.parse(s), START = Z('2026-11-22T18:00:00Z'); // Sunday noon CT
const KICK = { 501: START, 502: Z('2026-11-22T21:25:00Z'), 503: Z('2026-11-29T18:00:00Z'), 504: Z('2026-11-23T01:20:00Z') };
let urls = [];
D.fetch = async (u) => { urls.push(u); return { ok: true, json: async () => ({ events: /college/.test(u) ? [] : Object.keys(KICK).map((id) => ({ id, date: new Date(KICK[id]).toISOString() })) }) }; };
let NOW = Z('2026-11-17T18:00:00Z'); D.now = () => NOW;
const HOUR = 3600e3, DAY = 864e5;
const row = (sid, bets) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets }, updated: 1 }; };
Object.values(SID).forEach((s) => row(s, []));
// ---- server ----
const srv = http.createServer(async (req, res) => { if (!(await G.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P, raw = [];
const call = async (who, op, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + '/groups/' + op, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': who ? 't-' + who : '', 'x-ip': ip || '9.9.9.' + (who || 'x').length }, body: JSON.stringify(b || {}) }); const txt = await r.text(); raw.push(txt); return { s: r.status, j: JSON.parse(txt) }; };
const base = (o) => Object.assign({ name: 'Sunday Crew', sport: 'nfl', fmt: 'standings', start: START, runs: 'w4', verified: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 0, cap: 0, entry: 25, split: '60/30/10', take: { kind: 'pct', v: 10 }, join: { requests: true, open: false, max: 20, late: 'no' } }, o || {});
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };

srv.listen(0, async () => {
  P = srv.address().port; let r;
  try {
    // --- sign-in required ---
    r = await call(null, 'mine'); assert.strictEqual(r.s, 401); t('signed-out request refused');
    // --- validation ---
    const badOnes = [[{ name: 'x' }, 'name'], [{ sport: 'nba' }, 'sport'], [{ fmt: 'h2h' }, 'coming soon'], [{ start: NOW - 1 }, 'future'], [{ start: NOW + 500 * DAY }, 'too far'],
      [{ take: { kind: 'pct', v: 51 } }, 'take 51%'], [{ take: { kind: 'pct', v: 2.5 } }, 'take 2.5%'], [{ take: { kind: 'flat', v: -5 } }, 'flat negative'], [{ take: { kind: 'flat', v: 501 } }, 'flat over the pot (25 x 20)'], [{ take: { kind: 'flat', v: 1.005 } }, 'flat sub-cent'],
      [{ legs: 11 }, 'legs 11'], [{ cap: 30 }, 'cap 30'], [{ entry: -1 }, 'entry negative'], [{ entry: 2.5 }, 'entry cents'], [{ join: { max: 7, late: 'no' } }, 'max 7'], [{ types: {} }, 'no bet types'], [{ runs: 'w21' }, '21 weeks'], [{ runs: 'custom', endDay: '2026-13-01' }, 'bad date'], [{ metric: 'vibes' }, 'metric'], [{ minBets: 11 }, 'min bets'], [{ split: '90/10' }, 'split'], [{ join: { max: 20, late: 'always' } }, 'late']];
    for (const [o, m] of badOnes) { G._reset(); r = await call('ann', 'create', base(o), '7.7.7.' + m.length); assert.strictEqual(r.s, 400, 'refused: ' + m + ' got ' + r.s); }
    t('every bad option is refused with 400 (' + badOnes.length + ' cases)');
    // --- create (XSS name) ---
    r = await call('ann', 'create', base({ name: '<img src=x onerror=alert(1)>Crew"\'' })); ok(r, 'create');
    const g1 = r.j.group; assert.ok(!/[<>"']/.test(g1.name), 'name cleaned: ' + g1.name); assert.strictEqual(g1.role, 'comm'); assert.ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(g1.code)); assert.strictEqual(g1.members.length, 1); assert.strictEqual(g1.members[0].name, 'AnnTheCommish');
    assert.strictEqual(g1.endDay, '2026-12-19', '4 weeks from Sunday Nov 22'); assert.strictEqual(g1.takeText, 'Commissioner keeps 10% of the pot');
    t('create: name stripped of HTML characters, invite code, commissioner is first member by handle');
    // --- private group: a stranger cannot read it ---
    r = await call('bob', 'get', { id: g1.id }); assert.strictEqual(r.s, 404); r = await call('bob', 'standings', { id: g1.id }); assert.strictEqual(r.s, 404); r = await call('bob', 'player', { id: g1.id, pid: g1.me }); assert.strictEqual(r.s, 404);
    r = await call('bob', 'mine'); ok(r); assert.strictEqual(r.j.groups.length, 0); assert.strictEqual(r.j.open.length, 0, 'not shown in Open groups');
    t('non-member cannot read a private group, its standings or a player');
    // --- preview by code shows the take BEFORE joining; join by code ---
    r = await call('bob', 'preview', { code: g1.code.toLowerCase().replace('-', ' ') }); ok(r); assert.strictEqual(r.j.group.role, 'none'); assert.strictEqual(r.j.group.takeText, 'Commissioner keeps 10% of the pot'); assert.ok(!r.j.group.members && !r.j.group.code, 'no member list or code in the preview');
    r = await call('bob', 'join', { code: g1.code }); ok(r); assert.strictEqual(r.j.group.members.length, 2); assert.strictEqual(r.j.group.role, 'member'); assert.ok(!r.j.group.reqs, 'members do not see requests');
    r = await call('bob', 'join', { code: g1.code }); ok(r); assert.strictEqual(r.j.group.members.length, 2, 'joining twice changes nothing');
    t('code preview shows the take to a non-member; join by code (any case/spacing); idempotent');
    // --- wrong codes throttled ---
    for (let i = 0; i < 10; i++) { r = await call('cat', 'join', { code: 'ZZZZ-ZZZ' + i }, '5.5.5.5'); assert.strictEqual(r.s, 404); }
    r = await call('cat', 'join', { code: g1.code }, '5.5.5.5'); assert.strictEqual(r.s, 429, 'blocked after 10 wrong codes even with the right one');
    G._reset(); t('10 wrong codes -> 15 minute block (per account and IP)');
    // --- non-commissioner cannot mark paid / approve; commissioner can mark paid ---
    const bobPid = r.j.group ? null : (await call('bob', 'get', { id: g1.id })).j.group.me;
    r = await call('bob', 'paid', { id: g1.id, pid: bobPid, paid: true }); assert.strictEqual(r.s, 403);
    r = await call('ann', 'paid', { id: g1.id, pid: bobPid, paid: true }); ok(r); assert.ok(r.j.group.members.find((m) => m.pid === bobPid).paid);
    t('only the commissioner marks entries paid');
    // --- open group: request / approve / deny ---
    r = await call('ann', 'create', base({ name: 'Valley Sharps', join: { requests: true, open: true, max: 3, late: 'no' }, take: { kind: 'flat', v: 20 } })); ok(r); const g2 = r.j.group;
    r = await call('cat', 'mine'); ok(r); const og = r.j.open.find((x) => x.id === g2.id); assert.ok(og, 'listed in Open groups'); assert.strictEqual(og.takeText, 'Commissioner keeps $20 of the pot'); assert.ok(!og.members && !og.code, 'open card has no members/code');
    r = await call('cat', 'get', { id: g2.id }); ok(r); assert.deepStrictEqual(r.j.group.rules.take, { kind: 'flat', v: 20 });
    t('take is visible to a non-member of a joinable group (open card + group sheet)');
    r = await call('cat', 'request', { id: g2.id }); ok(r); r = await call('dan', 'request', { id: g2.id }); ok(r);
    r = await call('cat', 'mine'); assert.ok(r.j.pending.some((x) => x.id === g2.id)); assert.ok(!r.j.open.some((x) => x.id === g2.id));
    r = await call('ann', 'get', { id: g2.id }); assert.strictEqual(r.j.group.reqs.length, 2); const [qc, qd] = r.j.group.reqs; assert.strictEqual(qc.name, 'CatCovers');
    r = await call('bob', 'decide', { id: g2.id, pid: qc.pid, ok: true }); assert.strictEqual(r.s, 403, 'bob is not even a member'); await call('bob', 'join', { code: g2.code }); r = await call('bob', 'decide', { id: g2.id, pid: qc.pid, ok: true }); assert.strictEqual(r.s, 403, 'member but not commissioner');
    r = await call('ann', 'decide', { id: g2.id, pid: qc.pid, ok: true }); ok(r); assert.strictEqual(r.j.group.members.length, 3);
    r = await call('ann', 'decide', { id: g2.id, pid: qd.pid, ok: false }); ok(r); r = await call('dan', 'request', { id: g2.id }); assert.strictEqual(r.s, 409, 'denied person cannot ask again');
    t('request -> commissioner approves / denies; non-commissioner refused; denied cannot re-ask');
    // --- max members ---
    r = await call('dan', 'join', { code: g2.code }); assert.strictEqual(r.s, 409); assert.match(r.j.error, /full/); t('max members enforced (3 of 3)');
    // --- requests toggle + edit before start ---
    r = await call('ann', 'requests', { id: g2.id, on: false }); ok(r); assert.strictEqual(r.j.group.join.requests, false);
    r = await call('ann', 'edit', base({ id: g2.id, name: 'Valley Sharps', take: { kind: 'pct', v: 5 }, join: { requests: false, open: true, max: 3, late: 'no' } })); ok(r); assert.strictEqual(r.j.group.takeText, 'Commissioner keeps 5% of the pot');
    r = await call('bob', 'edit', base({ id: g2.id })); assert.strictEqual(r.s, 403);
    t('before start: commissioner can toggle requests and edit; others cannot');
    // --- leave before start ---
    r = await call('bob', 'leave', { id: g2.id }); ok(r); r = await call('ann', 'leave', { id: g2.id }); assert.strictEqual(r.s, 409); t('member can leave before start; commissioner cannot leave');
    // --- late join groups ---
    r = await call('ann', 'create', base({ name: 'Late OK', join: { requests: false, open: false, max: 8, late: '2w' } })); ok(r); const g3 = r.j.group;
    // --- concurrent join race ---
    r = await call('ann', 'create', base({ name: 'Race', join: { requests: false, open: false, max: 50, late: 'no' } })); ok(r); const g4 = r.j.group;
    slow = 15; lost = 0; const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => call('p' + (100 + i), 'join', { code: g4.code }, '3.3.' + i + '.1'))); slow = 0;
    rs.forEach((x) => ok(x, 'race join')); r = await call('ann', 'get', { id: g4.id }); assert.strictEqual(r.j.group.members.length, 13, '12 parallel joins + commissioner, none lost'); assert.ok(lost > 0, 'the race really happened (' + lost + ' writes lost and redone)'); console.log('    (' + lost + ' conflicting writes were redone)');
    t('12 simultaneous joins: none lost (conditional writes on `updated`)');
    // --- rate limit on creates ---
    let last; for (let i = 0; i < 3; i++) last = await call('ann', 'create', base({ name: 'Extra ' + i }), '4.4.4.4'); assert.strictEqual(last.s, 429, '6th create in an hour by one account is refused'); G._reset(); t('create rate limit (5 per hour per account)');

    // ================= rules lock at start =================
    NOW = START + 60e3;
    r = await call('ann', 'edit', base({ id: g2.id, start: START + 7 * DAY })); assert.strictEqual(r.s, 409); assert.match(r.j.error, /locked/);
    r = await call('owner', 'edit', base({ id: g2.id, start: START + 7 * DAY })); assert.ok(r.s === 404 || r.s === 403, 'the owner has no override');
    r = await call('ann', 'requests', { id: g2.id, on: true }); assert.strictEqual(r.s, 409);
    r = await call('cat', 'leave', { id: g2.id }); assert.strictEqual(r.s, 409); r = await call('ann', 'delete', { id: g2.id }); assert.strictEqual(r.s, 409);
    r = await call('ann', 'get', { id: g2.id }); assert.strictEqual(r.j.group.locked, true); assert.strictEqual(r.j.group.takeText, 'Commissioner keeps 5% of the pot', 'take locked as set');
    t('after start: edit / requests toggle / leave / delete refused for everyone, take locked');
    r = await call('dan', 'join', { code: g1.code }); assert.strictEqual(r.s, 409, 'late join "Not allowed"');
    NOW = START + 3 * DAY; r = await call('dan', 'join', { code: g3.code }); ok(r, 'late join within 2 weeks');
    NOW = START + 15 * DAY; r = await call('cat', 'join', { code: g3.code }); assert.strictEqual(r.s, 409, 'late join after 2 weeks');
    t('late joining: Not allowed refuses after start; First 2 weeks allows day 3, refuses day 15');

    // ================= standings =================
    // Group S: any logged bet, NFL, cap $100, metric winnings, min 3 bets a week
    NOW = START - DAY;
    const bid = (ms) => 'b' + ms;
    r = await call('ann', 'create', base({ name: 'Scores', cap: 100, minBets: 3, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 2, join: { requests: false, open: false, max: 20, late: 'no' } })); ok(r); const S = r.j.group;
    for (const w of ['bob', 'cat', 'dan']) ok(await call(w, 'join', { code: S.code }));
    const pre = START - HOUR;
    row(SID.bob, [
      { id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'sp', line: -3, stake: 200, odds: -110, fin: 'won', finPL: 181.82 }, // capped at 100 -> +90.91
      { id: bid(pre + 1), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 50, odds: 150, fin: 'lost', finPL: -50 },
      { id: 'k-KXNFLGAME-26NOV22-yes', kind: 'prop', src: 'kalshi', kt: 'KXNFLGAME-26NOV22KCBUF-KC', text: 'KC · KC at BUF', stake: 40, mult: 2, res: 'won', day: '2026-11-22' }, // verified moneyline +40
      { id: bid(pre + 2), kind: 'prop', text: 'Allen over 250 pass yds', stake: 30, odds: -110, res: 'won', day: '2026-11-22' }, // props off
      { id: bid(pre + 3), kind: 'parlay', legs: [{ gid: '501', side: 'NYG', type: 'ml', away: 'DAL', home: 'NYG' }, { gid: '502', side: 'BUF', type: 'ml', away: 'KC', home: 'BUF' }, { gid: '504', side: 'SF', type: 'ml', away: 'SF', home: 'LAR' }], stake: 10, mult: 6, fin: 'lost', finPL: -10, day: '2026-11-22' }, // 3 legs > 2
      { id: bid(pre + 4), lg: 'nba', gid: '9', day: '2026-11-22', side: 'LAL', type: 'ml', stake: 20, odds: -110, fin: 'won', finPL: 18.18 }, // other sport
      { id: bid(START + 2 * HOUR), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 100, odds: -110, fin: 'won', finPL: 90.91 }, // logged AFTER kickoff
      { id: bid(Z('2026-11-15T12:00:00Z')), gid: '400', away: 'DAL', home: 'NYG', day: '2026-11-15', side: 'NYG', type: 'ml', stake: 100, odds: -110, fin: 'won', finPL: 90.91 }, // before the group
    ]);
    row(SID.cat, [
      { id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'DAL', type: 'sp', line: 3, stake: 100, odds: -110, fin: 'lost', finPL: -100 },
      { id: bid(pre + 9), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'BUF', type: 'ml', stake: 100, odds: -200, fin: 'won', finPL: 50 },
      { id: bid(pre + 10), gid: '503', away: 'GB', home: 'CHI', day: '2026-11-29', side: 'CHI', type: 'sp', line: 2.5, stake: 75, odds: -110 }, // next week, game not started: SECRET PICK
    ]);
    row(SID.dan, [
      { id: bid(pre), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 10, odds: 300, fin: 'won', finPL: 30 },
      { id: bid(pre + 1), gid: '504', away: 'SF', home: 'LAR', day: '2026-11-22', side: 'SF', type: 'ou', line: 44.5, stake: 10, odds: -110, fin: 'won', finPL: 9.09 },
      { id: bid(pre + 2), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'DAL', type: 'ml', stake: 10, odds: 120, fin: 'won', finPL: 12 },
    ]);
    NOW = Z('2026-11-23T12:00:00Z'); // Monday: week 1 games done (504 kicked off Sunday night), week 2 game 503 not started
    r = await call('bob', 'standings', { id: S.id, scope: 'season' }); ok(r); let rows = r.j.rows; const by = (n) => rows.find((x) => x.name === n);
    assert.strictEqual(by('BobBets').t.win, 80.91, 'bob: +90.91 (capped) - 50 + 40 = 80.91'); assert.strictEqual(by('BobBets').t.w, 2); assert.strictEqual(by('BobBets').t.l, 1);
    assert.strictEqual(by('CatCovers').t.win, -50); assert.strictEqual(by('DanDog').t.win, 51.09); assert.strictEqual(by('AnnTheCommish').t.win, 0);
    assert.deepStrictEqual(rows.map((x) => x.name), ['BobBets', 'DanDog', 'AnnTheCommish', 'CatCovers']);
    assert.strictEqual(by('BobBets').t.stake, 190, 'counted stake: 100 (cap) + 50 + 40'); assert.strictEqual(by('BobBets').t.ret, 42.6);
    assert.strictEqual(by('CatCovers').t.short, true, 'cat has 2 bets in week 1, needs 3'); assert.strictEqual(by('DanDog').t.short, false);
    t('winnings ranking; cap $100 scales the win (181.82 -> 90.91); bet-type, parlay legs, sport, before-start and logged-after-kickoff filters; min-bets flag');
    // high score: week 1, cat is short so excluded
    assert.strictEqual(r.j.high[0].name, 'BobBets'); t('weekly high score skips members under the weekly minimum');
    // hidden until kickoff
    r = await call('bob', 'player', { id: S.id, pid: by('CatCovers').pid }); ok(r); assert.strictEqual(r.j.hidden, 1); assert.ok(!r.j.bets.some((b) => /GB|CHI/.test(b.what)), 'secret pick not sent');
    assert.ok(!raw.some((x) => /GB@CHI|CHI \+2\.5/.test(x)), 'never in any response so far');
    r = await call('cat', 'player', { id: S.id, pid: by('CatCovers').pid }); ok(r); assert.ok(r.j.bets.some((b) => /GB@CHI/.test(b.what)), 'cat sees her own open bet');
    raw = []; r = await call('dan', 'standings', { id: S.id, scope: 'week', week: 2 }); ok(r); assert.ok(!/GB@CHI/.test(raw.join('')));
    NOW = KICK[503] + 60e3; G._reset(); r = await call('bob', 'player', { id: S.id, pid: by('CatCovers').pid }); ok(r); assert.strictEqual(r.j.hidden, 0); assert.ok(r.j.bets.some((b) => /GB@CHI/.test(b.what)), 'shown once its game kicked off');
    t('another member\'s bet is never returned before its game kicks off; the owner of the bet sees it');
    // own view shows why a bet did not count
    r = await call('bob', 'player', { id: S.id, pid: by('BobBets').pid }); ok(r); const why = r.j.bets.filter((b) => !b.ok).map((b) => b.why).sort();
    assert.deepStrictEqual(why, ['Logged after the game started', 'More than 2 legs', 'Not NFL', 'This kind of bet does not count here']); assert.ok(r.j.bets.find((b) => b.capped && b.cs === 100 && b.pl === 90.91));
    r = await call('cat', 'player', { id: S.id, pid: by('BobBets').pid }); assert.ok(r.j.bets.every((b) => b.ok), 'other members never see a player\'s not-counted bets');
    t('own drill-down explains not-counted bets; others see only counted ones');
    // deleted bet still counts (ledger)
    db[SID.bob].data.bets = db[SID.bob].data.bets.filter((b) => b.gid !== '502'); G._reset(); NOW += 1000;
    r = await call('bob', 'standings', { id: S.id }); assert.strictEqual(r.j.rows.find((x) => x.name === 'BobBets').t.win, 80.91, 'deleted losing bet still counts'); t('a counted settled bet deleted on the phone still counts (group ledger)');
    // verified-only
    NOW = START - DAY;
    r = await call('ann', 'create', base({ name: 'Verified', verified: true, join: { requests: false, open: false, max: 20, late: 'no' } })); const V = r.j.group; await call('bob', 'join', { code: V.code }); await call('dan', 'join', { code: V.code });
    NOW = Z('2026-11-23T12:00:00Z'); G._reset(); r = await call('bob', 'standings', { id: V.id }); rows = r.j.rows;
    assert.strictEqual(by('BobBets').t.win, 40, 'only the Kalshi-synced bet counts'); assert.strictEqual(by('DanDog').t.n, 0); t('Verified only = only bets synced from the member\'s own Kalshi account');
    // metrics + tiebreak
    const mk = async (metric, extra) => { NOW = START - DAY; const x = (await call('ann', 'create', base(Object.assign({ name: 'M ' + metric, metric, join: { requests: false, open: false, max: 20, late: 'no' } }, extra || {})))).j.group; for (const w of ['bob', 'cat', 'dan']) await call(w, 'join', { code: x.code }); NOW = Z('2026-11-23T12:00:00Z'); G._reset(); return (await call('ann', 'standings', { id: x.id })).j.rows; };
    row(SID.bob, [{ id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 100, odds: -110, fin: 'won', finPL: 90.91 }, { id: bid(pre + 1), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 100, odds: -110, fin: 'lost', finPL: -100 }]);
    row(SID.cat, [{ id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 10, odds: 400, fin: 'won', finPL: 40 }]);
    row(SID.dan, [{ id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 200, odds: -110, fin: 'won', finPL: 181.82 }, { id: bid(pre + 1), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 100, odds: -110, fin: 'lost', finPL: -100 }, { id: bid(pre + 2), gid: '504', away: 'SF', home: 'LAR', day: '2026-11-22', side: 'SF', type: 'ml', stake: 100, odds: -110, fin: 'lost', finPL: -100 }]);
    // bob: +-9.09, 1-1, units -0.09, ret -4.5% ; cat: +40, 1-0, units 4, ret 400% ; dan: -18.18, 1-2, units -1.09, ret -4.5% ; ann: nothing
    rows = await mk('win'); assert.deepStrictEqual(rows.map((x) => x.name), ['CatCovers', 'AnnTheCommish', 'BobBets', 'DanDog']);
    rows = await mk('units'); assert.deepStrictEqual(rows.map((x) => x.name), ['CatCovers', 'AnnTheCommish', 'BobBets', 'DanDog']); assert.strictEqual(rows[0].t.val, 4);
    rows = await mk('ret'); assert.deepStrictEqual(rows.map((x) => x.name.slice(0, 3)), ['Cat', 'Bob', 'Dan', 'Ann'], 'ret: Bob and Dan tie at -4.5%, Ann has no stake (last)'); assert.strictEqual(rows[1].t.ret, rows[2].t.ret);
    rows = await mk('pct'); assert.deepStrictEqual(rows.map((x) => x.name.slice(0, 3)), ['Cat', 'Bob', 'Dan', 'Ann']);
    row(SID.ann, [{ id: bid(pre), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 100, odds: -110, fin: 'won', finPL: 90.91 }, { id: bid(pre + 1), gid: '502', away: 'KC', home: 'BUF', day: '2026-11-22', side: 'KC', type: 'ml', stake: 50, odds: -110, fin: 'lost', finPL: -50 }]); // 1-1 like Bob, better return
    rows = await mk('pct'); assert.strictEqual(rows[1].name, 'AnnTheCommish', 'Win % tie (50%) goes to the better return %'); assert.strictEqual(rows[2].name, 'BobBets');
    t('ranking by Winnings / Units / Return % / Win %, tiebreak Return %');
    // Best five
    const seven = [5, -10, 20, 1, 3, 8, -2].map((p, i) => ({ id: bid(pre + 20 + i), gid: '501', away: 'DAL', home: 'NYG', day: '2026-11-22', side: 'NYG', type: 'ml', stake: 10, odds: -110, fin: p > 0 ? 'won' : 'lost', finPL: p }));
    row(SID.bob, seven); rows = await mk('win', { fmt: 'best5' }); const bb = rows.find((x) => x.name === 'BobBets'); assert.strictEqual(bb.t.win, 37, 'best five of 7: 20+8+5+3+1'); assert.strictEqual(bb.t.w + bb.t.l, 5);
    t('Best five: only the five best results of the week count');
    // ================= pot / take =================
    const g = (entry, paid, n, take, split) => ({ rules: { entry, take, split }, members: Array.from({ length: n }, (_, i) => ({ paid: i < paid })) });
    let p = G.pot(g(1, 3, 4, { kind: 'pct', v: 15 }, '60/30/10')); assert.strictEqual(p.pot, 3); assert.strictEqual(p.expected, 4); assert.strictEqual(p.take, 0.45); assert.strictEqual(p.pool, 2.55); assert.deepStrictEqual(p.places.map((x) => x.amt), [1.54, 0.76, 0.25]);
    assert.strictEqual(Math.round(p.places.reduce((a, x) => a + x.amt, 0) * 100), 255);
    p = G.pot(g(7, 3, 3, { kind: 'pct', v: 10 }, '50/30/20')); assert.strictEqual(p.take, 2.1); assert.deepStrictEqual(p.places.map((x) => x.amt), [9.45, 5.67, 3.78]);
    p = G.pot(g(25, 2, 12, { kind: 'flat', v: 60 }, '100')); assert.strictEqual(p.take, 50, 'flat take never more than the pot'); assert.strictEqual(p.pool, 0);
    p = G.pot(g(25, 12, 12, { kind: 'flat', v: 12.5 }, '60/30/10')); assert.strictEqual(p.take, 12.5); assert.strictEqual(p.pool, 287.5); assert.deepStrictEqual(p.places.map((x) => x.amt), [172.5, 86.25, 28.75]);
    for (let e = 1; e < 40; e++) for (const v of [0, 7, 13, 33, 50]) { const q = G.pot(g(e, 7, 9, { kind: 'pct', v }, '60/30/10')); assert.strictEqual(Math.round(q.places.reduce((a, x) => a + x.amt, 0) * 100), Math.round(q.pool * 100)); assert.strictEqual(Math.round((q.pool + q.take) * 100), Math.round(q.pot * 100)); }
    t('pot: take as % and flat (clamped to the pot), cents rounding, split always sums exactly to the prize pool');
    // ================= privacy =================
    const all = raw.join('\n'); Object.values(SID).forEach((s) => { assert.ok(!all.includes(s) && !all.includes(s.slice(0, 16)), 'sync id leaked'); }); assert.ok(!/phone\.oddable|"mk"|"sid"|t-bob|pinhash/.test(all), 'identity leaked');
    t('no sync ids, phone hashes, member keys or tokens in any response');
    assert.ok(urls.every((u) => /^https:\/\/site\.api\.espn\.com\//.test(u)), 'only ESPN fetched'); t('only ESPN schedule URLs fetched');
    console.log('\nALL ' + pass + ' GROUP TESTS PASSED');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close();
});
