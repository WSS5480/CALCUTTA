// Run: node odds-api/appcfg.test.js   (no network: My Apps, the clock and the env are in-memory fakes)
const assert = require('assert'), http = require('http'), A = require('./appcfg'), S = require('./appsettings'), C = require('./courts');
const KEY = 'AIzaSyTEST-key_0123456789abcdefghijklmn';
let NOW, calls, myapps, maOn, env;
function start() { S._reset(); C._reset(); NOW = Date.parse('2026-11-16T18:00:00Z'); calls = 0; maOn = true; env = {}; myapps = () => ({ ok: false, status: 404, j: {} }); }
const deps = { ma: async (path, data) => { calls++; assert.strictEqual(path, '/api/v1/app/settings'); assert.deepStrictEqual(data, {}); return myapps(); }, maReady: () => maOn, now: () => NOW, log: () => {} };
A._deps.settings = () => S.get(deps); A._deps.announce = () => S.announce(deps); A._deps.env = (k) => env[k]; A._deps.now = () => NOW;
Object.assign(C._deps, { ma: deps.ma, maReady: deps.maReady, now: deps.now, log: () => {}, env: (k) => env[k] });
const ok = (settings, announce) => () => ({ ok: true, status: 200, j: announce === undefined ? { ok: true, settings } : { ok: true, settings, announce } }); // v267: announce sits NEXT TO settings
const srv = http.createServer(async (req, res) => { if (!(await A.handle(req, res))) { res.statusCode = 404; res.end('{}'); } });
const get = (path, method) => new Promise((done, fail) => { const r = http.request({ port: srv.address().port, path: path || '/appcfg', method: method || 'GET' }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => done({ status: res.statusCode, headers: res.headers, text: b, j: JSON.parse(b || '{}') })); }); r.on('error', fail); r.end(); });
(async () => {
  await new Promise((r) => srv.listen(0, r));
  try {
    // 1. default: My Apps has no such route yet (404), no env
    start(); let r = await get(); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' }); assert.strictEqual(r.headers['access-control-allow-origin'], '*');
    // 2. every preset name is accepted from My Apps (trimmed, any case); it beats the env
    for (const t of A.THEMES) { start(); env = { CARD_THEME: 'light' }; myapps = ok({ card_theme: '  ' + t.toUpperCase() + ' ' }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: t }, t); }
    assert.deepStrictEqual(A.THEMES, ['oddable', 'black', 'light', 'green']);
    // 3. WHITELIST: the settings hold the Google key and other fields; only ok + card_theme leave, the key appears nowhere in the response
    start(); myapps = ok({ card_theme: 'black', google_places_key: KEY, courts_provider: 'google', secret: 'zzz-secret', extra: { deep: KEY }, __proto__: { x: 1 } });
    r = await get(); assert.deepStrictEqual(Object.keys(r.j).sort(), ['card_theme', 'ok']); assert.strictEqual(r.j.card_theme, 'black');
    assert(!r.text.includes(KEY) && !/google|secret|provider|AIza|zzz/i.test(r.text), 'nothing but the whitelist: ' + r.text); assert(!JSON.stringify(r.headers).includes(KEY));
    // 4. card_theme is validated: junk values never come back; they fall to the env, then the default
    for (const bad of ['purple', '', null, 7, true, ['black'], { a: 1 }, 'black;drop', '<script>', KEY, 'oddable black', 'x'.repeat(5000)]) {
      start(); myapps = ok({ card_theme: bad, google_places_key: KEY }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' }, 'bad value ' + JSON.stringify(bad).slice(0, 30));
      start(); env = { CARD_THEME: 'green' }; myapps = ok({ card_theme: bad }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'green' });
    }
    // 5. env fallback: My Apps not set up / down / empty; a junk env value is ignored
    for (const mode of ['off', 'down', 'empty', 'absent']) { start(); env = { CARD_THEME: ' Light ' }; if (mode === 'off') maOn = false; if (mode === 'down') myapps = () => { throw new Error('down ' + KEY); }; if (mode === 'empty') myapps = ok({}); if (mode === 'absent') myapps = ok({ courts_provider: 'osm' }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'light' }, mode); assert(!r.text.includes(KEY)); }
    start(); env = { CARD_THEME: 'neon' }; r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' });
    // 6. cached 5 minutes; My Apps down afterwards keeps the last good answer (not the env)
    start(); env = { CARD_THEME: 'light' }; myapps = ok({ card_theme: 'green' }); await get(); await get(); await get(); assert.strictEqual(calls, 1, 'one My Apps read');
    NOW += 5 * 6e4 + 1; myapps = () => { throw new Error('down'); }; r = await get(); assert.strictEqual(calls, 2); assert.strictEqual(r.j.card_theme, 'green', 'last good kept');
    r = await get(); assert.strictEqual(calls, 2, 'a failed read is not retried at once'); NOW += 6e4 + 1; myapps = ok({ card_theme: 'black' }); r = await get(); assert.strictEqual(calls, 3); assert.strictEqual(r.j.card_theme, 'black');
    // 7. ONE shared read with the court finder: both in the same 5 minutes = one My Apps call, and courts still gets its key
    start(); myapps = ok({ card_theme: 'light', courts_provider: 'google', google_places_key: KEY }); r = await get(); assert.strictEqual(r.j.card_theme, 'light');
    assert.deepStrictEqual(await C._settings(), { provider: 'google', key: KEY, from: 'myapps' }); assert.strictEqual(calls, 1, 'shared cache');
    // 8. a slow My Apps does not hang the route (6 s limit, shortened here)
    start(); myapps = () => new Promise(() => {}); const realST = global.setTimeout; global.setTimeout = (f, ms) => realST(f, ms === 6000 ? 5 : ms); try { r = await get(); } finally { global.setTimeout = realST; } assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' });
    // 9. route shape: other methods, other paths, a query string
    start(); r = await get('/appcfg', 'POST'); assert.strictEqual(r.status, 405); assert.strictEqual(calls, 0);
    r = await get('/appcfg?x=1&card_theme=black'); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' }, 'the caller cannot set it'); r = await get('/appcfgx'); assert.strictEqual(r.status, 404);
    // 9. v266: `betpush:true` is added ONLY when BETPUSH_ENABLED is exactly '1' (it tells the page the bet alerts are on); otherwise the answer is unchanged
    for (const v of [undefined, '', '0', 'true', 'yes']) { start(); env = { BETPUSH_ENABLED: v }; r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' }, 'off: ' + v); }
    start(); env = { BETPUSH_ENABLED: '1' }; myapps = ok({ card_theme: 'black', google_places_key: KEY, betpush: 'x' }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'black', betpush: true }); assert(!r.text.includes(KEY));
    // ---- v267: announce (the latest "Everyone" message). 10. a valid one comes back with exactly five fields; the key still never leaves
    const AT = '2026-11-16T15:00:00.000Z', ANN = { id: 'b_17', title: 'Thursday night picks are up', body: 'Open Oddable and look at the Alert.', link: '/?open=bets', at: AT };
    start(); myapps = ok({ card_theme: 'black', google_places_key: KEY }, Object.assign({ secret: 'zzz-secret', audience: 'all', sent: 9, people: 4, by: KEY, html: '<b>x</b>' }, ANN)); r = await get();
    assert.deepStrictEqual(r.j, { ok: true, card_theme: 'black', announce: ANN }); assert.deepStrictEqual(Object.keys(r.j.announce), ['id', 'title', 'body', 'link', 'at']);
    assert(!r.text.includes(KEY) && !/google|secret|provider|AIza|zzz|audience|people/i.test(r.text), 'whitelist with an announcement: ' + r.text);
    // 11. link: a name from the list or its URL is accepted and always leaves as the URL; none = ""; anything else is dropped to "" (the message still shows)
    for (const [inp, want] of [['bets', '/?open=bets'], ['home', '/'], ['/', '/'], ['live', '/?open=live'], ['pga', '/pga.html'], ['/pickleball.html', '/pickleball.html'], ['/sports.html', '/sports.html'], ['sports', '/sports.html'], ['/golfgps.html', '/golfgps.html'], ['/classic.html', ''], ['/sports.html?lg=nba', ''], ['/pga.html#x', ''], ['pga.html', ''], [undefined, ''], [null, ''], ['', ''],
      ['https://evil.example/x', ''], ['javascript:alert(1)', ''], ['//evil.example', ''], ['/?open=bets&x=1', ''], ['/admin', ''], [7, ''], [{ a: 1 }, ''], [['bets'], ''], ['__proto__', ''], ['constructor', '']]) {
      start(); myapps = ok({}, Object.assign({}, ANN, { link: inp })); r = await get(); assert.strictEqual(r.j.announce.link, want, 'link ' + JSON.stringify(inp)); }
    // 12. id may be a number; at may be a number of milliseconds; both leave as text
    start(); myapps = ok({}, Object.assign({}, ANN, { id: 42, at: Date.parse(AT) })); r = await get(); assert.deepStrictEqual(r.j.announce, Object.assign({}, ANN, { id: '42' }));
    // 13. oversized, empty, wrong types, bad id / date, too old, from the future: the whole announcement is left out (never cut to fit), the rest is unchanged
    const bad = [{ title: 'x'.repeat(61) }, { body: 'y'.repeat(241) }, { title: '' }, { title: '   \n ' }, { body: '' }, { title: 7 }, { title: null }, { title: ['a'] }, { title: { toString: () => 'x' } }, { body: 5 }, { body: null }, { body: { a: 1 } },
      { id: '' }, { id: null }, { id: {} }, { id: 'a b' }, { id: '<i>' }, { id: 'x'.repeat(65) }, { id: NaN }, { at: '' }, { at: null }, { at: 'yesterday' }, { at: {} }, { at: 'x'.repeat(50) }, { at: '2026-11-01T00:00:00Z' }, { at: '2026-11-17T00:00:00Z' }, { at: -5 }];
    for (const b of bad) { start(); myapps = ok({ card_theme: 'green' }, Object.assign({}, ANN, b)); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'green' }, 'bad announce ' + JSON.stringify(b).slice(0, 40)); }
    for (const whole of [null, undefined, '', 'hello', 7, true, [], [ANN], {}]) { start(); myapps = ok({}, whole); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' }, 'announce ' + JSON.stringify(whole)); }
    start(); myapps = ok({}, Object.assign({}, ANN, { title: 'x'.repeat(60), body: 'y'.repeat(240) })); r = await get(); assert.strictEqual(r.j.announce.title.length, 60); assert.strictEqual(r.j.announce.body.length, 240);
    start(); myapps = ok({}, Object.assign({}, ANN, { at: '2026-11-02T18:00:01Z' })); r = await get(); assert(r.j.announce, '14 days old less a second still shows');
    // 14. PLAIN TEXT: tags are not removed and not turned into HTML here; they travel as the characters typed, inside JSON (the phone uses textContent). Line breaks and control characters become spaces.
    const X = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    start(); myapps = ok({}, Object.assign({}, ANN, { title: '<b>Hi</b> & "you"', body: X + '\n\u0000 line\ttwo \u2028end' })); r = await get();
    assert.strictEqual(r.j.announce.title, '<b>Hi</b> & "you"'); assert.strictEqual(r.j.announce.body, X + ' line two end'); assert.strictEqual(r.headers['content-type'], 'application/json');
    // 15. it rides the same cached read (no extra My Apps call), goes away when My Apps says null, and a caller cannot plant one
    start(); myapps = ok({}, ANN); await get(); await get(); assert.strictEqual(calls, 1); NOW += 5 * 6e4 + 1; myapps = ok({}, null); r = await get(); assert.strictEqual(calls, 2); assert(!('announce' in r.j));
    start(); r = await get('/appcfg?announce[title]=x&announce=%7B%22id%22%3A1%7D'); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable' });
    // 15b. an `announce` INSIDE settings is not the contract and is ignored; My Apps down keeps the last one; Hide (a good read with null) removes it
    start(); myapps = ok({ card_theme: 'light', announce: ANN }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'light' }, 'announce inside settings is ignored');
    start(); myapps = ok({ card_theme: 'light' }); r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'light' }, 'an older My Apps with no announce field');
    start(); myapps = ok({}, ANN); await get(); NOW += 5 * 6e4 + 1; myapps = () => { throw new Error('down'); }; r = await get(); assert.deepStrictEqual(r.j.announce, ANN, 'kept while My Apps is down'); NOW += 6e4 + 1; myapps = ok({}, null); r = await get(); assert(!('announce' in r.j), 'Hide');
    // 15c. courts.js and the raw settings are untouched by the announcement: get() still returns only the settings object
    start(); myapps = ok({ courts_provider: 'google', google_places_key: KEY }, ANN); assert.deepStrictEqual(await S.get(deps), { courts_provider: 'google', google_places_key: KEY }); assert.deepStrictEqual(await C._settings(), { provider: 'google', key: KEY, from: 'myapps' }); assert.strictEqual(calls, 1);
    r = await get(); assert.deepStrictEqual(r.j, { ok: true, card_theme: 'oddable', announce: ANN }); assert.strictEqual(calls, 1, 'still one My Apps read'); assert(!r.text.includes(KEY));
    // 16. an announcement that was fine when read is dropped once it passes 14 days, even while My Apps is down
    start(); myapps = ok({}, ANN); r = await get(); assert(r.j.announce); NOW += 14 * 864e5; myapps = () => { throw new Error('down'); }; r = await get(); assert(!('announce' in r.j));
    console.log('appcfg.test.js: all passed');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; } finally { srv.close(); }
})();
