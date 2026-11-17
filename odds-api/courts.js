// 🏓 Find local pickleball courts (GET /courts, public). Used by pics/pickleball.js.
//   /courts?q=<city or ZIP>[&r=<miles>]      or      /courts?lat=<n>&lon=<n>[&r=<miles>]      r: default 15, 1..50
// Providers:
//   osm (default, free): Nominatim turns q into a point (real User-Agent, at most 1 request a second, cached for a day),
//     then Overpass lists everything tagged for pickleball inside the radius.
//   google: Places API (New) Text Search "pickleball courts" around the point. Only when the provider is google AND a key is set.
//     If Google fails (quota, bad key, network) the answer comes from OpenStreetMap instead and says so (provider:'osm', fallback:true).
// Where the provider and the key come from, in this order:
//   (a) My Apps settings: POST /api/v1/app/settings {slug, secret} -> { ok:true, settings:{ courts_provider, google_places_key } }
//       (acct.js ma(), same MYAPPS_URL / MYAPPS_SECRET). Read at most every 5 minutes; if My Apps is down the last good answer is kept.
//   (b) env COURTS_PROVIDER ('osm' | 'google') and GOOGLE_PLACES_API_KEY, for whichever of the two My Apps did not give.
//   (c) osm.
// THE GOOGLE KEY NEVER LEAVES THIS SERVER: it goes to Google in a request header only (never in a URL), it is never put in a response,
// and every log line and error text goes through scrub(). Searches are not logged.
// Only a point rounded to about 1 km is sent to OpenStreetMap / Google; distances are worked out here from the exact point.
// Court lists are kept for 6 hours per rounded point + radius + provider. Nothing is invented: no courts found = count 0 with a note.
const D = {
  fetch: (...a) => fetch(...a), now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  ma: (path, data) => require('./acct').ma(path, data), maReady: () => require('./acct').maReady(),
  env: (k) => process.env[k], log: (...a) => console.error(...a)
};
const UA = 'Oddable/1.0 (pickleball court finder; https://steves-pics.onrender.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const GOOGLE = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location';
const R_DEF = 15, R_MAX = 50, R_MIN = 1, PAD = 1; // miles; PAD covers the rounding of the point
const GEO_TTL = 864e5, GEO_MISS_TTL = 36e5, GEO_GAP = 1100, GEO_MAX = 500, GEO_QUEUE = 5;
const CT_TTL = 6 * 36e5, FB_TTL = 10 * 6e4, CT_MAX = 300, MAX_OUT = 60, MAX_EL = 400, DEDUP_M = 60;
const RL_MAX = 12; // requests a minute per IP
const SRC = { osm: 'OpenStreetMap contributors', google: 'Google' };

let GEO, CT, RL, geoChain, geoLast, geoWaiting, KEYS;
function reset() { require('./appsettings')._reset(); GEO = new Map(); CT = new Map(); RL = new Map(); geoChain = Promise.resolve(); geoLast = 0; geoWaiting = 0; KEYS = new Set(); }
reset();

const send = (res, code, o) => { res.statusCode = code; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(o)); };
// Every key this process has seen is cut out of anything that is logged or sent.
function scrub(s) { let t = String(s == null ? '' : s); KEYS.forEach((k) => { if (k) t = t.split(k).join('[key]'); }); return t.replace(/AIza[0-9A-Za-z_\-]{10,}/g, '[key]'); }
const log = (...a) => { try { D.log('courts:', ...a.map(scrub)); } catch (e) {} };
const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

// ---------- settings ----------
const provName = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return s === 'google' || s === 'google_places' || s === 'places' ? 'google' : s === 'osm' || s === 'openstreetmap' || s === 'free' ? 'osm' : ''; };
const keyOf = (v) => { const s = typeof v === 'string' ? v.trim() : ''; return s && s.length <= 200 && !/\s/.test(s) ? s : ''; };
// The My Apps read (5-minute cache, last good answer kept) is shared with /appcfg: appsettings.js. Only the two court fields are taken from it.
const readSettings = () => require('./appsettings').get({ ma: (p, d) => D.ma(p, d), maReady: () => D.maReady(), now: () => D.now(), log: (m) => log(m) });
async function settings() {
  let raw = null; try { raw = await readSettings(); } catch (e) {}
  const m = raw ? { provider: provName(raw.courts_provider), key: keyOf(raw.google_places_key) } : {}, envP = provName(D.env('COURTS_PROVIDER')), envK = keyOf(D.env('GOOGLE_PLACES_API_KEY'));
  const key = m.key || envK, want = m.provider || envP || 'osm';
  if (key) KEYS.add(key);
  return { provider: want === 'google' && key ? 'google' : 'osm', key, from: m.provider || m.key ? 'myapps' : envP || envK ? 'env' : 'default' };
}

// ---------- input ----------
const NUM = /^-?\d{1,3}(\.\d{1,12})?$/;
function parse(url) {
  let q; try { q = new URL(url, 'http://x').searchParams; } catch (e) { return { error: 'Bad request.' }; }
  let r = R_DEF;
  if (q.has('r')) { const s = q.get('r'); if (!/^\d{1,3}(\.\d{1,3})?$/.test(s)) return { error: 'Radius must be a number of miles.' }; r = Math.round(Math.min(R_MAX, Math.max(R_MIN, +s))); }
  const hasLat = q.has('lat'), hasLon = q.has('lon');
  if (hasLat || hasLon) {
    const a = q.get('lat') || '', o = q.get('lon') || '';
    if (!hasLat || !hasLon || !NUM.test(a) || !NUM.test(o)) return { error: 'Location must be a latitude and a longitude.' };
    const lat = +a, lon = +o; if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return { error: 'That location is not on the map.' };
    return { lat, lon, r, label: 'Your location' };
  }
  const text = String(q.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'Type a city or ZIP code.' };
  if (text.length < 2 || text.length > 80) return { error: 'Type a city or ZIP code (2 to 80 characters).' };
  if (!/[\p{L}\p{N}]/u.test(text) || /[<>{}\[\]\\^`|"]/.test(text) || /https?:|\/\//i.test(text)) return { error: 'Type a city or ZIP code.' };
  return { q: text, r };
}

// ---------- geometry ----------
const RAD = Math.PI / 180;
function miles(aLat, aLon, bLat, bLon) { const dLat = (bLat - aLat) * RAD, dLon = (bLon - aLon) * RAD, h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2; return 3958.7613 * 2 * Math.asin(Math.min(1, Math.sqrt(h))); }
const metres = (a, b) => miles(a.lat, a.lon, b.lat, b.lon) * 1609.344;
const r2 = (n) => Math.round(n * 100) / 100, r5 = (n) => Math.round(n * 1e5) / 1e5;
const mapLink = (lat, lon, pid) => 'https://www.google.com/maps/search/?api=1&query=' + r5(lat) + ',' + r5(lon) + (pid ? '&query_place_id=' + encodeURIComponent(pid) : '');
const txt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n || 120);

// ---------- Nominatim (place text -> point) ----------
function geoTurn(fn) { // one at a time, at least GEO_GAP apart
  const run = geoChain.then(async () => { const wait = geoLast + GEO_GAP - D.now(); if (wait > 0) await D.sleep(wait); geoLast = D.now(); return fn(); });
  geoChain = run.then(() => {}, () => {}); return run;
}
async function geocode(text) {
  const k = text.toLowerCase(), c = GEO.get(k), now = D.now();
  if (c && c.v && now - c.t < (c.v.miss ? GEO_MISS_TTL : GEO_TTL)) return c.v;
  if (c && c.job) return c.job;
  if (geoWaiting >= GEO_QUEUE) { const e = new Error('busy'); e.busy = true; throw e; }
  geoWaiting++;
  const zip = /^\d{5}(-\d{4})?$/.test(text);
  const u = NOMINATIM + '?format=jsonv2&limit=1&addressdetails=0&' + (zip ? 'countrycodes=us&postalcode=' + encodeURIComponent(text.slice(0, 5)) : 'q=' + encodeURIComponent(text));
  const job = geoTurn(async () => {
    const r = await D.fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'en' }, signal: timeout(10000) });
    if (!r.ok) throw new Error('nominatim ' + r.status);
    const j = await r.json(), f = Array.isArray(j) ? j[0] : null, lat = f ? +f.lat : NaN, lon = f ? +f.lon : NaN;
    if (!f || !isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { miss: true };
    const parts = txt(f.display_name, 200).split(',').map((s) => s.trim()).filter(Boolean);
    return { lat, lon, label: (zip ? text.slice(0, 5) + ' · ' : '') + (parts.length > 3 ? parts.slice(0, 2).concat(parts.slice(-2, -1)).join(', ') : parts.join(', ')) || text };
  }).then((v) => { GEO.set(k, { t: D.now(), v }); if (GEO.size > GEO_MAX) GEO.delete(GEO.keys().next().value); return v; }, (e) => { GEO.delete(k); throw e; }).finally(() => { geoWaiting--; });
  GEO.set(k, { t: 0, v: c && c.v, job }); return job;
}

// ---------- OpenStreetMap (Overpass) ----------
function overpassQuery(lat, lon, mi) {
  const a = '(around:' + Math.round(mi * 1609.344) + ',' + lat + ',' + lon + ')';
  // sport=pickleball, leisure=pitch or sports centres whose sport list has pickleball (sport=tennis;pickleball), and pickleball=yes
  return '[out:json][timeout:25];(nwr["sport"~"pickleball",i]' + a + ';nwr["pickleball"~"^(yes|designated|only)$"]' + a + ';);out center tags ' + MAX_EL + ';';
}
const yn = (v) => { const s = String(v == null ? '' : v).toLowerCase(); return !s ? null : s === 'no' ? false : s === 'unknown' ? null : true; };
function osmPlace(el) {
  if (!el || typeof el !== 'object') return null;
  const t = (el.tags && typeof el.tags === 'object' && el.tags) || {}, lat = el.type === 'node' ? +el.lat : el.center ? +el.center.lat : NaN, lon = el.type === 'node' ? +el.lon : el.center ? +el.center.lon : NaN;
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (/^(private|no)$/i.test(t.access || '')) return null; // somebody's back yard is not a place to send people
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), city = [t['addr:city'], [t['addr:state'], t['addr:postcode']].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const sports = String(t.sport || '').toLowerCase().split(/[;,]/).map((s) => s.trim()).filter(Boolean), pitch = t.leisure === 'pitch';
  const n = /^\d{1,3}$/.test(String(t.courts || '').trim()) ? +t.courts : 0;
  const indoor = t.indoor ? yn(t.indoor) : /^(sports_hall)$/.test(t.leisure || '') || (t.building && t.building !== 'no') ? true : null;
  return { name: txt(t.name || t['name:en'] || '', 100), operator: txt(t.operator, 80), address: txt([street, city].filter(Boolean).join(', '), 160), lat, lon, pitch,
    tagCourts: n > 0 && (sports.length <= 1) ? n : 0, indoor, lit: t.lit ? yn(t.lit) : null, fee: t.fee ? yn(t.fee) : null,
    access: /^(customers|members|permit)$/i.test(t.access || '') ? t.access.toLowerCase() : '', shared: sports.filter((s) => s !== 'pickleball').slice(0, 3).map((s) => txt(s, 20)),
    website: /^https:\/\/[^\s"'<>]{4,200}$/.test(t.website || t['contact:website'] || '') ? (t.website || t['contact:website']) : '' };
}
// Courts are usually mapped one by one, a few metres apart. Everything within DEDUP_M of a neighbour is one place.
function group(places, gap) {
  const n = places.length, p = places.map((_, i) => i), find = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(places[i].lat - places[j].lat) < 0.002 && metres(places[i], places[j]) <= gap) p[find(i)] = find(j);
  const g = new Map(); places.forEach((x, i) => { const k = find(i); if (!g.has(k)) g.set(k, []); g.get(k).push(x); });
  return [...g.values()];
}
const first = (a, f) => { for (const x of a) { const v = f(x); if (v !== null && v !== '' && v !== undefined && !(Array.isArray(v) && !v.length)) return v; } return null; };
function osmCourts(json) {
  const els = json && Array.isArray(json.elements) ? json.elements.slice(0, MAX_EL) : [];
  return group(els.map(osmPlace).filter(Boolean), DEDUP_M).map((g) => {
    const named = g.find((x) => x.name && !x.pitch) || g.find((x) => x.name), base = named || g.find((x) => !x.pitch) || g[0], pitches = g.filter((x) => x.pitch).length, tagged = Math.max(0, ...g.map((x) => x.tagCourts));
    const lat = named && !named.pitch ? named.lat : g.reduce((s, x) => s + x.lat, 0) / g.length, lon = named && !named.pitch ? named.lon : g.reduce((s, x) => s + x.lon, 0) / g.length;
    const o = { name: base.name || (base.operator ? base.operator + ' pickleball courts' : 'Pickleball courts'), address: first(g, (x) => x.address) || '', lat: r5(lat), lon: r5(lon) };
    if (!base.name) o.unnamed = true;
    if (tagged) { o.courts = tagged; o.courtsFrom = 'tag'; } else if (pitches > 1) { o.courts = pitches; o.courtsFrom = 'mapped'; }
    const ind = first(g, (x) => x.indoor), lit = first(g, (x) => x.lit), fee = first(g, (x) => x.fee), acc = first(g, (x) => x.access), sh = first(g, (x) => x.shared), web = first(g, (x) => x.website);
    if (ind !== null) o.indoor = ind; if (lit !== null) o.lit = lit; if (fee !== null) o.fee = fee; if (acc) o.access = acc; if (sh) o.shared = sh; if (web) o.website = web;
    return o;
  });
}
async function fromOsm(lat, lon, mi) {
  const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon, mi)); let err;
  for (const u of OVERPASS) {
    try {
      const r = await D.fetch(u, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body, signal: timeout(30000) });
      if (!r.ok) throw new Error('overpass ' + r.status);
      const j = await r.json(); if (!j || !Array.isArray(j.elements)) throw new Error('overpass bad answer');
      if (!j.elements.length && /error|timed out|out of memory/i.test(String(j.remark || ''))) throw new Error('overpass gave up'); // a timed-out query is not "no courts"
      return osmCourts(j);
    } catch (e) { err = e; log('map lookup failed (' + scrub(e && e.message).slice(0, 60) + ')'); }
  }
  throw err || new Error('overpass');
}

// ---------- Google Places (New) Text Search ----------
async function fromGoogle(lat, lon, mi, key) {
  const dLat = mi / 69.05, dLon = mi / (69.17 * Math.max(0.05, Math.cos(lat * RAD)));
  const body = { textQuery: 'pickleball courts', pageSize: 20, languageCode: 'en',
    locationRestriction: { rectangle: { low: { latitude: Math.max(-90, lat - dLat), longitude: Math.max(-180, lon - dLon) }, high: { latitude: Math.min(90, lat + dLat), longitude: Math.min(180, lon + dLon) } } } };
  let r;
  try { r = await D.fetch(GOOGLE, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': GOOGLE_FIELDS }, body: JSON.stringify(body), signal: timeout(12000) }); }
  catch (e) { throw new Error('google unreachable'); } // never pass the original error on: it is not ours to trust with the key
  if (!r.ok) throw new Error('google ' + (+r.status || 0));
  let j; try { j = await r.json(); } catch (e) { throw new Error('google bad answer'); }
  if (!j || typeof j !== 'object' || j.error) throw new Error('google error');
  const out = [];
  (Array.isArray(j.places) ? j.places : []).slice(0, 40).forEach((p) => {
    const la = p && p.location ? +p.location.latitude : NaN, lo = p && p.location ? +p.location.longitude : NaN; if (!isFinite(la) || !isFinite(lo)) return;
    const name = txt(p.displayName && p.displayName.text, 100); if (!name) return;
    out.push({ name, address: txt(p.formattedAddress, 160), lat: r5(la), lon: r5(lo), pid: /^[\w-]{5,200}$/.test(p.id || '') ? p.id : '' });
  });
  return group(out, DEDUP_M).map((g) => g[0]);
}

// ---------- lookup with the 6-hour list cache ----------
async function listFor(prov, key, lat, lon, r) {
  const cLat = Math.round(lat * 100) / 100, cLon = Math.round(lon * 100) / 100, k = prov + '|' + cLat.toFixed(2) + '|' + cLon.toFixed(2) + '|' + r, now = D.now(), c = CT.get(k);
  if (c && c.v && now - c.t < c.ttl) return c.v;
  if (c && c.job) return c.job;
  const job = (async () => {
    let v;
    if (prov === 'google') {
      try { v = { provider: 'google', at: D.now(), list: await fromGoogle(cLat, cLon, r + PAD, key), ttl: CT_TTL }; }
      catch (e) { log('google lookup failed (' + scrub(e && e.message).slice(0, 40) + '), using OpenStreetMap');
        const o = await listFor('osm', '', lat, lon, r); v = { provider: 'osm', fallback: true, at: o.at, list: o.list, ttl: FB_TTL }; }
    } else v = { provider: 'osm', at: D.now(), list: await fromOsm(cLat, cLon, r + PAD), ttl: CT_TTL };
    return v;
  })().then((v) => { CT.delete(k); CT.set(k, { t: D.now(), ttl: v.ttl, v }); while (CT.size > CT_MAX) CT.delete(CT.keys().next().value); return v; },
    (e) => { if (c && c.v) { CT.set(k, { t: c.t, ttl: c.ttl, v: c.v }); return Object.assign({}, c.v, { stale: true }); } CT.delete(k); throw e; }); // the map is down: an old list beats none, and it says so
  CT.set(k, { t: c ? c.t : 0, ttl: c ? c.ttl : 0, v: c && c.v, job }); return job;
}
function answer(v, center, r) {
  const courts = v.list.map((p) => { const o = Object.assign({}, p, { miles: miles(center.lat, center.lon, p.lat, p.lon) }); o.maps = mapLink(p.lat, p.lon, p.pid); delete o.pid; return o; })
    .filter((o) => o.miles <= r + 1e-9).sort((a, b) => a.miles - b.miles || a.name.localeCompare(b.name)).slice(0, MAX_OUT).map((o) => { o.miles = Math.round(o.miles * 10) / 10; return o; });
  const o = { ok: true, provider: v.provider };
  if (v.fallback) o.fallback = true;
  Object.assign(o, { center: { lat: r2(center.lat), lon: r2(center.lon), label: center.label }, radius: r, courts, count: courts.length, source: SRC[v.provider], asOf: new Date(v.at).toISOString() });
  if (v.stale) o.stale = true;
  const notes = [];
  if (v.fallback) notes.push('Google did not answer, so this list is from OpenStreetMap.');
  if (v.stale) notes.push('The court map is not answering right now. This is the last list we have.');
  if (!courts.length) notes.push(v.provider === 'osm' ? 'No pickleball courts are mapped on OpenStreetMap within ' + r + ' miles. Volunteers fill in that map, so courts can be missing. Try a bigger distance.' : 'Google lists no pickleball courts within ' + r + ' miles. Try a bigger distance.');
  if (notes.length) o.note = notes.join(' ');
  return o;
}

async function handle(req, res) {
  const path = req.url.split('?')[0]; if (path !== '/courts') return false;
  if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET only' }); return true; }
  try {
    const ip = require('./ip').clientIp(req), rk = ip + ':' + Math.floor(D.now() / 6e4); RL.set(rk, (RL.get(rk) || 0) + 1); if (RL.size > 5000) RL.clear();
    if (RL.get(rk) > RL_MAX) { send(res, 429, { ok: false, error: 'Too many searches. Wait a minute and try again.' }); return true; }
    const p = parse(req.url); if (p.error) { send(res, 400, { ok: false, error: p.error }); return true; }
    let center = p;
    if (p.q) {
      let g; try { g = await geocode(p.q); } catch (e) { if (!e.busy) log('place lookup failed'); send(res, 503, { ok: false, error: e.busy ? 'Busy right now. Try again in a few seconds.' : 'The place lookup is not answering right now. Try again, or use your location.' }); return true; }
      if (g.miss) { send(res, 404, { ok: false, error: 'Could not find that place. Try a city and state, or a ZIP code.' }); return true; }
      center = { lat: g.lat, lon: g.lon, label: g.label };
    }
    const s = await settings(); let v;
    try { v = await listFor(s.provider, s.key, center.lat, center.lon, p.r); } catch (e) { send(res, 502, { ok: false, error: 'The court map is not answering right now. Try again in a minute.' }); return true; }
    send(res, 200, JSON.parse(scrub(JSON.stringify(answer(v, center, p.r)))));
  } catch (e) { log('error (' + scrub(e && e.message).slice(0, 80) + ')'); send(res, 500, { ok: false, error: 'Court search error.' }); }
  return true;
}
module.exports = { handle, _deps: D, _reset: reset, _parse: parse, _settings: settings, _osmCourts: osmCourts, _group: group, _miles: miles, _scrub: scrub, _overpassQuery: overpassQuery };
