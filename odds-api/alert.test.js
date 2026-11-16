// Run: node odds-api/alert.test.js   (no network, no database: Supabase, ESPN, nflverse, the book cache and the owner check are in-memory fakes)
// What it proves: the SERVER computes the weekly picks with no phone involved; they follow the line until 60 minutes (FREEZE_MIN) before kickoff and never move after;
// a late wake freezes with a flag; phones can no longer freeze anything; only the owner can correct a final line.
const assert = require('assert'), http = require('http'), A = require('./alert'), H = require('./helper'), D = A._deps;
// Every tick of this file (A.tick() -> run() -> compute) goes through the before/after Lock checker (alert-check.js); the last assertion is "0 violations".
const CHK = require('./alert-check').install(A);
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
const ev = (g) => ({ id: g.id, date: g.date, status: { type: { state: g.st, shortDetail: g.det || (g.st === 'post' ? 'Final' : ''), name: g.st === 'post' ? 'STATUS_FINAL' : 'STATUS_SCHEDULED' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: g.home }, score: String(g.hs) }, { homeAway: 'away', team: { abbreviation: g.away }, score: String(g.as) }], odds: g.odds ? [Object.assign({ details: g.odds }, g.op ? { homeTeamOdds: { spreadOdds: g.op[0] }, awayTeamOdds: { spreadOdds: g.op[1] } } : {})] : [] }] });
let CSV = ['season,game_type,week,away_team,home_team,home_score,spread_line', '2026,REG,1,PHI,DAL,24,-2.5', '2026,REG,1,GB,CHI,10,-3', '2026,REG,1,KC,DEN,20,-1', '2026,REG,1,BUF,MIA,14,-6.5', '2026,REG,1,WAS,NYG,16,2.5', '2026,REG,1,LA,SEA,28,3', '2026,REG,1,NE,DET,30,7', '2026,REG,1,LV,SF,23,6.5'];
D.fetch = async (u) => {
  urls.push(u);
  if (/nflverse/.test(u)) return { ok: true, text: async () => CSV.join('\n') + '\n' };
  if (espnDown) throw new Error('down');
  if (/summary\?event=/.test(u)) { const g = SCHED.find((x) => x.id === u.split('=')[1]); return { ok: true, json: async () => ({ boxscore: { teams: [{ team: { abbreviation: g.home }, statistics: [{ name: 'yardsPerPlay', displayValue: '5.8' }, { name: 'turnovers', displayValue: '1' }] }, { team: { abbreviation: g.away }, statistics: [{ name: 'yardsPerPlay', displayValue: '5.1' }, { name: 'turnovers', displayValue: '2' }] }] } }) }; }
  const m = /week=(\d+)/.exec(u); return { ok: true, json: async () => (m ? { events: SCHED.filter((g) => g.wk === +m[1]).map(ev) } : { season: { year: 2026, type: 2 }, week: { number: 2 }, events: [] }) };
};
D.now = () => NOW; D.peek = () => books; D.log = (m) => logs.push(m); D.ownerOk = (req) => owner && req.headers['x-token'] === 'owner-token'; D.ship = {}; D.trs = {}; D.shipMax = 0; // the fake season computes weeks 1-2 itself
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
    // --- 4. owner D9: every pick freezes 1 hour before ITS OWN game. 61 minutes before the Thursday game: all live. 59: the Thursday dog is final; the Lock and the
    //        Helper are final only if they are on the Thursday game, otherwise that game is out of contention for them (exact switching is tested in section 16) ---
    NOW = K1 - 61 * MIN; await A.tick(); w = stored(2); assert.ok(!w.lock.final && !w.helper.final && !dog(w, '201').final, 'live at 61 minutes');
    NOW = K1 - 59 * MIN; await A.tick(); w = stored(2);
    assert.ok(w.lock.final ? w.lock.id === '201' && w.lock.pre === true && w.lock.t === NOW : w.lockOut.includes('201'), 'Lock: final on the Thursday game, or that game is out of contention');
    assert.ok(w.helper.final ? w.helper.id === '201' : w.helpOut.includes('201'), 'Helper: same rule');
    assert.ok(dog(w, '201').final && dog(w, '201').pre === true && !dog(w, '201').late, 'Thursday dog final at its own mark'); assert.ok(!dog(w, '202').final && !dog(w, '204').final, 'Sunday dogs still live');
    assert.ok(logs.some((m) => /week 2 road dog final: DAL/.test(m)), 'freezes are logged');
    let fl = w.lock.final ? cs(w.lock) : null, fh = w.helper.final ? cs(w.helper) : null; const fd = cs(dog(w, '201'));
    // --- 5. line moves AFTER the mark change nothing that is final; parts that are still live keep following ---
    set('201', 'NYG -6.5'); set('205', 'SF -3'); set('202', 'DET -3'); w = await step(6 * MIN);
    if (fl) assert.strictEqual(cs(w.lock), fl, 'a final Lock does not move'); if (fh) assert.strictEqual(cs(w.helper), fh, 'a final Helper does not move'); assert.ok(w.lock.id !== '201' || fl, 'a game out of contention never becomes the Lock'); assert.strictEqual(cs(dog(w, '201')), fd, 'Thursday dog does not move after its mark'); assert.strictEqual(dog(w, '202').line, 3, 'a Sunday dog still follows the line');
    set('201', undefined, 'in'); w = await step(60 * MIN); set('201', undefined, 'post'); SCHED.find((g) => g.id === '201').hs = 20; SCHED.find((g) => g.id === '201').as = 19; w = await step(4 * 3600e3); assert.strictEqual(cs(dog(w, '201')), fd, 'still the frozen line after the game');
    // --- 6. late wake BEFORE kickoff (server asleep through the mark): frozen 10 minutes before kickoff, flagged late ---
    NOW = KS - 10 * MIN; set('202', null); await A.tick(); w = stored(2); // ESPN has pulled the line: the last line the server read is used
    assert.ok(dog(w, '202').final && dog(w, '202').pre === true && dog(w, '202').late === 1, 'late but before kickoff: pre true, late flag'); assert.strictEqual(dog(w, '202').line, 3); assert.ok(w.gl['203'].f && !dog(w, '203'), 'a favored road team is frozen as not a road dog');
    assert.ok(dog(w, '204').final && dog(w, '204').late === 1);
    assert.ok(w.lock.final || w.lock.id === '206', 'after the Sunday marks the Lock is final unless it sits on the Monday game'); if (w.lock.final) { fl = cs(w.lock); const ld = dog(w, w.lock.id); if (ld) { assert.strictEqual(Math.abs(w.lock.line), ld.line, 'Lock and road dog on the same game: one line'); assert.strictEqual(w.lock.o, w.lock.abbr === ld.abbr ? ld.o : w.lock.o); } }
    // --- 7. late wake AFTER kickoff with nothing read before it: waits for a closing line, then freezes flagged after-the-fact (*) ---
    NOW = KM + 20 * MIN; set('206', null, 'in'); await A.tick(); w = stored(2); assert.ok(!w.gl['206'], 'no line anywhere: not frozen with a made-up number');
    set('206', null, 'post'); SCHED.find((g) => g.id === '206').hs = 20; SCHED.find((g) => g.id === '206').as = 23; CSV.push('2026,REG,2,SEA,LA,20,4.5'); NOW += 7 * 3600e3; await A.tick(); w = stored(2);
    assert.ok(dog(w, '206') && dog(w, '206').final && dog(w, '206').pre === false && dog(w, '206').late === 1, 'frozen after kickoff from the closing line: pre false'); assert.strictEqual(dog(w, '206').line, 4.5); assert.strictEqual(w.gl['206'].s, 'close');
    assert.ok(w.lock.final && w.helper.final, 'everything final by Monday night'); if (fl) assert.strictEqual(cs(w.lock), fl, 'a final Lock never changed');
    // a line the server DID read before kickoff, frozen only after kickoff, is also flagged (week 3 game 93: read now, server "asleep" until after it starts)
    const g3 = SCHED.find((g) => g.id === '93'); g3.odds = 'BUF -2.5'; NOW = Date.parse(g3.date) - 5 * 3600e3; await A.tick(); assert.strictEqual(stored(3).gl['93'].l, 2.5); g3.odds = null; g3.st = 'in'; NOW = Date.parse(g3.date) + 15 * MIN; await A.tick(); x = stored(3).gl['93']; assert.ok(x.f && x.pre === false && x.late === 1 && x.l === 2.5 && x.s === 'espn', 'woke after kickoff: the stored pre-game line, flagged');
    // --- 8. GET: every week, each part flagged, with the time and the line used ---
    r = await call('GET', '/alert'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.markMin, 60); assert.ok(r.j.tick.ok); x = r.j.weeks['2'];
    assert.strictEqual(x.src, 'srv'); assert.ok(x.lock.final && x.lock.t && x.gl[x.lock.id].lt && x.gl[x.lock.id].s, 'final flag, freeze time, line time and line source'); assert.ok(r.j.weeks['4'] && r.j.weeks['4'].lock === null, 'next week with no lines yet: a record and no pick'); assert.ok(!r.j.weeks['6'], 'weeks more than 9 days out are not computed yet');
    // --- 9. phones can no longer freeze: POST /alert is refused for a signed-in phone AND for the owner; nothing changes ---
    const snap = JSON.stringify(db['lock:alert26']); owner = true;
    r = await call('POST', '/alert', { week: 2, rec: { lock: { id: '205', abbr: 'SF', line: 3, conf: 0.99, dog: true }, dogs: [], helper: { id: '205', abbr: 'SF', conf: 0.99 } } }); assert.strictEqual(r.s, 410, 'signed-in phone refused');
    r = await call('POST', '/alert', { week: 2, rec: {} }, 'owner-token'); assert.strictEqual(r.s, 410, 'no phone freeze for the owner either'); assert.strictEqual(JSON.stringify(db['lock:alert26']), snap, 'nothing stored by a refused post');
    // --- 10. owner-only correction path ---
    r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: 4.5 }] }); assert.strictEqual(r.s, 401, 'a signed-in phone cannot correct'); r = await call('POST', '/alert/run', {}); assert.strictEqual(r.s, 401);
    owner = false; r = await call('POST', '/alert/fix', { week: 2, apply: true, fixes: [{ abbr: 'DAL', line: 4.5 }] }, 'owner-token'); assert.strictEqual(r.s, 401, 'a token that is not an owner token is refused'); owner = true; assert.strictEqual(JSON.stringify(db['lock:alert26']), snap);
    assert.ok(logs.some((m) => /refused: POST \/alert/.test(m)) && logs.some((m) => /refused: \/alert\/fix without an owner token/.test(m)), 'refusals are logged'); assert.ok(!logs.some((m) => /owner-token|phone-token/.test(m)), 'no token ever logged');
    r = await call('POST', '/alert/fix', { week: 2, fixes: [{ abbr: 'DAL', line: 4.5 }] }, 'owner-token'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.applied, false, 'dry run by default'); assert.deepStrictEqual(r.j.changes.filter((c) => c.what === 'dog'), [{ what: 'dog', team: 'DAL', id: '201', from: 3, to: 4.5, price: null }]); assert.strictEqual(JSON.stringify(db['lock:alert26']), snap, 'dry run writes nothing');
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
    // --- 15 (v253). 60-minute marks for Sunday dogs, prices stored with every pick, parlays composed on the server ---
    A._reset(); db = {}; logs = []; urls = []; books = null;
    SCHED = SCHED.filter((g) => g.wk !== 2).concat([
      Object.assign(G('301', 2, 'DAL', 'NYG', new Date(K1).toISOString(), 'pre', 'NYG -3'), { op: [-115, -105] }), // Thursday, ESPN price
      G('302', 2, 'CHI', 'DET', new Date(KS).toISOString(), 'pre', 'DET -6.5'), // Sunday, price from the cached books
      G('304', 2, 'MIA', 'NE', new Date(KS).toISOString(), 'pre', 'NE -1.5'), // Sunday, no price anywhere
      G('305', 2, 'SF', 'GB', new Date(KS).toISOString(), 'pre', 'GB -4'), // not a division game
      Object.assign(G('307', 2, 'ARI', 'SEA', new Date(KS + 3 * 3600e3).toISOString(), 'pre', 'SEA -9.5'), { op: [-110, -110] }), // late Sunday
    ]);
    const bk = (l, p, pa) => ({ k: 'b' + p, t: 'B', l, p, pa });
    const setBooks = () => (books = { at: NOW - 5 * MIN, games: [{ home: 'DET', away: 'CHI', start: new Date(KS).toISOString(), line: 6.5, n: 4, books: [bk(6.5, -110, -110), bk(6.5, -105, -115), bk(6.5, -102, -118), bk(7, -120, 100)] }, { home: 'NE', away: 'MIA', start: new Date(KS).toISOString(), line: 2, n: 1, books: [bk(2, -110, -110)] }] });
    NOW = K1 - 3 * 3600e3; setBooks(); await A.tick(); w = stored(2);
    assert.strictEqual(dog(w, '301').o, -105, 'ESPN price of the away side at the same line'); assert.strictEqual(dog(w, '301').os, 'espn');
    assert.strictEqual(dog(w, '302').o, -115, 'median of the books posting exactly 6.5 (away -110 / -115 / -118), the 7-point book is left out'); assert.strictEqual(dog(w, '302').os, 'books'); assert.strictEqual(w.gl['302'].hp, -105);
    assert.strictEqual(dog(w, '304').line, 2, 'books consensus line'); assert.strictEqual(dog(w, '304').o, -110, 'one book at 2: its price');
    books.games[1].books = [bk(1.5, -110, -110)]; NOW += MIN; await A.tick(); w = stored(2); assert.strictEqual(dog(w, '304').line, 2); assert.strictEqual(dog(w, '304').o, null, 'no book posts the consensus number and ESPN shows 1.5: NO price (never assumed -110)'); assert.strictEqual(dog(w, '304').os, 'none');
    assert.ok(w.lock && w.lock.os, 'the Lock carries a price state too'); assert.ok(!w.helper.o, 'the Helper (moneyline) carries no spread price');
    // parlays: whatever the model says, the stored legs are exactly pics/parlay.js's composition of the stored record
    const PL = require('../pics/parlay.js'), chk = (r) => { const c = PL.compose(r.lock, r.dogs.map((d) => ({ id: d.id, p: d.p }))); ['two', 'three'].forEach((k) => assert.deepStrictEqual(r.parlays[k] ? r.parlays[k].legs : null, c[k] ? c[k].map((x) => String(x.id)) : null, k + ' legs = compose(lock, dogs)')); };
    chk(w); assert.ok(!w.parlays.two || !w.parlays.two.final, 'live before any mark');
    if (w.parlays.two) assert.ok(dog(w, w.parlays.two.legs[1]).p >= 0.53 && w.parlays.two.legs[1] !== w.lock.id, '2-game dog leg is picked (53%+) and not the Lock game');
    // Sunday dogs: live at 61 minutes, final at 59 (the Thursday dog went final at K1 - 60)
    NOW = K1 - 59 * MIN; setBooks(); await A.tick(); w = stored(2); assert.ok(dog(w, '301').final && dog(w, '301').o === -105, 'Thursday mark: price frozen with the pick');
    books = null; NOW = KS - 61 * MIN; await A.tick(); w = stored(2); assert.ok(!dog(w, '302').final && !dog(w, '304').final && !dog(w, '307').final, 'Sunday dogs live at 61 minutes');
    set('302', 'DET -7'); set('307', 'SEA -10'); NOW = KS - 59 * MIN; await A.tick(); w = stored(2);
    assert.ok(dog(w, '302').final && dog(w, '302').pre === true && !dog(w, '302').late && dog(w, '304').final, 'Sunday dogs final at 59 minutes'); assert.strictEqual(dog(w, '302').line, 7, 'ESPN line once the book cache is gone'); assert.strictEqual(dog(w, '302').o, null, 'ESPN shows no price for this game: none'); assert.ok(!dog(w, '307').final, 'the late game is still live');
    NOW = KS + 3 * 3600e3 - 61 * MIN; await A.tick(); assert.ok(!dog(stored(2), '307').final, 'live at 61 minutes'); NOW += 2 * MIN; await A.tick(); w = stored(2); assert.ok(dog(w, '307').final && dog(w, '307').pre === true, 'final at 59 minutes'); assert.strictEqual(dog(w, '307').line, 10); assert.strictEqual(dog(w, '307').o, -110, 'ESPN price read with the line ESPN shows'); assert.strictEqual(dog(w, '307').os, 'espn');
    assert.ok(w.parlays.three && w.parlays.three.legs.length === 3, 'four road dogs: a 3-game parlay exists'); logs.filter((m) => /parlay final/.test(m)).forEach((m) => assert.ok(/no price|-1\d\d|\+?\d{3}/.test(m)));
    chk(w); ['two', 'three'].forEach((k) => { const P = w.parlays[k]; if (!P) return; assert.ok(P.final && typeof P.pre === 'boolean', k + ' parlay final once every leg is final'); });
    assert.ok(urls.every((u) => /site\.api\.espn\.com|nflverse/.test(u)), 'still no Odds API call');
    // pure composition rules (pics/parlay.js)
    const LK = { id: 'L', p: 0.56 }, D3 = [{ id: 'a', p: 0.55 }, { id: 'b', p: 0.6 }, { id: 'c', p: 0.5 }, { id: 'L', p: 0.7 }];
    x = PL.compose(LK, D3); assert.deepStrictEqual(x.two.map((y) => y.id), ['L', 'b'], '2-game = Lock + highest picked dog, never the Lock game'); assert.deepStrictEqual(x.three.map((y) => y.id), ['L', 'b', 'a'], '3-game = Lock + top two by model %');
    x = PL.compose(LK, [{ id: 'a', p: 0.52 }, { id: 'c', p: 0.5 }]); assert.strictEqual(x.two, null, 'no picked dog = no 2-game'); assert.deepStrictEqual(x.three.map((y) => y.id), ['L', 'a', 'c'], '3-game takes dogs under 53% too');
    x = PL.compose(LK, [{ id: 'a', p: 0.6 }]); assert.strictEqual(x.three, null, 'fewer than two other dogs = no 3-game'); assert.deepStrictEqual(PL.compose(null, D3), { two: null, three: null }, 'no Lock = no parlay');
    x = PL.compose(LK, [{ id: 'a', p: 0.6, fin: true }, { id: 'b', p: 0.55 }], { keep: { two: [] } }); assert.deepStrictEqual(x.two.map((y) => y.id), ['L', 'b'], 'a dog that is already frozen is never added');
    x = PL.compose(LK, [{ id: 'a', p: 0.54, fin: true }, { id: 'b', p: 0.6 }], { keep: { two: ['a'] } }); assert.deepStrictEqual(x.two.map((y) => y.id), ['L', 'a'], '... and a frozen leg stays even if a live dog now rates higher');
    x = PL.compose(LK, [{ id: 'a', p: 0.5, fin: true }, { id: 'b', p: 0.6 }, { id: 'c', p: 0.58 }, { id: 'd', p: 0.4 }], { keep: { three: ['a'] } }); assert.deepStrictEqual(x.three.map((y) => y.id).sort(), ['L', 'a', 'b'].sort(), '3-game: the frozen leg stays, the open slot takes the best live dog');
    // grading: pushes drop out, a loss loses, a missing price gives no payout and is NEVER filled with -110
    const d = PL.dec; x = PL.grade([{ res: 'hit', price: -102 }, { res: 'hit', price: -105 }]); assert.strictEqual(x.res, 'hit'); assert.strictEqual(x.units.toFixed(2), '2.87', 'W1 ARI -102 / SF -105 = +2.87');
    x = PL.grade([{ res: 'push', price: -110 }, { res: 'hit', price: -105 }, { res: 'hit', price: 100 }]); assert.ok(x.res === 'hit' && x.left === 2 && x.reduced && Math.abs(x.units - (d(-105) * d(100) - 1)) < 1e-12, '3 -> 2 legs');
    x = PL.grade([{ res: 'push', price: -110 }, { res: 'hit', price: -105 }]); assert.ok(x.res === 'hit' && x.left === 1 && Math.abs(x.units - (d(-105) - 1)) < 1e-12, '2 -> single');
    x = PL.grade([{ res: 'push', price: -110 }, { res: 'push', price: -105 }]); assert.ok(x.res === 'push' && x.units === 0, 'all legs pushed = stake back');
    x = PL.grade([{ res: 'hit', price: null }, { res: 'miss', price: -110 }]); assert.ok(x.res === 'miss' && x.units === -1, 'a lost leg loses, price or not');
    x = PL.grade([{ res: 'hit', price: null }, { res: 'hit', price: -110 }]); assert.ok(x.res === 'hit' && x.units === null && x.d === null, 'missing price = no payout');
    assert.notStrictEqual(PL.grade([{ res: 'hit', price: undefined }, { res: 'hit', price: -110 }]).units, d(-110) * d(-110) - 1, 'never defaulted to -110'); assert.strictEqual(PL.payout([-110, null]), null);
    x = PL.grade([{ res: 'hit', price: -110 }, { res: '', price: -110 }]); assert.ok(x.res === '' && x.units === null, 'a pending leg = pending');
    // --- 16 (v253, owner D9). The Lock and the Helper freeze 1 hour before THEIR OWN game and can switch games until then. Model numbers are stubbed so every step is exact. ---
    const TR = require('../pics/trophy.js'), keepT = { pickOf: TR.pickOf, dogCover: TR.dogCover }, keepW = H.win; let CONF = {}, DP = {}, HC = {};
    TR.pickOf = (g) => ({ id: g.id, week: g.week, abbr: g.away.abbr, other: g.home.abbr, line: g.line, conf: CONF[g.id] || 0.5, dog: g.line > 0 }); // always the away side, at the game's line
    TR.dogCover = (g) => ({ p: DP[g.id] || 0.5 }); H.win = (g) => ({ abbr: g.home.abbr, conf: HC[g.id] || 0.6, ph: 0.6 });
    const KN = KS + 7 * 3600e3, wk16 = () => [Object.assign(G('401', 2, 'DAL', 'NYG', new Date(K1).toISOString(), 'pre', 'NYG -3'), { op: [-115, -105] }), G('402', 2, 'SF', 'GB', new Date(KS).toISOString(), 'pre', 'GB -4'), Object.assign(G('403', 2, 'CHI', 'DET', new Date(KS).toISOString(), 'pre', 'DET -6.5'), { op: [-112, -108] }), G('404', 2, 'MIA', 'NE', new Date(KS).toISOString(), 'pre', 'NE -1.5'), G('405', 2, 'ARI', 'SEA', new Date(KN).toISOString(), 'pre', 'SEA -9.5')];
    const fresh16 = () => { A._reset(); db = {}; logs = []; books = null; SCHED = SCHED.filter((g) => g.wk !== 2).concat(wk16()); };
    const legs = (w, k) => (w.parlays[k] ? w.parlays[k].legs.slice() : null);
    try {
      fresh16(); CONF = { 401: 0.7, 402: 0.6, 403: 0.55, 404: 0.5, 405: 0.52 }; HC = { 401: 0.8, 402: 0.85, 403: 0.7, 404: 0.7, 405: 0.7 }; DP = { 401: 0.58, 403: 0.56, 404: 0.54, 405: 0.5 };
      NOW = K1 - 3 * 3600e3; await A.tick(); w = stored(2);
      assert.strictEqual(w.lock.id, '402', 'Lock = the second-ranked game (the model\'s most confident pick is never the Lock)'); assert.ok(!w.lock.final); assert.strictEqual(w.helper.id, '402', 'Helper = the highest win chance');
      assert.deepStrictEqual(legs(w, 'two'), ['402', '401'], '2-game: Lock + highest picked dog'); assert.deepStrictEqual(legs(w, 'three'), ['402', '401', '403'], '3-game: Lock + top two dogs');
      CONF[403] = 0.65; NOW += MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '403', 'lines/model move before any mark: the Lock switches from game A to game B'); assert.deepStrictEqual(legs(w, 'two'), ['403', '401']);
      NOW = K1 - 61 * MIN; await A.tick(); w = stored(2); assert.ok(!w.lock.final && !w.helper.final && !dog(w, '401').final && !w.lockOut.length, 'all live at 61 minutes before the Thursday game');
      NOW = K1 - 59 * MIN; await A.tick(); w = stored(2);
      assert.ok(dog(w, '401').final, 'Thursday dog final at 59'); assert.deepStrictEqual(w.lockOut, ['401'], 'the Thursday game passed its mark while not the Lock: out of contention'); assert.deepStrictEqual(w.helpOut, ['401']); assert.ok(!w.lock.final && w.lock.id === '403' && !w.helper.final);
      DP[404] = 0.7; NOW += MIN; await A.tick(); w = stored(2); assert.deepStrictEqual(legs(w, 'two'), ['403', '401'], 'a frozen 2-game leg stays though a live dog now rates higher'); assert.deepStrictEqual(legs(w, 'three').sort(), ['401', '403', '404'], '3-game: frozen leg kept, the open slot follows the model'); assert.ok(!w.parlays.two.final, 'not final while the Lock leg is live');
      CONF = { 401: 0.62, 402: 0.6, 403: 0.65, 404: 0.5, 405: 0.52 }; NOW += MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '402', 'the out game (now ranked 2nd) can never become the Lock: the next contender is'); 
      CONF = { 401: 0.7, 402: 0.6, 403: 0.65, 404: 0.5, 405: 0.52 }; NOW += MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '403', 'an out game keeps its place in the ranking');
      NOW = KS - 61 * MIN; await A.tick(); w = stored(2); assert.ok(!w.lock.final && !w.helper.final && !dog(w, '403').final, 'Sunday: live at 61 minutes');
      NOW = KS - 59 * MIN; await A.tick(); w = stored(2);
      assert.ok(w.lock.final && w.lock.id === '403' && w.lock.pre === true && !w.lock.late && w.lock.t === NOW, 'Lock final at 59 minutes before ITS game'); assert.ok(w.lockOut.includes('402'), '402 reached its mark first in order and was not the Lock');
      assert.strictEqual(w.lock.line, dog(w, '403').line, 'Lock and road dog on the same game: one line'); assert.strictEqual(w.lock.o, -108); assert.strictEqual(dog(w, '403').o, -108, '... and one price'); assert.strictEqual(w.gl['403'].l, 6.5);
      assert.ok(w.helper.final && w.helper.id === '402' && w.helper.pre === true, 'Helper final at its own game mark');
      assert.ok(w.parlays.two.final && w.parlays.two.pre === true && w.parlays.three.final, 'parlays final once every leg is final'); assert.ok(db['lock:alert26'].data.ll['405'] && db['lock:alert26'].data.ll['405'].l === 9.5, 'last pre-game line of every game kept in the database (row data.ll)');
      const L0 = cs(w.lock); CONF = { 401: 0.9, 402: 0.1, 403: 0.1, 404: 0.1, 405: 0.95 }; set('403', 'DET -9'); NOW += 10 * MIN; await A.tick(); w = stored(2); assert.strictEqual(cs(w.lock), L0, 'a final Lock never changes');
      // Thursday game that is the Lock at its mark stays the Lock all week
      fresh16(); CONF = { 401: 0.6, 402: 0.7, 403: 0.55, 404: 0.5, 405: 0.52 }; HC = { 401: 0.9, 402: 0.6 }; NOW = K1 - 59 * MIN; await A.tick(); w = stored(2);
      assert.ok(w.lock.final && w.lock.id === '401', 'Thursday Lock final at its mark'); assert.strictEqual(w.lock.line, dog(w, '401').line); assert.strictEqual(w.lock.o, -105, 'the away price at its frozen line'); assert.ok(w.helper.final && w.helper.id === '401');
      CONF = { 401: 0.1, 402: 0.9, 403: 0.8, 404: 0.7, 405: 0.6 }; HC = { 402: 0.99 }; NOW = KN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '401', 'still the Lock all week'); assert.strictEqual(w.helper.id, '401');
      // --- 18 (v253 review fixes 1, 2, 4) ---
      TR.pickOf = (g) => (g.line === 0 ? null : { id: g.id, week: g.week, abbr: g.away.abbr, other: g.home.abbr, line: g.line, conf: CONF[g.id] || 0.5, dog: g.line > 0 }); // a pick'em line ranks nothing (as in trophy.js)
      // fix 1: a finished game is ranked at the line frozen at its mark, not at the closing line nflverse posts later (here pick'em, which would drop it from the ranking)
      fresh16(); CONF = { 401: 0.9, 403: 0.8, 402: 0.7, 404: 0.6, 405: 0.5 }; NOW = K1 - 59 * MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '403'); assert.deepStrictEqual(w.lockOut, ['401']); assert.strictEqual(w.gl['401'].l, 3);
      const g401 = SCHED.find((g) => g.id === '401'); g401.st = 'post'; g401.hs = 20; g401.as = 20; CSV.push('2026,REG,2,DAL,NYG,20,0'); NOW = K1 + 7 * 3600e3; await A.tick(); w = stored(2);
      assert.strictEqual(w.lock.id, '403', 'the Thursday game, ranked at its frozen line, keeps its place: the Lock does not move without a live line move'); CSV.pop(); g401.st = 'pre';
      // fix 2 (owner, Nov 16 2026): never a week without a Lock. Every game after the #1 is out of contention -> the top game still in contention is the Lock
      fresh16(); CONF = { 402: 0.9, 405: 0.8, 403: 0.7, 404: 0.6, 401: 0.5 }; NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 59 * MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '405'); assert.deepStrictEqual(w.lockOut.slice().sort(), ['401', '402', '403', '404']);
      CONF[405] = 0.95; NOW += 10 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock && w.lock.id === '405', 'the only game left in contention is the Lock even though it now ranks first');
      NOW = KN - 59 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock.final && w.lock.id === '405', 'and it goes final at its mark');
      // fix 4: the Lock at its mark with incomplete inputs waits for kickoff and stays the Lock meanwhile
      fresh16(); const g108 = SCHED.find((g) => g.id === '108'); g108.st = 'in'; CONF = { 401: 0.5, 402: 0.9, 403: 0.8, 404: 0.6, 405: 0.7 };
      NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 59 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock.id === '403' && !w.lock.final && w.lock.part === 1 && w.lockWait === '403', 'held: inputs incomplete at the mark');
      CONF[405] = 0.85; NOW = KS - 30 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock.id === '403' && !w.lock.final, 'a game already past its mark stays the Lock while it waits (another game now ranks above it)');
      NOW = KS + MIN; await A.tick(); w = stored(2); assert.ok(w.lock.final && w.lock.id === '403' && w.lock.pre === false && w.lock.part === 1, 'frozen at kickoff, flagged'); assert.ok(!w.lockWait); g108.st = 'post';
      // --- 20 (v253 re-review fixes 1, 2) ---
      // fix 2: a game with no line at its mark that gets a line later (here ESPN, 30 minutes after the mark) is not ranked, so it cannot move the live Lock
      fresh16(); set('401', null); CONF = { 401: 0.95, 405: 0.9, 403: 0.8, 402: 0.7, 404: 0.6 }; NOW = K1 - 3 * 3600e3; await A.tick(); NOW = K1 - 59 * MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '403'); assert.ok(w.lockOut.includes('401'));
      set('401', 'NYG -3'); NOW = K1 - 30 * MIN; await A.tick(); w = stored(2); assert.ok(w.gl['401'] && w.gl['401'].lt > K1 - 60 * MIN, 'the line was read after the mark'); assert.strictEqual(w.lock.id, '403', 'a line that appears after the mark does not move the live Lock');
      set('401', 'NYG -3');
      // fix 1: the live Lock is the last game in contention and its line goes to pick'em at its mark -> frozen at the last line and side it held, flagged nl
      fresh16(); CONF = { 402: 0.9, 405: 0.8, 403: 0.7, 404: 0.6, 401: 0.5 }; NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 59 * MIN; await A.tick(); w = stored(2); assert.strictEqual(w.lock.id, '405');
      set('405', 'EVEN'); NOW = KN - 61 * MIN; await A.tick(); NOW = KN - 59 * MIN; await A.tick(); w = stored(2);
      assert.ok(w.lock && w.lock.final && w.lock.id === '405' && w.lock.line === 9.5 && w.lock.nl === 1, 'never a week without a Lock: frozen at its last live line, flagged "line at mark unavailable"'); set('405', 'SEA -9.5');
      // --- 21 (v253 final review N7, N5): the live Lock's own game is never left out of the ranking for a line read after its mark ---
      // N7: the Lock is on a division road dog game; the server is down more than 5 minutes across that game's mark and the line moves (both directions).
      // The Lock and the road dog freeze together at the new line and price, flagged late (not "line at mark unavailable").
      for (const [mv, ln] of [['DET -7.5', 7.5], ['DET -5.5', 5.5]]) {
        fresh16(); const h403 = SCHED.find((g) => g.id === '403'); CONF = { 401: 0.9, 403: 0.8, 402: 0.7, 404: 0.6, 405: 0.5 };
        NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 4 * 3600e3; await A.tick(); w = stored(2); assert.ok(w.lock.id === '403' && !w.lock.final && w.lock.line === 6.5 && w.lock.o === -108, 'N7: live Lock on the road dog game');
        h403.odds = mv; h403.op = [-102, -118]; NOW = KS - 30 * MIN; await A.tick(); w = stored(2); x = dog(w, '403');
        assert.ok(w.lock.final && w.lock.id === '403' && w.lock.late === 1 && w.lock.pre === true && !w.lock.nl, 'N7 (' + mv + '): Lock final, flagged late, not "line at mark unavailable"');
        assert.ok(x.final && x.late === 1, 'N7: road dog final late'); assert.strictEqual(w.lock.line, ln, 'N7: Lock at the new line'); assert.strictEqual(x.line, ln, 'N7: road dog at the new line'); assert.strictEqual(w.lock.o, -118); assert.strictEqual(x.o, -118, 'N7: one line, one price'); assert.strictEqual(w.gl['403'].l, ln);
      }
      // N5: the first tick of the week lands inside the hour before the Lock's kickoff while earlier results are missing: the Lock waits (held), then freezes at kickoff
      fresh16(); g108.st = 'in'; CONF = { 402: 0.9, 401: 0.8, 403: 0.7, 404: 0.6, 405: 0.5 };
      NOW = K1 - 30 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock.id === '401' && !w.lock.final && w.lock.part === 1 && w.lockWait === '401', 'N5: first tick inside the hour, inputs incomplete: held');
      NOW = K1 - 25 * MIN; await A.tick(); w = stored(2); assert.ok(w.lock.id === '401' && !w.lock.final && !w.lock.nl && w.lockWait === '401', 'N5: still held on the next tick (its line, read after the mark, is not dropped)');
      NOW = K1 + MIN; await A.tick(); w = stored(2); x = dog(w, '401');
      assert.ok(w.lock.final && w.lock.id === '401' && w.lock.pre === false && w.lock.part === 1 && !w.lock.nl && !w.lockWait, 'N5: frozen at kickoff, flagged'); assert.strictEqual(w.lock.line, x.line, 'N5: same line as its road dog'); assert.strictEqual(w.lock.o, -105); assert.strictEqual(x.o, -105);
      g108.st = 'post';
      // Final re-review (blocking): a line read after the live Lock's own mark never re-ranks the Lock. Same game, same team, at the frozen line turned into that
      // team's spread, with that side's price, flagged late. Here the model stub takes the FAVOURITE of game 403 (so a line that crosses zero would flip the team)
      // and loses confidence in 403 under 16 points (so a shorter line would hand the Lock to another game). Each case fails on 9c10a65.
      const keep21 = TR.pickOf, same = (b, a2, msg) => assert.deepStrictEqual([a2.id, a2.abbr], [b.id, b.abbr], msg + ': the Lock is on the same game and the same team before and after the tick');
      const late21 = async (pick, open, moved, price) => {
        fresh16(); const h = SCHED.find((g) => g.id === '403'); h.odds = open; h.op = [-110, -110]; TR.pickOf = (g) => (g.id === '403' ? pick(g) : keep21(g)); CONF = { 401: 0.9, 402: 0.7, 404: 0.6, 405: 0.5 };
        NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 4 * 3600e3; await A.tick(); const b = Object.assign({}, stored(2).lock); assert.ok(b.id === '403' && !b.final, 'live Lock on 403 before the server goes down (' + open + ')');
        h.odds = moved; h.op = price; NOW = KS - 30 * MIN; await A.tick(); const r = stored(2); same(b, r.lock, open + ' -> ' + moved);
        assert.ok(r.lock.final && r.lock.late === 1 && r.lock.pre === true && !r.lock.nl, open + ' -> ' + moved + ': final, flagged late, not "line at mark unavailable"'); assert.ok(r.gl['403'].lt > KS - 55 * MIN, 'the line was read after the mark');
        NOW = KS + 4 * 3600e3; await A.tick(); same(b, stored(2).lock, 'later ticks'); assert.strictEqual(stored(2).lock.line, r.lock.line); return { b, w: r };
      };
      const fav = (g) => (g.line > 0 ? { id: g.id, week: g.week, abbr: g.home.abbr, other: g.away.abbr, line: -g.line, conf: 0.8, dog: false } : { id: g.id, week: g.week, abbr: g.away.abbr, other: g.home.abbr, line: g.line, conf: 0.8, dog: false });
      const big = (g) => (g.line < 0 ? { id: g.id, week: g.week, abbr: g.home.abbr, other: g.away.abbr, line: -g.line, conf: 0.8, dog: true } : { id: g.id, week: g.week, abbr: g.away.abbr, other: g.home.abbr, line: g.line, conf: g.line >= 16 ? 0.8 : 0.3, dog: true });
      // home favourite by a half (IND@HOU, Lock HOU -0.5): the line crosses zero while the server is down -> still the home team, now +0.5 at the home price
      x = await late21(fav, 'DET -0.5', 'CHI -0.5', [-120, 100]); assert.ok(x.b.abbr === 'DET' && x.b.line === -0.5); assert.strictEqual(x.w.lock.abbr, 'DET', 'home 0.5 -> -0.5: the Lock is not flipped to the road team'); assert.strictEqual(x.w.lock.line, 0.5); assert.strictEqual(x.w.lock.o, -120, "its own side's price"); assert.strictEqual(x.w.gl['403'].l, -0.5);
      x = await late21(fav, 'DET -3', 'CHI -1', [-120, 100]); assert.ok(x.b.abbr === 'DET' && x.b.line === -3); assert.strictEqual(x.w.lock.abbr, 'DET', 'home 3 -> -1: still the home team'); assert.strictEqual(x.w.lock.line, 1); assert.strictEqual(x.w.lock.o, -120);
      // road dog +16.5 (MIA@BUF, Lock MIA +16.5): the line shortens to 10 -> still that game and team at +10 (not moved to the next game); same line and price as its road dog (N7)
      x = await late21(big, 'DET -16.5', 'DET -10', [-105, -115]); assert.ok(x.b.abbr === 'CHI' && x.b.line === 16.5); assert.strictEqual(x.w.lock.id, '403', '16.5 -> 10: the Lock does not move to another game'); assert.strictEqual(x.w.lock.abbr, 'CHI'); assert.strictEqual(x.w.lock.line, 10); assert.strictEqual(x.w.lock.o, -115);
      assert.ok(dog(x.w, '403').final && dog(x.w, '403').line === 10 && dog(x.w, '403').o === -115, 'Lock and road dog: one line, one price'); assert.ok(!x.w.lockOut.includes('403'));
      // ... and all the way through zero to road favourite by 3 -> still the road team, now -3
      x = await late21(big, 'DET -16.5', 'CHI -3', [100, -120]); assert.strictEqual(x.w.lock.id, '403'); assert.strictEqual(x.w.lock.abbr, 'CHI', '16.5 -> -3: not flipped to the home team'); assert.strictEqual(x.w.lock.line, -3); assert.strictEqual(x.w.lock.o, -120); assert.strictEqual(x.w.lock.dog, false);
      // --- 22 (v253, Nov 16 2026) THE RULE: a live Lock changes game or team only on a clean tick (previous tick at most 5 minutes ago, no late line, no source
      //     flip with a new number, its own game not more than 5 minutes past its mark, not held). Otherwise it is carried: same game, same team.
      //     Each case below fails on d7b044f (run there one by one with ALERT_T22=list) and passes now. ---
      const C22 = { 402: 0.9, 403: 0.8, 404: 0.6, 405: 0.5, 401: 0.4 }, C22L = { 402: 0.9, 405: 0.8, 403: 0.7, 404: 0.6, 401: 0.4 }; // #1 = 402 (Sunday 1pm); Lock = 403 (same slot) or 405 (later slot)
      const idt = (L) => [L.id, L.abbr], h22 = (id) => SCHED.find((g) => g.id === id), drop22 = (id) => { SCHED = SCHED.filter((g) => g.id !== id); };
      const live22 = async (conf, lockId) => { fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, conf); NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 4 * 3600e3; await A.tick(); const b = stored(2).lock; assert.ok(b.id === lockId && !b.final, 'setup: live Lock on ' + lockId + ' on Sunday morning'); return b; };
      const frozenOn403 = (r, b, msg) => { assert.deepStrictEqual(idt(r.lock), idt(b), msg + ': same game and team'); assert.ok(r.lock.final && r.lock.late === 1 && r.lock.pre === true && !r.lock.nl, msg + ': final on its own game, flagged late'); assert.strictEqual(r.lock.line, 6.5); assert.strictEqual(r.lock.o, -108); assert.ok(dog(r, '403').final && dog(r, '403').line === 6.5 && dog(r, '403').o === -108, msg + ': Lock and road dog share line and price'); assert.ok(!r.lockOut.includes('403') && r.lockOut.includes('402') && r.lockOut.includes('404')); };
      const T22 = {
        // T1a: the #1 game (same 1pm slot) moves 4 -> 3.5 while the server is away 9:00 -> 12:30; the Lock's own line is untouched. Was: Lock moved to the next game, FINAL.
        'T1a late line on the #1, same slot': async () => { const b = await live22(C22, '403'), top0 = (stored(2).top || {}).id; set('402', 'GB -3.5'); NOW = KS - 30 * MIN; await A.tick(); const r = stored(2); assert.ok(r.gl['402'].l === 3.5 && r.gl['402'].lt > KS - 60 * MIN, 'the #1 line was read late'); frozenOn403(r, b, 'T1a'); assert.strictEqual(top0, '402', 'the #1 slot is stored by game id'); assert.strictEqual(r.top.id, '402', 'the #1 keeps its slot though it cannot be ranked'); },
        // T1h: the same, waking only 6 minutes after the mark
        'T1h late line on the #1, 6 minutes past the mark': async () => { const b = await live22(C22, '403'); set('402', 'GB -3.5'); NOW = KS - 54 * MIN; await A.tick(); frozenOn403(stored(2), b, 'T1h'); },
        // T2: the Lock is on the LATER game (405); the #1 at 1pm gets a late line. Was: Lock moved to a 1pm game and froze there.
        'T2 late line on the #1, Lock in a later slot': async () => { const b = await live22(C22L, '405'); set('402', 'GB -3.5'); NOW = KS - 30 * MIN; await A.tick(); let r = stored(2); assert.deepStrictEqual(idt(r.lock), idt(b), 'T2: same game and team'); assert.ok(!r.lock.final, 'T2: still live (its own mark is hours away)'); assert.deepStrictEqual(r.lockOut.slice().sort(), ['401', '402', '403', '404']); NOW = KN - 59 * MIN; await A.tick(); r = stored(2); assert.ok(r.lock.final && r.lock.id === '405', 'T2: final at its own mark'); },
        // T3: restart with no line move: the book cache is lost, every line now comes from ESPN with the SAME number. Was: lt reset, the #1 counted as late, Lock moved.
        'T3 restart, source flips books -> ESPN, same numbers': async () => {
          fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, C22L); const bkAll = () => (books = { at: NOW - 5 * MIN, games: SCHED.filter((g) => g.wk === 2 && g.odds).map((g) => { const l = +g.odds.split('-')[1]; return { home: g.home, away: g.away, start: g.date, line: l, n: 1, books: [bk(l, -110, -110)] }; }) });
          NOW = K1 - 59 * MIN; bkAll(); await A.tick(); NOW = KS - 4 * 3600e3; bkAll(); await A.tick(); let r = stored(2); const b = r.lock, lt0 = r.gl['402'].lt; assert.ok(b.id === '405' && !b.final && r.gl['402'].s === 'books');
          A._reset(); books = null; NOW = KS - 30 * MIN; await A.tick(); r = stored(2); assert.strictEqual(r.gl['402'].s, 'espn', 'T3: the source flipped'); assert.strictEqual(r.gl['402'].lt, lt0, 'T3: lt is keyed on the number, not on the source'); assert.ok(!r.gl['402'].late || r.gl['402'].lt <= KS - 60 * MIN);
          assert.deepStrictEqual(idt(r.lock), idt(b), 'T3: same game and team after the restart'); assert.ok(!r.lock.final); NOW += MIN; await A.tick(); NOW = KN - 59 * MIN; await A.tick(); r = stored(2); assert.ok(r.lock.final && r.lock.id === '405', 'T3: final on its own game');
        },
        // (4) outage across the Lock's mark, its own line read in time and unchanged; a game NOT yet at its mark now ranks second. Was: Lock left its game 30 minutes past its mark.
        'gap across the mark, another game now ranks 2nd': async () => { const b = await live22(C22, '403'); CONF[405] = 0.85; NOW = KS - 30 * MIN; await A.tick(); const r = stored(2); assert.ok(r.gl['403'].lt <= KS - 60 * MIN, "the Lock's own line was read in time"); frozenOn403(r, b, 'gap'); },
        // the same outage before any Sunday mark: the wake tick carries the Lock, the next tick (clean) may move it
        'gap before the mark: carried on the wake tick, re-ranked on the next': async () => { fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, C22); NOW = K1 + 864e5; await A.tick(); NOW += MIN; await A.tick(); const b = stored(2).lock; assert.strictEqual(b.id, '403'); CONF[405] = 0.85; NOW += 3 * 3600e3; await A.tick(); assert.deepStrictEqual(idt(stored(2).lock), idt(b), 'wake tick after 3 hours away: carried'); NOW += MIN; await A.tick(); assert.strictEqual(stored(2).lock.id, '405', 'next tick, one minute later: the ranking decides again'); },
        // a restart is an outage of unknown length
        'restart: carried on the first tick': async () => { fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, C22); NOW = K1 + 864e5; await A.tick(); NOW += MIN; await A.tick(); const b = stored(2).lock; CONF[405] = 0.85; A._reset(); NOW += MIN; await A.tick(); assert.deepStrictEqual(idt(stored(2).lock), idt(b), 'first tick after a restart: carried'); NOW += MIN; await A.tick(); assert.strictEqual(stored(2).lock.id, '405'); },
        // a source flip that changes a number is not in-time information on that tick; one that keeps the number is
        'source flip with a new number: carried on that tick': async () => {
          fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, C22); NOW = K1 - 3 * 3600e3 - 5 * MIN; await A.tick(); NOW += 5 * MIN; await A.tick(); const b = stored(2).lock; assert.strictEqual(b.id, '403');
          CONF[404] = 0.85; NOW += 5 * MIN; books = { at: NOW - MIN, games: [{ home: 'NE', away: 'MIA', start: h22('404').date, line: 2.5, n: 1, books: [bk(2.5, -110, -110)] }] }; await A.tick(); let r = stored(2); assert.ok(r.gl['404'].s === 'books' && r.gl['404'].l === 2.5); assert.deepStrictEqual(idt(r.lock), idt(b), 'flip tick (ESPN 1.5 -> books 2.5): carried');
          NOW += MIN; books.at = NOW - MIN; await A.tick(); assert.strictEqual(stored(2).lock.id, '404', 'next tick: re-ranked');
          CONF[404] = 0.6; CONF[405] = 0.85; books.games[0].line = 1.5; books.games[0].books = [bk(1.5, -110, -110)]; NOW += 5 * MIN; books.at = NOW - MIN; await A.tick(); NOW += MIN; books.at = NOW - MIN; await A.tick(); assert.strictEqual(stored(2).lock.id, '405'); const lt1 = stored(2).gl['404'].lt;
          CONF[405] = 0.5; books = null; NOW += 5 * MIN; await A.tick(); r = stored(2); assert.ok(r.gl['404'].s === 'espn' && r.gl['404'].l === 1.5 && r.gl['404'].lt === lt1, 'same number from the other source: lt kept'); assert.strictEqual(r.lock.id, '403', 'a flip with the same number is a clean tick: the ranking decides');
        },
        // the #1 slot is a stored game, not a position: the #1 leaving the schedule does not promote the Lock's game into the skipped slot
        'the #1 leaves the schedule: the Lock does not hop': async () => { fresh16(); TR.pickOf = keep21; CONF = Object.assign({}, C22); NOW = K1 - 3 * 3600e3 - 5 * MIN; await A.tick(); NOW += 5 * MIN; await A.tick(); const b = stored(2).lock; assert.strictEqual(b.id, '403'); drop22('402'); NOW += 5 * MIN; await A.tick(); let r = stored(2); assert.deepStrictEqual(idt(r.lock), idt(b), 'clean tick, #1 postponed: the Lock stays'); assert.strictEqual(r.top.id, '402'); CONF[404] = 0.95; NOW += MIN; await A.tick(); r = stored(2); assert.strictEqual(r.top.id, '404', 'a rankable game that out-ranks the stored #1 takes the slot'); assert.strictEqual(r.lock.id, '403'); },
        // D5 on the exception path: the Lock's game is off the schedule at a late wake -> the Lock moves on, but never onto a game already past its mark
        "the Lock's game is gone at a late wake: not onto a game past its mark": async () => { await live22(C22, '403'); drop22('403'); NOW = KS - 30 * MIN; await A.tick(); const r = stored(2); assert.strictEqual(r.lock.id, '405', 'moved on to the game still ahead of its mark'); assert.ok(!r.lock.final); assert.ok(r.lockOut.includes('404') && r.lockOut.includes('402')); },
        // (1) a carried Lock the model no longer takes at the frozen line shows no % (was: the old number)
        'stale confidence: none when the model no longer takes that team': async () => {
          fresh16(); const h = h22('403'); h.odds = 'DET -0.5'; h.op = [-110, -110]; TR.pickOf = (g) => (g.id === '403' ? fav(g) : keep21(g)); CONF = { 401: 0.9, 402: 0.7, 404: 0.6, 405: 0.5 };
          NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 4 * 3600e3; await A.tick(); const b = stored(2).lock; assert.ok(b.id === '403' && b.abbr === 'DET' && b.conf === 0.8); h.odds = 'CHI -0.5'; h.op = [-120, 100]; NOW = KS - 30 * MIN; await A.tick(); const r = stored(2);
          assert.ok(r.lock.final && r.lock.abbr === 'DET' && r.lock.line === 0.5 && r.lock.o === -120); assert.strictEqual(r.lock.conf, null, 'no % for a team the model does not take at that line');
          const v = A.view({ 2: r }, null)['2']; assert.strictEqual(v.lock.conf, null); const PLc = PL.compose(r.lock, r.dogs.map((d) => ({ id: d.id, p: d.p }))); assert.ok(PLc, 'parlays still compose');
        },
        // (2) a held Lock (inputs incomplete, own line read late) whose kickoff then moves a day is not re-ranked (was: flipped to the other team)
        'held Lock, kickoff moved a day: not re-ranked': async () => {
          fresh16(); g108.st = 'in'; const h = h22('403'); h.odds = 'DET -3'; h.op = [-110, -110]; TR.pickOf = (g) => (g.id === '403' ? fav(g) : keep21(g)); CONF = { 401: 0.9, 402: 0.7, 404: 0.6, 405: 0.5 };
          try { NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 4 * 3600e3; await A.tick(); const b = stored(2).lock; assert.ok(b.id === '403' && b.abbr === 'DET'); h.odds = 'CHI -1'; h.op = [-120, 100]; NOW = KS - 30 * MIN; await A.tick(); let r = stored(2);
            assert.ok(!r.lock.final && r.lockWait === '403' && r.lock.abbr === 'DET' && r.lock.line === 1 && r.lock.part === 1, 'held on its own game and team at the frozen line');
            h.date = new Date(KS + 864e5).toISOString(); NOW = KS - 25 * MIN; await A.tick(); r = stored(2); assert.deepStrictEqual(idt(r.lock), idt(b), 'kickoff moved a day while held: same game and team'); assert.ok(r.lockWait === '403' && !r.lock.final && r.lock.line === 1);
            h.st = 'in'; NOW = KS + 864e5 + MIN; await A.tick(); r = stored(2); assert.ok(r.lock.final && r.lock.abbr === 'DET' && r.lock.line === 1 && r.lock.pre === false && !r.lockWait, 'frozen at the new kickoff'); } finally { g108.st = 'post'; }
        },
        // (3) the held game leaves the schedule: the Lock moves on and nothing stays held (was: lockWait kept, the Lock snapped back when the game returned)
        'held game leaves the schedule: lockWait cleared': async () => {
          fresh16(); g108.st = 'in'; TR.pickOf = keep21; CONF = Object.assign({}, C22);
          try { NOW = K1 - 59 * MIN; await A.tick(); NOW = KS - 64 * MIN; await A.tick(); NOW = KS - 59 * MIN; await A.tick(); let r = stored(2); assert.ok(r.lock.id === '403' && r.lockWait === '403' && !r.lock.final, 'held at its mark');
            const g403 = h22('403'); drop22('403'); NOW = KS - 54 * MIN; await A.tick(); r = stored(2); assert.strictEqual(r.lock.id, '405', 'postponed: the Lock moves on (defined exception)'); assert.ok(!r.lockWait, 'nothing is held any more');
            CONF[403] = 0.45; g403.date = new Date(KM + 864e5).toISOString(); SCHED.push(g403); NOW = KS + 2 * 3600e3; await A.tick(); NOW += 5 * MIN; await A.tick(); NOW += MIN; await A.tick(); r = stored(2); assert.strictEqual(r.lock.id, '405', 'the game comes back ranked below the Lock: the Lock does not snap back'); assert.ok(!r.lockWait); } finally { g108.st = 'post'; }
        },
      };
      const bad22 = []; for (const k of Object.keys(T22)) { try { await T22[k](); if (process.env.ALERT_T22) console.log('  22 pass: ' + k); } catch (e) { bad22.push(k + ' -> ' + String(e.message).split('\n')[0]); if (process.env.ALERT_T22) console.log('  22 FAIL: ' + k + ' -> ' + String(e.message).split('\n')[0]); } }
      if (process.env.ALERT_T22) console.log(`  section 22: ${Object.keys(T22).length - bad22.length} of ${Object.keys(T22).length} cases pass`); else assert.deepStrictEqual(bad22, [], 'section 22 (THE RULE)');
      TR.pickOf = keep21;
    } finally { TR.pickOf = keepT.pickOf; TR.dogCover = keepT.dogCover; H.win = keepW; }
    // --- 17 (v252 review fixes) ---
    const OLD = { lock: { id: '911', abbr: 'KC', line: 3, conf: 0.6 }, dogs: [], helper: null, t: 1, pre: true };
    assert.ok(!A.view({ 11: OLD }, null)['11'], 'an old-format (phone-frozen) week after 10 is not served as official'); assert.ok(A.view({ 10: OLD }, null)['10'].lock.final, 'week 10 (phone-frozen under v248) is still final');
    A._reset(); db = { 'lock:alert26': { id: 'lock:alert26', data: { weeks: { 11: OLD } }, updated: 3 } }; const g11 = SCHED.find((g) => g.id === '911'); g11.odds = 'BUF -3'; NOW = Date.parse(g11.date) - 2 * 864e5; await A.tick();
    assert.strictEqual(stored(11).v, 2, 'an old-format week 11 is recomputed by the server'); assert.ok(logs.some((m) => /old-format record/.test(m)));
    assert.strictEqual(A.view({ 12: { v: 2, gl: {}, dogs: [], fix: [{ t: 1, why: 'private note', n: 1, src: 'manual' }] } }, null)['12'].fix[0].why, undefined, "the owner's fix note is not in the public GET");
    const kid = require('child_process').execFileSync(process.execPath, ['-e', "const fs=require('fs'),o=fs.readFileSync;fs.readFileSync=(p,...a)=>/trophy-model/.test(String(p))?'{}':o(p,...a);const A=require('./odds-api/alert.js');A.tick().then(()=>console.log(JSON.stringify(A._state().TK)))"], { cwd: require('path').join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    x = JSON.parse(kid.trim().split('\n').pop()); assert.ok(x.ok === false && /picks disabled: trophy-model\.json/.test(x.err), 'a broken data file does not crash the server and stops all computing');
    // --- 19 (v253 review fix 6, owner D7): Move the line never assumes -110. No stored price -> only each line's own break-even price, no comparison ---
    const LM = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'pics', 'linemove.json'))), np = PL.ladder({ line: 2.5, p: 0.55, price: null }, LM), w110 = PL.ladder({ line: 2.5, p: 0.55, price: -110 }, LM);
    assert.strictEqual(np.real, false); assert.strictEqual(np.px, null, 'no -110 stand-in'); np.rows.forEach((r, i) => { assert.ok(Math.abs(r.d - (1 + r.l / r.w)) < 1e-12 && r.be === true && r.pd === null, 'break-even only'); assert.notStrictEqual(r.price, w110.rows[i].price); });
    assert.ok(Math.abs(np.base.be - (1 + np.base.l / np.base.w)) < 1e-12); assert.strictEqual(w110.real, true); assert.ok(w110.rows.every((r) => !r.be));
    if (CHK.V.length) console.log(CHK.V.map((v) => '  VIOLATION ' + v).join('\n')); if (!process.env.ALERT_T22) assert.strictEqual(CHK.V.length, 0, 'before/after checker: Lock invariants held on every tick of this file'); console.log(CHK.report('alert.test.js'));
    console.log('alert.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.stack || e.message); process.exitCode = 1; }
  srv.close();
});
