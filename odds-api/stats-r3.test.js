// Run: node odds-api/stats-r3.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the third independent review of stats-v1 (e214bcf, /tmp/revstats3-report.md) and the manager's CONFIRMED rule.
// Every group FAILS on e214bcf and passes after the fixes:   STATS_DIR=<a checkout of e214bcf>/odds-api node odds-api/stats-r3.test.js
// Each group runs on its own; a failure is recorded and the rest still run.
const assert = require('assert'), http = require('http'), path = require('path'), crypto = require('crypto');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'x';
const B = (process.env.STATS_DIR ? path.resolve(process.env.STATS_DIR) : __dirname) + '/';
const S = require(B + 'stats'), D = S._deps, R = require(B + 'ratings'), SY = require(B + 'sync');
if (typeof S._isolate === 'function') S._isolate();
let db = {}, slow = false;
const nap = () => (slow ? new Promise((ok) => setTimeout(ok, Math.random() * 6)) : null);
const FDB = {
  dbGet: async (id) => { await nap(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await nap(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await nap(); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const PEOPLE = ['ann', 'bob', 'cat', 'dir', 'dan', 'eve', 'fay', 'gus'];
const SID = {}; PEOPLE.forEach((n, i) => { SID[n] = (String.fromCharCode(97 + i) + (i + 1)).repeat(4) + String.fromCharCode(97 + i).repeat(56); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', K = (n) => pe(SID[n]);
let NAMES = {}, STAMP = {};
const who = (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; };
const ACCT = { who, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable', ownerOk: (req) => who(req) === 'owner', check: async (req) => !!who(req), since: async (e) => STAMP[e] || null };
D.S = FDB; D.acct = () => ACCT; D.groups = () => ({});
const Z = (s) => Date.parse(s), T0 = Z('2026-11-16T18:00:00Z'), DAY = 864e5; let NOW = T0; D.now = () => NOW; D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const day = (n) => S.chiDay(NOW - n * DAY);
const srv = http.createServer(async (req, res) => { if (await S.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, ipn = 0; const realFetch = global.fetch;
const call = async (w, p, b) => { const r = await realFetch('http://127.0.0.1:' + P + '/stats/' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '', 'x-ip': '9.9.' + (++ipn % 250) + '.' + (ipn >> 8) }, body: JSON.stringify(b || {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = {}; } return { s: r.status, j }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); return r.j; };
const no = (r, code, re, m) => { assert.strictEqual(r.s, code, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j).slice(0, 300)); if (re) assert.ok(re.test(r.j.error || ''), (m || '') + ': "' + r.j.error + '" should match ' + re); };
const fresh = () => { db = {}; NOW = T0; slow = false; S._reset(); NAMES = {}; STAMP = {}; PEOPLE.forEach((n) => { NAMES[SID[n].slice(0, 8)] = n[0].toUpperCase() + n.slice(1) + ' Real'; }); ['calcutta', 'golf', 'events'].forEach((s) => S.register(s, async () => [])); Object.values(SID).forEach((sid) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1, created_at: '2025-01-01T12:00:00Z' }; }); };
const ent = (n) => { db['lock:ent'] = db['lock:ent'] || { id: 'lock:ent', updated: 1, data: { acct: {} } }; db['lock:ent'].data.acct[crypto.createHash('sha256').update('oddable-acct|' + K(n)).digest('hex').slice(0, 24)] = { on: true }; };
const golfItem = (date, total, o) => Object.assign({ type: 'golf', date, course: 'Palm View', tees: 'Blue', holes: 18, par: 72, cr: 71.2, slope: 128, total }, o || {});
const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], SI = [5, 11, 17, 1, 13, 7, 15, 3, 9, 6, 12, 18, 2, 14, 8, 16, 4, 10];
const holesFor = (total) => { const st = PARS.slice(); let d = total - 72, i = 0; while (d > 0) { st[i % 18]++; d--; i++; } return st; };
const cardRound = (id, date, score, by, o) => ({ src: 'golf', id, date, sport: 'golf', kind: 'golf-round', title: 'Golf day', result: null, score, toPar: score - 72, verified: true, extra: Object.assign({ course: 'Palm View', rating: 71.2, slope: 128, par: 72, holes: 18, of: 18, format: 'stroke', solo: false, at: Z(date + 'T20:00:00Z'), holeScores: holesFor(score), pars: PARS, hcpIdx: SI, card: by ? { others: 3, by, byName: 'Card Marker' } : undefined }, o || {}) });
const V = (r) => { const v = S.validate(r, r.src); if (!v.ok) throw new Error(v.why + ' ' + JSON.stringify(r)); return v.rec; };
// "Recorded as having played": the logger adds the friend to their players list and the friend claims that row with their own account (once).
const pal = async (logger, friend) => { const g = ok(await call(logger, 'guest/create', { name: friend[0].toUpperCase() + friend.slice(1) }), 'add ' + friend).guest; ok(await call(friend, 'guest/claim', { code: g.code }), friend + ' claims'); return g.gid; };
const logRound = async (w, date, total, gids, o) => (NOW += 1000, 0) || ok(await call(w, 'self/save', { item: golfItem(date, total, Object.assign({ withGuests: gids }, o || {})) }), 'log round').record.id;
const confirm = async (logger, id, friend) => { const l = ok(await call(logger, 'confirm/link', { id }), 'link'); return call(friend, 'confirm/do', { code: l.code }); };
let pass = 0; const fails = [];
const check = async (name, fn) => { fresh(); try { await fn(); pass++; console.log('  ok  ' + name); } catch (er) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String((er && er.message) || er).split('\n').slice(0, 6).join('\n       ')); } };

srv.listen(0, async () => {
  P = srv.address().port; let r, j, h;

  await check('H1a. only an account RECORDED AS HAVING PLAYED can confirm by link; a stranger with the link, and a typed name, never can', async () => {
    const gBob = await pal('ann', 'bob');
    const id = await logRound('ann', day(1), 130, [gBob]), l = ok(await call('ann', 'confirm/link', { id }));
    j = ok(await call('cat', 'confirm/get', { code: l.code })); assert.strictEqual(j.canConfirm, false, 'Cat did not play: the sheet says she cannot confirm'); assert.ok(/recorded on this entry/.test(j.why));
    no(await call('cat', 'confirm/do', { code: l.code }), 403, /recorded on this entry/, 'a link holder who did not play');
    j = ok(await call('bob', 'confirm/get', { code: l.code })); assert.deepStrictEqual([j.canConfirm, j.as], [true, 'with']);
    ok(await call('bob', 'confirm/do', { code: l.code }), 'the recorded player confirms');
    const typedOnly = ok(await call('ann', 'self/save', { item: golfItem(day(1), 131) })).record.id; // nobody recorded as playing
    no(await call('ann', 'confirm/link', { id: typedOnly }), 400, /recorded as playing/, 'no link for a round with no recorded player');
    const g2 = ok(await call('ann', 'guest/create', { name: 'Never Claimed' })).guest, id3 = await logRound('ann', day(1), 132, [g2.gid]), l3 = ok(await call('ann', 'confirm/link', { id: id3 }));
    no(await call('cat', 'confirm/do', { code: l3.code }), 403, /recorded on this entry/, 'the player row was never claimed by Cat');
    j = ok(await call('ann', 'me')); const recs = j.records.filter((x) => x.kind === 'golf-round');
    assert.deepStrictEqual(recs.map((x) => !!x.extra.confirmed).sort(), [false, false, true]); assert.ok(!JSON.stringify(j).includes(S.acctRef(K('bob'))), 'the confirmer reference never reaches a phone');
  });

  await check('H1b. diversity: one friend cannot set a money-game handicap. Max 2 of 20 from one confirmer, typed totals max 5 of 20, 3 different confirmers needed; the make-up is returned', async () => {
    const g = {}; for (const f of ['bob', 'cat', 'dir', 'dan']) g[f] = await pal('ann', f);
    const add = async (friend, total, o) => { const id = await logRound('ann', day(1), total, [g[friend]], o); ok(await confirm('ann', id, friend), friend + ' confirms'); return id; };
    for (let i = 0; i < 3; i++) await add('bob', 130); // the review's attack: three typed 130s, one friend taps Confirm three times
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.use, h.needsSet, h.confirmedRounds], [null, true, 2], 'two count from one confirmer, the third does not; no number'); assert.ok(/3 confirmed rounds/.test(h.why), h.why);
    assert.ok(h.oddable.index != null, 'the full Oddable index (every round) is still there for casual play'); assert.strictEqual((await S.handicapFor(K('ann'), { casual: true })).use, h.oddable.index);
    j = ok(await call('ann', 'me')); assert.ok(j.records.some((x) => /already confirmed 2 of your last 20 by link/.test(x.extra.confirmWhy || '')), 'the third round says why it does not count');
    await add('cat', 130); await add('cat', 130);
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.use, h.needsSet, h.confirmedRounds, h.makeup.confirmers], [null, true, 4, 2]); assert.strictEqual(h.why, 'needs rounds confirmed by 3 different players');
    assert.ok(/needs rounds confirmed by 3 different players/.test(h.ask));
    await add('dir', 130);
    h = await S.handicapFor(K('ann')); assert.strictEqual(h.makeup.confirmers, 3); assert.strictEqual(h.confirmedRounds, 5); assert.ok(h.use != null && h.use === h.confirmedIndex && !h.needsSet, 'three different confirmers: the confirmed index is used');
    assert.deepStrictEqual([h.makeup.typed, h.makeup.scored, h.makeup.linked], [5, 0, 0]); assert.strictEqual(h.makeup.rounds.length, 5); assert.ok(h.makeup.rounds.every((x) => x.how === 'Typed total, confirmed by link' && x.byName && x.date));
    assert.deepStrictEqual(h.makeup.who.map((x) => x.n).sort(), [1, 2, 2]); assert.ok(/5 typed totals confirmed by link · confirmed by 3 players/.test(h.makeup.text), h.makeup.text); assert.ok(!JSON.stringify(h.makeup).includes('a:'), 'names and counts only');
    await add('dir', 60); await add('dan', 60); // a 6th and 7th typed total: only 5 typed totals count in any 20
    h = await S.handicapFor(K('ann')); assert.strictEqual(h.confirmedRounds, 5, 'typed totals stop at 5 of 20');
    await add('dan', 100, { total: undefined, strokes: holesFor(100), pars: PARS }); // hole by hole: not a typed total
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.makeup.linked, h.makeup.typed], [6, 1, 5]);
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.golfHcp.moneyIndex, j.golfHcp.makeup.confirmers], [h.use, 4], 'My handicap shows the same number and make-up');
  });

  await check('H1c. a game round is confirmed only with hole scores, another account with a scored card and a card confirmed by an account on another team', async () => {
    const A = K('ann'), refs = ['bob', 'cat', 'dir'].map((n) => S.acctRef(K(n)));
    const set = (list) => { S.register('golf', async (k) => (k === A ? list : [])); S._reset(); };
    set([0, 1, 2, 3].map((i) => cardRound('j' + i, day(10 + i), 90, null))); // four rounds in a game with people who only joined: no card on the record
    h = await S.handicapFor(A); assert.deepStrictEqual([h.use, h.needsSet, h.confirmedRounds], [null, true, 0], 'an account that only joined never confirms');
    set([0, 1, 2].map((i) => cardRound('t' + i, day(10 + i), 90, refs[i], { holeScores: undefined }))); h = await S.handicapFor(A); assert.strictEqual(h.confirmedRounds, 0, 'a game round with a typed total is not confirmed');
    set([0, 1, 2].map((i) => cardRound('o' + i, day(10 + i), 90, refs[i], { card: { others: 0, by: refs[i] } }))); h = await S.handicapFor(A); assert.strictEqual(h.confirmedRounds, 0, 'no OTHER account had a scored card');
    set([0, 1, 2].map((i) => cardRound('s' + i, day(10 + i), 90, S.acctRef(A)))); h = await S.handicapFor(A); assert.strictEqual(h.confirmedRounds, 0, 'a card confirmed by the player himself');
    set([0, 1, 2].map((i) => cardRound('c' + i, day(10 + i), 90, refs[i]))); h = await S.handicapFor(A);
    assert.deepStrictEqual([h.confirmedRounds, h.needsSet, h.makeup.scored, h.makeup.confirmers], [3, false, 3, 3]); assert.ok(h.use != null); assert.ok(h.makeup.rounds.every((x) => x.how === 'Scored in a game'));
    set([0, 1, 2, 3, 4].map((i) => cardRound('m' + i, day(10 + i), 90, refs[0]))); h = await S.handicapFor(A); assert.deepStrictEqual([h.confirmedRounds, h.use, h.why], [5, null, 'needs rounds confirmed by 3 different players'], 'the same card marker five times: all five count as confirmed (game rounds: up to 8 of 20 from one confirmer), but one confirmer is not three');
    set(Array.from({ length: 20 }, (_, i) => cardRound('w' + i, day(40 - i), 90, refs[i < 12 ? 0 : i < 17 ? 1 : 2]))); h = await S.handicapFor(A); // a regular game: Bob marks the first 12 cards, Cat the next 5, Dir the last 3
    assert.deepStrictEqual([h.confirmedRounds, h.makeup.who.map((w) => w.n)], [16, [8, 5, 3]], 'Bob: 8 of his 12 count; Cat 5; Dir 3');
    assert.ok(h.makeup.who.every((w) => w.n <= 8), 'no confirmer accounts for more than 8 of the last 20 game rounds: ' + JSON.stringify(h.makeup.who)); assert.ok(h.confirmedRounds > 6 && h.use != null, 'a regular foursome is no longer held to 6 counting rounds (' + h.confirmedRounds + ' count)');
    j = ok(await call('ann', 'me')); assert.ok(j.records.some((x) => /already confirmed 8 of your last 20 rounds scored in games/.test(x.extra.confirmWhy || '')), 'the 9th card from one marker says why it does not count'); assert.strictEqual(j.confirmRules.gamePerBy, 8);
    set([0, 1, 2].map((i) => cardRound('f' + i, day(10 + i), 90, refs[i], { confirmed: false }))); h = await S.handicapFor(A); assert.strictEqual(h.confirmedRounds, 0, 'the engine said not confirmed: believed');
  });

  await check('H1d / M6. confirm link: one live link per entry, a new one kills the old, 7 days, single use, only for entries logged within 7 days of play', async () => {
    const gBob = await pal('ann', 'bob'), gCat = await pal('ann', 'cat');
    const id = await logRound('ann', day(2), 95, [gBob, gCat]); slow = true;
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => call('ann', 'confirm/link', { id }))); slow = false; five.forEach((x) => ok(x));
    assert.strictEqual(new Set(five.map((x) => x.j.code)).size, 1, 'five requests at once: ONE live link');
    const l1 = five[0].j, l2 = ok(await call('ann', 'confirm/link', { id, fresh: true })); assert.notStrictEqual(l2.code, l1.code);
    no(await call('bob', 'confirm/do', { code: l1.code }), 409, /newer link/, 'the old link died when the new one was made'); no(await call('bob', 'confirm/get', { code: l1.code }), 409, /newer link/);
    NOW = T0 + 7 * DAY + 1000; no(await call('bob', 'confirm/get', { code: l2.code }), 410, /expired/, 'a link lasts 7 days'); no(await call('bob', 'confirm/do', { code: l2.code }), 410, /expired/);
    NOW = T0 + 6 * DAY; j = ok(await call('bob', 'confirm/get', { code: l2.code })); assert.strictEqual(j.canConfirm, true);
    slow = true; const both = await Promise.all([call('bob', 'confirm/do', { code: l2.code }), call('cat', 'confirm/do', { code: l2.code })]); slow = false;
    assert.deepStrictEqual(both.map((x) => x.s).sort(), [200, 409], 'two players tap at once: one confirmation'); S._reset();
    j = ok(await call('ann', 'confirm/link', { id })); assert.strictEqual(j.confirmed, true); assert.ok(!j.code, 'no new link for a confirmed entry');
    NOW = T0; const late = await logRound('ann', day(9), 95, [gBob]); no(await call('ann', 'confirm/link', { id: late }), 400, /more than 7 days after/, 'logged 9 days after it was played');
    j = ok(await call('ann', 'me')); const lr = j.records.find((x) => x.id === late); assert.deepStrictEqual([lr.extra.canLink, /7 days/.test(lr.extra.linkWhy)], [false, true]);
  });

  await check('M3 / M6. a confirmed match: the confirmer\'s side comes from the entry, and their copy disappears when the logger deletes or edits the entry', async () => {
    const gBob = await pal('ann', 'bob'), gCat = await pal('ann', 'cat');
    const dbl = { type: 'pickleball', date: day(0), fmt: 'doubles', partner: 'x', partnerGuest: gCat, opp: ['x', 'Zed'], oppGuest: [gBob, null], games: [[11, 5], [11, 7]] };
    const id = ok(await call('ann', 'self/save', { item: dbl })).record.id, l = ok(await call('ann', 'confirm/link', { id }));
    r = ok(await call('bob', 'confirm/do', { code: l.code, as: 'partner' })); assert.strictEqual(r.as, 'opp', 'Bob is an OPPONENT on the entry: asking to be the partner changes nothing');
    j = ok(await call('bob', 'me')); const mine = j.records.find((x) => x.kind === 'match'); assert.strictEqual(mine.result, 'L', 'Bob lost; he cannot turn it into a win'); assert.strictEqual(mine.extra.confirmed, true);
    ok(await call('ann', 'self/delete', { id })); j = ok(await call('bob', 'me')); assert.strictEqual(j.records.filter((x) => x.kind === 'match').length, 0, 'the logger deleted the entry: the confirmer\'s copy is gone');
    const id2 = ok(await call('ann', 'self/save', { item: dbl })).record.id; ok(await call('cat', 'confirm/do', { code: ok(await call('ann', 'confirm/link', { id: id2 })).code }));
    j = ok(await call('cat', 'me')); assert.strictEqual(j.records.find((x) => x.kind === 'match').result, 'W', 'the partner gets the win');
    ok(await call('ann', 'self/save', { id: id2, item: Object.assign({}, dbl, { games: [[5, 11], [7, 11]] }) })); j = ok(await call('cat', 'me')); assert.strictEqual(j.records.filter((x) => x.kind === 'match').length, 0, 'an edit drops the confirmation and the copy');
  });

  await check('H3. a forfeit or an engine-marked unconfirmed match never moves seeding (extra.confirmed === false is honoured)', async () => {
    const A = K('ann'), m = (i, o) => ({ src: 'events', id: 'ev:m' + i, date: day(20 - i), sport: 'pickleball', kind: 'match', title: 'Ladder vs P' + i, result: 'W', opponent: 'P' + i, verified: false, extra: Object.assign({ fmt: 'singles', at: NOW - (20 - i) * DAY, opp: [{ id: 'g' + i, name: 'P' + i, account: true }], oppKey: 'e:' + String(i).padStart(14, '0') }, o) });
    S.register('events', async (k) => (k === A ? [0, 1, 2, 3, 4].map((i) => m(i, { confirmed: false, forfeit: true, unrated: 'Forfeit: not rated', scoreText: 'forfeit' })) : [])); S._reset();
    r = await S.ratingFor(A, 'pickleball'); assert.deepStrictEqual([r.confirmedGames, r.confirmedRating, r.use], [0, null, null], 'five forfeits: nothing confirmed, nothing to seed on'); assert.strictEqual(r.seed, 1500);
    assert.ok(r.oddable.rating > 1500, 'they still show in the full rating');
    S.register('events', async (k) => (k === A ? [0, 1, 2].map((i) => m(i, { confirmed: true, confirmedBy: { name: 'P' + i, at: 1 } })).concat([3, 4].map((i) => m(i, { confirmed: false }))) : [])); S._reset();
    r = await S.ratingFor(A, 'pickleball'); assert.strictEqual(r.confirmedGames, 3); assert.ok(r.use > 1500 && r.use === r.confirmedRating, 'three matches confirmed by three different opponents seed');
    assert.strictEqual(r.makeup.confirmers, 3);
    S.register('events', async (k) => (k === A ? [0, 1, 2, 3, 4, 5].map((i) => m(i, { confirmed: true, confirmedBy: { name: 'P', at: 1 }, oppKey: 'e:' + String(i < 4 ? 0 : i).padStart(14, '0') })) : [])); S._reset();
    r = await S.ratingFor(A, 'pickleball'); assert.deepStrictEqual([r.confirmedGames, r.makeup.confirmers], [6, 3], 'event matches the engine confirmed are not limited per confirmer (four against the same opponent all count; the repeat-opponent weights are the guard)');
  });

  await check('M1. repeat-opponent weights use the server ENTRY time, not the typed date; at most 2 rated matches per pair per rolling 24 hours', async () => {
    const mk = (i, date, at) => ({ id: 'm' + i, date, at, result: 'W', extra: { oppKey: 'a:bob', oppRating: 1500 } });
    const spread = R.eloFor([0, 1, 2, 3].map((i) => mk(i, day(40 - i * 8), T0 + i * 60e3))); // typed 8 days apart, all ENTERED within 4 minutes
    assert.deepStrictEqual(spread.history.map((x) => x.w), [1, 0.5, 0, 0], 'entered in one sitting: 1, 1/2, then not rated'); assert.strictEqual(spread.rated, 2);
    const honest = R.eloFor([0, 1, 2].map((i) => mk(i, day(30 - i * 8), T0 - (30 - i * 8) * DAY))); assert.deepStrictEqual(honest.history.map((x) => x.w), [1, 1, 1], 'really entered 8 days apart: full weight');
    const roll = R.eloFor([mk(0, day(1), T0 - 30 * 3600e3), mk(1, day(1), T0 - 20 * 3600e3), mk(2, day(0), T0 - 10 * 3600e3), mk(3, day(0), T0)]); // 20 h after #1 it is 2 in 24 h; #3 enters 30 h after #0
    assert.deepStrictEqual(roll.history.map((x) => x.w > 0), [true, true, false, true], 'a rolling 24 hours, not the calendar day');
    const gBob = await pal('ann', 'bob'); // through the routes: Ann logs 6 losses to Bob in one sitting, dated on different days, Bob confirms each
    for (let i = 0; i < 6; i++) { const id = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: day(i), fmt: 'singles', opp: ['x'], oppGuest: [gBob], games: [[2, 11]] } })).record.id; ok(await confirm('ann', id, 'bob')); }
    S._reset(); r = await S.ratingFor(K('bob'), 'pickleball', { casual: true }); assert.ok(r.oddable.rating <= 1524, 'six wins farmed in one sitting are worth 1.5 wins at most, got ' + r.oddable.rating);
  });

  await check('M2. an account\'s start comes from server stamps only; a new account may log 30 days back, marked and never confirmed', async () => {
    const E = SID.eve; delete db[E].created_at; STAMP[K('eve')] = T0 - 3 * DAY;
    db[E].data = { bets: [{ id: 'b1400000000001', day: '2014-05-13', side: 'KC', stake: 10, t: 1400000000001 }], log: { '2016-01-01': { n: 1, w: 1 } }, created: 1300000000000 };
    j = ok(await call('eve', 'me')); assert.strictEqual(j.since, day(3), 'a bet id / log day / data field written by the phone never moves the start'); assert.strictEqual(j.logFrom, day(33));
    no(await call('eve', 'self/save', { item: golfItem('2015-06-01', 88) }), 400, /30 days before you joined/, 'a 2015 round'); no(await call('eve', 'self/save', { item: golfItem(day(34), 88) }), 400, /30 days before/);
    const g = await pal('eve', 'bob'), old = ok(await call('eve', 'self/save', { item: golfItem(day(5), 88, { withGuests: [g] }) }), '5 days ago = 2 days before joining').record;
    assert.strictEqual(old.extra.preAcct, true); no(await call('eve', 'confirm/link', { id: old.id }), 400, /before you joined/, 'a pre-account round can never be confirmed');
    j = ok(await call('eve', 'me')); assert.strictEqual(j.records.find((x) => x.id === old.id).extra.confirmed, false);
    delete db[SID.gus].created_at; ok(await call('gus', 'self/save', { item: golfItem(day(1), 90) }), 'a brand-new account with no stamp at all can log yesterday');
    // acct.js writes the stamp once, on the server, and never moves it
    const A = require(B + 'acct'), keep = [SY.dbGet, SY.dbPut, SY.dbPatchIf]; SY.dbGet = FDB.dbGet; SY.dbPut = FDB.dbPut; SY.dbPatchIf = FDB.dbPatchIf;
    try { assert.strictEqual(await A.since('new@x.com'), null); const t1 = await A.sinceSet('new@x.com'); assert.ok(Math.abs(t1 - Date.now()) < 5000, 'stamped with the server clock'); assert.strictEqual(await A.sinceSet('new@x.com', 5), t1, 'set once'); assert.strictEqual(await A.since('new@x.com'), t1);
      assert.ok(!JSON.stringify(db['lock:acctsince']).includes('new@x.com'), 'the row holds a hash, not the account'); } finally { [SY.dbGet, SY.dbPut, SY.dbPatchIf] = keep; }
  });

  await check('M4. /stats/event/log filters by account key: two players with the same name never see each other\'s lines', async () => {
    ent('dir'); NAMES[SID.bob.slice(0, 8)] = 'Sam Smith'; NAMES[SID.cat.slice(0, 8)] = 'Sam Smith';
    await S.eventSetup(K('dir'), 'T1', { title: 'Open', sport: 'golf', lockAt: NOW + DAY });
    await S.eventOverride(K('dir'), 'T1', K('bob'), { hcp: 9.1, reason: 'bob reason' }); await S.eventOverride(K('dir'), 'T1', K('cat'), { hcp: 22.2, reason: 'cat reason' });
    j = ok(await call('bob', 'event/log', { eventId: 'T1' })); assert.deepStrictEqual(j.log.map((l) => l.reason), ['bob reason']); assert.ok(!JSON.stringify(j).includes('22.2'));
    j = ok(await call('cat', 'me')); assert.deepStrictEqual(j.tournaments[0].log.map((l) => l.reason), ['cat reason'], 'the My handicap card too');
    j = ok(await call('dir', 'event/log', { eventId: 'T1' })); assert.strictEqual(j.log.filter((l) => l.field === 'hcp').length, 2); assert.ok(!/"pk"/.test(JSON.stringify(j)), 'the key itself is never sent');
  });

  await check('M5. a typed total is capped: par + 5 a hole with no index, net double bogey (par + 2 a hole + Course Handicap) once an index exists', async () => {
    const a = R.handicap([1, 2, 3].map((i) => ({ id: 't' + i, date: '2026-02-0' + i, total: 200, cr: 71.2, slope: 128, par: 72 })));
    assert.deepStrictEqual(a.diffs.map((d) => [d.ags, d.diff]), [[162, 80.2], [162, 80.2], [162, 80.2]], 'three typed 200s count as 162 (par + 90), not 200');
    const base = [0, 1, 2, 3, 4].map((i) => ({ id: 'b' + i, date: '2026-01-0' + (i + 1), total: 82, cr: 72, slope: 113, par: 72 })), withIdx = R.handicap(base.concat([{ id: 'big', date: '2026-03-01', total: 200, cr: 72, slope: 113, par: 72 }]));
    const d = withIdx.diffs.find((x) => x.id === 'big'); assert.strictEqual(d.idxBefore, 10); assert.deepStrictEqual([d.ch, d.ags, d.capHow], [10, 118, 'ndb-total'], 'index 10.0: 72 + 36 + 10 = 118');
    const noSi = R.handicap(base.concat([{ id: 'h', date: '2026-03-01', total: 216, cr: 72, slope: 113, par: 72, strokes: Array(18).fill(12), pars: Array(18).fill(4) }])).diffs.find((x) => x.id === 'h');
    assert.strictEqual(noSi.ags, 118, 'hole scores without stroke indexes and an index of 10.0: held to 118, not 162');
    assert.strictEqual(R.handicap([{ id: 'n', date: '2026-01-01', total: 150, holes: 9, cr: 34, slope: 113, par: 36 }, { id: 'n2', date: '2026-01-02', total: 80, cr: 72, slope: 113, par: 72 }, { id: 'n3', date: '2026-01-03', total: 80, cr: 72, slope: 113, par: 72 }, { id: 'n4', date: '2026-01-04', total: 80, cr: 72, slope: 113, par: 72 }]).diffs.find((x) => x.id === 'n').ags, 81, 'a typed nine: 36 + 45');
    ok(await call('ann', 'self/save', { item: golfItem(day(0), 200) })); j = ok(await call('ann', 'me')); assert.strictEqual(j.golfHcp.diffs[0].ags, 162, 'through the app too');
  });

  await check('M7. strokesOnHole(null) and courseHandicap(null) THROW: no handicap is never 0 strokes', async () => {
    assert.throws(() => R.strokesOnHole(null, 1), /no handicap/); assert.throws(() => R.strokesOnHole(undefined, 1), /no handicap/); assert.throws(() => R.strokesOnHole(NaN, 1), /no handicap/); assert.throws(() => R.strokesOnHole('12', 1), /no handicap/);
    assert.throws(() => R.strokesOnHole(12, null), /stroke index/); assert.throws(() => R.courseHandicap(null, 128, 71.2, 72), /no handicap/);
    assert.strictEqual(R.strokesOnHole(0, 1), 0, 'a real scratch handicap still gets 0'); assert.strictEqual(R.strokesOnHole(20, 2), 2); assert.strictEqual(R.strokesOnHole(-2, 18), -1);
    h = await S.courseHandicapFor(K('ann'), { cr: 71.2, slope: 128, par: 72 }); assert.deepStrictEqual([h.use, h.courseHandicap, h.needsSet], [null, null, true], 'no number: null and needsSet, and the engine must stop there');
    assert.throws(() => R.strokesOnHole(h.courseHandicap, 5), /no handicap/, 'passing that null straight on blows up instead of playing off 0');
  });

  await check('L1. nine-hole rounds before an index use the expected-score method, not the nine doubled', async () => {
    const a = R.handicap([0, 1, 2, 3, 4, 5].map((i) => ({ id: 'n' + i, date: '2026-01-0' + (i + 1), total: 45, holes: 9, cr: 34, slope: 113, par: 36 })));
    assert.deepStrictEqual(a.diffs.map((d) => d.diff), [23.1, 23.1, 23.1, 23.1, 23.1, 23.1], '11.0 + expected 12.1 (0.52 x 21.0 + 1.2), not 22.0'); assert.strictEqual(a.index, 22.1); assert.ok(a.diffs.every((d) => d.prov === 21 && !d.doubled));
  });

  await check('L2 / L3. the original entry is never dropped from the edit history; 50 edits at once end at revision 50; deletes are listed', async () => {
    const id = ok(await call('ann', 'self/save', { item: golfItem(day(0), 71) })).record.id;
    for (let i = 1; i <= 24; i++) { S._reset(); ok(await call('ann', 'self/save', { id, item: golfItem(day(0), 71 + i) }), 'edit ' + i); }
    const hist = db[S.selfKey(K('ann'))].data.edits[id]; assert.strictEqual(hist[0].was.score, 71, 'the original score is still the first line after 24 edits'); assert.strictEqual(hist.length, 20);
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.edits[id][0].was.score, j.edits[id].length, j.edits[id][9].was.score], [71, 10, 94], 'the player sees the original and the latest nine');
    S._reset(); slow = true; const burst = await Promise.all(Array.from({ length: 50 }, (_, i) => S._deps && call('ann', 'self/save', { id, item: golfItem(day(0), 100 + i) }))); slow = false;
    const okN = burst.filter((x) => x.s === 200).length; assert.strictEqual(db[S.selfKey(K('ann'))].data.items[0].extra.rev, 24 + okN, okN + ' edits in a burst: the revision counts every one');
    S._reset(); ok(await call('ann', 'self/delete', { id })); j = ok(await call('ann', 'me')); assert.strictEqual(j.gone.length, 1); assert.ok(j.gone[0].was.score >= 100 && j.gone[0].at === NOW, 'the deleted entry is shown with what it was');
  });

  await check('L4. tournaments: the phone route cannot create one (no taking an unused id); the start must be within a year and can slip 14 days at most', async () => {
    ent('dir'); ent('dan');
    no(await call('dan', 'event/setup', { eventId: 'FREE1', title: 'Mine now', lockAt: NOW + DAY }), 404, null, 'an Enterprise account cannot register an unused id over the route');
    await assert.rejects(S.eventSetup(K('dir'), 'T9', { title: 'Far', lockAt: Z('3237-01-01T00:00:00Z') }), /within a year/);
    await S.eventSetup(K('dir'), 'T9', { title: 'Open', lockAt: NOW + 5 * DAY });
    ok(await call('dir', 'event/setup', { eventId: 'T9', lockAt: NOW + 6 * DAY, reason: 'rain' }), 'the director moves it a day over the route'); no(await call('dan', 'event/setup', { eventId: 'T9', lockAt: NOW + 7 * DAY }), 403, /Not your tournament/);
    await assert.rejects(S.eventSetup(K('dir'), 'T9', { lockAt: NOW + 20 * DAY }), /14 days past the first start/);
    for (let i = 0; i < 4; i++) await S.eventSetup(K('dir'), 'T9', { lockAt: NOW + 6 * DAY + (i + 1) * 3600e3 });
    await assert.rejects(S.eventSetup(K('dir'), 'T9', { lockAt: NOW + 7 * DAY }), /moved 5 times/);
  });

  await check('L5. course sharing: a phone can only switch its own existing share; it cannot join a course\'s list or name an event', async () => {
    ent('dir'); db['lock:entcourses'] = { id: 'lock:entcourses', updated: 1, data: { own: { [crypto.createHash('sha256').update('oddable-acct|' + K('dir')).digest('hex').slice(0, 24)]: [{ id: 'cedar', name: 'Cedar Ridge' }] } } };
    no(await call('bob', 'consent/set', { courseId: 'cedar', on: true, via: { kind: 'event', id: 'X1', title: 'FREE BEER EVENT' } }), 403, /leagues or events first/, 'a stranger adds himself');
    j = ok(await call('dir', 'course/players', { courseId: 'cedar' })); assert.deepStrictEqual([j.players.length, j.events.length], [0, 0]);
    await S.consentOnJoin(K('bob'), 'cedar', { kind: 'league', id: 'L1', title: 'Tuesday League' }, true); // the engine saw him join
    ok(await call('bob', 'consent/set', { courseId: 'cedar', on: false, via: { kind: 'event', id: 'X1', title: 'FREE BEER EVENT' } }), 'he switches it off'); ok(await call('bob', 'consent/set', { courseId: 'cedar', on: true, via: { id: 'X2', title: 'SPAM' } }), 'and on again');
    j = ok(await call('dir', 'course/players', { courseId: 'cedar' })); assert.deepStrictEqual([j.players.length, j.events.map((v) => v.title)], [1, ['Tuesday League']], 'only the engine\'s event shows in the director\'s filter');
  });

  await check('L6. money rows add up on their own: deleted-bets day, Nassau without extra.bets, a tie with a stake, a live record that already says W', async () => {
    const recs = S.betRecords({ bets: [], log: { '2026-11-01': { n: 3, w: 0, l: 3, p: 0, risk: 0, settled: -206.12 } } }), a = V(recs[0]);
    assert.deepStrictEqual([a.money.entry, a.money.net, a.money.payout], [206.12, -206.12, 0], 'never "entry $0, net -$206.12"');
    const nas = V({ src: 'golf', id: 'n1', date: day(1), sport: 'golf', kind: 'match', title: 'Nassau', result: 'L', stake: 20, pl: -40, verified: true, extra: {} });
    assert.deepStrictEqual([nas.money.entry, nas.money.net, nas.money.payout, nas.money.entryWas], [40, -40, 0, 20], 'lost $40: the entry shown is $40');
    const tie = V({ src: 'self', id: 't1', date: day(1), sport: 'other', kind: 'match', title: 'Darts', result: 'T', stake: 10, verified: false }); assert.deepStrictEqual([tie.money.state, tie.money.net, tie.money.payout], ['settled', 0, 10], 'a tie hands the stake back');
    const live = V({ src: 'events', id: 'l1', date: day(0), sport: 'pickleball', kind: 'match', title: 'Live', result: 'W', stake: 10, pl: 10, verified: true, extra: { live: true } });
    const t = S.tot([live, nas, tie, a]); assert.deepStrictEqual([S.playState(live), t.w, t.open, t.atStake], ['open', 0, 1, 10], 'still running: open in the record AND in the money');
    assert.strictEqual(t.pl, -246.12); assert.strictEqual(t.staked, 256.12); assert.strictEqual(t.unknown, 0);
  });

  await check('L7. more than 3,000 records: totals cover everything, lists page 100 at a time with the full count', async () => {
    const big = Array.from({ length: 3200 }, (_, i) => ({ src: 'calcutta', id: 'c' + i, date: new Date(Date.UTC(2018, 0, 1 + i)).toISOString().slice(0, 10), sport: i % 2 ? 'nfl' : 'nba', kind: 'calcutta', title: 'Buy ' + i, result: null, spent: 10, won: 12, verified: true, extra: { over: true } }));
    S.register('calcutta', async (k) => (k === K('ann') ? big : [])); S._reset();
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.total, j.records.length, j.more, j.page], [3200, 3000, 200, 100]); assert.strictEqual(j.periods.all.tot.n, 3200); assert.strictEqual(j.periods.all.tot.pl, 6400);
    r = ok(await call('ann', 'list', { offset: 0 })); assert.deepStrictEqual([r.total, r.rows.length, r.rows[0].id], [3200, 100, 'c3199']);
    r = ok(await call('ann', 'list', { offset: 3100, limit: 100 })); assert.deepStrictEqual([r.rows.length, r.rows[99].id], [100, 'c0'], 'the oldest rows are reachable');
    r = ok(await call('ann', 'list', { sport: 'nfl', kind: 'calcutta', f: 'money', offset: 1500 })); assert.deepStrictEqual([r.total, r.rows.length], [1600, 100]); assert.strictEqual(j.periods.all.bySport.nfl.tot.n, 1600, 'the list count equals the total it drills from');
    no(await call('bob', 'list', { offset: 0 }), 200); assert.strictEqual((await call('bob', 'list', {})).j.total, 0, 'only your own');
  });

  await check('10 / L10. one rating per named sport: cornhole and darts are separate; ratingFor(golf) refuses instead of answering for pickleball', async () => {
    const g = {}; for (const f of ['bob', 'cat', 'dir']) g[f] = await pal('ann', f);
    const game = async (title, res, friend) => { const id = ok(await call('ann', 'self/save', { item: { type: 'other', date: day(0), sport: 'other', title, result: res, oppGuest: g[friend], score: '21-15' } })).record.id; ok(await confirm('ann', id, friend), title + ' confirmed by ' + friend); };
    for (const f of ['bob', 'cat', 'dir']) await game('Cornhole', 'W', f); for (const f of ['bob', 'cat', 'dir']) await game('Darts', 'L', f);
    j = ok(await call('ann', 'me')); assert.deepStrictEqual(Object.keys(j.ratings).sort(), ['other:cornhole', 'other:darts']); assert.ok(j.ratings['other:cornhole'].rating > 1500 && j.ratings['other:darts'].rating < 1500); assert.strictEqual(j.ratings['other:darts'].name, 'Darts');
    const c = await S.ratingFor(K('ann'), 'cornhole'), d = await S.ratingFor(K('ann'), 'other:darts'); assert.deepStrictEqual([c.sport, d.sport], ['other:cornhole', 'other:darts']); assert.ok(c.use > 1500 && d.use < 1500, 'three confirmers each: both seed, separately');
    j = ok(await call('bob', 'me')); assert.ok(j.ratings['other:cornhole'].rating < 1500 && j.ratings['other:darts'].rating > 1500, 'the confirmer\'s side is rated under the same game');
    await assert.rejects(S.ratingFor(K('ann'), 'golf'), /handicapFor/); assert.strictEqual((await S.ratingFor(K('ann'))).sport, 'pickleball');
  });

  await check('L11. pairingProfile never hands over a printable number with sharing off', async () => {
    const A = K('ann'), refs = ['bob', 'cat', 'dir'].map((n) => S.acctRef(K(n))); S.register('golf', async (k) => (k === A ? [0, 1, 2].map((i) => cardRound('c' + i, day(10 + i), 90, refs[i])) : [])); S._reset();
    let p = await S.pairingProfile(A, 'golf'); assert.deepStrictEqual([p.show, p.print, 'use' in p, 'text' in p, 'oddable' in p], [false, false, false, false, false]); assert.ok(p.pairOn != null, 'the pairing maths still gets its number');
    ok(await call('ann', 'share', { on: true })); p = await S.pairingProfile(A, 'golf'); assert.deepStrictEqual([p.show, p.print, p.use], [true, true, p.pairOn]);
  });

  await check('L12. a stage-1 group contest carries its entry and, once it ends, its prize', async () => {
    const mkA = S.mkOf(K('ann')), g = { id: 'G1', name: 'Sunday Crew', sport: 'nfl', start: NOW - 30 * DAY, startDay: day(30), endDay: day(2), rules: { entry: 25, split: '100', take: { kind: 'none', v: 0 }, metric: 'units', verified: false }, members: [{ mk: mkA, pid: 'p1', name: 'Ann', paid: true }, { mk: 'x', pid: 'p2', name: 'Bo', paid: true }], comm: mkA };
    db['lock:groups'] = { id: 'lock:groups', updated: 1, data: { groups: { G1: g } } };
    D.groups = () => ({ standings: async () => ({ rows: [{ pid: 'p1', place: 1, name: 'Ann', t: { stake: 100, win: 20, units: 1, w: 3, l: 2, p: 0, open: 0, val: 1 } }, { pid: 'p2', place: 2, name: 'Bo', t: { stake: 100, win: -20, units: -1, w: 2, l: 3, p: 0, open: 0, val: -1 } }] }), pot: () => ({ places: [{ place: 1, pct: 100, amt: 50 }] }) });
    try { j = ok(await call('ann', 'me')); const c = j.records.find((x) => x.kind === 'contest'); assert.deepStrictEqual([c.money.entry, c.money.payout, c.money.net, c.money.state], [25, 50, 25, 'settled']); assert.deepStrictEqual(c.inner, { stake: 100, pl: 20, units: 1 }); } finally { D.groups = () => ({}); }
  });

  await check('13. owner dashboard and My stats agree: a won bet with no price is "not known" in sync.js owner totals too, and left out of the net', async () => {
    const bets = [{ id: 'b1', day: day(3), side: 'KC', stake: 100, fin: 'won' }, // no price, no stored P/L
      { id: 'b2', day: day(3), side: 'SF', stake: 50, odds: 150, fin: 'won' }, { id: 'b3', day: day(2), side: 'NYG', stake: 40, fin: 'lost' }, { id: 'b4', day: day(2), side: 'DAL', stake: 20, odds: -110, fin: 'won', finPL: 18.18 }, { id: 'b' + (NOW - DAY), side: 'BUF', stake: 30, fin: 'won' }];
    global.fetch = async () => ({ ok: true, json: async () => [{ id: SID.ann, updated: 5, data: { bets } }] });
    let u; try { u = (await SY.adminUsers(null))[0]; } finally { global.fetch = realFetch; }
    const t = S.tot(S.betRecords({ bets }).map(V));
    assert.deepStrictEqual([u.w, u.l, u.unk, u.pl], [4, 1, 2, 53.18], 'two won bets have no price: counted as wins, their money not known, +75 +18.18 -40'); assert.deepStrictEqual([t.w, t.l, t.unknown, t.pl], [u.w, u.l, u.unk, u.pl], 'My stats says exactly the same');
    assert.deepStrictEqual(u.list.find((b) => b.what.startsWith('KC')).pl, null); assert.strictEqual(u.list.find((b) => b.what.startsWith('KC')).unk, true); assert.strictEqual(u.days.find((d) => d.day === day(3)).unk, 1);
    assert.deepStrictEqual(SY.settledPL({ stake: 100, fin: 'won' }), { pl: 0, known: false }); assert.deepStrictEqual(SY.settledPL({ stake: 100, fin: 'won', odds: -110 }), { pl: 90.91, known: true }, 'a price the bet really carries is still used');
  });

  await check('port. course search: pages with "next", a clear failure message and the labelled sample list when the live list is down', async () => {
    const CS = require(B + 'stats-courses'); CS._reset(); CS._deps.golf = () => null; const urls = [];
    CS._deps.fetch = async (u) => { urls.push(u); const off = Number((/offset=(\d+)/.exec(u) || [])[1] || 0); return { ok: true, status: 200, json: async () => ({ total: 40, courses: Array.from({ length: Math.min(25, 40 - off) }, (_, i) => ({ id: 'c' + (off + i), course_name: 'Cedar ' + (off + i), city: 'Austin', state: 'TX' })) }) }; };
    j = ok(await call('ann', 'courses', { q: 'cedar' })); assert.deepStrictEqual([j.api.ok, j.api.results.length, j.api.next, j.api.total], [true, 25, 25, 40]);
    j = ok(await call('ann', 'courses', { q: 'cedar', offset: 25 })); assert.deepStrictEqual([j.api.results.length, j.api.next, j.api.results[0].extId], [15, null, 'c25']); assert.ok(urls.some((u) => /offset=25/.test(u)));
    CS._reset(); CS._deps.fetch = async () => { throw new Error('offline'); };
    j = ok(await call('ann', 'courses', { q: 'mcallen' }), 'the live list is down: still an answer'); assert.deepStrictEqual([j.api.ok, j.api.error], [false, "Couldn't reach the course list. Try again."]); assert.ok(j.api.results.length > 0 && j.api.results.every((c) => c.sample) && /Sample courses saved in the app/.test(j.api.fallback));
    j = ok(await call('ann', 'coursedetail', { extId: j.api.results[0].extId })); assert.ok(j.course.tees[0].rating > 60 && j.course.tees[0].slope > 100 && j.course.tees[0].yards > 5000, 'tees with rating, slope and yards');
    CS._reset(); delete CS._deps.golf; CS._deps.golf = () => null;
  });

  console.log('\n' + pass + ' passed, ' + fails.length + ' failed' + (fails.length ? ':\n  - ' + fails.join('\n  - ') : ''));
  srv.close(); process.exit(fails.length ? 1 : 0);
});
