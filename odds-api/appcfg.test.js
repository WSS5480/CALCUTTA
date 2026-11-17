// Run: node odds-api/appcfg.test.js   (no network: My Apps, the clock and the env are in-memory fakes)
const assert = require('assert'), http = require('http'), A = require('./appcfg'), S = require('./appsettings'), C = require('./courts');
const KEY = 'AIzaSyTEST-key_0123456789abcdefghijklmn';
let NOW, calls, myapps, maOn, env;
function start() { S._reset(); C._reset(); NOW = Date.parse('2026-11-16T18:00:00Z'); calls = 0; maOn = true; env = {}; myapps = () => ({ ok: false, status: 404, j: {} }); }
const deps = { ma: async (path, data) => { calls++; assert.strictEqual(path, '/api/v1/app/settings'); assert.deepStrictEqual(data, {}); return myapps(); }, maReady: () => maOn, now: () => NOW, log: () => {} };
A._deps.settings = () => S.get(deps); A._deps.env = (k) => env[k];
Object.assign(C._deps, { ma: deps.ma, maReady: deps.maReady, now: deps.now, log: () => {}, env: (k) => env[k] });
const ok = (settings) => () => ({ ok: true, status: 200, j: { ok: true, settings } });
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
    console.log('appcfg.test.js: all passed');
  } catch (e) { console.error('FAILED', e); process.exitCode = 1; } finally { srv.close(); }
})();
