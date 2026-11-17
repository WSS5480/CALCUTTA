// Run: node odds-api/golfcourse.test.js   (no network: Nominatim, Overpass, Supabase and the sign-in check are replaced by in-memory fakes)
const assert = require('assert'), http = require('http'), GC = require('./golfcourse'), G = GC.geom;
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); }, eq = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); }, near = (a, b, tol, m) => { n++; assert.ok(Math.abs(a - b) <= tol, (m || '') + ' got ' + a + ' want ' + b + ' ±' + tol); };
const O = { lat: 26.2, lon: -98.23 }, at = (e, nn, o) => G.fromXY({ x: e, y: nn }, o || O), YD = 0.9144;
const geo = (pts) => pts.map((p) => ({ lat: p.lat, lon: p.lon }));

// ---------- geometry on hand-made coordinates ----------
near(G.yards({ lat: 26.2, lon: -98.23 }, { lat: 26.201, lon: -98.23 }), 121.60, 1, '0.001 deg of latitude = 111.195 m = 121.6 yd');
near(G.yards({ lat: 26.2, lon: -98.23 }, { lat: 26.2, lon: -98.229 }), 111.195 * Math.cos(26.2 * Math.PI / 180) / YD, 1, '0.001 deg of longitude at 26.2N = 109.1 yd');
near(G.yards({ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }), 1216.0, 1, '0.01 deg on the equator');
near(G.yards(O, at(300 * YD, 400 * YD)), 500, 0.5, '3-4-5 triangle: 300 yd east, 400 yd north = 500 yd');
near(G.yards(O, O), 0, 1e-9, 'same point');
// centroid: a square, and an L shape (area-weighted, not the average of the corners)
{ const sq = [at(0, 0), at(20, 0), at(20, 20), at(0, 20), at(0, 0)], c = G.centroid(sq), xy = G.toXY(c, O); near(xy.x, 10, 0.01, 'square centre x'); near(xy.y, 10, 0.01, 'square centre y');
  const L = [at(0, 0), at(20, 0), at(20, 10), at(10, 10), at(10, 20), at(0, 20)], cl = G.toXY(G.centroid(L), O); near(cl.x, 8.333, 0.01, 'L centre x'); near(cl.y, 8.333, 0.01, 'L centre y');
  ok(G.inside(at(5, 5), sq) && !G.inside(at(25, 5), sq) && !G.inside(at(15, 15), L) && G.inside(at(5, 15), L), 'inside test');
  eq(G.centroid([]), null, 'no points'); near(G.toXY(G.centroid([at(0, 0), at(10, 0)]), O).x, 5, 0.01, 'a line has no area: plain average'); }
// front / back on a green turned 45 degrees: 30 m deep along the line of play (north-east), 20 m wide
const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
const GC0 = at(200, 200), rect = (cx, deep, wide, a) => [[-deep / 2, -wide / 2], [deep / 2, -wide / 2], [deep / 2, wide / 2], [-deep / 2, wide / 2], [-deep / 2, -wide / 2]].map(([x, y]) => { const r = rot(x, y, a); return at(r.x, r.y, cx); });
{ const g = rect(GC0, 30, 20, Math.PI / 4), fb = G.frontBack(g, O, GC0); // tee at O, playing north-east
  near(G.metres(fb.front, GC0), 15, 0.05, 'front is 15 m short of the centre'); near(G.metres(fb.back, GC0), 15, 0.05, 'back is 15 m past the centre'); near(fb.depthYd, 30 / YD, 0.1, 'depth 32.8 yd');
  ok(G.metres(O, fb.front) < G.metres(O, fb.back), 'front is the one nearer the tee'); near(G.metres(O, fb.back) - G.metres(O, fb.front), 30, 0.05, 'they sit on the line of play');
  // the same green played from the side (from the south-east): 20 m deep
  const side = G.frontBack(g, at(400, 0), GC0); near(side.depthYd, 20 / YD, 0.1, 'played across: 20 m deep');
  // a line of play that misses the centre is moved onto it
  const off = G.frontBack(g, at(5, -5), at(205, 195)); near(off.depthYd, 30 / YD, 0.1, 'offset line, same direction, same answer'); near(G.metres(off.center, GC0), 0, 0.05, 'centre');
  // a tiny green (3 m across) still gives front < back; no outline / no direction = null
  const tiny = G.frontBack(rect(GC0, 3, 3, 0), O, GC0); near(tiny.depthYd, 3 * Math.SQRT2 / YD, 0.1, 'tiny green on its diagonal');
  eq(G.frontBack([], O, GC0), null, 'no outline'); eq(G.frontBack(g, GC0, GC0), null, 'no direction'); eq(G.frontBack([at(0, 0), at(1, 0)], O, GC0), null, 'two points are not a green'); }
// which green belongs to a hole
{ const gs = [{ outline: rect(at(0, 100), 20, 20, 0), center: at(0, 100) }, { outline: rect(at(300, 300), 20, 20, 0), center: at(300, 300) }];
  eq(G.greenFor(at(302, 298), gs), 1, 'the hole line ends inside green 2'); eq(G.greenFor(at(0, 130), gs), 0, 'ends 30 m short: nearest'); eq(G.greenFor(at(0, 200), gs), -1, '100 m from any green: none'); eq(G.greenFor(null, gs), -1, 'no end');
  near(G.toLine(at(10, 50), [at(0, 0), at(0, 100)]), 10, 0.01, 'distance to a line'); near(G.toLine(at(0, 130), [at(0, 0), at(0, 100)]), 30, 0.01, 'past the end of the line'); }

// ---------- a hand-made course ----------
// Course way/100: a 1 km square. Hole 1 north to a square green (way ends inside it). Hole 2 north-east dog-leg to the turned green (ends 10 m short of its centre).
// Hole 3: no green drawn. Hole 3 again (a second "3"): duplicate. Green ref 7 with no hole line. A bunker beside hole 1, water far away, a hole of the course next door.
const way = (id, tags, pts) => ({ type: 'way', id, tags, geometry: geo(pts), bounds: { minlat: Math.min(...pts.map((p) => p.lat)), maxlat: Math.max(...pts.map((p) => p.lat)), minlon: Math.min(...pts.map((p) => p.lon)), maxlon: Math.max(...pts.map((p) => p.lon)) } });
const SQ = [at(-100, -100), at(900, -100), at(900, 900), at(-100, 900), at(-100, -100)];
const COURSE = way(100, { leisure: 'golf_course', name: 'Test Links', holes: '18' }, SQ);
const G1 = rect(at(0, 300), 24, 24, 0), G2 = rect(GC0, 30, 20, Math.PI / 4), G7 = rect(at(700, 700), 20, 20, 0);
const ELS = [
  way(1, { golf: 'hole', ref: '1', par: '4', handicap: '7' }, [at(0, 0), at(0, 150), at(0, 302)]),
  way(2, { golf: 'hole', ref: '2', par: '3' }, [at(60, 60), at(193, 193)]),
  way(3, { golf: 'hole', ref: '3', par: '5' }, [at(500, 0), at(500, 400)]),
  way(4, { golf: 'hole', ref: '3' }, [at(600, 0), at(600, 400)]),
  way(5, { golf: 'hole', ref: 'A' }, [at(650, 0), at(650, 100)]),
  way(11, { golf: 'green' }, G1), way(12, { golf: 'green' }, G2), way(17, { golf: 'green', ref: '7' }, G7),
  way(21, { golf: 'bunker' }, rect(at(20, 280), 8, 8, 0)), way(22, { golf: 'water_hazard' }, rect(at(400, 800), 30, 30, 0)), way(23, { golf: 'fairway' }, rect(at(0, 150), 200, 30, Math.PI / 2)),
  way(31, { golf: 'hole', ref: '9' }, [at(1200, 0), at(1200, 300)]), // outside the course
  { type: 'node', id: 41, lat: at(500, 395).lat, lon: at(500, 395).lon, tags: { golf: 'pin' } },
  null, { type: 'way', id: 9, tags: { golf: 'green' } }
];
{ const c = GC._build('way/100', COURSE, ELS);
  eq(c.name, 'Test Links'); eq(c.holes.map((h) => h.n), [1, 2, 3, 7], 'holes 1, 2, 3 and the numbered green 7; the neighbour and "A" are left out'); eq(c.holeCount, 18); eq(c.holesMapped, 3, 'three greens drawn'); eq(c.dupes, 1, 'the second hole 3 is counted');
  const h1 = c.holes[0]; eq([h1.par, h1.handicap, h1.mapped], [4, 7, true]); near(G.metres(h1.tee, at(0, 0)), 0, 0.2, 'tee = first point'); near(G.metres(h1.green.center, at(0, 300)), 0, 0.2, 'green centre');
  near(G.metres(h1.green.front, at(0, 288)), 0, 0.3, 'front edge 12 m short'); near(G.metres(h1.green.back, at(0, 312)), 0, 0.3, 'back edge 12 m long'); eq(h1.hazards.length, 1, 'the bunker by the green; the far water is not this hole\'s'); eq(h1.hazards[0].type, 'bunker'); eq(h1.line.length, 3);
  const h2 = c.holes[1]; ok(h2.mapped && h2.green.front && h2.green.back, 'hole 2 matched by nearest green'); near(G.yards(h2.green.front, h2.green.back), 30 / YD, 0.3, 'turned green: 32.8 yd deep along the line of play'); ok(G.metres(h2.tee, h2.green.front) < G.metres(h2.tee, h2.green.back), 'front nearer the tee');
  const h3 = c.holes[2]; eq([h3.mapped, h3.green.approx, h3.par], [false, true, 5], 'no green drawn: says so'); near(G.metres(h3.green.center, at(500, 395)), 0, 0.3, 'the mapped pin near the end of the line stands in'); ok(!h3.green.outline && !h3.green.front, 'no outline, no front');
  const h7 = c.holes[3]; ok(h7.mapped && !h7.tee && !h7.green.front && h7.green.outline.length === 5, 'green 7: outline, no tee, no front/back');
  // marks over the map
  const m = GC._merge(c, { '3:green': { lat: at(500, 400).lat, lon: at(500, 400).lon }, '1:green': { lat: at(2, 301).lat, lon: at(2, 301).lon }, '3:tee': { lat: at(501, 1).lat, lon: at(501, 1).lon }, '12:green': { lat: at(50, 800).lat, lon: at(50, 800).lon } });
  eq(m.map((h) => h.n), [1, 2, 3, 7, 12], 'a mark adds hole 12'); ok(m[2].green.marked && !m[2].green.approx && m[2].teeMarked && m[2].mapped === false, 'hole 3 green + tee marked'); near(G.metres(m[2].green.center, at(500, 400)), 0, 0.2);
  ok(m[0].green.marked && m[0].green.outline && m[0].green.front && m[0].mapped, 'a mark inside the drawn green only moves its centre'); ok(m[4].green.marked && !m[4].tee, 'hole 12 from a mark'); ok(!c.holes[0].green.marked, 'the cached course is not changed');
  // validation
  const ctr = c.center; eq(typeof GC._cleanMark({ n: 5, what: 'green', point: at(0, 0) }, ctr), 'object');
  ['n', 'what', 'point'].forEach(() => {}); ok(/Hole number/.test(GC._cleanMark({ n: 0, what: 'green', point: at(0, 0) }, ctr)) && /Hole number/.test(GC._cleanMark({ n: 37, what: 'green', point: at(0, 0) }, ctr)) && /Hole number/.test(GC._cleanMark({ n: '5', what: 'green', point: at(0, 0) }, ctr)), 'hole number');
  ok(/green or a tee/.test(GC._cleanMark({ n: 5, what: 'pin', point: at(0, 0) }, ctr)), 'what'); ok(/not on the map/.test(GC._cleanMark({ n: 5, what: 'tee', point: { lat: 95, lon: 0 } }, ctr)) && /not on the map/.test(GC._cleanMark({ n: 5, what: 'tee', point: { lat: '26', lon: 0 } }, ctr)) && /not on the map/.test(GC._cleanMark({ n: 5, what: 'tee' }, ctr)), 'point');
  ok(/more than 3 km/.test(GC._cleanMark({ n: 5, what: 'green', point: at(400, 3500) }, ctr)), '3.1 km away refused'); eq(typeof GC._cleanMark({ n: 5, what: 'green', point: at(400, 3300) }, ctr), 'object', '2.9 km away accepted');
  eq(GC._cleanFlags({ red: 'short', white: 'center', blue: 'long', yellow: 'long' }), { red: 'short', white: 'center', blue: 'long', yellow: 'long' }); eq(GC._cleanFlags({ yellow: 'center' }), { yellow: 'center' }, 'one colour is enough');
  [{}, null, [], { green: 'short' }, { red: 'front' }, { red: 'short', pink: 'long' }, { red: 1 }, { red: 'Short' }, { red: ['short'] }, 'red'].forEach((f) => eq(typeof GC._cleanFlags(f), 'string', 'refused: ' + JSON.stringify(f)));
  eq(GC._rowId('way/100'), 'lock:golfmark:way-100'); }
// search list
{ const l = GC._courseList([Object.assign({}, COURSE, { geometry: undefined, center: { lat: at(400, 400).lat, lon: at(400, 400).lon } }), { type: 'relation', id: 7, tags: { leisure: 'golf_course' }, center: { lat: 26.3, lon: -98.2 } }, { type: 'way', id: 1, tags: { golf: 'hole', ref: '1' }, center: at(0, 150) }, { type: 'way', id: 2, tags: { golf: 'hole', ref: '2' }, center: at(120, 120) }, { type: 'way', id: 4, tags: { golf: 'hole', ref: '2' }, center: at(130, 120) }, { type: 'way', id: 31, tags: { golf: 'hole', ref: '9' }, center: at(1200, 150) }]);
  eq(l.length, 2); eq([l[0].id, l[0].name, l[0].holes, l[0].holesMapped], ['way/100', 'Test Links', 18, 2], '2 different hole numbers inside its box'); eq([l[1].id, l[1].unnamed, l[1].holesMapped], ['relation/7', true, 0]); }
// input
eq(GC._parse('/golfcourse/search?q=McAllen%2C%20TX'), { q: 'McAllen, TX', r: 15 }); eq(GC._parse('/golfcourse/search?lat=26.2&lon=-98.23&r=80').r, 50, 'radius capped at 50'); ok(GC._parse('/golfcourse/search?lat=26.2').error && GC._parse('/golfcourse/search?q=a').error && GC._parse('/golfcourse/search?q=%3Cscript%3E').error && GC._parse('/golfcourse/search?lat=95&lon=0').error && GC._parse('/golfcourse/search?q=x&r=abc').error, 'bad input refused');

// ---------- over HTTP with fakes ----------
const db = {}; let NOW = Date.parse('2026-11-16T15:00:00Z'), osmDown = false, asked = [], signed = true, hasDb = true, failPatch = 0;
GC._deps.S = {
  dbGet: async (id) => (db[id] ? JSON.parse(JSON.stringify(db[id])) : null),
  dbPut: async (row, ign) => { if (db[row.id] && ign) return; db[row.id] = JSON.parse(JSON.stringify(row)); },
  dbPatchIf: async (id, was, data, upd) => { if (failPatch) { failPatch--; db[id].updated++; return false; } if (!db[id] || db[id].updated !== Number(was)) return false; db[id].data = JSON.parse(JSON.stringify(data)); db[id].updated = upd; return true; }
};
GC._deps.now = () => NOW; GC._deps.sleep = async () => {}; GC._deps.log = () => {}; GC._deps.hasDb = () => hasDb;
GC._deps.check = async (req) => signed && !!req.headers['x-token']; GC._deps.who = (req) => req.headers['x-token'] || null; GC._deps.owner = (req) => req.headers['x-token'] === 'owner';
const J = (o, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => o });
GC._deps.fetch = async (u, opt) => {
  asked.push(u);
  if (u.startsWith('https://nominatim')) { const q = new URL(u).searchParams.get('q'); return J(/nowhere/i.test(q) ? [] : [{ lat: String(at(380, 420).lat), lon: String(at(380, 420).lon), display_name: 'McAllen, Hidalgo County, Texas, United States' }]); }
  if (osmDown) return J({}, 504);
  const q = decodeURIComponent(String(opt.body).replace(/^data=/, ''));
  if (/leisure/.test(q)) return J({ elements: [Object.assign({}, COURSE, { geometry: undefined, center: at(400, 400) }), { type: 'way', id: 1, tags: { golf: 'hole', ref: '1' }, center: at(0, 150) }] });
  if (/^\[out:json\]\[timeout:10\];way\(100\);out geom tags;$/.test(q)) return J({ elements: [COURSE] });
  if (/^\[out:json\]\[timeout:10\];way\(555\);/.test(q)) return J({ elements: [way(555, { building: 'yes' }, SQ)] });
  if (/^\[out:json\]\[timeout:10\];(way|node|relation)\(\d+\);/.test(q)) return J({ elements: [] });
  if (/nwr\["golf"\]\(/.test(q)) return J({ elements: ELS });
  return J({}, 400);
};
const srv = http.createServer(async (req, res) => { if (!(await GC.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
srv.listen(0, async () => {
  const P = srv.address().port, get = async (p, tok) => { const r = await fetch('http://127.0.0.1:' + P + p, { headers: tok ? { 'x-token': tok } : {} }); return { s: r.status, j: await r.json() }; };
  const post = async (b, tok, ip) => { const h = { 'content-type': 'application/json', 'x-forwarded-for': ip || '9.9.9.9' }; if (tok !== null) h['x-token'] = tok || 'ann'; const r = await fetch('http://127.0.0.1:' + P + '/golfcourse/mark', { method: 'POST', headers: h, body: typeof b === 'string' ? b : JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };
  let r;
  try {
    r = await get('/golfcourse/search?q=McAllen%2C%20TX'); eq(r.s, 200); eq(r.j.courses.length, 1); eq([r.j.courses[0].id, r.j.courses[0].name, r.j.courses[0].holesMapped, r.j.courses[0].holes], ['way/100', 'Test Links', 1, 18]); ok(r.j.courses[0].miles < 0.1 && r.j.source === 'OpenStreetMap contributors' && /McAllen/.test(r.j.center.label), 'search answer');
    const a0 = asked.length; r = await get('/golfcourse/search?q=mcallen%2C%20tx'); eq(asked.length, a0, 'second search: place and list both from memory');
    r = await get('/golfcourse/search?lat=26.2&lon=-98.23&r=5'); eq(r.s, 200); eq(r.j.center.label, 'Your location'); eq(r.j.radius, 5);
    r = await get('/golfcourse/search?q=Nowhere%20at%20all'); eq(r.s, 404); r = await get('/golfcourse/search?q=a'); eq(r.s, 400); r = await get('/golfcourse/search'); eq(r.s, 400);
    r = await get('/golfcourse/holes?id=way/100'); eq(r.s, 200); eq(r.j.holes.map((h) => h.n), [1, 2, 3, 7]); eq([r.j.holesMapped, r.j.holeCount, r.j.marks, r.j.flags], [3, 18, 0, undefined]); ok(/3 of 18 greens/.test(r.j.note) && /same number/.test(r.j.note), 'honest notes');
    const a1 = asked.length; r = await get('/golfcourse/holes?id=way/100'); eq(asked.length, a1, 'course kept in memory (7 days)');
    r = await get('/golfcourse/holes?id=way/999'); eq(r.s, 404, 'no such course'); r = await get('/golfcourse/holes?id=way/555'); eq(r.s, 404, 'not a golf course'); r = await get('/golfcourse/holes?id=abc'); eq(r.s, 400); r = await get('/golfcourse/holes?id=way/100%3Bx'); eq(r.s, 400); r = await get('/golfcourse/holes'); eq(r.s, 400);
    r = await fetch('http://127.0.0.1:' + P + '/golfcourse/holes?id=way/100', { method: 'POST' }); eq(r.status, 405); r = await fetch('http://127.0.0.1:' + P + '/golfcourse/mark'); eq(r.status, 405); r = await fetch('http://127.0.0.1:' + P + '/golfcourse/other'); eq(r.status, 404, 'other paths are not ours');
    // marks
    const g3 = at(500, 400);
    r = await post({ id: 'way/100', n: 3, what: 'green', point: g3 }, null); eq(r.s, 401, 'needs sign-in');
    r = await post({ id: 'way/100', n: 3, what: 'green', point: at(400, 3600) }); eq(r.s, 400, 'too far from the course'); r = await post({ id: 'way/100', n: 40, what: 'green', point: g3 }); eq(r.s, 400); r = await post({ id: 'way/100', n: 3, what: 'hole', point: g3 }); eq(r.s, 400); r = await post({ id: 'nope', n: 3, what: 'green', point: g3 }); eq(r.s, 400); r = await post({ id: 'way/999', n: 3, what: 'green', point: g3 }); eq(r.s, 404); r = await post('{bad'); eq(r.s, 400);
    eq(Object.keys(db), [], 'nothing stored by refused marks');
    r = await post({ id: 'way/100', n: 3, what: 'green', point: g3 }); eq(r.s, 200); eq([r.j.n, r.j.what], [3, 'green']);
    eq(Object.keys(db), ['lock:golfmark:way-100']); eq([db['lock:golfmark:way-100'].data.marks['3:green'].by, db['lock:golfmark:way-100'].data.marks['3:green'].at], ['ann', NOW], 'who and when stored');
    r = await get('/golfcourse/holes?id=way/100'); ok(r.j.holes[2].green.marked && r.j.marks === 1, 'holes answer carries the mark'); ok(!/ann/.test(JSON.stringify(r.j)), 'who is never sent out');
    NOW += 1000; r = await post({ id: 'way/100', n: 3, what: 'green', point: at(502, 398) }, 'bob', '9.9.9.8'); eq(r.s, 200); eq(db['lock:golfmark:way-100'].data.marks['3:green'].by, 'bob', 'last write wins'); eq(Object.keys(db['lock:golfmark:way-100'].data.marks).length, 1);
    failPatch = 1; r = await post({ id: 'way/100', n: 3, what: 'tee', point: at(500, 2) }, 'bob', '9.9.9.8'); eq(r.s, 200, 'a lost race is retried'); eq(Object.keys(db['lock:golfmark:way-100'].data.marks).sort(), ['3:green', '3:tee']);
    // cap: 60 marks a course
    const full = {}; for (let i = 1; i <= 30; i++) { full[i + ':green'] = { lat: g3.lat, lon: g3.lon, by: 'x', at: 1 }; full[i + ':tee'] = { lat: g3.lat, lon: g3.lon, by: 'x', at: 1 }; } db['lock:golfmark:way-100'].data.marks = full;
    r = await post({ id: 'way/100', n: 31, what: 'green', point: g3 }, 'cat', '9.9.9.7'); eq(r.s, 409, '61st mark refused'); r = await post({ id: 'way/100', n: 30, what: 'green', point: g3 }, 'cat', '9.9.9.7'); eq(r.s, 200, 'an existing mark can still be corrected');
    db['lock:golfmark:way-100'].data.marks = {};
    // rate limit: 10 a minute per address
    let last; for (let i = 0; i < 11; i++) last = await post({ id: 'way/100', n: 1, what: 'tee', point: at(0, 1) }, 'dan', '7.7.7.7'); eq(last.s, 429, '11th change in a minute refused');
    NOW += 61000;
    // flag colours: set once, locked for the course
    const MAP = { red: 'short', white: 'center', blue: 'long', yellow: 'long' };
    r = await post({ id: 'way/100', what: 'flags', flags: { red: 'front' } }); eq(r.s, 400, 'invalid value'); r = await post({ id: 'way/100', what: 'flags', flags: { green: 'short' } }); eq(r.s, 400, 'invalid colour'); r = await post({ id: 'way/100', what: 'flags' }); eq(r.s, 400); r = await post({ id: 'way/100', what: 'flags', flags: MAP }, null); eq(r.s, 401);
    eq(db['lock:golfmark:way-100'].data.flags, undefined, 'nothing stored');
    r = await post({ id: 'way/100', what: 'flags', flags: MAP }, 'ann'); eq(r.s, 200); eq(r.j.flags, { map: MAP, locked: true, at: NOW, canChange: true }); eq(db['lock:golfmark:way-100'].data.flags.by, 'ann'); ok(db['lock:golfmark:way-100'].data.marks['1:tee'], 'the marks in the same row are kept');
    NOW += 31000; // past the 30 s row memory
    r = await get('/golfcourse/holes?id=way/100'); eq(r.j.flags, { map: MAP, locked: true, at: NOW - 31000, canChange: false }, 'everyone gets the course colours; not signed in = cannot change');
    r = await get('/golfcourse/holes?id=way/100', 'bob'); eq(r.j.flags.canChange, false); r = await get('/golfcourse/holes?id=way/100', 'ann'); eq(r.j.flags.canChange, true); r = await get('/golfcourse/holes?id=way/100', 'owner'); eq(r.j.flags.canChange, true);
    r = await post({ id: 'way/100', what: 'flags', flags: { red: 'long' } }, 'bob', '9.9.9.8'); eq(r.s, 403, 'locked for another account'); eq(r.j.error, 'Ask the organizer to change it'); eq(r.j.flags.map, MAP, 'the refusal carries the course colours'); eq(db['lock:golfmark:way-100'].data.flags.map, MAP);
    r = await post({ id: 'way/100', what: 'flags', flags: { red: 'short', white: 'center', blue: 'long', yellow: 'center' } }, 'ann'); eq(r.s, 200, 'the account that set it may change it'); eq(db['lock:golfmark:way-100'].data.flags.map.yellow, 'center');
    r = await post({ id: 'way/100', what: 'flags', flags: { red: 'long', white: 'center', blue: 'short' } }, 'owner', '9.9.9.6'); eq(r.s, 200, 'owner override'); eq(db['lock:golfmark:way-100'].data.flags, { map: { red: 'long', white: 'center', blue: 'short' }, by: 'owner', at: NOW });
    r = await post({ id: 'way/100', what: 'flags', flags: MAP }, 'ann'); eq(r.s, 403, 'after the owner set it, it is the owner\'s');
    GC._deps.organizer = async (req, id) => req.headers['x-token'] === 'commish' && id === 'way/100'; // the hook the Golf-days build will fill in
    r = await post({ id: 'way/100', what: 'flags', flags: MAP }, 'commish', '9.9.9.5'); eq(r.s, 200, 'organizer hook'); ok(await GC.mayChangeFlags({ headers: {} }, 'way/100', null), 'nothing set yet: anyone signed in may set it');
    // ---- "the course changed its colours": report, owner alert, review ----
    GC._deps.organizer = async () => false; NOW += 61000;
    const RID = 'lock:golfmark:way-100', NEW = { red: 'long', white: 'center', blue: 'short', yellow: 'short' }, rep = async (b, tok, ip) => { const h = { 'content-type': 'application/json', 'x-forwarded-for': ip || '8.8.8.1' }; if (tok !== null) h['x-token'] = tok || 'bob'; const x = await fetch('http://127.0.0.1:' + P + '/golfcourse/flagreport', { method: 'POST', headers: h, body: JSON.stringify(b) }); return { s: x.status, j: await x.json() }; };
    const ev = []; let maMode = 'ok', maReady = true; GC._deps.maReady = () => maReady; GC._deps.handle = (by) => (by === 'owner' ? 'Steve' : 'Player ' + String(by).slice(0, 4));
    GC._deps.ma = (path, data) => { ev.push({ path, data }); if (maMode === 'throw') throw new Error('boom'); if (maMode === 'reject') return Promise.reject(new Error('down')); if (maMode === '404') return Promise.resolve({ ok: false, status: 404, j: {} }); return Promise.resolve({ ok: true, status: 200, j: {} }); };
    eq(db[RID].data.flags.map, MAP, 'start: the course colours are MAP, set by the organizer');
    r = await rep({ id: 'way/100', flags: NEW }, null); eq(r.s, 401, 'report needs sign-in');
    r = await rep({ id: 'way/100', flags: MAP }); eq([r.s, r.j.same], [409, true], 'identical to the current colours: refused');
    r = await rep({ id: 'way/100', flags: { red: 'front' } }); eq(r.s, 400); r = await rep({ id: 'way/100', flags: { pink: 'short' } }); eq(r.s, 400); r = await rep({ id: 'way/100' }); eq(r.s, 400); r = await rep({ id: 'way/100', flags: NEW, note: 'x'.repeat(101) }); eq(r.s, 400, 'note over 100'); r = await rep({ id: 'way/100', flags: NEW, note: { a: 1 } }); eq(r.s, 400); r = await rep({ id: 'bad', flags: NEW }); eq(r.s, 400); r = await rep({ id: 'way/100', action: 'approve' }); eq(r.s, 400);
    r = await rep({ id: 'way/77', flags: NEW }); eq(r.s, 409, 'a course with no colours set has nothing to report against');
    r = await rep({ id: 'way/100', flags: NEW }, 'commish', '8.8.8.9'); eq(r.s, 409, 'who set it does not report, he changes it'); NOW += 61000; eq(ev.length, 0, 'no alert for refused reports'); eq(db[RID].data.pendingFlags, undefined);
    r = await rep({ id: 'way/100', flags: NEW, note: 'New <b>flags</b> since Nov' }); eq([r.s, r.j.pending], [200, true], 'report accepted');
    eq(db[RID].data.pendingFlags, { flags: NEW, by: 'bob', at: NOW, note: 'New <b>flags</b> since Nov' }); eq(db[RID].data.flags.map, MAP, 'the locked colours are not changed by a report'); ok(db[RID].data.marks['1:tee'], 'marks kept');
    eq(ev.length, 1, 'the owner is told once'); eq(ev[0], { path: '/api/v1/event', data: { type: 'course_change', account: 'bob', title: 'Flag colours changed at Test Links', detail: 'Red=Long, White=Center, Blue=Short, Yellow=Short. New <b>flags</b> since Nov', key: 'flags:way/100' } });
    ok(ev[0].data.detail.length <= 160 && !/\d{7,}|@/.test(ev[0].data.title + ev[0].data.detail), 'event text within My Apps rules');
    r = await rep({ id: 'way/100', flags: NEW, note: 'New <b>flags</b> since Nov' }); eq([r.s, r.j.already], [200, true], 'the same report again: accepted, nothing new'); eq(ev.length, 1, 'no second alert');
    r = await get('/golfcourse/holes?id=way/100', 'bob'); eq([r.j.flagsPending, r.j.pendingFlags, r.j.flags.canChange], [true, undefined, false], 'other players only learn that a report is waiting'); r = await get('/golfcourse/holes?id=way/100'); eq([r.j.flagsPending, r.j.pendingFlags], [true, undefined]);
    r = await get('/golfcourse/holes?id=way/100', 'owner'); eq(r.j.pendingFlags, { flags: NEW, at: NOW, note: 'New <b>flags</b> since Nov', from: 'Player bob' }, 'the owner sees the report'); eq(r.j.flagsPending, undefined); ok(!/"by"/.test(JSON.stringify(r.j)), 'account ids are not sent');
    r = await get('/golfcourse/holes?id=way/100', 'commish'); ok(r.j.pendingFlags && r.j.flags.canChange, 'so does the account that set the colours');
    // the alert failing never breaks the request; phone numbers / e-mails never go into the alert
    maMode = 'throw'; r = await rep({ id: 'way/100', flags: NEW, note: 'call 9565551234' }); eq(r.s, 200, 'My Apps throwing does not break the report'); eq(ev[1].data.detail, 'Red=Long, White=Center, Blue=Short, Yellow=Short', 'a note with a phone number is left out of the alert'); eq(db[RID].data.pendingFlags.note, 'call 9565551234', 'but kept for the reviewer');
    maMode = 'reject'; r = await rep({ id: 'way/100', flags: { red: 'center' }, note: 'me@x.com says so' }); eq(r.s, 200, 'My Apps down does not break the report'); eq(ev[2].data.detail, 'Red=Center'); await new Promise((z) => setTimeout(z, 20));
    maMode = '404'; r = await rep({ id: 'way/100', flags: { red: 'long' } }); eq(r.s, 429, 'fourth report today by the same account for this course'); eq(ev.length, 3);
    r = await rep({ id: 'way/100', flags: { red: 'long' } }, 'eve', '8.8.8.2'); eq(r.s, 200, 'another account can still report; a 404 from My Apps is swallowed'); eq(db[RID].data.pendingFlags.by, 'eve', 'last report wins'); eq(ev.length, 4);
    maReady = false; r = await rep({ id: 'way/100', flags: { red: 'center', blue: 'short' } }, 'eve', '8.8.8.2'); eq(r.s, 200); eq(ev.length, 4, 'My Apps not set up: no call, the report is still stored'); maReady = true; maMode = 'ok';
    // review
    r = await rep({ id: 'way/100', action: 'accept' }, 'cat', '8.8.8.3'); eq(r.s, 403, 'another account cannot accept'); r = await rep({ id: 'way/100', action: 'dismiss' }, 'bob', '8.8.8.4'); eq(r.s, 403, 'the reporter cannot dismiss or accept'); r = await rep({ id: 'way/100', action: 'accept' }, null); eq(r.s, 401);
    r = await rep({ id: 'way/100', action: 'dismiss' }, 'owner', '8.8.8.5'); eq(r.s, 200, 'owner dismisses'); eq(db[RID].data.pendingFlags, undefined); eq(db[RID].data.flags.map, MAP, 'colours unchanged by a dismiss');
    r = await rep({ id: 'way/100', action: 'accept' }, 'owner', '8.8.8.5'); eq(r.s, 409, 'nothing waiting');
    NOW += 864e5; r = await rep({ id: 'way/100', flags: NEW }, 'bob', '8.8.8.6'); eq(r.s, 200, 'next day the daily limit is fresh'); eq(ev.length, 5);
    NOW += 1000; r = await rep({ id: 'way/100', action: 'accept' }, 'owner', '8.8.8.5'); eq(r.s, 200, 'owner accepts'); eq(r.j.flags, { map: NEW, locked: true, at: NOW, canChange: true }); eq(db[RID].data.flags, { map: NEW, by: 'owner', at: NOW }, 'the report became the locked colours, who and when recorded'); eq(db[RID].data.pendingFlags, undefined, 'report cleared');
    r = await get('/golfcourse/holes?id=way/100', 'bob'); eq([r.j.flags.map, r.j.flagsPending], [NEW, undefined], 'everyone now gets the new colours');
    r = await rep({ id: 'way/100', flags: MAP }, 'bob', '8.8.8.6'); eq(r.s, 200); r = await post({ id: 'way/100', what: 'flags', flags: MAP }, 'owner', '8.8.8.5'); eq(r.s, 200); eq(db[RID].data.pendingFlags, undefined, 'a direct change by the owner settles an open report');
    r = await fetch('http://127.0.0.1:' + P + '/golfcourse/flagreport'); eq(r.status, 405);
    // no database: marks and colours are simply absent, posting says so
    hasDb = false; NOW += 31000; r = await get('/golfcourse/holes?id=way/100'); eq([r.s, r.j.marks, r.j.flags], [200, 0, undefined]); r = await post({ id: 'way/100', n: 1, what: 'tee', point: at(0, 1) }, 'ann', '9.9.9.4'); eq(r.s, 503); hasDb = true;
    // the map servers go down: an old copy is served and says so; a course never read gives 502
    NOW += 8 * 864e5; osmDown = true;
    r = await get('/golfcourse/holes?id=way/100'); eq(r.s, 200); eq(r.j.stale, true); ok(/not answering/.test(r.j.note) && r.j.holes.length >= 4, 'stale copy');
    r = await get('/golfcourse/search?q=McAllen%2C%20TX'); eq([r.s, r.j.stale, r.j.courses.length], [200, true, 1], 'stale search list');
    r = await get('/golfcourse/holes?id=way/101'); eq(r.s, 502); r = await get('/golfcourse/search?lat=40&lon=-80'); eq(r.s, 502);
    const tried = new Set(asked.filter((u) => /interpreter/.test(u))); eq(tried.size, 4, 'all four map servers were tried');
    console.log('golfcourse.test.js: ' + n + ' checks passed');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; }
  srv.close();
});
