// Run: node odds-api/courts.test.js   (no network: Nominatim, Overpass, Google, My Apps, the clock, the pauses and the log are in-memory fakes)
const assert = require('assert'), http = require('http'), C = require('./courts'), D = C._deps;
const KEY = 'AIzaSyTEST-key_0123456789abcdefghijklmn', KEY2 = 'envKEY-zzzz-1111-2222-3333';
let NOW, calls, logs, sent, nomi, over, goog, myapps, maOn, env, slept;
const jres = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (body === 'BAD') throw new Error('not json'); return body; } });
function start() {
  C._reset(); NOW = Date.parse('2026-11-16T18:00:00Z'); calls = { nomi: [], over: [], goog: [], ma: 0 }; logs = []; sent = []; slept = [];
  nomi = () => jres(200, [{ lat: '26.2034', lon: '-98.2300', display_name: 'McAllen, Hidalgo County, Texas, United States' }]);
  over = () => jres(200, { elements: [] }); goog = () => jres(200, { places: [] }); myapps = () => ({ ok: false, status: 404, j: {} }); maOn = true; env = {};
}
D.now = () => NOW; D.sleep = async (ms) => { slept.push(ms); NOW += ms; }; D.log = (...a) => logs.push(a.join(' ')); D.env = (k) => env[k];
D.maReady = () => maOn; D.ma = async (path, data) => { calls.ma++; assert.strictEqual(path, '/api/v1/app/settings'); assert.deepStrictEqual(data, {}, 'slug and secret are added by acct.js ma()'); return myapps(); };
D.fetch = async (url, opt) => {
  sent.push(String(url) + ' ' + JSON.stringify(opt || {}));
  if (String(url).startsWith('https://nominatim.openstreetmap.org/search?')) { calls.nomi.push({ url, opt }); return nomi(url); }
  if (/overpass/.test(url)) { calls.over.push({ url, opt }); return over(url, opt); }
  if (String(url) === 'https://places.googleapis.com/v1/places:searchText') { calls.goog.push({ url, opt }); return goog(url, opt); }
  throw new Error('unexpected url ' + url);
};
// McAllen-shaped fakes (invented test data, not real places): 4 single courts a few metres apart, a named park 2 km away, a private court, a far one
const PARK = { lat: 26.2100, lon: -98.2300 };
const pitch = (id, dLat, dLon, tags) => ({ type: 'way', id, center: { lat: PARK.lat + dLat, lon: PARK.lon + dLon }, tags: Object.assign({ leisure: 'pitch', sport: 'pickleball' }, tags) });
const OSM = { elements: [
  pitch(1, 0, 0, { lit: 'yes' }), pitch(2, 0.00015, 0, {}), pitch(3, 0.0003, 0, {}), pitch(4, 0.00045, 0, { fee: 'no' }), // chain: each 17 m from the next, 50 m end to end
  { type: 'node', id: 9, lat: 26.2102, lon: -98.2302, tags: { leisure: 'park', name: 'Test Park <b>', sport: 'pickleball', 'addr:housenumber': '100', 'addr:street': 'Main St', 'addr:city': 'McAllen', 'addr:state': 'TX', 'addr:postcode': '78501' } },
  { type: 'way', id: 5, center: { lat: 26.25, lon: -98.20 }, tags: { leisure: 'sports_centre', name: 'Test Rec Center', sport: 'tennis;pickleball', courts: '12', indoor: 'yes', fee: 'yes', access: 'customers', website: 'https://example.org/rec' } },
  { type: 'way', id: 6, center: { lat: 26.22, lon: -98.25 }, tags: { leisure: 'pitch', sport: 'pickleball', access: 'private' } },
  { type: 'way', id: 7, center: { lat: 26.60, lon: -98.23 }, tags: { leisure: 'pitch', sport: 'pickleball', courts: '2' } }, // about 27 miles north
  { type: 'relation', id: 8, tags: { sport: 'pickleball' } } // no centre: skipped
] };
const GPL = { places: [
  { id: 'ChIJtest_1', displayName: { text: 'Test Pickle Club' }, formattedAddress: '1 First St, McAllen, TX 78501, USA', location: { latitude: 26.2110, longitude: -98.2310 } },
  { id: 'ChIJtest_2', displayName: { text: 'Test Pickle Club (duplicate pin)' }, formattedAddress: '1 First St', location: { latitude: 26.2111, longitude: -98.2310 } },
  { id: 'ChIJtest_3', displayName: { text: 'Far Courts' }, location: { latitude: 27.5, longitude: -98.23 } },
  { id: 'x', displayName: {}, location: { latitude: 26.2, longitude: -98.2 } }
] };

const srv = http.createServer(async (req, res) => { try { if (!(await C.handle(req, res))) { res.statusCode = 404; res.end('{}'); } } catch (e) { res.statusCode = 500; res.end('{"crash":true}'); } });
srv.listen(0, '127.0.0.1', async () => {
  const port = srv.address().port, all = [];
  const get = async (qs, hdr, method) => { const r = await fetch('http://127.0.0.1:' + port + '/courts' + qs, { method: method || 'GET', headers: Object.assign({ 'x-forwarded-for': '9.9.9.' + (get.n = (get.n || 0) + 1) % 250 + ', 1.1.1.1, 10.0.0.1' }, hdr) }); const t = await r.text(); all.push(t); return { s: r.status, j: JSON.parse(t), h: r.headers, t }; };
  try {
    // 1. input validation: junk is refused with 400 and nothing is looked up
    start();
    for (const qs of ['', '?q=', '?q=%20%20', '?q=a', '?q=' + 'x'.repeat(81), '?q=%3Cscript%3E', '?q=http://evil.example', '?q=!!!', '?lat=26.2', '?lon=-98.2', '?lat=abc&lon=-98', '?lat=91&lon=0', '?lat=26&lon=181', '?lat=26&lon=-98&r=abc', '?q=McAllen&r=-5', '?q=McAllen&r=1e3', '?lat=26.2;drop&lon=-98', '?lat=NaN&lon=0', '?lat=&lon=']) {
      const r = await get(qs); assert.strictEqual(r.s, 400, 'expected 400 for ' + qs); assert.strictEqual(r.j.ok, false); assert.ok(r.j.error);
    }
    assert.strictEqual(sent.length, 0, 'no outside call for a bad request'); assert.strictEqual(calls.ma, 0);
    assert.strictEqual((await get('?q=McAllen', null, 'POST')).s, 405);
    assert.deepStrictEqual(C._parse('/courts?q=%20McAllen%0A%20TX%20'), { q: 'McAllen TX', r: 15 }, 'trimmed, control characters out, default radius');
    assert.strictEqual(C._parse('/courts?lat=26.2&lon=-98.2&r=500').r, 50, 'radius capped at 50'); assert.strictEqual(C._parse('/courts?lat=26.2&lon=-98.2&r=0').r, 1); assert.strictEqual(C._parse('/courts?lat=26.2&lon=-98.2&r=4.6').r, 5);

    // 2. OSM path (the default: no My Apps settings, no env): geocode, Overpass, grouping, tags, distances, sort
    start(); over = () => jres(200, OSM);
    let r = await get('?q=McAllen,%20TX');
    assert.strictEqual(r.s, 200); assert.strictEqual(r.j.ok, true); assert.strictEqual(r.j.provider, 'osm'); assert.strictEqual(r.j.fallback, undefined); assert.strictEqual(r.j.source, 'OpenStreetMap contributors');
    assert.strictEqual(r.h.get('access-control-allow-origin'), '*'); assert.strictEqual(r.h.get('cache-control'), 'no-store');
    assert.deepStrictEqual(r.j.center, { lat: 26.2, lon: -98.23, label: 'McAllen, Hidalgo County, Texas' }); assert.strictEqual(r.j.radius, 15); assert.strictEqual(r.j.asOf, '2026-11-16T18:00:00.000Z');
    assert.strictEqual(calls.nomi.length, 1); assert.ok(/q=McAllen%2C%20TX/.test(calls.nomi[0].url)); assert.ok(/^Oddable\//.test(calls.nomi[0].opt.headers['User-Agent']), 'a real User-Agent naming Oddable');
    assert.strictEqual(calls.over.length, 1); assert.strictEqual(calls.over[0].opt.method, 'POST'); assert.ok(/^Oddable\//.test(calls.over[0].opt.headers['User-Agent']));
    const ql = decodeURIComponent(calls.over[0].opt.body.slice(5)); assert.ok(/nwr\["sport"~"pickleball",i\]\(around:25750,26\.2,-98\.23\)/.test(ql), 'radius 15 + 1 miles in metres around the rounded point: ' + ql); assert.ok(/out center tags/.test(ql));
    assert.strictEqual(r.j.count, 2, 'park + its 4 courts = one place, rec centre = one; private and 27-mile ones left out'); assert.strictEqual(r.j.courts.length, 2);
    const [a, b] = r.j.courts;
    assert.strictEqual(a.name, 'Test Park <b>'); assert.strictEqual(a.address, '100 Main St, McAllen, TX 78501'); assert.strictEqual(a.courts, 4); assert.strictEqual(a.courtsFrom, 'mapped'); assert.strictEqual(a.lit, true); assert.strictEqual(a.fee, false); assert.strictEqual(a.indoor, undefined, 'indoor is only said when tagged');
    assert.deepStrictEqual([a.lat, a.lon], [26.2102, -98.2302], 'the named park is the pin'); assert.strictEqual(a.maps, 'https://www.google.com/maps/search/?api=1&query=26.2102,-98.2302'); assert.strictEqual(a.miles, 0.5);
    assert.strictEqual(b.name, 'Test Rec Center'); assert.strictEqual(b.indoor, true); assert.strictEqual(b.fee, true); assert.strictEqual(b.access, 'customers'); assert.deepStrictEqual(b.shared, ['tennis']); assert.strictEqual(b.courts, undefined, '12 courts shared with tennis is not 12 pickleball courts'); assert.strictEqual(b.website, 'https://example.org/rec');
    assert.ok(a.miles < b.miles, 'sorted by distance'); assert.ok(Math.abs(b.miles - 3.7) <= 0.2, 'about 3.7 miles: ' + b.miles);
    assert.strictEqual(r.j.note, undefined);
    // radius 30 brings in the far one (own cache entry, own Overpass call), with its tagged court count
    r = await get('?q=McAllen,%20TX&r=30'); assert.strictEqual(r.j.count, 3); assert.strictEqual(r.j.courts[2].courts, 2); assert.strictEqual(r.j.courts[2].courtsFrom, 'tag'); assert.strictEqual(r.j.courts[2].unnamed, true); assert.strictEqual(r.j.courts[2].name, 'Pickleball courts');
    assert.strictEqual(calls.over.length, 2); assert.strictEqual(calls.nomi.length, 1, 'the place is geocoded once');

    // 3. de-dup / grouping on its own: a 60 m gap joins, more does not; a chain joins end to end
    const P = (lat) => ({ lat, lon: -98.23, name: '', pitch: true });
    assert.strictEqual(C._group([P(26.2), P(26.2005)], 60).length, 1, '55 m apart = one place'); assert.strictEqual(C._group([P(26.2), P(26.2007)], 60).length, 2, '78 m apart = two');
    assert.strictEqual(C._group([P(26.2), P(26.2005), P(26.201), P(26.2015)], 60).length, 1, 'a row of courts is one place');
    assert.ok(Math.abs(C._miles(26.2034, -98.23, 29.4241, -98.4936) - 223) < 2, 'McAllen to San Antonio is about 223 miles');
    assert.deepStrictEqual(C._osmCourts({}), []); assert.deepStrictEqual(C._osmCourts({ elements: [null, {}, { type: 'node', lat: 'x', lon: 1, tags: {} }] }), []);

    // 4. caches: same place + radius asks nobody again for 6 hours; nearby point shares the list but gets its own distances; geocode kept a day
    start(); over = () => jres(200, OSM);
    r = await get('?lat=26.2034&lon=-98.2300'); assert.strictEqual(r.j.center.label, 'Your location'); assert.strictEqual(calls.nomi.length, 0, 'no geocode for a point'); assert.strictEqual(calls.over.length, 1);
    const d1 = r.j.courts[0].miles;
    r = await get('?lat=26.2001&lon=-98.2301'); assert.strictEqual(calls.over.length, 1, 'same rounded point: served from the cache'); assert.ok(r.j.courts[0].miles > d1, 'distance is from the exact point, not the rounded one');
    assert.strictEqual(r.j.asOf, '2026-11-16T18:00:00.000Z');
    NOW += 5 * 36e5; await get('?lat=26.2034&lon=-98.2300'); assert.strictEqual(calls.over.length, 1, 'still cached after 5 hours');
    NOW += 61 * 6e4 + 1; r = await get('?lat=26.2034&lon=-98.2300'); assert.strictEqual(calls.over.length, 2, 'refetched after 6 hours'); assert.notStrictEqual(r.j.asOf, '2026-11-16T18:00:00.000Z');
    await get('?lat=26.2034&lon=-98.2300&r=5'); assert.strictEqual(calls.over.length, 3, 'another radius is another list');
    start(); over = () => jres(200, OSM); await get('?q=mcallen'); await get('?q=McAllen'); await get('?q=MCALLEN&r=5'); assert.strictEqual(calls.nomi.length, 1, 'geocode cached (any letter case)');
    NOW += 23 * 36e5; await get('?q=mcallen'); assert.strictEqual(calls.nomi.length, 1); NOW += 2 * 36e5; await get('?q=mcallen'); assert.strictEqual(calls.nomi.length, 2, 'geocoded again after a day');
    // two different places at once: Nominatim is asked one at a time, at least a second apart
    start(); const [x1, x2] = await Promise.all([get('?q=Mission%20TX'), get('?q=Pharr%20TX')]); assert.strictEqual(x1.s, 200); assert.strictEqual(x2.s, 200); assert.strictEqual(calls.nomi.length, 2); assert.ok(slept.some((ms) => ms >= 1000), 'waited a second between the two: ' + slept);
    // the same place asked twice at once: one geocode, one Overpass call
    start(); over = () => jres(200, OSM); await Promise.all([get('?q=Edinburg'), get('?q=Edinburg')]); assert.strictEqual(calls.nomi.length, 1); assert.strictEqual(calls.over.length, 1);
    // a ZIP goes in as a US postal code
    start(); r = await get('?q=78501'); assert.ok(/countrycodes=us&postalcode=78501/.test(calls.nomi[0].url)); assert.ok(/^78501 · /.test(r.j.center.label));

    // 5. honest empty and failures
    start(); r = await get('?q=Nowhere%20TX'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.ok, true); assert.strictEqual(r.j.count, 0); assert.deepStrictEqual(r.j.courts, []); assert.ok(/No pickleball courts are mapped on OpenStreetMap within 15 miles/.test(r.j.note));
    start(); nomi = () => jres(200, []); r = await get('?q=Zzzzqqq'); assert.strictEqual(r.s, 404); assert.strictEqual(r.j.ok, false); assert.ok(/Could not find that place/.test(r.j.error)); assert.strictEqual(calls.over.length, 0);
    await get('?q=zzzzqqq'); assert.strictEqual(calls.nomi.length, 1, 'a miss is remembered for an hour'); NOW += 61 * 6e4; await get('?q=zzzzqqq'); assert.strictEqual(calls.nomi.length, 2);
    start(); nomi = () => jres(503, {}); r = await get('?q=McAllen'); assert.strictEqual(r.s, 503); assert.ok(/place lookup is not answering/.test(r.j.error)); nomi = () => jres(200, [{ lat: '26.2', lon: '-98.2', display_name: 'McAllen' }]); r = await get('?q=McAllen'); assert.strictEqual(r.s, 200, 'a failed geocode is not cached');
    start(); over = () => jres(504, {}); r = await get('?lat=26.2&lon=-98.2'); assert.strictEqual(r.s, 502); assert.strictEqual(r.j.ok, false); assert.strictEqual(r.j.courts, undefined, 'no courts invented'); assert.strictEqual(calls.over.length, 2, 'main server, then the mirror');
    over = (u) => (/overpass-api\.de/.test(u) ? jres(429, {}) : jres(200, OSM)); r = await get('?lat=26.2&lon=-98.2'); assert.strictEqual(r.s, 200, 'failure not cached; the mirror answers'); assert.strictEqual(r.j.count, 2);
    start(); over = () => jres(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 1 after 26 seconds.' }); r = await get('?lat=26.2&lon=-98.2'); assert.strictEqual(r.s, 502, 'a timed-out map query is not "no courts"');
    start(); over = () => jres(200, 'BAD'); r = await get('?lat=26.2&lon=-98.2'); assert.strictEqual(r.s, 502);
    // the map goes down after a good answer: the old list is served and says so
    start(); over = () => jres(200, OSM); await get('?lat=26.2&lon=-98.2'); NOW += 7 * 36e5; over = () => jres(500, {}); r = await get('?lat=26.2&lon=-98.2'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.stale, true); assert.strictEqual(r.j.count, 2); assert.ok(/last list/.test(r.j.note));

    // 6. settings: My Apps first
    start(); myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'google', google_places_key: KEY } } }); env = { COURTS_PROVIDER: 'osm', GOOGLE_PLACES_API_KEY: KEY2 }; goog = () => jres(200, GPL);
    r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'google'); assert.strictEqual(r.j.source, 'Google'); assert.strictEqual(r.j.fallback, undefined); assert.strictEqual(calls.over.length, 0);
    assert.strictEqual(calls.goog.length, 1); const go = calls.goog[0].opt; assert.strictEqual(go.headers['X-Goog-Api-Key'], KEY, 'My Apps key wins over env'); assert.ok(!calls.goog[0].url.includes(KEY), 'key is in a header, never in the URL'); assert.strictEqual(go.headers['X-Goog-FieldMask'], 'places.id,places.displayName,places.formattedAddress,places.location');
    const gb = JSON.parse(go.body); assert.strictEqual(gb.textQuery, 'pickleball courts'); assert.ok(gb.locationRestriction.rectangle.low.latitude < 26.2 && gb.locationRestriction.rectangle.high.latitude > 26.2 && gb.locationRestriction.rectangle.low.longitude < -98.23 && gb.locationRestriction.rectangle.high.longitude > -98.23); assert.ok(!go.body.includes(KEY));
    assert.strictEqual(r.j.count, 1, 'two pins 11 m apart are one place; the far one is outside 15 miles; the nameless one is dropped'); assert.strictEqual(r.j.courts[0].name, 'Test Pickle Club'); assert.strictEqual(r.j.courts[0].address, '1 First St, McAllen, TX 78501, USA');
    assert.strictEqual(r.j.courts[0].maps, 'https://www.google.com/maps/search/?api=1&query=26.211,-98.231&query_place_id=ChIJtest_1'); assert.strictEqual(r.j.courts[0].pid, undefined);
    assert.deepStrictEqual(await C._settings(), { provider: 'google', key: KEY, from: 'myapps' });
    // settings are read at most every 5 minutes
    await get('?lat=30&lon=-97'); await get('?lat=31&lon=-97'); assert.strictEqual(calls.ma, 1); NOW += 5 * 6e4 + 1; await get('?lat=32&lon=-97'); assert.strictEqual(calls.ma, 2);
    // My Apps goes down: the last good settings are kept (not env, which says osm)
    myapps = () => { throw new Error('ECONNREFUSED ' + KEY); }; NOW += 5 * 6e4 + 1; r = await get('?lat=33&lon=-97'); assert.strictEqual(r.j.provider, 'google', 'last good value kept'); assert.strictEqual(calls.ma, 3);
    await get('?lat=34&lon=-97'); assert.strictEqual(calls.ma, 3, 'a failed read is retried after a minute, not on every search'); NOW += 6e4 + 1; myapps = () => ({ ok: false, status: 500, j: {} }); r = await get('?lat=35&lon=-97'); assert.strictEqual(calls.ma, 4); assert.strictEqual(r.j.provider, 'google');
    // owner switches to free in My Apps: next read follows it
    NOW += 6e4 + 1; myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'osm', google_places_key: KEY } } }); r = await get('?lat=36&lon=-97'); assert.strictEqual(r.j.provider, 'osm');
    // My Apps answers google but has no key: env key is used; with no key anywhere it is osm
    start(); myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'google', google_places_key: '' } } }); env = { GOOGLE_PLACES_API_KEY: KEY2 }; goog = () => jres(200, GPL);
    r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'google'); assert.strictEqual(calls.goog[0].opt.headers['X-Goog-Api-Key'], KEY2);
    start(); myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'google' } } }); r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'osm', 'google without a key = osm'); assert.strictEqual(r.j.fallback, undefined); assert.strictEqual(calls.goog.length, 0);
    // settings from env when My Apps has none (down from the start, not set up, or an empty answer)
    for (const mode of ['down', 'off', 'empty', 'notok']) {
      start(); env = { COURTS_PROVIDER: ' Google ', GOOGLE_PLACES_API_KEY: ' ' + KEY2 + ' ' }; goog = () => jres(200, GPL);
      if (mode === 'down') myapps = () => { throw new Error('down'); }; if (mode === 'off') maOn = false; if (mode === 'empty') myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: {} } }); if (mode === 'notok') myapps = () => ({ ok: true, status: 200, j: { ok: false } });
      r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'google', 'env provider, mode ' + mode); assert.strictEqual(calls.goog[0].opt.headers['X-Goog-Api-Key'], KEY2, 'trimmed env key'); assert.strictEqual(calls.ma, mode === 'off' ? 0 : 1); assert.strictEqual((await C._settings()).from, 'env');
    }
    // default: nothing anywhere = osm; junk provider names are ignored; a key alone does not switch Google on
    start(); maOn = false; assert.deepStrictEqual(await C._settings(), { provider: 'osm', key: '', from: 'default' });
    start(); maOn = false; env = { COURTS_PROVIDER: 'bing', GOOGLE_PLACES_API_KEY: KEY2 }; assert.strictEqual((await C._settings()).provider, 'osm');
    start(); maOn = false; env = { COURTS_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: 'has space' }; assert.strictEqual((await C._settings()).provider, 'osm');
    // a slow My Apps does not hold the search: after 6 s it goes on with env / default
    start(); myapps = () => new Promise(() => {}); const realST = global.setTimeout; global.setTimeout = (f, ms) => realST(f, ms === 6000 ? 5 : ms); try { assert.strictEqual((await C._settings()).provider, 'osm'); } finally { global.setTimeout = realST; }

    // 7. Google fails -> OpenStreetMap, and the answer says so
    for (const bad of [() => jres(403, { error: { message: 'API key not valid: ' + KEY } }), () => jres(429, {}), () => { throw new Error('socket hang up ' + KEY); }, () => jres(200, 'BAD'), () => jres(200, { error: { status: 'REQUEST_DENIED', message: KEY } })]) {
      start(); myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'google', google_places_key: KEY } } }); goog = bad; over = () => jres(200, OSM);
      r = await get('?q=McAllen'); assert.strictEqual(r.s, 200); assert.strictEqual(r.j.provider, 'osm'); assert.strictEqual(r.j.fallback, true); assert.strictEqual(r.j.source, 'OpenStreetMap contributors'); assert.strictEqual(r.j.count, 2); assert.ok(/Google did not answer/.test(r.j.note));
      await get('?q=McAllen'); assert.strictEqual(calls.goog.length, 1, 'a failing Google is not asked on every search'); NOW += 10 * 6e4 + 1; goog = () => jres(200, GPL); r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'google', 'tried again after 10 minutes'); assert.strictEqual(r.j.fallback, undefined);
    }
    // Google and the map both down: a plain failure
    start(); env = { COURTS_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: KEY }; maOn = false; goog = () => jres(500, {}); over = () => jres(500, {}); r = await get('?q=McAllen'); assert.strictEqual(r.s, 502); assert.strictEqual(r.j.ok, false);
    // Google answers with nothing: that is an honest empty list, not a fallback
    start(); env = { COURTS_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: KEY }; maOn = false; r = await get('?q=McAllen'); assert.strictEqual(r.j.provider, 'google'); assert.strictEqual(r.j.count, 0); assert.ok(/Google lists no pickleball courts within 15 miles/.test(r.j.note)); assert.strictEqual(calls.over.length, 0);
    // a place name that contains the key text can never carry it out
    start(); env = { COURTS_PROVIDER: 'google', GOOGLE_PLACES_API_KEY: KEY }; maOn = false; goog = () => jres(200, { places: [{ id: 'ChIJtest_9', displayName: { text: 'Leak ' + KEY }, location: { latitude: 26.2, longitude: -98.23 } }] }); r = await get('?q=McAllen'); assert.strictEqual(r.j.courts[0].name, 'Leak [key]');
    assert.strictEqual(C._scrub('x ' + KEY + ' y AIzaSyOTHERKEY0123456789'), 'x [key] y [key]');

    // 8. rate limit: 12 a minute per visitor, counted on the real client address
    start(); const ipH = { 'x-forwarded-for': '7.7.7.7, 1.1.1.1, 10.0.0.1' }; for (let i = 0; i < 12; i++) assert.strictEqual((await get('?lat=26.2&lon=-98.2', ipH)).s, 200);
    r = await get('?lat=26.2&lon=-98.2', ipH); assert.strictEqual(r.s, 429); assert.strictEqual(r.j.ok, false); assert.strictEqual((await get('?lat=26.2&lon=-98.2', { 'x-forwarded-for': '8.8.8.8, 1.1.1.1, 10.0.0.1' })).s, 200, 'another visitor is not held up');
    NOW += 6e4; assert.strictEqual((await get('?lat=26.2&lon=-98.2', ipH)).s, 200, 'next minute');

    // 9. THE KEY: not in any response, any log line, any URL, or anywhere but the one Google header
    assert.ok(all.length > 80, 'responses collected: ' + all.length);
    for (const k of [KEY, KEY2]) {
      assert.ok(!all.some((t) => t.includes(k)), 'key in a response'); assert.ok(!logs.some((l) => l.includes(k)), 'key in a log line');
    }
    // (logs / sent are reset by start(), so check one full failing run end to end)
    start(); myapps = () => ({ ok: true, status: 200, j: { ok: true, settings: { courts_provider: 'google', google_places_key: KEY } } }); goog = () => { throw new Error('getaddrinfo ' + KEY); }; over = () => { throw new Error('boom ' + KEY); };
    r = await get('?q=McAllen'); assert.strictEqual(r.s, 502); assert.ok(logs.length >= 2, 'failures are logged'); assert.ok(!logs.some((l) => l.includes(KEY)), 'key in a log line: ' + logs.join(' | ')); assert.ok(!r.t.includes(KEY));
    assert.ok(!logs.some((l) => /McAllen/i.test(l)), 'searches are not logged');
    const withKey = sent.filter((s) => s.includes(KEY)); assert.strictEqual(withKey.length, 1, 'the key goes out exactly once'); assert.ok(withKey[0].startsWith('https://places.googleapis.com/v1/places:searchText {'), 'and only to Google, in the options (header), not the URL');
    assert.ok(!sent.some((s) => /nominatim|overpass/.test(s) && s.includes(KEY)));
    // the real acct.js helper is exported the way courts.js needs it
    const A = require('./acct'); assert.strictEqual(typeof A.ma, 'function'); assert.strictEqual(typeof A.maReady, 'function');
    console.log('courts.test.js: all passed');
  } catch (e) { console.error('FAILED:', e.stack); process.exitCode = 1; }
  srv.close();
});
