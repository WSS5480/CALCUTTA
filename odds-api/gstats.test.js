// Run: node odds-api/gstats.test.js   (no network: Supabase and My Apps are in-memory fakes behind global fetch)
// v274 Groups lifetime stats (POST /groups/stats). Part A = the counting rules (pure). Part B = the route through the REAL acct.js, sync.js, groups.js,
// golfday.js and gstats.js wired like server.js: the switches, an ended account, "groups BOTH people are in", every stat rule on seeded finished contests
// and real closed Golf days, and the privacy rule (no synced bets row is ever read; nothing private in any answer).
const assert = require('assert'), http = require('http');
Object.assign(process.env, { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_KEY: 'k', MYAPPS_URL: 'https://fake.myapps', MYAPPS_SECRET: 's3cret', OWNER_PIN: '4321', OWNER_PHONE: '(956) 555-0001', OWNER_NAME: 'Steve' });
['GROUPS_ENABLED', 'GROUPS_OWNER_ONLY', 'GROUPS_TESTERS', 'GATE_OFF', 'GATE_KEY', 'EVENTS_ENABLED'].forEach((k) => delete process.env[k]);
const ENDED = new Set(), J = (x) => JSON.stringify(x), DB = {}, real = global.fetch, READS = [], dbCalls = { n: 0 };
global.fetch = async (url, opt) => {
  url = String(url); opt = opt || {}; if (url.startsWith('http://127.0.0.1:')) return real(url, opt);
  const ok = (j, s) => ({ ok: true, status: s || 200, json: async () => JSON.parse(J(j)), text: async () => J(j) });
  if (url.startsWith('https://fake.myapps/')) { const p = new URL(url).pathname, b = JSON.parse(opt.body || '{}'); if (p === '/api/v1/account') return ok(Object.assign({ email: b.email, role: 'user', plan: 'pro', expires_on: null }, ENDED.has(b.email) ? { expires_on: '2026-01-01' } : {})); return ok({ ok: true }); }
  if (url.startsWith('https://site.api.espn.com/')) return ok({ events: [] });
  if (!url.startsWith('https://fake.supabase.co/rest/v1/oddable_sync')) throw new Error('unexpected outside call: ' + url);
  dbCalls.n++;
  const q = new URL(url).searchParams, m = (opt.method || 'GET').toUpperCase(), eq = (k) => { const v = q.get(k); return v && v.startsWith('eq.') ? v.slice(3) : null; };
  if (m === 'GET') { const id = eq('id'); READS.push(id || '*'); if (id) return ok(DB[id] ? [DB[id]] : []); let rows = Object.values(DB); if (q.get('id') === 'not.like.lock:*') rows = rows.filter((r) => !String(r.id).startsWith('lock:')); return ok(q.get('select') === 'id' ? rows.map((r) => ({ id: r.id })) : rows); }
  if (m === 'POST') { const row = JSON.parse(opt.body), ign = /ignore-duplicates/.test((opt.headers || {}).Prefer || ''); if (DB[row.id] && ign) return ok([], 201); DB[row.id] = Object.assign({}, DB[row.id] || {}, row); return ok([], 201); }
  if (m === 'PATCH') { const id = eq('id'), was = eq('updated'); if (!DB[id] || (was != null && Number(DB[id].updated) !== Number(was))) return ok([]); Object.assign(DB[id], JSON.parse(opt.body)); return ok([DB[id]]); }
  throw new Error('fake db: ' + m);
};
const ACCT = require('./acct'), SYNC = require('./sync'), G = require('./groups'), LIM = require('./limits'), GD = require('./golfday'), GS = require('./gstats'), GR = require('./grade');
let n = 0, GCLOCK = 0, DCLOCK = 0; const t = (name) => { n++; console.log('  PASS ' + n + ' ' + name); };
G._deps.now = () => Date.now() + GCLOCK; GD._deps.now = () => Date.now() + DCLOCK;

// =================== A. the counting rules (pure) ===================
{
  const g = { name: 'Crew' }, c = { name: 'Picks', startDay: '2026-11-19', endDay: '2026-11-25', rules: { metric: 'units' } };
  const row = (pid, place, tied, w, l, p, units, settled, none, open) => ({ pid, place, tied, none: !!none, t: { w, l, p, units, settled, open: open || 0 } });
  const s = { rows: [row('AAAAAA', 1, true, 2, 1, 0, 0.82, 3), row('BBBBBB', 1, true, 2, 1, 0, 0.82, 3), row('CCCCCC', 3, false, 0, 1, 0, -1, 1), row('DDDDDD', 4, false, 0, 0, 0, 0, 0, true)] };
  let L = GS.picksLine(g, c, s, 'AAAAAA', 'NFL'); assert.deepStrictEqual([L.place, L.tied, L.of, L.w, L.l, L.p, L.units, L.sport], [1, true, 4, 2, 1, 0, 0.82, 'NFL']);
  L = GS.picksLine(g, c, s, 'DDDDDD', 'NFL'); assert.strictEqual(L.place, null, 'no settled bet = no place'); assert.strictEqual(GS.picksLine(g, c, s, 'ZZZZZZ'), null, 'not on the standings = not played');
  const a = GS.picksLine(g, c, s, 'AAAAAA'), b = Object.assign({}, GS.picksLine(g, Object.assign({}, c, { startDay: '2026-12-01', endDay: '2026-12-07' }), { rows: [row('AAAAAA', 2, false, 3, 2, 1, 1.5, 6)] }, 'AAAAAA')), d = GS.picksLine(g, c, s, 'DDDDDD');
  let S = GS.picksSum([a, b, d]); assert.deepStrictEqual([S.played, S.won, S.shared, S.w, S.l, S.p, S.units, S.since], [3, 1, 1, 5, 3, 1, 2.32, 'Nov 2026']); assert.deepStrictEqual([S.best.place, S.best.tied, S.best.of], [1, true, 4]);
  assert.deepStrictEqual(S.list.map((x) => x.end), ['2026-12-07', '2026-11-25', '2026-11-25'], 'newest first');
  S = GS.picksSum([b, d]); assert.deepStrictEqual([S.won, S.best.place], [0, 2], 'best finish = best place with a settled bet; a contest with none has no place');
  S = GS.picksSum([]); assert.deepStrictEqual([S.played, S.won, S.best, S.units, S.since], [0, 0, null, 0, '']);
  t('picks: played = on the final standings; won = place 1 with a settled bet (T1 counts, marked shared); best finish = best place with a settled bet; record and units add up; since = first contest month');
  const h = { id: 'X', name: 'Sat', course: 'Palm View', date: '2026-11-21', format: 'net', holes: 'all', short: '', closed: 1, rows: [{ pid: 'AAAAAA', place: 1, tied: false, thru: 18, of: 18, done: true, gross: 80, par: 72, net: 70, pts: 38, toPar: -2 }, { pid: 'BBBBBB', place: 2, tied: false, thru: 9, of: 18, done: false, gross: 40, par: 36, net: 35, pts: 19, toPar: -1 }, { pid: 'CCCCCC', place: 0, thru: 0, of: 18, done: false }] };
  let gl = GS.golfLine(g, h, 'AAAAAA'); assert.deepStrictEqual([gl.place, gl.of, gl.net2par, gl.pts, gl.holesName, gl.done], [1, 2, -2, null, '18 holes', true], 'net day: net to par, no Stableford points');
  gl = GS.golfLine(g, h, 'BBBBBB'); assert.deepStrictEqual([gl.net2par, gl.pts, gl.done, gl.thru], [null, null, false, 9], 'an unfinished card is played but has no best score');
  assert.strictEqual(GS.golfLine(g, h, 'CCCCCC'), null, 'joined but no hole = not played');
  const sf = Object.assign({}, h, { id: 'Y', format: 'stableford', date: '2026-11-28' }), gr = Object.assign({}, h, { id: 'Z', format: 'gross', holes: 'all', short: 'front', date: '2026-12-05', rows: [{ pid: 'AAAAAA', place: 1, tied: true, thru: 9, of: 9, done: true, gross: 38, par: 36, net: 38, pts: 16, toPar: 2 }] });
  const G1 = GS.golfSum([GS.golfLine(g, h, 'AAAAAA'), GS.golfLine(g, sf, 'AAAAAA'), GS.golfLine(g, gr, 'AAAAAA')].filter(Boolean));
  assert.deepStrictEqual([G1.played, G1.wins, G1.shared, G1.bestNet.v, G1.bestSf.v, G1.since], [3, 3, 1, -2, 38, 'Nov 2026']); assert.strictEqual(GS.golfLine(g, gr, 'AAAAAA').holesName, 'Front 9', 'a day shortened to the front 9 is listed as a 9');
  assert.strictEqual(GS.golfLine(g, gr, 'AAAAAA').net2par, 2, 'gross day: no strokes given, net = gross');
  t('golf: played = at least one counting hole on a closed day; wins = place 1 (ties shared); best net to par and best Stableford only from finished cards; Stableford only on Stableford days');
}

// =================== B. the route ===================
const srv = http.createServer(async (req, res) => {
  if (req.url.startsWith('/acct')) { if (await ACCT.handle(req, res)) return; }
  if (req.url.startsWith('/sync')) { if (await SYNC.handle(req, res)) return; }
  if (req.url.startsWith('/groups')) { if (await G.handle(req, res)) return; }
  if (req.url.startsWith('/golfday')) { if (await GD.handle(req, res)) return; }
  res.statusCode = 404; res.end('{"error":"not found"}');
});
let PORT, ipn = 0; const post = async (url, b, h) => { const r = await real('http://127.0.0.1:' + PORT + url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'x-forwarded-for': '7.7.' + (++ipn % 200) + '.1, 2.2.2.2, 3.3.3.3' }, h || {}), body: J(b || {}) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const H = (tok) => ({ 'x-token': tok });
srv.listen(0, '127.0.0.1', async () => {
  PORT = srv.address().port; let failed = 0;
  try {
    // private bets in the synced rows: they must never show up in any stat
    const priv = (k) => ({ bets: Array.from({ length: k }, (_, i) => ({ id: 'p' + i, type: 'ml', side: 'home', odds: 300, stake: 100, lg: 'nfl', gid: '9' + i, day: '2026-11-20', home: 'DAL', away: 'NYG', res: 'won', fin: 'won', finPL: 300 })) });
    const phoneIn = async (phone, pin, name) => { let x = await post('/sync/signup', { phone, pin, data: priv(12) }); assert.strictEqual(x.s, 200, J(x.j)); x = await post('/acct/phone', { phone, pin, name }); assert.strictEqual(x.s, 200, J(x.j)); return x.j; };
    const steve = await phoneIn('9565550001', '112233', 'Steve'), tess = await phoneIn('9565550002', '445566', 'Tess'), bo = await phoneIn('9565550003', '778899', 'Bo'), stranger = await phoneIn('9565550004', '991122', 'Stranger'), late = await phoneIn('9565550005', '335577', 'Late');
    const email = async (tok) => (await post('/acct/me', {}, H(tok))).j.me.email;

    // ---- 1. dark: every caller 403 off, nothing read ----
    for (const v of [undefined, '0', 'true', ' 1']) { if (v === undefined) delete process.env.GROUPS_ENABLED; else process.env.GROUPS_ENABLED = v;
      const before = dbCalls.n; for (const tok of [steve.token, tess.token, '', 'garbage']) { const r = await post('/groups/stats', { id: 'ABCDEFGH23', pid: 'AAAAAA' }, H(tok)); assert.strictEqual(r.s, 403); assert.deepStrictEqual(r.j, { error: 'Groups is not open for this account yet.', off: true }); }
      assert.strictEqual(dbCalls.n, before, 'a blocked caller reads nothing'); }
    process.env.GROUPS_ENABLED = '1'; process.env.GROUPS_OWNER_ONLY = '1';
    let r = await post('/groups/stats', {}, H(tess.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true, 'owner-only: not on the list');
    const keys = []; for (const p of [tess, bo, stranger, late]) keys.push(LIM.keyOf(await email(p.token))); process.env.GROUPS_TESTERS = keys.join(',');
    t('dark (GROUPS_ENABLED unset or not exactly "1"): /groups/stats is 403 {off:true} for everyone and reads nothing; owner-only: not on the list = 403 off');

    // ---- 2. groups and members ----
    const START = Date.now() + 2 * 864e5;
    const mkGroup = (name, runs, myName) => ({ name, join: { requests: true, open: false, auto: true, max: 8, late: 'no' }, take: { kind: 'none' }, contest: { cname: 'Picks standings', sport: 'nfl', fmt: 'standings', start: START, runs, types: { sp: true, ml: true, ou: true, prop: false, parlay: false }, legs: 4, metric: 'units', minBets: 0, maxBets: 10, minPaid: 0, cap: 0, maxOdds: 500, entry: 0, split: 'none' }, myName });
    const make = async (who, name, runs, joiners) => { const x = await post('/groups/create', mkGroup(name, runs, who[1]), H(who[0].token)); assert.strictEqual(x.s, 200, J(x.j)); for (const [p, nm] of joiners) { const y = await post('/groups/join', { code: x.j.group.code, myName: nm }, H(p.token)); assert.strictEqual(y.s, 200, J(y.j)); } const z = await post('/groups/get', { id: x.j.group.id }, H(who[0].token)); return z.j.group; };
    const G1 = await make([steve, 'Steve'], 'Sunday crew', 'w1', [[tess, 'Tess'], [bo, 'Bo'], [late, 'Late']]);
    const G2 = await make([tess, 'Tess'], 'Office', 'w1', [[steve, 'Steve']]);
    const G3 = await make([bo, 'Bo'], 'Bo and friend', 'w1', [[stranger, 'Stranger']]);
    const G4 = await make([steve, 'Steve'], 'Season long', 'season', [[tess, 'Tess']]);
    const pid = (gr, nm) => gr.members.find((m) => m.name === nm).pid;
    // seed each contest's LEDGER (the group's own graded book) with finished, server-graded bets
    let gidn = 100; const ent = (c, res, pl, stake) => { const kick = c.start + 864e5 + (gidn % 5) * 3600e3, s = { type: 'ml', side: 'home', odds: -110, stake: stake || 10, lg: 'nfl', gid: String(++gidn), day: GR.chiDay(kick), home: 'DAL', away: 'NYG' }, k = GR.legKey(s); return { f: kick - 3600e3, gl: kick - 3600e3, z: 1, s, r: { [k]: { key: k, lg: 'nfl', gid: s.gid, kick, side: 'home', kind: 'ml' } }, g: { res, pl, at: kick + 4 * 3600e3 } }; };
    const seed = (gr, bets) => { const c = gr.contests[0], b = {}; Object.keys(bets).forEach((nm) => { const p = pid(gr, nm); b[p] = {}; bets[nm].forEach((x, i) => { b[p]['b' + gidn + i] = ent(c, x[0], x[1]); }); }); DB['lock:gl:' + gr.id + ':' + c.cid] = { id: 'lock:gl:' + gr.id + ':' + c.cid, salt: 'x', pinhash: 'x', data: { b }, updated: 1 }; };
    const W = ['won', 9.09], L = ['lost', -10], P = ['push', 0], W10 = ['won', 10];
    seed(G1, { Steve: [W, W, L], Tess: [W, L, P], Bo: [L] });            // units: Steve +0.82, Tess -0.09, Bo -1; Late no bet
    seed(G2, { Tess: [W10], Steve: [W10] });                             // a tie for first: +1 each
    seed(G3, { Bo: [W], Stranger: [L] });                                // Bo wins a group Steve and Tess are not in
    seed(G4, { Steve: [W10, W10, W10], Tess: [L] });                     // NOT finished: never counted
    const lateAcct = await email(late.token);
    GCLOCK = 20 * 864e5; // three weeks on: G1, G2, G3 are over (one week); G4 runs to the end of the season

    // ---- 3. Golf days (real routes) in G1 and G2 ----
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(Date.now() + DCLOCK));
    const par = {}, si = {}; for (let h = 1; h <= 18; h++) { par[h] = 4; si[h] = h; }
    const day = async (gr, comm, o, cards) => { let x = await post('/golfday/create', Object.assign({ g: gr.id, date: today(), par, si, parOk: true }, o, { course: { id: 'way/123', name: o.course || 'Palm View Golf Course' } }), H(comm.token)); assert.strictEqual(x.s, 200, J(x.j)); const id = x.j.day.id;
      for (const [p, hcp] of cards.map((c) => [c[0], c[1]])) { x = await post('/golfday/join', { g: gr.id, id, hcp }, H(p.token)); assert.strictEqual(x.s, 200, J(x.j)); }
      for (const [p, , sc] of cards) for (const h of Object.keys(sc)) { x = await post('/golfday/score', { g: gr.id, id, hole: Number(h), strokes: sc[h] }, H(p.token)); assert.strictEqual(x.s, 200, J(x.j)); }
      x = await post('/golfday/close', { g: gr.id, id, short: o.short || '' }, H(comm.token)); assert.strictEqual(x.s, 200, J(x.j)); DCLOCK += 864e5; return x.j.day; };
    const card = (from, to, f) => { const o = {}; for (let h = from; h <= to; h++) o[h] = f(h); return o; };
    // G1 day A: net 18. Steve 80 gross, 10 strokes = net 70 (-2). Tess 68, 0 strokes = -4 -> Tess wins. Bo stops after 3 holes.
    const dA = await day(G1, steve, { format: 'net', holes: 'all', course: 'Palm View' }, [[steve, 10, card(1, 18, (h) => (h <= 8 ? 5 : 4))], [tess, 0, card(1, 18, (h) => (h <= 4 ? 3 : 4))], [bo, 5, card(1, 3, () => 6)]]);
    assert.deepStrictEqual(dA.board.map((x) => [x.name, x.place]), [['Tess', 1], ['Steve', 2], ['Bo', 3]]);
    // G1 day B: Stableford 18. Steve 18 strokes, par golf = 18 holes x 3 pts = 54. Tess 0 strokes, par golf = 36.
    await day(G1, steve, { format: 'stableford', holes: 'all', course: 'Monte Cristo' }, [[steve, 18, card(1, 18, () => 4)], [tess, 0, card(1, 18, () => 4)]]);
    // G1 day C: gross 18 shortened to the front 9; Steve and Tess tie at level par.
    await day(G1, steve, { format: 'gross', holes: 'all', course: 'Tierra del Sol', short: 'front' }, [[steve, 0, card(1, 9, () => 4)], [tess, 0, card(1, 9, () => 4)]]);
    // G2: seven gross front-9 days, Steve wins each one with -1 (more than the 5 the day list keeps)
    for (let i = 0; i < 7; i++) await day(G2, tess, { format: 'gross', holes: 'front', course: 'Course ' + i }, [[steve, 0, card(1, 9, (h) => (h === 1 ? 3 : 4))], [tess, 0, card(1, 9, () => 4)]]);
    // G3 (Bo's, Steve and Tess not in it): Bo shoots -9 on a gross 9
    await day(G3, bo, { format: 'gross', holes: 'front', course: 'Elsewhere' }, [[bo, 0, card(1, 9, () => 3)], [stranger, 0, card(1, 9, () => 5)]]);
    const row2 = DB['lock:gd:' + G2.id].data; assert.strictEqual(row2.days.filter((d) => d.closed).length, 6, 'the day list keeps 6 (the last 5 at the latest start + the one closed since)'); assert.strictEqual(row2.hist.length, 7, 'hist keeps all 7');
    assert.ok(!/@|956555|pinhash|"mk"|"sid"/.test(J(row2.hist)), 'hist holds names, member ids and numbers only');
    // a day closed BEFORE v274 has no hist entry: still counted from the kept days
    const row1 = DB['lock:gd:' + G1.id].data; row1.hist = row1.hist.filter((h) => h.id !== dA.id);
    t('closing a Golf day also keeps its compact final board in `hist` (7 of 7 kept while the day list keeps 6); hist has names, member ids and numbers only');

    // ---- 4. my own stats ----
    READS.length = 0;
    r = await post('/groups/stats', {}, H(steve.token)); assert.strictEqual(r.s, 200, J(r.j)); const S = r.j;
    assert.deepStrictEqual([S.me, S.name, S.groups], [true, 'Steve', 3]);
    assert.deepStrictEqual([S.picks.played, S.picks.won, S.picks.shared, S.picks.w, S.picks.l, S.picks.p, S.picks.units], [2, 2, 1, 3, 1, 0, 1.82], 'G1 (1st) + G2 (T1); G4 still running is not counted; private bets ignored');
    assert.deepStrictEqual([S.picks.best.place, S.picks.best.of], [1, S.picks.best.group === 'Office' ? 2 : 4]);
    assert.deepStrictEqual(S.picks.list.map((x) => [x.group, x.place, x.tied, x.of, x.w + '-' + x.l + '-' + x.p, x.units]).sort(), [['Office', 1, true, 2, '1-0-0', 1], ['Sunday crew', 1, false, 4, '2-1-0', 0.82]]);
    assert.strictEqual(S.golf.played, 10, '3 days in G1 + 7 in G2 (5 kept + 2 only in hist; the G1 day with no hist entry counted from the kept days)');
    assert.deepStrictEqual([S.golf.wins, S.golf.shared, S.golf.bestNet.v, S.golf.bestNet.holesName, S.golf.bestNet.course, S.golf.bestSf.v, S.golf.bestSf.course], [9, 1, -18, '18 holes', 'Monte Cristo', 54, 'Monte Cristo'], 'wins: 7 in G2 + the Stableford day + the shared front 9 (2nd at Palm View); best net to par: par golf with 18 strokes = -18 (net to par counts on every format)');
    assert.match(S.source.picks, /^Finished group contests since [A-Z][a-z]{2} 2026$/); assert.match(S.source.golf, /^Closed Golf days since [A-Z][a-z]{2} 202\d$/); assert.strictEqual(S.source.scope, 'Your groups: 3');
    t('my stats: finished contests only (a running one is left out), a shared first counts as a win, record and units from the group standings; Golf days from kept days and hist; sources and periods named');
    assert.ok(READS.length > 0 && READS.every((id) => String(id).startsWith('lock:')), 'stats read ONLY group rows (lock:...), never a synced bets row: ' + READS.filter((id) => !String(id).startsWith('lock:')).join(','));
    t('privacy: computing stats reads no synced bets row (only lock: group rows), so 12 private won bets per player change nothing');

    // ---- 5. another member: only groups BOTH are in ----
    r = await post('/groups/stats', { id: G1.id, pid: pid(G1, 'Bo') }, H(tess.token)); assert.strictEqual(r.s, 200, J(r.j)); let B = r.j;
    assert.deepStrictEqual([B.me, B.name, B.groups, B.source.scope], [false, 'Bo', 1, 'Groups you are both in: 1']);
    assert.deepStrictEqual([B.picks.played, B.picks.won, B.picks.best.place, B.picks.best.of, B.picks.w, B.picks.l, B.picks.units], [1, 0, 3, 4, 0, 1, -1], 'Bo\'s win in G3 is not shown to Tess (she is not in G3)');
    assert.deepStrictEqual([B.golf.played, B.golf.wins, B.golf.bestNet], [1, 0, null], 'Bo\'s unfinished card counts as played, has no best score; his G3 -9 is not shown');
    r = await post('/groups/stats', {}, H(bo.token)); B = r.j; assert.deepStrictEqual([B.groups, B.picks.played, B.picks.won, B.golf.played, B.golf.wins, B.golf.bestNet.v], [2, 2, 1, 2, 1, -9], 'Bo\'s own stats include G3');
    r = await post('/groups/stats', { id: G3.id, pid: pid(G3, 'Bo') }, H(stranger.token)); assert.deepStrictEqual([r.s, r.j.groups, r.j.picks.won, r.j.golf.bestNet.v], [200, 1, 1, -9]);
    r = await post('/groups/stats', { id: G2.id, pid: pid(G2, 'Steve') }, H(tess.token)); assert.deepStrictEqual([r.j.groups, r.j.picks.played, r.j.golf.played], [3, 2, 10], 'Tess and Steve share G1, G2, G4');
    r = await post('/groups/stats', { id: G1.id, pid: pid(G1, 'Late') }, H(steve.token)); assert.deepStrictEqual([r.j.picks.played, r.j.picks.won, r.j.picks.best], [1, 0, null], 'in the contest with no bet: played, no place');
    t('another member\'s record comes only from groups BOTH people are in now (Bo\'s own group is hidden from Tess, shown to its own member)');
    for (const [b2, tok, code] of [[{ id: G1.id, pid: pid(G3, 'Stranger') }, tess.token, 404], [{ id: G3.id, pid: pid(G3, 'Bo') }, tess.token, 404], [{ id: G1.id, pid: pid(G1, 'Bo') }, stranger.token, 404], [{ id: 'nope', pid: 'AAAAAA' }, steve.token, 404], [{ id: G1.id + '#', pid: 'x' }, steve.token, 404], [{ id: G1.id }, steve.token, 404], [{ pid: pid(G1, 'Bo') }, steve.token, 404]]) { r = await post('/groups/stats', b2, H(tok)); assert.strictEqual(r.s, code, J(b2)); }
    t('a member not in that group, a group the viewer is not in, a made-up or broken id = 404');

    // ---- 6. privacy of every answer ----
    const all = []; for (const [b2, tok] of [[{}, steve.token], [{}, tess.token], [{}, bo.token], [{ id: G1.id, pid: pid(G1, 'Steve') }, tess.token], [{ id: G1.id, pid: pid(G1, 'Tess') }, bo.token], [{ id: G3.id, pid: pid(G3, 'Bo') }, stranger.token]]) all.push((await post('/groups/stats', b2, H(tok))).j);
    const seen = J(all), accts = await Promise.all([steve, tess, bo, stranger, late].map((p) => email(p.token)));
    for (const [what, re] of [['a phone number', /956\D?555\D?000\d|9565550/], ['an account id / email', /@phone\.oddable|@/], ['a PIN', /112233|445566|778899|991122|335577|4321/], ['a sync row id', /[0-9a-f]{40}/], ['a member key', /[0-9a-f]{24}|"mk"|"sid"|pinhash|salt/], ['a group id', new RegExp([G1, G2, G3, G4].map((x) => x.id).join('|'))], ['a private bet', /"p1"|finPL|odds/]]) assert.ok(!re.test(seen), 'a stats answer holds ' + what);
    accts.forEach((a) => assert.ok(!seen.includes(a)));
    assert.ok(!/entry|payout|"pot|price|fee|paid|owed|\$/i.test(seen), 'no money word in a stats answer');
    t('no phone number, email, account id, PIN, sync row id, member key, group id, private bet or money field in any stats answer');

    // ---- 7. ended account, signed out, GET, rate limit, switch off ----
    ENDED.add(lateAcct); ACCT.uncache(lateAcct); r = await post('/groups/stats', {}, H(late.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.expired, true); assert.match(r.j.error, /^Your time has ended\./);
    delete process.env.GROUPS_OWNER_ONLY; r = await post('/groups/stats', {}, {}); assert.strictEqual(r.s, 401); r = await post('/groups/stats', {}, H('garbage')); assert.strictEqual(r.s, 401); process.env.GROUPS_OWNER_ONLY = '1';
    r = await real('http://127.0.0.1:' + PORT + '/groups/stats', { headers: H(steve.token) }); assert.strictEqual(r.status, 405);
    let lim = 0; for (let i = 0; i < 45; i++) { const x = await post('/groups/stats', {}, H(stranger.token)); if (x.s === 429) lim++; } assert.ok(lim >= 5 && lim <= 44, 'per-account limit: ' + lim);
    delete process.env.GROUPS_ENABLED; const before = dbCalls.n; r = await post('/groups/stats', {}, H(steve.token)); assert.strictEqual(r.s, 403); assert.strictEqual(r.j.off, true); assert.strictEqual(dbCalls.n, before);
    t('an ended account gets 403 "Your time has ended" (expired); signed out 401; GET 405; 40 calls / 10 min per account; switching Groups off blocks stats at once, reading nothing');
  } catch (e) { failed = 1; console.error('  FAIL after ' + n + ' passed:', e && e.stack || e); }
  srv.close(); console.log(failed ? 'gstats.test: FAILED' : 'gstats.test: all ' + n + ' passed'); setTimeout(() => process.exit(failed), 50);
});
