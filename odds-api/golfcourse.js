// 📍 Golf GPS data (v264). Used by pics/golfgps.js. Everything here comes from OpenStreetMap (volunteer map): nothing is invented.
//   GET  /golfcourse/search?q=<course name or city>[&r=<miles>]   or   ?lat=<n>&lon=<n>[&r=<miles>]      r: default 15, 1..50
//        -> { ok, center, radius, courses:[{ id:'way/123', name, lat, lon, miles, holes, holesMapped }], count, source, asOf, stale?, note? }
//   GET  /golfcourse/holes?id=<way|relation|node>/<number>      (x-token optional: only used to say whether THIS account may change the flag colours)
//        -> { ok, id, name, center, holes:[{ n, par?, handicap?, mapped, tee?, line?, green?:{center, front?, back?, outline?, marked?, approx?}, hazards:[] }],
//             holeCount, holesMapped, marks, flags?:{ map:{red:'short',...}, locked:true, at, canChange }, source, asOf, stale?, note? }
//   POST /golfcourse/mark  (signed in: x-token)
//        { id, n, what:'green'|'tee', point:{lat,lon} }  -> { ok, n, what, point }
//            A player's own green centre / tee for a hole the map does not have (or has wrong). Last write wins.
//        { id, what:'flags', flags:{ red|white|blue|yellow : 'short'|'center'|'long' } }  -> { ok, flags:{map, locked:true, at, canChange:true} }
//            What each flag colour means at THIS course, for everyone. Once set it is LOCKED: only the account that set it, the owner, or
//            (later) the group's organizer may change it (mayChangeFlags / D.organizer below); anyone else gets 403 "Ask the organizer to change it".
//   POST /golfcourse/flagreport  (signed in: x-token)
//        { id, flags, note? }            -> { ok, pending:true }   A player who may NOT change a locked course's colours tells the app the course changed them.
//            Stored as pendingFlags { flags, by, at, note } in the course row (last report wins; 3 a day per account per course; refused when it is
//            the same as the current colours) and the owner is told through My Apps: event type 'course_change' (notifyOwner below, never awaited).
//        { id, action:'accept'|'dismiss' } -> { ok, flags? }       Only who may change the colours (mayChangeFlags). Accept = the report becomes the locked
//            colours (who / when recorded) and the report is cleared; dismiss = the report is cleared.
//        /golfcourse/holes gives pendingFlags { flags, at, note, from } only to an account that may change the colours; everyone else gets flagsPending:true.
//        Both live in ONE shared row per course in oddable_sync: id 'lock:golfmark:<way-123>' (the 'lock:' prefix keeps it out of player lists,
//        like alert.js), data { course, marks:{ '5:green':{lat,lon,by,at} }, flags:{ map, by, at }, pendingFlags? }. Who and when are stored, never sent back out.
// The map servers are asked the way courts.js asks them (several public Overpass servers in turn, ~12 s each, one retry when busy, the one that
// answered last first, a time budget, an old answer with stale:true when none answers). That code is COPIED here, not shared: courts.test.js
// replaces courts.js's own fetch, so pulling it into a shared file would have meant rewriting those tests. Nominatim: own 1.1 s queue.
// FRONT / BACK of a green = where the line of play (the last leg of the golf=hole way, or tee -> green centre) enters and leaves the green outline,
// taken through the green's centre. The phone labels them Short / Long (owner's words: "Long center short").
const D = {
  S: require('./sync'), fetch: (...a) => fetch(...a), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  check: (req) => require('./acct').check(req), who: (req) => require('./acct').who(req),
  // The owner: the owner-PIN sign-in / unlocked dashboard (acct.ownerOk), or simply signed in on an owner phone.
  owner: (req) => { const A = require('./acct'); try { if (A.ownerOk(req)) return true; const e = A.who(req); return e === 'owner' || !!A.isOwnerPhone(e); } catch (e) { return false; } },
  // HOOK for the Golf-days build: answer true when this request comes from the organizer (commissioner) of a group playing this course today.
  organizer: async (req, courseId) => false,
  // My Apps (acct.js ma): the owner's alerts. handle = the name shown to the owner for an account (never the account id itself).
  ma: (path, data) => require('./acct').ma(path, data), maReady: () => require('./acct').maReady(),
  handle: (by) => { const A = require('./acct'); try { if (by === 'owner' || A.isOwnerPhone(by)) return A.ownerName() || 'Owner'; } catch (e) {} return by ? 'Player ' + String(by).replace(/[^0-9a-z]/gi, '').slice(0, 4) : 'A player'; },
  hasDb: () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY), log: (...a) => console.error(...a)
};
const UA = 'Oddable/1.0 (golf GPS; https://steves-pics.onrender.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const OSM_TIMEOUT = 12000, OSM_BUDGET = 36000, OSM_BACKOFF = 1500, OSM_GOOD_TTL = 10 * 6e4, OSM_BUSY = [429, 502, 503, 504];
const R_DEF = 15, R_MAX = 50, R_MIN = 1;
const GEO_TTL = 864e5, GEO_MISS_TTL = 36e5, GEO_GAP = 1100, GEO_MAX = 300, GEO_QUEUE = 5;
const SEARCH_TTL = 864e5, HOLES_TTL = 7 * 864e5, STALE_HOLD = 2 * 6e4, C_MAX = 200, MAX_OUT = 40;
const MARK_KM = 3, MARK_MAX = 60, ROW_TTL = 30000, HOLE_MAX = 36;
const RL_MAX = 20, RL_MARK = 10; // a minute per IP
const REPORT_DAY = 3, NOTE_MAX = 100; // reports a day per account per course
const FLAG_KEYS = ['red', 'white', 'blue', 'yellow'], FLAG_VALS = ['short', 'center', 'long'];
const SRC = 'OpenStreetMap contributors';

// ======================= pure geometry (no network, no state; unit-tested in golfcourse.test.js) =======================
const RAD = Math.PI / 180, EARTH = 6371008.8, YD = 0.9144;
const metres = (a, b) => { const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD, h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2; return EARTH * 2 * Math.asin(Math.min(1, Math.sqrt(h))); };
const yards = (a, b) => metres(a, b) / YD;
// Flat x/y in metres around a point o (good to a few centimetres over a golf hole).
const toXY = (p, o) => ({ x: (p.lon - o.lon) * RAD * EARTH * Math.cos(o.lat * RAD), y: (p.lat - o.lat) * RAD * EARTH });
const fromXY = (q, o) => ({ lat: o.lat + q.y / (RAD * EARTH), lon: o.lon + q.x / (RAD * EARTH * Math.cos(o.lat * RAD)) });
const r6 = (n) => Math.round(n * 1e6) / 1e6, pt = (p) => ({ lat: r6(p.lat), lon: r6(p.lon) });
const okPt = (p) => !!p && typeof p.lat === 'number' && typeof p.lon === 'number' && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
// Outline = [{lat,lon}...] (closed or not). Area-weighted centre; the plain average when the shape has no area.
function centroid(outline) {
  const P = (outline || []).filter(okPt); if (!P.length) return null;
  const o = P[0], q = P.map((p) => toXY(p, o)); let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < q.length; i++) { const p1 = q[i], p2 = q[(i + 1) % q.length], f = p1.x * p2.y - p2.x * p1.y; a += f; cx += (p1.x + p2.x) * f; cy += (p1.y + p2.y) * f; }
  if (Math.abs(a) < 1e-6) return fromXY({ x: q.reduce((s, p) => s + p.x, 0) / q.length, y: q.reduce((s, p) => s + p.y, 0) / q.length }, o);
  return fromXY({ x: cx / (3 * a), y: cy / (3 * a) }, o);
}
function inside(p, outline) {
  const P = (outline || []).filter(okPt); if (P.length < 3 || !okPt(p)) return false; let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) c = !c; }
  return c;
}
// Front and back of a green along the line of play a -> b (b is at or near the green). The line is moved sideways to pass through the green's centre.
// Returns null when there is no usable outline or direction.
function frontBack(outline, a, b) {
  const P = (outline || []).filter(okPt), c = centroid(P); if (P.length < 3 || !c || !okPt(a) || !okPt(b)) return null;
  const A = toXY(a, c), B = toXY(b, c); let dx = B.x - A.x, dy = B.y - A.y; const len = Math.hypot(dx, dy);
  if (len < 0.5) return null; dx /= len; dy /= len;
  const q = P.map((p) => toXY(p, c)), hits = [];
  for (let i = 0; i < q.length; i++) { // where the line t*(dx,dy) crosses each edge p1 + s*(e)
    const p1 = q[i], p2 = q[(i + 1) % q.length], ex = p2.x - p1.x, ey = p2.y - p1.y, den = ex * dy - ey * dx; if (Math.abs(den) < 1e-9) continue;
    const s = (p1.y * dx - p1.x * dy) / den, t = (p1.y * ex - p1.x * ey) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) hits.push(t);
  }
  let lo, hi;
  if (hits.length >= 2) { lo = Math.min(...hits); hi = Math.max(...hits); }
  else { const pr = q.map((p) => p.x * dx + p.y * dy); lo = Math.min(...pr); hi = Math.max(...pr); } // odd shape: the outline's own extent along the line
  if (!(hi - lo > 0.2)) return null;
  return { front: fromXY({ x: lo * dx, y: lo * dy }, c), back: fromXY({ x: hi * dx, y: hi * dy }, c), center: c, depthYd: (hi - lo) / YD };
}
// Which green belongs to a hole: the one its line ends in, else the nearest green centre within `max` metres. greens = [{outline, center}].
function greenFor(end, greens, max) {
  if (!okPt(end)) return -1; let best = -1, bd = max == null ? 60 : max;
  for (let i = 0; i < greens.length; i++) { if (inside(end, greens[i].outline)) return i; const d = metres(end, greens[i].center); if (d < bd) { bd = d; best = i; } }
  return best;
}
// Distance in metres from a point to a line of points.
function toLine(p, line) {
  if (!line || !line.length) return Infinity; if (line.length === 1) return metres(p, line[0]);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) { const a = toXY(line[i], p), b = toXY(line[i + 1], p), ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey, t = l2 ? Math.max(0, Math.min(1, -(a.x * ex + a.y * ey) / l2)) : 0; best = Math.min(best, Math.hypot(a.x + t * ex, a.y + t * ey)); }
  return best;
}
const GEOM = { metres, yards, toXY, fromXY, centroid, inside, frontBack, greenFor, toLine, okPt };
// ======================= end of pure geometry =======================

let GEO, SEARCH, HOLES, ROWS, RL, RPT, geoChain, geoLast, geoWaiting, osmGood;
function reset() { GEO = new Map(); SEARCH = new Map(); HOLES = new Map(); ROWS = new Map(); RL = new Map(); RPT = new Map(); geoChain = Promise.resolve(); geoLast = 0; geoWaiting = 0; osmGood = null; }
reset();
const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
const log = (...a) => { try { D.log('golfcourse:', ...a); } catch (e) {} };
const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 120);
const ID_RE = /^(way|relation|node)\/([1-9]\d{0,14})$/;

// ---------- input ----------
const NUM = /^-?\d{1,3}(\.\d{1,12})?$/;
function parse(url) {
  let q; try { q = new URL(url, 'http://x').searchParams; } catch (e) { return { error: 'Bad request.' }; }
  let r = R_DEF;
  if (q.has('r')) { const s = q.get('r'); if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return { error: 'Distance must be a number of miles.' }; r = Math.round(Math.min(R_MAX, Math.max(R_MIN, +s))); }
  if (q.has('lat') || q.has('lon')) {
    const a = q.get('lat') || '', o = q.get('lon') || '';
    if (!NUM.test(a) || !NUM.test(o)) return { error: 'Location must be a latitude and a longitude.' };
    const lat = +a, lon = +o; if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return { error: 'That location is not on the map.' };
    return { lat, lon, r, label: 'Your location' };
  }
  const text = txt(q.get('q'), 200);
  if (text.length < 2 || text.length > 80 || !/[\p{L}\p{N}]/u.test(text) || /[<>{}\[\]\\^`|"]/.test(text) || /https?:|\/\//i.test(text)) return { error: 'Type a course name or a city (2 to 80 characters).' };
  return { q: text, r };
}

// ---------- Nominatim (text -> point), one request at a time, at least GEO_GAP apart ----------
function geoTurn(fn) { const run = geoChain.then(async () => { const wait = geoLast + GEO_GAP - D.now(); if (wait > 0) await D.sleep(wait); geoLast = D.now(); return fn(); }); geoChain = run.then(() => {}, () => {}); return run; }
async function geocode(text) {
  const k = text.toLowerCase(), c = GEO.get(k), now = D.now();
  if (c && c.v && now - c.t < (c.v.miss ? GEO_MISS_TTL : GEO_TTL)) return c.v;
  if (c && c.job) return c.job;
  if (geoWaiting >= GEO_QUEUE) { const e = new Error('busy'); e.busy = true; throw e; }
  geoWaiting++;
  const u = NOMINATIM + '?format=jsonv2&limit=1&addressdetails=0&q=' + encodeURIComponent(text);
  const job = geoTurn(async () => {
    const r = await D.fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' }, signal: timeout(10000) });
    if (!r.ok) throw new Error('nominatim ' + r.status);
    const j = await r.json(), f = Array.isArray(j) ? j[0] : null, lat = f ? +f.lat : NaN, lon = f ? +f.lon : NaN;
    if (!f || !okPt({ lat, lon })) return { miss: true };
    const parts = txt(f.display_name, 200).split(',').map((s) => s.trim()).filter(Boolean);
    return { lat, lon, label: (parts.length > 3 ? parts.slice(0, 2).concat(parts.slice(-2, -1)).join(', ') : parts.join(', ')) || text };
  }).then((v) => { GEO.set(k, { t: D.now(), v }); if (GEO.size > GEO_MAX) GEO.delete(GEO.keys().next().value); return v; }, (e) => { GEO.delete(k); throw e; }).finally(() => { geoWaiting--; });
  GEO.set(k, { t: 0, v: c && c.v, job }); return job;
}

// ---------- Overpass (same server rotation as courts.js) ----------
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return 'map'; } };
function osmOrder() { const g = osmGood && D.now() - osmGood.t < OSM_GOOD_TTL && OVERPASS.includes(osmGood.u) ? osmGood.u : ''; return g ? [g].concat(OVERPASS.filter((u) => u !== g)) : OVERPASS.slice(); }
async function osmAsk(u, body, ms) {
  const r = await D.fetch(u, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: timeout(ms) });
  if (!r.ok) { const e = new Error('overpass ' + (+r.status || 0)); e.busy = OSM_BUSY.includes(+r.status); throw e; }
  let j; try { j = await r.json(); } catch (e) { throw new Error('overpass bad answer'); }
  if (!j || !Array.isArray(j.elements)) throw new Error('overpass bad answer');
  if (!j.elements.length && /error|timed out|out of memory/i.test(String(j.remark || ''))) throw new Error('overpass gave up'); // a timed-out query is not "nothing there"
  return j.elements;
}
async function overpass(query, end) {
  const body = 'data=' + encodeURIComponent(query), left = () => end - D.now(); let err;
  for (const u of osmOrder()) {
    for (let n = 0; n < 2; n++) { // a second try only when the server said "busy"
      if (left() < 1500) { log('map lookup stopped (out of time)'); throw err || new Error('overpass out of time'); }
      try { const v = await osmAsk(u, body, Math.min(OSM_TIMEOUT, left())); osmGood = { u, t: D.now() }; return v; }
      catch (e) {
        err = e; log('map lookup failed (' + hostOf(u) + ': ' + String(e && e.message).slice(0, 60) + ')');
        if (osmGood && osmGood.u === u) osmGood = null;
        if (!(e && e.busy) || n > 0 || left() < OSM_BACKOFF + 1500) break;
        await D.sleep(OSM_BACKOFF);
      }
    }
  }
  throw err || new Error('overpass');
}
// A cached job: fresh answer inside ttl, one request at a time per key, the old answer (stale:true) when the map does not answer.
function cached(M, k, ttl, make) {
  const now = D.now(), c = M.get(k);
  if (c && c.v && now - c.t < c.ttl) return Promise.resolve(c.v);
  if (c && c.job) return c.job;
  const job = make().then((v) => { M.delete(k); M.set(k, { t: D.now(), ttl, v }); while (M.size > C_MAX) M.delete(M.keys().next().value); return v; },
    (e) => { if (c && c.v && !e.status) { const old = Object.assign({}, c.v, { stale: true }); M.delete(k); M.set(k, { t: D.now(), ttl: STALE_HOLD, v: old }); return old; } M.delete(k); throw e; });
  M.set(k, { t: c ? c.t : 0, ttl: c ? c.ttl : 0, v: c && c.v, job }); return job;
}

// ---------- search ----------
const holeNo = (v) => { const m = /^\s*(\d{1,2})\s*$/.exec(String(v == null ? '' : v)); const n = m ? +m[1] : 0; return n >= 1 && n <= HOLE_MAX ? n : 0; };
const elPt = (el) => (el.type === 'node' ? { lat: +el.lat, lon: +el.lon } : el.center ? { lat: +el.center.lat, lon: +el.center.lon } : el.bounds ? { lat: (el.bounds.minlat + el.bounds.maxlat) / 2, lon: (el.bounds.minlon + el.bounds.maxlon) / 2 } : null);
function searchQuery(lat, lon, mi) {
  const a = '(around:' + Math.round(mi * 1609.344) + ',' + lat + ',' + lon + ')';
  return '[out:json][timeout:10];nwr["leisure"="golf_course"]' + a + ';out center bb tags 120;way["golf"="hole"]' + a + ';out center tags 2500;';
}
// Courses + how many different hole numbers are drawn inside each course's box.
function courseList(els) {
  const courses = [], holes = [];
  (els || []).forEach((el) => {
    if (!el || typeof el !== 'object') return; const t = (el.tags && typeof el.tags === 'object' && el.tags) || {}, p = elPt(el); if (!okPt(p)) return;
    if (t.leisure === 'golf_course') courses.push({ id: el.type + '/' + el.id, name: txt(t.name || t['name:en'] || '', 100), lat: p.lat, lon: p.lon, b: el.bounds || null, holes: holeNo(t.holes) || 0 });
    else if (t.golf === 'hole') { const n = holeNo(t.ref); if (n) holes.push({ n, lat: p.lat, lon: p.lon }); }
  });
  return courses.filter((c) => ID_RE.test(c.id)).map((c) => {
    const seen = new Set(); if (c.b) holes.forEach((h) => { if (h.lat >= c.b.minlat && h.lat <= c.b.maxlat && h.lon >= c.b.minlon && h.lon <= c.b.maxlon) seen.add(h.n); });
    const o = { id: c.id, name: c.name || 'Golf course (no name on the map)', lat: r6(c.lat), lon: r6(c.lon), holes: Math.max(c.holes || 18, seen.size), holesMapped: seen.size }; if (!c.name) o.unnamed = true; return o;
  });
}
async function searchFor(lat, lon, r) {
  const cLat = Math.round(lat * 100) / 100, cLon = Math.round(lon * 100) / 100, k = cLat.toFixed(2) + '|' + cLon.toFixed(2) + '|' + r;
  return cached(SEARCH, k, SEARCH_TTL, async () => ({ at: D.now(), list: courseList(await overpass(searchQuery(cLat, cLon, r + 1), D.now() + OSM_BUDGET)) }));
}
function searchAnswer(v, center, r) {
  const mi = (p) => metres(center, p) / 1609.344;
  const courses = v.list.map((c) => Object.assign({}, c, { miles: mi(c) })).filter((c) => c.miles <= r + 1e-9).sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name)).slice(0, MAX_OUT).map((c) => { c.miles = Math.round(c.miles * 10) / 10; return c; });
  const o = { ok: true, center: { lat: Math.round(center.lat * 100) / 100, lon: Math.round(center.lon * 100) / 100, label: center.label }, radius: r, courses, count: courses.length, source: SRC, asOf: new Date(v.at).toISOString() };
  const notes = []; if (v.stale) { o.stale = true; notes.push('The course map is not answering right now. This is the last list we have.'); }
  if (!courses.length) notes.push('No golf courses are mapped on OpenStreetMap within ' + r + ' miles. Try a bigger distance or the course name.');
  if (notes.length) o.note = notes.join(' ');
  return o;
}

// ---------- one course: holes, greens, tees, hazards ----------
const geomOf = (el) => (Array.isArray(el.geometry) ? el.geometry.filter((p) => p && okPt({ lat: +p.lat, lon: +p.lon })).map((p) => ({ lat: +p.lat, lon: +p.lon })) : []);
// The rings of a way or a multipolygon relation, as outlines. closed:false when the course's edge cannot be trusted for an inside test.
function ringsOf(el) {
  if (el.type === 'way') { const g = geomOf(el); return { rings: g.length >= 4 ? [g] : [], closed: g.length >= 4 && metres(g[0], g[g.length - 1]) < 2 }; }
  if (el.type === 'relation') {
    const rings = [], ms = Array.isArray(el.members) ? el.members : []; let closed = true;
    ms.forEach((m) => { if (!m || m.type !== 'way' || m.role === 'inner') return; const g = geomOf(m); if (g.length < 4) { closed = false; return; } if (metres(g[0], g[g.length - 1]) >= 2) closed = false; rings.push(g); });
    return { rings, closed: closed && rings.length > 0 };
  }
  return { rings: [], closed: false };
}
const shapeOf = (el) => { if (el.type === 'way') return geomOf(el); if (el.type === 'relation') { const r = ringsOf(el).rings; return r.sort((a, b) => b.length - a.length)[0] || []; } return []; };
const thin = (o, max) => { if (o.length <= max) return o; const step = o.length / max, out = []; for (let i = 0; i < max; i++) out.push(o[Math.floor(i * step)]); return out; };
const outl = (o, max) => thin(o, max).map((p) => [r6(p.lat), r6(p.lon)]);
const HAZ = { bunker: 'bunker', water_hazard: 'water', lateral_water_hazard: 'water' };
// course = the course element itself (out geom), els = everything tagged golf=* in its box.
function build(id, course, els) {
  const t = (course.tags && typeof course.tags === 'object' && course.tags) || {}, cr = ringsOf(course);
  let box = course.bounds || null; const pts = [].concat(...cr.rings);
  if (!box && pts.length) box = { minlat: Math.min(...pts.map((p) => p.lat)), maxlat: Math.max(...pts.map((p) => p.lat)), minlon: Math.min(...pts.map((p) => p.lon)), maxlon: Math.max(...pts.map((p) => p.lon)) };
  const center = box ? { lat: (box.minlat + box.maxlat) / 2, lon: (box.minlon + box.maxlon) / 2 } : elPt(course);
  const within = (p) => !cr.closed || cr.rings.some((r) => inside(p, r)); // only when the course edge is a proper closed shape; otherwise its box decides
  const ways = [], greens = [], hazards = [], pins = [];
  (els || []).forEach((el) => {
    if (!el || typeof el !== 'object') return; const g = (el.tags && el.tags.golf) || ''; if (!g) return;
    if (el.type === 'node') { const p = { lat: +el.lat, lon: +el.lon }; if (g === 'pin' && okPt(p) && within(p)) pins.push(p); return; }
    const s = shapeOf(el); if (s.length < 2) return;
    if (g === 'hole') { const n = holeNo(el.tags.ref); if (n && s.some(within)) ways.push({ n, line: s, par: holeNo(el.tags.par), hcp: holeNo(el.tags.handicap) }); }
    else if (g === 'green' && s.length >= 4) { const c = centroid(s); if (c && within(c)) greens.push({ outline: s, center: c, ref: holeNo(el.tags.ref) }); }
    else if (HAZ[g] && s.length >= 3) { const c = centroid(s); if (c && within(c)) hazards.push({ type: HAZ[g], center: c, outline: s }); }
  });
  const H = new Map(); let dupes = 0;
  ways.forEach((w) => { if (H.has(w.n)) { dupes++; return; } H.set(w.n, w); }); // two "hole 5" inside one course (27 / 36 holes drawn as one course): the first is kept and the answer says so
  const used = new Set(), holes = [];
  [...H.values()].sort((a, b) => a.n - b.n).forEach((w) => {
    const L = w.line, tee = L[0], end = L[L.length - 1], gi = greenFor(end, greens), o = { n: w.n, mapped: false, tee: pt(tee), line: outl(L, 12), hazards: [] };
    if (w.par >= 3 && w.par <= 6) o.par = w.par; if (w.hcp >= 1 && w.hcp <= 18) o.handicap = w.hcp;
    if (gi >= 0) {
      used.add(gi); const g = greens[gi], fb = frontBack(g.outline, L.length > 1 ? L[L.length - 2] : tee, end) || frontBack(g.outline, tee, g.center);
      o.green = { center: pt(g.center), outline: outl(g.outline, 48) }; if (fb) { o.green.front = pt(fb.front); o.green.back = pt(fb.back); } o.mapped = true;
    } else { const p = pins.find((q) => metres(q, end) < 40); o.green = { center: pt(p || end), approx: true }; } // no green drawn: the end of the hole line stands in, and the answer says so (mapped:false, approx:true)
    hazards.forEach((z) => { if (o.hazards.length < 12 && toLine(z.center, L) < 45) o.hazards.push({ type: z.type, center: pt(z.center), outline: outl(z.outline, 24) }); });
    holes.push(o);
  });
  greens.forEach((g, i) => { if (used.has(i) || !g.ref || H.has(g.ref) || holes.some((h) => h.n === g.ref)) return; holes.push({ n: g.ref, mapped: true, green: { center: pt(g.center), outline: outl(g.outline, 48) }, hazards: [] }); }); // a numbered green with no hole line: no line of play, so no Short / Long
  holes.sort((a, b) => a.n - b.n);
  const top = holes.length ? holes[holes.length - 1].n : 0;
  const out = { id, name: txt(t.name || t['name:en'] || '', 100) || 'Golf course (no name on the map)', center: center && okPt(center) ? pt(center) : null, holes, holeCount: Math.max(holeNo(t.holes) || 18, top), holesMapped: holes.filter((h) => h.mapped).length };
  if (dupes) out.dupes = dupes;
  return out;
}
async function holesFor(id) {
  return cached(HOLES, id, HOLES_TTL, async () => {
    const m = ID_RE.exec(id), end = D.now() + OSM_BUDGET, no = (msg) => Object.assign(new Error(msg), { status: 404 });
    const ce = await overpass('[out:json][timeout:10];' + m[1] + '(' + m[2] + ');out geom tags;', end), course = ce.find((e) => e && e.type === m[1] && String(e.id) === m[2]);
    if (!course) throw no('no such course');
    if (!course.tags || (course.tags.leisure !== 'golf_course' && !course.tags.golf)) throw no('not a golf course');
    let b = course.bounds;
    if (!b) { const p = elPt(course); if (!okPt(p)) throw no('no place'); const d = 0.011, dl = d / Math.max(0.2, Math.cos(p.lat * RAD)); b = { minlat: p.lat - d, maxlat: p.lat + d, minlon: p.lon - dl, maxlon: p.lon + dl }; }
    if (!(b.maxlat - b.minlat <= 0.12 && b.maxlon - b.minlon <= 0.2)) throw no('too big to be one course');
    const pad = 0.0005, els = await overpass('[out:json][timeout:20];nwr["golf"](' + [b.minlat - pad, b.minlon - pad, b.maxlat + pad, b.maxlon + pad].map((x) => (+x).toFixed(6)).join(',') + ');out geom tags 4000;', end);
    return Object.assign(build(id, course, els), { at: D.now() });
  });
}

// ---------- the shared row per course: players' marks + what the flag colours mean ----------
const rowId = (id) => 'lock:golfmark:' + id.replace('/', '-');
function cleanMarks(m) {
  const out = {}; if (!m || typeof m !== 'object') return out;
  Object.keys(m).slice(0, MARK_MAX * 2).forEach((k) => { const x = /^([1-9]\d?):(green|tee)$/.exec(k), v = m[k]; if (!x || +x[1] > HOLE_MAX || !v || !okPt(v) || Object.keys(out).length >= MARK_MAX) return; out[k] = { lat: r6(v.lat), lon: r6(v.lon), by: txt(v.by, 80), at: Number(v.at) || 0 }; });
  return out;
}
// Strict: only the four colours, only the three placements, at least one colour. Returns the cleaned map, or a string saying what is wrong.
function cleanFlags(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'Send the flag colours.';
  const ks = Object.keys(f); if (!ks.length) return 'Send at least one flag colour.';
  const out = {};
  for (const k of ks) { if (!FLAG_KEYS.includes(k)) return 'Flag colours are red, white, blue and yellow.'; if (typeof f[k] !== 'string' || !FLAG_VALS.includes(f[k])) return 'A flag colour means short, center or long.'; }
  FLAG_KEYS.forEach((k) => { if (f[k]) out[k] = f[k]; });
  return out;
}
const sameFlags = (a, b) => FLAG_KEYS.every((k) => ((a && a[k]) || '') === ((b && b[k]) || ''));
const WORD = { short: 'Short', center: 'Center', long: 'Long' }, flagText = (m) => FLAG_KEYS.filter((k) => m[k]).map((k) => k[0].toUpperCase() + k.slice(1) + '=' + WORD[m[k]]).join(', ');
const storedPending = (p) => { if (!p || typeof p !== 'object') return null; const m = cleanFlags(p.flags); return typeof m === 'string' ? null : { flags: m, by: txt(p.by, 80), at: Number(p.at) || 0, note: txt(p.note, NOTE_MAX) }; };
// The owner's alert in My Apps. ONE place, so the manager can swap it for events.emit(type, fields) at the merge. Never awaited by a request; every failure
// (My Apps down, 400, 404, not set up) is swallowed here.
function notifyOwner(type, fields) {
  try { if (!D.maReady()) return; Promise.resolve(D.ma('/api/v1/event', Object.assign({ type }, fields))).catch(() => {}); } catch (e) {}
}
// My Apps refuses event text with an e-mail address or a run of 7+ digits (phone numbers): such text is left out, never sent.
const safeText = (s) => { const t = txt(s, 200); return /@|\d{7,}/.test(t) ? '' : t; };
const storedFlags = (f) => { if (!f || typeof f !== 'object') return null; const m = cleanFlags(f.map); return typeof m === 'string' ? null : { map: m, by: txt(f.by, 80), at: Number(f.at) || 0 }; };
async function rowFor(id, fresh) {
  if (!D.hasDb()) return { marks: {}, flags: null, pending: null };
  const c = ROWS.get(id), now = D.now(); if (!fresh && c && now - c.t < ROW_TTL) return c.v;
  try { const row = await D.S.dbGet(rowId(id)), d = (row && row.data) || {}, v = { marks: cleanMarks(d.marks), flags: storedFlags(d.flags), pending: storedPending(d.pendingFlags) }; ROWS.set(id, { t: now, v }); if (ROWS.size > C_MAX) ROWS.delete(ROWS.keys().next().value); return v; }
  catch (e) { log('marks read failed'); return c ? c.v : { marks: {}, flags: null, pending: null }; }
}
// Who may change a course's locked flag colours: the owner, the account that set them, or (hook) the organizer of a group playing there.
async function mayChangeFlags(req, id, cur) {
  if (!cur) return true;
  try { if (D.owner(req)) return true; } catch (e) {}
  let me = ''; try { me = txt(D.who(req) || '', 80); } catch (e) {}
  if (me && cur.by && me === cur.by) return true;
  try { return !!(await D.organizer(req, id)); } catch (e) { return false; }
}
// Lays the marks over the map data. A marked green keeps the map's outline only if the mark is inside it (a correction of the centre); otherwise the mark stands alone.
function merge(course, marks) {
  const holes = course.holes.map((h) => JSON.parse(JSON.stringify(h))), by = new Map(holes.map((h) => [h.n, h]));
  Object.keys(marks || {}).forEach((k) => {
    const [ns, what] = k.split(':'), n = +ns, p = pt(marks[k]); let h = by.get(n);
    if (!h) { h = { n, mapped: false, hazards: [] }; by.set(n, h); holes.push(h); }
    if (what === 'tee') { h.tee = p; h.teeMarked = true; }
    else if (h.green && h.green.outline && inside(p, h.green.outline.map((q) => ({ lat: q[0], lon: q[1] })))) { h.green.center = p; h.green.marked = true; }
    else { h.green = { center: p, marked: true }; h.mapped = false; }
  });
  holes.sort((a, b) => a.n - b.n);
  return holes;
}
function holesAnswer(v, row, canChange) {
  const marks = (row && row.marks) || {}, holes = merge(v, marks), o = { ok: true, id: v.id, name: v.name, center: v.center, holes, holeCount: Math.max(v.holeCount, holes.length ? holes[holes.length - 1].n : 0), holesMapped: v.holesMapped, marks: Object.keys(marks).length };
  if (row && row.flags) o.flags = { map: row.flags.map, locked: true, at: row.flags.at, canChange: !!canChange };
  if (row && row.flags && row.pending) { if (canChange) o.pendingFlags = { flags: row.pending.flags, at: row.pending.at, note: row.pending.note, from: txt(D.handle(row.pending.by), 40) }; else o.flagsPending = true; }
  Object.assign(o, { source: SRC, asOf: new Date(v.at).toISOString() });
  const notes = []; if (v.stale) { o.stale = true; notes.push('The course map is not answering right now. This is the last copy we have.'); }
  if (!v.holesMapped) notes.push('No greens are drawn for this course on OpenStreetMap yet. You can mark them yourself while you play.');
  else if (v.holesMapped < o.holeCount) notes.push(v.holesMapped + ' of ' + o.holeCount + ' greens are drawn on OpenStreetMap. The others can be marked while you play.');
  if (v.dupes) notes.push('This course has more than one hole with the same number on the map (more than 18 holes drawn as one course). The first of each is shown.');
  if (notes.length) o.note = notes.join(' ');
  return o;
}
function body(req) { return new Promise((res, rej) => { let n = 0; const c = []; req.on('data', (d) => { n += d.length; if (n > 4000) rej(Object.assign(new Error('too big'), { status: 413 })); else c.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { rej(Object.assign(new Error('bad json'), { status: 400 })); } }); req.on('error', rej); }); }
// Returns { n, what, point } or a string saying what is wrong. center = the course centre.
function cleanMark(b, center) {
  if (!b || typeof b !== 'object') return 'Nothing to save.';
  if (!Number.isInteger(b.n) || b.n < 1 || b.n > HOLE_MAX) return 'Hole number must be 1 to ' + HOLE_MAX + '.';
  if (b.what !== 'green' && b.what !== 'tee') return 'Mark a green or a tee.';
  if (!okPt(b.point)) return 'That point is not on the map.';
  if (!center || !okPt(center)) return 'This course has no place on the map.';
  if (metres(center, b.point) > MARK_KM * 1000) return 'That point is more than ' + MARK_KM + ' km from this course.';
  return { n: b.n, what: b.what, point: pt(b.point) };
}
async function mark(req, res) {
  const ip = require('./ip').clientIp(req), rk = 'm' + ip + ':' + Math.floor(D.now() / 6e4); RL.set(rk, (RL.get(rk) || 0) + 1); if (RL.size > 5000) RL.clear();
  if (RL.get(rk) > RL_MARK) return send(res, 429, { ok: false, error: 'Too many changes. Wait a minute and try again.' });
  if (!(await D.check(req))) return send(res, 401, { ok: false, error: 'Sign in again' });
  if (!D.hasDb()) return send(res, 503, { ok: false, error: 'Shared marks are not set up on this server.' });
  const b = await body(req), id = b && typeof b.id === 'string' ? b.id : '';
  if (!ID_RE.test(id)) return send(res, 400, { ok: false, error: 'Unknown course.' });
  const isFlags = b.what === 'flags'; let m;
  if (isFlags) { m = cleanFlags(b.flags); if (typeof m === 'string') return send(res, 400, { ok: false, error: m }); }
  let course; try { course = await holesFor(id); } catch (e) { return send(res, e.status === 404 ? 404 : 502, { ok: false, error: e.status === 404 ? 'That course is not on the map.' : 'The course map is not answering right now. Try again in a minute.' }); }
  if (!isFlags) { m = cleanMark(b, course.center); if (typeof m === 'string') return send(res, 400, { ok: false, error: m }); }
  let by = ''; try { by = txt(D.who(req) || '', 80); } catch (e) {}
  const rid = rowId(id);
  for (let tries = 0; tries < 4; tries++) {
    let row = await D.S.dbGet(rid); if (!row) { await D.S.dbPut({ id: rid, salt: 'x', pinhash: 'x', data: { course: id, marks: {} }, updated: 1 }, true); row = await D.S.dbGet(rid); if (!row) continue; }
    const d = row.data || {}, marks = cleanMarks(d.marks), now = D.now(); let flags = storedFlags(d.flags), pending = storedPending(d.pendingFlags), out;
    if (isFlags) {
      if (!(await mayChangeFlags(req, id, flags))) return send(res, 403, { ok: false, locked: true, error: 'Ask the organizer to change it', flags: { map: flags.map, locked: true, at: flags.at, canChange: false } });
      flags = { map: m, by: flags && flags.by && !by ? flags.by : by, at: now }; pending = null; out = { ok: true, flags: { map: m, locked: true, at: now, canChange: true } };
    } else {
      const key = m.n + ':' + m.what;
      if (!marks[key] && Object.keys(marks).length >= MARK_MAX) return send(res, 409, { ok: false, error: 'This course already has ' + MARK_MAX + ' marks.' });
      marks[key] = { lat: m.point.lat, lon: m.point.lon, by, at: now }; out = { ok: true, n: m.n, what: m.what, point: m.point };
    }
    const data = { course: id, marks }; if (flags) data.flags = flags; if (pending) data.pendingFlags = pending;
    if (await D.S.dbPatchIf(rid, row.updated, data, Math.max(now, Number(row.updated || 0) + 1))) { ROWS.delete(id); return send(res, 200, out); }
  }
  return send(res, 503, { ok: false, error: 'Busy, try again.' });
}

// A player's report that the course changed its colours, and the review of it (accept / dismiss) by who may change them.
async function flagReport(req, res) {
  const ip = require('./ip').clientIp(req), rk = 'm' + ip + ':' + Math.floor(D.now() / 6e4); RL.set(rk, (RL.get(rk) || 0) + 1); if (RL.size > 5000) RL.clear();
  if (RL.get(rk) > RL_MARK) return send(res, 429, { ok: false, error: 'Too many changes. Wait a minute and try again.' });
  if (!(await D.check(req))) return send(res, 401, { ok: false, error: 'Sign in again' });
  if (!D.hasDb()) return send(res, 503, { ok: false, error: 'Shared course colours are not set up on this server.' });
  const b = await body(req), id = b && typeof b.id === 'string' ? b.id : '';
  if (!ID_RE.test(id)) return send(res, 400, { ok: false, error: 'Unknown course.' });
  const review = b.action === 'accept' || b.action === 'dismiss'; let m = null, note = '';
  if (b.action !== undefined && !review) return send(res, 400, { ok: false, error: 'Accept or dismiss.' });
  if (!review) {
    m = cleanFlags(b.flags); if (typeof m === 'string') return send(res, 400, { ok: false, error: m });
    if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') return send(res, 400, { ok: false, error: 'The note must be text.' });
    note = txt(b.note, 400); if (note.length > NOTE_MAX) return send(res, 400, { ok: false, error: 'Keep the note to ' + NOTE_MAX + ' characters.' });
  }
  let by = ''; try { by = txt(D.who(req) || '', 80); } catch (e) {}
  const rid = rowId(id), dayKey = (by || 'ip:' + ip) + '|' + id + '|' + Math.floor(D.now() / 864e5);
  for (let tries = 0; tries < 4; tries++) {
    const row = await D.S.dbGet(rid), d = (row && row.data) || {}, flags = storedFlags(d.flags), pending = storedPending(d.pendingFlags), now = D.now();
    if (!row || !flags) return send(res, 409, { ok: false, error: 'This course has no flag colours set yet.' });
    const data = { course: id, marks: cleanMarks(d.marks), flags }; let out, tell = null;
    if (review) {
      if (!(await mayChangeFlags(req, id, flags))) return send(res, 403, { ok: false, error: 'Ask the organizer to change it' });
      if (!pending) return send(res, 409, { ok: false, error: 'There is no report waiting.' });
      if (b.action === 'accept') { data.flags = { map: pending.flags, by: by || flags.by, at: now }; out = { ok: true, flags: { map: pending.flags, locked: true, at: now, canChange: true } }; } else out = { ok: true };
    } else {
      if (await mayChangeFlags(req, id, flags)) return send(res, 409, { ok: false, error: 'You can change the colours yourself.' });
      if (sameFlags(m, flags.map)) return send(res, 409, { ok: false, same: true, error: 'Those are already this course\'s colours.' });
      if (pending && pending.by === by && sameFlags(m, pending.flags) && pending.note === note) return send(res, 200, { ok: true, pending: true, already: true }); // the same report twice: nothing new to store or to tell
      if ((RPT.get(dayKey) || 0) >= REPORT_DAY) return send(res, 429, { ok: false, error: 'You have reported this course ' + REPORT_DAY + ' times today. Try again tomorrow.' });
      data.pendingFlags = { flags: m, by, at: now, note }; out = { ok: true, pending: true };
      let name = ''; try { name = safeText((await holesFor(id)).name).slice(0, 40); } catch (e) {}
      const base = flagText(m), sn = safeText(note), detail = sn && (base + '. ' + sn).length <= 160 ? base + '. ' + sn : base;
      tell = { account: by, title: 'Flag colours changed at ' + (name || 'a course'), detail: detail.slice(0, 160), key: 'flags:' + id };
    }
    if (await D.S.dbPatchIf(rid, row.updated, data, Math.max(now, Number(row.updated || 0) + 1))) {
      ROWS.delete(id);
      if (tell) { RPT.set(dayKey, (RPT.get(dayKey) || 0) + 1); if (RPT.size > 5000) RPT.clear(); notifyOwner('course_change', tell); }
      return send(res, 200, out);
    }
  }
  return send(res, 503, { ok: false, error: 'Busy, try again.' });
}

async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/golfcourse/search' && path !== '/golfcourse/holes' && path !== '/golfcourse/mark' && path !== '/golfcourse/flagreport') return false;
  try {
    if (path === '/golfcourse/flagreport') { if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only' }); return true; } await flagReport(req, res); return true; }
    if (path === '/golfcourse/mark') { if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only' }); return true; } await mark(req, res); return true; }
    if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
    const ip = require('./ip').clientIp(req), rk = ip + ':' + Math.floor(D.now() / 6e4); RL.set(rk, (RL.get(rk) || 0) + 1); if (RL.size > 5000) RL.clear();
    if (RL.get(rk) > RL_MAX) { send(res, 429, { ok: false, error: 'Too many requests. Wait a minute and try again.' }); return true; }
    if (path === '/golfcourse/holes') {
      let id = ''; try { id = new URL(req.url, 'http://x').searchParams.get('id') || ''; } catch (e) {}
      if (!ID_RE.test(id)) { send(res, 400, { ok: false, error: 'Unknown course.' }); return true; }
      let v; try { v = await holesFor(id); } catch (e) { send(res, e.status === 404 ? 404 : 502, { ok: false, error: e.status === 404 ? 'That course is not on the map.' : 'The course map is not answering right now. Try again in a minute.' }); return true; }
      const row = await rowFor(id); let can = false; if (row.flags && req.headers['x-token']) can = await mayChangeFlags(req, id, row.flags);
      send(res, 200, holesAnswer(v, row, can)); return true;
    }
    const p = parse(req.url); if (p.error) { send(res, 400, { ok: false, error: p.error }); return true; }
    let center = p;
    if (p.q) {
      let g; try { g = await geocode(p.q); } catch (e) { if (!e.busy) log('place lookup failed'); send(res, 503, { ok: false, error: e.busy ? 'Busy right now. Try again in a few seconds.' : 'The place lookup is not answering right now. Try again, or use your location.' }); return true; }
      if (g.miss) { send(res, 404, { ok: false, error: 'Could not find that place. Try the course name with its city, or a city and state.' }); return true; }
      center = { lat: g.lat, lon: g.lon, label: g.label };
    }
    let v; try { v = await searchFor(center.lat, center.lon, p.r); } catch (e) { send(res, 502, { ok: false, error: 'The course map is not answering right now. Try again in a minute.' }); return true; }
    send(res, 200, searchAnswer(v, center, p.r));
  } catch (e) { log('error (' + String(e && e.message).slice(0, 80) + ')'); send(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Golf course error.' }); }
  return true;
}
module.exports = { handle, geom: GEOM, mayChangeFlags, notifyOwner, _deps: D, _reset: reset, _parse: parse, _build: build, _courseList: courseList, _merge: merge, _cleanMark: cleanMark, _cleanMarks: cleanMarks, _cleanFlags: cleanFlags, _rowId: rowId, _OVERPASS: OVERPASS };
