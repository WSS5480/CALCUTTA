// Run: node odds-api/stats.test.js   (no network, no database: Supabase, ESPN, sign-in and Claude are in-memory fakes)
const assert = require('assert'), http = require('http');
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_KEY = 'x';
const S = require('./stats'), D = S._deps, G = require('./groups'), GD = G._deps, R = require('./ratings'), V = require('./voicelog'), VD = V._deps, SYNC = require('./sync');
let db = {};
const FDB = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
  dbIds: async () => Object.keys(db).filter((k) => !k.startsWith('lock:')),
};
const SID = { ann: 'a1a1a1a1' + 'a'.repeat(56), bob: 'b2b2b2b2' + 'b'.repeat(56), cat: 'c3c3c3c3' + 'c'.repeat(56) };
const pe = (id) => 'pe' + id.slice(0, 18) + '@phone.oddable';
const NAMES = { a1a1a1a1: 'AnnAce', b2b2b2b2: 'BobBirdie', c3c3c3c3: 'CatCourt' };
const who = (req) => { const w = String(req.headers['x-token'] || '').replace(/^t-/, ''); return SID[w] ? pe(SID[w]) : w === 'owner' ? 'owner' : null; };
const ACCT = { who, phoneEmail: pe, isOwnerPhone: () => false, namesGet: async () => NAMES, ownerName: () => 'Sir Oddable', ownerOk: (req) => who(req) === 'owner', check: async (req) => !!who(req) };
D.S = FDB; D.acct = () => ACCT; GD.S = FDB; GD.acct = () => ACCT; VD.acct = () => ACCT;
const Z = (s) => Date.parse(s); let NOW = Z('2026-11-10T18:00:00Z'); D.now = GD.now = VD.now = () => NOW; D.ip = GD.ip = VD.ip = (req) => String(req.headers['x-ip'] || '1.1.1.1');
const KICK = { 601: Z('2026-11-15T18:00:00Z'), 602: Z('2026-11-16T19:00:00Z') };
GD.fetch = async (u) => ({ ok: true, json: async () => ({ events: /college/.test(u) ? [] : Object.keys(KICK).map((id) => ({ id, date: new Date(KICK[id]).toISOString() })) }) });
const realFetch = global.fetch;
global.fetch = async (u, o) => { if (String(u).startsWith('https://fake.supabase.co')) { const rows = Object.values(db).map((r) => ({ id: r.id, updated: r.updated, data: r.data })); return { ok: true, json: async () => rows }; } return realFetch(u, o); };
const srv = http.createServer(async (req, res) => { if (await S.handle(req, res)) return; if (await G.handle(req, res)) return; if (await V.handle(req, res)) return; res.statusCode = 404; res.end('{}'); });
let P, raw = [];
const call = async (w, path, b, ip) => { const r = await fetch('http://127.0.0.1:' + P + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-token': w ? 't-' + w : '', 'x-ip': ip || '9.9.9.9' }, body: JSON.stringify(b || {}) }); const t = await r.text(); raw.push(t); return { s: r.status, j: JSON.parse(t) }; };
const ok = (r, m) => assert.strictEqual(r.s, 200, (m || '') + ' -> ' + r.s + ' ' + JSON.stringify(r.j));
let pass = 0; const t = (m) => { pass++; console.log('  ok', m); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, m + ': ' + a + ' vs ' + b);
const row = (sid, data) => { db[sid] = { id: sid, salt: 's', pinhash: 'h', data, updated: 1 }; };

srv.listen(0, async () => {
  P = srv.address().port; let r;
  try {
    // ---------- contract validation ----------
    const good = { src: 'golf', id: 'r1', date: '2026-11-14', sport: 'golf', kind: 'golf-round', title: 'Pebble', result: null, score: 84, toPar: 12, verified: true, place: { n: 2, of: 9 }, extra: { holes: 18 } };
    assert.ok(S.validate(good, 'golf').ok);
    const badC = [['src', { src: 'nope' }], ['src vs provider', { src: 'bets' }], ['date', { date: '2026-13-01' }], ['date fmt', { date: '11/14/2026' }], ['sport', { sport: 'curling' }], ['kind', { kind: 'round' }], ['result', { result: 'X' }], ['verified', { verified: 'yes' }], ['place', { place: { n: 3, of: 2 } }], ['number', { pl: 'abc' }], ['extra', { extra: { x: 'y'.repeat(5000) } }], ['id', { id: '' }]];
    badC.forEach(([m, o]) => assert.ok(!S.validate(Object.assign({}, good, o), 'golf').ok, 'refused: ' + m));
    const cl = S.validate(Object.assign({}, good, { title: '<script>x</script>Pebble', id: 'a<b>' }), 'golf').rec; assert.ok(!/[<>]/.test(cl.title + cl.id));
    t('contract: valid record accepted; ' + badC.length + ' malformed ones refused; HTML stripped from title/id');

    // ---------- My Bets provider + hand math ----------
    row(SID.ann, { bets: [
      { id: 'b1794600000001', day: '2026-11-14', side: 'DAL', home: 'DAL', away: 'NYG', type: 'sp', line: -3, stake: 110, odds: -110, fin: 'won', finPL: 100 },
      { id: 'b1794600000002', day: '2026-11-14', side: 'UGA', home: 'UGA', away: 'BAMA', type: 'ml', stake: 50, odds: 150, fin: 'lost', finPL: -50 },
      { id: 'b1794600000003', day: '2026-11-13', side: 'KC', home: 'KC', away: 'BUF', type: 'ml', stake: 40, odds: -120, fin: 'push', finPL: 0 },
      { id: 'k1', src: 'kalshi', kt: 'KXNBAGAME-26NOV13LALBOS-LAL', kind: 'prop', text: 'Lakers to win', stake: 30, cash: 45, fin: 'won', finPL: 15, day: '2026-11-13' },
      { id: 'b1794600000005', day: '2026-11-15', kind: 'parlay', stake: 20, mult: 3, legs: [{ home: 'DAL', away: 'NYG' }, { home: 'UGA', away: 'BAMA' }], fin: 'won', finPL: 40 },
      { id: 'b1794600000006', day: '2026-11-16', gid: '602', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 25, odds: -110 },
      { id: 'b1794600000007', t: 5 },
    ], log: { '2026-11-09': { n: 3, w: 2, l: 1, p: 0, risk: 300, settled: 150 }, '2026-11-14': { n: 2, w: 1, l: 1, p: 0, risk: 160, settled: 50 } } });
    row(SID.bob, { bets: [] }); row(SID.cat, { bets: [] });
    NOW = Z('2026-11-16T05:30:00Z'); // Sunday Nov 15, 11:30 PM Central
    r = await call('ann', '/stats/me'); ok(r, 'me');
    const recs = r.j.records, bets = recs.filter((x) => x.src === 'bets');
    assert.strictEqual(bets.find((x) => x.id === 'b:b1794600000001').sport, 'nfl'); assert.strictEqual(bets.find((x) => x.id === 'b:b1794600000002').sport, 'cfb');
    assert.strictEqual(bets.find((x) => x.id === 'b:k1').sport, 'nba'); assert.strictEqual(bets.find((x) => x.id === 'b:k1').verified, true); assert.strictEqual(bets.find((x) => x.id === 'b:k1').pl, 15);
    assert.strictEqual(bets.find((x) => x.id === 'b:b1794600000005').sport, 'other', 'NFL + college parlay = other');
    assert.ok(!bets.some((x) => x.id === 'b:b1794600000007'), 'empty record skipped');
    const adj = bets.find((x) => x.id === 'log:2026-11-09'); assert.deepStrictEqual(adj.extra.adj, { w: 2, l: 1, p: 0 }); assert.strictEqual(adj.pl, 150);
    assert.ok(!bets.some((x) => x.id === 'log:2026-11-14'), 'bets win the tie on Nov 14');
    const L = r.j.periods.all.tot; // W: 100, 15 (kalshi), 40 + log 2 ; L: -50 + log 1 ; P: 1 ; open 1 (602) + 0
    assert.deepStrictEqual([L.w, L.l, L.p, L.open], [5, 2, 1, 1]); near(L.pl, 100 - 50 + 0 + 15 + 40 + 150, 'P/L'); near(L.staked, 110 + 50 + 40 + 30 + 20 + 300, 'staked');
    near(L.roi, Math.round((255 / 550) * 1000) / 10, 'ROI'); near(L.pct, Math.round(5 / 7 * 1000) / 10, 'win %');
    near(L.units, Math.round((100 / 110 - 1 + 0 + 15 / 30 + 40 / 20) * 100) / 100, 'units');
    assert.strictEqual(L.best.pl, 100); assert.strictEqual(L.worst.pl, -50);
    t('My Bets provider: sport (NFL / college / NBA ticker / mixed parlay = other), Kalshi verified + cash P/L, W-L-P, P/L, staked, ROI, win %, units, best/worst vs hand math');
    // owner-dashboard equality (deleted bets still count): totals = sync.js adminUsers
    const au = (await SYNC.adminUsers(null)).find((u) => u.id === SID.ann.slice(0, 20));
    assert.deepStrictEqual([L.w, L.l, L.p], [au.w, au.l, au.p], 'W-L-P equals the owner dashboard'); near(L.pl, au.pl, 'P/L equals the owner dashboard');
    t('deleted bets: per-day log rule gives the same lifetime W-L-P and P/L as the owner dashboard (adminUsers ' + au.w + '-' + au.l + '-' + au.p + ', $' + au.pl + ')');
    // streaks: by date: 11-09 log adj (skipped), 11-13 push(skip) + kalshi W, 11-14 W + L, 11-15 W
    near(L.longW, 2, 'longest W (11-13 Kalshi W, 11-14 DAL W)'); near(L.longL, 1, 'longest L'); assert.ok(/^W1$/.test(L.streak), 'current streak ' + L.streak);
    // periods (Central): today 2026-11-15, WTD from Mon 2026-11-09
    assert.strictEqual(r.j.today, '2026-11-15'); assert.deepStrictEqual(r.j.from, { wtd: '2026-11-09', mtd: '2026-11-01', ytd: '2026-01-01', all: '' });
    assert.strictEqual(S.periodFrom('wtd', '2026-11-09'), '2026-11-09'); assert.strictEqual(S.periodFrom('wtd', '2026-11-08'), '2026-11-02'); assert.strictEqual(S.chiDay(Z('2026-11-16T05:59:00Z')), '2026-11-15'); assert.strictEqual(S.chiDay(Z('2026-11-16T06:00:00Z')), '2026-11-16');
    const T = S.periods([{ date: '2026-11-08', result: 'W', kind: 'bet', sport: 'nfl', pl: 1, stake: 1 }, { date: '2026-11-09', result: 'L', kind: 'bet', sport: 'nfl', pl: -1, stake: 1 }, { date: '2026-10-31', result: 'W', kind: 'bet', sport: 'nba', pl: 2, stake: 1 }, { date: '2025-12-31', result: 'W', kind: 'bet', sport: 'nba', pl: 3, stake: 1 }].map((x, i) => Object.assign({ id: 'x' + i, src: 'bets' }, x)), '2026-11-15').periods;
    assert.deepStrictEqual([T.wtd.tot.w, T.wtd.tot.l, T.mtd.tot.w, T.ytd.tot.w, T.all.tot.w], [0, 1, 1, 2, 3]); assert.strictEqual(T.all.bySport.nba.tot.pl, 5); assert.strictEqual(T.all.bySport.nfl.byKind.bet.tot.n, 2);
    t('period filters in Central time (WTD from Monday, 11:59 PM CT still Sunday), by sport and sport -> kind');

    // ---------- missing / failing providers ----------
    assert.strictEqual(r.j.sources.calcutta, false); assert.deepStrictEqual(r.j.errors, []);
    S.register('golf', () => { throw new Error('boom'); }); S.register('events', async () => [{ src: 'events', id: 'e1' }, { src: 'calcutta', id: 'x', date: '2026-11-01', sport: 'nfl', kind: 'calcutta', title: 'spoof', result: null, verified: true }]);
    S.register('calcutta', async () => [
      { src: 'calcutta', id: 'c1', date: '2026-09-01', sport: 'nfl', kind: 'calcutta', title: 'KC', result: null, spent: 100, won: 250, verified: true },
      { src: 'calcutta', id: 'c2', date: '2026-09-01', sport: 'nfl', kind: 'calcutta', title: 'NYJ', result: null, spent: 60, won: 0, verified: true }]);
    r = await call('ann', '/stats/me'); ok(r); assert.deepStrictEqual(r.j.errors, ['golf']); assert.ok(!r.j.records.some((x) => x.src === 'events' || x.title === 'spoof'), 'invalid / spoofed records dropped');
    const C = r.j.periods.all.calcutta; assert.deepStrictEqual([C.teams, C.spent, C.won, C.net, C.roi, C.best.title], [2, 160, 250, 90, 56.3, 'KC']);
    t('missing providers harmless; a throwing provider is named in errors and skipped; invalid or spoofed-src records dropped; Calcutta spent/won/net/ROI/best buy');
    S.register('golf', async () => []); S.register('events', async () => []);

    // ---------- WHS math (Oddable handicap, unofficial) ----------
    assert.strictEqual(R.indexFrom([15.3, 15.2, 16.6]).index, 13.2, 'source 5.2a/1');
    assert.strictEqual(R.indexFrom([40.7, 42.4, 36.1]).index, 34.1, 'source 5.2a/2 (3 scores)');
    assert.strictEqual(R.indexFrom([40.7, 42.4, 36.1, 40.7, 44.0, 41.0]).index, Math.round((36.1 + 40.7) / 2 * 10 - 10) / 10, '6 scores: lowest 2 minus 1');
    assert.strictEqual(R.indexFrom([38.0, 38.8, 40, 41, 42, 43]).index, 37.4, 'source 5.2a/2 (six scores, avg 38.4 -> 37.4)');
    assert.strictEqual(R.indexFrom([20, 18, 25, 19]).index, 17.0, '4 scores: lowest 1 minus 1'); assert.strictEqual(R.indexFrom([20, 18, 25, 19, 22]).index, 18.0, '5 scores: lowest 1');
    assert.strictEqual(R.indexFrom([20, 18, 25, 19, 22, 30, 31, 17.5]).index, 17.8, '8 scores: average of lowest 2 (17.5, 18) = 17.75 -> 17.8');
    const d20 = [10.1, 12.3, 9.8, 15.0, 11.1, 8.7, 13.3, 14.2, 9.9, 10.5, 16.0, 12.0, 11.7, 9.4, 13.9, 10.0, 18.2, 12.8, 11.0, 9.6];
    const low8 = d20.slice().sort((a, b) => a - b).slice(0, 8); assert.strictEqual(R.indexFrom(d20).index, Math.round(low8.reduce((a, b) => a + b, 0) / 8 * 10) / 10, '20 scores: lowest 8');
    assert.strictEqual(R.indexFrom(d20.concat([0, 0])).index, R.indexFrom(d20).index, 'only the most recent 20 count (older ones at the end are ignored)');
    assert.strictEqual(R.indexFrom([1, 2]), null, 'fewer than 3 scores: no index'); assert.strictEqual(R.indexFrom([60, 61, 62, 63, 64]).index, 54, 'max 54.0');
    assert.strictEqual(R.differential(85, 71.3, 125), 12.4, '(113/125) x 13.7 = 12.38 -> 12.4'); assert.strictEqual(R.differential(95, 72.0, 113), 23.0); assert.strictEqual(R.round1(-1.55), -1.5, 'negative rounds toward zero'); assert.strictEqual(R.round1(12.35), 12.4, '.5 up');
    assert.strictEqual(R.courseHandicap(12.4, 125, 71.3, 72), 13, '12.4 x 125/113 - 0.7 = 13.02 -> 13'); assert.strictEqual(R.courseHandicap(20.0, 130, 72.5, 72), 24, '23.01 + 0.5 = 23.5 -> 24 (.5 up)');
    assert.strictEqual(R.strokesOnHole(13, 5), 1); assert.strictEqual(R.strokesOnHole(13, 14), 0); assert.strictEqual(R.strokesOnHole(20, 2), 2); assert.strictEqual(R.strokesOnHole(20, 3), 1); assert.strictEqual(R.strokesOnHole(-3, 16), -1); assert.strictEqual(R.strokesOnHole(-3, 15), 0);
    const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5], si = [5, 11, 17, 1, 13, 7, 15, 3, 9, 6, 12, 18, 2, 14, 8, 16, 4, 10], st = pars.map((p) => p + 1); st[0] = 9; st[2] = 9;
    const ndb = R.adjustedGross({ strokes: st, pars, si, total: st.reduce((a, b) => a + b, 0) }, 13); assert.strictEqual(ndb.how, 'ndb'); assert.strictEqual(ndb.ags, st.reduce((a, b) => a + b, 0) - (9 - 7) - (9 - 5), 'hole 1 (par 4, SI 5) capped at 7; hole 3 (par 3, SI 17) at 5');
    const p5 = R.adjustedGross({ strokes: st, pars, total: 0 }, null); assert.strictEqual(p5.how, 'par+5');
    assert.strictEqual(p5.ags, st.reduce((a, b) => a + b, 0) - 1, 'no index: par 3 hole capped at 8');
    assert.strictEqual(R.adjustedGross({ total: 88 }, 13).how, 'as-entered');
    t('WHS: source examples (3 and 6 scores), 4/5/8/20-score rows, max 54, differential + rounding, course handicap, net double bogey with stroke index, par+5 before an index, plus handicaps');

    // ---------- Elo (Oddable rating, unofficial) ----------
    near(R.eloDelta([1500], [1500], 1), 16, 'even singles win'); near(R.eloDelta([1600, 1400], [1500, 1500], 1), 16, 'doubles uses team average');
    near(R.eloDelta([1700, 1500], [1500, 1500], 0), -32 * (1 / (1 + Math.pow(10, -100 / 400))), 'favorite loses');
    const ef = R.eloFor([{ date: '2026-11-01', result: 'W', extra: {} }, { date: '2026-11-02', result: 'L', extra: {} }]); assert.strictEqual(ef.history[0].rating, 1516); assert.strictEqual(ef.rating, Math.round(1516 - 32 * (1 / (1 + Math.pow(10, -16 / 400)))));
    t('Elo: K 32 / start 1500, singles, doubles team average, sequence');

    // ---------- self-logging CRUD + ownership ----------
    const today = '2026-11-15';
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: '2026-11-16', course: 'X', total: 80 } }); assert.strictEqual(r.s, 400, 'future date');
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: today, course: '', total: 80 } }); assert.strictEqual(r.s, 400, 'course');
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: today, course: 'Pebble', total: 80, strokes: Array(18).fill(4) } }); assert.strictEqual(r.s, 400, 'total mismatch'); assert.ok(/does not match/.test(r.j.error));
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: today, course: 'Pebble', total: 80, cr: 72 } }); assert.strictEqual(r.s, 400, 'rating without slope');
    const rounds = [['2026-10-01', 92], ['2026-10-08', 88], ['2026-10-15', 95]]; const ids = [];
    for (const [d, s] of rounds) { r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: d, course: 'Cedar <b>Ridge</b>', tees: 'Blue', total: s, par: 72, cr: 71.3, slope: 125 } }); ok(r, 'golf'); ids.push(r.j.record.id); assert.ok(!/[<>]/.test(r.j.record.title)); }
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: '2026-10-20', course: 'Muni', total: 45, holes: 9, par: 36 } }); ok(r);
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: '2026-10-21', course: 'Charity', total: 64, format: 'scramble', team: 'Team Ann', mates: ['Bo', 'Cy'], cr: 71.3, slope: 125 } }); ok(r); assert.strictEqual(r.j.record.extra.format, 'scramble');
    r = await call('ann', '/stats/self/save', { item: { type: 'pickleball', date: today, fmt: 'doubles', partner: 'Pat', opp: ['Ola', 'Oz'], games: [[11, 7], [9, 11], [11, 5]], event: 'Tuesday ladder' } }); ok(r); const pk = r.j.record; assert.strictEqual(pk.result, 'W'); assert.strictEqual(pk.extra.scoreText, '11-7, 9-11, 11-5');
    r = await call('ann', '/stats/self/save', { item: { type: 'other', date: today, sport: 'other', result: 'solo', score: '142', title: 'Bowling practice' } }); ok(r); const solo = r.j.record; assert.strictEqual(solo.result, null); assert.strictEqual(solo.extra.solo, true);
    r = await call('ann', '/stats/self/save', { id: pk.id, item: { type: 'pickleball', date: today, fmt: 'doubles', partner: 'Pat', opp: ['Ola', 'Oz'], games: [[11, 7], [11, 9]] } }); ok(r, 'edit'); assert.strictEqual(r.j.record.id, pk.id);
    r = await call('bob', '/stats/self/delete', { id: pk.id }); assert.strictEqual(r.s, 404, 'another player cannot delete it');
    r = await call('bob', '/stats/self/save', { id: pk.id, item: { type: 'other', date: today, sport: 'nfl', result: 'W' } }); assert.strictEqual(r.s, 404, 'nor edit it');
    r = await call('bob', '/stats/me'); ok(r); assert.ok(!r.j.records.some((x) => x.src === 'self'), 'bob sees none of ann\'s entries');
    r = await call(null, '/stats/me'); assert.strictEqual(r.s, 401);
    r = await call('ann', '/stats/me'); ok(r);
    const me = r.j, gA = me.periods.all.bySport.golf.golf, H = me.golfHcp;
    assert.strictEqual(gA.rounds, 4, 'scramble left out of scoring'); assert.strictEqual(gA.teamRounds, 1); assert.strictEqual(gA.avg, Math.round((92 + 88 + 95) / 3 * 10) / 10); assert.strictEqual(gA.best.score, 88);
    const diffs = [92, 88, 95].map((s) => R.differential(s, 71.3, 125)); assert.strictEqual(H.index, Math.round((Math.min(...diffs) - 2) * 10) / 10, '3 rounds: lowest minus 2'); assert.strictEqual(H.rounds, 3); assert.strictEqual(H.flagged, 3); assert.strictEqual(H.label, 'Oddable handicap (unofficial)'); assert.strictEqual(H.team, 1); assert.strictEqual(H.nine, 1);
    const pb = me.periods.all.bySport.pickleball.local; assert.deepStrictEqual([pb.matches, pb.w, pb.gw, pb.gl, pb.gamePct, pb.pointDiff], [1, 1, 2, 0, 100, 6]);
    assert.strictEqual(me.ratings.pickleball.rating, 1516); assert.strictEqual(me.ratings.pickleball.label, 'Oddable rating (unofficial)');
    const oth = me.periods.all.bySport.other.byKind.match.tot; assert.strictEqual(oth.solo, 1); assert.strictEqual(oth.open, 0);
    r = await call('ann', '/stats/self/delete', { id: solo.id }); ok(r); r = await call('ann', '/stats/me'); assert.ok(!r.j.records.some((x) => x.id === solo.id));
    t('self-logging: validation, golf (9/18, scramble kept out of scoring + handicap), pickleball doubles (game %, point diff, Elo 1516), solo game counted as played not open; edit/delete own only; signed-out refused');
    r = await call('ann', '/stats/dupr', { dupr: 4.25 }); ok(r); r = await call('ann', '/stats/dupr', { dupr: 12 }); assert.strictEqual(r.s, 400); r = await call('ann', '/stats/me'); assert.strictEqual(r.j.dupr, 4.25);
    t('DUPR typed for display only (range checked)');

    // ---------- guest players + claim ----------
    r = await call('ann', '/stats/guest/create', { name: 'Gary <i>Guest</i>' }); ok(r); const gst = r.j.guest; assert.ok(/^[a-z0-9]{12}\.[\w-]{20,}$/.test(gst.code)); assert.ok(!/[<>]/.test(gst.name));
    r = await call('ann', '/stats/self/save', { myName: 'AnnAce', item: { type: 'pickleball', date: today, fmt: 'singles', opp: ['ignored'], oppGuest: [gst.gid], games: [[11, 4]] } }); ok(r); const m1 = r.j.record; assert.strictEqual(m1.opponent, gst.name, 'guest slot uses the guest record, not the typed name');
    r = await call('ann', '/stats/self/save', { item: { type: 'golf', date: today, course: 'Muni', total: 99, guest: gst.gid } }); ok(r, 'guest golf round'); assert.strictEqual(r.j.guest, gst.gid);
    r = await call('bob', '/stats/self/save', { item: { type: 'golf', date: today, course: 'Muni', total: 99, guest: gst.gid } }); assert.strictEqual(r.s, 404, 'not bob\'s guest');
    r = await call('ann', '/stats/guest/get', { gid: gst.gid }); ok(r); assert.strictEqual(r.j.guest.n, 2); const mir = r.j.guest.items.find((x) => x.kind === 'match'); assert.strictEqual(mir.result, 'L'); assert.deepStrictEqual(mir.extra.games, [[4, 11]]); assert.strictEqual(mir.opponent, 'AnnAce');
    r = await call('bob', '/stats/guest/get', { gid: gst.gid }); assert.strictEqual(r.s, 404, 'bob cannot read ann\'s guest');
    r = await call('cat', '/stats/guest/claim', { code: gst.gid + '.' + 'A'.repeat(24) }); assert.strictEqual(r.s, 403, 'wrong token refused');
    r = await call('cat', '/stats/guest/claim', { code: 'zzzzzzzzzzzz.' + gst.code.split('.')[1] }); assert.strictEqual(r.s, 403, 'wrong guest id refused');
    r = await call('ann', '/stats/guest/claim', { code: gst.code }); assert.strictEqual(r.s, 400, 'organizer cannot claim own guest');
    r = await call('cat', '/stats/guest/claim', { code: gst.code }); ok(r, 'claim'); assert.strictEqual(r.j.n, 2);
    r = await call('bob', '/stats/guest/claim', { code: gst.code }); assert.strictEqual(r.s, 409, 'second claimant refused');
    r = await call('cat', '/stats/me'); ok(r); const cr = r.j.records.filter((x) => x.src === 'self'); assert.strictEqual(cr.length, 2); assert.strictEqual(cr.find((x) => x.kind === 'match').result, 'L'); assert.strictEqual(r.j.periods.all.bySport.golf.golf.rounds, 1);
    r = await call('ann', '/stats/self/save', { myName: 'AnnAce', item: { type: 'pickleball', date: '2026-11-14', fmt: 'singles', opp: [''], oppGuest: [gst.gid], games: [[5, 11]] } }); ok(r); const m2 = r.j.record;
    r = await call('cat', '/stats/me'); assert.strictEqual(r.j.records.filter((x) => x.kind === 'match').length, 2, 'later results reach the claimed account'); assert.strictEqual(r.j.records.find((x) => x.date === '2026-11-14' && x.kind === 'match').result, 'W');
    r = await call('ann', '/stats/self/delete', { id: m2.id }); ok(r); r = await call('cat', '/stats/me'); assert.strictEqual(r.j.records.filter((x) => x.kind === 'match').length, 1, 'organizer delete removes the mirror');
    r = await call('ann', '/stats/self/save', { id: m1.id, myName: 'AnnAce', item: { type: 'pickleball', date: today, fmt: 'singles', opp: ['Someone'], games: [[11, 4]] } }); ok(r); r = await call('ann', '/stats/guest/get', { gid: gst.gid }); assert.strictEqual(r.j.guest.items.filter((x) => x.kind === 'match').length, 0, 'edit that drops the guest removes the mirror');
    for (let i = 0; i < 10; i++) await call('bob', '/stats/guest/claim', { code: gst.gid + '.' + 'B'.repeat(24) }, '7.7.7.7'); r = await call('bob', '/stats/guest/claim', { code: gst.code }, '7.7.7.7'); assert.strictEqual(r.s, 429, '10 wrong links -> wait');
    t('guest players: results kept for people without an account; claim link only (wrong token / wrong id refused, organizer cannot claim, one claimant, 10 wrong -> 429); mirrors follow edits and deletes; never matched by name');

    // ---------- groups: contest record, privacy, share switch, survival ----------
    S._reset(); G._reset(); NOW = Z('2026-11-10T18:00:00Z');
    const base = { name: 'Sunday Crew', sport: 'nfl', fmt: 'standings', start: Z('2026-11-12T18:00:00Z'), runs: 'w1', verified: false, types: { sp: true, ml: true, ou: true, prop: false, parlay: true }, legs: 3, metric: 'win', minBets: 0, cap: 0, entry: 0, split: 'none', take: { kind: 'none', v: 0 }, join: { requests: false, open: false, max: 20, late: 'no' } };
    r = await call('ann', '/groups/create', base); ok(r); const gid = r.j.group.id, code = r.j.group.code; r = await call('bob', '/groups/join', { code }); ok(r);
    db[SID.ann].data.bets.push({ id: 'b' + (KICK[601] - 3600e3), gid: '601', day: '2026-11-15', side: 'DAL', home: 'DAL', away: 'NYG', type: 'ml', stake: 100, odds: 100, fin: 'won', finPL: 100 });
    db[SID.ann].data.bets.push({ id: 'b' + (Z('2026-11-15T20:00:00Z')), gid: '602', day: '2026-11-16', side: 'KC', home: 'KC', away: 'DEN', type: 'ml', stake: 10, odds: -110 });
    db[SID.bob].data.bets.push({ id: 'b' + (KICK[601] - 7200e3), gid: '601', day: '2026-11-15', side: 'NYG', home: 'DAL', away: 'NYG', type: 'ml', stake: 50, odds: 150, fin: 'lost', finPL: -50 });
    NOW = Z('2026-11-16T05:30:00Z'); S._reset(); G._reset();
    r = await call('ann', '/stats/me'); ok(r); const ct = r.j.records.find((x) => x.src === 'groups'); assert.deepStrictEqual([ct.place.n, ct.place.of, ct.pl, ct.extra.derived], [1, 2, 200, true], 'DAL Nov 14 (+100) and DAL Nov 15 (+100) count; the college bet and the mixed parlay do not');
    assert.strictEqual(r.j.periods.all.byKind.contest.tot.pl, 200); near(r.j.periods.all.tot.pl, 255 + 100, 'contest does not double count the bets');
    r = await call('cat', '/stats/member', { groupId: gid, pid: 'x' }); assert.strictEqual(r.s, 404, 'non-member refused');
    const gget = (await call('ann', '/groups/get', { id: gid })).j.group, annPid = gget.me, bobPid = gget.members.find((m) => m.pid !== annPid).pid;
    r = await call('cat', '/stats/member', { groupId: gid, pid: annPid }); assert.strictEqual(r.s, 404, 'non-member refused even with a real pid');
    r = await call('bob', '/stats/member', { groupId: gid, pid: annPid }); ok(r); assert.strictEqual(r.j.name, 'AnnAce'); assert.strictEqual(r.j.hidden, 2, 'the two bets on game 602 (not kicked off) are hidden'); assert.ok(!JSON.stringify(r.j).includes('DEN'), 'hidden pick never sent');
    assert.deepStrictEqual(r.j.records.map((x) => x.result).sort(), ['P', 'W', 'W']); assert.strictEqual(r.j.contest.place.n, 1); assert.strictEqual(r.j.shared, false); assert.strictEqual(r.j.lifetime, null, 'lifetime private by default');
    r = await call('ann', '/stats/member', { groupId: gid, pid: annPid }); ok(r); assert.strictEqual(r.j.hidden, 0); assert.strictEqual(r.j.records.length, 5, 'own view also shows the two open bets');
    r = await call('ann', '/stats/share', { on: true }); ok(r); r = await call('ann', '/stats/me'); assert.strictEqual(r.j.share, true);
    r = await call('bob', '/stats/member', { groupId: gid, pid: annPid }); ok(r); assert.strictEqual(r.j.shared, true); const lt = r.j.lifetime.all; assert.ok(lt.tot.w >= 5); assert.deepStrictEqual(Object.keys(lt.tot.best), ['pl'], 'no titles in shared totals'); assert.strictEqual(lt.tot.open, 0);
    assert.ok(!JSON.stringify(r.j.lifetime).includes('Cedar'), 'no course names / titles in shared lifetime');
    r = await call('ann', '/stats/share', { on: false }); ok(r); r = await call('bob', '/stats/member', { groupId: gid, pid: annPid }); assert.strictEqual(r.j.lifetime, null);
    r = await call('ann', '/stats/member', { groupId: gid, pid: bobPid }); ok(r); assert.strictEqual(r.j.records.length, 1); assert.strictEqual(r.j.records[0].result, 'L');
    t('groups: contest record (place 1 of 2, P/L) without double counting; member view group-scoped, hidden-until-kickoff, non-member 404; "Show my lifetime stats" default OFF, ON shows totals only, OFF hides again');
    // survival: the group disappears from the groups row -> the contest stays in the player's history
    delete db['lock:groups'].data.groups[gid]; S._reset(); G._reset();
    r = await call('ann', '/stats/me'); ok(r); const kept = r.j.records.find((x) => x.id === 'g:' + gid); assert.ok(kept && kept.extra.kept, 'kept after deletion'); assert.strictEqual(kept.pl, 200);
    t('lifetime results survive the group being deleted (history copy)');

    // ---------- owner aggregates ----------
    r = await call('bob', '/stats/owner'); assert.strictEqual(r.s, 403); r = await call('owner', '/stats/owner'); ok(r); const ua = r.j.users.find((u) => u.k === SID.ann.slice(0, 8)); assert.strictEqual(ua.name, 'AnnAce'); assert.ok(ua.periods.all.tot.w >= 5); assert.ok(ua.periods.all.bySport.golf);
    t('owner aggregates across players (owner token only)');

    // ---------- privacy sweep ----------
    const all = raw.join('\n'); Object.values(SID).forEach((sid) => { assert.ok(!all.includes(sid), 'sync row id leaked'); assert.ok(!all.includes(pe(sid)), 'account id leaked'); }); assert.ok(!all.includes('@phone.oddable')); assert.ok(!/"mk"|"th"|"token"|claimedBy|"by":/.test(all.replace(/"code":"[^"]*"/g, '')), 'member keys / token hashes leaked');
    t('no sync ids, account ids, member keys, token hashes in any response (claim code only to its organizer)');

    // ---------- voice: "Log my score" ----------
    let canned = ''; VD.claude = async () => canned; VD.key = () => 'k'; VD.ai = () => ({ limited: () => false });
    const ctx = { target: 'golf-hole', holes: pars.map((p, i) => ({ n: i + 1, par: p })), teams: ['Team Smith'], players: ['Ann'] };
    canned = 'Sure: {"target":"golf-hole","hole":7,"strokes":4,"team":"Team Smith","player":null}'; r = await call('ann', '/voice/parse', { text: 'bogey on 7 for team smith', ctx }); ok(r); assert.strictEqual(r.j.confirm, 'Hole 7: 4 strokes (bogey) for Team Smith'); assert.strictEqual(r.j.parsed.strokes, 4);
    canned = '{"target":"golf-hole","hole":19,"strokes":4}'; r = await call('ann', '/voice/parse', { text: 'x on 19', ctx }); assert.strictEqual(r.s, 422); assert.ok(r.j.ask);
    canned = '{"target":"golf-hole","hole":3,"strokes":22}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 422);
    canned = '{"target":"golf-hole","hole":3,"strokes":3,"player":"Zed"}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 422, 'unknown player');
    canned = '{"target":"match","games":[[11,7]]}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 422, 'target not allowed on this screen');
    canned = '{"target":"unclear","question":"Which hole?"}'; r = await call('ann', '/voice/parse', { text: 'I did good', ctx }); assert.strictEqual(r.s, 422); assert.strictEqual(r.j.error, 'Which hole?');
    canned = 'no json here'; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 422);
    const mctx = { target: 'self', today };
    canned = '{"target":"match","games":[[11,7],[9,11],[11,5]],"winner":"us","opponents":["Ola"]}'; r = await call('ann', '/voice/parse', { text: 'won 11-7 9-11 11-5 against Ola', ctx: mctx }); ok(r); assert.strictEqual(r.j.confirm, 'Won 11-7, 9-11, 11-5 vs Ola');
    canned = '{"target":"match","games":[[11,10]],"winner":"us"}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx: mctx }); assert.strictEqual(r.s, 422, '11-10 is not a finished game');
    canned = '{"target":"match","games":[[13,11],[15,13]],"winner":"us"}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx: mctx }); ok(r, 'deuce games to 11 are legal');
    canned = '{"target":"match","games":[[11,7],[11,5]],"winner":"them"}'; r = await call('ann', '/voice/parse', { text: 'some words', ctx: mctx }); assert.strictEqual(r.s, 422, 'winner contradicts scores');
    canned = '{"target":"golf-round","total":84,"holes":18,"course":"Pebble","date":null}'; r = await call('ann', '/voice/parse', { text: 'I shot 84 today at Pebble', ctx: mctx }); ok(r); assert.strictEqual(r.j.parsed.date, today);
    canned = '{"target":"self","sport":"other","result":"solo","score":"142","notes":"bowling"}'; r = await call('ann', '/voice/parse', { text: 'bowled a 142', ctx: mctx }); ok(r); assert.strictEqual(r.j.parsed.opponent, null);
    assert.ok(V.legalGame(21, 19) && V.legalGame(15, 9) && !V.legalGame(12, 9) && !V.legalGame(11, 11) && V.legalGame(11, 0));
    r = await call(null, '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 401, 'signed out');
    VD.key = () => ''; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 503); VD.key = () => 'k';
    VD.claude = () => new Promise(() => {}); VD.timeout = 80; r = await call('ann', '/voice/parse', { text: 'some words', ctx }); assert.strictEqual(r.s, 502, 'assistant timeout'); assert.ok(/too long/.test(r.j.error)); VD.timeout = 25000;
    V._reset(); VD.claude = async () => canned; for (let i = 0; i < 30; i++) await call('bob', '/voice/parse', { text: 'some words', ctx: mctx }); r = await call('bob', '/voice/parse', { text: 'some words', ctx: mctx }); assert.strictEqual(r.s, 429, '31st call in an hour refused');
    VD.ai = () => ({ limited: () => true }); r = await call('cat', '/voice/parse', { text: 'some words', ctx: mctx }); assert.strictEqual(r.s, 429, 'shared ai.js hourly IP limit');
    t('voice: canned Claude answers validated against the screen (hole exists, strokes 1-15, known player, legal game scores, winner matches); unclear / non-JSON -> question back; timeout -> 502; 401 signed out, 503 no key, per-account and ai.js limits');

    console.log('\nPASS ' + pass + ' groups of checks');
  } catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  srv.close(); setTimeout(() => process.exit(process.exitCode || 0), 50);
});
