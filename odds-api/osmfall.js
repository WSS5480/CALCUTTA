// 🗺️ Shared OpenStreetMap plumbing for courts.js (pickleball courts) and golfcourse.js (Golf GPS). No routes of its own.
// WHY: on Nov 16 2026 every public Overpass server was unusable from Render at the same time (502 "at capacity", 504, 12 s timeouts),
// so both searches answered 502 and the owner never saw a result. Overpass stays the first choice (it has the detail), but nothing may depend on it alone.
//   overpass(D, query, o)   asks the public Overpass servers: 8 s each, one more try after a short wait when a server says busy, the server that answered
//                           last first, and it STOPS after two servers have failed (about 16-18 s), because each route now has a fallback.
//                           A failed step is remembered: down(D) is true for 10 minutes and callers go straight to their fallback, then Overpass is tried again
//                           (starting with the two servers that were NOT tried last time).
//   turn(D, fn)             ONE queue for every request to nominatim.openstreetmap.org and api.openstreetmap.org from this process, courts and golf together:
//                           one at a time, starts at least 1.1 s apart (their usage policies: at most 1 request a second, a real User-Agent).
//   nominatim(D, params, o) a Nominatim /search through that queue -> the array it answers.
//   osmApi(D, path, o)      the main OSM API (api.openstreetmap.org/api/0.6) through that queue -> its JSON ({ elements:[...] }). e.http = the status on a refusal.
//   toElements(json)        OSM API JSON (nodes with lat/lon, ways with node ids, relations with member refs) -> the elements Overpass gives with "out geom"
//                           (ways with geometry + bounds, relations with member geometry + bounds, tagged nodes), so the callers' parsers are reused unchanged.
// D is the CALLER's dependency object (fetch, now, sleep, optional signal): each module's tests replace their own, the state here is shared.
const NOMINATIM = 'https://nominatim.openstreetmap.org/search', OSMAPI = 'https://api.openstreetmap.org/api/0.6';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const TIMEOUT = 8000, BUDGET = 18000, BACKOFF = 1500, GOOD_TTL = 10 * 6e4, DOWN_TTL = 10 * 6e4, BUSY = [429, 502, 503, 504], HOSTS = 2;
const GAP = 1100, QUEUE = 12;

let good, downUntil, rot, chain, last, waiting;
function reset() { good = null; downUntil = 0; rot = 0; chain = Promise.resolve(); last = 0; waiting = 0; }
reset();
const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return 'map'; } };

// ---------- Overpass ----------
const down = (D) => D.now() < downUntil;
// The servers in the order to ask them: the one that answered last (for 10 minutes) first, then the list from where the rotation stands.
function order(D) {
  const list = OVERPASS.slice(rot).concat(OVERPASS.slice(0, rot)), g = good && D.now() - good.t < GOOD_TTL && OVERPASS.includes(good.u) ? good.u : '';
  return g ? [g].concat(list.filter((u) => u !== g)) : list;
}
async function ask(D, u, body, ms, ua) {
  const r = await D.fetch(u, { method: 'POST', headers: { 'User-Agent': ua, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: D.signal ? D.signal(ms) : timeout(ms) });
  if (!r.ok) { const e = new Error('overpass ' + (+r.status || 0)); e.busy = BUSY.includes(+r.status); throw e; }
  let j; try { j = await r.json(); } catch (e) { throw new Error('overpass bad answer'); }
  if (!j || !Array.isArray(j.elements)) throw new Error('overpass bad answer');
  if (!j.elements.length && /error|timed out|out of memory/i.test(String(j.remark || ''))) throw new Error('overpass gave up'); // a timed-out query is not "nothing there"
  return j.elements;
}
// o = { ua, log(msg), clean?(text), end? (a clock time this step must stop by) }  ->  { elements, host }
async function overpass(D, query, o) {
  const body = 'data=' + encodeURIComponent(query), end = Math.min(o.end || Infinity, D.now() + BUDGET), left = () => end - D.now(), clean = o.clean || String; let err;
  const failed = (e) => { downUntil = D.now() + DOWN_TTL; rot = (rot + HOSTS) % OVERPASS.length; o.log('detailed map marked busy for 10 minutes'); return e; };
  for (const u of order(D).slice(0, HOSTS)) {
    for (let n = 0; n < 2; n++) { // a second try only when the server said "busy"
      if (left() < 1500) { o.log('map lookup stopped (out of time)'); throw failed(err || new Error('overpass out of time')); }
      try { const v = await ask(D, u, body, Math.min(TIMEOUT, left()), o.ua); good = { u, t: D.now() }; return { elements: v, host: hostOf(u) }; }
      catch (e) {
        err = e; o.log('map lookup failed (' + hostOf(u) + ': ' + clean(e && e.message).slice(0, 60) + ')');
        if (good && good.u === u) good = null;
        if (!(e && e.busy) || n > 0 || left() < BACKOFF + 1500) break;
        await D.sleep(BACKOFF);
      }
    }
  }
  throw failed(err || new Error('overpass'));
}

// ---------- the one queue for nominatim.openstreetmap.org + api.openstreetmap.org ----------
function turn(D, fn) {
  if (waiting >= QUEUE) { const e = new Error('busy'); e.busy = true; return Promise.reject(e); }
  waiting++;
  const run = chain.then(async () => { const wait = last + GAP - D.now(); if (wait > 0) await D.sleep(wait); last = D.now(); return fn(); }).finally(() => { waiting--; });
  chain = run.then(() => {}, () => {}); return run;
}
const qs = (p) => Object.keys(p).filter((k) => p[k] !== undefined && p[k] !== null && p[k] !== '').map((k) => k + '=' + encodeURIComponent(p[k])).join('&');
function nominatim(D, params, o) {
  return turn(D, async () => {
    const r = await D.fetch(NOMINATIM + '?' + qs(Object.assign({ format: 'jsonv2' }, params)), { headers: { 'User-Agent': o.ua, Accept: 'application/json', 'Accept-Language': 'en' }, signal: timeout(o.ms || 10000) });
    if (!r.ok) { const e = new Error('nominatim ' + (+r.status || 0)); e.http = +r.status || 0; throw e; }
    let j; try { j = await r.json(); } catch (e) { throw new Error('nominatim bad answer'); }
    if (!Array.isArray(j)) throw new Error('nominatim bad answer');
    return j;
  });
}
function osmApi(D, path, o) {
  return turn(D, async () => {
    const r = await D.fetch(OSMAPI + path, { headers: { 'User-Agent': o.ua, Accept: 'application/json' }, signal: timeout(o.ms || 20000) });
    if (!r.ok) { const e = new Error('osm api ' + (+r.status || 0)); e.http = +r.status || 0; throw e; }
    let j; try { j = await r.json(); } catch (e) { throw new Error('osm api bad answer'); }
    if (!j || !Array.isArray(j.elements)) throw new Error('osm api bad answer');
    return j;
  });
}
// A box of `mi` miles each way around a point, as Nominatim's viewbox (left,top,right,bottom).
function viewbox(lat, lon, mi) {
  const dLat = mi / 69.05, dLon = mi / (69.17 * Math.max(0.05, Math.cos(lat * Math.PI / 180))), f = (n) => n.toFixed(5);
  return [f(Math.max(-180, lon - dLon)), f(Math.min(90, lat + dLat)), f(Math.min(180, lon + dLon)), f(Math.max(-90, lat - dLat))].join(',');
}
// Nominatim's osm_type ("way", or the old one-letter form) + osm_id -> 'way/123', or ''.
function osmId(f) {
  const t = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' }[String((f && f.osm_type) || '').toLowerCase()], id = String((f && f.osm_id) || '');
  return t && /^[1-9]\d{0,14}$/.test(id) ? t + '/' + id : '';
}
// Nominatim's boundingbox [south, north, west, east] (strings) -> { minlat, maxlat, minlon, maxlon }, or null.
function bbox(f) {
  const b = f && Array.isArray(f.boundingbox) ? f.boundingbox.map(Number) : [];
  return b.length === 4 && b.every(isFinite) && b[0] <= b[1] && b[2] <= b[3] ? { minlat: b[0], maxlat: b[1], minlon: b[2], maxlon: b[3] } : null;
}

// ---------- OSM API JSON -> Overpass "out geom" elements ----------
const boundsOf = (pts) => (pts.length ? { minlat: Math.min(...pts.map((p) => p.lat)), minlon: Math.min(...pts.map((p) => p.lon)), maxlat: Math.max(...pts.map((p) => p.lat)), maxlon: Math.max(...pts.map((p) => p.lon)) } : undefined);
function toElements(json) {
  const els = json && Array.isArray(json.elements) ? json.elements : [], N = new Map(), W = new Map(), out = [];
  const tagsOf = (el) => (el.tags && typeof el.tags === 'object' && Object.keys(el.tags).length ? el.tags : null), okN = (el) => typeof el.lat === 'number' && typeof el.lon === 'number' && isFinite(el.lat) && isFinite(el.lon);
  els.forEach((el) => { if (el && el.type === 'node' && okN(el)) N.set(el.id, { lat: el.lat, lon: el.lon }); });
  els.forEach((el) => { if (el && el.type === 'way' && Array.isArray(el.nodes)) W.set(el.id, el.nodes.map((id) => N.get(id)).filter(Boolean).map((p) => ({ lat: p.lat, lon: p.lon }))); });
  els.forEach((el) => {
    if (!el || typeof el !== 'object') return; const tags = tagsOf(el);
    if (el.type === 'node') { if (tags && okN(el)) out.push({ type: 'node', id: el.id, lat: el.lat, lon: el.lon, tags }); return; }
    if (el.type === 'way') { const g = W.get(el.id) || []; if (!g.length) return; const o = { type: 'way', id: el.id, bounds: boundsOf(g), geometry: g }; if (tags) o.tags = tags; out.push(o); return; }
    if (el.type === 'relation') {
      const all = [], members = (Array.isArray(el.members) ? el.members : []).map((m) => {
        const o = { type: m && m.type, ref: m && m.ref, role: (m && m.role) || '' };
        if (o.type === 'way' && W.has(o.ref)) { o.geometry = W.get(o.ref); all.push(...o.geometry); } else if (o.type === 'node' && N.has(o.ref)) { Object.assign(o, N.get(o.ref)); all.push(N.get(o.ref)); }
        return o;
      });
      const o = { type: 'relation', id: el.id, bounds: boundsOf(all), members }; if (tags) o.tags = tags; out.push(o);
    }
  });
  return out;
}

module.exports = { overpass, down, turn, nominatim, osmApi, viewbox, osmId, bbox, toElements, timeout, hostOf, _reset: reset, _state: () => ({ good, downUntil, rot, last, waiting }),
  OVERPASS, NOMINATIM, OSMAPI, TIMEOUT, BUDGET, DOWN_TTL, GAP };
