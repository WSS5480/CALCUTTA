// Run: node odds-api/stats-fixes.test.js     (no network, no database: Supabase and sign-in are in-memory fakes)
// One group of checks per fix from the independent review of stats-v1 (c084625) and the complete review of the preview (Nov 16 2026).
// Every group FAILS on c084625 and passes after the fixes:   STATS_DIR=<a checkout of c084625>/odds-api node odds-api/stats-fixes.test.js
// Each group runs on its own; a failure is recorded and the rest still run.
// REVIEW 3 (Nov 16 2026): the groups below that touch confirmation, account dates, consent, tournament set-up and pairing were moved to the manager's
// CONFIRMED rule and the review-3 contracts (see stats-r3.test.js for the new rules themselves). On c084625 they still fail, as before.
const assert = require('assert'), http = require('http'), path = require('path'), crypto = require('crypto');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'x';
const B = (process.env.STATS_DIR ? path.resolve(process.env.STATS_DIR) : __dirname) + '/';
const S = require(B + 'stats'), D = S._deps, R = require(B + 'ratings');
if (typeof S._isolate === 'function') S._isolate();
// Review 4 (Nov 17 2026): a confirmer must be an account at least 30 days old with 3 games of its own, and a number on fewer than 8 counting rounds is
// provisional. Those guards have their own suite (stats-r4.test.js). HERE every confirmer is treated as an established account, so these groups keep
// testing what they were written for.
S._deps.confirmer = async (ref) => ({ key: ref, name: '', since: Date.parse('2025-01-01T12:00:00Z'), acts: 99 });
S.CONF.fullRounds = S.CONF.minRounds; // ... and a number on 3 confirmed rounds is used as before (the provisional step, 3 to 7 rounds, is tested in stats-r4.test.js)
let db = {}, slow = false;
const nap = () => (slow ? new Promise((ok) => setTimeout(ok, Math.random() * 6)) : null);
const FDB = {
  dbGet: async (id) => { await nap(); return db[id] ? JSON.parse(JSON.stringify(db[id])) : null; },
  dbPut: async (row, ign) => { await nap(); if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { await nap(); if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const SID = {}; ['ann', 'bob', 'cat', 'dir', 'dir2', 'eve'].forEach((n, i) => { SID[n] = (String.fromCharCode(97 + i) + (i + 1)).repeat(4) + String.fromCharCode(97 + i).repeat(56); });
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable', K = (n) => pe(SID[n]);
const NAMES = {}; Object.keys(SID).forEach((n) => { NAMES[SID[n].slice(0, 8)] = n[0].toUpperCase() + n.slice(1) + ' Real'; });
const who = (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; };
let STAMP = {}; const ACCT = { who, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable', ownerOk: (req) => who(req) === 'owner', check: async (req) => !!who(req), since: async (e) => STAMP[e] || null, sinceSet: async (e, at) => STAMP[e] || (STAMP[e] = at) }; // review 5: the sign-up stamp (acct.js)
D.S = FDB; D.acct = () => ACCT; D.groups = () => ({});
const Z = (s) => Date.parse(s), T0 = Z('2026-11-16T18:00:00Z'); let NOW = T0; D.now = () => NOW; D.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const srv = http.createServer(async (req, res) => { if (await S.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, ipn = 0;
const call = async (w, p, b) => { const r = await fetch('http://127.0.0.1:' + P + '/stats/' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '', 'x-ip': '9.9.' + (++ipn % 250) + '.' + (ipn >> 8) }, body: JSON.stringify(b || {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = {}; } return { s: r.status, j }; };
const ok = (r, m) => { assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); return r.j; };
const no = (r, code, re, m) => { assert.strictEqual(r.s, code, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j)); if (re) assert.ok(re.test(r.j.error || ''), (m || '') + ': "' + r.j.error + '" should match ' + re); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, m + ': ' + a + ' vs ' + b);
const fresh = () => { db = {}; STAMP = {}; NOW = T0; slow = false; S._reset(); ['bets', 'groups', 'self'].forEach(() => {}); ['calcutta', 'golf', 'events'].forEach((s) => S.register(s, async () => [])); Object.values(SID).forEach((sid) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data: { bets: [] }, updated: 1, created_at: '2025-01-01T12:00:00Z' }; }); };
const ent = (n) => { db['lock:ent'] = db['lock:ent'] || { id: 'lock:ent', updated: 1, data: { acct: {} } }; db['lock:ent'].data.acct = db['lock:ent'].data.acct || {}; db['lock:ent'].data.acct[crypto.createHash('sha256').update('oddable-acct|' + K(n)).digest('hex').slice(0, 24)] = { on: true }; };
const entOff = (n) => { db['lock:ent'].data.acct[crypto.createHash('sha256').update('oddable-acct|' + K(n)).digest('hex').slice(0, 24)] = { on: false }; };
const golfItem = (date, total, o) => Object.assign({ type: 'golf', date, course: 'Palm View', tees: 'Blue', holes: 18, par: 72, cr: 71.2, slope: 128, total }, o || {});
const mk = (i, total, o) => Object.assign({ id: 'r' + String(i).padStart(3, '0'), date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), total, cr: 72, slope: 113, par: 72 }, o || {});
const engineRound = (id, date, score, o) => ({ src: 'golf', id, date, sport: 'golf', kind: 'golf-round', title: 'Golf day', result: null, score, toPar: score - 72, verified: true, extra: Object.assign({ course: 'Palm View', rating: 71.2, slope: 128, par: 72, holes: 18, of: 18, format: 'stroke', solo: false, holeScores: Array.from({ length: 18 }, (_, i) => Math.floor(score / 18) + (i < score % 18 ? 1 : 0)), card: { others: 3, by: 'a:' + crypto.createHash('sha256').update('marker|' + id).digest('hex').slice(0, 12), byName: 'Card Marker' } }, o || {}) });
// "recorded as having played": the logger adds the friend to their players list and the friend claims that row (once)
const pal = async (logger, friend) => { const g = ok(await call(logger, 'guest/create', { name: friend })).guest; ok(await call(friend, 'guest/claim', { code: g.code })); return g.gid; };
const V = (r) => { const v = S.validate(r, r.src); if (!v.ok) throw new Error(v.why + ' ' + JSON.stringify(r)); return v.rec; };
let pass = 0; const fails = [];
const check = async (name, fn) => { fresh(); try { await fn(); pass++; console.log('  ok  ' + name); } catch (er) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String((er && er.message) || er).split('\n').slice(0, 6).join('\n       ')); } };

srv.listen(0, async () => {
  P = srv.address().port; let r, j;

  await check('1. a claimed guest record is frozen for the organizer; the claimant can remove claimed items', async () => {
    const g = ok(await call('bob', 'guest/create', { name: 'Cat Guest' })).guest;
    ok(await call('bob', 'self/save', { item: golfItem('2026-11-01', 95, { guest: g.gid }) }), 'before the claim the organizer logs for the guest');
    ok(await call('cat', 'guest/claim', { code: g.code }));
    for (let i = 2; i <= 4; i++) no(await call('bob', 'self/save', { item: golfItem('2026-11-0' + i, 60, { guest: g.gid }) }), 409, /claimed/, 'organizer adds a round after the claim');
    j = ok(await call('bob', 'guest/get', { gid: g.gid })); const kept = j.guest.items[0];
    no(await call('bob', 'guest/remove-item', { gid: g.gid, id: kept.id }), 409, /claimed/, 'organizer removes a round after the claim');
    await assert.rejects(S.guestAdd(K('bob'), g.gid, { src: 'self', id: 'x1', date: '2026-11-05', sport: 'golf', kind: 'golf-round', title: 'x', result: null, score: 60, verified: false }), /claimed/, 'the exported guestAdd refuses too');
    await assert.rejects(S.guestRemove(K('bob'), g.gid, kept.id), /claimed/, 'the exported guestRemove refuses too');
    j = ok(await call('cat', 'me')); assert.strictEqual(j.records.filter((x) => x.kind === 'golf-round').length, 1, 'the claimant has only the round that was there at the claim');
    const cid = j.records[0].id; no(await call('ann', 'self/delete', { id: cid }), 404, null, 'someone else cannot remove it');
    ok(await call('cat', 'self/delete', { id: cid }), 'the claimant removes a claimed item'); j = ok(await call('cat', 'me')); assert.strictEqual(j.records.length, 0);
  });

  await check('2a. WHS soft cap, hard cap and Low Handicap Index', async () => {
    const rs = []; for (let i = 0; i < 20; i++) rs.push(mk(i, 82)); const a = R.handicap(rs); assert.strictEqual(a.index, 10); assert.strictEqual(a.cap, null);
    for (let i = 20; i < 34; i++) rs.push(mk(i, 100)); // 14 rounds of 100 in the last 20 -> raw: (6 x 10 + 2 x 28) / 8 = 14.5 -> 4.5 above the low: 10 + 3 + 1.5 / 2 = 13.8 (soft cap)
    let h = R.handicap(rs); assert.strictEqual(h.raw, 14.5); assert.strictEqual(h.low, 10); assert.strictEqual(h.cap, 'soft'); assert.strictEqual(h.index, 13.8);
    for (let i = 34; i < 40; i++) rs.push(mk(i, 100)); h = R.handicap(rs); assert.strictEqual(h.raw, 28); assert.strictEqual(h.cap, 'hard'); assert.strictEqual(h.index, 15, 'never more than 5.0 above the Low Handicap Index');
    const late = rs.concat([mk(800, 100)]); h = R.handicap(late); assert.ok(h.index > 15, 'a low index older than 365 days no longer caps (' + h.index + ')');
    const few = []; for (let i = 0; i < 10; i++) few.push(mk(i, i < 5 ? 80 : 110)); assert.strictEqual(R.handicap(few).cap, null, 'no cap before 20 rounds exist');
  });

  await check('2b. exceptional score reduction (7.0-9.9 below: -1.0; 10.0+: -2.0 on each of the last 20)', async () => {
    const rs = []; for (let i = 0; i < 20; i++) rs.push(mk(i, 92)); assert.strictEqual(R.handicap(rs).index, 20);
    let h = R.handicap(rs.concat([mk(20, 80)])); assert.strictEqual(h.diffs[0].diff, 8); assert.strictEqual(h.diffs[0].exc, -2); assert.ok(h.diffs.every((d) => d.esr === -2)); assert.strictEqual(h.index, 16.5, '(6.0 + 7 x 18.0) / 8');
    h = R.handicap(rs.concat([mk(20, 84)])); assert.strictEqual(h.diffs[0].exc, -1, '8.0 below the index'); assert.strictEqual(h.index, 18, '(11.0 + 7 x 19.0) / 8');
    h = R.handicap(rs.concat([mk(20, 86)])); assert.ok(!h.diffs[0].exc, '6.0 below: not exceptional'); assert.strictEqual(h.index, 19.3);
  });

  await check('2c. confirmed rounds: handicapFor returns {oddable, confirmedIndex, rounds, confirmedRounds, event, setBy, use}; money / flights / tournaments use the confirmed index', async () => {
    for (let i = 1; i <= 5; i++) ok(await call('ann', 'self/save', { item: golfItem('2026-10-0' + i, 80 + i) }));
    let h = await S.handicapFor(K('ann')); ['oddable', 'confirmedIndex', 'rounds', 'confirmedRounds', 'event', 'setBy', 'use'].forEach((k) => assert.ok(k in h, 'handicapFor has ' + k));
    assert.ok(h.oddable.index != null, 'self-logged rounds still make the Oddable index (H1)'); assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.confirmedIndex, h.use, h.needsSet, h.oddable.selfLogged], [5, 0, null, null, true, 5], 'five self-logged rounds: nothing to play a money game off; the organizer / director sets a number');
    assert.strictEqual(h.text, h.oddable.index.toFixed(1) + ' · 0 of 5 rounds confirmed');
    assert.strictEqual((await S.handicapFor(K('ann'), { casual: true })).use, h.oddable.index, 'solo and casual play use the full index');
    assert.deepStrictEqual((({ use, setBy }) => [use, setBy])(await S.handicapFor(K('ann'), { typed: 14 })), [null, null], 'review 5: a number passed in by an engine is ignored; only eventApprove / eventOverride give a money game its number');
    S.register('golf', async (k) => (k === K('ann') ? [engineRound('golf:G1:round:p', '2026-10-10', 90), engineRound('golf:G2:round:p', '2026-10-11', 91), engineRound('golf:G3:round:p', '2026-10-12', 92, { solo: true })] : [])); S._reset();
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.use], [8, 2, null], 'a one-player engine round is not confirmed; 2 confirmed is still fewer than 3');
    S.register('golf', async (k) => (k === K('ann') ? [1, 2, 3].map((i) => engineRound('golf:G' + i + ':round:p', '2026-10-1' + i, 89 + i)) : [])); S._reset();
    h = await S.handicapFor(K('ann')); const want = Math.round((R.differential(90, 71.2, 128) - 2) * 10) / 10;
    assert.deepStrictEqual([h.rounds, h.confirmedRounds, h.confirmedIndex, h.suggested.value, h.suggested.confirmed, h.use, h.needsSet, h.setBy], [8, 3, want, want, true, null, true, null], 'three rounds scored in the app with other players: the confirmed index is SUGGESTED (review 5: the organizer approves it)');
    assert.notStrictEqual(h.oddable.index, h.suggested.value, 'the full Oddable index is still returned next to it'); assert.strictEqual(h.text, h.oddable.index.toFixed(1) + ' · 3 of 8 rounds confirmed');
    j = ok(await call('ann', 'me')); assert.deepStrictEqual([j.golfHcp.index, j.golfHcp.confirmedIndex, j.golfHcp.confirmedRounds], [h.oddable.index, want, 3], 'My stats shows the same numbers (one calculation)');
    assert.ok(j.records.filter((x) => x.src === 'self' && x.kind === 'golf-round').every((x) => x.extra.selfLogged === true && x.extra.confirmed === false), 'self-logged rounds are marked');
  });

  await check('2d. a self-logged round counts as confirmed only after ANOTHER player confirms it; an edit drops the confirmation', async () => {
    const gs = [await pal('ann', 'bob'), await pal('ann', 'cat'), await pal('ann', 'dir')], ids = []; for (let i = 1; i <= 3; i++) ids.push(ok(await call('ann', 'self/save', { item: golfItem('2026-11-1' + i, 84 + i, { withGuests: gs }) })).record.id);
    const L = ok(await call('ann', 'confirm/link', { id: ids[0] })); assert.ok(/^[a-z0-9]{12}-[a-z0-9]{24}$/.test(L.code) && L.link.endsWith('?join=confirm.' + L.code));
    no(await call('ann', 'confirm/do', { code: L.code }), 400, /own entry/, 'nobody confirms their own round');
    no(await call('bob', 'confirm/do', { code: L.code.slice(0, 13) + 'z'.repeat(24) }), 403, null, 'a wrong link');
    j = ok(await call('bob', 'confirm/get', { code: L.code })); assert.deepStrictEqual([j.loggedBy, j.entry.score, j.entry.date, j.mine, j.confirmed], ['Ann Real', 85, '2026-11-11', false, false]);
    ok(await call('bob', 'confirm/do', { code: L.code })); no(await call('cat', 'confirm/do', { code: L.code }), 409, /already/, 'one confirmer');
    ok(await call('cat', 'confirm/do', { code: ok(await call('ann', 'confirm/link', { id: ids[1] })).code })); ok(await call('dir', 'confirm/do', { code: ok(await call('ann', 'confirm/link', { id: ids[2] })).code })); // three different players who were there
    let h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed, h.suggested.value], [3, true, h.oddable.index]);
    j = ok(await call('ann', 'me')); assert.strictEqual(j.records.find((x) => x.id === ids[0]).extra.confirmedBy.name, 'Bob Real', 'the confirmer is named from their own account');
    ok(await call('ann', 'self/save', { id: ids[0], item: golfItem('2026-11-11', 70) }), 'edit inside 48 hours'); S._reset();
    h = await S.handicapFor(K('ann')); assert.deepStrictEqual([h.confirmedRounds, h.suggested.confirmed], [2, false], 'the edited round is no longer confirmed'); no(await call('bob', 'confirm/get', { code: L.code }), 409, /changed/, 'the old link is dead'); assert.ok(/3 confirmed rounds/.test(h.unconfirmedWhy));
  });

  await check('2e. sanity limits on typed rounds: Rating 55-85, Slope 55-155, not more than 15 under the Rating, index floor +10', async () => {
    no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 40, { cr: 85, slope: 55 }) }), 400, /under the Course Rating/, '40 on a 85.0 course');
    no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 56, { cr: 71.2 }) }), 400, /under the Course Rating/);
    ok(await call('ann', 'self/save', { item: golfItem('2026-11-10', 57, { cr: 71.2 }) }), '14.2 under is allowed');
    no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 80, { cr: 52 }) }), 400, /Course Rating/, 'Rating 52'); no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 80, { slope: 160 }) }), 400, /Slope/); no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 80, { slope: 50 }) }), 400, /Slope/);
    no(await call('ann', 'self/save', { item: golfItem('2026-11-10', 28, { holes: 9, par: 36, cr: 35.6 }) }), 400, /under the Course Rating/, '9 holes: 7.5 under');
    const low = []; for (let i = 0; i < 6; i++) low.push(mk(i, 50, { cr: 72, slope: 55 })); assert.strictEqual(R.handicap(low).index, -10, 'the index never goes below +10.0');
  });

  await check('2f. no dates before the account existed or in the future; edits and deletes lock 48 hours after entry; edit history kept', async () => {
    STAMP[K('eve')] = Date.parse('2026-11-01T15:00:00Z'); db['lock:acctsince:done'] = { id: 'lock:acctsince:done', updated: 1, data: { at: T0 - 864e5 } }; // review 5: the sign-up stamp, and the backfill has run
    j = ok(await call('eve', 'self/save', { item: golfItem('2026-10-31', 88) }), 'up to 30 days before joining is allowed'); assert.strictEqual(j.record.extra.preAcct, true, 'and marked'); no(await call('eve', 'self/save', { item: golfItem('2019-01-01', 70) }), 400, /30 days before you joined/); no(await call('eve', 'self/save', { item: golfItem('2026-10-01', 70) }), 400, /30 days before you joined/);
    no(await call('eve', 'self/save', { item: golfItem('2026-11-17', 88) }), 400, /future/); ok(await call('eve', 'self/save', { item: golfItem('2026-11-01', 88) }), 'the day the account began');
    delete db[SID.dir2].created_at; ok(await call('dir2', 'self/save', { item: golfItem('2026-11-15', 88) }), 'a brand-new account can log yesterday'); no(await call('dir2', 'self/save', { item: golfItem('2026-10-10', 88) }), 400, /30 days before you joined/);
    const id = ok(await call('ann', 'self/save', { item: golfItem('2026-11-14', 90) })).record.id, at0 = db[S.selfKey(K('ann'))].data.items[0].extra.at;
    NOW = T0 + 47 * 36e5; j = ok(await call('ann', 'self/save', { id, item: golfItem('2026-11-14', 86) }), 'edit at 47 hours'); assert.strictEqual(j.record.extra.at, at0, 'an edit keeps the entry time'); assert.strictEqual(j.record.extra.rev, 1);
    j = ok(await call('ann', 'me')); assert.deepStrictEqual(j.edits[id].map((x) => [x.was.score, x.at]), [[90, NOW]], 'the old score is kept in the history'); assert.strictEqual(j.records.find((x) => x.id === id).extra.locked, false);
    NOW = T0 + 48 * 36e5 + 1000; no(await call('ann', 'self/save', { id, item: golfItem('2026-11-14', 60) }), 409, /48 hours/, 'edit after 48 hours'); no(await call('ann', 'self/delete', { id }), 409, /48 hours/, 'delete after 48 hours');
    S._reset(); j = ok(await call('ann', 'me')); assert.strictEqual(j.records.find((x) => x.id === id).extra.locked, true); assert.strictEqual(j.records.find((x) => x.id === id).score, 86);
    const id2 = ok(await call('ann', 'self/save', { item: { type: 'other', date: '2026-11-18', sport: 'other', result: 'W', opponent: 'Zed', title: 'Darts' } })).record.id; ok(await call('ann', 'self/delete', { id: id2 }), 'a fresh entry can be deleted');
    assert.strictEqual(db[S.selfKey(K('ann'))].data.gone[0].id, id2, 'deleted entries are logged');
  });

  await check('2g. 9-hole rounds count (WHS 2024 expected score); rounds without Rating / Slope say so on the round', async () => {
    assert.strictEqual(R.expected9(14), 8.5, 'USGA example: index 14.0 -> expected 9-hole differential 8.5');
    const base = []; for (let i = 0; i < 20; i++) base.push(mk(i, 86)); assert.strictEqual(R.handicap(base).index, 14);
    let h = R.handicap(base.concat([mk(20, 41, { holes: 9, cr: 33.8, slope: 113, par: 36 })])); assert.strictEqual(h.diffs[0].diff, 15.7, 'USGA example: 9-hole differential 7.2 + expected 8.5 = 15.7'); assert.strictEqual(h.diffs[0].exp9, 8.5); assert.strictEqual(h.rounds, 21);
    const nines = [0, 1, 2, 3, 4].map((i) => mk(i, 45, { holes: 9, cr: 35, slope: 113, par: 36 })); h = R.handicap(nines); assert.deepStrictEqual([h.index, h.rounds, h.waiting9, h.need], [null, 0, 5, 1], 'no index yet: nines wait until 54 holes are posted');
    h = R.handicap(nines.concat([mk(5, 45, { holes: 9, cr: 35, slope: 113, par: 36 })])); assert.deepStrictEqual([h.rounds, h.waiting9, h.index], [6, 0, 20.1], '54 holes posted: six differentials of 21.1 (10.0 + expected 11.1 off the provisional 19.0), lowest two minus 1.0');
    for (let i = 1; i <= 3; i++) ok(await call('ann', 'self/save', { item: golfItem('2026-11-0' + i, 88) }));
    ok(await call('ann', 'self/save', { item: golfItem('2026-11-04', 44, { holes: 9, par: 36, cr: 35.4, slope: 124 }) })); ok(await call('ann', 'self/save', { item: { type: 'golf', date: '2026-11-05', course: 'Muni', total: 99 } }));
    j = ok(await call('ann', 'me')); assert.strictEqual(j.golfHcp.rounds, 4, 'the 9-hole round counts'); assert.strictEqual(j.golfHcp.nine, 1); assert.strictEqual(j.golfHcp.missing, 1);
    assert.ok(/9-hole round: counts/.test(j.records.find((x) => x.score === 44).extra.hcpNote)); assert.ok(/Does not count.*no Course Rating and Slope/.test(j.records.find((x) => x.score === 99).extra.hcpNote), 'the round without Rating / Slope says so');
  });

  await check('2h. hole scores without stroke index are capped at par + 5 per hole; ONE copy of the maths (ratings.js)', async () => {
    const pars = Array(18).fill(4), si = Array.from({ length: 18 }, (_, i) => i + 1), tens = Array(18).fill(10);
    let a = R.adjustedGross({ strokes: tens, pars, total: 180 }, 18); assert.deepStrictEqual([a.ags, a.how, a.cut], [126, 'par+5', 18], 'with an index but no stroke indexes: par + 5 a hole, and the round held to net double bogey as a whole (72 + 36 + 18)'); assert.strictEqual(R.adjustedGross({ strokes: tens, pars, total: 180 }, null).ags, 162, 'no index: par + 5 a hole');
    a = R.adjustedGross({ strokes: tens, pars, si, total: 180 }, 18); assert.deepStrictEqual([a.ags, a.how], [126, 'ndb'], 'with stroke indexes: net double bogey');
    const src = require('fs').readFileSync(B + 'stats.js', 'utf8'); assert.ok(/R\.handicapSet\(/.test(src) && /R\.eloSet\(/.test(src), 'stats.js calls the one calculation'); assert.ok(!/113\s*\/\s*/.test(src.replace(/\/\/.*$/gm, '')), 'no handicap maths of its own in stats.js');
    ['handicapSet', 'eloSet', 'order', 'expected9', 'hcpText'].forEach((f) => assert.strictEqual(typeof R[f], 'function', 'ratings.js exports ' + f + ' (golf calls it)'));
  });

  await check('3a. rating integrity: a self-logged match does not move the seeding rating until the opponent confirms; ratingFor returns {oddable, confirmedGames, event, setBy, use}', async () => {
    for (let i = 0; i < 10; i++) ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: '2026-11-0' + (1 + (i % 9)), fmt: 'singles', opp: ['Nobody ' + i], games: [[11, 0]] } }));
    let rt = await S.ratingFor(K('ann')); ['oddable', 'confirmedGames', 'event', 'setBy', 'use'].forEach((k) => assert.ok(k in rt, 'ratingFor has ' + k));
    assert.ok(rt.oddable.rating > 1600, 'the full Oddable rating moves (' + rt.oddable.rating + ')'); assert.deepStrictEqual([rt.confirmedGames, rt.use, rt.seed, rt.start], [0, null, 1500, true], 'ten self-logged wins move nothing used for seeding');
    assert.strictEqual(rt.text, rt.oddable.rating + ' · 0 of 10 games confirmed'); assert.strictEqual((await S.ratingFor(K('ann'), 'pickleball', { casual: true })).use, rt.oddable.rating);
    const gB = await pal('ann', 'bob'), id = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: '2026-11-15', fmt: 'singles', opp: ['x'], oppGuest: [gB], games: [[11, 7], [11, 9]] } })).record.id;
    ok(await call('bob', 'confirm/do', { code: ok(await call('ann', 'confirm/link', { id })).code }));
    rt = await S.ratingFor(K('ann')); j = ok(await call('ann', 'me')); assert.deepStrictEqual([rt.confirmedGames, j.ratings.pickleball.confirmedRating, rt.use, rt.unconfirmedWhy], [1, 1516, null, 'needs 3 confirmed games (1 so far)'], 'the confirmed win counts (1500 + 16); seeding waits for three different confirmers');
    const rb = await S.ratingFor(K('bob')); j = ok(await call('bob', 'me')); assert.deepStrictEqual([rb.confirmedGames, j.ratings.pickleball.confirmedRating], [1, 1484], 'the opponent who confirmed gets the same match from their side');
    j = ok(await call('bob', 'me')); const mr = j.records.find((x) => x.kind === 'match'); assert.deepStrictEqual([mr.result, mr.extra.scoreText, mr.extra.loggedBy, mr.opponent], ['L', '7-11, 9-11', 'Ann Real', 'Ann Real']);
  });

  await check('3b. opponent / partner ratings are used when supplied; two accounts trading wins get diminishing weight', async () => {
    S.register('events', async (k) => (k === K('ann') ? [{ src: 'events', id: 'E1:m1', date: '2026-11-01', sport: 'pickleball', kind: 'match', title: 'Ladder', result: 'W', opponent: 'Strong', verified: true, extra: { fmt: 'singles', oppRating: [1900], opp: [{ id: 'g1', name: 'Strong', account: true }], confirmed: true, confirmedBy: { name: 'Strong', at: 1 }, oppKey: 'e:strong00000001' } },
      { src: 'events', id: 'E1:m2', date: '2026-11-20', sport: 'pickleball', kind: 'match', title: 'Ladder', result: 'W', opponent: 'A / B', verified: true, extra: { fmt: 'doubles', partnerRating: 1300, oppRating: [1700, null], opp: [{ id: 'g2', name: 'A', account: true }, { id: 'g3', name: 'B' }], confirmed: true, confirmedBy: { name: 'A', at: 2 }, oppKey: 'e:pairab00000001' } }] : [])); S._reset(); NOW = Z('2026-11-25T18:00:00Z');
    const rt = await S.ratingFor(K('ann'), 'pickleball', { casual: true }), d1 = 32 * (1 - R.expected(1500, 1900)), r1 = 1500 + d1, d2 = 32 * (1 - R.expected((r1 + 1300) / 2, (1700 + 1500) / 2));
    assert.strictEqual(rt.use, Math.round(r1 + d2), 'a win over a 1900 player is worth ' + d1.toFixed(1) + ', and the doubles uses the partner and both opponents (null = 1500)'); assert.strictEqual(rt.confirmedGames, 2);
    const farm = Array.from({ length: 12 }, (_, i) => ({ id: 'f' + String(i).padStart(2, '0'), date: '2026-11-10', result: 'W', confirmed: true, extra: { at: T0 + i * 13 * 36e5, oppKey: 'a:puppet', fmt: 'singles' } })); // entered 13 hours apart: the weekly halving, without the 2-in-24-hours stop
    const f = R.eloSet(farm); assert.ok(f.rating < 1500 + 32, '12 wins over the same account in a week are worth less than two normal wins (' + f.rating + ')'); assert.deepStrictEqual(f.history.slice(0, 3).map((x) => x.w), [1, 0.5, 0.25]);
    const spread = farm.map((m, i) => Object.assign({}, m, { date: new Date(Date.UTC(2026, 0, 1 + i * 8)).toISOString().slice(0, 10), extra: Object.assign({}, m.extra, { at: Date.UTC(2026, 0, 1 + i * 8, 18) }) })); assert.ok(R.eloSet(spread).history.every((x) => x.w === 1), 'the same opponent once a week or less (by ENTRY time) is full weight');
    const gC = await pal('bob', 'cat'), ids = []; for (let i = 0; i < 3; i++) { NOW += 30 * 36e5; const id = ok(await call('bob', 'self/save', { item: { type: 'pickleball', date: S.chiDay(NOW), fmt: 'singles', opp: ['x'], oppGuest: [gC], games: [[11, 2]] } })).record.id; ids.push(id); ok(await call('cat', 'confirm/do', { code: ok(await call('bob', 'confirm/link', { id })).code })); }
    S._reset(); j = ok(await call('bob', 'me')); assert.deepStrictEqual(j.ratings.pickleball.history.map((x) => x.w), [1, 0.5, 0.25], 'the confirming ACCOUNT is the opponent');
  });

  await check('4. same-day play is processed in entry order: My stats and the engines get the same handicap and rating', async () => {
    const seq = ['W', 'W', 'W', 'L', 'L', 'W', 'L', 'L', 'L', 'W', 'W', 'L'];
    for (const [i, x] of seq.entries()) { NOW = T0 + i * 60e3; ok(await call('cat', 'self/save', { item: { type: 'pickleball', date: '2026-11-12', fmt: 'singles', opp: ['Opp ' + i], games: [x === 'W' ? [11, 5] : [5, 11]] } })); }
    j = ok(await call('cat', 'me')); const eng = await S.ratingFor(K('cat'), 'pickleball', { casual: true });
    let e = 1500; seq.forEach((x) => { e += 32 * ((x === 'W' ? 1 : 0) - R.expected(e, 1500)); });
    assert.strictEqual(j.ratings.pickleball.rating, Math.round(e), 'My stats = the sequence as it was played'); assert.strictEqual(eng.oddable.rating, j.ratings.pickleball.rating, 'ratingFor says the same');
    const ms = seq.map((x, i) => ({ id: 'm' + i, date: '2026-11-12', result: x, extra: { at: 1000 + i, opp: ['Opp ' + i] } })); assert.strictEqual(R.eloFor(ms.slice().reverse()).rating, R.eloFor(ms).rating, 'eloFor: input order never matters');
    const rs = Array.from({ length: 25 }, (_, i) => ({ id: 'r' + i, at: 1000 + i, date: '2026-10-01', total: i < 5 ? 70 : 95, cr: 72, slope: 113, par: 72 })), a = R.handicap(rs).index;
    assert.strictEqual(R.handicap(rs.slice().reverse()).index, a, 'handicap: 25 same-day rounds give one answer in any input order'); assert.ok(a > 10, 'the first five (70s) have left the last 20 (' + a + ')');
    const tie = [{ id: 'b', date: '2026-10-01', total: 80, cr: 72, slope: 113, par: 72 }, { id: 'a', date: '2026-10-01', total: 90, cr: 72, slope: 113, par: 72 }, { id: 'c', date: '2026-10-01', total: 100, cr: 72, slope: 113, par: 72 }];
    assert.deepStrictEqual(R.handicap(tie).diffs.map((d) => d.id), ['c', 'b', 'a'], 'no entry time: the id decides');
  });

  await check('5. E-H: reason required; a start time is needed first; lockAt only moves later, before it passes, logged; "who" is the signed-in account; Enterprise re-checked on every edit', async () => {
    ent('dir'); const dir = K('dir'), ann = K('ann'), bob = K('bob');
    await S.eventSetup(dir, 'golf:ev2xxxxx', { title: 'No lock yet' }); await assert.rejects(S.eventOverride(dir, 'golf:ev2xxxxx', ann, { hcp: 1, reason: 'x' }), /start time first/, 'no lockAt: no overrides');
    await assert.rejects(S.eventSetup(dir, 'golf:ev3xxxxx', { lockAt: NOW - 1000 }), /future/, 'a start in the past is refused');
    await S.eventSetup(dir, 'golf:ev1xxxxx', { title: 'Club champs', sport: 'golf', lockAt: NOW + 3600e3 });
    await assert.rejects(S.eventOverride(dir, 'golf:ev1xxxxx', ann, { hcp: 10 }), /reason/, 'no reason'); await assert.rejects(S.eventOverride(dir, 'golf:ev1xxxxx', ann, { hcp: 10, reason: '   ' }), /reason/, 'a blank reason'); await assert.rejects(S.eventOverride(dir, 'golf:ev1xxxxx', ann, { hcp: null }), /reason/, 'clearing needs one too');
    await S.eventOverride(dir, 'golf:ev1xxxxx', bob, { hcp: 18, reason: 'new player', name: 'Fake Name', byName: '<b>Somebody Else</b>' });
    await assert.rejects(S.eventSetup(dir, 'golf:ev1xxxxx', { lockAt: NOW + 1800e3 }), /later/, 'the start cannot move earlier'); await S.eventSetup(dir, 'golf:ev1xxxxx', { lockAt: NOW + 7200e3, reason: 'Frost delay' });
    j = ok(await call('dir', 'event/log', { eventId: 'golf:ev1xxxxx' })); assert.deepStrictEqual(j.log.map((l) => [l.field, l.by, l.player, l.old, l.new, l.reason]), [['lockAt', 'Dir Real', '', null, T0 + 3600e3, 'Start set'], ['hcp', 'Dir Real', 'Bob Real', null, 18, 'new player'], ['lockAt', 'Dir Real', '', T0 + 3600e3, T0 + 7200e3, 'Frost delay']], 'who = the director\'s own account name; the player by their account name; start changes logged');
    entOff('dir'); S._reset(); await assert.rejects(S.eventOverride(dir, 'golf:ev1xxxxx', ann, { hcp: 3, reason: 'not enterprise any more' }), /Enterprise/, 'Enterprise switched off: no more edits'); await assert.rejects(S.eventSetup(dir, 'golf:ev1xxxxx', { lockAt: NOW + 9e6 }), /Enterprise/);
    ent('dir'); S._reset(); NOW = T0 + 7200e3; await assert.rejects(S.eventOverride(dir, 'golf:ev1xxxxx', ann, { hcp: 5, reason: 'late' }), /locked/, 'at the start: locked'); await assert.rejects(S.eventSetup(dir, 'golf:ev1xxxxx', { lockAt: NOW + 9e9 }), /locked/, 'after it passes the start can never move');
    assert.strictEqual(db['lock:evr:golf:ev1xxxxx'].data.lockAt, T0 + 7200e3);
  });

  await check('5b. ONE tournament override store and log: the "Set by tournament" card is filled as soon as a director sets a number; /stats/event/log answers for the director and the player', async () => {
    ent('dir'); const dir = K('dir'); for (let i = 1; i <= 3; i++) ok(await call('ann', 'self/save', { item: golfItem('2026-11-0' + i, 88) }));
    await S.eventSetup(dir, 'golf:MG26xxxx', { title: 'Member-Guest', sport: 'golf', lockAt: NOW + 864e5 }); ok(await call('dir', 'event/setup', { eventId: 'golf:MG26xxxx', title: 'Member-Guest', sport: 'golf' }), 'the director reaches the tournament the engine registered, over HTTP'); no(await call('bob', 'event/setup', { eventId: 'golf:X1xxxxxx', title: 'x', lockAt: NOW + 864e5 }), 404, /not found/, 'the phone route never creates an event');
    await S.eventOverride(dir, 'golf:MG26xxxx', K('ann'), { hcp: 9, reason: 'Club handicap' });
    j = ok(await call('ann', 'me')); assert.deepStrictEqual(j.tournaments.map((x) => [x.eventId, x.title, x.hcp, x.oddableHcp, x.reason, x.log.length, x.log[0].by]), [['golf:MG26xxxx', 'Member-Guest', 9, j.golfHcp.index, 'Club handicap', 1, 'Dir Real']], 'the card has the tournament number, the real Oddable number and the log line, with no round played in it yet');
    j = ok(await call('ann', 'event/log', { eventId: 'golf:MG26xxxx' })); assert.deepStrictEqual([j.director, j.mine.hcp, j.log.length], [false, 9, 1]); j = ok(await call('dir', 'event/log', { eventId: 'golf:MG26xxxx' })); assert.deepStrictEqual([j.director, j.set.length, j.log.length], [true, 1, 2]);
    no(await call('bob', 'event/log', { eventId: 'golf:MG26xxxx' }), 404, null, 'someone with no number there'); const h = await S.handicapFor(K('ann'), { eventId: 'golf:MG26xxxx' }); assert.deepStrictEqual([h.use, h.setBy, h.event, h.oddable.index != null], [9, 'tournament', 9, true]);
  });

  const mixed = () => [
    { src: 'bets', id: 'b:1', date: '2026-11-10', sport: 'nfl', kind: 'bet', title: 'DAL -3', result: 'W', stake: 110, pl: 100, units: 0.909, verified: false },
    { src: 'bets', id: 'b:2', date: '2026-11-10', sport: 'nfl', kind: 'bet', title: 'KC ML', result: 'L', stake: 50, pl: -50, units: -1, verified: false, extra: { group: true } },
    { src: 'bets', id: 'b:3', date: '2026-11-11', sport: 'nba', kind: 'bet', title: 'LAL ML (open)', result: null, stake: 25, verified: false },
    { src: 'bets', id: 'b:4', date: '2026-11-11', sport: 'nfl', kind: 'bet', title: 'Won, no price', result: 'W', stake: 100, verified: false, extra: { noPrice: true } },
    { src: 'bets', id: 'log:2026-11-01', date: '2026-11-01', sport: 'nfl', kind: 'bet', title: 'Deleted bets', result: null, pl: 40, stake: 120, verified: false, extra: { adj: { w: 2, l: 1, p: 0 }, fromLog: true } },
    // the complete review's contest: entry $25, prize $9, and the member's bets inside it (+$64.10 on $180 risked) which are ALSO My Bets rows
    { src: 'groups', id: 'G1:c1', date: '2026-11-09', sport: 'nfl', kind: 'contest', groupId: 'G1', contestId: 'c1', title: 'Sunday Crew · Picks', result: 'L', place: { n: 3, of: 6 }, pl: 64.1, units: 0.6, stake: 180, spent: 25, won: 9, verified: true, extra: { derived: true, record: '4-3-0' } },
    { src: 'groups', id: 'G1:c2', date: '2026-11-16', sport: 'nfl', kind: 'contest', groupId: 'G1', contestId: 'c2', title: 'Sunday Crew · Week 11', result: null, place: { n: 1, of: 6 }, pl: 30, stake: 60, spent: 10, verified: true, extra: { derived: true, live: true } },
    { src: 'calcutta', id: 'c1', date: '2026-11-02', sport: 'golf', kind: 'calcutta', title: 'Masters lot', result: null, spent: 200, won: 500, pl: 300, verified: true, extra: { over: true } },
    { src: 'calcutta', id: 'c2', date: '2026-11-03', sport: 'nfl', kind: 'calcutta', title: 'Unsettled lot', result: null, spent: 150, verified: true },
    { src: 'calcutta', id: 'c3', date: '2026-11-03', sport: 'nfl', kind: 'calcutta', title: 'Running, some won so far', result: null, spent: 80, won: 20, pl: -60, verified: true, extra: { over: false } },
    { src: 'golf', id: 'r1', date: '2026-11-04', sport: 'golf', kind: 'golf-round', title: 'Palm View', result: null, score: 84, toPar: 12, verified: true, extra: { holes: 18 } },
    // the complete review's Nassau: $20 a bet, three bets (front halved, back and total lost) = -$40
    { src: 'golf', id: 'n1', date: '2026-11-04', sport: 'golf', kind: 'match', title: 'Golf day · Nassau vs Team 2', result: 'L', stake: 20, pl: -40, won: 0, opponent: 'Team 2', verified: false, extra: { type: 'nassau', bets: 3, front: 'AS', back: '2 dn' } },
    { src: 'golf', id: 'p1', date: '2026-11-05', sport: 'golf', kind: 'golf-pool', title: 'Pick six', result: null, place: { n: 3, of: 12 }, stake: 20, verified: true },
    { src: 'golf', id: 'p2', date: '2026-11-05', sport: 'golf', kind: 'golf-pool', title: 'One and done (running)', result: null, stake: 15, verified: true, extra: { live: true } },
    { src: 'events', id: 'm1', date: '2026-11-06', sport: 'pickleball', kind: 'match', title: 'vs Z', result: 'W', verified: true },
    { src: 'events', id: 'e1', date: '2026-11-07', sport: 'pickleball', kind: 'event', title: 'RR', result: null, place: { n: 1, of: 8 }, stake: 25, won: 100, pl: 75, verified: true },
    { src: 'events', id: 't1', date: '2026-11-08', sport: 'golf', kind: 'tournament', title: 'Club champs', result: null, place: { n: 3, of: 12 }, verified: true },
    { src: 'self', id: 's1', date: '2026-11-09', sport: 'other', kind: 'match', title: 'Darts', result: 'W', verified: false },
  ].map(V);
  const rowNet = (L) => L.reduce((s, x) => s + (x.money && x.money.state === 'settled' ? x.money.net : 0), 0), rowAt = (L) => L.reduce((s, x) => s + (x.money && x.money.state === 'open' ? x.money.atStake : 0), 0);
  const rowN = (L) => L.reduce((s, x) => s + (x.extra && x.extra.adj ? x.extra.adj.w + x.extra.adj.l + x.extra.adj.p : 1), 0), rowStake = (L) => L.reduce((s, x) => s + (x.money && x.money.state === 'settled' ? x.money.entry || 0 : 0), 0);

  await check('6a. S-ALL reconciliation: every total equals its drill-down rows, and overall = the sum of the sports = the sum of the game types (mixed set)', async () => {
    const recs = mixed(), T = S.tree(recs), ADD = ['n', 'w', 'l', 'p', 't', 'open', 'fin', 'solo', 'staked', 'pl', 'atStake', 'unknown', 'units'];
    const same = (t, L, what) => { near(t.pl, rowNet(L), what + ': net = its rows'); near(t.atStake, rowAt(L), what + ': at stake = its rows'); assert.strictEqual(t.n, rowN(L), what + ': plays = its rows'); near(t.staked, rowStake(L), what + ': risked = its rows'); assert.strictEqual(t.unknown, L.filter((x) => x.money && x.money.state === 'unknown').length, what + ': not-known count'); };
    same(T.tot, recs, 'overall');
    Object.keys(T.bySport).forEach((s) => { same(T.bySport[s].tot, recs.filter((x) => x.sport === s), 'sport ' + s); Object.keys(T.bySport[s].byKind).forEach((k) => same(T.bySport[s].byKind[k].tot, recs.filter((x) => x.sport === s && x.kind === k), s + ' / ' + k)); });
    Object.keys(T.byKind).forEach((k) => same(T.byKind[k].tot, recs.filter((x) => x.kind === k), 'game type ' + k));
    ADD.forEach((f) => { near(Object.values(T.bySport).reduce((s, x) => s + x.tot[f], 0), T.tot[f], 'sum of the sports: ' + f); near(Object.values(T.byKind).reduce((s, x) => s + x.tot[f], 0), T.tot[f], 'sum of the game types: ' + f);
      Object.keys(T.bySport).forEach((s) => near(Object.values(T.bySport[s].byKind).reduce((a, x) => a + x.tot[f], 0), T.bySport[s].tot[f], s + ' by game type: ' + f)); });
    near(T.tot.pl, 100 - 50 + 40 + (9 - 25) + 300 - 40 + 75, 'the net by hand'); near(T.tot.atStake, 25 + 10 + 150 + 80 + 15, 'open money by hand'); assert.strictEqual(T.tot.unknown, 2);
  });

  await check('6b. unsettled = "Open: $ at stake" (not in the net); a bet with no price is "Net: not known" (never -110); contest prize and the bets inside it counted once each; Nassau entry = every bet', async () => {
    const by = Object.fromEntries(mixed().map((x) => [x.id, x]));
    assert.deepStrictEqual(by.c2.money, { entry: 150, payout: null, net: null, state: 'open', atStake: 150 }, 'a Calcutta buy with no payout yet'); assert.deepStrictEqual([by.c3.money.state, by.c3.money.atStake, by.c3.money.net, by.c3.money.soFar], ['open', 80, null, -60], 'a running Calcutta is open even with winnings so far');
    assert.deepStrictEqual([by['b:3'].money.state, by['b:3'].money.atStake], ['open', 25]); assert.deepStrictEqual([by.p2.money.state, by.p2.money.atStake], ['open', 15]);
    const c = S.tree(mixed()).bySport.nfl.calcutta; assert.deepStrictEqual([c.teams, c.open, c.atStake, c.spent, c.net], [2, 2, 230, 0, 0], 'the Calcutta tile: both NFL buys open, nothing in the net');
    assert.deepStrictEqual(by['b:4'].money, { entry: 100, payout: null, net: null, state: 'unknown' }); assert.deepStrictEqual(by.p1.money.state, 'unknown', 'a finished pool with an entry and no payout on the record: not known, not guessed');
    const won = S.betRecords({ bets: [{ id: 'b1794600000001', day: '2026-11-14', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 100, fin: 'won' }, { id: 'b1794600000002', day: '2026-11-14', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 100, odds: 50, fin: 'won' },
      { id: 'b1794600000003', day: '2026-11-14', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 100, odds: 150, fin: 'won' }, { id: 'b1794600000004', day: '2026-11-14', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 100, fin: 'lost' }, { id: 'b1794600000005', day: '2026-11-14', side: 'KC', home: 'KC', away: 'BUF', type: 'ml', stake: 40, odds: -120, gl: 1794600000000 }] });
    assert.deepStrictEqual(won.map((x) => [x.pl, x.units]), [[undefined, undefined], [undefined, undefined], [150, 1.5], [-100, -1], [undefined, undefined]], 'no odds / bad odds: no P/L invented; real odds and losses are known');
    const t = S.tot(won.map(V)); assert.deepStrictEqual([t.n, t.w, t.l, t.unknown, t.pl, t.staked, t.open], [5, 3, 1, 2, 50, 200, 1], 'the two no-price wins count as plays and wins, not in the net'); assert.strictEqual(won[4].extra.group, true, 'a group bet (gl) is marked on its My Bets row');
    assert.deepStrictEqual(by['G1:c1'].money, { entry: 25, payout: 9, net: -16, state: 'settled' }, 'the contest shows its $25 entry and $9 prize, not $89.10'); assert.deepStrictEqual(by['G1:c1'].inner, { stake: 180, pl: 64.1, units: 0.6 }, 'the bets inside are shown apart');
    assert.strictEqual(by['G1:c1'].pl, undefined); assert.deepStrictEqual([by['G1:c2'].money.state, by['G1:c2'].money.atStake], ['open', 10], 'a running contest: its entry is at stake');
    const both = [by['b:1'], by['b:2'], by['G1:c1']], tb = S.tot(both); near(tb.pl, 100 - 50 - 16, 'bets + contest: each dollar once'); near(S.tot([by['G1:c1']]).pl, -16, 'the contest total alone is the same contest money');
    assert.deepStrictEqual(by.n1.money, { entry: 60, payout: 20, net: -40, state: 'settled', per: 20, bets: 3 }, 'Nassau: 3 bets x $20 = $60 entry, net -$40 (never "entry $20, net -$40")');
  });

  await check('7. course consent uses the account\'s own name and identity', async () => {
    ok(await call('owner', 'course/admin', { op: 'ent', tag: SID.dir.slice(0, 8), on: true })); ok(await call('owner', 'course/admin', { op: 'link', tag: SID.dir.slice(0, 8), courseId: 'pv1', name: 'Palm View' }));
    await S.consentOnJoin(K('bob'), 'pv1', { kind: 'league', id: 'L1', title: 'League' }, false); ok(await call('bob', 'consent/set', { courseId: 'pv1', on: true, myName: 'Ann', e: K('ann'), userKey: K('ann') }));
    j = ok(await call('dir', 'course/players', { courseId: 'pv1' })); assert.deepStrictEqual(j.players.map((p) => p.name), ['Bob Real'], 'Bob appears as himself, whatever name he sent');
    j = ok(await call('ann', 'consent/list')); assert.deepStrictEqual(j.consents, [], 'Ann consented to nothing'); assert.ok(!JSON.stringify(db['lock:cshare']).includes('"Ann"'), 'the typed name is not stored');
    await S.consentOnJoin(K('cat'), 'pv1', { kind: 'event', id: 'E1', title: 'Open' }, true, 'The Club Pro'); j = ok(await call('dir', 'course/players', { courseId: 'pv1' })); assert.deepStrictEqual(j.players.map((p) => p.name).sort(), ['Bob Real', 'Cat Real'], 'the exported consentOnJoin ignores a name too');
  });

  await check('7b. ONE consent store: a course linked in the golf engine\'s own row reaches the same consent prompt and the director sees consenting members with their confirmed index', async () => {
    db['lock:ent'] = { id: 'lock:ent', updated: 1, data: { keys: { [K('dir')]: true }, courses: { [K('dir')]: ['cedar'] } } }; db['lock:golf:courses'] = { id: 'lock:golf:courses', updated: 1, data: { courses: { cedar: { name: 'Cedar Ridge' } } } };
    j = ok(await call('ann', 'consent/get', { courseId: 'cedar' })); assert.deepStrictEqual([j.ask, j.text], [true, 'Share my handicap and rounds with Cedar Ridge?'], 'the prompt finds the golf-side link');
    S.register('golf', async (k) => (k === K('ann') ? [1, 2, 3].map((i) => engineRound('golf:D' + i + ':round:p', '2026-11-0' + i, 85 + i, { course: 'Cedar Ridge', courseId: 'cedar' })) : [])); ok(await call('ann', 'self/save', { item: golfItem('2026-11-10', 99) })); for (let i = 1; i <= 3; i++) ok(await call('bob', 'self/save', { item: golfItem('2026-11-0' + i, 80) }));
    await S.consentOnJoin(K('ann'), 'cedar', { kind: 'event', id: 'MG', title: 'Member-Guest' }, true); await S.consentOnJoin(K('bob'), 'cedar', null, true); // the engine saw them join
    j = ok(await call('dir', 'course/mine')); assert.deepStrictEqual(j.courses, [{ id: 'cedar', name: 'Cedar Ridge', players: 2 }], 'the director\'s course list reads the same store');
    const m = await S.courseMembers(K('dir'), 'cedar'), a = m.players.find((p) => p.name === 'Ann Real'), b = m.players.find((p) => p.name === 'Bob Real'), want = Math.round((R.differential(86, 71.2, 128) - 2) * 10) / 10;
    assert.deepStrictEqual([a.confirmedIndex, a.confirmedRounds, a.rounds, a.text], [want, 3, 4, a.index.toFixed(1) + ' · 3 of 4 rounds confirmed'], 'the director sees the confirmed index'); assert.deepStrictEqual([b.confirmedIndex, b.selfLogged, b.text], [null, 3, b.index.toFixed(1) + ' · 0 of 3 rounds confirmed'], 'and who is self-logged only');
    j = ok(await call('dir', 'course/rounds', { courseId: 'cedar' })); assert.ok(j.rounds.filter((x) => x.name === 'Bob Real').every((x) => x.self === true && x.confirmed === false && /Self-logged/.test(x.how)), 'self-logged is marked on the course\'s round list'); assert.ok(j.rounds.filter((x) => x.name === 'Ann Real').some((x) => x.self === false));
    j = ok(await call('dir', 'course/prefill', { courseId: 'cedar', cr: 71.2, slope: 128, par: 72 })); assert.deepStrictEqual(j.players.map((p) => [p.name, p.ch, p.needsSet]).sort(), [['Ann Real', R.courseHandicap(want, 128, 71.2, 72), false], ['Bob Real', null, true]], 'golf-day course handicaps come from the confirmed index');
    await assert.rejects(S.courseMembers(K('dir2'), 'cedar'), /not found/i, 'another account is not that course\'s director');
  });

  await check('8. pairingProfile(accountId, sport) for the pairing screen, respecting the sharing switch', async () => {
    assert.strictEqual(typeof S.pairingProfile, 'function'); S.register('golf', async (k) => (k === K('ann') ? [1, 2, 3].map((i) => engineRound('golf:D' + i + ':round:p', '2026-11-0' + i, 85 + i)) : []));
    let p = await S.pairingProfile(K('ann'), 'golf'); assert.deepStrictEqual([p.sport, p.shared, p.show, p.pairOn != null, p.print, 'use' in p, p.needsSet, 'text' in p, 'oddable' in p, 'lifetime' in p], ['golf', false, false, true, false, false, false, false, false, false], 'sharing off: only the number the pairing needs, marked not for printing');
    ok(await call('ann', 'share', { on: true })); p = await S.pairingProfile(K('ann'), 'golf'); assert.deepStrictEqual([p.show, p.text, p.oddable.rounds, p.lifetime.rounds], [true, p.oddable.index.toFixed(1) + ' · 3 of 3 rounds confirmed', 3, 3], 'sharing on: the handicap line and lifetime totals');
    p = await S.pairingProfile(K('bob'), 'pickleball'); assert.deepStrictEqual([p.sport, p.pairOn, p.start, p.show], ['pickleball', 1500, true, false]); p = await S.pairingProfile(K('bob'), 'golf'); assert.deepStrictEqual([p.pairOn, p.needsSet], [null, true]);
  });

  await check('9. writes are queued per row: a burst of 30 saves at once all land (no "Busy, try again")', async () => {
    slow = true; const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call('ann', 'self/save', { item: { type: 'other', date: '2026-11-16', sport: 'other', result: 'W', opponent: 'P' + i, title: 'Game ' + i } })));
    slow = false; assert.deepStrictEqual(rs.map((x) => x.s).filter((x) => x !== 200), [], 'every save answered 200'); assert.strictEqual(db[S.selfKey(K('ann'))].data.items.length, 30, 'and all 30 are stored');
  });

  await check('10. the typed DUPR field is gone', async () => {
    no(await call('ann', 'dupr', { dupr: 4.25 }), 404); j = ok(await call('ann', 'self/save', { item: { type: 'pickleball', date: '2026-11-15', fmt: 'singles', opp: ['Bob'], games: [[11, 7]], dupr: 4.5 } })); assert.ok(!('dupr' in j.record.extra)); j = ok(await call('ann', 'me')); assert.ok(!('dupr' in j));
    assert.ok(!/dupr/i.test(require('fs').readFileSync(path.join(B, '..', 'pics', 'stats.js'), 'utf8').replace(/\.sdupr/g, '')), 'no DUPR field in the screen');
  });

  console.log(fails.length ? '\nFAILED ' + fails.length + ' of ' + (pass + fails.length) + ' groups:\n  - ' + fails.join('\n  - ') : '\nPASS ' + pass + ' groups of checks');
  srv.close(); setTimeout(() => process.exit(fails.length ? 1 : 0), 50);
});
