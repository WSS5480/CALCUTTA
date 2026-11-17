// HAND-MADE course for the Golf GPS tests (scripts/golfgps/golfgps.test.js and shots.js). It is built by running the server's own code
// (odds-api/golfcourse.js _build) on hand-placed OpenStreetMap-shaped elements, so the phone tests read exactly what the server would send.
// Not a real course. Origin 26.2 N, 98.23 W; positions are metres east / north of it.
//   Hole 1: par 4, due north, tee (0,0) -> square green 24 m deep centred (0,300); a bunker beside it.
//   Hole 2: par 3, north-east, tee (60,60) -> green 30 m deep x 20 m wide turned 45 degrees, centred (200,200).
//   Hole 3: par 5, north, tee (500,0); NO green drawn (line ends (500,400), a mapped pin at (500,395)).
//   Hole 7: a numbered green at (700,700) with no hole line (no tee, no Short / Long).  Holes 4-6, 8-18: nothing on the map.
const GC = require('../../odds-api/golfcourse.js'), G = GC.geom;
const O = { lat: 26.2, lon: -98.23 }, at = (e, n, o) => G.fromXY({ x: e, y: n }, o || O);
const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
const rect = (c, deep, wide, a) => [[-deep / 2, -wide / 2], [deep / 2, -wide / 2], [deep / 2, wide / 2], [-deep / 2, wide / 2], [-deep / 2, -wide / 2]].map(([x, y]) => { const r = rot(x, y, a); return at(r.x, r.y, c); });
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: pts.map((p) => ({ lat: p.lat, lon: p.lon })) });
const SQ = [at(-100, -100), at(900, -100), at(900, 900), at(-100, 900), at(-100, -100)];
const COURSE = way(100, { leisure: 'golf_course', name: 'Test Links', holes: '18' }, SQ);
const ELS = [
  way(1, { golf: 'hole', ref: '1', par: '4', handicap: '7' }, [at(0, 0), at(0, 150), at(0, 302)]),
  way(2, { golf: 'hole', ref: '2', par: '3' }, [at(60, 60), at(193, 193)]),
  way(3, { golf: 'hole', ref: '3', par: '5' }, [at(500, 0), at(500, 400)]),
  way(11, { golf: 'green' }, rect(at(0, 300), 24, 24, Math.PI / 2)), way(12, { golf: 'green' }, rect(at(200, 200), 30, 20, Math.PI / 4)), way(17, { golf: 'green', ref: '7' }, rect(at(700, 700), 20, 20, 0)),
  way(21, { golf: 'bunker' }, rect(at(20, 280), 8, 8, 0)),
  { type: 'node', id: 41, lat: at(500, 395).lat, lon: at(500, 395).lon, tags: { golf: 'pin' } }
];
// The /golfcourse/holes answer for this course; `extra` adds flags / pendingFlags / flagsPending / note / marks the way the server would.
function course(extra) {
  const c = GC._build('way/100', COURSE, ELS);
  return Object.assign({ ok: true, id: c.id, name: c.name, center: c.center, holes: JSON.parse(JSON.stringify(c.holes)), holeCount: c.holeCount, holesMapped: c.holesMapped, marks: 0, source: 'OpenStreetMap contributors', asOf: '2026-11-16T15:00:00.000Z', note: '3 of 18 greens are drawn on OpenStreetMap. The others can be marked while you play.' }, extra || {});
}
const search = () => ({ ok: true, center: { lat: 26.2, lon: -98.23, label: 'McAllen, Hidalgo County, Texas' }, radius: 15, courses: [{ id: 'way/100', name: 'Test Links', lat: at(400, 400).lat, lon: at(400, 400).lon, holes: 18, holesMapped: 3, miles: 0.4 }, { id: 'way/200', name: 'Palm <b>View</b> & Sons Golf Course', lat: 26.25, lon: -98.2, holes: 18, holesMapped: 0, miles: 3.9 }, { id: 'relation/7', name: 'Golf course (no name on the map)', lat: 26.3, lon: -98.2, holes: 18, holesMapped: 0, miles: 7.2, unnamed: true }], count: 3, source: 'OpenStreetMap contributors', asOf: '2026-11-16T15:00:00.000Z' });
module.exports = { O, at, rect, course, search, yards: G.yards };
