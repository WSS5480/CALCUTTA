// Run: node odds-api/osmfall.test.js   (no network: every outside call is an in-memory fake, the clock is a fake)
// The plumbing shared by courts.js and golfcourse.js: the OSM API -> Overpass converter, the ONE 1-a-second queue, the "Overpass is busy" memory.
const assert = require('assert'), http = require('http'), F = require('./osmfall'), C = require('./courts'), GC = require('./golfcourse');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }, eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };

// ---------- 1. toElements: a hand-typed answer in the shape of api.openstreetmap.org/api/0.6/map.json ----------
const MAPJSON = { version: '0.6', generator: 'openstreetmap-cgimap', copyright: 'OpenStreetMap and contributors', attribution: 'http://www.openstreetmap.org/copyright', license: 'http://opendatacommons.org/licenses/odbl/1-0/',
  bounds: { minlat: 26.2, minlon: -98.231, maxlat: 26.201, maxlon: -98.23 },
  elements: [
    { type: 'node', id: 1, lat: 26.2000, lon: -98.2310, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1 },
    { type: 'node', id: 2, lat: 26.2000, lon: -98.2300, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1 },
    { type: 'node', id: 3, lat: 26.2010, lon: -98.2300, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1 },
    { type: 'node', id: 4, lat: 26.2010, lon: -98.2310, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1 },
    { type: 'node', id: 5, lat: 26.2005, lon: -98.2305, timestamp: '2020-01-01T00:00:00Z', version: 2, changeset: 2, user: 'a', uid: 1, tags: { golf: 'pin' } },
    { type: 'node', id: 6, lat: 26.2002, lon: -98.2308, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, tags: {} },
    { type: 'way', id: 10, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, nodes: [1, 2, 3, 4, 1], tags: { golf: 'green' } },
    { type: 'way', id: 11, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, nodes: [1, 3], tags: { golf: 'hole', ref: '4', par: '3' } },
    { type: 'way', id: 12, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, nodes: [2, 3, 4, 2] },
    { type: 'way', id: 13, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, nodes: [1, 99, 2], tags: { highway: 'path' } }, // node 99 is not in the answer
    { type: 'way', id: 14, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, nodes: [98, 99], tags: { golf: 'bunker' } }, // none of its nodes are
    { type: 'relation', id: 20, timestamp: '2020-01-01T00:00:00Z', version: 1, changeset: 1, user: 'a', uid: 1, members: [{ type: 'way', ref: 12, role: 'outer' }, { type: 'node', ref: 5, role: '' }, { type: 'way', ref: 777, role: 'inner' }], tags: { type: 'multipolygon', golf: 'water_hazard' } }
  ] };
const P = { 1: { lat: 26.2, lon: -98.231 }, 2: { lat: 26.2, lon: -98.23 }, 3: { lat: 26.201, lon: -98.23 }, 4: { lat: 26.201, lon: -98.231 } }, BB = { minlat: 26.2, minlon: -98.231, maxlat: 26.201, maxlon: -98.23 };
eq(F.toElements(MAPJSON), [
  { type: 'node', id: 5, lat: 26.2005, lon: -98.2305, tags: { golf: 'pin' } }, // only nodes with tags are things; the others are just corners
  { type: 'way', id: 10, bounds: BB, geometry: [P[1], P[2], P[3], P[4], P[1]], tags: { golf: 'green' } },
  { type: 'way', id: 11, bounds: BB, geometry: [P[1], P[3]], tags: { golf: 'hole', ref: '4', par: '3' } },
  { type: 'way', id: 12, bounds: BB, geometry: [P[2], P[3], P[4], P[2]] },
  { type: 'way', id: 13, bounds: { minlat: 26.2, minlon: -98.231, maxlat: 26.2, maxlon: -98.23 }, geometry: [P[1], P[2]], tags: { highway: 'path' } },
  { type: 'relation', id: 20, bounds: BB, members: [{ type: 'way', ref: 12, role: 'outer', geometry: [P[2], P[3], P[4], P[2]] }, { type: 'node', ref: 5, role: '', lat: 26.2005, lon: -98.2305 }, { type: 'way', ref: 777, role: 'inner' }], tags: { type: 'multipolygon', golf: 'water_hazard' } }
], 'nodes + ways with node ids + relations with refs -> what Overpass "out geom" gives');
eq(F.toElements(null), []); eq(F.toElements({}), []); eq(F.toElements({ elements: [null, 5, { type: 'way', id: 1 }, { type: 'node', id: 2, lat: '26', lon: 1, tags: { a: 'b' } }] }), [], 'junk in, nothing out');
// small helpers
eq(F.viewbox(26.2, -98.23, 16).split(',').length, 4); { const [l, t, r, b] = F.viewbox(26.2, -98.23, 16).split(',').map(Number); ok(l < r && b < t && Math.abs((t - b) * 69.05 - 32) < 0.01 && Math.abs((l + r) / 2 + 98.23) < 1e-4 && Math.abs((t + b) / 2 - 26.2) < 1e-4, 'left,top,right,bottom, centred, 16 miles each way'); }
{ const [l, t, r, b] = F.viewbox(89.99, 179.9, 50).split(',').map(Number); ok(t <= 90 && r <= 180 && l >= -180 && b >= -90, 'never off the map'); }
eq([F.osmId({ osm_type: 'way', osm_id: 12 }), F.osmId({ osm_type: 'R', osm_id: '7' }), F.osmId({ osm_type: 'node', osm_id: 0 }), F.osmId({ osm_type: 'area', osm_id: 5 }), F.osmId(null), F.osmId({ osm_type: 'way', osm_id: '1;drop' })], ['way/12', 'relation/7', '', '', '', '']);
eq(F.bbox({ boundingbox: ['26.1', '26.3', '-98.4', '-98.2'] }), { minlat: 26.1, maxlat: 26.3, minlon: -98.4, maxlon: -98.2 }, 'Nominatim: south, north, west, east'); eq([F.bbox({ boundingbox: ['a', '1', '2', '3'] }), F.bbox({ boundingbox: ['2', '1', '2', '3'] }), F.bbox({}), F.bbox(null)], [null, null, null, null]);
eq([F.TIMEOUT, F.BUDGET, F.DOWN_TTL, F.GAP, F.OVERPASS.length], [8000, 18000, 600000, 1100, 4]);

// ---------- 2. courts.js + golfcourse.js in ONE process: one queue, one "Overpass is busy" memory ----------
let NOW = Date.parse('2026-11-17T04:00:00Z'), reqs = [], live = 0, most = 0, overDown = true;
const J = (o, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => o });
const clock = { now: () => NOW, sleep: async (ms) => { NOW += ms; }, log: () => {} };
Object.assign(C._deps, clock, { env: () => undefined, maReady: () => false, ma: async () => ({ ok: false, status: 404, j: {} }) }); Object.assign(GC._deps, clock, { hasDb: () => false });
const fake = (who) => async (u, opt) => {
  const host = new URL(u).host; reqs.push({ who, host, at: NOW, u, ua: (opt.headers || {})['User-Agent'] });
  if (/interpreter/.test(u)) { if (overDown) throw new Error('fetch failed'); return J({ elements: [] }); }
  live++; most = Math.max(most, live); await new Promise((r) => setImmediate(r)); live--; // a request "in flight": the queue must never start a second one meanwhile
  if (host === 'nominatim.openstreetmap.org') return J(/viewbox=/.test(u) ? [] : [{ lat: '26.2', lon: '-98.23', display_name: 'McAllen, Hidalgo County, Texas, United States' }]);
  if (host === 'api.openstreetmap.org') return J({}, 404);
  throw new Error('unexpected ' + u);
};
C._deps.fetch = fake('courts'); GC._deps.fetch = fake('golf');
const srv = http.createServer(async (req, res) => { if (!(await C.handle(req, res)) && !(await GC.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, get = async (p) => { const r = await fetch('http://127.0.0.1:' + port + p); return { s: r.status, j: await r.json() }; };
  try {
    C._reset(); GC._reset();
    // three people at once: a court search, a golf search and a golf course's holes, with Overpass down
    const [a, b, c] = await Promise.all([get('/courts?q=McAllen,%20TX'), get('/golfcourse/search?q=Mission,%20TX'), get('/golfcourse/holes?id=way/123')]);
    eq([a.s, a.j.partial, a.j.count], [200, true, 0]); eq([b.s, b.j.partial, b.j.count], [200, true, 0]); eq(c.s, 404);
    const osm = reqs.filter((r) => r.host === 'nominatim.openstreetmap.org' || r.host === 'api.openstreetmap.org').sort((x, y) => x.at - y.at);
    eq(osm.filter((r) => r.host === 'nominatim.openstreetmap.org').length, 8, 'courts: place + 3 searches; golf: place + 3 searches (2 + the bracket spelling, since nothing was found)'); eq(osm.filter((r) => r.host === 'api.openstreetmap.org').length, 1, 'holes: the course itself (404)');
    ok(new Set(osm.map((r) => r.who)).size === 2, 'both modules used the queue');
    for (let i = 1; i < osm.length; i++) ok(osm[i].at - osm[i - 1].at >= 1100, 'ONE queue for courts + golf, Nominatim + the OSM API: request ' + i + ' started ' + (osm[i].at - osm[i - 1].at) + ' ms after the one before');
    eq(most, 1, 'never two requests in flight at once'); ok(osm.every((r) => /^Oddable\/1\.0 \(.+; https:\/\/oddable\.onrender\.com\)$/.test(r.ua)), 'a real User-Agent on every request');
    // Overpass: the three requests ran at once, so each found out for itself (2 servers each); from then on nobody asks it for 10 minutes
    const over = () => reqs.filter((r) => /interpreter/.test(r.u)); ok(over().length >= 2 && over().length <= 6, 'Overpass tries: ' + over().length); ok(F.down(clock), 'marked busy');
    const o0 = over().length; overDown = false;
    await get('/courts?lat=27.5&lon=-99.5'); await get('/golfcourse/search?lat=27.5&lon=-99.5'); await get('/golfcourse/holes?id=way/124');
    eq(over().length, o0, 'courts failed it, golf does not ask it either (and the other way round): one shared memory');
    NOW += 9 * 6e4; await get('/courts?lat=28.5&lon=-99.5'); eq(over().length, o0, 'minute 9: still left alone');
    NOW += 6e4 + 1; ok(!F.down(clock)); const g = await get('/golfcourse/search?lat=28.5&lon=-99.5'); eq(over().length, o0 + 1, 'after 10 minutes Overpass is asked again'); eq([g.s, g.j.partial, g.j.count], [200, undefined, 0]);
    const k = await get('/courts?lat=29.5&lon=-99.5'); eq([k.s, k.j.partial], [200, undefined]); eq(over()[over().length - 1].host, over()[over().length - 2].host, 'the server that answered golf is asked first by courts');
    // the two servers that were not tried go first after a busy spell
    C._reset(); GC._reset(); reqs = []; overDown = true; await get('/courts?lat=30.5&lon=-99.5'); eq(over().map((r) => r.host), ['overpass-api.de', 'overpass.private.coffee']);
    NOW += 10 * 6e4 + 1; await get('/courts?lat=31.5&lon=-99.5'); eq(over().slice(2).map((r) => r.host), ['overpass.kumi.systems', 'maps.mail.ru'], 'the other two');
    NOW += 10 * 6e4 + 1; await get('/courts?lat=32.5&lon=-99.5'); eq(over().slice(4).map((r) => r.host), ['overpass-api.de', 'overpass.private.coffee'], 'and round again');
    // a crowd: the queue holds 12, the rest are told "busy" at once instead of waiting minutes
    F._reset(); let gate; const hold = new Promise((r) => { gate = r; }), jobs = []; for (let i = 0; i < 14; i++) jobs.push(F.turn(clock, () => hold).then(() => 'ran', (e) => (e.busy ? 'busy' : 'error')));
    gate(); const done = await Promise.all(jobs); eq([done.filter((x) => x === 'ran').length, done.filter((x) => x === 'busy').length], [12, 2]); eq(F._state().waiting, 0);
    console.log('osmfall.test.js: ' + n + ' checks passed');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  srv.close();
});
