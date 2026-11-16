// Run: node odds-api/alert.test.js   (no network, no database: Supabase, ESPN, nflverse, the book cache and the owner check are in-memory fakes)
// What it proves: the SERVER computes the weekly picks with no phone involved; they follow the line until 30 minutes before kickoff and never move after;
// a late wake freezes with a flag; phones can no longer freeze anything; only the owner can correct a final line.
const assert = require('assert'), http = require('http'), A = require('./alert'), H = require('./helper'), D = A._deps;
// ---- fake database (returns keys in sorted order, like Postgres jsonb, so a no-change tick must still be recognised as no change) ----
let db = {}, patches = 0, failPatch = 0, dbDown = false;
const sorted = (o) => (Array.isArray(o) ? o.map(sorted) : o && typeof o === 'object' ? Object.keys(o).sort().reduce((a, k) => { a[k] = sorted(o[k]); return a; }, {}) : o);
D.S = {
  dbGet: async (id) => { if (dbDown) throw new Error('db read 500'); return db[id] ? sorted(JSON.parse(JSON.stringify(db[id]))) : null; },
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (failPatch) { failPatch--; db[id].updated += 1; return false; } if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; patches++; return true; },
};
// ---- fake ESPN / nflverse ----
const K1 = Date.parse('2026-09-18T00:15:00Z'), KS = Date.parse('2026-09-20T17:00:00Z'), KM = Date.parse('2026-09-22T00:15:00Z'), MIN = 6e4;
let NOW = K1 - 3 * 3600e3, espnDown = false, urls = [], logs = [], books = null, owner = false;
const G = (id, wk, away, home, date, st, odds, as, hs, det) => ({ id, wk, away, home, date, st: st || 'pre', odds: odds || null, as: as || 0, hs: hs || 0, det: det || '' });
let SCHED = [
  G('101', 1, 'PHI', 'DAL', '2026-09-11T00:20Z', 'post', null, 20, 24), G('102', 1, 'GB', 'CHI', '2026-09-13T17:00Z', 'post', null, 27, 10), G('103', 1, 'KC', 'DEN', '2026-09-13T20:25Z', 'post', null, 17, 20, 'Final/OT'),
  G('104', 1, 'BUF', 'MIA', '2026-09-13T17:00Z', 'post', null, 31, 14), G('105', 1, 'WSH', 'NYG', '2026-09-13T17:00Z', 'post', null, 13, 16), G('106', 1, 'LAR', 'SEA', '2026-09-13T20:05Z', 'post', null, 21, 28), G('107', 1, 'NE', 'DET', '2026-09-13T17:00Z', 'post', null, 10, 30), G('108', 1, 'LV', 'SF', '2026-09-14T00:20Z', 'post', null, 17, 23),
  G('201', 2, 'DAL', 'NYG', new Date(K1).toISOString(), 'pre', 'NYG -3'), // Thursday: division, road dog
  G('202', 2, 'CHI', 'DET', new Date(KS).toISOString(), 'pre', 'DET -6.5'), // Sunday: division, road dog
  G('203', 2, 'DEN', 'LV', new Date(KS).toISOString(), 'pre', 'DEN -2.5'), // division, but the road team is favored: never a road dog
  G('204', 2, 'MIA', 'NE', new Date(KS).toISOString(), 'pre', 'NE -1.5'), // division, road dog
  G('205', 2, 'SF', 'GB', new Date(KS).toISOString(), 'pre', 'GB -4'), // not a division game
  G('206', 2, 'SEA', 'LAR', new Date(KM).toISOString(), 'pre', null), // Monday: division, no line posted yet
];
for (let w = 3; w <= 18; w++) SCHED.push(G('9' + w, w, 'KC', 'BUF', new Date(K1 + (w - 2) * 7 * 864e5).toISOString()));
const ev = (g) => ({ id: g.id, date: g.date, status: { type: { state: g.st, shortDetail: g.det || (g.st === 'post' ? 'Final' : ''), name: g.st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: g.home }, score: String(g.hs) }, { homeAway: 'away', team: { abbreviation: g.away }, score: String(g.as) }], odds: g.odds ? [{ details: g.odds }] : [] }] });
let CSV = ['season,game_type,week,away_team,home_team,home_score,spread_line', '2026,REG,1,PHI,DAL,24,-2.5', '2026,REG,1,GB,CHI,10,-3', '2026,REG,1,KC,DEN,20,-1', '2026,REG,1,BUF,MIA,14,-6.5', '2026,REG,1,WAS,NYG,16,2.5', '2026,REG,1,LA,SEA,28,3', '2026,REG,1,NE,DET,30,7', '2026,REG,1,LV,SF,23,6.5'];
D.fetch = async (u) => {
  urls.push(u);
  if (/nflverse/.test(u)) return { ok: true, text: async () => CSV.join('\n') + '\n' };
  if (espnDown) throw new Error('down');
  if (/summary\?event=/.test(u)) { const g = SCHED.find((x) => x.id === u.split('=')[1]); return { ok: true, json: async () => ({ boxscore: { teams: [{ team: { abbreviation: g.home }, statistics: [{ name: 'yardsPerPlay', displayValue: '5.8' }, { name: 'turnovers', displayValue: '1' }] }, { team: { abbreviation: g.away }, statistics: [{ name: 'yardsPerPlay', displayValue: '5.1' }, { name: 'turnovers', displayValue: '2' }] }] } }) }; }
  const m = /week=(\d+)/.exec(u); return { ok: true, json: async () => (m ? { events: SCHED.filter((g) => g.wk === +m[1]).map(ev) } : { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [] }) };
};
D.now = () => NOW; D.peek = () => books; D.log = (m) => logs.push(m); D.ownerOk = (req) => owner && req.headers['x-token'] === 'owner-token'; D.ship = {}; D.trs = {};
const srv = http.createServer(async (req, res) => { if (!(await A.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
let P;
const call = async (method, path, bodyObj, tok) => { const r = await fetch('http://127.0.0.1:' + P + path, { method, headers: { 'content-type': 'application/json', 'x-token': tok === undefined ? 'phone-token' : tok }, body: bodyObj ? JSON.stringify(bodyObj) : undefined }); return { s: r.status, j: await r.json() }; };
const cs = (o) => JSON.stringify(sorted(o));
const stored = (w) => JSON.parse(JSON.stringify(db['lock:alert26'].data.weeks[w])), dog = (r, id) => (r.dogs || []).find((d) => d.id === id), set = (id, odds, st) => { const g = SCHED.find((x) => x.id === id); if (odds !== undefined) g.odds = odds; if (st) g.st = st; };
const step = async (ms) => { NOW += ms; await A.tick(); return stored(2); };
srv.listen(0, async () => {
  P = srv.address().port; let r, w, x;
  try {
    // --- 1. no phone: the server's own tick computes week 2 and stores it ---
    await A.tick(); assert.ok(A._state().TK.ok, 'tick ok: ' + A._state().TK.err); w = stored(2);
    assert.strictEqual(w.v, 2); assert.ok(w.lock && !w.lock.final, 'Lock is live 3 hours before the first kickoff'); assert.ok(w.helper && !w.helper.final, 'Helper is live');
    assert.deepStrictEqual(w.dogs.map((d) => d.id), ['201', '202', '204'], 'division road dogs only (203: road team favored, 205: not a division game, 206: no line yet)');
    assert.ok(w.dogs.every((d) => !d.final && d.p > 0 && d.p < 1)); assert.strictEqual(dog(w, '201').line, 3); assert.strictEqual(w.gl['201'].s, 'espn'); assert.strictEqual(w.first, K1);
    assert.strictEqual(dog(w, '201').abbr, 'DAL'); assert.strictEqual(dog(w, '201').home, 'NYG');
    // week 1 was never seen before its games: back-filled after the fact from closing lines, and flagged
    x = stored(1); assert.ok(x.lock.final && x.lock.pre === false && x.lock.late === 1, 'week 1 Lock is final and flagged after-the-fact'); assert.ok(x.dogs.length && x.dogs.every((d) => d.final && d.pre === false)); assert.strictEqual(x.gl['105'].s, 'close'); assert.strictEqual(x.gl['105'].l, 2.5, 'WSH/NYG matched to the nflverse key 1-WAS-NYG'); assert.ok(x.helper.final && x.helper.pre === false);
    assert.ok(db['lock:bx26'] && db['lock:bx26'].data.bx['101'], 'box scores for the Helper ratings are stored'); assert.deepStrictEqual(db['lock:bx26'].data.bx['101'], [5.8, 1, 5.1, 2]);
    // --- 2. nothing changed -> nothing written (even though the database hands the keys back in another order) ---
    const p0 = patches; NOW += MIN; await A.tick(); NOW += MIN; await A.tick(); assert.strictEqual(patches, p0, 'no write when nothing changed');
    // --- 3. a line move BEFORE the mark updates the pick for everyone ---
    const p201 = dog(w, '201').p, lock0 = cs(w.lock), help0 = w.helper;
    set('202', 'DET -8.5'); w = await step(6 * MIN); assert.strictEqual(dog(w, '202').line, 8.5, 'road dog follows the line'); assert.ok(!dog(w, '202').final);
    set('204', 'MIA -1'); w = await step(6 * MIN); assert.ok(!dog(w, '204'), 'line flipped: no longer a road dog while it is live');
    set('204', 'NE -2.5'); w = await step(6 * MIN); assert.strictEqual(dog(w, '204').line, 2.5, 'and back on the list when the line comes back');
    set('205', 'GB -13.5'); w = await step(6 * MIN); assert.notStrictEqual(cs({ l: w.lock, h: w.helper }), cs({ l: JSON.parse(lock0), h: help0 }), 'Lock / Helper follow the line before the mark'); assert.strictEqual(w.helper.abbr, 'GB', 'Helper = biggest win chance at the new line'); assert.ok(!w.lock.final && !w.helper.final);
    // the cached many-book consensus is preferred over ESPN while it is fresh; an old one is ignored
    books = { at: NOW - 10 * MIN, games: [{ home: 'NYG', away: 'DAL', start: new Date(K1).toISOString(), line: 3.5, n: 7 }] }; w = await step(MIN); assert.strictEqual(dog(w, '201').line, 3.5); assert.strictEqual(w.gl['201'].s, 'books'); assert.notStrictEqual(dog(w, '201').p, p201, 'model % recomputed at the new line');
    books.at = NOW - 4 * 3600e3; w = await step(MIN); assert.strictEqual(dog(w, '201').line, 3, 'stale book cache -> ESPN line'); assert.strictEqual(w.gl['201'].s, 'espn'); books = null;
    // --- 4. 31 minutes before the first kickoff: still live. 29 minutes before: Lock, Helper and the Thursday dog are final ---
    NOW = K1 - 31 * MIN; await A.tick(); w = stored(2); assert.ok(!w.lock.final && !w.helper.final && !dog(w, '201').final, 'live at 31 minutes');
    NOW = K1 - 29 * MIN; await A.tick(); w = stored(2);
    assert.ok(w.lock.final && w.lock.pre === true && !w.lock.late, 'Lock final 30 minutes before the first kickoff, on time'); assert.strictEqual(w.lock.t, NOW); assert.ok(w.helper.final && w.helper.pre === true && !w.helper.late, 'Helper final at the same mark');
    assert.ok(dog(w, '201').final && dog(w, '201').pre === true && !dog(w, '201').late, 'Thursday dog final at its own mark'); assert.ok(!dog(w, '202').final && !dog(w, '204').final, 'Sunday dogs still live');
    assert.ok(logs.some((m) => /week 2 LOCK final/.test(m)) && logs.some((m) => /week 2 HELPER final/.test(m)) && logs.some((m) => /week 2 road dog final: DAL/.test(m)), 'freezes are logged');
    const fl = cs(w.lock), fh = cs(w.helper), fd = cs(dog(w, '201'));
    // --- 5. line moves AFTER the mark change nothing that is final; parts that are still live keep following ---
    set('201', 'NYG -6.5'); set('205', 'SF -3'); set('202', 'DET -3'); w = await step(6 * MIN);
    assert.strictEqual(cs(w.lock), fl, 'Lock does not move after its mark'); assert.strictEqual(cs(w.helper), fh, 'Helper does not move after its mark'); assert.strictEqual(cs(dog(w, '201')), fd, 'Thursday dog does not move after its mark'); assert.strictEqual(dog(w, '202').line, 3, 'a Sunday dog still follows the line');
    set('201', undefined, 'in'); w = await step(60 * MIN); set('201', undefined, 'post'); SCHED.find((g) => g.id === '201').hs = 20; SCHED.find((g) => g.id === '201').as = 19; w = await step(4 * 3600e3); assert.strictEqual(cs(dog(w, '201')), fd, 'still the frozen line after the game');
    // --- 6. late wake BEFORE kickoff (server asleep through the mark): frozen 10 minutes before kickoff, flagged late ---
    NOW = KS - 10 * MIN; set('202', null); await A.tick(); w = stored(2); // ESPN has pulled the line: the last line the server read is used
    assert.ok(dog(w, '202').final && dog(w, '202').pre === true && dog(w, '202').late === 1, 'late but before kickoff: pre true, late flag'); assert.strictEqual(dog(w, '202').line, 3); assert.ok(w.gl['203'].f && !dog(w, '203'), 'a favored road team is frozen as not a road dog');
    assert.ok(dog(w, '204').final && dog(w, '204').late === 1);
    // --- 7. late wake AFTER kickoff with nothing read before it: waits for a closing line, then freezes flagged after-the-fact (*) ---
    NOW = KM + 20 * MIN; set('206', null, 'in'); await A.tick(); w = stored(2); assert.ok(!w.gl['206'], 'no line anywhere: not frozen with a made-up number');
    set('206', null, 'post'); SCHED.find((g) => g.id === '206').hs = 20; SCHED.find((g) => g.id === '206').as = 23; CSV.push('2026,REG,2,SEA,LA,20,4.5'); NOW += 7 * 3600e3; await A.tick(); w = stored(2);
    assert.ok(dog(w, '206') && dog(w, '206').final && dog(w, '206').pre === false && dog(w, '206').late === 1, 'frozen after kickoff from the closing line: pre false'); assert.strictEqual(dog(w, '206').line, 4.5); assert.strictEqual(w.gl['206'].s, 'close');
    assert.strictEqual(cs(w.lock), fl, 'the Lock never changed all week');
    // a line the server DID read before kickoff, frozen only after kickoff, is also flagged (week 3 game 93: read now, server "asleep" until after it starts)
    const g3 = SCHED.find((g) => g.id === '93'); g3.odds = 'BUF -2.5'; NOW = Date.parse(g3.date) - 5 * 3600e3; await A.tick(); assert.strictEqual(stored(3).gl['93'].l, 2.5); g3.odds = null; g3.st = 'in'; NOW = Date.parse(g3.date) + 15 * MIN; await A.tick(); x = stored(3).gl['93']; assert.ok(x.f && x.pre === false && x.late === 1 && x.l === 2.5 && x.s === 'espn', 'woke after kickoff: the stored pre-game line, flagged');
    // --- 8. GET: every week, each part flagged, with the time and the line used ---
    r = await call('GET', '/alert'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.markMin, 30); assert.ok(r.j.tick.ok); x = r.j.weeks['2'];
    assert.strictEqual(x.src, 'srv'); assert.ok(x.lock.final && x.lock.t && x.gl[x.lock.id].lt && x.gl[x.lock.id].s, 'final flag, freeze time, line time and line source'); assert.ok(r.j.weeks['4'] && r.j.weeks['4'].lock === null, 'next week with no lines yet: a record and no pick'); assert.ok(!r.j.weeks['6'], 'weeks more than 9 days out are not computed yet');
    // --- 9. phones can no longer freeze: POST /alert is refused for a signed-in phone AND for the owner; nothing changes ---
    const snap = JSON.stringify(db['lock:alert26']); owner = true;
    r = await call('POST', '/alert', { week: 2, rec: { lock: { id: '205', abbr: 'SF', line: 3, conf: 0.99, dog: true }, dogs: [], helper: { id: '205', abbr: 'SF', conf: 0.99 } } }); assert.strictEqual(r.s, 410, 'signed-in phone refused');
    r = await call('POST', '/alert', { week: 2, rec: {} }, 'owner-token'); assert.strictEqual(r.s, 410, 'no phone freeze for the owner either'); assert.strictEqual(JSON.stringify(db['lock:alert26']), snap, 'nothing stored by a refused post');
    // --- 10. owner-only correction path ---
    r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: 4.5 }] }); assert.strictEqual(r.s, 401, 'a signed-in phone cannot correct'); r = await call('POST', '/alert/run', {}); assert.strictEqual(r.s, 401);
    owner = false; r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: 4.5 }] }, 'owner-token'); assert.strictEqual(r.s, 401, 'a token that is not an owner token is refused'); owner = true; assert.strictEqual(JSON.stringify(db['lock:alert26']), snap);
    assert.ok(logs.some((m) => /refused: POST \/alert/.test(m)) && logs.some((m) => /refused: \/alert\/fix without an owner token/.test(m)), 'refusals are logged'); assert.ok(!logs.some((m) => /owner-token|phone-token/.test(m)), 'no token ever logged');
    r = await call('POST', '/alert/fix', { week: 2, fixes: [{ abbr: 'DAL', line: 4.5 }] }, 'owner-token'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.applied, false, 'dry run by default'); assert.deepStrictEqual(r.j.changes.filter((c) => c.what === 'dog'), [{ what: 'dog', team: 'DAL', id: '201', from: 3, to: 4.5 }]); assert.strictEqual(JSON.stringify(db['lock:alert26']), snap, 'dry run writes nothing');
    const pBefore = dog(stored(2), '201').p;
    r = await call('POST', '/alert/fix', { week: 2, apply: true, why: 'closing line', fixes: [{ abbr: 'NYG', line: -4.5 }] }, 'owner-token'); assert.strictEqual(r.j.applied, true); w = stored(2); x = dog(w, '201');
    assert.strictEqual(x.line, 4.5, 'NYG -4.5 = DAL +4.5'); assert.strictEqual(x.was, 3, 'original line kept'); assert.strictEqual(x.p, pBefore, 'model % is not recomputed'); assert.ok(x.final && x.pre === true); assert.strictEqual(w.fix.length, 1); assert.strictEqual(w.fix[0].why, 'closing line');
    if (w.lock.id === '201') assert.strictEqual(Math.abs(w.lock.line), 4.5, 'a Lock on the same game takes the mirror line');
    NOW += 2 * MIN; await A.tick(); assert.strictEqual(dog(stored(2), '201').line, 4.5, 'the next tick keeps the correction');
    CSV.push('2026,REG,2,DAL,NYG,20,5.5'); r = await call('POST', '/alert/fix', { week: 2, apply: true, source: 'nflverse' }, 'owner-token'); assert.strictEqual(r.j.applied, true); x = dog(stored(2), '201'); assert.strictEqual(x.line, 5.5, 'closing line from nflverse'); assert.strictEqual(x.was, 3, 'was = the first original'); assert.ok(logs.some((m) => /OWNER FIX week 2 dog DAL: 4.5 -> 5.5/.test(m)));
    r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'XXX', line: 1 }] }, 'owner-token'); assert.strictEqual(r.s, 400); r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: 4.3 }] }, 'owner-token'); assert.strictEqual(r.s, 400, 'only half-point lines');
    r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: -1.5 }] }, 'owner-token'); assert.ok(r.j.skipped.some((s) => s.what === 'dog' && s.team === 'DAL'), 'a correction that makes the road team the favorite is refused for the dog'); assert.strictEqual(dog(stored(2), '201').line, 5.5);
    r = await call('POST', '/alert/run', {}, 'owner-token'); assert.strictEqual(r.s, 200); assert.ok(r.j.tick.ok);
    // --- 11. a record frozen whole by a phone under v248 (week 10 of 2026, no v): never recomputed, served as final, correctable ---
    A._reset(); logs = []; const V1 = { lock: { id: '202', rank: 2, abbr: 'CHI', other: 'DET', line: 6.5, conf: 0.5612, dog: true }, dogs: [{ id: '202', abbr: 'CHI', home: 'DET', line: 6.5, p: 0.5612 }, { id: '204', abbr: 'MIA', home: 'NE', line: 2.5, p: 0.4821 }], helper: { id: '205', abbr: 'GB', conf: 0.78 }, t: KS - 3600e3, pre: false };
    db = { 'lock:alert26': { id: 'lock:alert26', data: { weeks: { 2: V1 } }, updated: 5 } }; NOW = KS + 8 * 3600e3; ['202', '203', '204', '205'].forEach((id) => { const g = SCHED.find((y) => y.id === id); g.st = 'post'; g.hs = 24; g.as = 20; });
    await A.tick(); assert.deepStrictEqual(stored(2), V1, 'old phone-frozen week left exactly as it is');
    r = await call('GET', '/alert'); x = r.j.weeks['2']; assert.strictEqual(x.v, 1); assert.ok(x.lock.final && x.lock.pre === false && x.dogs.every((d) => d.final && d.pre === false) && x.helper.final, 'served as final, flagged after-the-fact');
    CSV.push('2026,REG,2,CHI,DET,24,7.5', '2026,REG,2,MIA,NE,24,1.5'); r = await call('POST', '/alert/fix', { week: 2, source: 'nflverse' }, 'owner-token'); assert.strictEqual(r.j.applied, false); assert.strictEqual(r.j.changes.length, 3, 'dry run lists Lock + 2 dogs');
    r = await call('POST', '/alert/fix', { week: 2, source: 'nflverse', apply: true, why: 'week closing lines' }, 'owner-token'); w = stored(2); assert.strictEqual(w.lock.line, 7.5); assert.strictEqual(w.lock.was, 6.5); assert.strictEqual(dog(w, '202').line, 7.5); assert.strictEqual(dog(w, '204').line, 1.5); assert.strictEqual(dog(w, '204').p, 0.4821); assert.strictEqual(w.lock.conf, 0.5612);
    r = await call('POST', '/alert/fix', { week: 1, source: 'nflverse' }, 'owner-token'); assert.strictEqual(r.s, 200, 'a server-frozen week can be corrected too'); D.ship = { 1: {} }; r = await call('POST', '/alert/fix', { week: 1, source: 'nflverse' }, 'owner-token'); assert.strictEqual(r.s, 400, 'weeks shipped with the app are not corrected here'); D.ship = {};
    // --- 12. lost write (the owner fix landed between read and write): read again, recompute, save ---
    A._reset(); db = {}; SCHED.find((g) => g.id === '94').odds = 'BUF -1'; NOW = Date.parse(SCHED.find((g) => g.id === '94').date) - 2 * 864e5; failPatch = 1; await A.tick(); assert.ok(A._state().TK.ok, 'retried after a lost write'); assert.strictEqual(stored(4).gl['94'].l, 1);
    // --- 13. ESPN down on a cold start: nothing is computed or stored, GET still answers with what the database has; database down with no copy: 503 ---
    A._reset(); const before = JSON.stringify(db['lock:alert26']); espnDown = true; NOW += 10 * MIN; r = await call('GET', '/alert'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.tick.ok, false); assert.ok(r.j.weeks['2'], 'stored picks still served'); assert.strictEqual(JSON.stringify(db['lock:alert26']), before); assert.ok(logs.some((m) => /tick failed/.test(m)), 'errors are logged');
    dbDown = true; NOW += 6 * MIN; r = await call('GET', '/alert'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.stale, true, 'database down: the copy in memory, marked stale'); A._reset(); r = await call('GET', '/alert'); assert.strictEqual(r.s, 503, 'database down and nothing in memory'); dbDown = false; espnDown = false;
    // --- 14. the Helper is the server port of the app's win pick; no Odds API call was ever made ---
    const R = H.ratings([{ id: 'a', week: 1, state: 'post', home: { abbr: 'AAA', score: 30 }, away: { abbr: 'BBB', score: 10 } }], 2, { a: [6, 0, 5, 2] }); assert.ok(R.RAT.AAA > 0 && R.RAT.BBB < 0 && R.EFF.AAA > 0);
    x = H.win({ home: { abbr: 'AAA' }, away: { abbr: 'BBB' } }, 7, R); assert.strictEqual(x.abbr, 'AAA'); assert.ok(Math.abs(x.conf - (0.9 * H.cdf(7 / 12.5) + 0.1 * H.cdf((0.5 * (R.RAT.AAA - R.RAT.BBB + 2) + 0.5 * (R.EFF.AAA - R.EFF.BBB + 2)) / 12.5))) < 1e-12, '90% line + 10% ratings');
    assert.strictEqual(H.win({ home: { abbr: 'AAA' }, away: { abbr: 'BBB' } }, -20, R).abbr, 'BBB');
    assert.ok(urls.length > 20 && urls.every((u) => /site\.api\.espn\.com|nflverse/.test(u)), 'only ESPN and nflverse are fetched (no Odds API credits)');
    console.log('alert.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.stack || e.message); process.exitCode = 1; }
  srv.close();
});
