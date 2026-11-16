// Run: node odds-api/alert.test.js   (no network: Supabase, ESPN and the sign-in check are replaced by in-memory fakes)
const assert = require('assert'), http = require('http'), A = require('./alert');
const db = {}; let failPatch = 0;
A._deps.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (failPatch) { failPatch--; db[id].data = { weeks: { 10: { other: 'phone', lock: { id: '1' }, dogs: [], helper: null } } }; db[id].updated = 777; return false; } if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; },
};
let NOW = Date.parse('2026-11-11T12:00:00Z'), ok = true, espn = { week: { number: 10 }, season: { type: 2, year: 2026 }, events: [['1', 'NYG', 'WSH', '2026-11-13T01:15Z'], ['2', 'GB', 'MIN', '2026-11-15T18:00Z'], ['3', 'TEN', 'JAX', '2026-11-15T18:00Z']].map(([id, h, a, d]) => ({ id, date: d, competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: h } }, { homeAway: 'away', team: { abbreviation: a } }] }] })) };
A._deps.now = () => NOW; A._deps.check = async (req) => ok && req.headers['x-token'] === 'good'; A._deps.fetch = async () => ({ ok: true, json: async () => espn });
const srv = http.createServer(async (req, res) => { if (!(await A.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
const call = async (port, method, bodyObj, tok) => { const r = await fetch('http://127.0.0.1:' + port + '/alert', { method, headers: { 'content-type': 'application/json', 'x-token': tok === undefined ? 'good' : tok }, body: bodyObj ? JSON.stringify(bodyObj) : undefined }); return { s: r.status, j: await r.json() }; };
const REC = { lock: { id: '2', abbr: 'MIN', other: 'GB', line: 2.5, conf: 0.56123, dog: true }, dogs: [{ id: '2', line: 2.5, p: 0.5612 }, { id: '1', line: 1.5, p: 0.4821 }], helper: { id: '3', abbr: 'JAX', conf: 0.78 } };
srv.listen(0, async () => {
  const P = srv.address().port; let r;
  try {
    r = await call(P, 'GET'); assert.deepStrictEqual(r.j.weeks, {}, 'empty at first');
    r = await call(P, 'POST', { week: 10, rec: REC }, 'bad'); assert.strictEqual(r.s, 401, 'needs sign-in');
    r = await call(P, 'POST', { week: 11, rec: REC }); assert.strictEqual(r.s, 409, 'only the current week'); assert.strictEqual(r.j.current, 10);
    r = await call(P, 'POST', { week: 10, rec: { ...REC, lock: { ...REC.lock, id: '99' } } }); assert.strictEqual(r.s, 400, 'unknown game refused');
    r = await call(P, 'POST', { week: 10, rec: { ...REC, lock: { ...REC.lock, abbr: 'DAL' } } }); assert.strictEqual(r.s, 400, 'wrong team refused');
    r = await call(P, 'POST', { week: 10, rec: { ...REC, dogs: [{ id: '2', line: -3, p: 0.6 }] } }); assert.strictEqual(r.s, 400, 'dog line must be positive');
    r = await call(P, 'POST', { week: 10, rec: { ...REC, helper: null } }); assert.strictEqual(r.s, 400, 'incomplete record refused');
    r = await call(P, 'POST', { week: 10, rec: { ...REC, lock: { ...REC.lock, id: '1', abbr: 'WSH' } } }); assert.strictEqual(r.s, 400, 'the app never sends WSH');
    r = await call(P, 'GET'); assert.deepStrictEqual(r.j.weeks, {}, 'nothing stored by refused posts');
    r = await call(P, 'POST', { week: 10, rec: REC }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.created, true); assert.strictEqual(r.j.rec.pre, true, 'before first kickoff'); assert.strictEqual(r.j.rec.lock.conf, 0.5612); assert.deepStrictEqual(r.j.rec.dogs[1], { id: '1', abbr: 'WAS', home: 'NYG', line: 1.5, p: 0.4821 }, 'teams come from ESPN, with the app spelling (WSH -> WAS)');
    const first = r.j.rec;
    NOW += 30000; // past the 20 s read cache
    r = await call(P, 'POST', { week: 10, rec: { ...REC, lock: { id: '3', abbr: 'TEN', other: 'JAX', line: -3, conf: 0.6, dog: false } } }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.created, false, 'second phone does not overwrite'); assert.deepStrictEqual(r.j.rec, first, 'second phone gets the first copy');
    r = await call(P, 'GET'); assert.deepStrictEqual(r.j.weeks['10'], first, 'everyone reads the first copy');
    delete db['lock:alert26']; A._reset();
    r = await call(P, 'POST', { week: 10, rec: { ...REC, lock: { id: '1', abbr: 'WAS', other: 'NYG', line: 1.5, conf: 0.55, dog: true } } }); assert.strictEqual(r.s, 200, 'WAS (app spelling) matches ESPN WSH'); assert.strictEqual(r.j.rec.lock.other, 'NYG');
    // a week frozen after its first kickoff is flagged pre:false
    delete db['lock:alert26']; A._reset(); NOW = Date.parse('2026-11-15T12:00:00Z');
    r = await call(P, 'POST', { week: 10, rec: REC }); assert.strictEqual(r.j.created, true); assert.strictEqual(r.j.rec.pre, false, 'late freeze is flagged');
    // lost race: another phone wrote between our read and write -> we return THEIR copy
    delete db['lock:alert26']; A._reset(); failPatch = 1;
    r = await call(P, 'POST', { week: 10, rec: REC }); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.created, false); assert.strictEqual(r.j.rec.other, 'phone', 'loser of a race gets the winner copy');
    // wrong season / off-season refused
    delete db['lock:alert26']; A._reset(); espn.season.type = 3; r = await call(P, 'POST', { week: 10, rec: REC }); assert.strictEqual(r.s, 409, 'playoffs refused'); espn.season.type = 2;
    A._reset(); A._deps.fetch = async () => { throw new Error('down'); }; r = await call(P, 'POST', { week: 10, rec: REC }); assert.strictEqual(r.s, 503, 'ESPN down -> 503, nothing stored'); assert.ok(!db['lock:alert26'] || !Object.keys(db['lock:alert26'].data.weeks).length);
    console.log('alert.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  srv.close();
});
